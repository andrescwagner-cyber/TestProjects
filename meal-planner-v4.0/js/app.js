/**
 * app.js — UI controller.
 *
 * Owns the DOM: the three tabs, the slide-up sheets and every control.
 * Persistence lives in `store`, ingredient maths in `grocery`. Each screen has
 * one render function (renderRecipes / renderPlan / renderList) that redraws
 * it from the store, so there is a single source of truth for what's shown.
 *
 * UX rules this file follows:
 *  - Destructive actions are undoable from the toast rather than guarded by
 *    "are you sure?" dialogs. Only wiping the device and restoring a backup,
 *    which replace everything, still ask first.
 *  - Ticking an item never re-renders the list, so nothing jumps under your
 *    thumb mid-shop.
 */

import * as store from './store.js';
import * as g from './grocery.js';
import { AISLES, AISLE_SEASONINGS, AISLE_HOUSEHOLD } from './data.js';
import { CATEGORIES } from './recipes.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
const plural = (n, word) => `${n} ${n === 1 ? word : IRREGULAR[word] || `${word}s`}`;

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

const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** A light tap on phones that support it (Android); silently nothing elsewhere. */
function haptic() {
  try {
    if (navigator.vibrate) navigator.vibrate(8);
  } catch (err) {
    /* unsupported */
  }
}

// ---------------------------------------------------------------------------
// Visual identity for categories and aisles
// ---------------------------------------------------------------------------

/** Each category gets an emoji and a hue for its tile, so the list scans by shape and colour. */
const CATEGORY_META = {
  Chicken: { emoji: '🍗', hue: 32 },
  'Beef & Pork': { emoji: '🥩', hue: 6 },
  Seafood: { emoji: '🐟', hue: 200 },
  Vegetarian: { emoji: '🥦', hue: 120 },
  Pasta: { emoji: '🍝', hue: 45 },
  'Soups & Stews': { emoji: '🍲', hue: 18 },
  Breakfast: { emoji: '🍳', hue: 52 },
  'Salads & Bowls': { emoji: '🥗', hue: 95 },
};
const catMeta = (category) => CATEGORY_META[category] || { emoji: '🍽️', hue: 35 };

function tile(recipe, cls = '', inner = '') {
  const meta = catMeta(recipe.category);
  return `<span class="tile ${cls}" style="--hue:${meta.hue}" aria-hidden="true">${meta.emoji}${inner}</span>`;
}

/** Shorter, friendlier aisle names. The stored aisle values stay unchanged. */
const AISLE_META = {
  Produce: { emoji: '🥬', label: 'Produce' },
  'Meat & Seafood': { emoji: '🥩', label: 'Meat & Seafood' },
  'Dairy & Refrigerated': { emoji: '🧀', label: 'Dairy & Fridge' },
  'Dry Pantry': { emoji: '🥫', label: 'Pantry' },
  [AISLE_SEASONINGS]: { emoji: '🧂', label: 'Spices & Sauces' },
  [AISLE_HOUSEHOLD]: { emoji: '🧻', label: 'Household & Other' },
};
const aisleMeta = (aisle) => AISLE_META[aisle] || { emoji: '🛒', label: aisle };

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const todayIndex = () => (new Date().getDay() + 6) % 7;

