import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, fetchOrganizations } from "@/app/lib/zoho-api";
import { secureZohoFetch } from "@/app/lib/zoho-security-guard";
import { classifyMapping, extractCustomField } from "@/app/lib/audit/so-po-mapping";
import type { LinkEvidence } from "@/app/lib/audit/so-po-mapping";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const dynamic = "force-dynamic";
const kinds = { PO: "purchaseorder", SO: "salesorder" } as const;
const text = (value: unknown) => typeof value === "string" ? value : "";
const normalize = (value: string) => value.trim().toLocaleLowerCase();

// On-demand Books GETs only. No sync, database connection, or persisted audit result.
export async function GET(request: NextRequest) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("audit/order-comparison", "GET"), "audit/order-comparison GET");
  if (!rbacGuard.ok) return rbacGuard.response;
  const kind = request.nextUrl.searchParams.get("kind") as keyof typeof kinds;
  const number = request.nextUrl.searchParams.get("number")?.trim() || "";
  if (!Object.hasOwn(kinds, kind) || !number || number.length > 100) {
    return NextResponse.json({ error: "Choose PO or SO and enter a document number." }, { status: 400 });
  }
  try {
    const { token, store } = await getValidAccessToken();
    let organizationId = store.organization_id;
    let organizationName = store.organization_name;
    if (!organizationId) {
      const organizations = await fetchOrganizations();
      if (organizations.length !== 1) return NextResponse.json({ error: "Choose an organization in the existing Zoho connection settings before live lookup." }, { status: 409 });
      organizationId = organizations[0].organization_id;
      organizationName = organizations[0].name;
    }
    const read = async (path: string, parameters: Record<string, string> = {}) => {
      const url = new URL(`${store.api_domain}/books/v3/${path}`);
      url.search = new URLSearchParams({ organization_id: organizationId!, ...parameters }).toString();
      const response = await secureZohoFetch(url, { method: "GET", cache: "no-store", headers: { Authorization: `Zoho-oauthtoken ${token}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Zoho read unavailable (HTTP ${response.status}).`);
      const data = await response.json();
      if (data.code !== 0) throw new Error("Zoho did not return this document. Check read access and the document number.");
      return data;
    };
    const find = async (type: keyof typeof kinds, documentNumber: string) => {
      const singular = kinds[type];
      const list = await read(`${singular}s`, { [`${singular}_number`]: documentNumber, per_page: "200" });
      const exact = (list[`${singular}s`] || []).filter((record: Record<string, unknown>) => normalize(text(record[`${singular}_number`])) === normalize(documentNumber));
      if (exact.length !== 1 || list.page_context?.has_more_page) throw new Error(`${type} ${documentNumber}: unique exact number not established. No match selected.`);
      const id = text(exact[0][`${singular}_id`]);
      if (!/^\d+$/.test(id)) throw new Error("Source document identifier unavailable.");
      const result = await read(`${singular}s/${id}`);
      const record = result[singular];
      if (!record || normalize(text(record[`${singular}_number`])) !== normalize(documentNumber)) throw new Error("Source number differs from the requested document.");
      return {
        kind: type, number: text(record[`${singular}_number`]), party: text(record.vendor_name || record.customer_name),
        date: text(record.date), status: text(record.status), reference: text(record.reference_number),
        total: record.total, currency: text(record.currency_code) || "INR",
        deliveryName: text(record.delivery_customer_name || record.delivery_address?.attention || record.shipping_address?.attention),
        customFields: (record.custom_fields || []).map((field: Record<string, unknown>) => ({ label: text(field.label || field.api_name) || "Unlabelled custom field", value: String(field.value_formatted ?? field.value ?? "") })),
        lines: (record.line_items || []).map((line: Record<string, unknown>) => ({ itemId: text(line.item_id), name: text(line.name), description: text(line.description), quantity: line.quantity, unit: text(line.unit), rate: line.rate, amount: line.item_total })),
        // Custom verifier is deliberately separate from workflow approval metadata.
        workflowApprover: text(record.approved_by_name),
      };
    };
    const document = await find(kind, number);
    let linkedSalesOrder = null;
    let linkNote = kind === "SO" ? "Exact SO number verified in the connected organization. Related PO, invoice and payment coverage is not established by this lookup." : "No explicit Sales Order No custom field found.";
    let linkEvidence: LinkEvidence | null = null;

    if (kind === "PO") {
      // Extract SO reference custom fields by label
      const soFields = document.customFields.filter((field: { label: string; value: string }) => /^(sales\s*order\s*(no\.?|number)|cf_sales_order_no)$/i.test(field.label.trim()) && field.value.trim());
      const soReferenceValues = [...new Set<string>(soFields.map((field: { value: string }) => field.value.trim()))];

      // Extract supporting custom fields
      const customerFieldRaw = extractCustomField(document.customFields, /^customer\s*name$/i);
      const checkAndVerifyRaw = extractCustomField(document.customFields, /^check\s*and\s*verify$/i);
      const deliveryCustomerRaw = document.deliveryName || null;

      let soLookupError = false;

      if (soReferenceValues.length === 1) {
        try {
          linkedSalesOrder = await find("SO", soReferenceValues[0]);
          linkNote = "Explicit PO custom-field reference; exact SO number verified in the connected organization. This is not a settlement approval.";
        } catch (error) {
          soLookupError = true;
          linkNote = error instanceof Error ? error.message : "Linked SO unavailable.";
        }
      } else if (soReferenceValues.length > 1) {
        linkNote = "Conflicting Sales Order No values. Link unresolved.";
      }

      linkEvidence = classifyMapping({
        soReferenceValues,
        customerFieldRaw,
        checkAndVerifyRaw,
        deliveryCustomerRaw,
        linkedSalesOrder,
        soLookupError,
      });
    }

    return NextResponse.json({ document, linkedSalesOrder, linkNote, linkEvidence, organization: organizationName || organizationId, checkedAt: new Date().toISOString(), readOnly: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && /^(Zoho read unavailable|Zoho did not|PO |SO |Source )/.test(error.message) ? error.message : "Live read unavailable. Check the existing Zoho connection and try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
