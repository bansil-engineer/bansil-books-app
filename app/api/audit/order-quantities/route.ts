import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, fetchOrganizations } from "@/app/lib/zoho-api";
import { secureZohoFetch } from "@/app/lib/zoho-security-guard";
import { compareQuantities, type QuantityDocument, type QuantityKind } from "@/app/lib/order-quantity";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";
type Source = Record<string, any>;
const str = (v: unknown): string => typeof v === "string" || typeof v === "number" ? String(v) : "";
const arr = (v: unknown): Source[] => Array.isArray(v) ? v : [];
const norm = (v: unknown) => str(v).trim().toLowerCase();
const idValid = (v: string) => /^\d+$/.test(v);
const fieldsSO = (po: Source) => arr(po.custom_fields).filter(f => /^(sales\s*order\s*(no\.?|number)|cf_sales_order_no)$/i.test(str(f.label || f.api_name).trim())).map(f => norm(f.value));
const definitions = { SO: ["salesorders", "salesorder"], PO: ["purchaseorders", "purchaseorder"], Invoice: ["invoices", "invoice"], Bill: ["bills", "bill"] } as const;
const normalizeDocument = (kind: QuantityKind, source: Source): QuantityDocument => {
  const singular = definitions[kind][1];
  return { id: str(source[`${singular}_id`]), kind, number: str(source[`${singular}_number`]), party: str(source.customer_name || source.vendor_name), status: str(source.status), date: str(source.date),
    multipleParents: arr(source.salesorders).length > 1 || arr(source.purchaseorders).length > 1 || (source.salesorder_ids?.length || 0) > 1 || (source.purchaseorder_ids?.length || 0) > 1,
    lines: arr(source.line_items).map(line => ({ id: str(line.line_item_id), itemId: str(line.item_id), name: str(line.name), description: str(line.description), unit: str(line.unit), quantity: line.quantity !== null && line.quantity !== undefined && line.quantity !== "" && Number.isFinite(Number(line.quantity)) ? Number(line.quantity) : null, soLineId: str(line.salesorder_item_id), poLineId: str(line.purchaseorder_item_id) })) };
};

