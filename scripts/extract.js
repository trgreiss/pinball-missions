// Turn each rulesheet into a list of concrete in-game objectives using Claude, and store them.
// Only machines whose rulesheet changed since the last extraction are processed.
// Usage: npm run extract [-- --only fallout] [--force] [--limit 5]
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { openDb, parseArgs, matchesOnly, transaction, CATEGORIES, VARIANTS } from './lib/db.js';

const MODEL = 'claude-sonnet-5-5';
const CONCURRENCY = 3;
// Sonnet 5.5 list prices, $ per million tokens (input, output, cache read).
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

const StepSchema = z.object({
  title: z.string().describe('Short imperative goal, e.g. "Qualify Mechagodzilla Multiball". Under 70 characters.'),
  description: z
    .string()
    .describe('1-2 short sentences on how to accomplish this step, using only facts from the rulesheet (shots, counts, lit inserts).'),
  variant: z
    .enum(VARIANTS)
    .describe('"all" unless the sheet says this step only exists or works differently on a specific model; "pro" for Pro-only, "premium_le" for Premium/LE-only.'),
  section: z.string().describe('Rulesheet heading this step comes from, exactly as written.'),
  anchor: z.string().describe('The {#...} id of that heading, without braces or "#", e.g. "heading--deathclaw-multiball". Empty string if none.'),
});
const QuestlineSchema = z.object({
  title: z.string().describe('Name of the feature the chain builds toward, e.g. "Mechagodzilla Multiball". Under 50 characters.'),
  summary: z.string().describe('One sentence: what the questline progresses through and where it ends up.'),
  // A plain string (normalized below): an off-list label shouldn't fail a whole machine.
  category: z.string().describe(`The main kind of feature this questline is about: one of ${CATEGORIES.join(', ')}.`),
  steps: z.array(StepSchema).describe('Ordered from the first thing a player must do to the deepest goal.'),
});
const ResultSchema = z.object({ questlines: z.array(QuestlineSchema) });

const SYSTEM = `You turn a community pinball rulesheet into questlines: ordered chains of in-game goals for one machine.

Players use these while learning a game. They can't pause mid-game to look up what comes next, so each questline shows the whole path: what they're working on now and what it leads to. Seeing "qualify it -> start it -> collect jackpots -> light and score the super jackpot -> qualify the mini-wizard" tells a player what to aim for after each small success.

Example, for Stern's Godzilla, a "Mechagodzilla Multiball" questline: qualify Mechagodzilla Multiball -> start it -> collect jackpots to qualify the super jackpot -> score the super jackpot -> qualify the Terror of Mechagodzilla mini-wizard mode. (Use the real conditions from the sheet for each step.)

Building questlines:
- Follow the rulesheet's own progression: what must be qualified, started, advanced, and completed, in the order the game requires, and what each feature feeds into (mini-wizard modes, wizard modes, mode sets).
- Each questline has 2-7 steps. Each step is something a player can recognize having done during a game, phrased as an imperative ("Qualify ...", "Start ...", "Collect a jackpot in ...", "Complete ...").
- Make one questline per major mode, multiball, or progression system the sheet describes, and end each one at the deepest goal it leads to. A wizard mode can be the final step of the questlines that feed it; also give a major wizard mode its own questline when it has several prerequisites.
- Small standalone features (skill shots, extra balls, hurry-ups, toys) are worth including when they have their own progression, e.g. "make the skill shot -> make the super skill shot". Group related small features into one questline rather than making one-step questlines.
- Typical games support 4-12 questlines. A short or incomplete sheet supports fewer; write as few as 1 rather than padding with guesses.
- Only include achievements. Leave out setup choices with nothing to accomplish (picking a character, choosing a song), passive scoring facts, operator settings, and anything the sheet marks as not implemented, "to be discovered", or "please stand by".
- Use shot names, counts, and conditions from the rulesheet. Never invent rules that are not in the sheet; if the sheet is vague, keep the step general.
- Model variants: when the sheet says a feature or shot exists only on Pro or only on Premium/LE (or works differently on them), mark that step's variant. If the two models need different steps, write each as its own step with its variant.
- Headings in the sheet end with an id like {#heading--vault-multiball}; put that id (without braces and #) in "anchor" and the heading text in "section".`;

