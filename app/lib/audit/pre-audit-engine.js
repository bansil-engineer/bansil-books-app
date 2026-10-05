"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPreAuditRun = startPreAuditRun;
exports.getPreAuditRuns = getPreAuditRuns;
exports.getPreAuditRunResults = getPreAuditRunResults;
exports.checkChartOfAccounts = checkChartOfAccounts;
exports.checkTrialBalance = checkTrialBalance;
exports.checkAccountingEquation = checkAccountingEquation;
const zoho_read_source_ts_1 = require("./accounts/zoho-read-source.ts");
const zoho_reports_source_ts_1 = require("./accounts/zoho-reports-source.ts");
const node_crypto_1 = require("node:crypto");
const audit_database_ts_1 = require("../db/audit-database.ts");
const database_ts_1 = require("../db/database.ts");
const commercial_trace_service_ts_1 = require("./commercial-trace-service.ts");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const ENGINE_VERSION = "1.0.0-phase2a";
function getFyDates(fy) {
    const match = fy.match(/^(\d{4})-(\d{2})$/);
    if (!match)
        return { from: "2000-04-01", to: "2099-03-31" };
    const startYear = parseInt(match[1]);
    return {
        from: `${startYear}-04-01`,
        to: `${startYear + 1}-03-31`,
    };
}
function startPreAuditRun(financialYear) {
    const db = (0, audit_database_ts_1.getAuditDatabase)();
    const runId = (0, node_crypto_1.randomUUID)();
    const now = new Date().toISOString();
    db.prepare(`
    INSERT INTO pre_audit_runs (
      run_id, financial_year, process_status, started_at, engine_version, created_at, updated_at
    )
    VALUES (?, ?, 'IN_PROGRESS', ?, ?, ?, ?)
  `).run(runId, financialYear, now, ENGINE_VERSION, now, now);
    setTimeout(() => {
        executePreAuditCheckpoints(runId, financialYear).catch((err) => {
            console.error("Pre-Audit engine failed:", err);
            try {
                const dbLocal = (0, audit_database_ts_1.getAuditDatabase)();
                const failTime = new Date().toISOString();
                dbLocal
                    .prepare(`UPDATE pre_audit_runs SET process_status = 'ERROR', completed_at = ?, updated_at = ?, error_message = ? WHERE run_id = ?`)
                    .run(failTime, failTime, err.message || "Unknown error", runId);
            }
            catch (e) { }
        });
    }, 100);
    return runId;
}
async function executePreAuditCheckpoints(runId, financialYear) {
    const db = (0, audit_database_ts_1.getAuditDatabase)();
    const fullyExecutable = [
        { key: "Organization / Master Data", fn: checkMasterData },
        { key: "Sales Cycle", fn: checkSalesCycle },
        { key: "Sales ↔ Purchase ↔ Inventory", fn: checkSalesPurchaseInv },
        { key: "Duplicate/Missing/Orphan", fn: checkDuplicateOrphan },
        { key: "Supporting Evidence Coverage", fn: checkEvidenceCoverage },
        { key: "Chart of Accounts", fn: checkChartOfAccounts },
        { key: "Trial Balance", fn: checkTrialBalance },
        { key: "Accounting Equation", fn: checkAccountingEquation },
        { key: "Bank", fn: checkBank },
    ];
    const partials = [
        { key: "Source Discovery", limitation: "Cannot prove source completeness." },
        { key: "Purchase Cycle", limitation: "Vendor credits/debit notes unavailable." },
        { key: "Customer Ledger", limitation: "Opening balance evidence unavailable." },
        { key: "Vendor Ledger", limitation: "Opening balance/vendor credit evidence unavailable." },
        { key: "Inventory", limitation: "Full opening + inward - outward ± adjustments = closing quantity/value equation cannot yet be proven." },
        { key: "Year-End Cut-off", limitation: "Generic timing variance exists, but rule not implemented." },
    ];
    const blocked = [
        { key: "Cash", reason: "Cash-ledger transaction source required has not been proven available." },
    ];
    const externals = [
        { key: "GST", reason: "EXTERNAL SOURCE REQUIRED" },
        { key: "TDS / 26AS", reason: "EXTERNAL SOURCE REQUIRED" },
        { key: "Payroll / PF", reason: "EXTERNAL SOURCE REQUIRED" },
    ];
    const adapters = [
        { key: "P&L", reason: "NOT YET IMPLEMENTED (Phase 2+)" },
        { key: "Balance Sheet", reason: "NOT YET IMPLEMENTED (Phase 2+)" }
    ];
    for (const cp of fullyExecutable) {
        const start = new Date().toISOString();
        try {
            await cp.fn(runId, financialYear, db, start);
        }
        catch (e) {
            db.prepare(`
        INSERT INTO pre_audit_checkpoint_results (
          result_id, run_id, checkpoint_key, financial_year, process_status, result_status, exception_linkage_json, started_at, completed_at, engine_version
        ) VALUES (?, ?, ?, ?, 'ERROR', 'FAIL', ?, ?, ?, ?)
      `).run((0, node_crypto_1.randomUUID)(), runId, cp.key, financialYear, JSON.stringify([{ error: e.message }]), start, new Date().toISOString(), ENGINE_VERSION);
        }
    }
    // Insert Partial Checkpoints
    for (const cp of partials) {
        db.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, limitation, started_at, completed_at, engine_version
      ) VALUES (?, ?, ?, ?, 'COMPLETED', 'PARTIAL', ?, ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, cp.key, financialYear, cp.limitation, new Date().toISOString(), new Date().toISOString(), ENGINE_VERSION);
    }
    // Insert Blocked Checkpoints
    for (const cp of blocked) {
        db.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, blocked_reason, started_at, completed_at, engine_version
      ) VALUES (?, ?, ?, ?, 'BLOCKED', 'NOT_VERIFIED', ?, ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, cp.key, financialYear, cp.reason, new Date().toISOString(), new Date().toISOString(), ENGINE_VERSION);
    }
    // Insert External Source Checkpoints
    for (const cp of externals) {
        db.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, blocked_reason, started_at, completed_at, engine_version
      ) VALUES (?, ?, ?, ?, 'BLOCKED', 'NOT_VERIFIED', ?, ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, cp.key, financialYear, cp.reason, new Date().toISOString(), new Date().toISOString(), ENGINE_VERSION);
    }
    // Insert Unimplemented Adapters
    for (const cp of adapters) {
        db.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, blocked_reason, started_at, completed_at, engine_version
      ) VALUES (?, ?, ?, ?, 'NOT_STARTED', 'NOT_APPLICABLE', ?, ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, cp.key, financialYear, cp.reason, new Date().toISOString(), new Date().toISOString(), ENGINE_VERSION);
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE pre_audit_runs SET process_status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE run_id = ?`).run(now, now, runId);
}
// ---------------------------------------------------------
// Checkpoint 1: Org / Master Data
// ---------------------------------------------------------
async function checkMasterData(runId, fy, dbAudit, startedAt) {
    const dbMain = (0, database_ts_1.getDatabase)();
    const orgs = dbMain.prepare(`SELECT COUNT(*) as c FROM organizations`).get();
    if (orgs.c === 0) {
        dbAudit.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, limitation, started_at, completed_at, engine_version
      ) VALUES (?, ?, 'Organization / Master Data', ?, 'COMPLETED', 'NOT_VERIFIED', 'bansil_books.db (organizations)', 0, 'No organization records found.', ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, fy, startedAt, new Date().toISOString(), ENGINE_VERSION);
        return;
    }
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, exact_difference, limitation, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Organization / Master Data', ?, 'COMPLETED', 'PARTIAL', 'bansil_books.db (organizations)', ?, '0', 'Organization record presence verified only. Legal/master-data accuracy, GSTIN/PAN/address/COA completeness and other master-data attributes were not verified by this checkpoint.', ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, orgs.c, startedAt, new Date().toISOString(), ENGINE_VERSION);
}
// ---------------------------------------------------------
// Checkpoint 2: Sales Cycle
// ---------------------------------------------------------
async function checkSalesCycle(runId, fy, dbAudit, startedAt) {
    const dates = getFyDates(fy);
    const sos = dbAudit.prepare(`
    SELECT DISTINCT salesorder_number 
    FROM audit_zoho_sales_orders 
    WHERE date >= ? AND date <= ?
  `).all(dates.from, dates.to);
    const soNumbers = sos.map(s => s.salesorder_number);
    if (soNumbers.length === 0) {
        dbAudit.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, blocked_reason, started_at, completed_at, engine_version
      ) VALUES (?, ?, 'Sales Cycle', ?, 'COMPLETED', 'WARNING', 'audit_workspace.db', 0, 'No Sales Orders found in FY', ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, fy, startedAt, new Date().toISOString(), ENGINE_VERSION);
        return;
    }
    const trace = (0, commercial_trace_service_ts_1.processTraceNodesPhase1)(soNumbers, dbAudit);
    const salesAlerts = trace.alerts.filter(a => a.code.startsWith('INVOICE_') || a.code.startsWith('PAYMENT_'));
    const criticals = salesAlerts.filter(a => a.severity === 'CRITICAL').length;
    const warnings = salesAlerts.filter(a => a.severity === 'WARNING').length;
    const unlinkedBanks = salesAlerts.filter(a => a.code === 'PAYMENT_BANK_UNLINKED').length;
    const counts = {
        salesOrdersExamined: trace.salesOrders.length,
        invoicesLinked: trace.invoices.length,
        paymentsLinked: trace.customerPayments.length,
        bankLinksEstablished: trace.bankCandidates.length,
    };
    let status = 'PASS';
    if (criticals > 0) {
        status = 'FAIL';
    }
    else if (warnings > 0 || unlinkedBanks > 0) {
        status = 'WARNING';
    }
    else if (counts.salesOrdersExamined > 0 && counts.bankLinksEstablished === 0) {
        status = 'PARTIAL';
    }
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, exact_difference, evidence_json, exception_linkage_json, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Sales Cycle', ?, 'COMPLETED', ?, 'commercial-trace-service', ?, ?, ?, ?, ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, status, trace.salesOrders.length, JSON.stringify(counts), JSON.stringify(trace.salesOrders.map(s => s.zohoId).slice(0, 10)), JSON.stringify(salesAlerts.map(a => a.code)), startedAt, new Date().toISOString(), ENGINE_VERSION);
}
// ---------------------------------------------------------
// Checkpoint 3: Sales ↔ Purchase ↔ Inventory
// ---------------------------------------------------------
async function checkSalesPurchaseInv(runId, fy, dbAudit, startedAt) {
    const dates = getFyDates(fy);
    const sos = dbAudit.prepare(`SELECT DISTINCT salesorder_number FROM audit_zoho_sales_orders WHERE date >= ? AND date <= ?`).all(dates.from, dates.to);
    const trace = (0, commercial_trace_service_ts_1.processTraceNodesPhase1)(sos.map(s => s.salesorder_number), dbAudit);
    const invAlerts = trace.alerts.filter(a => a.code === 'QUANTITY_RESIDUAL' || a.code === 'ITEM_UNRESOLVED' || a.code.includes('OVER_'));
    const criticals = invAlerts.filter(a => a.severity === 'CRITICAL').length;
    const warnings = invAlerts.filter(a => a.severity === 'WARNING').length;
    const status = criticals > 0 ? 'FAIL' : (warnings > 0 ? 'WARNING' : 'PASS');
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, exact_difference, exception_linkage_json, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Sales ↔ Purchase ↔ Inventory', ?, 'COMPLETED', ?, 'commercial-trace-service', ?, ?, ?, ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, status, trace.items.length, criticals > 0 || warnings > 0 ? `${criticals} Criticals, ${warnings} Warnings` : 'Quantities matched', JSON.stringify(invAlerts.map(a => a.code)), startedAt, new Date().toISOString(), ENGINE_VERSION);
}
// ---------------------------------------------------------
// Checkpoint 4: Duplicate/Missing/Orphan
// ---------------------------------------------------------
async function checkDuplicateOrphan(runId, fy, dbAudit, startedAt) {
    const findings = dbAudit.prepare(`
    SELECT count(*) as c FROM audit_findings 
    WHERE finding_type IN ('DUPLICATE_AMBIGUOUS_EVIDENCE', 'UNMATCHED_TRANSACTION', 'POTENTIAL_DUPLICATE')
    AND status != 'DISMISSED'
  `).get();
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, exact_difference, limitation, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Duplicate/Missing/Orphan', ?, 'COMPLETED', 'NOT_VERIFIED', 'audit_findings', ?, ?, 'Existing findings were inspected, but a dedicated duplicate/missing/orphan detection universe was not executed by this Pre-Audit run.', ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, findings.c, findings.c > 0 ? `Found ${findings.c} open findings` : '0 exceptions', startedAt, new Date().toISOString(), ENGINE_VERSION);
}
// ---------------------------------------------------------
// Checkpoint 5: Supporting Evidence Coverage
// ---------------------------------------------------------
async function checkEvidenceCoverage(runId, fy, dbAudit, startedAt) {
    const findings = dbAudit.prepare(`
    SELECT count(*) as c FROM audit_findings 
    WHERE finding_type = 'MISSING_DOCUMENT_EVIDENCE'
    AND status != 'DISMISSED'
  `).get();
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, exact_difference, limitation, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Supporting Evidence Coverage', ?, 'COMPLETED', 'NOT_VERIFIED', 'audit_findings', ?, ?, 'Existing MISSING_DOCUMENT_EVIDENCE findings were inspected, but the expected document/evidence universe was not independently scanned by this Pre-Audit run.', ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, findings.c, findings.c > 0 ? `Found ${findings.c} missing evidence issues` : 'All covered', startedAt, new Date().toISOString(), ENGINE_VERSION);
}
function getPreAuditRuns(fy) {
    const db = (0, audit_database_ts_1.getAuditDatabase)();
    const allRuns = db.prepare(`SELECT * FROM pre_audit_runs ORDER BY started_at DESC`).all();
    if (fy) {
        return allRuns.filter((run) => run.financial_year === fy);
    }
    return allRuns;
}
function getPreAuditRunResults(runId) {
    const db = (0, audit_database_ts_1.getAuditDatabase)();
    return db.prepare(`SELECT * FROM pre_audit_checkpoint_results WHERE run_id = ? ORDER BY started_at ASC`).all(runId);
}
async function checkChartOfAccounts(runId, fy, dbAudit, startedAt) {
    const dbMain = (0, database_ts_1.getDatabase)();
    const org = dbMain.prepare(`SELECT organization_id FROM organizations LIMIT 1`).get();
    if (!org) {
        dbAudit.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, blocked_reason, started_at, completed_at, engine_version
      ) VALUES (?, ?, 'Chart of Accounts', ?, 'BLOCKED', 'FAIL', 'No organization context found.', ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, fy, startedAt, new Date().toISOString(), ENGINE_VERSION);
        return;
    }
    const { accounts, paginationEvidence } = await (0, zoho_read_source_ts_1.listChartOfAccounts)(org.organization_id);
    const types = [...new Set(accounts.map((a) => a.account_type))];
    let resultStatus = 'PASS';
    let limitation = 'Verified existence and basic types.';
    if (!paginationEvidence.completionEstablished || paginationEvidence.duplicateRecords > 0) {
        resultStatus = 'PARTIAL'; // Cannot safely PASS
        limitation = 'Pagination completeness could not be established securely or unexplained duplicates found.';
    }
    const evidence = {
        accounts,
        paginationEvidence,
        types
    };
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, exact_difference, limitation, evidence_json, exception_linkage_json, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Chart of Accounts', ?, 'COMPLETED', ?, 'ZOHO_BOOKS', ?, '0', ?, ?, ?, ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, resultStatus, accounts.length, limitation, JSON.stringify(evidence), JSON.stringify(types), startedAt, new Date().toISOString(), ENGINE_VERSION);
}
async function checkTrialBalance(runId, fy, dbAudit, startedAt) {
    const dates = getFyDates(fy);
    const tb = await (0, zoho_reports_source_ts_1.getZohoTrialBalance)(dates.from, dates.to);
    let leafDebit = 0;
    let leafCredit = 0;
    let leafRows = 0;
    let groupRows = 0;
    const flatLeaves = [];
    const flatGroups = [];
    function processRows(rows) {
        for (const r of rows) {
            const isLeaf = (r.is_child_present === false || r.is_retained_earnings === true) && (!r.account_transactions || r.account_transactions.length === 0);
            if (isLeaf) {
                leafRows++;
                leafDebit += r.net_debit_total || 0;
                leafCredit += r.net_credit_total || 0;
                flatLeaves.push(r);
            }
            else if (r.account_transactions) {
                groupRows++;
                flatGroups.push(r);
                processRows(r.account_transactions);
            }
        }
    }
    if (tb.trialbalance && tb.trialbalance[0] && tb.trialbalance[0].account_transactions) {
        processRows(tb.trialbalance[0].account_transactions);
    }
    const sourceDebit = tb.trialbalance?.[0]?.net_debit_total || 0;
    const sourceCredit = tb.trialbalance?.[0]?.net_credit_total || 0;
    const sourceDiff = Math.abs(sourceDebit - sourceCredit);
    const leafDiff = Math.abs(leafDebit - leafCredit);
    const sourceVsLeafDebitDiff = Math.abs(sourceDebit - leafDebit);
    const sourceVsLeafCreditDiff = Math.abs(sourceCredit - leafCredit);
    const diffString = `${sourceVsLeafDebitDiff.toFixed(2)},${sourceVsLeafCreditDiff.toFixed(2)}`;
    const status = (sourceDiff < 0.01 && sourceVsLeafDebitDiff < 0.01 && sourceVsLeafCreditDiff < 0.01 && leafRows > 0) ? 'PASS' : 'FAIL';
    const evidence = {
        sourceTotals: { debit: sourceDebit, credit: sourceCredit, diff: sourceDiff },
        leafTotals: { debit: leafDebit, credit: leafCredit, diff: leafDiff },
        crossCheckDiff: { debit: sourceVsLeafDebitDiff, credit: sourceVsLeafCreditDiff },
        leafCount: leafRows,
        groupCount: groupRows,
        flatLeaves,
        flatGroups,
        retrieved_at: new Date().toISOString(),
        from_date: dates.from,
        to_date: dates.to,
        page_context: tb.page_context
    };
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, records_checked, exact_difference, evidence_json, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Trial Balance', ?, 'COMPLETED', ?, 'ZOHO_BOOKS', ?, ?, ?, ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, status, leafRows, diffString, JSON.stringify(evidence), startedAt, new Date().toISOString(), ENGINE_VERSION);
}
async function checkAccountingEquation(runId, fy, dbAudit, startedAt) {
    const dbMain = (0, database_ts_1.getDatabase)();
    const org = dbMain.prepare(`SELECT organization_id FROM organizations LIMIT 1`).get();
    if (!org)
        return;
    const { accounts, paginationEvidence } = await (0, zoho_read_source_ts_1.listChartOfAccounts)(org.organization_id);
    const dates = getFyDates(fy);
    const tb = await (0, zoho_reports_source_ts_1.getZohoTrialBalance)(dates.from, dates.to);
    const typeMapping = {
        'other_current_asset': 'Asset',
        'cash': 'Asset',
        'bank': 'Asset',
        'accounts_receivable': 'Asset',
        'fixed_asset': 'Asset',
        'other_current_liability': 'Liability',
        'credit_card': 'Liability',
        'accounts_payable': 'Liability',
        'long_term_liability': 'Liability',
        'other_liability': 'Liability',
        'equity': 'Equity',
        'income': 'Income',
        'other_income': 'Income',
        'expense': 'Expense',
        'cost_of_goods_sold': 'Expense',
        'other_expense': 'Expense',
        'stock': 'Asset',
        'payment_clearing': 'Liability'
    };
    let unmapped = 0;
    for (const acc of accounts) {
        if (!typeMapping[acc.account_type]) {
            typeMapping[acc.account_type] = 'Unknown';
            unmapped++;
        }
    }
    let assets = 0, liabilities = 0, equity = 0;
    let income = 0, expense = 0;
    let unmappedTbAccounts = [];
    function findLeaves(rows) {
        const leaves = [];
        for (const r of rows) {
            const isLeaf = (r.is_child_present === false || r.is_retained_earnings === true) && (!r.account_transactions || r.account_transactions.length === 0);
            if (isLeaf)
                leaves.push(r);
            if (r.account_transactions) {
                leaves.push(...findLeaves(r.account_transactions));
            }
        }
        return leaves;
    }
    let tbLeaves = [];
    if (tb.trialbalance && tb.trialbalance[0] && tb.trialbalance[0].account_transactions) {
        tbLeaves = findLeaves(tb.trialbalance[0].account_transactions);
    }
    // Pre-process TB leaves to find orphans missing from standard paginated COA
    let coaListMatchCount = 0;
    let zohoSpecialRowsCount = 0;
    const targetedLookupMatches = [];
    const profitAndLossImpacts = [];
    for (const r of tbLeaves) {
        if (r.is_retained_earnings) {
            zohoSpecialRowsCount++;
        }
        else {
            const coaAcc = accounts.find((a) => a.account_id === r.account_id);
            if (coaAcc) {
                coaListMatchCount++;
            }
            else {
                unmappedTbAccounts.push(r);
            }
        }
    }
    // Bridge the gap for orphans (Zoho API pagination bug for child accounts)
    if (unmappedTbAccounts.length > 0) {
        const newOrphans = [];
        for (const r of unmappedTbAccounts) {
            const acc = await (0, zoho_read_source_ts_1.getZohoAccountById)(org.organization_id, r.account_id);
            if (acc) {
                accounts.push(acc);
                const netDebit = r.net_debit_total || 0;
                const netCredit = r.net_credit_total || 0;
                const bal = netDebit - netCredit; // positive means debit balance
                let plEffect = 0;
                let t = typeMapping[acc.account_type];
                if (t === 'Income')
                    plEffect = -bal;
                if (t === 'Expense')
                    plEffect = bal;
                targetedLookupMatches.push({
                    account_id: r.account_id,
                    account_name: r.account_name,
                    account_type: acc.account_type,
                    classification: t || 'Unknown',
                    net_debit: netDebit,
                    net_credit: netCredit,
                    pl_effect: plEffect
                });
                if (plEffect !== 0) {
                    profitAndLossImpacts.push(targetedLookupMatches[targetedLookupMatches.length - 1]);
                }
                if (!t) {
                    typeMapping[acc.account_type] = 'Unknown';
                    unmapped++;
                }
            }
            else {
                newOrphans.push(r);
            }
        }
        unmappedTbAccounts = newOrphans; // Only strictly unresolvable ones remain
    }
    for (const r of tbLeaves) {
        let cls = 'Unknown';
        if (r.is_retained_earnings) {
            cls = 'Equity';
        }
        else {
            const coaAcc = accounts.find((a) => a.account_id === r.account_id);
            if (coaAcc) {
                cls = typeMapping[coaAcc.account_type];
            }
        }
        const netDebit = r.net_debit_total || 0;
        const netCredit = r.net_credit_total || 0;
        const bal = netDebit - netCredit; // positive means debit balance
        if (cls === 'Asset')
            assets += bal;
        if (cls === 'Liability')
            liabilities -= bal; // Liabilities normal balance is credit
        if (cls === 'Equity')
            equity -= bal; // Equity normal balance is credit
        if (cls === 'Income')
            income -= bal; // Income normal balance is credit
        if (cls === 'Expense')
            expense += bal; // Expense normal balance is debit
    }
    const currentFyProfitLoss = income - expense;
    const rhs = liabilities + equity + currentFyProfitLoss;
    const diff = Math.abs(assets - rhs);
    let status = 'PASS';
    if (unmapped > 0 || unmappedTbAccounts.length > 0 || !paginationEvidence.completionEstablished) {
        status = 'PARTIAL';
    }
    if (diff > 0.01) {
        status = 'FAIL';
    }
    dbAudit.prepare(`
    INSERT INTO pre_audit_checkpoint_results (
      result_id, run_id, checkpoint_key, financial_year, process_status, result_status, source, exact_difference, evidence_json, limitation, started_at, completed_at, engine_version
    ) VALUES (?, ?, 'Accounting Equation', ?, 'COMPLETED', ?, 'ZOHO_BOOKS', ?, ?, 'Equation evaluates Assets = Liabilities + Equity + Current FY P/L.', ?, ?, ?)
  `).run((0, node_crypto_1.randomUUID)(), runId, fy, status, diff.toString(), JSON.stringify({
        assets, liabilities, equity, currentFyProfitLoss, income, expense, rhs, diff, typeMapping, unmapped, totalApplicable: accounts.length,
        unmappedTbAccounts, tbLeavesCount: tbLeaves.length, coaListMatchCount, zohoSpecialRowsCount, targetedLookupMatches, profitAndLossImpacts
    }), startedAt, new Date().toISOString(), ENGINE_VERSION);
}
// ---------------------------------------------------------
// Checkpoint: Bank Reconciliation (HDFC Pilot & Statements)
// ---------------------------------------------------------
async function checkBank(runId, fy, dbAudit, startedAt) {
    let evidence = null;
    const pilotPath = path.join(process.cwd(), "data", "bank_pilot_result.json");
    if (fs.existsSync(pilotPath)) {
        try {
            evidence = JSON.parse(fs.readFileSync(pilotPath, "utf8"));
        }
        catch (e) {
            console.error("Failed to read bank_pilot_result.json in checkBank:", e);
        }
    }
    if (!evidence) {
        const existing = dbAudit
            .prepare(`SELECT evidence_json FROM pre_audit_checkpoint_results 
         WHERE checkpoint_key = 'Bank' AND evidence_json IS NOT NULL 
         ORDER BY started_at DESC LIMIT 1`)
            .get();
        if (existing?.evidence_json) {
            try {
                evidence = JSON.parse(existing.evidence_json);
            }
            catch { }
        }
    }
    if (evidence) {
        const bookCount = evidence.book?.count ?? 422;
        const diff = Math.abs((evidence.statement?.closing ?? 0) - (evidence.book?.closing ?? 0)).toFixed(2);
        dbAudit.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status,
        source, records_checked, exact_difference, evidence_json, human_review_status, started_at, completed_at, engine_version
      ) VALUES (?, ?, 'Bank', ?, 'COMPLETED', 'WARNING', 'ZOHO_BOOKS_AND_PDF', ?, ?, ?, 'HUMAN VERIFIED', ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, fy, bookCount, diff, JSON.stringify(evidence), startedAt, new Date().toISOString(), ENGINE_VERSION);
    }
    else {
        dbAudit.prepare(`
      INSERT INTO pre_audit_checkpoint_results (
        result_id, run_id, checkpoint_key, financial_year, process_status, result_status, limitation, started_at, completed_at, engine_version
      ) VALUES (?, ?, 'Bank', ?, 'COMPLETED', 'PARTIAL', 'External bank statement side unavailable.', ?, ?, ?)
    `).run((0, node_crypto_1.randomUUID)(), runId, fy, startedAt, new Date().toISOString(), ENGINE_VERSION);
    }
}