function weekOfLabel() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - todayIndex());
  return `Week of ${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// ---------------------------------------------------------------------------
// Per-device preferences (theme, last tab, folded aisles, list options)
// ---------------------------------------------------------------------------

/**
 * Kept in its own localStorage key rather than in the main store: these are
 * display preferences, not data worth putting in a backup. Every access is
 * wrapped because private browsing can make storage throw.
 */
const UI_KEY = 'mealPlanner.ui';

let prefs = (() => {
  try {
    return JSON.parse(window.localStorage.getItem(UI_KEY) || '{}') || {};
  } catch (err) {
    return {};
  }
})();

function setPref(key, value) {
  prefs[key] = value;
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify(prefs));
  } catch (err) {
    /* preference simply won't persist */
  }
}

const isCollapsed = (id) => prefs[id] === true;

// ---------------------------------------------------------------------------
// Toast with optional Undo
// ---------------------------------------------------------------------------

let toastTimer = null;
let toastUndo = null;

/**
 * @param {string} message
 * @param {{undo?: string}} [options] undo: a store.snapshot() to restore
 */
function toast(message, options = {}) {
  const el = $('#toast');
  $('#toast-text').textContent = message;
  toastUndo = options.undo || null;
  $('#toast-action').hidden = !toastUndo;
  el.hidden = false;
  // Restart the entrance animation for back-to-back toasts.
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastUndo ? 5000 : 2400);
}

function hideToast() {
  $('#toast').hidden = true;
  toastUndo = null;
}

$('#toast-action').addEventListener('click', () => {
  if (toastUndo && store.restoreSnapshot(toastUndo)) {
    renderAll();
    refreshOpenSheets();
    hideToast();
    toast('Undone');
  }
});

// ---------------------------------------------------------------------------
// Confirm (only for replace-everything actions)
// ---------------------------------------------------------------------------

function confirmAction({ title, text, yes = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    const dialog = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    const yesBtn = $('#confirm-yes');
    yesBtn.textContent = yes;
    yesBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;

    const done = (answer) => {
      dialog.close();
      yesBtn.removeEventListener('click', onYes);
      $('#confirm-no').removeEventListener('click', onNo);
      dialog.removeEventListener('cancel', onNo);
      resolve(answer);
    };
    const onYes = () => done(true);
    const onNo = (event) => {
      if (event) event.preventDefault();
      done(false);
    };
    yesBtn.addEventListener('click', onYes);
    $('#confirm-no').addEventListener('click', onNo);
    dialog.addEventListener('cancel', onNo);
    dialog.showModal();
  });
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function syncScrollLock() {
  document.body.style.overflow = $$('dialog.sheet[open]').length ? 'hidden' : '';
}

function openSheet(dialog) {
  if (!dialog.open) dialog.showModal();
  // showModal focuses the first button, which paints a focus ring on touch
  // devices. Focus the sheet itself instead; Tab still moves into it.
  dialog.focus({ preventScroll: true });
  syncScrollLock();
}

function closeSheet(dialog) {
  if (!dialog.open || dialog.classList.contains('is-closing')) return;
  dialog.classList.add('is-closing');
  setTimeout(() => {
    dialog.classList.remove('is-closing');
    dialog.style.transform = '';
    dialog.close();
    syncScrollLock();
  }, 200);
}

$$('dialog.sheet').forEach((dialog) => {
  // Esc: animate out instead of the browser's instant close.
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSheet(dialog);
  });
  // Tap on the dimmed backdrop closes.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    if (!inside) closeSheet(dialog);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) closeSheet(dialog);
  });

  // Drag the handle or header down to dismiss, like a native sheet.
  let startY = null;
  let dy = 0;
  const grabZone = (target) => target.closest('.sheet-grab, .sheet-head, .sheet-hero, .rd-hero');
  dialog.addEventListener(
    'touchstart',
    (event) => {
      if (!grabZone(event.target) || window.innerWidth >= 700) return;
      startY = event.touches[0].clientY;
      dy = 0;
    },
    { passive: true },
  );
  dialog.addEventListener(
    'touchmove',
    (event) => {
      if (startY === null) return;
      dy = Math.max(0, event.touches[0].clientY - startY);
      dialog.style.transform = `translateY(${dy}px)`;
    },
    { passive: true },
  );
  dialog.addEventListener('touchend', () => {
    if (startY === null) return;
    startY = null;
    if (dy > 90) closeSheet(dialog);
    else dialog.style.transform = '';
  });
});

/** After undo, sheets that show store data need redrawing too. */
function refreshOpenSheets() {
  if ($('#sheet-recipe').open) {
    if (store.getRecipe(detailId)) renderDetail();
    else closeSheet($('#sheet-recipe'));
  }
  if ($('#sheet-picker').open) renderPicker();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS = ['recipes', 'plan', 'list'];

function showTab(name, { scroll = true } = {}) {
  if (!TABS.includes(name)) name = 'recipes';
  $$('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    if (on) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  $$('.view').forEach((view) => view.classList.toggle('is-active', view.id === `view-${name}`));
  setPref('tab', name);
  if (name === 'list') renderList();
  if (name === 'plan') renderPlan();
  if (scroll) window.scrollTo({ top: 0 });
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

document.addEventListener('click', (event) => {
  const go = event.target.closest('[data-go]');
  if (go) {
    $$('dialog.sheet[open]').forEach(closeSheet);
    showTab(go.dataset.go);
  }
  if (event.target.closest('[data-open-settings]')) openSettings();
  if (event.target.closest('[data-open-picker]')) openPicker();
  if (event.target.closest('[data-surprise]')) openSurprise();
  if (event.target.closest('[data-new-recipe]')) openEditor(null);
});

function updateBadges() {
  const week = store.getWeek();
  const planBadge = $('#badge-plan');
  planBadge.hidden = !week.selected.length;
  planBadge.textContent = week.selected.length;
  planBadge.classList.add('badge-quiet');

  const items = currentItems();
  const left = items.filter((i) => !week.checked[i.key]).length;
  const listBadge = $('#badge-list');
  listBadge.hidden = !left;
  listBadge.textContent = left > 99 ? '99+' : left;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function categoryChips(selected, counts, total, { favorites = 0 } = {}) {
  const chip = (value, label, count, extra = '') =>
    `<button class="chip ${extra} ${selected === value ? 'is-on' : ''}" type="button" data-cat="${esc(value)}"
      aria-pressed="${selected === value}">${label}<span class="count">${count}</span></button>`;
  return (
    chip('', 'All', total) +
    (favorites ? chip(store.FAVORITES, `${icon('star')}Favorites`, favorites, 'chip-star') : '') +
    counts.map((c) => chip(c.name, `${catMeta(c.name).emoji} ${esc(c.name)}`, c.count)).join('')
  );
}

function categorySelectOptions(selected) {
  const all = [...CATEGORIES];
  if (selected && !all.includes(selected)) all.push(selected);
  if (!all.includes(store.UNCATEGORIZED)) all.push(store.UNCATEGORIZED);
  return all
    .map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`)
    .join('');
}

const ingredientCount = (r) => r.mainIngredients.length + r.seasonings.length;

// ---------------------------------------------------------------------------
// Screen 1 — Recipes
// ---------------------------------------------------------------------------

let recipeFilter = '';

