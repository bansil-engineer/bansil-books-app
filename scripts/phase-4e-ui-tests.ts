// ============================================================
// Phase 4E-UI Integration Tests
//
// 18 required checks from the specification, plus structural
// verification of the UI component, API route, sidebar integration,
// and feature registry.
//
// Run: npx tsx scripts/phase-4e-ui-tests.ts
// ============================================================

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(id: string, label: string, fn: () => boolean | string) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`  ✓ [${id}] ${label}`);
      passed++;
    } else {
      const msg = typeof result === "string" ? result : "FAIL";
      console.log(`  ✗ [${id}] ${label} — ${msg}`);
      failed++;
      failures.push(`${id}: ${label} — ${msg}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ [${id}] ${label} — ERROR: ${msg}`);
    failed++;
    failures.push(`${id}: ${label} — ${msg}`);
  }
}

function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

function fileContains(relPath: string, text: string): boolean {
  const content = fs.readFileSync(path.join(ROOT, relPath), "utf-8");
  return content.includes(text);
}

function fileNotContains(relPath: string, text: string): boolean {
  const content = fs.readFileSync(path.join(ROOT, relPath), "utf-8");
  return !content.includes(text);
}

console.log("\n=== Phase 4E-UI Integration Tests ===\n");

// ---------- FILE EXISTENCE ----------
console.log("--- File Existence ---");

check("F1", "Component file exists", () =>
  fileExists("app/components/TechnicalEquivalenceReviewView.tsx") || "TechnicalEquivalenceReviewView.tsx not found"
);

check("F2", "CSS file exists", () =>
  fileExists("app/components/TechnicalEquivalenceReviewView.css") || "TechnicalEquivalenceReviewView.css not found"
);

check("F3", "API route exists", () =>
  fileExists("app/api/ai/estimation/technical-equivalence/route.ts") || "API route not found"
);

// ---------- SPECIFICATION CHECKS (18 required) ----------
console.log("\n--- Specification Checks (18 required) ---");

// 1. Technical equivalence status renders correctly
check("S01", "Status renders: TECHNICALLY_EQUIVALENT → 'Technical Match Supported'", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'TECHNICALLY_EQUIVALENT: "Technical Match Supported"') || "Label not found"
);

// 2. Matched attributes visible
check("S02", "Matched attributes visible in comparison table", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "AttributeComparisonTable") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'MATCH: "Match"')
  || "Attribute comparison structure missing"
);

// 3. Missing evidence visible as explicit state
check("S03", "Missing data shown as explicit state (not 0, not N/A)", () => {
  const hasNotSpecified = fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Not specified");
  const hasMissingEvidence = fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Missing evidence");
  if (!hasNotSpecified) return "Missing 'Not specified' label";
  if (!hasMissingEvidence) return "Missing 'Missing evidence' label";
  return true;
});

// 4. Conflict visible
check("S04", "Conflict status visible: SPEC_CONFLICT, MAKE_CONFLICT, UOM_INCOMPATIBLE", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'SPEC_CONFLICT: "Specification Conflict"') &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'MAKE_CONFLICT: "Make / Manufacturer Conflict"') &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'UOM_INCOMPATIBLE: "UOM Incompatible"')
  || "Conflict labels not found"
);

// 5. Rate not auto-selected, no cheapest-wins
check("S05", "Rate is not auto-selected; no cheapest/winner logic", () => {
  const content = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  // Check for actual auto-select logic patterns, not comment words
  if (/\.sort\(.*rate/i.test(content)) return "Found sort-by-rate logic";
  if (/selectCheapest|pickWinner|autoSelect|bestCandidate/i.test(content)) return "Found auto-selection function";
  if (/cheapest.*selected|winner.*selected/i.test(content)) return "Found cheapest/winner selection pattern";
  return true;
});

// 6. Owner approval NOT fabricated
check("S06", "Owner approval never fabricated: no 'Approved' in status labels", () => {
  const content = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  // Check STATUS_LABELS section only — should not contain "Approved" as a standalone word
  const statusLabelsMatch = content.match(/STATUS_LABELS[\s\S]*?};/);
  if (!statusLabelsMatch) return "STATUS_LABELS not found";
  const block = statusLabelsMatch[0];
  if (block.includes("Approved") || block.includes("Owner Approved") || block.includes("Vendor Approved")) {
    return "Found 'Approved' in STATUS_LABELS";
  }
  return true;
});

