/**
 * store.js — on-device persistence.
 *
 * Everything lives in one versioned JSON blob in localStorage, written
 * synchronously on every change, so closing the browser mid-shop loses
 * nothing. If localStorage is unavailable (Safari private browsing, blocked
 * site data) the app degrades to an in-memory store and says so, instead of
 * throwing on every keystroke.
 *
 * Shape:
 *   {
 *     version: 1,
 *     nextId: 7,
 *     recipes: [{ id, title, sourceUrl, baseServings,
 *                 mainIngredients: [ing], seasonings: [ing], createdAt }],
 *     week: { selected: [id], servings: 2, checked: { itemKey: true },
 *             household: [{ name, aisle, quantity, unit, note }] }
 *   }
 */

import { parseIngredient, AISLE_SEASONINGS, AISLE_HOUSEHOLD, AISLES } from './grocery.js';
import { RECIPE_LIBRARY, CATEGORIES } from './recipes.js';

export { CATEGORIES };

export const UNCATEGORIZED = 'Other';

const STORAGE_KEY = 'mealPlanner.v1';
const SCHEMA_VERSION = 1;

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    nextId: 1,
    recipes: [],
    week: {
      selected: [],
      // people: how many you're cooking for.
      // extraServings: spare portions per meal, for leftovers or lunches.
      // Every recipe is scaled to (people + extraServings) servings, so a
      // week of 3 meals for 2 people buys 3 x 2 = 6 servings of food.
      servings: 2,
      extraServings: 0,
      checked: {},
      household: [],
    },
  };
}

/** True when real localStorage is working; false means in-memory only. */
export let storageAvailable = true;

let memoryFallback = null;

function readRaw() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    storageAvailable = false;
    return null;
  }
}

function writeRaw(text) {
  try {
    window.localStorage.setItem(STORAGE_KEY, text);
    storageAvailable = true;
    return true;
  } catch (err) {
    storageAvailable = false;
    memoryFallback = text;
    return false;
  }
}

/** Repair anything missing or malformed so the app never boots into a crash. */
function normalizeState(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;

  const state = {
    version: SCHEMA_VERSION,
    nextId: Number.isFinite(raw.nextId) ? Math.max(1, Math.floor(raw.nextId)) : 1,
    recipes: Array.isArray(raw.recipes) ? raw.recipes : [],
    week: { ...base.week, ...(raw.week && typeof raw.week === 'object' ? raw.week : {}) },
  };

  state.recipes = state.recipes
    .filter((r) => r && typeof r === 'object')
    .map((r, i) => ({
      id: Number.isFinite(r.id) ? r.id : i + 1,
      title: String(r.title || 'Untitled recipe'),
      category: String(r.category || UNCATEGORIZED),
      description: String(r.description || ''),
      sourceUrl: String(r.sourceUrl || ''),
      baseServings: Math.max(1, Math.floor(Number(r.baseServings) || 1)),
      mainIngredients: Array.isArray(r.mainIngredients) ? r.mainIngredients : [],
      seasonings: Array.isArray(r.seasonings) ? r.seasonings : [],
      createdAt: String(r.createdAt || new Date().toISOString()),
    }));

  const ids = new Set(state.recipes.map((r) => r.id));
  const maxId = state.recipes.reduce((max, r) => Math.max(max, r.id), 0);
  state.nextId = Math.max(state.nextId, maxId + 1);

  state.week.selected = (Array.isArray(state.week.selected) ? state.week.selected : [])
    .map(Number)
    .filter((id) => ids.has(id));
  state.week.servings = Math.max(1, Math.floor(Number(state.week.servings) || 2));
  state.week.extraServings = Math.max(0, Math.floor(Number(state.week.extraServings) || 0));
  state.week.checked =
    state.week.checked && typeof state.week.checked === 'object' ? state.week.checked : {};
  state.week.household = (Array.isArray(state.week.household) ? state.week.household : [])
    .filter((h) => h && typeof h === 'object' && String(h.name || '').trim())
    .map((h) => ({
      name: String(h.name).trim(),
      aisle: AISLES.includes(h.aisle) ? h.aisle : AISLE_HOUSEHOLD,
      quantity: Number.isFinite(h.quantity) ? h.quantity : null,
      unit: String(h.unit || ''),
      note: String(h.note || ''),
    }));

  return state;
}

let state = (() => {
  const raw = readRaw() ?? memoryFallback;
  if (!raw) return emptyState();
  try {
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    // Corrupt payload: keep a copy under a side key, start clean.
    try {
      window.localStorage.setItem(`${STORAGE_KEY}.corrupt`, raw);
    } catch (_ignored) {
      /* nothing we can do */
    }
    return emptyState();
  }
})();

