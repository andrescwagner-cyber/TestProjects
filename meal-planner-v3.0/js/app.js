/**
 * app.js — UI controller.
 *
 * Owns the DOM: tab switching, forms, rendering the three screens and wiring
 * every control to `store` (persistence) and `grocery` (the maths). All
 * rendering goes through renderVault / renderPlan / renderList so there is a
 * single source of truth for what's on screen.
 */

import * as store from './store.js';
import * as g from './grocery.js';
import { AISLES, AISLE_SEASONINGS, AISLE_HOUSEHOLD } from './data.js';
import { CATEGORIES } from './recipes.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Escape anything that came from a user or a scraped page. */
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const IRREGULAR = { person: 'people' };

/** "1 meal" / "3 meals" / "2 people" — not "2 persons". */
const plural = (n, word) =>
  `${n} ${n === 1 ? word : IRREGULAR[word] || `${word}s`}`;

/**
 * Only ever emit http(s) links. The source URL is a free-text field, so
 * without this check a `javascript:` URL typed into it would run when tapped.
 */
function safeUrl(url) {
  const text = String(url ?? '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch (err) {
    return '';
  }
}

/**
 * The built-in recipes list ingredients but no method, so every recipe gets
 * a one-tap way to go and watch somebody cook it. A search link rather than a
 * fixed video: searches keep working as videos come and go.
 */
function howToLinks(recipe) {
  const query = encodeURIComponent(`${recipe.title} recipe`);
  const links = [
    ['Watch how to make it', `https://www.youtube.com/results?search_query=${query}`],
    ['Search the web', `https://www.google.com/search?q=${query}`],
  ];
  const original = safeUrl(recipe.sourceUrl);
  if (original) links.unshift(['Open the original', original]);

  return `<div class="how-to">${links
    .map(
      ([label, href]) =>
        `<a class="link-btn" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`,
    )
    .join('')}</div>`;
}

/**
 * A numbered recipe tag. The number identifies the recipe; the colour is a
 * visual shortcut only — several recipes can sit on one grocery line, and
 * colour alone is not reliable for every pair.
 */
function tag(number, color, label) {
  return (
    `<span class="tag" style="--tag-color:${esc(color)}" title="${esc(label)}">` +
    `<span class="tag-num">${esc(number)}</span>` +
    `<span class="tag-label">${esc(label)}</span></span>`
  );
}

function sourceNum(number, color, label) {
  return (
    `<span class="src-num" style="--tag-color:${esc(color)}" title="${esc(label)}" ` +
    `role="img" aria-label="${esc(`for ${label}`)}">${esc(number)}</span>`
  );
}

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

/** Promise-based confirm, so destructive actions always take two taps. */
function confirmAction(message, yesLabel = 'Yes, do it') {
  return new Promise((resolve) => {
    const modal = $('#confirm');
    $('#confirm-text').textContent = message;
    $('#confirm-yes').textContent = yesLabel;
    modal.hidden = false;

    const done = (answer) => {
      modal.hidden = true;
      $('#confirm-yes').removeEventListener('click', onYes);
      $('#confirm-no').removeEventListener('click', onNo);
      modal.removeEventListener('click', onBackdrop);
      resolve(answer);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    const onBackdrop = (event) => {
      if (event.target === modal) done(false);
    };

    $('#confirm-yes').addEventListener('click', onYes);
    $('#confirm-no').addEventListener('click', onNo);
    modal.addEventListener('click', onBackdrop);
  });
}

// Which category chip is active on each screen ('' means All).
let vaultCategory = '';
let planCategory = '';

// ---------------------------------------------------------------------------
// Which sections you left folded up
// ---------------------------------------------------------------------------

/**
 * Kept in its own localStorage key rather than in the main store: it's a
 * per-device display preference, not data worth putting in a backup. Every
 * access is wrapped because private browsing can make storage throw.
 */
const UI_KEY = 'mealPlanner.ui';

function readUiPrefs() {
  try {
    return JSON.parse(window.localStorage.getItem(UI_KEY) || '{}') || {};
  } catch (err) {
    return {};
  }
}

let uiPrefs = readUiPrefs();

function setCollapsed(id, collapsed) {
  uiPrefs[id] = collapsed;
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify(uiPrefs));
  } catch (err) {
    /* preference simply won't persist */
  }
}

function isCollapsed(id, fallback = false) {
  return typeof uiPrefs[id] === 'boolean' ? uiPrefs[id] : fallback;
}

