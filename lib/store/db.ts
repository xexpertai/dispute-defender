import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Local store. PayPal is the source of truth; this DB caches dispute snapshots and keeps our own
 * records (agent runs, drafts, approvals, submissions, LLM token usage). It can be rebuilt from
 * PayPal + fixtures on boot, so an ephemeral disk (Render) is acceptable.
 */
export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `CREATE TABLE disputes (
     id TEXT PRIMARY KEY,
     reason TEXT, status TEXT, stage TEXT,
     amount_value TEXT, amount_currency TEXT,
     seller_response_due_date TEXT,
     source TEXT NOT NULL DEFAULT 'live',          -- live | replay
     json TEXT NOT NULL,
     fetched_at TEXT NOT NULL
   );
   CREATE TABLE agent_runs (
     id TEXT PRIMARY KEY, dispute_id TEXT NOT NULL,
     started_at TEXT NOT NULL, finished_at TEXT,
     status TEXT NOT NULL, trace TEXT NOT NULL DEFAULT '[]'
   );
   CREATE TABLE drafts (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL, dispute_id TEXT NOT NULL,
     action TEXT NOT NULL, payload TEXT NOT NULL, origin TEXT NOT NULL,   -- ai | template
     created_at TEXT NOT NULL
   );
   CREATE TABLE approvals (
     id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE,
     approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
     final_payload TEXT NOT NULL
   );
   CREATE TABLE submissions (
     id TEXT PRIMARY KEY, approval_id TEXT NOT NULL,
     endpoint TEXT NOT NULL, status_code INTEGER, debug_id TEXT,
     response TEXT, created_at TEXT NOT NULL
   );
   CREATE TABLE llm_calls (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT,
     model TEXT NOT NULL, purpose TEXT NOT NULL,
     input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
     cost_usd REAL NOT NULL, created_at TEXT NOT NULL
   );`,
  `CREATE TABLE insights_cache (
     input_hash TEXT PRIMARY KEY, model TEXT NOT NULL,
     payload TEXT NOT NULL, created_at TEXT NOT NULL
   );`,
];

export function openDb(file = process.env.DD_DB_PATH ?? path.join(process.cwd(), "data", "dispute-defender.db")): DB {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
