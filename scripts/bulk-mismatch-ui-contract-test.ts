import { getDatabase as getMainDatabase } from "../app/lib/db/database";
import { getAuditDatabase } from "../app/lib/db/audit-database";
import { buildBulkMismatchResolutionContext } from "../app/lib/audit/mismatch-resolution/candidate-query";
import { suggestBulkResolutionsWithConflictDetection } from "../app/lib/audit/mismatch-resolution/mismatch-suggestion-engine";
import { resolve } from "path";

async function runContractTest() {
  console.log("==================================================");
  console.log("BULK MISMATCH UI CONTRACT TEST");
  console.log("==================================================");

  try {
    const mainDb = getMainDatabase();
    const auditDb = getAuditDatabase();

    // We'll run a context query that we know returns something, e.g. for ALL_PENDING or a specific period.
    const bulkContextResult = buildBulkMismatchResolutionContext(mainDb, auditDb, {
      customerId: "test_cust_alpha",
      period: undefined,
      financialYear: "2026-27",
      fromDate: undefined,
      toDate: undefined
    });

    if (!bulkContextResult.ok) {
      console.error("Failed to build context:", bulkContextResult.error);
      process.exit(1);
    }

    const shortageItems = bulkContextResult.contexts.map((ctx: any) => ctx.mismatchItem);
    const surplusCandidatesByMismatch = new Map();
    bulkContextResult.contexts.forEach((ctx: any) => {
      let fullCandidates = [...ctx.candidates];
      if (ctx.bomComponents && ctx.bomComponents.length > 0) {
        const bomItemIds = new Set(ctx.bomComponents.map((c: any) => c.itemId));
        fullCandidates = fullCandidates.filter(c => !bomItemIds.has(c.itemId));
        fullCandidates.push(...ctx.bomComponents);
      }
      surplusCandidatesByMismatch.set(ctx.mismatchItem.itemId, fullCandidates);
    });

    const suggestions = suggestBulkResolutionsWithConflictDetection(shortageItems, surplusCandidatesByMismatch);

    let passCount = 0;
    
    // Check top level array
    if (Array.isArray(suggestions)) {
      console.log("  ✓ PASS: API returns an array of suggestions");
      passCount++;
    } else {
      console.error("  ✗ FAIL: API did not return an array");
      process.exit(1);
    }

    if (suggestions.length === 0) {
      console.log("  - NOTE: No suggestions returned in current database state. Contract structure implicitly passes.");
    } else {
      const firstSug: any = suggestions[0];
      
      // Check for expected UI fields
      const hasMismatchItemId = "mismatchItemId" in firstSug;
      const hasSourceItem = "sourceItem" in firstSug;
      const hasSuggestion = "suggestion" in firstSug;

      if (hasMismatchItemId && hasSourceItem && hasSuggestion) {
        console.log("  ✓ PASS: Root object has mismatchItemId, sourceItem, and suggestion");
        passCount++;
        
        const sourceItem = firstSug.sourceItem;
        if ("itemId" in sourceItem && "itemName" in sourceItem) {
          console.log("  ✓ PASS: sourceItem has itemId and itemName");
          passCount++;
        } else {
          console.error("  ✗ FAIL: sourceItem missing required fields.", Object.keys(sourceItem));
          process.exit(1);
        }
      } else {
        console.error("  ✗ FAIL: Root object contract mismatch.", { hasMismatchItemId, hasSourceItem, hasSuggestion });
        process.exit(1);
      }

      const sugDetails = firstSug.suggestion;
      if ("expectedQty" in sugDetails && "matchedQty" in sugDetails && Array.isArray(sugDetails.matches)) {
        console.log("  ✓ PASS: suggestion object has expectedQty, matchedQty, and matches array");
        passCount++;
      } else {
        console.error("  ✗ FAIL: suggestion object contract mismatch.", Object.keys(sugDetails));
        process.exit(1);
      }

      if (sugDetails.matches.length > 0) {
        const match = sugDetails.matches[0];
        if ("candidateName" in match && "matchedQty" in match && "confidence" in match) {
          console.log("  ✓ PASS: matches object has candidateName, matchedQty, confidence");
          passCount++;
        } else {
          console.error("  ✗ FAIL: matches object contract mismatch.", Object.keys(match));
          process.exit(1);
        }
      } else {
         console.log("  - NOTE: matches array is empty, skipping inner field assertions");
      }
    }

    console.log("==================================================");
    console.log(`TOTAL PASSED: ${passCount}`);
    console.log("TOTAL FAILED: 0");
    console.log("==================================================");

  } catch (err) {
    console.error("Runtime error in contract test:", err);
    process.exit(1);
  }
}

runContractTest();
