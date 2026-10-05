import Database from "node:sqlite";

const db = new (Database as any).DatabaseSync("./data/audit_workspace.db");
db.exec(`
  UPDATE audit_bank_coa_mappings 
  SET mapping_id = 'map_' || replace(bank_source_run_id, '-', '') || '_' || bank_account_id
`);
const sample = db.prepare("SELECT mapping_id FROM audit_bank_coa_mappings LIMIT 1").get();
console.log("Updated sample ID:", sample);
db.close();