function renderRecipes() {
  const week = store.getWeek();
  const total = store.countRecipes();
  const favorites = store.countFavorites();
  const term = $('#in-search').value;
  const counts = store.categoriesInUse();

  if (recipeFilter === store.FAVORITES && !favorites) recipeFilter = '';
  if (recipeFilter && recipeFilter !== store.FAVORITES && !counts.some((c) => c.name === recipeFilter)) {
    recipeFilter = '';
  }

  const shown = store.searchRecipes(term, recipeFilter);

  $('#recipes-empty').hidden = total > 0;
  $('#recipes-tools').hidden = total === 0;
  $('#recipes-count').hidden = total === 0;
  $('.search-clear').hidden = !term;
  $('#recipes-eyebrow').textContent = total
    ? `${plural(total, 'recipe')}${favorites ? ` · ${favorites} favorite${favorites === 1 ? '' : 's'}` : ''}`
    : 'Your collection';
  $('#seed-blurb').textContent =
    `Load the ${store.libraryCount()} built-in recipes to try the planner straight away, or add your own.`;

  $('#catbar').innerHTML = categoryChips(recipeFilter, counts, total, { favorites });

  $('#recipes-count').textContent = term.trim()
    ? `${plural(shown.length, 'result')} for "${term.trim()}"`
    : recipeFilter === store.FAVORITES
      ? 'Your favorites'
      : recipeFilter
        ? `${plural(shown.length, 'recipe')} in ${recipeFilter}`
        : 'Tap a recipe for ingredients, or + to add it to this week';

  const planned = new Set(week.selected);
  $('#recipe-list').innerHTML = shown.length
    ? shown
        .map((r) => {
          const on = planned.has(r.id);
          return `<div class="r-card" data-id="${r.id}">
            <button class="r-open" type="button" data-open="${r.id}" aria-label="${esc(r.title)}, view recipe"></button>
            ${tile(r)}
            <div class="r-main">
              <div class="r-title"><span class="t">${esc(r.title)}</span>${r.favorite ? icon('star') : ''}</div>
              ${r.description ? `<div class="r-desc">${esc(r.description)}</div>` : ''}
              <div class="r-meta">${esc(r.category || 'Other')} · ${plural(ingredientCount(r), 'ingredient')}</div>
            </div>
            <button class="r-add ${on ? 'is-on' : ''}" type="button" data-toggle="${r.id}"
              aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} this week's plan">${icon(on ? 'check' : 'plus')}</button>
          </div>`;
        })
        .join('')
    : total
      ? `<div class="empty empty-compact"><p>Nothing matches that search.</p></div>`
      : '';
}

$('#recipe-list').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const added = store.toggleSelected(toggle.dataset.toggle);
    haptic();
    renderRecipes();
    updateBadges();
    toast(added ? 'Added to this week' : 'Removed from this week');
    return;
  }
  const open = event.target.closest('[data-open]');
  if (open) openRecipe(Number(open.dataset.open));
});

$('#catbar').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  recipeFilter = chip.dataset.cat;
  renderRecipes();
});

$('#in-search').addEventListener('input', renderRecipes);
$('.search-clear').addEventListener('click', () => {
  $('#in-search').value = '';
  renderRecipes();
  $('#in-search').focus();
});

$('#btn-new-recipe').addEventListener('click', () => openEditor(null));

function seedAll() {
  const added = store.seedSampleRecipes();
  renderAll();
  toast(added ? `Added ${plural(added, 'recipe')}` : 'You already have them all');
}

$('#btn-seed').addEventListener('click', seedAll);

// ---------------------------------------------------------------------------
// Recipe detail sheet
// ---------------------------------------------------------------------------

let detailId = null;
let detailServings = 2;

function openRecipe(id) {
  const recipe = store.getRecipe(id);
  if (!recipe) return;
  detailId = id;
  detailServings = store.getWeek().servingsPerMeal;
  renderDetail();
  $('#rd-body').scrollTop = 0;
  openSheet($('#sheet-recipe'));
}

function renderDetail() {
  const r = store.getRecipe(detailId);
  if (!r) return;
  const week = store.getWeek();
  const planned = week.selected.includes(r.id);
  const scaled = g.scaledIngredientLines(r, detailServings);
  const list = (lines) => `<ul class="ing-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;

  const query = encodeURIComponent(`${r.title} recipe`);
  const links = [];
  const original = safeUrl(r.sourceUrl);
  if (original) links.push(['external', 'Open the original recipe', original]);
  links.push(['play', 'Watch how to make it', `https://www.youtube.com/results?search_query=${query}`]);
  links.push(['globe', 'Search the web', `https://www.google.com/search?q=${query}`]);

  $('#rd-body').innerHTML = `
    <div class="rd-hero">
      ${tile(r, 'tile-lg')}
      <div>
        <h2 id="rd-title">${esc(r.title)}</h2>
        <p class="rd-cat">${esc(r.category || 'Other')} · Original serves ${r.baseServings}</p>
      </div>
    </div>
    ${r.description ? `<p class="rd-desc">${esc(r.description)}</p>` : ''}
    <div class="rd-actions">
      <button class="btn ${planned ? '' : 'btn-primary'}" type="button" data-rd="plan">
        ${icon(planned ? 'check' : 'plus', 'ic-sm')}${planned ? 'In this week’s plan' : 'Add to this week'}
      </button>
      <button class="btn rd-icon-btn ${r.favorite ? 'is-star' : ''}" type="button" data-rd="fav"
        aria-pressed="${r.favorite}" aria-label="${r.favorite ? 'Remove from favorites' : 'Add to favorites'}">${icon('star')}</button>
      <button class="btn rd-icon-btn" type="button" data-rd="edit" aria-label="Edit recipe">${icon('edit')}</button>
    </div>

    <div class="section-head">
      <h3>Ingredients</h3>
      <div class="stepper" aria-label="Servings to show">
        <button type="button" data-rd="less" aria-label="Fewer servings" ${detailServings <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
        <output aria-live="polite">${plural(detailServings, 'serving')}</output>
        <button type="button" data-rd="more" aria-label="More servings" ${detailServings >= 50 ? 'disabled' : ''}>${icon('plus')}</button>
      </div>
    </div>
    <div class="ing-card">
      ${scaled.main.length ? `${scaled.seasonings.length ? '<p class="ing-sub">Main</p>' : ''}${list(scaled.main)}` : ''}
      ${scaled.seasonings.length ? `<p class="ing-sub">Seasonings &amp; sauces</p>${list(scaled.seasonings)}` : ''}
      ${!scaled.main.length && !scaled.seasonings.length ? '<p class="hint" style="padding:14px 0">No ingredients yet. Tap edit to add some.</p>' : ''}
    </div>

    <div class="section-head"><h3>How to cook it</h3></div>
    <div class="link-list">
      ${links
        .map(
          ([ic, label, href]) =>
            `<a class="link-row" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${icon(ic)}<span>${esc(label)}</span>${icon('external')}</a>`,
        )
        .join('')}
    </div>`;
}

