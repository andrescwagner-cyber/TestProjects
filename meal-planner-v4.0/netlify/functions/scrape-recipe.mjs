/**
 * scrape-recipe — Netlify serverless function.
 *
 * Why this exists: a browser can't fetch allrecipes.com directly from your
 * page (CORS), so this tiny server-side helper fetches the page and returns
 * just the ingredient lines. It has no npm dependencies, so there is nothing
 * to install or build.
 *
 * Reachable at /api/scrape (see netlify.toml) or
 * /.netlify/functions/scrape-recipe.
 *
 * Extraction order:
 *   1. schema.org JSON-LD  — what the big recipe sites publish; most reliable.
 *   2. microdata           — itemprop="recipeIngredient".
 *   3. CSS-ish fallbacks    — markup used by the common recipe plugins.
 *
 * Every failure is returned as data ({ok: false, error, hint}) with HTTP 200,
 * so the app can show a helpful message instead of a crash. A 404 from this
 * path means the function isn't deployed at all, which the app detects
 * separately.
 */

const TIMEOUT_MS = 15000;
const MAX_BYTES = 3_000_000;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function fail(error, hint = '') {
  return reply({ ok: false, error, hint });
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', deg: '°',
  frac12: '½', frac13: '⅓', frac23: '⅔', frac14: '¼',
  frac34: '¾', frac18: '⅛', frac38: '⅜', frac58: '⅝',
  frac78: '⅞', eacute: 'é', egrave: 'è', agrave: 'à',
  ccedil: 'ç', ntilde: 'ñ', uuml: 'ü', ouml: 'ö',
  auml: 'ä', middot: '·', bull: '•', times: '×',
  minus: '−', prime: '′', Prime: '″',
};

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _m;
    })
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => {
      const direct = NAMED_ENTITIES[name];
      if (direct !== undefined) return direct;
      const lower = NAMED_ENTITIES[name.toLowerCase()];
      return lower !== undefined ? lower : match;
    });
}

/** Strip tags, decode entities, collapse whitespace, drop list bullets. */
function cleanLine(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-*•●·\s]+/, '')
    .replace(/^[;\s]+|[;\s]+$/g, '')
    .trim();
}

function flattenText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    for (const field of ['name', 'text', '@value', 'value']) {
      if (field in value) return flattenText(value[field]);
    }
  }
  return '';
}

function parseServings(value) {
  const text = flattenText(value);
  const match = text.match(/\d+/);
  if (!match) return null;
  const servings = parseInt(match[0], 10);
  return servings >= 1 && servings <= 100 ? servings : null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function* iterJsonLdObjects(html) {
  const blockRe =
    /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let block;
  while ((block = blockRe.exec(html)) !== null) {
    let raw = block[1].trim();
    if (!raw) continue;
    // Some sites emit several concatenated objects in one block.
    if (raw.startsWith('{') && raw.includes('}{')) {
      raw = `[${raw.split('}{').join('},{')}]`;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (const child of node) if (child && typeof child === 'object') stack.push(child);
      } else if (node && typeof node === 'object') {
        yield node;
        for (const value of Object.values(node)) {
          if (value && typeof value === 'object') stack.push(value);
        }
      }
    }
  }
}

function isRecipeNode(node) {
  const type = node['@type'] ?? node.type;
  if (typeof type === 'string') return type.toLowerCase() === 'recipe';
  if (Array.isArray(type)) return type.some((t) => String(t).toLowerCase() === 'recipe');
  return false;
}

function fromJsonLd(html) {
  for (const node of iterJsonLdObjects(html)) {
    if (!isRecipeNode(node)) continue;
    let raw = node.recipeIngredient ?? node.ingredients;
    if (typeof raw === 'string') raw = [raw];
    const lines = (Array.isArray(raw) ? raw : [])
      .map((entry) => cleanLine(flattenText(entry)))
      .filter(Boolean);
    if (!lines.length) continue;
    return {
      title: cleanLine(flattenText(node.name)),
      servings: parseServings(node.recipeYield),
      lines,
      method: 'the site’s own recipe data',
    };
  }
  return null;
}

/** Collect the inner HTML of every element whose open tag matches `attrRe`. */
function collectElements(html, attrRe, tag = '(?:li|div|span|p)') {
  const results = [];
  const open = new RegExp(`<(${tag})\\b([^>]*)>`, 'gi');
  let match;
  while ((match = open.exec(html)) !== null) {
    const [full, tagName, attrs] = match;
    if (!attrRe.test(attrs)) continue;
    const closeTag = `</${tagName.toLowerCase()}`;
    const start = match.index + full.length;
    // Nearest matching close tag; good enough for leaf list items.
    const end = html.toLowerCase().indexOf(closeTag, start);
    results.push(html.slice(start, end === -1 ? start + 400 : end));
    if (results.length >= 120) break;
  }
  return results;
}

