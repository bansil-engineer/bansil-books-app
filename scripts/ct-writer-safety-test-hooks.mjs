// Test-only module hooks for scripts/ct-writer-safety-tests.ts.
// Redirects the Commercial Trace writer's runtime dependencies to in-process
// stubs so the REAL persistence function runs against an isolated temp DB
// with a mock Zoho reader. Also intercepts db.exec to track BEGIN TRANSACTION
// timing relative to reader calls, proving no-network-in-transaction.
//
// Never touches data/audit_workspace.db; never calls Zoho.

const STUBS = {
  "../db/audit-database":
    `export function getAuditDatabase(){
      const g = globalThis.__CT_SAFETY_TEST__;
      const realDb = g.db;
      // Wrap db.exec to detect BEGIN TRANSACTION
      if (g.trackBegin && !g._wrapped) {
        g._wrapped = true;
        g.readerCallsBeforeBegin = 0;
        g.readerCallsAfterBegin = 0;
        const origExec = realDb.exec.bind(realDb);
        realDb.exec = function(sql) {
          if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('BEGIN')) {
            g.beginSeen = true;
            // Count all reader calls logged so far as "before"
            g.readerCallsBeforeBegin = (g.callLog || []).length;
          }
          return origExec(sql);
        };
      }
      return realDb;
    }`,
  "../zoho-token-store":
    "export function readTokenStore(){ return { access_token: 'TEST_ONLY', organization_id: globalThis.__CT_SAFETY_TEST__.orgId, api_domain: 'https://test.invalid' }; }",
  "./accounts/zoho-read-transactions": [
    "const r = () => globalThis.__CT_SAFETY_TEST__.reader;",
    "function trackCall() {",
    "  const g = globalThis.__CT_SAFETY_TEST__;",
    "  if (g.trackBegin && g.beginSeen) { g.readerCallsAfterBegin = (g.readerCallsAfterBegin || 0) + 1; }",
    "}",
    "export const listSalesOrders = async (...a) => { trackCall(); return r().listSalesOrders(...a); };",
    "export const getSalesOrder = async (...a) => { trackCall(); return r().getSalesOrder(...a); };",
    "export const listPurchaseOrders = async (...a) => { trackCall(); return r().listPurchaseOrders(...a); };",
    "export const getPurchaseOrder = async (...a) => { trackCall(); return r().getPurchaseOrder(...a); };",
    "export const listInvoices = async (...a) => { trackCall(); return r().listInvoices(...a); };",
    "export const getInvoice = async (...a) => { trackCall(); return r().getInvoice(...a); };",
    "export const listBills = async (...a) => { trackCall(); return r().listBills(...a); };",
    "export const getBill = async (...a) => { trackCall(); return r().getBill(...a); };",
    "export const listExpenses = async (...a) => { trackCall(); return r().listExpenses(...a); };",
    "export const getExpense = async (...a) => { trackCall(); return r().getExpense(...a); };",
  ].join("\n"),
};

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || "";
  if (parent.includes("commercial-trace-sync-service") && Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
    return { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
