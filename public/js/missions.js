import {
  loadState,
  saveState,
  loadData,
  activeLocation,
  escapeHtml,
  rulesheetLink,
  visibleSteps,
  questProgress,
  VARIANT_LABELS,
} from './common.js';

const state = loadState();
const data = await loadData();

const $ = (id) => document.getElementById(id);
const form = $('mission-form');
const missionEl = $('mission');

const random = (arr) => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const variantOf = (loc, machineId) => loc?.variants?.[machineId] ?? '';

/** Machines at a location that have questlines. */
function playableMachines(location) {
  return (location?.machines ?? []).filter((id) => data.byId.has(id) && data.questlines[id]?.length);
}

/** Questlines for a machine with at least one step applicable to its model. */
function questlinesFor(loc, machineId) {
  return (data.questlines[machineId] ?? []).filter((q) => visibleSteps(q, variantOf(loc, machineId)).length);
}

/** Pick a questline for a machine following the continue/new preference, avoiding `avoidId` if possible. */
function pickQuestline(loc, machineId, avoidId = null) {
  const variant = variantOf(loc, machineId);
  const all = questlinesFor(loc, machineId).filter((q) => q.id !== avoidId);
  const withProgress = all.map((q) => ({ q, ...questProgress(q, variant, state.completed) }));
  const unfinished = withProgress.filter((x) => x.done < x.total);
  const pool = unfinished.length ? unfinished : withProgress; // everything finished? allow replays
  const started = pool.filter((x) => x.done > 0);
  const fresh = pool.filter((x) => x.done === 0);
  const pref = state.settings.preference;
  const preferred = pref === 'continue' ? started : pref === 'new' ? fresh : pool;
  return random(preferred.length ? preferred : pool)?.q ?? null;
}

function findQuestline(machineId, questlineId) {
  return data.questlines[machineId]?.find((q) => q.id === questlineId) ?? null;
}

function renderForm() {
  if (!state.locations.length) {
    $('setup-needed').hidden = false;
    form.hidden = true;
    return;
  }
  form.hidden = false;
  const loc = activeLocation(state);
  $('location').innerHTML = state.locations
    .map((l) => `<option value="${l.id}" ${l.id === loc.id ? 'selected' : ''}>${escapeHtml(l.name)} (${playableMachines(l).length} machines)</option>`)
    .join('');
  $('preference').value = state.settings.preference;
  renderCountOptions();
}

function renderCountOptions() {
  const n = playableMachines(activeLocation(state)).length;
  const opts = [];
  for (let i = 1; i <= Math.min(n, 12); i++) opts.push(`<option value="${i}">${i}</option>`);
  opts.push(`<option value="0">All (${n})</option>`);
  $('count').innerHTML = opts.join('');
  const want = state.settings.count;
  $('count').value = want && want <= Math.min(n, 12) ? String(want) : '0';
  $('generate').disabled = n === 0;
}

function generate() {
  const loc = activeLocation(state);
  const machines = shuffle(playableMachines(loc));
  const count = state.settings.count || machines.length;
  const items = [];
  for (const machineId of machines) {
    if (items.length >= count) break;
    const q = pickQuestline(loc, machineId);
    if (q) items.push({ machineId, questlineId: q.id });
  }
  state.mission = { locationId: loc.id, created: new Date().toISOString(), items };
  saveState(state);
  renderMission();
}

