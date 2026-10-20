import { loadState, saveState, loadData, activeLocation, escapeHtml, newId, questProgress } from './common.js';

const state = loadState();
const data = await loadData();
const $ = (id) => document.getElementById(id);

/** Returns the active location, creating a default one if the player has none yet. */
function ensureLocation() {
  let loc = activeLocation(state);
  if (!loc) {
    loc = { id: newId(), name: 'My location', machines: [], variants: {}, pinballMap: null };
    state.locations.push(loc);
    state.activeLocationId = loc.id;
  }
  return loc;
}

function persist() {
  saveState(state);
  renderLocationBar();
  renderSelectedCount();
  renderProgress();
}

// ---------- Locations ----------
function renderLocationBar() {
  const loc = activeLocation(state);
  const bar = $('location-bar');
  if (!loc) {
    bar.innerHTML = `<span class="muted">No locations yet. Check some machines below, or</span>
      <button type="button" data-loc="new">New location</button>`;
    return;
  }
  bar.innerHTML = `
    <label for="loc-select" class="small">Editing:</label>
    <select id="loc-select">${state.locations
      .map((l) => `<option value="${l.id}" ${l.id === loc.id ? 'selected' : ''}>${escapeHtml(l.name)} (${l.machines.length})</option>`)
      .join('')}</select>
    <button type="button" data-loc="new">New</button>
    <button type="button" data-loc="rename">Rename</button>
    <button type="button" data-loc="delete">Delete</button>
    ${loc.pinballMap ? `<span class="small muted">Imported from <a href="${escapeHtml(loc.pinballMap.link)}" target="_blank" rel="noopener">${escapeHtml(loc.pinballMap.name)} on Pinball Map</a></span>` : ''}`;
}

function createLocation(name, machines = [], pinballMap = null, variants = {}) {
  const loc = { id: newId(), name, machines, variants, pinballMap };
  state.locations.push(loc);
  state.activeLocationId = loc.id;
  return loc;
}

$('location-bar').addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.loc;
  if (!action) return;
  const loc = activeLocation(state);
  if (action === 'new') {
    const name = prompt('Name for the new location:', '')?.trim();
    if (!name) return;
    createLocation(name);
  } else if (action === 'rename' && loc) {
    const name = prompt('Rename location:', loc.name)?.trim();
    if (!name) return;
    loc.name = name;
  } else if (action === 'delete' && loc) {
    if (!confirm(`Delete "${loc.name}"? Your completed objectives are kept.`)) return;
    state.locations = state.locations.filter((l) => l.id !== loc.id);
    state.activeLocationId = state.locations[0]?.id ?? null;
    if (state.mission?.locationId === loc.id) state.mission = null;
  }
  persist();
  renderMachines();
});

$('location-bar').addEventListener('change', (e) => {
  if (e.target.id !== 'loc-select') return;
  state.activeLocationId = e.target.value;
  persist();
  renderMachines();
});

// ---------- Machine checklist ----------
function machineMeta(m, variant) {
  const quests = data.questlines[m.id] ?? [];
  if (!quests.length) return 'no questlines yet';
  const complete = quests.filter((q) => {
    const p = questProgress(q, variant, state.completed);
    return p.total && p.done === p.total;
  }).length;
  const started = quests.some((q) => questProgress(q, variant, state.completed).done);
  return started ? `${complete}/${quests.length} questlines complete` : `${quests.length} questlines`;
}

function variantSelect(m, variant) {
  return `<select class="variant-select" data-variant-for="${escapeHtml(m.id)}" aria-label="Model of ${escapeHtml(m.name)}">
    <option value="" ${!variant ? 'selected' : ''}>model?</option>
    <option value="pro" ${variant === 'pro' ? 'selected' : ''}>Pro</option>
    <option value="premium_le" ${variant === 'premium_le' ? 'selected' : ''}>Premium/LE</option>
  </select>`;
}