function persist() {
  const text = JSON.stringify(state);
  if (!writeRaw(text)) memoryFallback = text;
}

/**
 * Ask the browser to make this data exempt from routine eviction.
 * Safari clears site data for pages not used in ~7 days unless the app has
 * been added to the home screen, so this is a belt-and-braces call.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (err) {
    /* unsupported; ignore */
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export function listRecipes() {
  return state.recipes
    .slice()
    .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
}

/**
 * Filter the vault by free text and/or category.
 * Text matches the title, the description or any ingredient.
 */
export function searchRecipes(term, category) {
  const needle = String(term || '').trim().toLowerCase();
  let out = listRecipes();
  if (category) out = out.filter((r) => (r.category || UNCATEGORIZED) === category);
  if (!needle) return out;
  return out.filter((recipe) => {
    if (recipe.title.toLowerCase().includes(needle)) return true;
    if ((recipe.description || '').toLowerCase().includes(needle)) return true;
    return [...recipe.mainIngredients, ...recipe.seasonings].some((ing) =>
      `${ing.name || ''} ${ing.raw || ''}`.toLowerCase().includes(needle),
    );
  });
}

export function getRecipe(id) {
  return state.recipes.find((r) => r.id === Number(id)) || null;
}

export function getRecipesByIds(ids) {
  return ids.map((id) => getRecipe(id)).filter(Boolean);
}

export function countRecipes() {
  return state.recipes.length;
}

export function addRecipe({
  title,
  baseServings,
  mainIngredients,
  seasonings,
  sourceUrl,
  category,
  description,
}) {
  const recipe = {
    id: state.nextId,
    title: String(title || 'Untitled recipe').trim() || 'Untitled recipe',
    category: String(category || UNCATEGORIZED).trim() || UNCATEGORIZED,
    description: String(description || '').trim(),
    sourceUrl: String(sourceUrl || '').trim(),
    baseServings: Math.max(1, Math.floor(Number(baseServings) || 1)),
    mainIngredients: mainIngredients || [],
    seasonings: seasonings || [],
    createdAt: new Date().toISOString(),
  };
  state.nextId += 1;
  state.recipes.push(recipe);
  persist();
  return recipe.id;
}

export function updateRecipe(
  id,
  { title, baseServings, mainIngredients, seasonings, sourceUrl, category, description },
) {
  const recipe = getRecipe(id);
  if (!recipe) return false;
  recipe.title = String(title || 'Untitled recipe').trim() || 'Untitled recipe';
  if (category !== undefined) {
    recipe.category = String(category || UNCATEGORIZED).trim() || UNCATEGORIZED;
  }
  if (description !== undefined) recipe.description = String(description || '').trim();
  recipe.sourceUrl = String(sourceUrl || '').trim();
  recipe.baseServings = Math.max(1, Math.floor(Number(baseServings) || 1));
  recipe.mainIngredients = mainIngredients || [];
  recipe.seasonings = seasonings || [];
  persist();
  return true;
}

export function deleteRecipe(id) {
  const target = Number(id);
  state.recipes = state.recipes.filter((r) => r.id !== target);
  state.week.selected = state.week.selected.filter((r) => r !== target);
  persist();
}

/**
 * Add the built-in recipes not already present.
 * @param {string} [category] only seed this category; omit for all of them.
 * @returns {number} how many were added
 */
export function seedSampleRecipes(category) {
  const existing = new Set(state.recipes.map((r) => r.title.trim().toLowerCase()));
  let added = 0;
  for (const sample of RECIPE_LIBRARY) {
    if (category && sample.category !== category) continue;
    if (existing.has(sample.title.trim().toLowerCase())) continue;
    const parsed = sample.ingredients.map(parseIngredient);
    addRecipe({
      title: sample.title,
      category: sample.category,
      description: sample.description,
      baseServings: sample.servings,
      sourceUrl: '',
      mainIngredients: parsed.filter((p) => p.aisle !== AISLE_SEASONINGS),
      seasonings: parsed.filter((p) => p.aisle === AISLE_SEASONINGS),
    });
    added += 1;
  }
  return added;
}

/** How many built-in recipes exist in total. */
export function libraryCount() {
  return RECIPE_LIBRARY.length;
}

/**
 * Categories actually present in the vault, in CATEGORIES order, each with a
 * count. Anything with an unknown category is grouped at the end.
 */
