// Shared helpers: theme toggle, browser storage, data loading.

const STORE_KEY = 'pinball-missions.v1';

const DEFAULT_STATE = {
  // [{ id, name, machines: [machineId], variants: { machineId: 'pro' | 'premium_le' }, pinballMap: { id, name, link } | null }]
  locations: [],
  activeLocationId: null,
  completed: {}, // stepId -> ISO date
  settings: { preference: 'continue', count: 5 }, // preference: 'continue' | 'new' | 'any'
  mission: null, // { locationId, created, items: [{ machineId, questlineId }] }
};

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadState() {
  let saved = {};
  try {
    saved = JSON.parse(safeGet(STORE_KEY) ?? '{}') ?? {};
  } catch {}
  const state = {
    ...structuredClone(DEFAULT_STATE),
    ...saved,
    settings: { ...DEFAULT_STATE.settings, ...(saved.settings ?? {}) },
  };
  for (const loc of state.locations) loc.variants ??= {};
  if (state.mission && !state.mission.items?.every((it) => it.questlineId)) state.mission = null; // pre-questline format
  return state;
}

export function saveState(state) {
  if (!safeSet(STORE_KEY, JSON.stringify(state))) {
    showStorageWarning();
  }
}

let warned = false;
function showStorageWarning() {
  if (warned) return;
  warned = true;
  const main = document.querySelector('#main_content');
  main?.insertAdjacentHTML(
    'afterbegin',
    '<p class="notice error">Your browser is blocking local storage, so locations and progress won\'t be saved after you leave this page.</p>',
  );
}

export function activeLocation(state) {
  return state.locations.find((l) => l.id === state.activeLocationId) ?? state.locations[0] ?? null;
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

let dataPromise;
/** Loads the machines + questlines bundle once. Returns { machines, byId, questlines, generated }. */
export function loadData() {
  dataPromise ??= Promise.all([
    fetch('/data/machines.json').then((r) => r.json()),
    fetch('/data/questlines.json').then((r) => r.json()),
  ]).then(([m, q]) => {
    const byId = new Map(m.machines.map((x) => [x.id, x]));
    return { machines: m.machines, byId, questlines: q.questlines, generated: m.generated };
  });
  return dataPromise;
}

export const VARIANT_LABELS = { pro: 'Pro', premium_le: 'Premium/LE' };

/** Steps that apply to the machine's model; unknown model ('' / undefined) shows every step. */
export function visibleSteps(questline, variant) {
  return questline.steps.filter((s) => s.v === 'all' || !variant || s.v === variant);
}

/** { done, total } for a questline given completed steps and the machine's model. */
export function questProgress(questline, variant, completed) {
  const steps = visibleSteps(questline, variant);
  return { done: steps.filter((s) => completed[s.id]).length, total: steps.length };
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function rulesheetLink(machine, step) {
  return step?.a ? `${machine.url}#${step.a}` : machine.url;
}

// Theme toggle (the initial class is set by an inline script in <head> to avoid a flash).
function initTheme() {
  const btn = document.getElementById('dark-mode-toggle');
  if (!btn) return;
  const sync = () => {
    const dark = document.documentElement.classList.contains('dark-mode');
    btn.textContent = dark ? '☀' : '☾';
    btn.setAttribute('aria-pressed', String(dark));
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  };
  btn.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark-mode');
    safeSet('pinball-missions.theme', dark ? 'dark' : 'light');
    sync();
  });
  sync();
}

initTheme();