/** Wire a <details> so its open/closed state is remembered. */
function rememberSection(selector, defaultCollapsed = false) {
  const el = $(selector);
  if (!el) return;
  el.open = !isCollapsed(el.id, defaultCollapsed);
  el.addEventListener('toggle', () => setCollapsed(el.id, !el.open));
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function showTab(name) {
  $$('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `tab-${name}`);
  });
  if (name === 'list') renderList();
  if (name === 'plan') renderPlan();
  window.scrollTo({ top: 0 });
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

$$('.seg').forEach((seg) =>
  seg.addEventListener('click', () => {
    $$('.seg').forEach((s) => {
      s.classList.toggle('is-active', s === seg);
      s.setAttribute('aria-selected', s === seg ? 'true' : 'false');
    });
    $('#form-url').classList.toggle('is-active', seg.dataset.src === 'url');
    $('#form-manual').classList.toggle('is-active', seg.dataset.src === 'manual');
    $('#form-review').hidden = true;
  }),
);

// ---------------------------------------------------------------------------
// Shared markup
// ---------------------------------------------------------------------------

function categoryBar(selected, counts, total) {
  const chip = (value, label, count) =>
    `<button class="cat ${selected === value ? 'is-on' : ''}" type="button" data-cat="${esc(value)}"
      aria-pressed="${selected === value}">${esc(label)}<span class="cat-count">${count}</span></button>`;
  return (
    chip('', 'All', total) +
    counts.map((c) => chip(c.name, c.name, c.count)).join('')
  );
}

function recipeMarkup(recipe, servingsPerMeal, options = {}) {
  const scaled = g.scaledIngredientLines(recipe, servingsPerMeal);
  const factor = servingsPerMeal / Math.max(1, recipe.baseServings);
  const rounded = Math.round(factor * 100) / 100;

  const lines = (list) => list.map((line) => `<li>${esc(line)}</li>`).join('');
  const mainBlock = scaled.main.length
    ? `<p class="sub-head">Main ingredients</p><ul class="ing-list">${lines(scaled.main)}</ul>`
    : '';
  const seasonBlock = scaled.seasonings.length
    ? `<p class="sub-head">Seasonings and condiments</p><ul class="ing-list">${lines(scaled.seasonings)}</ul>`
    : '';
  const sourceLink = howToLinks(recipe);

  const rawMain = [...recipe.mainIngredients].map((i) => i.raw || i.name || '').join('\n');
  const rawSeasonings = [...recipe.seasonings].map((i) => i.raw || i.name || '').join('\n');
  const descBlock = recipe.description
    ? `<p class="recipe-desc">${esc(recipe.description)}</p>`
    : '';
  const lead = options.tag ? `<div class="legend">${options.tag}</div>` : '';

  const categoryOptions = categorySelectOptions(recipe.category);

  return `
  <details class="recipe" data-id="${recipe.id}">
    <summary>
      <div class="recipe-head"><span class="recipe-name">${esc(recipe.title)}</span></div>
      ${descBlock}
      <div class="recipe-meta">
        <span class="cat-tag">${esc(recipe.category || 'Other')}</span>
        <span>Makes ${recipe.baseServings} &middot; shown for ${servingsPerMeal} (&times;${rounded})</span>
      </div>
    </summary>
    ${lead}
    ${sourceLink}
    ${mainBlock}${seasonBlock}
    <details class="card" style="margin-top:0.7rem">
      <summary>Edit this recipe</summary>
      <label>Recipe name<input type="text" data-f="title" value="${esc(recipe.title)}" /></label>
      <label>Category<select data-f="category">${categoryOptions}</select></label>
      <label>Short description<input type="text" data-f="description" value="${esc(recipe.description || '')}" /></label>
      <label>Servings the original makes<input type="number" min="1" max="100" step="1" data-f="servings" value="${recipe.baseServings}" /></label>
      <label>Main ingredients <span class="hint-inline">one per line</span>
        <textarea rows="8" data-f="main">${esc(rawMain)}</textarea></label>
      <label>Seasonings and condiments <span class="hint-inline">one per line</span>
        <textarea rows="4" data-f="seasonings">${esc(rawSeasonings)}</textarea></label>
      <label>Link to the original<input type="url" data-f="url" value="${esc(recipe.sourceUrl)}" /></label>
      <button class="btn btn-primary" type="button" data-act="save">Save changes</button>
      <button class="btn btn-danger-ghost" type="button" data-act="delete">Delete this recipe</button>
    </details>
  </details>`;
}

function categorySelectOptions(selected) {
  const all = [...CATEGORIES];
  if (selected && !all.includes(selected)) all.push(selected);
  if (!all.includes(store.UNCATEGORIZED)) all.push(store.UNCATEGORIZED);
  return all
    .map(
      (c) =>
        `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`,
    )
    .join('');
}

/** Shared handler for the edit/delete buttons, used on two screens. */
async function handleRecipeAction(event) {
  const button = event.target.closest('button[data-act]');
  if (!button) return;
  const host = button.closest('.recipe');
  const id = Number(host.dataset.id);
  const field = (name) => host.querySelector(`[data-f="${name}"]`);

  if (button.dataset.act === 'save') {
    const title = field('title').value.trim();
    if (!title) {
      toast('Give the recipe a name first');
      return;
    }
    store.updateRecipe(id, {
      title,
      category: field('category').value,
      description: field('description').value,
      baseServings: field('servings').value,
      sourceUrl: field('url').value,
      mainIngredients: g.parseIngredientLines(field('main').value),
      seasonings: g.parseIngredientLines(field('seasonings').value),
    });
    renderAll();
    toast('Recipe updated');
  }

  if (button.dataset.act === 'delete') {
    const recipe = store.getRecipe(id);
    const ok = await confirmAction(
      `Delete "${recipe ? recipe.title : 'this recipe'}"? This can't be undone.`,
      'Delete',
    );
    if (!ok) return;
    store.deleteRecipe(id);
    renderAll();
    toast('Recipe deleted');
  }
}

// ---------------------------------------------------------------------------
// Screen 1 — recipe vault
// ---------------------------------------------------------------------------

function renderVault() {
  const week = store.getWeek();
  const total = store.countRecipes();
  const term = $('#in-search').value;
  const counts = store.categoriesInUse();

  // A category can disappear after a deletion.
  if (vaultCategory && !counts.some((c) => c.name === vaultCategory)) vaultCategory = '';

  const shown = store.searchRecipes(term, vaultCategory);

  $('#vault-empty').hidden = total > 0;
  $('#vault-tools').hidden = total === 0;
  $('#seed-blurb').textContent =
    `Add one above, or start with the ${store.libraryCount()} built-in recipes ` +
    'so you can try the planner right away.';

  const missing = store.libraryCount() - store.listRecipes().filter((r) => r.description).length;
  const seedMore = $('#seed-more');
  seedMore.hidden = total === 0 || missing <= 0;
  $('#seed-more-text').textContent =
    `There are ${store.libraryCount()} recipes built in, across ${CATEGORIES.length} categories. ` +
    'Adding them again only brings in the ones you are missing.';

  $('#catbar').innerHTML = categoryBar(vaultCategory, counts, total);

  $('#vault-count').textContent = term.trim()
    ? `${shown.length} of ${total} recipes match "${term.trim()}"`
    : vaultCategory
      ? `${plural(shown.length, 'recipe')} in ${vaultCategory}`
      : `${plural(total, 'recipe')} saved on this device`;

  $('#recipe-list').innerHTML = shown.length
    ? shown.map((r) => recipeMarkup(r, week.servingsPerMeal)).join('')
    : total
      ? '<p class="hint">Nothing matches that search.</p>'
      : '';
}

$('#recipe-list').addEventListener('click', handleRecipeAction);

$('#catbar').addEventListener('click', (event) => {
  const chip = event.target.closest('.cat');
  if (!chip) return;
  vaultCategory = chip.dataset.cat;
  renderVault();
});

$('#in-search').addEventListener('input', renderVault);

function seedAll() {
  const added = store.seedSampleRecipes();
  renderAll();
  toast(added ? `Added ${plural(added, 'recipe')}` : 'You already have them all');
}

$('#btn-seed').addEventListener('click', seedAll);
$('#btn-seed-more').addEventListener('click', seedAll);

// ---------------------------------------------------------------------------
// Adding recipes — manual
// ---------------------------------------------------------------------------

$('#form-manual').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = $('#mn-title').value.trim();
  const mainText = $('#mn-main').value;
  if (!title || !mainText.trim()) {
    toast('A name and at least one ingredient are needed');
    return;
  }

  let main = g.parseIngredientLines(mainText);
  let seasonings = g.parseIngredientLines($('#mn-seasonings').value);
  if ($('#mn-autosort').checked) {
    const moved = main.filter((i) => i.aisle === AISLE_SEASONINGS);
    main = main.filter((i) => i.aisle !== AISLE_SEASONINGS);
    seasonings = [...seasonings, ...moved];
  }

  store.addRecipe({
    title,
    category: $('#mn-category').value,
    description: $('#mn-description').value,
    baseServings: $('#mn-servings').value,
    sourceUrl: $('#mn-url').value,
    mainIngredients: main,
    seasonings,
  });

  $('#form-manual').reset();
  $('#mn-servings').value = 4;
  $('#mn-autosort').checked = true;
  $('#add-recipe').open = false;
  renderAll();
  toast(`Saved "${title}"`);
});

