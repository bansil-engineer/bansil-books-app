import { getValidAccessToken } from "../../zoho-api.ts";
import { secureZohoFetch } from "../../zoho-security-guard.ts";
import type {
  ZohoChartOfAccount,
  ZohoBankAccount,
  ZohoChartOfAccountsResponse,
  ZohoBankAccountsResponse,
  ZohoBankTransaction,
  ZohoBankTransactionsResponse,
} from "./types.ts";

/**
 * Fetch Chart of Accounts. STRICTLY GET ONLY.
 */
export async function listChartOfAccounts(
  organizationId: string
): Promise<{ 
  accounts: ZohoChartOfAccount[]; 
  statusCode: number;
  paginationEvidence: {
    pagesRequested: number;
    recordsPerPage: number;
    rawRecords: number;
    uniqueRecords: number;
    duplicateRecords: number;
    completionEstablished: boolean;
  }
}> {
  const { token, store } = await getValidAccessToken();

  const allAccountsMap = new Map<string, ZohoChartOfAccount>();
  let page = 1;
  const perPage = 200;
  let hasMore = true;
  let lastStatusCode = 200;
  let rawRecords = 0;
  let completionEstablished = false;

  while (hasMore) {
    const params = new URLSearchParams({
      organization_id: organizationId,
      per_page: String(perPage),
      page: String(page),
      filter_by: "AccountType.All"
    });

    const url = `${store.api_domain}/books/v3/chartofaccounts?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      method: "GET", // Hardcoded GET
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    lastStatusCode = res.status;

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.accountants.READ`);
      }
      throw new Error(`Chart of Accounts API failed: HTTP ${res.status}`);
    }

    const data: ZohoChartOfAccountsResponse = await res.json();

    if (data.code !== 0) {
      if (data.code === 57 || data.message.includes("privilege")) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.accountants.READ`);
      }
      throw new Error(`Zoho API error: ${data.message}`);
    }

    const accounts = data.chartofaccounts ?? [];
    rawRecords += accounts.length;
    
    // Normalize safely without storing secrets
    for (const acc of accounts) {
      const accountId = String(acc.account_id);
      if (!allAccountsMap.has(accountId)) {
        allAccountsMap.set(accountId, {
          account_id: accountId,
          account_name: String(acc.account_name),
          account_code: String(acc.account_code || ""),
          account_type: String(acc.account_type),
          account_sub_type: acc.account_sub_type ? String(acc.account_sub_type) : undefined,
          parent_account_id: acc.parent_account_id ? String(acc.parent_account_id) : undefined,
          parent_account_name: acc.parent_account_name ? String(acc.parent_account_name) : undefined,
          is_active: Boolean(acc.is_active),
          currency_id: acc.currency_id ? String(acc.currency_id) : undefined,
          currency_code: acc.currency_code ? String(acc.currency_code) : undefined,
          current_balance: typeof acc.current_balance === "number" ? acc.current_balance : undefined,
        });
      }
    }

    // Rely on safe bounds and 0 records instead of unreliable has_more_page
    if (accounts.length === 0) {
       hasMore = false;
       completionEstablished = true;
    } else {
       page++;
       if (page > 50) {
         hasMore = false;
         completionEstablished = false; // Forced exit
       }
    }
  }

  const uniqueRecords = allAccountsMap.size;
  const duplicateRecords = rawRecords - uniqueRecords;

  return { 
    accounts: Array.from(allAccountsMap.values()), 
    statusCode: lastStatusCode,
    paginationEvidence: {
      pagesRequested: page,
      recordsPerPage: perPage,
      rawRecords,
      uniqueRecords,
      duplicateRecords,
      completionEstablished
    }
  };
}

export async function getZohoAccountById(organizationId: string, accountId: string): Promise<ZohoChartOfAccount | null> {
  const { token, store } = await getValidAccessToken();
  const url = `${store.api_domain}/books/v3/chartofaccounts/${accountId}?organization_id=${organizationId}`;
  const res = await secureZohoFetch(url, {
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
  });
  
  if (!res.ok) return null;
  const data = await res.json();
  if (data.code !== 0 || !data.chart_of_account) return null;
  
  const acc = data.chart_of_account;
  return {
    account_id: String(acc.account_id),
    account_name: String(acc.account_name),
    account_code: String(acc.account_code || ""),
    account_type: String(acc.account_type),
    account_sub_type: acc.account_sub_type ? String(acc.account_sub_type) : undefined,
    parent_account_id: acc.parent_account_id ? String(acc.parent_account_id) : undefined,
    parent_account_name: acc.parent_account_name ? String(acc.parent_account_name) : undefined,
    is_active: Boolean(acc.is_active),
    currency_id: acc.currency_id ? String(acc.currency_id) : undefined,
    currency_code: acc.currency_code ? String(acc.currency_code) : undefined,
    current_balance: typeof acc.current_balance === "number" ? acc.current_balance : undefined,
  };
}

/**
 * Fetch Bank Accounts. STRICTLY GET ONLY.
 */
export async function listBankAccounts(
  organizationId: string
): Promise<{ bankAccounts: ZohoBankAccount[]; statusCode: number }> {
  const { token, store } = await getValidAccessToken();

  const allAccounts: ZohoBankAccount[] = [];
  let page = 1;
  let hasMore = true;
  let lastStatusCode = 200;

  while (hasMore) {
    const params = new URLSearchParams({
      organization_id: organizationId,
      per_page: "200",
      page: String(page),
    });

    const url = `${store.api_domain}/books/v3/bankaccounts?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      method: "GET", // Hardcoded GET
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    lastStatusCode = res.status;

    if (!res.ok) {
      // Allow 403 to pass through gracefully for authorization blocker detection
      if (res.status === 403) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.banking.READ`);
      }
      throw new Error(`Bank Accounts API failed: HTTP ${res.status}`);
    }

    const data: ZohoBankAccountsResponse = await res.json();

    if (data.code !== 0) {
      if (data.code === 57 || data.message.includes("privilege")) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.banking.READ`);
      }
      throw new Error(`Zoho API error: ${data.message}`);
    }

    const accounts = data.bankaccounts ?? [];
    
    // Normalize safely, MASK account numbers
    for (const acc of accounts) {
      let maskedAcctNumber = undefined;
      if (acc.account_number) {
         const acctStr = String(acc.account_number);
         maskedAcctNumber = acctStr.length > 4 
             ? `****${acctStr.slice(-4)}` 
             : "****";
      }

      allAccounts.push({
        account_id: String(acc.account_id),
        account_name: String(acc.account_name),
        account_code: String(acc.account_code || ""),
        account_type: String(acc.account_type),
        currency_id: String(acc.currency_id || ""),
        currency_code: String(acc.currency_code || ""),
        is_active: Boolean(acc.is_active),
        bank_name: acc.bank_name ? String(acc.bank_name) : undefined,
        routing_number: acc.routing_number ? String(acc.routing_number) : undefined,
        uncategorized_transactions: typeof acc.uncategorized_transactions === "number" ? acc.uncategorized_transactions : undefined,
        balance: typeof acc.balance === "number" ? acc.balance : undefined,
        masked_account_number: maskedAcctNumber,
      });
    }

    hasMore = data.page_context?.has_more_page === true;
    page++;
    if (page > 50) break; // Safety limit
  }

  return { bankAccounts: allAccounts, statusCode: lastStatusCode };
}