$('#rd-body').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-rd]');
  if (!btn) return;
  const act = btn.dataset.rd;
  if (act === 'plan') {
    const added = store.toggleSelected(detailId);
    haptic();
    toast(added ? 'Added to this week' : 'Removed from this week');
    renderAll();
    renderDetail();
  } else if (act === 'fav') {
    const fav = store.toggleFavorite(detailId);
    haptic();
    toast(fav ? 'Added to favorites' : 'Removed from favorites');
    renderRecipes();
    renderDetail();
  } else if (act === 'edit') {
    openEditor(detailId);
  } else if (act === 'less' || act === 'more') {
    detailServings = Math.min(50, Math.max(1, detailServings + (act === 'more' ? 1 : -1)));
    renderDetail();
  }
});

// ---------------------------------------------------------------------------
// Add / edit sheet
// ---------------------------------------------------------------------------

let editingId = null;

function setEditorMode(mode) {
  $$('#ed-mode button').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on);
  });
  $('#form-url').hidden = mode !== 'url';
  $('#form-recipe').hidden = mode === 'url';
  $('#ed-save').hidden = mode === 'url';
  $('#ed-note').hidden = true;
  $('#ed-autosort-row').hidden = mode !== 'manual';
}

function fillEditor(recipe) {
  $('#ed-title').value = recipe?.title || '';
  $('#ed-category').innerHTML = categorySelectOptions(recipe?.category || CATEGORIES[0]);
  $('#ed-servings').value = recipe?.baseServings || 4;
  $('#ed-description').value = recipe?.description || '';
  $('#ed-main').value = (recipe?.mainIngredients || []).map((i) => i.raw || i.name || '').join('\n');
  $('#ed-seasonings').value = (recipe?.seasonings || []).map((i) => i.raw || i.name || '').join('\n');
  $('#ed-url').value = recipe?.sourceUrl || '';
  $('#ed-autosort').checked = true;
}

function openEditor(id) {
  editingId = id;
  const recipe = id ? store.getRecipe(id) : null;
  $('#ed-heading').textContent = recipe ? 'Edit recipe' : 'New recipe';
  $('#ed-mode').hidden = Boolean(recipe);
  $('#ed-delete').hidden = !recipe;
  $('#url-status').hidden = true;
  $('#in-url').value = '';
  fillEditor(recipe);
  if (recipe) {
    setEditorMode('edit');
  } else {
    setEditorMode(prefs.addMode === 'manual' ? 'manual' : 'url');
  }
  $('#sheet-edit .sheet-body').scrollTop = 0;
  openSheet($('#sheet-edit'));
}

$('#ed-mode').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-mode]');
  if (!btn) return;
  setPref('addMode', btn.dataset.mode);
  fillEditor(null);
  setEditorMode(btn.dataset.mode);
});

$('#form-recipe').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = $('#ed-title').value.trim();
  const mainText = $('#ed-main').value;
  if (!title) {
    toast('Give the recipe a name');
    $('#ed-title').focus();
    return;
  }
  if (!mainText.trim()) {
    toast('Add at least one ingredient');
    $('#ed-main').focus();
    return;
  }

  let main = g.parseIngredientLines(mainText);
  let seasonings = g.parseIngredientLines($('#ed-seasonings').value);
  if (!editingId && !$('#ed-autosort-row').hidden && $('#ed-autosort').checked) {
    const moved = main.filter((i) => i.aisle === AISLE_SEASONINGS);
    main = main.filter((i) => i.aisle !== AISLE_SEASONINGS);
    seasonings = [...seasonings, ...moved];
  }

  const fields = {
    title,
    category: $('#ed-category').value,
    description: $('#ed-description').value,
    baseServings: $('#ed-servings').value,
    sourceUrl: $('#ed-url').value,
    mainIngredients: main,
    seasonings,
  };

  if (editingId) {
    store.updateRecipe(editingId, fields);
    toast('Recipe updated');
  } else {
    const id = store.addRecipe(fields);
    recipeFilter = '';
    $('#in-search').value = '';
    toast(`Saved “${title}”`);
    detailId = id;
  }
  closeSheet($('#sheet-edit'));
  renderAll();
  if ($('#sheet-recipe').open) renderDetail();
});

$('#ed-delete').addEventListener('click', () => {
  const recipe = store.getRecipe(editingId);
  if (!recipe) return;
  const undo = store.snapshot();
  store.deleteRecipe(editingId);
  closeSheet($('#sheet-edit'));
  closeSheet($('#sheet-recipe'));
  renderAll();
  toast(`Deleted “${g.shortLabel(recipe.title, 28)}”`, { undo });
});

// --- import from a link ---

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
      hint: 'Use "Type it in" instead. (The fix is in the README under "If importing from a link doesn’t work".)',
    };
  }
  return {
    ok: false,
    error: "Couldn't reach the import service.",
    hint: 'Check your connection, or type the recipe in instead.',
  };
}