// ---------------------------------------------------------------------------
// Adding recipes — import from a link
// ---------------------------------------------------------------------------

const SCRAPE_ENDPOINTS = ['/api/scrape', '/.netlify/functions/scrape-recipe'];

async function callScraper(url) {
  let lastError = null;
  for (const endpoint of SCRAPE_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (response.status === 404) {
        lastError = 'missing';
        continue; // this deployment has no function; try the other path
      }
      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError === 'missing') {
    return {
      ok: false,
      error: "Importing from a link isn't switched on for this site.",
      hint: 'Use "Type it in" instead — it only takes a moment. (The fix is in the README under "If importing from a link doesn’t work".)',
    };
  }
  return {
    ok: false,
    error: "Couldn't reach the import service.",
    hint: 'Check your internet connection, or type the recipe in instead.',
  };
}

function setStatus(el, kind, html) {
  el.hidden = false;
  el.className = `status banner banner-${kind}`;
  el.innerHTML = html;
}

$('#form-url').addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = $('#in-url').value.trim();
  const status = $('#url-status');
  if (!url) {
    setStatus(status, 'err', 'Paste a recipe link first.');
    return;
  }

  const button = $('#form-url button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Reading the page...';
  setStatus(status, 'ok', 'Fetching the recipe...');

  const result = await callScraper(url);

  button.disabled = false;
  button.textContent = 'Get the ingredients';

  if (!result.ok) {
    setStatus(
      status,
      'err',
      `<strong>${esc(result.error)}</strong>${result.hint ? `<br />${esc(result.hint)}` : ''}`,
    );
    $('#form-review').hidden = true;
    return;
  }

  status.hidden = true;
  const lines = result.rawLines || [];
  const warnings = (result.warnings || []).map((w) => `<br />${esc(w)}`).join('');
  $('#review-note').innerHTML =
    `Found <strong>${lines.length}</strong> ingredients. ` +
    `Check them over, then save.${warnings}`;

  // The function returns raw ingredient text; parsing and the
  // main-vs-seasoning split happen here, with the same code the rest of the
  // app uses.
  const parsed = lines.map(g.parseIngredient);
  $('#rv-title').value = result.title || '';
  $('#rv-category').innerHTML = categorySelectOptions(CATEGORIES[0]);
  $('#rv-description').value = '';
  $('#rv-servings').value = result.baseServings || 4;
  $('#rv-url').value = result.sourceUrl || url;
  $('#rv-main').value = parsed
    .filter((i) => i.aisle !== AISLE_SEASONINGS)
    .map((i) => i.raw)
    .join('\n');
  $('#rv-seasonings').value = parsed
    .filter((i) => i.aisle === AISLE_SEASONINGS)
    .map((i) => i.raw)
    .join('\n');

  $('#form-url').classList.remove('is-active');
  $('#form-review').hidden = false;
  $('#form-review').classList.add('is-active');
  $('#form-review').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#form-review').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = $('#rv-title').value.trim();
  if (!title) {
    toast('Give the recipe a name first');
    return;
  }
  store.addRecipe({
    title,
    category: $('#rv-category').value,
    description: $('#rv-description').value,
    baseServings: $('#rv-servings').value,
    sourceUrl: $('#rv-url').value,
    mainIngredients: g.parseIngredientLines($('#rv-main').value),
    seasonings: g.parseIngredientLines($('#rv-seasonings').value),
  });
  closeReview();
  $('#in-url').value = '';
  $('#add-recipe').open = false;
  renderAll();
  toast(`Saved "${title}"`);
});