// 7. Phase 4F costing absent
check("S07", "Phase 4F costing absent: no landed cost calculation, no total cost, no profit margin", () => {
  const content = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  // Check for actual costing calculations, not data type fields or CSS margins
  if (/calculateLanded|computeTotal|calculateMargin|profitMargin/i.test(content)) return "Found costing function";
  if (/landed.cost.*=/i.test(content) && !/landed_cost_basis/i.test(content)) return "Found landed cost assignment";
  if (/phase.?4f/i.test(content)) return "Found Phase 4F reference";
  // total_cost / totalCost as a calculated value (not a type field)
  if (/totalCost\s*[:=]/i.test(content)) return "Found total cost calculation";
  return true;
});

// 8. Safety labels present
check("S08", "Safety labels present: 'Technical assessment only', 'Not Owner approval'", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Technical assessment only") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Not Owner approval")
  || "Safety labels missing"
);

// 9. Owner review state indicator
check("S09", "Owner review state indicator: 'Owner review required'", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Owner review required") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "ReviewStateIndicator")
  || "Owner review indicator missing"
);

// 10. Empty states truthful — no fabricated data, shows real empty state
check("S10", "Empty states truthful: no fabricated data, truthful empty state displayed", () => {
  const c = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  if (/createSample|sampleData|usingSampleData/i.test(c)) return "Found fabricated sample data";
  if (!c.includes("No BOQ data available for technical-equivalence review")) return "Missing truthful empty state message";
  return true;
});

// 11. Error states distinguish different types
check("S11", "Error states: error message display and assessment error handling", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "te-error-state") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Assessment Error")
  || "Error state handling missing"
);

// 12. Rate shown for evidence only label
check("S12", "Rate shown for evidence only (safety label)", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Rate shown for evidence only")
  || "Rate-evidence-only label missing"
);

// 13. Side-by-side candidate comparison (no auto-ranking)
check("S13", "Side-by-side candidate comparison: table with multiple candidates", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "te-candidates-table") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "Candidate Evidence")
  || "Candidate comparison table missing"
);

// 14. BOQ requirement and candidate detail panels
check("S14", "BOQ requirement + candidate detail panels side by side", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "DetailPanels") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "te-detail-grid")
  || "Detail panels missing"
);

// 15. Dimension comparison table with all 5 dimensions
check("S15", "Five technical dimensions labeled: SPEC, UOM, MAKE, GRADE, STANDARD", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'SPEC: "Specification"') &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'UOM: "Unit of Measurement"') &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'MAKE: "Make / Manufacturer"') &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'GRADE: "Grade / Class"') &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", 'STANDARD: "Standard Reference"')
  || "Missing dimension labels"
);

// 16. API route is read-only (no mutation, no Zoho)
check("S16", "API route is read-only: no DB mutation, no Zoho integration, no external AI", () => {
  const api = fs.readFileSync(path.join(ROOT, "app/api/ai/estimation/technical-equivalence/route.ts"), "utf-8");
  // Check for actual Zoho API calls, not safety comments
  if (/zohoClient|zohoApi|zohoRequest|fetch.*zoho/i.test(api)) return "Found Zoho API call";
  if (/import.*zoho/i.test(api)) return "Found Zoho import";
  if (api.includes("INSERT INTO") || api.includes("UPDATE ") || api.includes("DELETE FROM")) return "Found SQL mutation";
  if (/import.*openai|import.*anthropic/i.test(api)) return "Found external AI import";
  return true;
});

// 17. Feature registry entries
check("S17", "Feature registry: module_estimation + sub_est_technical_equivalence", () =>
  fileContains("app/lib/feature-registry.ts", "module_estimation") &&
  fileContains("app/lib/feature-registry.ts", "sub_est_technical_equivalence")
  || "Feature registry entries missing"
);

// 18. Sidebar navigation entry
check("S18", "Sidebar: estimation group with technical_equivalence child", () =>
  fileContains("app/components/Sidebar.tsx", '"technical_equivalence"') &&
  fileContains("app/components/Sidebar.tsx", '"module_estimation"')
  || "Sidebar navigation entry missing"
);

// ---------- STRUCTURAL / INTEGRATION CHECKS ----------
console.log("\n--- Structural Integration ---");

check("I01", "page.tsx imports TechnicalEquivalenceReviewView", () =>
  fileContains("app/page.tsx", 'import { TechnicalEquivalenceReviewView }')
  || "Import missing in page.tsx"
);

check("I02", "page.tsx routes 'technical_equivalence' section", () =>
  fileContains("app/page.tsx", 'sidebarSection === "technical_equivalence"')
  || "Routing missing in page.tsx"
);

check("I03", "page.tsx has page title for technical_equivalence", () =>
  fileContains("app/page.tsx", "technical_equivalence:")
  || "Page title mapping missing"
);

check("I04", "Component imports types from engine types", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "technical-equivalence-types") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "rate-types")
  || "Type imports missing"
);

