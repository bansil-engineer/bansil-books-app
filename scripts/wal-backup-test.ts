import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function run() {
  const dir = fs.mkdtempSync("wal-test-");
  const dbPath = path.join(dir, "source.db");
  const backupPath = path.join(dir, "backup.db");

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)");
  db.exec("INSERT INTO test (val) VALUES ('hello WAL')");
  
  // Create backup using the same mechanism as conversation-bulk.ts
  db.exec(`VACUUM INTO '${backupPath}'`);
  
  const bk = new DatabaseSync(backupPath, { readOnly: true });
  const row = bk.prepare("SELECT val FROM test WHERE id = 1").get() as any;
  if (row?.val === 'hello WAL') {
    console.log("PASS: WAL data backed up correctly");
  } else {
    console.log("FAIL: WAL data missing in backup");
    process.exit(1);
  }
  bk.close();
  db.close();
}

run();