function closeReview() {
  $('#form-review').hidden = true;
  $('#form-review').classList.remove('is-active');
  $('#form-url').classList.add('is-active');
  $('#url-status').hidden = true;
}

$('#rv-cancel').addEventListener('click', closeReview);

// ---------------------------------------------------------------------------
// Screen 2 — weekly planner
// ---------------------------------------------------------------------------

/**
 * Plain-English statement of the portion maths, so the grocery totals are
 * never a mystery: people + spare portions = servings per meal, and that
 * times the number of meals is the total food being bought.
 */
function servingsSentence(week, mealCount) {
  const per = week.servingsPerMeal;
  const extraBit = week.extraServings
    ? ` plus ${plural(week.extraServings, 'spare portion')}`
    : '';
  if (!mealCount) {
    return (
      `<strong>${plural(week.people, 'person')}</strong>${extraBit} means every ` +
      `recipe is scaled to <strong>${plural(per, 'serving')}</strong>. ` +
      'Pick some meals to see the full total.'
    );
  }
  return (
    `<strong>${plural(week.people, 'person')}</strong>${extraBit} &times; ` +
    `<strong>${plural(mealCount, 'meal')}</strong> = each recipe scaled to ` +
    `<strong>${plural(per, 'serving')}</strong>, ` +
    `<strong>${plural(per * mealCount, 'serving')}</strong> of food in total.`
  );
}

