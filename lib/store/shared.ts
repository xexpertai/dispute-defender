import "server-only";
import { openDb, type DB } from "./db";

let db: DB | null = null;
/** One process-wide SQLite handle (data/dispute-defender.db, or DD_DB_PATH). */
export function sharedDb(): DB {
  return (db ??= openDb());
}