function setStatus(el, kind, html) {
  el.hidden = false;
  el.className = `banner banner-${kind}`;
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

  const button = $('#btn-fetch');
  button.disabled = true;
  button.textContent = 'Reading the page…';
  status.hidden = true;

  const result = await callScraper(url);

  button.disabled = false;
  button.textContent = 'Get the recipe';

  if (!result.ok) {
    setStatus(
      status,
      'err',
      `<strong>${esc(result.error)}</strong>${result.hint ? `<br />${esc(result.hint)}` : ''}`,
    );
    return;
  }

  // The function returns raw ingredient text; parsing and the main-vs-seasoning
  // split happen here, with the same code the rest of the app uses.
  const lines = result.rawLines || [];
  const parsed = lines.map(g.parseIngredient);
  fillEditor(null);
  $('#ed-title').value = result.title || '';
  $('#ed-servings').value = result.baseServings || 4;
  $('#ed-url').value = result.sourceUrl || url;
  $('#ed-main').value = parsed
    .filter((i) => i.aisle !== AISLE_SEASONINGS)
    .map((i) => i.raw)
    .join('\n');
  $('#ed-seasonings').value = parsed
    .filter((i) => i.aisle === AISLE_SEASONINGS)
    .map((i) => i.raw)
    .join('\n');

  $('#form-url').hidden = true;
  $('#form-recipe').hidden = false;
  $('#ed-save').hidden = false;
  const warnings = (result.warnings || []).map((w) => `<br />${esc(w)}`).join('');
  setStatus($('#ed-note'), 'ok', `Found <strong>${lines.length}</strong> ingredients. Check them over, then tap Save.${warnings}`);
});

// ---------------------------------------------------------------------------
// Screen 2 — Plan
// ---------------------------------------------------------------------------

function renderPlan() {
  const total = store.countRecipes();
  const week = store.getWeek();
  const plan = store.getRecipesByIds(week.selected);
  const colors = g.assignColors(week.selected);
  const numbers = g.assignNumbers(week.selected);

  $('#plan-eyebrow').textContent = weekOfLabel();
  $('#out-people').textContent = week.people;
  $('#out-extra').textContent = week.extraServings;
  $('[data-stepper="people"] [data-step="-1"]').disabled = week.people <= 1;
  $('[data-stepper="extra"] [data-step="-1"]').disabled = week.extraServings <= 0;

  const per = week.servingsPerMeal;
  $('#portions-sum').innerHTML = plan.length
    ? `Each recipe is scaled to <strong>${plural(per, 'serving')}</strong> · <strong>${plural(per * plan.length, 'serving')}</strong> across ${plural(plan.length, 'meal')}`
    : `Each recipe will be scaled to <strong>${plural(per, 'serving')}</strong>${week.extraServings ? ', including leftovers' : ''}`;

  $('#plan-norecipes').hidden = total > 0;
  $('#plan-empty').hidden = total === 0 || plan.length > 0;
  $('#btn-add-meals').hidden = plan.length === 0;
  $('#plan-cta').hidden = plan.length === 0;

  if (!plan.length) {
    $('#plan-days').innerHTML = '';
    return;
  }

  const items = currentItems();
  const left = items.filter((i) => !week.checked[i.key]).length;
  $('#plan-cta-sub').textContent = left
    ? `${plural(left, 'item')} to buy, sorted by aisle`
    : 'Everything is in the cart';

  // Group by day; meals without a day go in "Anytime" at the end. If nothing
  // has a day yet, show one simple list rather than an empty-looking calendar.
  const anyScheduled = plan.some((r) => week.days[r.id] !== undefined);
  const groups = [];
  if (anyScheduled) {
    for (let d = 0; d < 7; d += 1) {
      const meals = plan.filter((r) => week.days[r.id] === d);
      if (meals.length) groups.push({ label: DAYS[d], today: d === todayIndex(), meals });
    }
    const loose = plan.filter((r) => week.days[r.id] === undefined);
    if (loose.length) groups.push({ label: 'Anytime', meals: loose });
  } else {
    groups.push({ label: 'This week', meals: plan, hint: 'Set a day on any meal to build a schedule' });
  }

  const dayOptions = (selected) =>
    `<option value="" ${selected === undefined ? 'selected' : ''}>Any day</option>` +
    DAYS.map((d, i) => `<option value="${i}" ${selected === i ? 'selected' : ''}>${d.slice(0, 3)}</option>`).join('');

  $('#plan-days').innerHTML = groups
    .map(
      (group) => `<section class="day-group">
        <div class="day-head">
          <span class="day-name ${group.today ? 'is-today' : ''}">${esc(group.label)}${group.today ? ' · Today' : ''}</span>
          <span class="day-count">${group.hint ? esc(group.hint) : plural(group.meals.length, 'meal')}</span>
        </div>
        <div class="meal-list">
          ${group.meals
            .map(
              (r) => `<div class="meal" data-id="${r.id}">
                ${tile(r, '', `<span class="num" style="--tag-color:${colors[r.id]}">${numbers[r.id]}</span>`)}
                <div class="meal-main">
                  <button class="meal-open" type="button" data-open="${r.id}">${esc(r.title)}</button>
                  <div class="meal-sub">
                    <select class="day-select ${week.days[r.id] !== undefined ? 'is-set' : ''}" data-day="${r.id}" aria-label="Day for ${esc(r.title)}">${dayOptions(week.days[r.id])}</select>
                    <span class="meal-meta">${esc(r.category || 'Other')}</span>
                  </div>
                </div>
                <button class="meal-remove" type="button" data-remove="${r.id}" aria-label="Remove ${esc(r.title)}">${icon('x')}</button>
              </div>`,
            )
            .join('')}
        </div>
      </section>`,
    )
    .join('');
}

$('#plan-days').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    const recipe = store.getRecipe(remove.dataset.remove);
    const undo = store.snapshot();
    store.toggleSelected(remove.dataset.remove);
    haptic();
    renderAll();
    toast(`Removed ${g.shortLabel(recipe?.title || 'meal', 26)}`, { undo });
    return;
  }
  const open = event.target.closest('[data-open]');
  if (open) openRecipe(Number(open.dataset.open));
});