check("I05", "Component imports CSS file", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", './TechnicalEquivalenceReviewView.css')
  || "CSS import missing"
);

check("I06", "CSS uses existing design tokens", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.css", "var(--google-green)") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.css", "var(--google-red)") &&
  fileContains("app/components/TechnicalEquivalenceReviewView.css", "var(--border)")
  || "Design token usage missing"
);

check("I07", "API route uses engine functions (assessTechnicalEquivalence/assessBoqLineEquivalence)", () => {
  const api = fs.readFileSync(path.join(ROOT, "app/api/ai/estimation/technical-equivalence/route.ts"), "utf-8");
  return (api.includes("assessTechnicalEquivalence") || api.includes("assessBoqLineEquivalence"))
    || "Engine function calls missing in API route";
});

check("I08", "No Zoho write integration in Phase 4E-UI files", () => {
  const files = [
    "app/components/TechnicalEquivalenceReviewView.tsx",
    "app/components/TechnicalEquivalenceReviewView.css",
    "app/api/ai/estimation/technical-equivalence/route.ts",
  ];
  for (const f of files) {
    const c = fs.readFileSync(path.join(ROOT, f), "utf-8");
    // Check for actual Zoho write code, not safety documentation
    if (/zohoClient|zohoApi|import.*zoho/i.test(c)) return `Found Zoho integration in ${f}`;
    if (/zohoWrite\s*[:=]\s*[1-9]|ZOHO_WRITE\s*[:=]\s*[1-9]/i.test(c)) return `Found Zoho write enabled in ${f}`;
  }
  return true;
});

check("I09", "Component is exported as named export", () =>
  fileContains("app/components/TechnicalEquivalenceReviewView.tsx", "export function TechnicalEquivalenceReviewView")
  || "Named export missing"
);

check("I10", "No database mutation in any Phase 4E-UI file", () => {
  const files = [
    "app/components/TechnicalEquivalenceReviewView.tsx",
    "app/api/ai/estimation/technical-equivalence/route.ts",
  ];
  for (const f of files) {
    const c = fs.readFileSync(path.join(ROOT, f), "utf-8");
    if (c.includes("db.run(") || c.includes("db.exec(") || c.includes("db.prepare(")) return `Found DB mutation in ${f}`;
    if (c.includes("INSERT INTO") || c.includes("UPDATE ") || c.includes("DELETE FROM")) return `Found SQL mutation in ${f}`;
  }
  return true;
});


// ---------- NO-FABRICATION PRODUCTION CHECKS (10 required) ----------
console.log("\n--- No-Fabrication Production Checks (10 required) ---");

// NF01: No embedded sample BOQ data in production component
check("NF01", "No embedded sample BOQ data in production component", () => {
  const c = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  if (/createSampleBoqLines|sampleBoq|demoBoq|mockBoq/i.test(c)) return "Found embedded sample BOQ data";
  if (/BOQ-001|BOQ-002|BOQ-003|BOQ-004|BOQ-005/i.test(c)) return "Found hardcoded sample BOQ line IDs";
  return true;
});

// NF02: No embedded sample candidate evidence in production component
check("NF02", "No embedded sample candidate evidence in production component", () => {
  const c = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  if (/createSampleEvidence|sampleEvidence|demoEvidence|mockEvidence/i.test(c)) return "Found embedded sample evidence data";
  if (/RE-001|RE-002|RE-003|IT-100|IT-200/i.test(c)) return "Found hardcoded sample evidence IDs";
  if (/M\/s Apex|M\/s Star|M\/s National/i.test(c)) return "Found fabricated vendor names";
  return true;
});

// NF03: No fake fallback on empty API — component uses empty arrays, not fabricated defaults
check("NF03", "No fake fallback on empty API response", () => {
  const c = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  // Must NOT fallback to created data
  if (/\?\?\s*create/i.test(c)) return "Found fallback to created data";
  // Must use empty array fallback
  if (!c.includes("externalBoqLines ?? []")) return "Missing empty-array fallback for BOQ lines";
  if (!c.includes("externalEvidence ?? []")) return "Missing empty-array fallback for evidence";
  return true;
});

// NF04: Truthful empty state renders when no data available
check("NF04", "Truthful empty state renders when no data available", () => {
  const c = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  if (!c.includes("No BOQ data available for technical-equivalence review")) return "Missing primary empty state message";
  if (!c.includes("No estimation BOQ lines or candidate rate evidence have been loaded")) return "Missing empty state explanation";
  if (!c.includes("boqLines.length === 0")) return "Missing length check for empty state";
  return true;
});

