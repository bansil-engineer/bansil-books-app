// Test-only module hooks for scripts/commercial-trace-uom-tests.ts.
// Redirects the Commercial Trace writer's runtime dependencies to in-process
// stubs so the REAL persistence function runs against an isolated temp DB
// with a mock Zoho reader. Never touches data/audit_workspace.db; never calls Zoho.
const STUBS = {
  "../db/audit-database":
    "export function getAuditDatabase(){ return globalThis.__CT_UOM_TEST__.db; }",
  "../zoho-token-store":
    "export function readTokenStore(){ return { access_token: 'TEST_ONLY', organization_id: globalThis.__CT_UOM_TEST__.orgId, api_domain: 'https://test.invalid' }; }",
  "./accounts/zoho-read-transactions": [
    "const r = () => globalThis.__CT_UOM_TEST__.reader;",
    "export const listSalesOrders = (...a) => r().listSalesOrders(...a);",
    "export const getSalesOrder = (...a) => r().getSalesOrder(...a);",
    "export const listPurchaseOrders = (...a) => r().listPurchaseOrders(...a);",
    "export const getPurchaseOrder = (...a) => r().getPurchaseOrder(...a);",
    "export const listInvoices = async () => ({ invoices: [] });",
    "export const getInvoice = async () => ({ invoice: null });",
    "export const listBills = async () => ({ bills: [] });",
    "export const getBill = async () => ({ bill: null });",
    "export const listExpenses = async () => ({ expenses: [] });",
    "export const getExpense = async () => ({ expense: null });",
  ].join("\n"),
};

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || "";
  if (parent.includes("commercial-trace-sync-service") && Object.prototype.hasOwnProperty.call(STUBS, specifier)) {
    return { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