function renderPlan() {
  const recipes = store.listRecipes();
  const week = store.getWeek();

  $('#plan-empty').hidden = recipes.length > 0;
  $('#plan-body').hidden = recipes.length === 0;
  if (!recipes.length) return;

  $('#in-servings').value = week.people;
  $('#in-extra').value = week.extraServings;

  const randomInput = $('#in-random');
  randomInput.max = Math.max(1, recipes.length);
  if (Number(randomInput.value) > recipes.length) randomInput.value = recipes.length;

  const colors = g.assignColors(week.selected);
  const numbers = g.assignNumbers(week.selected);
  const plan = store.getRecipesByIds(week.selected);

  // Kept short: this sits on one line beside the heading on a phone.
  $('#people-meta').textContent = `${plural(week.people, 'person')} · ${
    week.servingsPerMeal
  } each`;
  $('#plan-count').textContent = week.selected.length
    ? plural(week.selected.length, 'meal')
    : 'none yet';
  $('#details-meta').textContent = plan.length ? `${plan.length} to cook` : 'nothing yet';
  $('#servings-summary').innerHTML = servingsSentence(week, week.selected.length);

  // --- the meals you've chosen, as a plain readable list ---
  $('#plan-selected').innerHTML = plan.length
    ? `<div class="sel-list">${plan
        .map(
          (r) => `<div class="sel-row" data-id="${r.id}">
            <span class="tag-num" style="--tag-color:${colors[r.id]}">${numbers[r.id]}</span>
            <span class="sel-main">
              <span class="sel-title">${esc(r.title)}</span>
              <span class="sel-meta">${esc(r.category || 'Other')} &middot; makes ${r.baseServings}, cooking ${week.servingsPerMeal}</span>
            </span>
            <button class="sel-remove" type="button" data-remove="${r.id}"
              aria-label="Remove ${esc(r.title)}">&times;</button>
          </div>`,
        )
        .join('')}</div>`
    : '<p class="hint">No meals picked yet. Open "Add or change meals" below, or let the app choose for you.</p>';

  // --- the picker: a searchable list, not a wall of bubbles ---
  const counts = store.categoriesInUse();
  if (planCategory && !counts.some((c) => c.name === planCategory)) planCategory = '';
  $('#plan-catbar').innerHTML = categoryBar(planCategory, counts, recipes.length);

  const term = ($('#in-plan-search').value || '').trim();
  const visible = store.searchRecipes(term, planCategory);
  $('#picker-meta').textContent = `${recipes.length} to choose from`;

  $('#recipe-rows').innerHTML = visible.length
    ? visible
        .map((recipe) => {
          const on = week.selected.includes(recipe.id);
          const mark = on
            ? `<span class="pick-mark" style="--tag-color:${colors[recipe.id]}">${numbers[recipe.id]}</span>`
            : '<span class="pick-mark"></span>';
          return `<button class="pick-row ${on ? 'is-on' : ''}" type="button" data-id="${recipe.id}"
            aria-pressed="${on}">${mark}
            <span class="pick-main">
              <span class="pick-title">${esc(recipe.title)}</span>
              <span class="pick-meta">${esc(recipe.category || 'Other')} &middot; makes ${recipe.baseServings}${
                recipe.description ? ` &middot; ${esc(recipe.description)}` : ''
              }</span>
            </span>
          </button>`;
        })
        .join('')
    : '<p class="pick-empty">Nothing matches that search.</p>';

  // --- the full scaled ingredients for each chosen meal ---
  if (!plan.length) {
    $('#plan-details').innerHTML =
      '<p class="hint">Pick some meals and their scaled ingredients will show up here.</p>';
    return;
  }

  const legend = plan
    .map((r) => tag(numbers[r.id], colors[r.id], g.shortLabel(r.title, 24)))
    .join('');

  $('#plan-details').innerHTML =
    `<div class="legend">${legend}</div>
     <p class="hint">Each number and colour follows its recipe onto the grocery list.</p>` +
    plan
      .map((r) =>
        recipeMarkup(r, week.servingsPerMeal, {
          tag: tag(numbers[r.id], colors[r.id], g.shortLabel(r.title, 24)),
        }),
      )
      .join('');
}