$('#plan-days').addEventListener('change', (event) => {
  const select = event.target.closest('[data-day]');
  if (!select) return;
  store.setDay(select.dataset.day, select.value === '' ? null : Number(select.value));
  renderPlan();
});

function bindStepper(name, read, write) {
  $(`[data-stepper="${name}"]`).addEventListener('click', (event) => {
    const btn = event.target.closest('[data-step]');
    if (!btn) return;
    write(read() + Number(btn.dataset.step));
    haptic();
  });
}

bindStepper(
  'people',
  () => store.getWeek().people,
  (n) => {
    store.setServings(n);
    renderPlan();
    updateBadges();
  },
);
bindStepper(
  'extra',
  () => store.getWeek().extraServings,
  (n) => {
    store.setExtraServings(n);
    renderPlan();
    updateBadges();
  },
);

// --- picker sheet ---

let pickerFilter = '';

function openPicker() {
  if (!store.countRecipes()) {
    showTab('recipes');
    return;
  }
  $('#pk-search').value = '';
  renderPicker();
  $('#pk-list').scrollTop = 0;
  openSheet($('#sheet-picker'));
}

function renderPicker() {
  const week = store.getWeek();
  const counts = store.categoriesInUse();
  const favorites = store.countFavorites();
  if (pickerFilter === store.FAVORITES && !favorites) pickerFilter = '';
  $('#pk-catbar').innerHTML = categoryChips(pickerFilter, counts, store.countRecipes(), { favorites });

  const shown = store.searchRecipes($('#pk-search').value, pickerFilter);
  const planned = new Set(week.selected);
  $('#pk-list').innerHTML = shown.length
    ? shown
        .map((r) => {
          const on = planned.has(r.id);
          return `<button class="pick ${on ? 'is-on' : ''}" type="button" data-id="${r.id}" aria-pressed="${on}">
            ${tile(r)}
            <span class="pick-main">
              <span class="pick-title">${esc(r.title)}</span>
              <span class="pick-meta">${r.favorite ? '★ ' : ''}${esc(r.category || 'Other')}${r.description ? ` · ${esc(r.description)}` : ''}</span>
            </span>
            <span class="pick-mark">${icon('check')}</span>
          </button>`;
        })
        .join('')
    : '<p class="pick-empty">Nothing matches that search.</p>';

  $('#pk-count').textContent = week.selected.length
    ? `${plural(week.selected.length, 'meal')} selected`
    : 'Tap meals to add them';
}

$('#pk-list').addEventListener('click', (event) => {
  const row = event.target.closest('.pick');
  if (!row) return;
  const on = store.toggleSelected(row.dataset.id);
  haptic();
  // Update just this row: re-rendering would reset the scroll position.
  row.classList.toggle('is-on', on);
  row.setAttribute('aria-pressed', on);
  const n = store.getWeek().selected.length;
  $('#pk-count').textContent = n ? `${plural(n, 'meal')} selected` : 'Tap meals to add them';
  renderAll();
});

$('#pk-search').addEventListener('input', renderPicker);
$('#pk-catbar').addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  pickerFilter = chip.dataset.cat;
  renderPicker();
});

// --- surprise sheet ---

let randomCount = Number(prefs.randomCount) || 5;

function surprisePool() {
  return store.searchRecipes('', $('#sp-from').value).length;
}

function syncSurprise() {
  const max = Math.max(1, surprisePool());
  randomCount = Math.min(max, Math.max(1, randomCount));
  $('#out-random').textContent = randomCount;
  $('[data-stepper="random"] [data-step="-1"]').disabled = randomCount <= 1;
  $('[data-stepper="random"] [data-step="1"]').disabled = randomCount >= max;
}

function openSurprise() {
  if (!store.countRecipes()) {
    showTab('recipes');
    toast('Add some recipes first');
    return;
  }
  const counts = store.categoriesInUse();
  const favorites = store.countFavorites();
  const current = $('#sp-from').value;
  $('#sp-from').innerHTML =
    `<option value="">All recipes (${store.countRecipes()})</option>` +
    (favorites ? `<option value="${store.FAVORITES}">Favorites (${favorites})</option>` : '') +
    counts.map((c) => `<option value="${esc(c.name)}">${esc(c.name)} (${c.count})</option>`).join('');
  if ([...$('#sp-from').options].some((o) => o.value === current)) $('#sp-from').value = current;
  syncSurprise();
  openSheet($('#sheet-surprise'));
}

$('#btn-surprise').addEventListener('click', openSurprise);
$('#sp-from').addEventListener('change', syncSurprise);
bindStepper(
  'random',
  () => randomCount,
  (n) => {
    randomCount = n;
    setPref('randomCount', n);
    syncSurprise();
  },
);

$('#btn-do-surprise').addEventListener('click', () => {
  const undo = store.snapshot();
  const picked = store.randomizeWeek(randomCount, { category: $('#sp-from').value });
  closeSheet($('#sheet-surprise'));
  renderAll();
  showTab('plan');
  toast(`Picked ${plural(picked.length, 'meal')}`, { undo });
});

// ---------------------------------------------------------------------------
// Screen 3 — Groceries
// ---------------------------------------------------------------------------

function currentItems() {
  const week = store.getWeek();
  const plan = store.getRecipesByIds(week.selected);
  return g.consolidate(plan, week.servingsPerMeal, week.household);
}

let lastItems = [];

