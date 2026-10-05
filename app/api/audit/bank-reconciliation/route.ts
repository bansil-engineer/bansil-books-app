import { NextResponse } from "next/server";
import { 
  getBankAccounts,
  getBankStatementSources, 
  addBankStatementSource, 
  syncBankStatements, 
  getBankStatements, 
  getBankReconciliation 
} from "@/app/lib/audit/bank-reconciliation-service";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    
    if (action === "accounts") {
      const accounts = getBankAccounts();
      return NextResponse.json({ accounts });
    }
    
    if (action === "sources") {
      const sources = getBankStatementSources();
      return NextResponse.json({ sources });
    }
    
    if (action === "statements") {
      const sourceId = searchParams.get("sourceId");
      if (!sourceId) return NextResponse.json({ error: "Missing sourceId" }, { status: 400 });
      const statements = getBankStatements(sourceId);
      return NextResponse.json({ statements });
    }
    
    if (action === "reconciliation") {
      const sourceId = searchParams.get("sourceId");
      const statementId = searchParams.get("statementId");
      if (!sourceId || !statementId) return NextResponse.json({ error: "Missing sourceId or statementId" }, { status: 400 });
      
      const matches = getBankReconciliation(sourceId, statementId);
      
      // Calculate summary
      let exact = 0;
      let dateMismatch = 0;
      let unmatched = 0;
      let matchedAmount = 0;
      let unmatchedAmount = 0;
      
      for (const m of matches) {
        if (m.matchStatus === "EXACT_MATCH") {
           exact++;
           matchedAmount += Math.abs(m.bankTx.amount);
        } else if (m.matchStatus === "DATE_MISMATCH") {
           dateMismatch++;
           matchedAmount += Math.abs(m.bankTx.amount);
        } else {
           unmatched++;
           unmatchedAmount += Math.abs(m.bankTx.amount);
        }
      }
      
      return NextResponse.json({ 
        matches, 
        summary: {
           exact,
           dateMismatch,
           unmatched,
           matchedAmount,
           unmatchedAmount
        } 
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Bank reconciliation GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    
    if (action === "add-source") {
      const body = await request.json();
      const { organizationId, bankAccountId, folderPath } = body;
      
      if (!organizationId || !bankAccountId || !folderPath) {
         return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      
      const source = addBankStatementSource(organizationId, bankAccountId, folderPath);
      return NextResponse.json({ success: true, source });
    }
    
    if (action === "sync") {
      const body = await request.json();
      const { sourceId } = body;
      
      if (!sourceId) {
         return NextResponse.json({ error: "Missing sourceId" }, { status: 400 });
      }
      
      const result = syncBankStatements(sourceId);
      return NextResponse.json({ success: true, result });
    }
    
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Bank reconciliation POST error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