$('#recipe-rows').addEventListener('click', (event) => {
  const row = event.target.closest('.pick-row');
  if (!row) return;
  // Keep the scroll position inside the picker: re-rendering resets it.
  const list = $('#recipe-rows');
  const offset = list.scrollTop;
  store.toggleSelected(row.dataset.id);
  renderPlan();
  list.scrollTop = offset;
});

$('#plan-selected').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove]');
  if (!button) return;
  store.toggleSelected(button.dataset.remove);
  renderPlan();
});

$('#in-plan-search').addEventListener('input', renderPlan);

$('#plan-catbar').addEventListener('click', (event) => {
  const chip = event.target.closest('.cat');
  if (!chip) return;
  planCategory = chip.dataset.cat;
  renderPlan();
});

$('#plan-details').addEventListener('click', handleRecipeAction);

function bumpServings(delta) {
  store.setServings(Number($('#in-servings').value || 2) + delta);
  renderPlan();
}

$('#srv-minus').addEventListener('click', () => bumpServings(-1));
$('#srv-plus').addEventListener('click', () => bumpServings(1));
$('#in-servings').addEventListener('change', () => {
  store.setServings($('#in-servings').value);
  renderPlan();
});

function bumpExtra(delta) {
  store.setExtraServings(Number($('#in-extra').value || 0) + delta);
  renderPlan();
}

$('#ext-minus').addEventListener('click', () => bumpExtra(-1));
$('#ext-plus').addEventListener('click', () => bumpExtra(1));
$('#in-extra').addEventListener('change', () => {
  store.setExtraServings($('#in-extra').value);
  renderPlan();
});

function bumpRandom(delta) {
  const input = $('#in-random');
  const max = Math.max(1, store.countRecipes());
  input.value = Math.min(max, Math.max(1, Number(input.value || 1) + delta));
}

$('#rnd-minus').addEventListener('click', () => bumpRandom(-1));
$('#rnd-plus').addEventListener('click', () => bumpRandom(1));

$('#btn-random').addEventListener('click', async () => {
  const week = store.getWeek();
  if (week.selected.length || Object.keys(week.checked).length) {
    const ok = await confirmAction(
      'Replace the current plan with a random pick? Any ticked items will be cleared.',
      'Pick for me',
    );
    if (!ok) return;
  }
  const picked = store.randomizeWeek($('#in-random').value);
  renderAll();
  toast(`Picked ${plural(picked.length, 'meal')}`);
});

// ---------------------------------------------------------------------------
// Screen 3 — grocery list
// ---------------------------------------------------------------------------

let lastItems = [];

function progressText(done, total, week, mealCount) {
  return (
    `<strong>${done} of ${total}</strong> in the cart &middot; ` +
    `${plural(mealCount, 'meal')} &middot; ${plural(week.servingsPerMeal, 'serving')} each`
  );
}