function renderProgress() {
  const week = store.getWeek();
  const total = lastItems.length;
  const done = lastItems.filter((i) => week.checked[i.key]).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('#ring').style.setProperty('--p', pct);
  $('#ring-text').textContent = `${pct}%`;
  $('#ring').setAttribute('aria-label', `${done} of ${total} items in the cart`);
  const left = total - done;
  $('#progress-title').textContent = left ? `${plural(left, 'item')} left` : 'All done!';
  $('#progress-sub').textContent =
    `${done} of ${total} in the cart · ${plural(week.selected.length, 'meal')}, ${week.servingsPerMeal} servings each`;
  $('#list-eyebrow').textContent = weekOfLabel();
  $('#list-alldone').hidden = !total || left > 0;
  updateBadges();
}

function renderList() {
  const week = store.getWeek();
  const plan = store.getRecipesByIds(week.selected);
  const colors = g.assignColors(week.selected);
  const numbers = g.assignNumbers(week.selected);
  const titles = Object.fromEntries(plan.map((r) => [r.id, r.title]));
  const hideDone = prefs.hideDone === true;

  const items = g.consolidate(plan, week.servingsPerMeal, week.household);
  lastItems = items;

  $('#list-empty').hidden = items.length > 0;
  $('#list-progress').hidden = items.length === 0;
  $('#list-legend').innerHTML = plan
    .map(
      (r) =>
        `<span class="tag"><span class="tag-num" style="--tag-color:${colors[r.id]}">${numbers[r.id]}</span>${esc(g.shortLabel(r.title, 26))}</span>`,
    )
    .join('');
  $('#list-legend').hidden = !plan.length;

  $('#grocery-list').innerHTML = g
    .groupByAisle(items)
    .map(([aisle, group]) => {
      const ticked = group.filter((i) => week.checked[i.key]).length;
      const cleared = ticked === group.length;
      if (hideDone && cleared) return '';
      // Items still to get come first; what's in the cart sinks to the bottom.
      const ordered = [...group].sort((a, b) => Boolean(week.checked[a.key]) - Boolean(week.checked[b.key]));
      const sectionId = `aisle:${aisle}`;
      const meta = aisleMeta(aisle);
      const rows = ordered
        .filter((item) => !(hideDone && week.checked[item.key]))
        .map((item) => {
          const checked = Boolean(week.checked[item.key]);
          const marks = item.sources
            .map(
              (rid) =>
                `<span class="src-num" style="--tag-color:${colors[rid] || 'var(--muted)'}" title="${esc(titles[rid] || 'Recipe')}" role="img" aria-label="for ${esc(titles[rid] || 'recipe')}">${numbers[rid]}</span>`,
            )
            .join('');
          const removable = item.household && !item.sources.length;
          return `<label class="gi ${checked ? 'is-done' : ''}" data-key="${esc(item.key)}">
            <input type="checkbox" ${checked ? 'checked' : ''} />
            <span class="gi-box">${icon('check')}</span>
            <span class="gi-text">
              <span class="gi-line">
                <span class="gi-name">${esc(item.name)}</span>
                ${item.amount ? `<span class="gi-amount">${esc(item.amount)}</span>` : ''}
                ${marks || item.household ? `<span class="gi-srcs">${marks}${item.household ? '<span class="src-num src-num-extra" title="Added by you" role="img" aria-label="added by you">+</span>' : ''}</span>` : ''}
              </span>
              ${item.notes.length ? `<span class="gi-note">${esc(item.notes.slice(0, 2).join('; '))}</span>` : ''}
            </span>
            ${removable ? `<button class="gi-remove" type="button" data-remove-key="${esc(item.key)}" aria-label="Remove ${esc(item.name)}">${icon('x')}</button>` : ''}
          </label>`;
        })
        .join('');
      return `<details class="aisle ${cleared ? 'is-cleared' : ''}" data-section="${esc(sectionId)}" ${isCollapsed(sectionId) ? '' : 'open'}>
        <summary>
          <span class="aisle-emoji" aria-hidden="true">${meta.emoji}</span>
          <span class="aisle-name">${esc(meta.label)}</span>
          <span class="aisle-count">${cleared ? 'Done' : `${ticked}/${group.length}`}</span>
          ${icon('chevron-down', 'aisle-chev')}
        </summary>
        <div class="aisle-items">${rows}</div>
      </details>`;
    })
    .join('');

  // `toggle` doesn't bubble, so each aisle needs its own listener.
  $$('#grocery-list .aisle').forEach((el) => {
    el.addEventListener('toggle', () => setPref(el.dataset.section, !el.open));
  });

  renderProgress();
}

/** Refresh one aisle's "3/9" label after a tick, without re-rendering. */
function refreshAisle(section) {
  if (!section) return;
  const week = store.getWeek();
  const aisle = section.dataset.section.slice('aisle:'.length);
  const group = lastItems.filter((i) => i.aisle === aisle);
  const ticked = group.filter((i) => week.checked[i.key]).length;
  const cleared = group.length > 0 && ticked === group.length;
  $('.aisle-count', section).textContent = cleared ? 'Done' : `${ticked}/${group.length}`;
  section.classList.toggle('is-cleared', cleared);
}

let hideTimer = null;

$('#grocery-list').addEventListener('change', (event) => {
  const input = event.target;
  if (input.type !== 'checkbox') return;
  const row = input.closest('.gi');
  if (!row) return;

  store.setItemChecked(row.dataset.key, input.checked);
  row.classList.toggle('is-done', input.checked);
  if (input.checked) haptic();
  refreshAisle(row.closest('.aisle'));
  renderProgress();

  // With "hide items in the cart" on, let the tick animation land, then tidy up.
  if (prefs.hideDone) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(renderList, 450);
  }
});

$('#grocery-list').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-remove-key]');
  if (!btn) return;
  event.preventDefault();
  const undo = store.snapshot();
  store.removeHouseholdByKey(btn.dataset.removeKey);
  renderList();
  toast('Item removed', { undo });
});

// --- quick add ---

