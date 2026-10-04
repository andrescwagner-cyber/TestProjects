/**
 * grocery.js — the brain of the planner.
 *
 * Pure functions, no DOM access, so this file can be unit-tested in Node.
 * Ported from (and kept in parity with) the tested Python reference:
 *
 *   - parse a free-text ingredient line into {quantity, unit, name, note}
 *   - format decimals as kitchen fractions (0.33 -> "1/3", 1.5 -> "1 1/2")
 *   - scale by (target servings / base servings)
 *   - classify ingredients into store aisles
 *   - merge duplicate ingredients across recipes, remembering their sources
 *
 * Deliberately avoids regex lookbehind so it runs on older iOS Safari.
 */

import {
  AISLES,
  AISLE_SEASONINGS,
  AISLE_HOUSEHOLD,
  DEFAULT_AISLE,
  AISLE_KEYWORDS,
  UNIT_ALIASES,
  UNIT_FAMILIES,
  METRIC_UNITS,
  NO_PLURAL_UNITS,
  IRREGULAR_PLURALS,
  DISCRETE_UNITS,
  NAME_UNIT_WORDS,
  NOISE_WORDS,
  TRAILING_PHRASES,
  SIZE_WORDS,
  UNICODE_FRACTIONS,
  SERIES_COUNT,
} from './data.js';

const NOISE = new Set(NOISE_WORDS);
const SIZES = new Set(SIZE_WORDS);
const NO_PLURAL = new Set(NO_PLURAL_UNITS);
const METRIC = new Set(METRIC_UNITS);
const DISCRETE = new Set(DISCRETE_UNITS);
const NAME_UNITS = new Set(NAME_UNIT_WORDS);

const PLURAL_TO_SINGULAR = Object.fromEntries(
  Object.entries(IRREGULAR_PLURALS).map(([singular, plural]) => [plural, singular]),
);

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Lowercase, strip punctuation, collapse whitespace. */
export function simplify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9'&\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Small, conservative English singulariser. */
export function singularize(word) {
  if (!word || word.length <= 3) return word;
  if (PLURAL_TO_SINGULAR[word]) return PLURAL_TO_SINGULAR[word];
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (/(sses|shes|ches|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('oes') && word.length > 4) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function singularizePhrase(text) {
  return text.split(' ').map(singularize).join(' ');
}

// ---------------------------------------------------------------------------
// Aisle classification
// ---------------------------------------------------------------------------

// Longest keyword first so "garlic powder" beats "garlic" and
// "red pepper flakes" beats "red pepper". Each entry also carries the
// singularised spelling so "roma tomatoes" matches the "roma tomato" keyword.
const KEYWORD_INDEX = Object.entries(AISLE_KEYWORDS)
  .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]))
  .map(([keyword, aisle]) => {
    const singular = singularizePhrase(keyword);
    const needles = singular === keyword ? [keyword] : [keyword, singular];
    return { needles: needles.map((n) => ` ${n} `), aisle };
  });

const categoryCache = new Map();

