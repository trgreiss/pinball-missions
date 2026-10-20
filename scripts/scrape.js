// Scrape the pinballrulesheets.com master list and every linked rulesheet into SQLite.
// Usage: npm run scrape [-- --only fallout,godzilla]
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { createHash } from 'node:crypto';
import { openDb, parseArgs, matchesOnly, transaction } from './lib/db.js';

const BASE = 'https://pinballrulesheets.com';
const USER_AGENT = 'PinballMissions/0.1 (objective generator; polite scraper)';
const DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** "/stern/fallout-rulesheet" -> "stern/fallout" */
function slugFromPath(path) {
  return path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/-rulesheet$/, '');
}

async function scrapeMasterList() {
  const $ = cheerio.load(await get(`${BASE}/rulesheet-master-list`));
  const machines = [];
  const skipped = [];
  let order = 0;
  $('#main_content h2[id^="heading--"]').each((_, h2) => {
    const manufacturer = clean($(h2).text()).replace(/:$/, '');
    const table = $(h2).nextAll('table').first();
    table.find('tbody tr').each((_, tr) => {
      const cells = $(tr).find('td');
      const link = $(cells[0]).find('a').first();
      const name = clean($(cells[0]).text());
      const href = link.attr('href');
      if (!href) return void skipped.push(`${name} (no rulesheet link)`);
      if (/^https?:\/\//.test(href) && !href.startsWith(BASE)) {
        return void skipped.push(`${name} (external: ${href})`);
      }
      const path = href.replace(BASE, '');
      machines.push({
        id: slugFromPath(path),
        name,
        manufacturer,
        released: clean($(cells[1]).text()) || null,
        designer: clean($(cells[2]).text()) || null,
        rules_by: clean($(cells[3]).text()) || null,
        url: BASE + path,
        sort_order: order++,
      });
    });
  });
  return { machines, skipped };
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'iframe']);
// Added rules beat the built-in image rule (remove() does not), so drop images here.
turndown.addRule('dropImages', { filter: 'img', replacement: () => '' });
// Keep heading ids so the extractor can cite the section anchor for deep links.
turndown.addRule('headingWithId', {
  filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  replacement(content, node) {
    const level = Number(node.nodeName.charAt(1));
    const id = node.getAttribute('id');
    return `\n\n${'#'.repeat(level)} ${content.trim()}${id ? ` {#${id}}` : ''}\n\n`;
  },
});
turndown.addRule('tableRow', {
  filter: 'tr',
  replacement(content) {
    return `\n| ${content.trim()}`;
  },
});
turndown.addRule('tableCell', {
  filter: ['td', 'th'],
  replacement(content) {
    return `${clean(content)} | `;
  },
});

function rulesheetToMarkdown(html) {
  const $ = cheerio.load(html);
  const main = $('#main_content');
  // Drop the table of contents (heading + following list); it is noise for extraction.
  const toc = main.find('h2#heading--table-of-contents');
  toc.next('ul').remove();
  toc.remove();
  return turndown.turndown(main.html() ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const args = parseArgs();
  const db = openDb();
  console.log('Fetching master list…');
  const { machines, skipped } = await scrapeMasterList();
  console.log(`Found ${machines.length} rulesheets; skipped ${skipped.length}:`);
  for (const s of skipped) console.log(`  - ${s}`);

  const upsert = db.prepare(`
    INSERT INTO machines (id, name, manufacturer, released, designer, rules_by, url, sort_order)
    VALUES (:id, :name, :manufacturer, :released, :designer, :rules_by, :url, :sort_order)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, manufacturer=excluded.manufacturer,
      released=excluded.released, designer=excluded.designer, rules_by=excluded.rules_by,
      url=excluded.url, sort_order=excluded.sort_order`);
  transaction(db, () => machines.forEach((m) => upsert.run(m)));

  const getHash = db.prepare('SELECT content_hash FROM machines WHERE id = ?');
  const saveText = db.prepare(`
    INSERT INTO rulesheet_text (machine_id, markdown) VALUES (?, ?)
    ON CONFLICT(machine_id) DO UPDATE SET markdown = excluded.markdown`);
  const saveHash = db.prepare('UPDATE machines SET content_hash = ?, fetched_at = ? WHERE id = ?');

  const targets = machines.filter((m) => matchesOnly(m.id, args.only));
  let changed = 0;
  let failed = 0;
  for (const [i, m] of targets.entries()) {
    try {
      const markdown = rulesheetToMarkdown(await get(m.url));
      const hash = createHash('sha256').update(markdown).digest('hex');
      const prev = getHash.get(m.id)?.content_hash;
      transaction(db, () => {
        saveText.run(m.id, markdown);
        saveHash.run(hash, new Date().toISOString(), m.id);
      });
      const status = prev === hash ? 'unchanged' : prev ? 'CHANGED' : 'new';
      if (status !== 'unchanged') changed++;
      console.log(`[${i + 1}/${targets.length}] ${m.id}: ${status} (${markdown.length} chars)`);
    } catch (err) {
      failed++;
      console.error(`[${i + 1}/${targets.length}] ${m.id}: FAILED ${err.message}`);
    }
    if (i < targets.length - 1) await sleep(DELAY_MS);
  }
  console.log(`Done. ${changed} new/changed, ${failed} failed.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