$('#form-quick').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('#in-quick').value.trim();
  if (!text) {
    $('#in-quick').focus();
    return;
  }
  let aisle = $('#in-quick-aisle').value;
  if (!aisle) {
    // Auto: use the same aisle sorter as recipe ingredients; anything it
    // doesn't recognise (paper towels, batteries) goes under Household.
    aisle = g.categorize(g.parseIngredient(text).name, AISLE_HOUSEHOLD);
  }
  store.addHouseholdItem(text, aisle);
  $('#in-quick').value = '';
  $('#in-quick-aisle').value = '';
  renderList();
  haptic();
  toast(`Added to ${aisleMeta(aisle).label}`);
  // Keep focus so several items can be added in a row.
  $('#in-quick').focus();
});

// --- share / options ---

function listText() {
  const week = store.getWeek();
  const plan = store.getRecipesByIds(week.selected);
  const titles = Object.fromEntries(plan.map((r) => [r.id, r.title]));
  return g.plainTextList(lastItems, titles, g.assignNumbers(week.selected), week.checked);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
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
    return Boolean(copied);
  }
}

$('#btn-share').addEventListener('click', async () => {
  renderList();
  const text = listText();
  if (!text) {
    toast('Nothing to share yet');
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Grocery list', text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user closed the share sheet
    }
  }
  toast((await copyText(text)) ? 'List copied' : 'Copying is blocked in this browser');
});

$('#btn-list-more').addEventListener('click', () => {
  $('#opt-hide-done').checked = prefs.hideDone === true;
  $('#opt-wake').checked = prefs.wake === true;
  openSheet($('#sheet-listmore'));
});

$('#opt-hide-done').addEventListener('change', (event) => {
  setPref('hideDone', event.target.checked);
  renderList();
});

$('#btn-copy').addEventListener('click', async () => {
  const text = listText();
  closeSheet($('#sheet-listmore'));
  if (!text) {
    toast('Nothing to copy yet');
    return;
  }
  toast((await copyText(text)) ? 'List copied' : 'Copying is blocked in this browser');
});

$('#btn-uncheck').addEventListener('click', () => {
  const undo = store.snapshot();
  store.clearChecked();
  closeSheet($('#sheet-listmore'));
  renderList();
  toast('All items unticked', { undo });
});

function startNewWeek() {
  const undo = store.snapshot();
  store.resetWeek();
  $$('dialog.sheet[open]').forEach(closeSheet);
  renderAll();
  toast('Ready for a new week', { undo });
}

$('#btn-reset').addEventListener('click', startNewWeek);
$('#btn-newweek-inline').addEventListener('click', startNewWeek);

// --- keep the screen awake while shopping ---

let wakeLock = null;

async function syncWakeLock() {
  const want = prefs.wake === true && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (err) {
    wakeLock = null; // low battery mode or unsupported; nothing to do
  }
}

$('#opt-wake').addEventListener('change', (event) => {
  setPref('wake', event.target.checked);
  syncWakeLock();
  toast(event.target.checked ? 'Screen will stay on' : 'Screen can sleep normally');
});
document.addEventListener('visibilitychange', syncWakeLock);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  $$('#theme-pick button').forEach((b) => {
    const on = b.dataset.themeVal === (theme || 'system');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on);
  });
  // Match the phone's status bar to the app background.
  const bg = getComputedStyle(document.body).backgroundColor;
  $$('meta[name="theme-color"]').forEach((m) => {
    if (theme === 'light' || theme === 'dark') {
      m.setAttribute('content', bg);
    } else {
      m.setAttribute('content', m.media.includes('dark') ? '#0f0f0e' : '#f7f6f3');
    }
  });
}

function openSettings() {
  const missing = store.libraryCount() - store.listRecipes().filter((r) => r.description).length;
  $('#seed-more').hidden = missing <= 0;
  $('#seed-more-text').textContent = `${store.libraryCount()} recipes across ${CATEGORIES.length} categories; only the ones you don't have are added`;
  $('#backup-status').hidden = true;
  applyTheme(prefs.theme);
  openSheet($('#sheet-settings'));
}

$('#theme-pick').addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-theme-val]');
  if (!btn) return;
  setPref('theme', btn.dataset.themeVal);
  applyTheme(btn.dataset.themeVal);
});

$('#btn-seed-more').addEventListener('click', () => {
  seedAll();
  closeSheet($('#sheet-settings'));
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
    `Saved <strong>meal-planner-backup-${stamp}.json</strong>. Email it to yourself to keep it safe.`,
  );
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());

$('#file-import').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const text = await file.text();
  event.target.value = '';

  const ok = await confirmAction({
    title: 'Restore this backup?',
    text: 'It replaces the recipes and plan currently on this device.',
    yes: 'Restore',
    danger: false,
  });
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
  const ok = await confirmAction({
    title: 'Delete everything?',
    text: 'Every recipe and your current list will be removed from this device. Save a backup first if you might want them later.',
    yes: 'Delete all',
  });
  if (!ok) return;
  store.clearAll();
  recipeFilter = '';
  pickerFilter = '';
  closeSheet($('#sheet-settings'));
  renderAll();
  showTab('recipes');
  toast('Everything deleted');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function renderAll() {
  renderRecipes();
  renderPlan();
  renderList();
}

function init() {
  $('#in-quick-aisle').innerHTML =
    '<option value="">Auto</option>' +
    AISLES.map((a) => `<option value="${esc(a)}">${esc(aisleMeta(a).label)}</option>`).join('');

  $('#storage-warning').hidden = store.storageAvailable;
  if (!('wakeLock' in navigator)) $('#row-wake').hidden = true;

  applyTheme(prefs.theme);
  renderAll();
  showTab(prefs.tab || 'recipes', { scroll: false });
  syncWakeLock();
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