function renderItem(loc, item, index) {
  const machine = data.byId.get(item.machineId);
  const quest = findQuestline(item.machineId, item.questlineId);
  if (!machine || !quest) return '';
  const variant = variantOf(loc, item.machineId);
  const steps = visibleSteps(quest, variant);
  const nextIndex = steps.findIndex((s) => !state.completed[s.id]);
  const { done, total } = questProgress(quest, variant, state.completed);
  const options = questlinesFor(loc, item.machineId)
    .map((q) => {
      const p = questProgress(q, variant, state.completed);
      const mark = p.done === p.total ? ' ✓' : p.done ? ` (${p.done}/${p.total})` : '';
      return `<option value="${q.id}" ${q.id === quest.id ? 'selected' : ''}>${escapeHtml(q.t)}${mark}</option>`;
    })
    .join('');
  const stepItems = steps
    .map((s, i) => {
      const isDone = Boolean(state.completed[s.id]);
      const tag = s.v !== 'all' ? ` <span class="tag">${VARIANT_LABELS[s.v]} only</span>` : '';
      const cls = isDone ? 'done' : i === nextIndex ? 'next' : '';
      return `<li class="${cls}">
        <label><input type="checkbox" data-step="${s.id}" ${isDone ? 'checked' : ''}>
          <span class="step-title">${escapeHtml(s.t)}</span></label>${i === nextIndex ? ' <span class="next-mark">← next</span>' : ''}${tag}
        <div class="step-desc">${escapeHtml(s.d)} <a class="small" href="${escapeHtml(rulesheetLink(machine, s))}" target="_blank" rel="noopener">rulesheet</a></div>
      </li>`;
    })
    .join('');
  const variantNote = machine.has_variants && !variant
    ? `<span class="small muted"> · model not set, showing steps for all models (<a href="/machines#machine-list">set it</a>)</span>`
    : variant ? `<span class="small muted"> · ${VARIANT_LABELS[variant]}</span>` : '';
  return `<div class="quest-card" data-index="${index}">
    <h3>${escapeHtml(machine.name)}: ${escapeHtml(quest.t)}</h3>
    <p class="small muted">${escapeHtml(machine.manufacturer)}${variantNote} · ${done} of ${total} steps${done === total ? ' · <span class="done-mark">✓ questline complete</span>' : ''}</p>
    <p>${escapeHtml(quest.s)}</p>
    <ol class="steps">${stepItems}</ol>
    <div class="actions small">
      <label for="q-${index}">Questline:</label>
      <select id="q-${index}" data-switch="${index}">${options}</select>
      <button type="button" class="link" data-reroll="${index}">random</button>
    </div>
  </div>`;
}

function renderMission() {
  const m = state.mission;
  const loc = state.locations.find((l) => l.id === m?.locationId);
  if (!m || !loc) {
    missionEl.innerHTML = '';
    return;
  }
  const cards = m.items.map((item, i) => renderItem(loc, item, i)).join('<hr>');
  missionEl.innerHTML = `
    <h2 id="current-mission">Your mission: ${escapeHtml(loc.name)}</h2>
    ${m.items.length ? cards : '<p class="notice">None of these machines have questlines yet.</p>'}
    <div class="actions"><button type="button" id="regenerate">New mission</button></div>`;
}

missionEl.addEventListener('click', (e) => {
  if (e.target.closest('#regenerate')) return generate();
  const btn = e.target.closest('button[data-reroll]');
  if (!btn) return;
  const item = state.mission.items[Number(btn.dataset.reroll)];
  const loc = state.locations.find((l) => l.id === state.mission.locationId);
  const q = pickQuestline(loc, item.machineId, item.questlineId);
  if (q) item.questlineId = q.id;
  saveState(state);
  renderMission();
});

missionEl.addEventListener('change', (e) => {
  const stepId = e.target.dataset.step;
  if (stepId) {
    if (e.target.checked) state.completed[stepId] = new Date().toISOString();
    else delete state.completed[stepId];
  } else if (e.target.dataset.switch) {
    state.mission.items[Number(e.target.dataset.switch)].questlineId = e.target.value;
  } else return;
  saveState(state);
  renderMission();
});

form.addEventListener('change', (e) => {
  if (e.target.id === 'location') {
    state.activeLocationId = e.target.value;
    renderCountOptions();
  }
  state.settings.preference = $('preference').value;
  state.settings.count = Number($('count').value);
  saveState(state);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  generate();
  $('current-mission')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

renderForm();
renderMission();