function renderMachines() {
  const loc = activeLocation(state);
  const selected = new Set(loc?.machines ?? []);
  const variants = loc?.variants ?? {};
  const groups = new Map();
  for (const m of data.machines) {
    if (!groups.has(m.manufacturer)) groups.set(m.manufacturer, []);
    groups.get(m.manufacturer).push(m);
  }
  let html = '';
  for (const [manufacturer, machines] of groups) {
    html += `<div class="manufacturer" data-manufacturer="${escapeHtml(manufacturer)}">
      <h3 class="manufacturer-heading">${escapeHtml(manufacturer)}
        <span class="small"><button type="button" class="link" data-all="1">all</button> · <button type="button" class="link" data-all="0">none</button></span>
      </h3>
      <ul class="machine-list">${machines
        .map((m) => {
          const isSelected = selected.has(m.id);
          return `<li data-name="${escapeHtml(m.name.toLowerCase())}">
            <label><input type="checkbox" value="${escapeHtml(m.id)}" ${isSelected ? 'checked' : ''}>${escapeHtml(m.name)}</label>
            <span class="small muted">${m.released ? escapeHtml(m.released.replace(/^\w+ /, '')) + ' · ' : ''}${machineMeta(m, variants[m.id])}</span>
            ${isSelected && m.has_variants ? variantSelect(m, variants[m.id]) : ''}
          </li>`;
        })
        .join('')}</ul></div>`;
  }
  $('machines').innerHTML = html;
  applyFilter();
  renderSelectedCount();
}

function setSelected(ids, on) {
  const loc = ensureLocation();
  const set = new Set(loc.machines);
  for (const id of ids) {
    if (on) set.add(id);
    else {
      set.delete(id);
      delete loc.variants[id];
    }
  }
  // keep master-list order
  loc.machines = data.machines.map((m) => m.id).filter((id) => set.has(id));
  persist();
  renderMachines(); // show/hide model selectors
}

$('machines').addEventListener('change', (e) => {
  if (e.target.dataset.variantFor) {
    const loc = ensureLocation();
    if (e.target.value) loc.variants[e.target.dataset.variantFor] = e.target.value;
    else delete loc.variants[e.target.dataset.variantFor];
    persist();
    return renderMachines();
  }
  if (e.target.type !== 'checkbox') return;
  setSelected([e.target.value], e.target.checked);
});

$('machines').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-all]');
  if (!btn) return;
  const group = btn.closest('.manufacturer');
  const boxes = [...group.querySelectorAll('li:not([hidden]) input[type=checkbox]')];
  const on = btn.dataset.all === '1';
  boxes.forEach((b) => (b.checked = on));
  setSelected(boxes.map((b) => b.value), on);
});

function applyFilter() {
  const q = $('filter').value.trim().toLowerCase();
  for (const group of document.querySelectorAll('.manufacturer')) {
    let visible = 0;
    for (const li of group.querySelectorAll('li')) {
      li.hidden = Boolean(q) && !li.dataset.name.includes(q);
      if (!li.hidden) visible++;
    }
    group.hidden = visible === 0;
  }
}
$('filter').addEventListener('input', applyFilter);

function renderSelectedCount() {
  const loc = activeLocation(state);
  $('selected-count').textContent = loc ? `${loc.machines.length} selected for ${loc.name}` : '';
}

// ---------- Pinball Map import ----------
const EDITION_WORDS = /\b(pro|premium|le|limited edition|collectors? edition|ce|se|special edition|standard edition|anniversary edition|home edition)\b/g;