function usageCost(u) {
  return (
    ((u.input_tokens ?? 0) * PRICE.input +
      (u.output_tokens ?? 0) * PRICE.output +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
    1e6
  );
}

function normalizeCategory(raw) {
  const c = raw.toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (CATEGORIES.includes(c)) return c;
  if (c.includes('wizard')) return 'wizard';
  if (c.includes('multiball')) return 'multiball';
  if (c.includes('skill')) return 'skill_shot';
  if (c.includes('extra')) return 'extra_ball';
  if (c.includes('side') || c.includes('hurry')) return 'side_mode';
  if (c.includes('scor') || c.includes('jackpot') || c.includes('bonus')) return 'scoring';
  if (c.includes('mode')) return 'mode';
  return 'mechanic';
}

async function extractOne(client, machine, markdown) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(ResultSchema) },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Machine: ${machine.name} (${machine.manufacturer}${machine.released ? ', ' + machine.released : ''})\n\n<rulesheet>\n${markdown}\n</rulesheet>`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') throw new Error(`refused (${response.stop_details?.category ?? 'unknown'})`);
  if (response.stop_reason === 'max_tokens') throw new Error('hit max_tokens');
  if (!response.parsed_output) throw new Error('no parsed output');
  const questlines = response.parsed_output.questlines
    .map((q) => ({
      ...q,
      category: normalizeCategory(q.category),
      steps: q.steps.filter((s) => s.title.trim() && s.description.trim()),
    }))
    .filter((q) => q.title.trim() && q.steps.length);
  return { questlines, usage: response.usage };
}

async function main() {
  const args = parseArgs();
  const db = openDb();
  const rows = db
    .prepare(
      `SELECT m.id, m.name, m.manufacturer, m.released, m.content_hash, m.extracted_hash, t.markdown
       FROM machines m JOIN rulesheet_text t ON t.machine_id = m.id ORDER BY m.sort_order`,
    )
    .all();
  let todo = rows.filter((r) => matchesOnly(r.id, args.only) && (args.force || r.content_hash !== r.extracted_hash));
  if (args.limit) todo = todo.slice(0, args.limit);
  if (!todo.length) {
    console.log('Nothing to extract: all rulesheets are unchanged since the last run.');
    return;
  }
  console.log(`Extracting questlines for ${todo.length} machine(s) with ${MODEL}…`);

  const client = new Anthropic();
  const del = db.prepare('DELETE FROM questlines WHERE machine_id = ?');
  const insQuest = db.prepare('INSERT INTO questlines (machine_id, position, title, summary, category) VALUES (?, ?, ?, ?, ?)');
  const insStep = db.prepare(`INSERT INTO steps (questline_id, position, title, description, variant, section, anchor)
                              VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const mark = db.prepare('UPDATE machines SET extracted_hash = ?, extracted_at = ? WHERE id = ?');

  let totalCost = 0;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const m = todo[next++];
      try {
        let result;
        try {
          result = await extractOne(client, m, m.markdown);
        } catch (err) {
          if (err instanceof Anthropic.APIError) throw err;
          console.warn(`${m.id}: ${err.message.split('\n')[0]}; retrying once`);
          result = await extractOne(client, m, m.markdown);
        }
        const { questlines, usage } = result;
        transaction(db, () => {
          del.run(m.id);
          questlines.forEach((q, qi) => {
            const { lastInsertRowid } = insQuest.run(m.id, qi, q.title.trim(), q.summary.trim(), q.category);
            q.steps.forEach((s, si) => {
              insStep.run(lastInsertRowid, si, s.title.trim(), s.description.trim(), s.variant, s.section || null, s.anchor || null);
            });
          });
          mark.run(m.content_hash, new Date().toISOString(), m.id);
        });
        const cost = usageCost(usage);
        totalCost += cost;
        const steps = questlines.reduce((n, q) => n + q.steps.length, 0);
        console.log(`${m.id}: ${questlines.length} questlines, ${steps} steps, $${cost.toFixed(3)}`);
      } catch (err) {
        failed++;
        console.error(`${m.id}: FAILED ${err.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  console.log(`Done. ${todo.length - failed} ok, ${failed} failed. Estimated cost $${totalCost.toFixed(2)}.`);
  db.close();
}

main().catch((err) => {
  if (err instanceof Anthropic.AuthenticationError) {
    console.error('Anthropic authentication failed. Put ANTHROPIC_API_KEY in .env (see .env.example).');
  } else {
    console.error(err);
  }
  process.exit(1);
});