// NF05: Test fixtures isolated to test code only (not in production component)
check("NF05", "Test fixtures isolated to test code, not in production component", () => {
  const comp = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  // No fixture-generation functions in the component
  if (/function create(Sample|Mock|Demo|Test|Fixture)/i.test(comp)) return "Found fixture factory function in production component";
  // No test-only comments indicating test data
  if (/test fixture only|for testing|test data/i.test(comp)) return "Found test-data comment in production component";
  // No DEMO DATA FACTORY section
  if (/DEMO DATA FACTORY/i.test(comp)) return "Found DEMO DATA FACTORY section";
  return true;
});

// NF06: API route contains no fabricated data
check("NF06", "API route contains no fabricated data", () => {
  const api = fs.readFileSync(path.join(ROOT, "app/api/ai/estimation/technical-equivalence/route.ts"), "utf-8");
  if (/createSample|sampleData|mockData|demoData/i.test(api)) return "Found fabrication in API route";
  if (/BOQ-001|RE-001|IT-100/i.test(api)) return "Found hardcoded sample IDs in API route";
  // API must be pure computation: POST handler only
  if (!api.includes("export async function POST")) return "Missing POST handler";
  return true;
});

// NF07: Unknown/missing values remain unknown, not fabricated
check("NF07", "Unknown/missing values stay missing, not fabricated", () => {
  const c = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  // Must show truthful missing labels
  if (!c.includes("Not specified")) return "Missing 'Not specified' label";
  if (!c.includes("Missing evidence")) return "Missing 'Missing evidence' label";
  if (!c.includes("Not available")) return "Missing 'Not available' label";
  // Must NOT infer or guess missing values
  if (/inferMissing|guessMissing|fillDefault/i.test(c)) return "Found inference of missing values";
  return true;
});

// NF08: No Phase 4F costing logic anywhere in 4E-UI files
check("NF08", "No Phase 4F costing logic in any 4E-UI file", () => {
  const files = [
    "app/components/TechnicalEquivalenceReviewView.tsx",
    "app/api/ai/estimation/technical-equivalence/route.ts",
  ];
  for (const f of files) {
    const c = fs.readFileSync(path.join(ROOT, f), "utf-8");
    // Check for actual Phase 4F code: imports, function calls, variable names
    // Safety comments mentioning Phase 4F for documentation are acceptable
    const lines = c.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue; // skip comments
      if (/phase.?4f/i.test(trimmed)) return "Found Phase 4F code in " + f;
    }
    if (/calculateLanded|computeMargin|profitMargin|costAnalysis/i.test(c)) return "Found costing logic in " + f;
  }
  return true;
});

// NF09: No Owner approval fabrication — status never says Approved
check("NF09", "No Owner approval fabrication — status never says Approved", () => {
  const c = fs.readFileSync(path.join(ROOT, "app/components/TechnicalEquivalenceReviewView.tsx"), "utf-8");
  const labelsMatch = c.match(/STATUS_LABELS[\s\S]*?};/);
  if (!labelsMatch) return "STATUS_LABELS not found";
  if (/Approved/i.test(labelsMatch[0])) return "Found 'Approved' in STATUS_LABELS";
  // Also check that the component never programmatically sets approval
  if (/setApproval|ownerApproved|approvalStatus\s*=/i.test(c)) return "Found approval state mutation";
  // Must have "System technical result" label
  if (!c.includes("System technical result")) return "Missing 'System technical result' label";
  return true;
});

// NF10: ZOHO WRITE = 0 enforced across all 4E-UI files
check("NF10", "ZOHO WRITE = 0 enforced across all 4E-UI files", () => {
  const files = [
    "app/components/TechnicalEquivalenceReviewView.tsx",
    "app/api/ai/estimation/technical-equivalence/route.ts",
  ];
  for (const f of files) {
    const c = fs.readFileSync(path.join(ROOT, f), "utf-8");
    if (/zohoClient|ZohoClient|import.*zoho.*api/i.test(c)) return "Found Zoho client in " + f;
    // Check for actual Zoho write code in non-comment lines
    const lines = c.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue; // skip comments
      if (/writeToZoho|zohoUpdate|zohoCreate|zohoInsert/i.test(trimmed)) return "Found Zoho write call in " + f;
      if (/fetch.*zoho\.com/i.test(trimmed)) return "Found Zoho HTTP call in " + f;
    }
  }
  return true;
});

// ---------- SUMMARY ----------
console.log("\n=== Results ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  - ${f}`));
}

console.log(`\nPhase 4E-UI Tests: ${failed === 0 ? "ALL PASSED ✓" : "SOME FAILED ✗"}`);
process.exit(failed > 0 ? 1 : 0);