function renderList() {
  const week = store.getWeek();
  const plan = store.getRecipesByIds(week.selected);
  const colors = g.assignColors(week.selected);
  const numbers = g.assignNumbers(week.selected);
  const titles = {};
  plan.forEach((r) => {
    titles[r.id] = r.title;
  });

  const items = g.consolidate(plan, week.servingsPerMeal, week.household);
  lastItems = items;

  $('#list-empty').hidden = items.length > 0;
  $('#list-progress').hidden = items.length === 0;

  if (items.length) {
    const done = items.filter((i) => week.checked[i.key]).length;
    $('#progress-bar').style.width = `${Math.round((done / items.length) * 100)}%`;
    $('#progress-text').innerHTML = progressText(done, items.length, week, plan.length);
    $('#list-summary').innerHTML = servingsSentence(week, plan.length);
    $('#list-legend').innerHTML = plan
      .map((r) => tag(numbers[r.id], colors[r.id], g.shortLabel(r.title, 24)))
      .join('');
  }

  $('#grocery-list').innerHTML = g
    .groupByAisle(items)
    .map(([aisle, group]) => {
      const ticked = group.filter((i) => week.checked[i.key]).length;
      const cleared = ticked === group.length;
      const sectionId = `aisle:${aisle}`;
      const rows = group
        .map((item) => {
          const checked = Boolean(week.checked[item.key]);
          const marks = item.sources
            .map((rid) => sourceNum(numbers[rid], colors[rid] || 'var(--muted)', titles[rid] || 'Recipe'))
            .join('');
          const extra = item.household
            ? '<span class="src-num src-num-extra" title="Added by you" role="img" aria-label="Added by you">+</span>'
            : '';
          const amount = item.amount ? `<span class="gl-amount">${esc(item.amount)}</span>` : '';
          const note = item.notes.length
            ? `<span class="gl-note">${esc(item.notes.slice(0, 2).join('; '))}</span>`
            : '';
          return `<label class="gl-item ${checked ? 'is-done' : ''}" data-key="${esc(item.key)}">
            <input type="checkbox" ${checked ? 'checked' : ''} />
            <span class="gl-text">${amount}${esc(item.name)}${marks}${extra}${note}</span>
          </label>`;
        })
        .join('');
      return `<details class="aisle-group ${cleared ? 'is-cleared' : ''}"
        data-section="${esc(sectionId)}" ${isCollapsed(sectionId) ? '' : 'open'}>
        <summary class="aisle">
          <span class="aisle-name">${esc(aisle)}</span>
          <span class="aisle-count">${
            ticked ? `${ticked} of ${group.length} done` : plural(group.length, 'item')
          }</span>
        </summary>${rows}</details>`;
    })
    .join('');

  // `toggle` doesn't bubble, so each aisle needs its own listener. They are
  // re-created on every render, hence re-binding here rather than delegating.
  $$('#grocery-list .aisle-group').forEach((el) => {
    el.addEventListener('toggle', () => setCollapsed(el.dataset.section, !el.open));
  });

  renderExtras(week);
}

/** Refresh one aisle's "3 of 9 done" label after a tick, without re-rendering. */
function refreshAisle(group) {
  if (!group) return;
  const rows = Array.from(group.querySelectorAll('.gl-item'));
  const ticked = rows.filter((r) => r.classList.contains('is-done')).length;
  const label = group.querySelector('.aisle-count');
  if (label) {
    label.textContent = ticked ? `${ticked} of ${rows.length} done` : plural(rows.length, 'item');
  }
  group.classList.toggle('is-cleared', rows.length > 0 && ticked === rows.length);
}

function renderExtras(week) {
  const list = $('#extra-list');
  if (!week.household.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML =
    '<p class="sub-head">Added by you</p>' +
    week.household
      .map((extra, index) => {
        const amount = g.formatAmount(extra.quantity, extra.unit);
        const label = `${amount} ${extra.name}`.trim();
        return `<div class="extra-row">
          <div class="extra-main">
            <span class="extra-name">${esc(label)}</span>
            <span class="extra-aisle">${esc(extra.aisle)}</span>
          </div>
          <button class="btn btn-small btn-danger-ghost" type="button" data-index="${index}">Remove</button>
        </div>`;
      })
      .join('');
}

/**
 * Tick / untick. Updates just the one row rather than re-rendering, so your
 * scroll position doesn't jump while you're halfway down an aisle.
 */
$('#grocery-list').addEventListener('change', (event) => {
  const input = event.target;
  if (input.type !== 'checkbox') return;
  const row = input.closest('.gl-item');
  if (!row) return;

  store.setItemChecked(row.dataset.key, input.checked);
  row.classList.toggle('is-done', input.checked);
  refreshAisle(row.closest('.aisle-group'));

  const week = store.getWeek();
  const done = lastItems.filter((i) => week.checked[i.key]).length;
  const total = lastItems.length;
  if (total) {
    $('#progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
    $('#progress-text').innerHTML = progressText(done, total, week, week.selected.length);
  }
});

$('#extra-list').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-index]');
  if (!button) return;
  store.removeHouseholdItem(Number(button.dataset.index));
  renderList();
});