/**
 * Fetch Bank Transactions for a given account. STRICTLY GET ONLY.
 */
export async function listBankAccountTransactions(
  organizationId: string,
  accountId: string,
  options?: {
    page?: number;
    per_page?: number;
    from_date?: string;
    to_date?: string;
    status?: string;
  }
): Promise<{ transactions: ZohoBankTransaction[]; statusCode: number }> {
  const { token, store } = await getValidAccessToken();

  const allTransactions: ZohoBankTransaction[] = [];
  let page = options?.page || 1;
  const perPage = options?.per_page || 200;
  let hasMore = true;
  let lastStatusCode = 200;

  while (hasMore) {
    const params = new URLSearchParams({
      organization_id: organizationId,
      account_id: accountId,
      per_page: String(perPage),
      page: String(page),
    });

    if (options?.from_date) {
      params.append("from_date", options.from_date);
    }
    if (options?.to_date) {
      params.append("to_date", options.to_date);
    }
    if (options?.status) {
      params.append("status", options.status);
    }

    const url = `${store.api_domain}/books/v3/banktransactions?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      method: "GET", // Hardcoded GET
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    lastStatusCode = res.status;

    if (!res.ok) {
      // Allow 403 to pass through gracefully
      if (res.status === 403) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.banking.READ`);
      }
      throw new Error(`Bank Transactions API failed: HTTP ${res.status}`);
    }

    const data: ZohoBankTransactionsResponse = await res.json();

    if (data.code !== 0) {
      if (data.code === 57 || data.message.includes("privilege")) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.banking.READ`);
      }
      throw new Error(`Zoho API error: ${data.message}`);
    }

    const transactions = data.banktransactions ?? [];
    
    // Normalize safely without storing secrets, retain provenance
    for (const tx of transactions) {
      allTransactions.push({
        transaction_id: String(tx.transaction_id),
        account_id: String(tx.account_id),
        account_name: tx.account_name ? String(tx.account_name) : undefined,
        date: String(tx.date || tx.transaction_date || ""),
        amount: Number(tx.amount || 0),
        transaction_type: String(tx.transaction_type),
        status: String(tx.status),
        source: tx.source ? String(tx.source) : undefined,
        debit_or_credit: tx.debit_or_credit ? String(tx.debit_or_credit) : undefined,
        reference_number: tx.reference_number ? String(tx.reference_number) : undefined,
        payee: tx.payee ? String(tx.payee) : undefined,
        description: tx.description ? String(tx.description) : undefined,
        currency_id: tx.currency_id ? String(tx.currency_id) : undefined,
        currency_code: tx.currency_code ? String(tx.currency_code) : undefined,
        imported_transaction_id: tx.imported_transaction_id ? String(tx.imported_transaction_id) : undefined,
      });
    }

    // Only paginate if caller didn't explicitly request a specific page
    if (options?.page) {
      hasMore = false;
    } else {
      if (transactions.length === 0 || transactions.length < perPage) {
        hasMore = false;
      } else {
        hasMore = true;
        page++;
        if (page > 50) break; // Safety limit
      }
    }
  }

  return { transactions: allTransactions, statusCode: lastStatusCode };
}

/**
 * Fetch Cash Transactions using the proven bankaccounts/{id}/transactions endpoint.
 */
export async function listCashAccountTransactions(
  organizationId: string,
  accountId: string,
  options?: {
    page?: number;
    per_page?: number;
    from_date?: string;
    to_date?: string;
    status?: string;
  }
): Promise<{ transactions: ZohoBankTransaction[]; statusCode: number }> {
  const { token, store } = await getValidAccessToken();

  const allTransactions: ZohoBankTransaction[] = [];
  let page = options?.page || 1;
  const perPage = options?.per_page || 200;
  let hasMore = true;
  let lastStatusCode = 200;

  while (hasMore) {
    const params = new URLSearchParams({
      organization_id: organizationId,
      per_page: String(perPage),
      page: String(page),
    });

    if (options?.from_date) {
      params.append("from_date", options.from_date);
    }
    if (options?.to_date) {
      params.append("to_date", options.to_date);
    }
    if (options?.status) {
      params.append("status", options.status);
    }

    const url = `${store.api_domain}/books/v3/bankaccounts/${accountId}/transactions?${params.toString()}`;
    const res = await secureZohoFetch(url, {
      method: "GET",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
    });

    lastStatusCode = res.status;

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.banking.READ`);
      }
      const errBody = await res.text().catch(() => "");
      throw new Error(`Cash Transactions API failed: HTTP ${res.status} - ${errBody}`);
    }

    const data: ZohoBankTransactionsResponse = await res.json();

    if (data.code !== 0) {
      if (data.code === 57 || data.message.includes("privilege")) {
        throw new Error(`AUTHORIZATION BLOCKER: ZohoBooks.banking.READ`);
      }
      throw new Error(`Zoho API error: ${data.message}`);
    }

    const transactions = data.banktransactions ?? [];
    
    for (const tx of transactions) {
      allTransactions.push({
        transaction_id: String(tx.transaction_id),
        account_id: String(tx.account_id),
        account_name: tx.account_name ? String(tx.account_name) : undefined,
        date: String(tx.date || tx.transaction_date || ""),
        amount: Number(tx.amount || 0),
        transaction_type: String(tx.transaction_type),
        status: String(tx.status),
        source: tx.source ? String(tx.source) : undefined,
        debit_or_credit: tx.debit_or_credit ? String(tx.debit_or_credit) : undefined,
        reference_number: tx.reference_number ? String(tx.reference_number) : undefined,
        payee: tx.payee ? String(tx.payee) : undefined,
        description: tx.description ? String(tx.description) : undefined,
        currency_id: tx.currency_id ? String(tx.currency_id) : undefined,
        currency_code: tx.currency_code ? String(tx.currency_code) : undefined,
        imported_transaction_id: tx.imported_transaction_id ? String(tx.imported_transaction_id) : undefined,
        running_balance: tx.running_balance !== undefined ? Number(tx.running_balance) : undefined,
      });
    }

    if (options?.page) {
      hasMore = false;
    } else {
      if (transactions.length === 0 || transactions.length < perPage) {
        hasMore = false;
      } else {
        hasMore = true;
        page++;
        if (page > 50) break; // Safety limit
      }
    }
  }

  return { transactions: allTransactions, statusCode: lastStatusCode };
}

