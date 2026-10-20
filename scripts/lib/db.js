// SQLite access for the import pipeline. Uses Node's built-in node:sqlite (no native deps).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DB_PATH = resolve(ROOT, 'data', 'pinball.db');

export const CATEGORIES = ['mode', 'multiball', 'wizard', 'side_mode', 'skill_shot', 'extra_ball', 'mechanic', 'scoring'];
// Which hardware model a step applies to. Most games' Premium and LE share a playfield.
export const VARIANTS = ['all', 'pro', 'premium_le'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS machines (
  id             TEXT PRIMARY KEY,      -- slug, e.g. "stern/fallout"
  name           TEXT NOT NULL,
  manufacturer   TEXT NOT NULL,
  released       TEXT,
  designer       TEXT,
  rules_by       TEXT,
  url            TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  content_hash   TEXT,
  fetched_at     TEXT,
  extracted_hash TEXT,
  extracted_at   TEXT
);
CREATE TABLE IF NOT EXISTS rulesheet_text (
  machine_id TEXT PRIMARY KEY REFERENCES machines(id) ON DELETE CASCADE,
  markdown   TEXT NOT NULL
);
-- superseded by questlines/steps
DROP TABLE IF EXISTS objectives;
-- A questline is an ordered chain of goals on one machine, e.g. qualify -> start -> jackpots -> super jackpot -> mini-wizard.
CREATE TABLE IF NOT EXISTS questlines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  category    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questlines_machine ON questlines(machine_id);
CREATE TABLE IF NOT EXISTS steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  questline_id  INTEGER NOT NULL REFERENCES questlines(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  variant       TEXT NOT NULL DEFAULT 'all',
  section       TEXT,
  anchor        TEXT
);
CREATE INDEX IF NOT EXISTS steps_questline ON steps(questline_id);
`;

export function openDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Parse "--only a,b --force" style flags shared by the scripts. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { only: null, force: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

/** True if machine id matches any --only filter (full id or the part after the manufacturer). */
export function matchesOnly(id, only) {
  if (!only) return true;
  return only.some((o) => id === o || id.endsWith('/' + o) || id.includes(o));
}