function normalize(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .replace(EDITION_WORDS, ' ')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const index = data.machines.map((m) => ({ machine: m, key: normalize(m.name) }));

// Pinball Map and the rulesheet master list spell manufacturers differently
// ("Jersey Jack" vs "Jersey Jack Pinball", "Pinball Brothers" vs "Heighway Pinball/Pinball Brothers"),
// so both are reduced to a family key. Bally/Midway share Williams's lineage; Premier is Gottlieb's.
const MAKER_FAMILIES = [
  ['jjp', /jersey jack|\bjjp\b/],
  ['brothers', /heighway|pinball brothers/],
  ['williams', /williams|bally|midway|\bwms\b/],
  ['gottlieb', /gottlieb|premier/],
  ['american', /american pinball/],
  ['chicago', /chicago gaming|\bcgc\b/],
  ['barrels', /barrels of fun/],
  ['data east', /data east/],
  ['stern', /\bstern\b/],
  ['spooky', /spooky/],
  ['multimorphic', /multimorphic/],
  ['capcom', /capcom/],
];

function makerKey(name) {
  const n = (name ?? '').toLowerCase();
  if (!n.trim()) return null;
  // Unlisted makers (Chicago Coin, Atari, …) get their own key, so they can't collide with a family above.
  return MAKER_FAMILIES.find(([, re]) => re.test(n))?.[0] ?? `other:${n.replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

const releaseYear = (machine) => Number(machine.released?.match(/\d{4}/)?.[0]) || null;

/** Unknown on either side counts as compatible; only a contradiction rejects. */
function sameMaker(pm, machine) {
  const a = makerKey(pm.manufacturer);
  const b = makerKey(machine.manufacturer);
  return !a || !b || a === b;
}

/**
 * A machine can't predate the game it's matched to, so an earlier year means an older, different
 * game (Stern's 2006 Pirates vs JJP's 2018). Later years are allowed: same-maker reissues and
 * special editions (Godzilla 70th Anniversary, Spider-Man Vault Edition) run the original's rules.
 * One year of slack covers Pinball Map's year vs the master list's release month.
 */
function closeYear(pm, machine) {
  const a = Number(pm.year) || null;
  const b = releaseYear(machine);
  return !a || !b || a >= b - 1;
}

function matchMachine(pm) {
  const key = normalize(pm.name);
  if (!key) return null;
  let candidates = index.filter((x) => x.key === key);
  if (!candidates.length) {
    // e.g. "Star Wars" (Pinball Map) vs "Star Wars: Fall of the Empire" (rulesheet) are different games,
    // so only accept a prefix match when it is a subtitle split on a colon/dash in either name.
    candidates = index.filter((x) => {
      const [a, b] = x.key.length > key.length ? [x.key, key] : [key, x.key];
      return a.startsWith(b + ' ') && b.split(' ').length >= 2;
    });
  }
  // Same title is not the same game: Pirates of the Caribbean is both Stern 2006 and JJP 2018.
  // Drop any candidate whose manufacturer contradicts Pinball Map, or that was released after it.
  candidates = candidates.filter((x) => sameMaker(pm, x.machine) && closeYear(pm, x.machine));
  if (candidates.length > 1 && pm.year) {
    const byYear = candidates.filter((x) => releaseYear(x.machine) === Number(pm.year));
    if (byYear.length) candidates = byYear;
  }
  if (candidates.length > 1) {
    // Last resort, e.g. "Jurassic Park (Home Edition)" vs "Jurassic Park (Stern)": most shared raw words wins.
    const words = (s) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const pmWords = words(pm.name);
    const score = (x) => [...words(x.machine.name)].filter((w) => pmWords.has(w)).length - words(x.machine.name).size / 100;
    candidates = [...candidates].sort((a, b) => score(b) - score(a));
  }
  return candidates[0]?.machine ?? null;
}

/** Model from a Pinball Map machine name like "Godzilla (Premium)"; '' when not stated. */
function detectVariant(name) {
  const n = name.toLowerCase();
  if (/\b(pro|standard)\b/.test(n)) return 'pro'; // JJP calls its base model "Standard Edition"
  if (/\b(premium|le|limited edition)\b/.test(n)) return 'premium_le';
  return '';
}

async function api(params) {
  const res = await fetch(`/api/pinballmap?${new URLSearchParams(params)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

const pmOut = $('pm-output');
let pmVenue = null;
let pmResults = []; // search results already include each venue's machines

$('pm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  pmOut.innerHTML = '<p class="muted">Searching…</p>';
  try {
    const { results, total } = await api({ name: $('pm-query').value.trim() });
    pmResults = results;
    if (results.length === 1) return showVenue(results[0]);
    pmOut.innerHTML = results.length
      ? `<p class="small muted">${total > results.length ? `Showing ${results.length} of ${total} venues; refine your search to narrow it down.` : `${results.length} venues found.`}</p>
        <ul class="pm-results">${results
          .map(
            (r, i) => `<li><button type="button" class="link" data-pm-index="${i}">${escapeHtml(r.name)}</button>
              <span class="small muted">${r.city ? escapeHtml(r.city) + ' · ' : ''}${r.machines.length} machines</span></li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">No venues found.</p>';
  } catch (err) {
    pmOut.innerHTML = `<p class="notice error">${escapeHtml(err.message)}</p>`;
  }
});

pmOut.addEventListener('click', (e) => {
  const pick = e.target.closest('button[data-pm-index]');
  if (pick) return showVenue(pmResults[Number(pick.dataset.pmIndex)]);
  const apply = e.target.closest('button[data-pm-apply]');
  if (apply) return applyVenue(apply.dataset.pmApply);
});

function showVenue(venue) {
  if (!venue) return;
  const matched = [];
  const unmatched = [];
  const variants = {};
  for (const pm of venue.machines) {
    const m = matchMachine(pm);
    if (!m) {
      unmatched.push(pm.name);
      continue;
    }
    if (!matched.some((x) => x.id === m.id)) matched.push(m);
    const v = detectVariant(pm.name);
    if (v && m.has_variants) variants[m.id] = v;
  }
  pmVenue = { ...venue, matched, variants };
  const loc = activeLocation(state);
  pmOut.innerHTML = `
    <h3><a href="${escapeHtml(venue.link)}" target="_blank" rel="noopener">${escapeHtml(venue.name)}</a>${venue.city ? ` <span class="small muted">${escapeHtml(venue.city)}</span>` : ''}</h3>
    <p class="small muted">View this venue's listing on Pinball Map for current lineup details.</p>
    <p><strong>${matched.length}</strong> of ${venue.machines.length} machines have rulesheets here:</p>
    <ul>${matched.map((m) => `<li>${escapeHtml(m.name)}${variants[m.id] ? ` <span class="tag">${variants[m.id] === 'pro' ? 'Pro' : 'Premium/LE'}</span>` : ''}</li>`).join('') || '<li class="muted">none</li>'}</ul>
    ${unmatched.length ? `<p class="small muted">No rulesheet for: ${unmatched.map(escapeHtml).join(', ')}.</p>` : ''}
    <div class="actions">
      <button type="button" data-pm-apply="new" ${matched.length ? '' : 'disabled'}>Save as new location "${escapeHtml(venue.name)}"</button>
      ${loc ? `<button type="button" data-pm-apply="replace" ${matched.length ? '' : 'disabled'}>Replace machines in "${escapeHtml(loc.name)}"</button>` : ''}
    </div>`;
}

function applyVenue(mode) {
  if (!pmVenue) return;
  const ids = pmVenue.matched.map((m) => m.id);
  const ref = { id: pmVenue.id, name: pmVenue.name, link: pmVenue.link };
  if (mode === 'new') {
    createLocation(pmVenue.name, ids, ref, { ...pmVenue.variants });
  } else {
    const loc = ensureLocation();
    loc.machines = ids;
    loc.variants = { ...pmVenue.variants };
    loc.pinballMap = ref;
  }
  persist();
  renderMachines();
  pmOut.innerHTML = `<p class="notice">Saved ${ids.length} machines to "${escapeHtml(activeLocation(state).name)}". <a href="/">Generate a mission →</a></p>`;
}

// ---------- Progress backup ----------
function renderProgress() {
  const quests = Object.values(data.questlines).flat();
  const steps = quests.flatMap((q) => q.steps);
  const doneSteps = steps.filter((s) => state.completed[s.id]).length;
  const doneQuests = quests.filter((q) => q.steps.every((s) => s.v !== 'all' || state.completed[s.id]) && q.steps.some((s) => state.completed[s.id])).length;
  $('progress-summary').textContent = `${doneSteps} of ${steps.length} steps checked off; ${doneQuests} of ${quests.length} questlines complete.`;
}

$('export-progress').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'pinball-missions', version: 1, ...state }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `pinball-missions-backup-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import-progress').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== 'pinball-missions' || !Array.isArray(backup.locations)) throw new Error('not a Pinball Missions backup');
    if (!confirm('Replace your current locations and progress with this backup?')) return;
    for (const key of ['locations', 'activeLocationId', 'completed', 'settings', 'mission']) state[key] = backup[key] ?? state[key];
    persist();
    renderMachines();
  } catch (err) {
    alert(`Could not restore backup: ${err.message}`);
  } finally {
    e.target.value = '';
  }
});

renderLocationBar();
renderMachines();
renderProgress();