/** Best-guess grocery aisle for an ingredient name. */
export function categorize(name) {
  const key = simplify(name);
  if (categoryCache.has(key)) return categoryCache.get(key);

  const haystacks = [` ${key} `, ` ${singularizePhrase(key)} `];
  let result = DEFAULT_AISLE;
  for (const { needles, aisle } of KEYWORD_INDEX) {
    let hit = false;
    for (const needle of needles) {
      for (const hay of haystacks) {
        if (hay.includes(needle)) {
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      result = aisle;
      break;
    }
  }
  categoryCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const SORTED_UNIT_ALIASES = Object.keys(UNIT_ALIASES).sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

/** Conversion family for a unit: 'volume', 'weight', 'count' or 'unit:<x>'. */
export function unitFamily(unit) {
  const u = String(unit ?? '').trim().toLowerCase();
  if (!u) return 'count';
  if (UNIT_FAMILIES[u]) return UNIT_FAMILIES[u].family;
  return `unit:${u}`;
}

/**
 * Pluralise a unit for display. Kitchen convention keeps the singular at or
 * below one: "1/2 cup", "3/4 tsp", but "2 cups".
 */
export function displayUnit(unit, qty) {
  const u = String(unit ?? '').trim();
  if (!u || NO_PLURAL.has(u)) return u;
  if (qty != null && qty <= 1 + 1e-9) return u;
  if (IRREGULAR_PLURALS[u]) return IRREGULAR_PLURALS[u];
  if (/(ch|sh|s|x|z)$/.test(u)) return `${u}es`;
  return `${u}s`;
}

// ---------------------------------------------------------------------------
// Quantities and fractions
// ---------------------------------------------------------------------------

const UNICODE_KEYS = Object.keys(UNICODE_FRACTIONS);
const UNICODE_CLASS = UNICODE_KEYS.join('');
const NUMBER_TOKEN =
  `(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+\\s*[${UNICODE_CLASS}]` +
  `|\\d*\\.\\d+|\\d+|[${UNICODE_CLASS}])`;
const LEADING_QTY_RE = new RegExp(
  `^\\s*(${NUMBER_TOKEN})(?:\\s*(?:-|–|—|to|or)\\s*(${NUMBER_TOKEN}))?\\s*`,
  'i',
);

/** Parse '1 1/2', '3/4', '1½', '½', '0.5', '2' into a number. */
export function parseNumber(token) {
  if (token == null) return null;
  let text = String(token).trim();
  if (!text) return null;

  let total = 0;
  let found = false;

  for (const ch of UNICODE_KEYS) {
    if (text.includes(ch)) {
      const occurrences = text.split(ch).length - 1;
      total += UNICODE_FRACTIONS[ch] * occurrences;
      text = text.split(ch).join(' ');
      found = true;
    }
  }

  text = text.trim();
  if (text) {
    const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (mixed) {
      const den = Number(mixed[3]);
      if (den === 0) return null;
      return Number(mixed[1]) + Number(mixed[2]) / den;
    }
    const fraction = text.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
      const den = Number(fraction[2]);
      if (den === 0) return null;
      total += Number(fraction[1]) / den;
      found = true;
    } else if (/^\d*\.?\d+$/.test(text)) {
      total += Number(text);
      found = true;
    }
  }
  return found ? total : null;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/** Snap a float to the friendliest fraction within a small tolerance. */
function niceFraction(value) {
  for (const den of [1, 2, 3, 4, 6, 8, 16]) {
    const num = Math.round(value * den);
    if (Math.abs(num / den - value) <= 0.021) {
      const d = gcd(num, den);
      return [num / d, den / d];
    }
  }
  const num = Math.round(value * 16);
  const d = gcd(num, 16);
  return [num / d, 16 / d];
}

/**
 * Render a number as a clean, kitchen-friendly fraction string.
 * 0.33 -> "1/3", 0.5 -> "1/2", 1.5 -> "1 1/2", 2 -> "2".
 */
export function formatQuantity(value) {
  if (value == null) return '';
  if (value <= 0) return '0';

  let num;
  let den;
  if (value >= 20) {
    // Big numbers read better rounded to the nearest half.
    const rounded = Math.round(value * 2) / 2;
    num = Math.round(rounded * 2);
    den = 2;
    const d = gcd(num, den);
    num /= d;
    den /= d;
  } else {
    [num, den] = niceFraction(value);
  }

  if (den === 1) return String(num);
  const whole = Math.floor(num / den);
  const remainder = num % den;
  if (whole) return `${whole} ${remainder}/${den}`;
  return `${remainder}/${den}`;
}

/** Round whole-item units up — you can't buy 16 1/4 garlic cloves. */
export function roundUpDiscrete(quantity, unit) {
  if (quantity == null) return null;
  const u = String(unit ?? '').trim().toLowerCase();
  if (!DISCRETE.has(u)) return quantity;
  if (Math.abs(quantity - Math.round(quantity)) < 0.05) return Math.round(quantity);
  return Math.floor(quantity) + 1;
}

/** (target / base) * quantity, guarding against a bad base value. */
export function scaleQuantity(quantity, targetServings, baseServings) {
  if (quantity == null) return null;
  let base = Number(baseServings);
  if (!Number.isFinite(base) || base <= 0) base = 1;
  return (Number(targetServings) / base) * Number(quantity);
}

/** '2 cups', '5 cloves', '1 1/2 tbsp', or '' when the quantity is unknown. */
export function formatAmount(quantity, unit) {
  if (quantity == null) return '';
  return `${formatQuantity(quantity)} ${displayUnit(unit, quantity)}`.trim();
}

// ---------------------------------------------------------------------------
// Ingredient parsing
// ---------------------------------------------------------------------------

/**
 * Split a free-text ingredient line into structured parts.
 * Returns {raw, quantity, unit, name, note, aisle}.
 */
export function parseIngredient(raw) {
  const original = String(raw ?? '').trim();
  let text = original.replace(/^[-*•●·\s]+/, '');

  const notes = [];

  // Pull parentheticals out as notes: "1 (14.5 ounce) can diced tomatoes".
  text = text.replace(/\(([^)]*)\)/g, (_match, inner) => {
    const trimmed = String(inner).trim();
    if (trimmed) notes.push(trimmed);
    return ' ';
  });
  text = text.replace(/\s+/g, ' ').trim();

  // Quantity, with an optional range -> keep the lower bound, note the upper.
  let quantity = null;
  const qtyMatch = text.match(LEADING_QTY_RE);
  if (qtyMatch) {
    quantity = parseNumber(qtyMatch[1]);
    if (qtyMatch[2]) {
      const high = parseNumber(qtyMatch[2]);
      if (high != null) notes.push(`up to ${formatQuantity(high)}`);
    }
    if (quantity != null) text = text.slice(qtyMatch[0].length).trim();
  }

  // Unit immediately after the quantity.
  let unit = '';
  const lowered = text.toLowerCase();
  for (const alias of SORTED_UNIT_ALIASES) {
    if (lowered.startsWith(alias)) {
      const next = lowered.charAt(alias.length);
      if (!next || !/[a-z]/.test(next)) {
        unit = UNIT_ALIASES[alias];
        text = text.slice(alias.length).trim();
        break;
      }
    }
  }

  // "2 cups of flour"
  text = text.replace(/^of\s+/i, '').trim();

  // "1 cup plus 2 tbsp" -> keep the remainder as a note.
  const combo = text.match(/^(?:plus|\+)\s+(.*)$/i);
  if (combo) {
    notes.push(`plus ${combo[1]}`);
    text = '';
  }

  // Preparation notes after a comma, then after a dash.
  let namePart = text;
  const comma = text.indexOf(',');
  if (comma !== -1) {
    namePart = text.slice(0, comma).trim();
    const tail = text.slice(comma + 1).trim();
    if (tail) notes.push(tail);
  }
  namePart = namePart.split(/\s+[-–—]\s+/)[0].trim();

  let name = namePart.replace(/\s+/g, ' ').replace(/^[.;:\s]+|[.;:\s]+$/g, '');

  // "3 garlic cloves" -> quantity 3, unit 'clove', name 'garlic', so it
  // merges with "2 cloves garlic" instead of forming a second line.
  if (!unit && quantity != null && name) {
    const words = name.split(' ');
    if (words.length > 1) {
      for (let i = 0; i < words.length; i += 1) {
        const candidate = singularize(simplify(words[i]));
        if (NAME_UNITS.has(candidate)) {
          unit = candidate;
          name = [...words.slice(0, i), ...words.slice(i + 1)].join(' ').trim();
          break;
        }
      }
    }
  }

  if (!name) {
    name = original.replace(/\s+/g, ' ').replace(/^[.;:\s]+|[.;:\s]+$/g, '') || 'Item';
  }

  return {
    raw: original,
    quantity,
    unit,
    name,
    note: notes.filter(Boolean).join('; '),
    aisle: categorize(name),
  };
}

/** Parse a block of newline-separated ingredient lines. */
export function parseIngredientLines(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => line.trim())
    .map(parseIngredient);
}

/**
 * Reduce an ingredient name to a stable merge key, so "Garlic cloves,
 * minced" and "fresh garlic" both become "garlic".
 */
export function normalizeName(name) {
  let text = simplify(name).replace(/\b\d+(\.\d+)?\b/g, ' ');
  for (const phrase of TRAILING_PHRASES) text = text.split(phrase).join(' ');
  // Filtered again after singularising so plurals of noise words
  // ("cloves", "cans") drop out too.
  let words = text
    .split(' ')
    .filter((w) => w && !NOISE.has(w))
    .map(singularize)
    .filter((w) => w && !NOISE.has(w));
  if (!words.length) {
    words = text.split(' ').filter(Boolean);
    if (!words.length) words = ['item'];
  }
  return words.join(' ');
}

/** Drop size adjectives so a line reads "Yellow Onion", not "Large Yellow Onion". */
export function cleanDisplayName(name) {
  const words = String(name ?? '').trim().split(/\s+/);
  const kept = words.filter((w) => !SIZES.has(w.toLowerCase().replace(/,/g, '')));
  return kept.length ? kept.join(' ') : String(name ?? '').trim();
}

/** Title-ish display name that keeps acronyms and lowercase joiners sane. */
export function prettyName(name) {
  const text = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const small = new Set(['and', 'or', 'of', 'with', 'in', 'a', 'an', 'the']);
  return text
    .split(' ')
    .map((word, i) => {
      if (word === word.toUpperCase() && word.length <= 4) return word;
      if (i > 0 && small.has(word.toLowerCase())) return word.toLowerCase();
      return word.length > 1 ? word[0].toUpperCase() + word.slice(1) : word.toUpperCase();
    })
    .join(' ');
}

/** FNV-1a: a short, stable id so a checkbox stays attached to its item. */
function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Stable id used to persist checkbox state across reloads. */
export function itemKey(name, aisle) {
  const basis = `${normalizeName(name)}|${aisle}`;
  return `${hashString(basis)}${basis.length.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Recipe colours
// ---------------------------------------------------------------------------

/**
 * Map each recipe in the active plan to a colour slot.
 *
 * Returns CSS custom-property references rather than raw hex, so the same
 * assignment works in light and dark mode — styles.css defines --series-1..8
 * twice, with values validated against each surface.
 */
export function assignColors(recipeIds) {
  const out = {};
  recipeIds.forEach((id, i) => {
    out[id] = `var(--series-${(i % SERIES_COUNT) + 1})`;
  });
  return out;
}

/**
 * Map each recipe to its 1-based number.
 *
 * Colour alone can't carry identity here: any two recipes can end up side by
 * side on one grocery line, and the palette only clears colour-vision
 * separation for *adjacent* slots, not every possible pair. The number shown
 * inside each chip is the real identifier; the colour is a fast visual aid.
 */
export function assignNumbers(recipeIds) {
  const out = {};
  recipeIds.forEach((id, i) => {
    out[id] = i + 1;
  });
  return out;
}

/** Shorten a recipe title to fit inside a badge. */
export function shortLabel(title, maxLen = 18) {
  const text = String(title ?? '').trim().replace(/\s+/g, ' ');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

/**
 * Pick the nicest unit for a merged bucket.
 * `bucketUnits` maps canonical unit -> summed quantity in that unit.
 */
/**
 * The smallest amount of each unit a kitchen actually measures. Below it,
 * step down to a smaller unit in the same family.
 *
 * This has to be per-unit, not one threshold: a quarter cup is an everyday
 * measurement, but a quarter tablespoon is not — that is three quarters of a
 * teaspoon, and a teaspoon is what the recipe would have said.
 */
const SMALLEST_SENSIBLE = {
  cup: 0.125, // 1/8 cup is a real measure; 1/16 is not
  tbsp: 0.5, // half a tablespoon, yes; a quarter, no
  tsp: 0.125, // 1/8 tsp measuring spoons exist
  pint: 0.25,
  quart: 0.25,
  gallon: 0.25,
  'fl oz': 0.25,
};
const SMALLEST_DEFAULT = 0.125;

/** Render `baseTotal` (in the family's base unit) in the nicest unit available. */
function pickUnitForTotal(baseTotal, family, presentUnits) {
  const convertible = presentUnits.filter((u) => UNIT_FAMILIES[u]);
  const allMetric = convertible.length > 0 && convertible.every((u) => METRIC.has(u));

  const inFamily = Object.keys(UNIT_FAMILIES).filter((u) => UNIT_FAMILIES[u].family === family);
  let pool = allMetric
    ? inFamily.filter((u) => METRIC.has(u))
    : inFamily.filter((u) => !METRIC.has(u));
  if (!pool.length) pool = inFamily;
  pool.sort((a, b) => UNIT_FAMILIES[b].factor - UNIT_FAMILIES[a].factor);

  for (const unit of pool) {
    const converted = baseTotal / UNIT_FAMILIES[unit].factor;
    if (converted >= 0.75) return [unit, converted];
  }
  const smallest = pool[pool.length - 1];
  return [smallest, baseTotal / UNIT_FAMILIES[smallest].factor];
}

/**
 * Pick the nicest unit for a merged bucket.
 * `bucketUnits` maps canonical unit -> summed quantity in that unit.
 */
function chooseDisplayUnit(bucketUnits, family) {
  const units = Object.keys(bucketUnits).filter(Boolean);
  if (!units.length) {
    const total = Object.values(bucketUnits).reduce((a, b) => a + b, 0);
    return ['', total];
  }

  const convertibleFamily = family === 'volume' || family === 'weight';

  if (units.length === 1) {
    const unit = units[0];
    const qty = bucketUnits[unit];
    // Scaling a recipe down can leave an unmeasurable sliver like "1/16 cup
    // basil". Step it into a unit a person would actually measure.
    const floor = SMALLEST_SENSIBLE[unit] ?? SMALLEST_DEFAULT;
    if (convertibleFamily && UNIT_FAMILIES[unit] && qty > 0 && qty < floor) {
      return pickUnitForTotal(qty * UNIT_FAMILIES[unit].factor, family, units);
    }
    return [unit, qty];
  }

  if (!convertibleFamily) {
    // Not convertible: report the largest contributor's unit.
    const unit = units.reduce((best, u) => (bucketUnits[u] > bucketUnits[best] ? u : best), units[0]);
    return [unit, bucketUnits[unit]];
  }

  const baseTotal = units.reduce(
    (sum, u) => sum + (UNIT_FAMILIES[u] ? bucketUnits[u] * UNIT_FAMILIES[u].factor : 0),
    0,
  );
  return pickUnitForTotal(baseTotal, family, units);
}

/**
 * Merge every recipe's ingredients into one aggregated grocery list.
 *
 * @param {Array} plan     recipes: {id, title, baseServings, mainIngredients, seasonings}
 * @param {number} targetServings
 * @param {Array} householdItems  {name, aisle, quantity, unit, note}
 * @returns {Array} {key, name, aisle, amount, sources, notes, household}
 */
export function consolidate(plan, targetServings, householdItems = []) {
  const merged = new Map();

  for (const recipe of plan) {
    const rid = recipe.id;
    const base = recipe.baseServings || 1;
    const ingredients = [
      ...(recipe.mainIngredients || []),
      ...(recipe.seasonings || []),
    ];

    for (const ing of ingredients) {
      const name = ing.name || ing.raw || '';
      if (!name.trim()) continue;

      let aisle = ing.aisle || categorize(name);
      if (!AISLES.includes(aisle)) aisle = DEFAULT_AISLE;
      const key = itemKey(name, aisle);
      const display = cleanDisplayName(name);

      if (!merged.has(key)) {
        merged.set(key, {
          key,
          norm: normalizeName(name),
          name: prettyName(display),
          aisle,
          buckets: new Map(), // family -> Map(unit -> qty)
          unknown: 0,
          sources: [],
          notes: [],
          household: false,
        });
      }
      const entry = merged.get(key);

      // Prefer the shortest display name among variants (usually cleanest).
      if (display.length < entry.name.length) entry.name = prettyName(display);
      if (!entry.sources.includes(rid)) entry.sources.push(rid);
      if (ing.note) {
        const note = String(ing.note).trim();
        if (note && !entry.notes.includes(note)) entry.notes.push(note);
      }

      const qty = scaleQuantity(ing.quantity, targetServings, base);
      const unit = String(ing.unit || '').trim().toLowerCase();
      if (qty == null) {
        entry.unknown += 1;
        continue;
      }
      const family = unitFamily(unit);
      if (!entry.buckets.has(family)) entry.buckets.set(family, new Map());
      const bucket = entry.buckets.get(family);
      bucket.set(unit, (bucket.get(unit) || 0) + qty);
    }
  }

  for (const extra of householdItems || []) {
    const name = String(extra.name || '').trim();
    if (!name) continue;
    let aisle = extra.aisle || AISLE_HOUSEHOLD;
    if (!AISLES.includes(aisle)) aisle = AISLE_HOUSEHOLD;
    const key = `h_${itemKey(name, aisle)}`;

    if (!merged.has(key)) {
      merged.set(key, {
        key,
        norm: normalizeName(name),
        name: prettyName(name),
        aisle,
        buckets: new Map(),
        unknown: 0,
        sources: [],
        notes: [],
        household: true,
      });
    }
    const entry = merged.get(key);
    const qty = extra.quantity;
    const unit = String(extra.unit || '').trim().toLowerCase();
    if (qty == null) {
      entry.unknown += 1;
    } else {
      const family = unitFamily(unit);
      if (!entry.buckets.has(family)) entry.buckets.set(family, new Map());
      const bucket = entry.buckets.get(family);
      bucket.set(unit, (bucket.get(unit) || 0) + Number(qty));
    }
    if (extra.note) entry.notes.push(String(extra.note).trim());
  }

  const items = [];
  for (const entry of merged.values()) {
    const parts = [];
    const multiBucket = entry.buckets.size > 1;
    for (const [family, bucket] of entry.buckets.entries()) {
      const bucketObj = Object.fromEntries(bucket.entries());
      const [unit, total] = chooseDisplayUnit(bucketObj, family);
      const rounded = roundUpDiscrete(total, unit);
      let text = formatAmount(rounded, unit);
      // One recipe asks for "4 chicken breasts", another for "1.5 lb chicken
      // breast". Both are needed, but "12 + 2 1/4 lb" reads as nonsense, so a
      // bare count gets the word "whole" when it sits beside a measured amount.
      if (text && multiBucket && !unit) text = `${text} whole`;
      if (text) parts.push(text);
    }
    if (!parts.length && entry.unknown) parts.push('as needed');
    else if (entry.unknown) parts.push(`+ ${entry.unknown} to taste`);

    items.push({
      key: entry.key,
      name: entry.name || prettyName(entry.norm),
      aisle: entry.aisle,
      amount: parts.join(' + '),
      sources: entry.sources,
      notes: entry.notes,
      household: entry.household,
    });
  }

  items.sort(
    (a, b) =>
      AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return items;
}

/** [[aisle, items]] in canonical order, skipping empty aisles. */
export function groupByAisle(items) {
  const grouped = new Map(AISLES.map((a) => [a, []]));
  for (const item of items) {
    if (!grouped.has(item.aisle)) grouped.set(item.aisle, []);
    grouped.get(item.aisle).push(item);
  }
  return AISLES.filter((a) => grouped.get(a) && grouped.get(a).length).map((a) => [
    a,
    grouped.get(a),
  ]);
}

/** Human-readable scaled ingredient text for one recipe. */
export function scaledIngredientLines(recipe, targetServings) {
  const base = recipe.baseServings || 1;
  const render = (list) =>
    (list || []).map((ing) => {
      const qty = scaleQuantity(ing.quantity, targetServings, base);
      const amount = formatAmount(qty, ing.unit || '');
      const name = prettyName(ing.name || ing.raw || '');
      const note = String(ing.note || '').trim();
      const line = `${amount} ${name}`.trim();
      return note ? `${line} (${note})` : line;
    });
  return {
    main: render(recipe.mainIngredients),
    seasonings: render(recipe.seasonings),
  };
}

/** The grocery list as copy/paste-able plain text. */
export function plainTextList(items, titlesById, numbers, checked) {
  const lines = [];
  for (const [aisle, group] of groupByAisle(items)) {
    lines.push(aisle.toUpperCase());
    for (const item of group) {
      const box = checked[item.key] ? '[x]' : '[ ]';
      const tags = item.sources.length
        ? ` (${item.sources.map((rid) => numbers[rid]).filter(Boolean).join(',')})`
        : '';
      const amount = item.amount ? ` — ${item.amount}` : '';
      lines.push(`${box} ${item.name}${amount}${tags}`);
    }
    lines.push('');
  }
  const ids = Object.keys(titlesById || {});
  if (ids.length) {
    lines.push('Meals:');
    for (const rid of ids) lines.push(`  ${numbers[rid]}. ${titlesById[rid]}`);
  }
  return lines.join('\n').trim();
}

export { AISLES, AISLE_SEASONINGS, AISLE_HOUSEHOLD };