export function categoriesInUse() {
  const counts = new Map();
  for (const recipe of state.recipes) {
    const key = recipe.category || UNCATEGORIZED;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const ordered = CATEGORIES.filter((c) => counts.has(c)).map((c) => ({
    name: c,
    count: counts.get(c),
  }));
  const extras = [...counts.keys()]
    .filter((c) => !CATEGORIES.includes(c))
    .sort()
    .map((c) => ({ name: c, count: counts.get(c) }));
  return [...ordered, ...extras];
}

// ---------------------------------------------------------------------------
// The active week
// ---------------------------------------------------------------------------

export function getWeek() {
  const people = state.week.servings;
  const extra = state.week.extraServings || 0;
  return {
    selected: state.week.selected.slice(),
    /** How many people you're cooking for. */
    people,
    /** Spare portions per meal (leftovers / lunches). */
    extraServings: extra,
    /** Servings each individual recipe is scaled to. */
    servingsPerMeal: people + extra,
    /** Total servings the whole plan buys: every meal, fully portioned. */
    totalServings: (people + extra) * state.week.selected.length,
    /** Back-compat alias for servingsPerMeal. */
    servings: people + extra,
    checked: { ...state.week.checked },
    household: state.week.household.map((h) => ({ ...h })),
  };
}

export function setSelected(ids) {
  const known = new Set(state.recipes.map((r) => r.id));
  state.week.selected = ids.map(Number).filter((id) => known.has(id));
  persist();
}

export function toggleSelected(id) {
  const target = Number(id);
  if (state.week.selected.includes(target)) {
    state.week.selected = state.week.selected.filter((r) => r !== target);
  } else {
    state.week.selected.push(target);
  }
  persist();
  return state.week.selected.includes(target);
}

/** Set how many people you're cooking for. */
export function setServings(count) {
  state.week.servings = Math.min(50, Math.max(1, Math.floor(Number(count) || 1)));
  persist();
}

/** Set spare portions per meal (0 = cook exactly enough, no leftovers). */
export function setExtraServings(count) {
  state.week.extraServings = Math.min(20, Math.max(0, Math.floor(Number(count) || 0)));
  persist();
}

export function randomizeWeek(howMany) {
  const pool = state.recipes.map((r) => r.id);
  const take = Math.max(1, Math.min(Math.floor(Number(howMany) || 1), pool.length));
  // Fisher-Yates on a copy, then slice.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  state.week.selected = pool.slice(0, take);
  state.week.checked = {};
  persist();
  return state.week.selected.slice();
}

export function setItemChecked(itemKey, checked) {
  if (checked) state.week.checked[itemKey] = true;
  else delete state.week.checked[itemKey];
  persist();
}

export function clearChecked() {
  state.week.checked = {};
  persist();
}

export function addHouseholdItem(text, aisle) {
  const parsed = parseIngredient(text);
  if (!parsed.name.trim()) return false;
  state.week.household.push({
    name: parsed.name,
    aisle: AISLES.includes(aisle) ? aisle : AISLE_HOUSEHOLD,
    quantity: parsed.quantity,
    unit: parsed.unit,
    note: parsed.note,
  });
  persist();
  return true;
}

export function removeHouseholdItem(index) {
  if (index >= 0 && index < state.week.household.length) {
    state.week.household.splice(index, 1);
    persist();
  }
}

/** Start a new week: clear the plan, the extras and every checkbox. */
export function resetWeek() {
  state.week.selected = [];
  state.week.checked = {};
  state.week.household = [];
  persist();
}

// ---------------------------------------------------------------------------
// Backup / restore
// ---------------------------------------------------------------------------

export function exportJson() {
  return JSON.stringify(
    { ...state, exportedAt: new Date().toISOString(), app: 'meal-planner' },
    null,
    2,
  );
}

/**
 * Restore from a backup file.
 * @param {string} text  JSON produced by exportJson()
 * @param {'replace'|'merge'} mode
 * @returns {{ok: boolean, error?: string, recipes?: number}}
 */
export function importJson(text, mode = 'replace') {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: "That file isn't valid JSON — pick the backup file you exported." };
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.recipes)) {
    return { ok: false, error: "That file doesn't look like a meal-planner backup." };
  }

  const incoming = normalizeState(parsed);
  if (mode === 'merge') {
    const existing = new Set(state.recipes.map((r) => r.title.trim().toLowerCase()));
    let added = 0;
    for (const recipe of incoming.recipes) {
      if (existing.has(recipe.title.trim().toLowerCase())) continue;
      addRecipe({ ...recipe });
      added += 1;
    }
    return { ok: true, recipes: added };
  }

  state = incoming;
  persist();
  return { ok: true, recipes: state.recipes.length };
}

/** Wipe everything. Used by the "delete all data" control. */
export function clearAll() {
  state = emptyState();
  persist();
}
