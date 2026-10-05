const fs = require('fs');
const file = 'app/lib/db/ai-database.ts';
let code = fs.readFileSync(file, 'utf8');

const newSeed = `function seedModelCostCatalog(db: DatabaseSync): void {
  const existing = db.prepare(\`SELECT count(*) as count FROM model_cost_catalog\`).get() as { count: number };
  if (existing && existing.count > 0) return;

  const nowIso = new Date().toISOString();
  // Using explicit standard provider rates (converted approx 84 INR = 1 USD).
  // Status is ESTIMATED because token counts are predicted during planning.
  const insert = db.prepare(\`
    INSERT INTO model_cost_catalog (
      id, provider, model, tier, input_cost_basis, output_cost_basis, fixed_call_cost, status, enabled, notes, effective_from
    ) VALUES (?, ?, ?, ?, ?, ?, 0.0, 'ESTIMATED', 1, ?, ?)
  \`);

  // gpt-4o-mini: $0.15 / 1M input (~0.0126 INR/1k), $0.60 / 1M output (~0.0504 INR/1k)
  insert.run("cost_gpt4o_mini", "OpenAI", "gpt-4o-mini", "FAST", 0.0126, 0.0504, "Configured provider pricing (ESTIMATED)", nowIso);
  
  // gpt-4o: $2.50 / 1M input (~0.21 INR/1k), $10.00 / 1M output (~0.84 INR/1k)
  insert.run("cost_gpt4o", "OpenAI", "gpt-4o", "STANDARD", 0.21, 0.84, "Configured provider pricing (ESTIMATED)", nowIso);
  
  // o3-mini: $1.10 / 1M input (~0.0924 INR/1k), $4.40 / 1M output (~0.3696 INR/1k)
  insert.run("cost_o3_mini", "OpenAI", "o3-mini", "REASONING", 0.0924, 0.3696, "Configured provider pricing (ESTIMATED)", nowIso);
  
  // o1: $15.00 / 1M input (~1.26 INR/1k), $60.00 / 1M output (~5.04 INR/1k)
  insert.run("cost_o1", "OpenAI", "o1", "HIGH_REASONING", 1.26, 5.04, "Configured provider pricing (ESTIMATED)", nowIso);
  
  // reviewer is gpt-4o-mini
  insert.run("cost_reviewer", "OpenAI", "gpt-4o-mini", "REVIEWER", 0.0126, 0.0504, "Configured provider pricing (ESTIMATED)", nowIso);
}`;

code = code.replace(/function seedModelCostCatalog\(db: DatabaseSync\): void \{[\s\S]*?\}\n/, newSeed + '\n');
fs.writeFileSync(file, code);
