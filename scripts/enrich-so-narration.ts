import fs from "fs";
import { getAuditDatabase } from "../app/lib/db/audit-database.ts";

const db = getAuditDatabase();

function enrichSONarration() {
  console.log("Reading SO detail from scratch/so_detail.json...");
  const raw = fs.readFileSync("scratch/so_detail.json", "utf8");
  const data = JSON.parse(raw);
  
  if (!data.salesorder || !data.salesorder.line_items) {
    console.error("No salesorder or line_items found in JSON!");
    return;
  }
  
  const soId = data.salesorder.salesorder_id;
  const lineItems = data.salesorder.line_items;
  
  let updated = 0;
  
  db.exec('BEGIN TRANSACTION');
  try {
    const updateStmt = db.prepare(`
      UPDATE audit_zoho_sales_order_lines 
      SET description = ? 
      WHERE salesorder_id = ? AND line_item_id = ?
    `);
    
    for (const line of lineItems) {
      const lineId = line.line_item_id;
      let descState = null;
      if (line.description !== undefined && line.description !== null) {
        if (String(line.description).trim() === "") {
          descState = "CAPTURED_EMPTY";
        } else {
          descState = line.description;
        }
      } else if (line.description === undefined) {
        descState = "SOURCE DOES NOT PROVIDE NARRATION";
      } else {
        descState = "CAPTURED_EMPTY";
      }
      
      const res = updateStmt.run(descState, soId, lineId);
      if (res.changes > 0) {
        updated++;
      }
    }
    
    db.exec('COMMIT');
    console.log(`Successfully enriched ${updated} lines for SO ${soId}`);
  } catch (err) {
    db.exec('ROLLBACK');
    console.error("Error updating DB:", err);
  }
}

enrichSONarration();
