import { handleOwnerMessage } from "../app/lib/ai/ceo/ceo-orchestrator";
import { getAiDatabase } from "../app/lib/db/ai-database";
import crypto from "crypto";

async function main() {
  const objective = "CEO, analyze our current working-capital position from available verified company data. Focus on customer receivables, vendor payables, overdue or concentrated exposure where data supports it, major customer/vendor dependence, and what requires management attention. Compare the current FY position with relevant historical context where possible. Use read-only data only. Do not make any accounting, payment, collection, Zoho, or external changes.";
  
  console.log(`Starting execution for objective: ${objective.substring(0, 50)}...`);
  
  try {
    const result = await handleOwnerMessage(objective, [], { useLifecycle: true });
    
    console.log("\n================ CEO RESPONSE ================\n");
    console.log(result.content);
    console.log(`\nRun ID: ${result.runId}`);
    console.log("\n==============================================\n");

  } catch (error: any) {
    console.error("Execution failed:", error);
  }
}

main().catch(console.error);
