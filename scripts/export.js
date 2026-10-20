// Export the SQLite database to the static JSON bundle the website loads.
// Usage: npm run export
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb, ROOT } from './lib/db.js';

const OUT_DIR = resolve(ROOT, 'public', 'data');

// Ids are derived from machine + wording so a player's progress survives re-extraction
// as long as a questline/step keeps its title.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hashId = (...parts) => createHash('sha1').update(parts.map(norm).join('|')).digest('hex').slice(0, 12);

const db = openDb();
const machines = db
  .prepare(
    `SELECT m.id, m.name, m.manufacturer, m.released, m.designer, m.rules_by, m.url,
            (SELECT COUNT(*) FROM questlines q WHERE q.machine_id = m.id) AS questline_count,
            (SELECT COUNT(*) FROM steps s JOIN questlines q ON q.id = s.questline_id
              WHERE q.machine_id = m.id AND s.variant != 'all') AS variant_steps
     FROM machines m ORDER BY m.sort_order`,
  )
  .all()
  .map(({ variant_steps, ...m }) => ({ ...m, has_variants: variant_steps > 0 }));

const questlines = db.prepare('SELECT * FROM questlines ORDER BY machine_id, position').all();
const steps = db.prepare('SELECT * FROM steps ORDER BY questline_id, position').all();
const stepsByQuest = Map.groupBy(steps, (s) => s.questline_id);

const byMachine = {};
let stepCount = 0;
for (const q of questlines) {
  const qid = hashId(q.machine_id, q.title);
  const qsteps = (stepsByQuest.get(q.id) ?? []).map((s) => ({
    id: hashId(q.machine_id, q.title, s.title),
    t: s.title,
    d: s.description,
    v: s.variant,
    sec: s.section,
    a: s.anchor,
  }));
  stepCount += qsteps.length;
  (byMachine[q.machine_id] ??= []).push({ id: qid, t: q.title, s: q.summary, c: q.category, steps: qsteps });
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(resolve(OUT_DIR, 'objectives.json'), { force: true }); // pre-questline format
const generated = new Date().toISOString();
writeFileSync(resolve(OUT_DIR, 'machines.json'), JSON.stringify({ generated, machines }));
writeFileSync(resolve(OUT_DIR, 'questlines.json'), JSON.stringify({ generated, questlines: byMachine }));

const withQuests = machines.filter((m) => m.questline_count > 0).length;
console.log(`Exported ${machines.length} machines (${withQuests} with questlines), ${questlines.length} questlines, ${stepCount} steps → public/data/`);
db.close();