$('#form-extra').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('#in-extra-item').value.trim();
  if (!text) return;
  store.addHouseholdItem(text, $('#in-extra-aisle').value);
  $('#in-extra-item').value = '';
  renderList();
  toast('Added to the list');
});

$('#btn-uncheck').addEventListener('click', async () => {
  const ok = await confirmAction('Untick every item on the list?', 'Untick all');
  if (!ok) return;
  store.clearChecked();
  renderList();
  toast('All items unticked');
});

$('#btn-reset').addEventListener('click', async () => {
  const ok = await confirmAction(
    'Start a new week? This clears the meal plan, your added items and every tick. Your saved recipes are kept.',
    'Start new week',
  );
  if (!ok) return;
  store.resetWeek();
  renderAll();
  toast('Ready for a new week');
});

$('#btn-copy').addEventListener('click', async () => {
  const week = store.getWeek();
  const plan = store.getRecipesByIds(week.selected);
  const titles = {};
  plan.forEach((r) => {
    titles[r.id] = r.title;
  });
  const text = g.plainTextList(lastItems, titles, g.assignNumbers(week.selected), week.checked);
  if (!text) {
    toast('Nothing to copy yet');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('List copied');
  } catch (err) {
    // Older iOS Safari and any non-secure context land here.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand && document.execCommand('copy');
    document.body.removeChild(area);
    toast(copied ? 'List copied' : 'Copying is blocked in this browser');
  }
});

// ---------------------------------------------------------------------------
// Backup / restore / wipe
// ---------------------------------------------------------------------------

$('#btn-settings').addEventListener('click', () => {
  showTab('vault');
  const backup = $('#backup');
  backup.open = true;
  backup.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#btn-export').addEventListener('click', () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `meal-planner-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(
    $('#backup-status'),
    'ok',
    `Backup saved as <strong>meal-planner-backup-${stamp}.json</strong>. Email it to yourself to keep it safe.`,
  );
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());

$('#file-import').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const text = await file.text();
  event.target.value = '';

  const ok = await confirmAction(
    'Restoring replaces the recipes and plan currently on this device. Continue?',
    'Restore',
  );
  if (!ok) return;

  const result = store.importJson(text, 'replace');
  if (!result.ok) {
    setStatus($('#backup-status'), 'err', esc(result.error));
    return;
  }
  setStatus($('#backup-status'), 'ok', `Restored ${plural(result.recipes, 'recipe')}.`);
  renderAll();
  toast('Backup restored');
});

$('#btn-wipe').addEventListener('click', async () => {
  const ok = await confirmAction(
    'Delete every recipe and your current list from this device? This cannot be undone — export a backup first if you might want them later.',
    'Delete everything',
  );
  if (!ok) return;
  store.clearAll();
  vaultCategory = '';
  planCategory = '';
  renderAll();
  toast('Everything deleted');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function renderAll() {
  renderVault();
  renderPlan();
  renderList();
}

function init() {
  $('#in-extra-aisle').innerHTML = AISLES.map(
    (aisle) =>
      `<option value="${esc(aisle)}" ${aisle === AISLE_HOUSEHOLD ? 'selected' : ''}>${esc(aisle)}</option>`,
  ).join('');
  $('#mn-category').innerHTML = categorySelectOptions(CATEGORIES[0]);
  $('#rv-category').innerHTML = categorySelectOptions(CATEGORIES[0]);

  $('#storage-warning').hidden = store.storageAvailable;

  // Sections remember whether you left them folded. "Can't decide?" starts
  // closed because most weeks you pick meals yourself.
  rememberSection('#card-people');
  rememberSection('#card-meals');
  // The picker starts open when there's nothing planned yet, so a new week
  // doesn't begin with the one thing you need hidden behind a tap.
  rememberSection('#card-picker', store.getWeek().selected.length > 0);
  rememberSection('#card-random', true);
  rememberSection('#card-plan-details');
  rememberSection('#add-recipe', true);
  rememberSection('#backup', true);

  renderAll();
  store.requestPersistence();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* offline support is a bonus, not a requirement */
      });
    });
  }
}

init();
