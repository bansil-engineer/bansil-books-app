import { secureZohoFetch } from "../../zoho-security-guard.ts";
import { getDatabase } from "../../db/database.ts";

export interface ZohoTrialBalanceRow {
  account_id: string;
  name: string;
  account_type?: string;
  account_code?: string;
  is_child_present?: boolean;
  net_debit_total?: number;
  net_credit_total?: number;
  account_transactions?: ZohoTrialBalanceRow[];
}

export interface ZohoTrialBalanceResponse {
  code: number;
  message: string;
  trialbalance: {
    account_transactions: ZohoTrialBalanceRow[];
    net_debit_total: number;
    net_credit_total: number;
  }[];
  page_context: {
    as_of_date: string;
    to_date: string;
    [key: string]: any;
  };
}

function resolveOrganizationId(): string {
  const db = getDatabase();
  const org = db.prepare(`SELECT organization_id FROM organizations LIMIT 1`).get() as { organization_id: string } | undefined;
  if (!org) {
    throw new Error("No organization context found. Organization ID cannot be resolved.");
  }
  return org.organization_id;
}

import { getValidAccessToken } from "../../zoho-api.ts";

export async function getZohoTrialBalance(fromDate: string, toDate: string): Promise<ZohoTrialBalanceResponse> {
  const orgId = resolveOrganizationId();
  const { token, store } = await getValidAccessToken();
  
  const query = new URLSearchParams({
    organization_id: orgId,
    filter_by: "TransactionDate.CustomDate",
    from_date: fromDate,
    to_date: toDate,
    response_option: '2'
  });

  const response = await secureZohoFetch(`${store.api_domain}/books/v3/reports/trialbalance?${query.toString()}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Trial Balance: Status ${response.status} ${response.statusText} - Body: ${errorText}`);
  }

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`Zoho API Error: ${data.message}`);
  }

  return data;
}
export async function getZohoTrialBalanceAsOf(fyEndDate: string): Promise<ZohoTrialBalanceResponse> {
  const orgId = resolveOrganizationId();
  const { token, store } = await getValidAccessToken();
  
  // To obtain a true cumulative As-Of Trial Balance (which includes all opening balances),
  // we must provide a sufficiently early from_date so that the movement period covers
  // the entire history of the company. 1970-01-01 is used to ensure we capture all transactions.
  // The Zoho API ignores as_of_date and requires a from_date / to_date range.
  const query = new URLSearchParams({
    organization_id: orgId,
    filter_by: "TransactionDate.CustomDate",
    from_date: "1970-01-01",
    to_date: fyEndDate,
    response_option: '2'
  });

  const response = await secureZohoFetch(`${store.api_domain}/books/v3/reports/trialbalance?${query.toString()}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Cumulative Trial Balance: Status ${response.status} ${response.statusText} - Body: ${errorText}`);
  }

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`Zoho API Error: ${data.message}`);
  }

  return data;
}

export async function getZohoProfitAndLoss(fromDate: string, toDate: string): Promise<any> {
  const orgId = resolveOrganizationId();
  const { token, store } = await getValidAccessToken();
  
  const query = new URLSearchParams({
    organization_id: orgId,
    filter_by: "TransactionDate.CustomDate",
    from_date: fromDate,
    to_date: toDate,
    response_option: '2'
  });

  const response = await secureZohoFetch(`${store.api_domain}/books/v3/reports/profitandloss?${query.toString()}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Profit & Loss: Status ${response.status} ${response.statusText} - Body: ${errorText}`);
  }

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(`Zoho API Error: ${data.message}`);
  }

  return data;
}