const FALLBACK_PATTERNS = [
  { re: /itemprop\s*=\s*["']?recipeIngredient/i, label: 'microdata on the page' },
  { re: /itemprop\s*=\s*["']?ingredients/i, label: 'microdata on the page' },
  { re: /mm-recipes-structured-ingredients__list-item/i, label: 'the page layout' },
  { re: /structured-ingredients__list-item/i, label: 'the page layout' },
  { re: /wprm-recipe-ingredient\b/i, label: 'the page layout' },
  { re: /tasty-recipes-ingredients/i, label: 'the page layout' },
  { re: /\bingredients?-item\b/i, label: 'the page layout' },
  { re: /\bingredient-list__item\b/i, label: 'the page layout' },
  { re: /o-Ingredients__a-ListItem/i, label: 'the page layout' },
  { re: /class\s*=\s*["'][^"']*\bingredient/i, label: 'the page layout' },
];

function fromFallbacks(html) {
  for (const { re, label } of FALLBACK_PATTERNS) {
    const seen = new Set();
    const lines = [];
    for (const chunk of collectElements(html, re)) {
      const text = cleanLine(chunk);
      if (!text || text.length > 220) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(text);
    }
    if (lines.length >= 2) return { title: '', servings: null, lines, method: label };
  }
  return null;
}

function findTitle(html) {
  const og = html.match(
    /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i,
  );
  if (og) return cleanLine(og[1]);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = cleanLine(h1[1]);
    if (text) return text;
  }
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    // Trim trailing site names: "Best Chili Recipe | Allrecipes"
    return cleanLine(title[1]).split(/\s+[|\-–—]\s+/)[0];
  }
  return '';
}

function findServings(html) {
  const itemprop = html.match(
    /itemprop\s*=\s*["']?recipeYield["']?[^>]*>([\s\S]{0,60}?)</i,
  );
  if (itemprop) {
    const servings = parseServings(cleanLine(itemprop[1]));
    if (servings) return servings;
  }
  const text = cleanLine(html.slice(0, 200000)).slice(0, 8000);
  const match = text.match(/(?:serves|servings|yield)\D{0,12}(\d{1,2})/i);
  if (match) {
    const value = parseInt(match[1], 10);
    if (value >= 1 && value <= 100) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------

/**
 * This endpoint is public, so refuse anything that isn't a normal public web
 * page: no other schemes, no localhost, no private network ranges.
 */
function validateUrl(input) {
  // Work out the scheme *before* prefixing anything, or "file:///etc/passwd"
  // would become "https://file:///etc/passwd" and sail through the check.
  let candidate = input;
  const schemeMatch = input.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https') {
      candidate = input;
    } else if (schemeMatch[1].includes('.')) {
      // Not a scheme at all — a bare "example.com:8080/path".
      candidate = `https://${input}`;
    } else {
      return { ok: false, error: 'Only http and https links can be imported.' };
    }
  } else {
    candidate = `https://${input}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch (err) {
    return { ok: false, error: "That doesn't look like a web address." };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https links can be imported.' };
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host);
  if (blocked) {
    return { ok: false, error: 'That address is not a public website.' };
  }
  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (request.method !== 'POST') {
    return fail('Send this request as a POST.', '');
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return fail('The request body was not valid JSON.', '');
  }

  const requested = String(body?.url ?? '').trim();
  if (!requested) return fail('Paste a recipe link first.', '');

  const checked = validateUrl(requested);
  if (!checked.ok) return fail(checked.error, 'Double-check the link and try again.');
  const target = checked.url.toString();

  let response;
  try {
    response = await fetch(target, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const aborted = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return fail(
      aborted
        ? `The site didn't respond within ${Math.round(TIMEOUT_MS / 1000)} seconds.`
        : "Couldn't reach that website.",
      'Check the link, or type the recipe in by hand.',
    );
  }

  if ([401, 403, 406, 429].includes(response.status)) {
    return fail(
      `That site blocked the request (error ${response.status}).`,
      'Some recipe sites refuse automated readers. Copy the ingredients and use “Type it in”.',
    );
  }
  if (!response.ok) {
    return fail(
      `That site returned error ${response.status}.`,
      'The page may have moved or been removed.',
    );
  }

  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > MAX_BYTES) {
    return fail('That page is too large to read.', 'Type the recipe in by hand instead.');
  }

  let html;
  try {
    html = await response.text();
  } catch (err) {
    return fail("Couldn't read that page.", 'Type the recipe in by hand instead.');
  }
  if (html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);

  const warnings = [];
  let extracted = fromJsonLd(html);
  if (!extracted) {
    extracted = fromFallbacks(html);
    if (extracted) {
      warnings.push(
        'This site does not publish proper recipe data, so the list was read ' +
          'from the page layout. Please check it over before saving.',
      );
    }
  }

  if (!extracted || !extracted.lines.length) {
    return fail(
      'No ingredient list could be found on that page.',
      'The site may build its recipe with JavaScript or block automated ' +
        'readers. Copy the ingredients and use “Type it in”.',
    );
  }

  const title = extracted.title || findTitle(html) || 'Imported recipe';
  let servings = extracted.servings || findServings(html);
  if (!servings) {
    servings = 4;
    warnings.push(
      "The page didn't say how many servings it makes, so this is set to 4 — " +
        'correct it below if the recipe says otherwise.',
    );
  }

  return reply({
    ok: true,
    title,
    sourceUrl: response.url || target,
    baseServings: servings,
    rawLines: extracted.lines,
    method: extracted.method,
    warnings,
  });
}

// Exported for local testing against saved HTML fixtures.
export const __test = { fromJsonLd, fromFallbacks, findTitle, findServings, validateUrl, cleanLine, decodeEntities };