// Live read-only preview. No database, sync engine, audit run, or stored decision.
export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/order-quantities", "GET"), "audit/order-quantities GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const params = request.nextUrl.searchParams;
  const catalog = params.get("catalog") === "1";
  const soId = params.get("so") || "";
  const customerId = params.get("customer") || "";
  const page = Number(params.get("page") || 1);
  if (catalog ? !Number.isInteger(page) || page < 1 || page > 100 : !idValid(soId) || !idValid(customerId)) return NextResponse.json({ error: "Choose a customer and Sales Order." }, { status: 400 });
  try {
    const { token, store } = await getValidAccessToken();
    let org = store.organization_id;
    let orgName = store.organization_name;
    if (!org) {
      const organizations = await fetchOrganizations();
      if (organizations.length !== 1) throw new Error("Select the organization in existing connection settings first.");
      org = organizations[0].organization_id; orgName = organizations[0].name;
    }
    let reads = 0;
    const read = async (path: string, query: Record<string, string> = {}) => {
      if (++reads > 75) throw new Error("Source preview request limit reached; coverage is incomplete.");
      const url = new URL(`${store.api_domain}/books/v3/${path}`);
      url.search = new URLSearchParams({ organization_id: org!, ...query }).toString();
      const response = await secureZohoFetch(url, { method: "GET", cache: "no-store", headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Zoho read unavailable (HTTP ${response.status}).`);
      const result = await response.json();
      if (result.code !== 0) throw new Error("Zoho read access or source response unavailable.");
      return result;
    };
    if (catalog) {
      const result = await read("salesorders", { per_page: "200", page: String(page), filter_by: "Status.All", sort_column: "date", sort_order: "D" });
      return NextResponse.json({ orders: arr(result.salesorders).map(so => ({ id: str(so.salesorder_id), number: str(so.salesorder_number), customerId: str(so.customer_id), customer: str(so.customer_name), date: str(so.date), status: str(so.status) })), hasMore: result.page_context?.has_more_page === true, page, organization: orgName || org }, { headers: { "Cache-Control": "no-store" } });
    }
    const so = (await read(`salesorders/${soId}`)).salesorder as Source;
    if (!so || str(so.salesorder_id) !== soId || str(so.customer_id) !== customerId) throw new Error("Sales Order does not belong to the selected customer.");
    const documents: QuantityDocument[] = [normalizeDocument("SO", so)];
    const notes: string[] = [];
    const complete = { SO: true, PO: true, Invoice: Array.isArray(so.invoices), Bill: true };
    const excluded: { number: string; kind: string; status: string }[] = [];
    const excludedStatus = (s: unknown) => /^(draft|void|voided|cancelled|canceled|rejected|pending_approval)$/.test(norm(s));
    const poIds = new Set(arr(so.purchaseorders).map(po => str(po.purchaseorder_id)).filter(idValid));
    const nativePoIds = new Set(poIds);
    // Enumerate list references locally: generic custom_field filtering was observed to return unrelated POs.
    // Fetch details only for exact references, then recheck the full source record.
    try {
      for (let current = 1; current <= 20; current++) {
        const result = await read("purchaseorders", { filter_by: "Status.All", per_page: "200", page: String(current) });
        arr(result.purchaseorders).forEach(po => {
          const id = str(po.purchaseorder_id);
          const references = [norm(po.cf_sales_order_no), ...fieldsSO(po)].filter(Boolean);
          if (idValid(id) && (str(po.salesorder_id) === soId || references.includes(norm(so.salesorder_number)))) poIds.add(id);
        });
        if (!result.page_context?.has_more_page) break;
        if (current === 20) { complete.PO = false; notes.push("PO search reached its page limit; remaining quantities are unresolved."); }
      }
    } catch (error) { complete.PO = false; notes.push(error instanceof Error ? error.message : "PO search unavailable."); }
    const bills = new Set<string>();
    const seen = new Set<string>();
    const add = (kind: QuantityKind, raw: Source) => {
      const doc = normalizeDocument(kind, raw);
      if (seen.has(`${kind}:${doc.id}`)) return;
      seen.add(`${kind}:${doc.id}`);
      if (excludedStatus(doc.status)) excluded.push({ number: doc.number, kind, status: doc.status });
      else documents.push(doc);
    };
    for (const id of poIds) {
      try {
        const po = (await read(`purchaseorders/${id}`)).purchaseorder as Source;
        if (!po || str(po.purchaseorder_id) !== id) throw new Error("PO source detail unavailable.");
        const native = nativePoIds.has(id) || str(po.salesorder_id) === soId;
        const references = [...new Set(fieldsSO(po).filter(Boolean))];
        if (!native && !(references.length === 1 && references[0] === norm(so.salesorder_number))) continue;
        if (native && references.length && (references.length !== 1 || references[0] !== norm(so.salesorder_number))) { complete.PO = false; notes.push(`${po.purchaseorder_number}: conflicting SO reference; excluded.`); continue; }
        add("PO", po);
        if (excludedStatus(po.status)) continue;
        if (!Array.isArray(po.bills)) { complete.Bill = false; notes.push(`${po.purchaseorder_number}: bill relationship coverage not returned.`); }
        arr(po.bills).forEach(bill => { const billId = str(bill.bill_id); if (idValid(billId)) bills.add(billId); else complete.Bill = false; });
      } catch (error) { complete.PO = false; complete.Bill = false; notes.push(error instanceof Error ? error.message : "PO detail unavailable."); }
    }
    if (!complete.PO) complete.Bill = false;
    if (!complete.Invoice) notes.push("SO invoice relationship coverage not returned; invoice quantities are unresolved.");
    const invoices = [...new Set(arr(so.invoices).map(invoice => str(invoice.invoice_id)))];
    for (const [kind, ids] of [["Invoice", invoices], ["Bill", [...bills]]] as const) {
      for (const id of ids) {
        if (!idValid(id)) { complete[kind] = false; continue; }
        try {
          const [plural, singular] = definitions[kind];
          const raw = (await read(`${plural}/${id}`))[singular] as Source;
          if (!raw || str(raw[`${singular}_id`]) !== id) throw new Error(`${kind} detail unavailable.`);
          add(kind, raw);
        } catch (error) { complete[kind] = false; notes.push(error instanceof Error ? error.message : `${kind} detail unavailable.`); }
      }
    }
    const comparison = compareQuantities(documents, complete);
    return NextResponse.json({ ...comparison, documents, complete, excluded, notes: [...new Set(notes)], organization: orgName || org, checkedAt: new Date().toISOString(), sourceCoverage: "Explicit SO relationships and exact PO Sales Order No custom-field references only. Unlinked documents are outside this comparison.", readOnly: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && /^(Zoho |Select |Sales Order |Source )/.test(error.message) ? error.message : "Live comparison unavailable. Check the existing Zoho connection.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
