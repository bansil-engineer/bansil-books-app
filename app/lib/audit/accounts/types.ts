export interface ZohoChartOfAccount {
  account_id: string;
  account_name: string;
  account_code: string;
  account_type: string;
  account_sub_type?: string;
  parent_account_id?: string;
  parent_account_name?: string;
  is_active: boolean;
  currency_id?: string;
  currency_code?: string;
  current_balance?: number;
}

export interface ZohoBankAccount {
  account_id: string;
  account_name: string;
  account_code: string;
  account_type: string;
  currency_id: string;
  currency_code: string;
  is_active: boolean;
  bank_name?: string;
  routing_number?: string;
  uncategorized_transactions?: number;
  balance?: number;
  masked_account_number?: string;
}

export interface ZohoChartOfAccountsResponse {
  code: number;
  message: string;
  chartofaccounts: any[];
  page_context?: {
    page: number;
    has_more_page: boolean;
  };
}

export interface ZohoBankAccountsResponse {
  code: number;
  message: string;
  bankaccounts: any[];
  page_context?: {
    page: number;
    has_more_page: boolean;
  };
}

export interface ZohoBankTransaction {
  transaction_id: string;
  account_id: string;
  account_name?: string;
  date: string;
  amount: number;
  transaction_type: string;
  status: string; // e.g. uncategorized, categorized, matched, excluded, manually_added, etc.
  source?: string;
  debit_or_credit?: string; // "debit" / "credit"
  reference_number?: string;
  payee?: string;
  description?: string;
  currency_id?: string;
  currency_code?: string;
  imported_transaction_id?: string;
  running_balance?: number;
}

export interface ZohoBankTransactionsResponse {
  code: number;
  message: string;
  banktransactions: any[];
  page_context?: {
    page: number;
    has_more_page: boolean;
  };
}
