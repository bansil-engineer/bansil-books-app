/** Phase 1 permits in-memory databases only. Disk access is deliberately gated. */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { isCanonicalDecimal } from "../decimal.ts";
import { FOUNDATION_SCHEMA_VERSION, TARGET_DB_RELATIVE_PATH } from "../types/schema.ts";
export function openProductionDatabase(): { status: "UNAVAILABLE"; reason: "DISK_ACCESS_NOT_APPROVED"; target: string } {
  return { status: "UNAVAILABLE", reason: "DISK_ACCESS_NOT_APPROVED", target: TARGET_DB_RELATIVE_PATH };
}
/** Explicit factory; importing this module opens no database and reads no file. */
export function createInMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = ON;");
    db.function("v2_decimal_valid", { deterministic: true }, (text, scale) => isCanonicalDecimal(text, scale) ? 1 : 0);
    const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    db.exec("BEGIN");
    db.exec(sql);
    const meta = db.prepare("SELECT version FROM v2_schema_meta WHERE singleton=1").get();
    if (meta?.version !== FOUNDATION_SCHEMA_VERSION) throw new Error("SCHEMA_VERSION_MISMATCH");
    db.exec("COMMIT");
    return db;
  } catch (error) { db.close(); throw error; }
}
