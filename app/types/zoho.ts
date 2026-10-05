// ============================================================
// Zoho Books — Shared TypeScript Types
// Server-side and client-side safe (no secrets here)
// ============================================================

// ---- Centralized Zoho Auth & Sync Endpoints ----
export const ZOHO_CONNECT_ENDPOINT = "/api/zoho/connect";
export const ZOHO_CALLBACK_ENDPOINT = "/api/zoho/callback";
export const ZOHO_DISCONNECT_ENDPOINT = "/api/sync/disconnect";
export const ZOHO_STATUS_ENDPOINT = "/api/zoho/status";

export interface ZohoTokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix ms
  api_domain: string; // e.g. "https://www.zohoapis.in"
  accounts_url: string; // e.g. "https://accounts.zoho.in"
  location: string; // e.g. "in", "com", "eu"
  organization_id?: string;
  organization_name?: string;
  currency_code?: string;
  currency_symbol?: string;
}

export interface ZohoOrganization {
  organization_id: string;
  name: string;
  contact_name: string;
  email: string;
  currency_code: string;
  currency_symbol: string;
  time_zone: string;
  fiscal_year_start_month: string;
  country: string;
  is_default_org: boolean;
}

export interface ZohoOrganizationsResponse {
  code: number;
  message: string;
  organizations: ZohoOrganization[];
}

// ---- Invoice types ----

export interface ZohoInvoice {
  invoice_id: string;
  invoice_number: string;
  date: string; // YYYY-MM-DD
  due_date: string;
  status: string;
  customer_name: string;
  customer_id?: string;
  reference_number: string;
  currency_code: string;
  total: number;
  balance: number;
  created_time?: string;
  invoice_url?: string;
  is_verified_link?: boolean;
}

export interface ZohoInvoicesResponse {
  code: number;
  message: string;
  invoices: ZohoInvoice[];
  page_context: ZohoPageContext;
}

// ---- Bill types ----

export interface ZohoBill {
  bill_id: string;
  bill_number: string;
  date: string; // YYYY-MM-DD
  due_date: string;
  status: string;
  vendor_name: string;
  vendor_id?: string;
  reference_number: string;
  currency_code: string;
  total: number;
  balance: number;
  created_time?: string;
  bill_url?: string;
  is_verified_link?: boolean;
}

export interface ZohoBillsResponse {
  code: number;
  message: string;
  bills: ZohoBill[];
  page_context: ZohoPageContext;
}

export interface ZohoPageContext {
  page: number;
  per_page: number;
  has_more_page: boolean;
  report_name?: string;
  applied_filter?: string;
  sort_column?: string;
  sort_order?: string;
}

// ---- API Route response types (client-facing, no secrets) ----

export interface ConnectionStatus {
  connected: boolean;
  organizationId?: string;
  organizationName?: string;
  currencyCode?: string;
  currencySymbol?: string;
  apiDomain?: string;
  location?: string;
  accountsUrl?: string;
  expiresAt?: number;
  lastSyncAt?: string | null;
  lastSuccessfulSyncTime?: string | null;
  syncedThrough?: string | null;
  syncedThroughDisplay?: string | null;
}

export interface TodaysDataResponse {
  date: string; // YYYY-MM-DD (IST)
  invoices: ZohoInvoice[];
  bills: ZohoBill[];
  invoiceTotal: string; // decimal string
  billTotal: string; // decimal string
  invoiceBalanceTotal: string;
  billBalanceTotal: string;
  invoiceCount: number;
  billCount: number;
  invoiceApiStatus: number;
  billApiStatus: number;
  invoiceError?: string;
  billError?: string;
  lastRefreshed: string; // ISO timestamp
}

export interface ApiError {
  error: string;
  code?: string | number;
}
