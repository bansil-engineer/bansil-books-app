import { getValidAccessToken } from "../../zoho-api.ts";
import { secureZohoFetch } from "../../zoho-security-guard.ts";

async function baseGet(endpoint: string, organizationId: string, page = 1, perPage = 3) {
  const { token, store } = await getValidAccessToken();
  const url = `${store.api_domain}${endpoint}?organization_id=${organizationId}&page=${page}&per_page=${perPage}`;
  const res = await secureZohoFetch(url, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  if (!res.ok) throw new Error(`GET ${endpoint} failed: HTTP ${res.status}`);
  return res.json();
}

async function baseGetDetail(endpoint: string, id: string, organizationId: string) {
  const { token, store } = await getValidAccessToken();
  const url = `${store.api_domain}${endpoint}/${id}?organization_id=${organizationId}`;
  const res = await secureZohoFetch(url, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  if (!res.ok) throw new Error(`GET ${endpoint}/${id} failed: HTTP ${res.status}`);
  return res.json();
}

export async function listCustomerPayments(orgId: string, perPage = 3) {
  return baseGet("/books/v3/customerpayments", orgId, 1, perPage);
}
export async function getCustomerPayment(orgId: string, id: string) {
  return baseGetDetail("/books/v3/customerpayments", id, orgId);
}

export async function listVendorPayments(orgId: string, perPage = 3) {
  return baseGet("/books/v3/vendorpayments", orgId, 1, perPage);
}
export async function getVendorPayment(orgId: string, id: string) {
  return baseGetDetail("/books/v3/vendorpayments", id, orgId);
}

export async function listCreditNotes(orgId: string, perPage = 3) {
  return baseGet("/books/v3/creditnotes", orgId, 1, perPage);
}
export async function getCreditNote(orgId: string, id: string) {
  return baseGetDetail("/books/v3/creditnotes", id, orgId);
}

export async function listVendorCredits(orgId: string, perPage = 3) {
  return baseGet("/books/v3/vendorcredits", orgId, 1, perPage);
}
export async function getVendorCredit(orgId: string, id: string) {
  return baseGetDetail("/books/v3/vendorcredits", id, orgId);
}

export async function listSalesOrders(orgId: string, perPage = 3) {
  return baseGet("/books/v3/salesorders", orgId, 1, perPage);
}
export async function getSalesOrder(orgId: string, id: string) {
  return baseGetDetail("/books/v3/salesorders", id, orgId);
}
export async function getSalesOrderByNumber(orgId: string, soNumber: string) {
  const { token, store } = await getValidAccessToken();
  let url = `${store.api_domain}/books/v3/salesorders?organization_id=${orgId}&salesorder_number=${encodeURIComponent(soNumber)}`;
  let res = await secureZohoFetch(url, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  if (!res.ok) throw new Error(`GET salesorders by number failed: HTTP ${res.status}`);
  let data = await res.json();
  if (data.salesorders && data.salesorders.length > 0) {
    const so = data.salesorders[0];
    return { salesorder: so, salesorder_id: so.salesorder_id };
  }
  // If no match and soNumber is 7 digits without "SO-", try with "SO-" prefix
  const cleanDigits = soNumber.replace(/\D/g, "");
  if (cleanDigits.length >= 7 && !soNumber.toUpperCase().startsWith("SO-")) {
    const fallbackNumber = `SO-${cleanDigits.slice(-7)}`;
    url = `${store.api_domain}/books/v3/salesorders?organization_id=${orgId}&salesorder_number=${encodeURIComponent(fallbackNumber)}`;
    res = await secureZohoFetch(url, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${token}` }
    });
    if (res.ok) {
      data = await res.json();
      if (data.salesorders && data.salesorders.length > 0) {
        const so = data.salesorders[0];
        return { salesorder: so, salesorder_id: so.salesorder_id };
      }
    }
  }
  return { salesorder: null, salesorder_id: null };
}

export async function listPurchaseOrders(orgId: string, perPage = 3) {
  return baseGet("/books/v3/purchaseorders", orgId, 1, perPage);
}
export async function getPurchaseOrder(orgId: string, id: string) {
  return baseGetDetail("/books/v3/purchaseorders", id, orgId);
}

export async function listJournals(orgId: string, perPage = 3) {
  return baseGet("/books/v3/journals", orgId, 1, perPage);
}
export async function getJournal(orgId: string, id: string) {
  return baseGetDetail("/books/v3/journals", id, orgId);
}

export async function listExpenses(orgId: string, perPage = 3) {
  return baseGet("/books/v3/expenses", orgId, 1, perPage);
}
export async function getExpense(orgId: string, id: string) {
  return baseGetDetail("/books/v3/expenses", id, orgId);
}

export async function listBills(orgId: string, perPage = 3) {
  return baseGet("/books/v3/bills", orgId, 1, perPage);
}
export async function getBill(orgId: string, id: string) {
  return baseGetDetail("/books/v3/bills", id, orgId);
}

export async function listInvoices(orgId: string, perPage = 3) {
  return baseGet("/books/v3/invoices", orgId, 1, perPage);
}
export async function getInvoice(orgId: string, id: string) {
  return baseGetDetail("/books/v3/invoices", id, orgId);
}

export async function listBankTransactions(orgId: string, accountId: string, page = 1, perPage = 200) {
  const { token, store } = await getValidAccessToken();
  const url = `${store.api_domain}/books/v3/bankaccounts/${accountId}/transactions?organization_id=${orgId}&page=${page}&per_page=${perPage}`;
  const res = await secureZohoFetch(url, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  });
  if (!res.ok) throw new Error(`GET bankaccounts/${accountId}/transactions failed: HTTP ${res.status}`);
  return res.json();
}
