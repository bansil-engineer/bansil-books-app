// PURE RULE ENGINE SKELETON - Types
// Pure definitions only. No APIs or DB calls.

export type SourceRelationshipResult =
  | 'EXPLICIT_SOURCE_LINK'
  | 'EXPLICIT_ALLOCATION'
  | 'DETAIL_ONLY'
  | 'MISSING'
  | 'AMBIGUOUS';

export type BankMatchResult = 
  | 'CONFIRMED_BANK_REFERENCE'
  | 'CONFIRMED_AMOUNT_DATE_ACCOUNT'
  | 'PARTIAL_MATCH'
  | 'NO_MATCH'
  | 'AMBIGUOUS'
  | 'CONFLICT'
  | 'SUGGESTED_REVIEW'
  | 'SOURCE_COVERAGE_INSUFFICIENT';

export type DateEvidence = 
  | 'DATE_EXACT'
  | 'DATE_WITHIN_2_DAYS'
  | 'DATE_OUTSIDE_TOLERANCE';

export type EvidenceStrength = 
  | 'EXPLICIT_SOURCE_LINK'
  | 'EXPLICIT_ALLOCATION'
  | 'EXACT_BANK_REFERENCE'
  | 'EXACT_UTR'
  | 'EXACT_CHEQUE_REFERENCE'
  | 'EXACT_ACCOUNT'
  | 'EXACT_AMOUNT'
  | 'ROUNDING_AMOUNT'
  | 'EXACT_DATE'
  | 'DATE_WITHIN_2_DAYS'
  | 'PARTY_EXACT'
  | 'DOCUMENT_REFERENCE'
  | 'NARRATION_SUPPORT'
  | 'FUZZY_SUGGESTION';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type SettlementEvidencePolicy =
  | 'BANK_STATEMENT_REQUIRED'
  | 'CARD_STATEMENT_REQUIRED'
  | 'CASH_BOOK_EVIDENCE'
  | 'CLEARING_RESOLUTION_REQUIRED'
  | 'OWNER_REVIEW';

export type SettlementStatus = 
  | 'FULLY_SETTLED'
  | 'PARTIALLY_SETTLED'
  | 'UNSETTLED'
  | 'OVER_SETTLED'
  | 'EXPLAINED_DIFFERENCE'
  | 'UNEXPLAINED_DIFFERENCE'
  | 'BANK_EVIDENCE_MISSING'
  | 'AMBIGUOUS_BANK_EVIDENCE'
  | 'CLEARING_EVIDENCE_PENDING'
  | 'UNALLOCATED_VENDOR_ADVANCE'
  | 'OWNER_REVIEW_REQUIRED'
  | 'SOURCE_COVERAGE_INSUFFICIENT'
  | 'BANK_EVIDENCE_CONFLICT';

export interface SalesSettlementInput {
  salesorder?: any;
  invoice: any;
  paymentAllocations: any[];
  payments: any[];
  paymentAccounts: any[];
  bankTransactions: any[];
  creditAdjustments: any[];
  futureTdsAdjustments: any[];
}

export interface PurchaseSettlementInput {
  purchaseOrder?: any;
  bill?: {
    billId: string;
    total: number;
    balance?: number; // Added to check for unexplained deductions
    currencyCode: string;
    sourceRunId: string;
  };
  paymentAllocations: any[];
  payments: any[];
  paymentAccounts: any[];
  bankTransactions: any[];
  adjustments: any[];
}

export type PurchaseAlert =
  | 'PO_NOT_BILLED'
  | 'BILL_WITHOUT_PO'
  | 'PAYMENT_WITHOUT_BILL_ALLOCATION'
  | 'PAYMENT_WITHOUT_BANK_EVIDENCE'
  | 'BANK_DEBIT_WITHOUT_BOOKS_PAYMENT'
  | 'BILL_PARTIALLY_SETTLED'
  | 'UNEXPLAINED_DEDUCTION'
  | 'AMOUNT_DIFFERENCE'
  | 'TIMING_DIFFERENCE'
  | 'AMBIGUOUS_BANK_MATCH'
  | 'BANK_EVIDENCE_CONFLICT'
  | 'BANK_EVIDENCE_MISSING'
  | 'SOURCE_COVERAGE_INSUFFICIENT'
  | 'CLEARING_EVIDENCE_REQUIRED'
  | 'OVER_SETTLED';

export interface PurchaseReconciliationResult {
  billId?: string;
  sourceRunId?: string;
  purchaseOrderId?: string;
  expectedSettlement: number;
  allocatedPaymentAmount: number;
  bankSupportedAmount: number;
  remainingAmount: number;
  differenceAmount: number;
  settlementStatus: SettlementStatus;
  bankMatchResults: {
    paymentId: string;
    bankTransactionId?: string;
    matchResult: BankMatchResult;
    evidenceStrength: EvidenceStrength | 'NO_MATCH';
  }[];
  amountBridge: {
    component_type: string;
    component_sign: number;
    component_amount: number;
    currency_code: string;
    source_type: string;
    source_id: string;
    source_run_id?: string;
    reason_code?: string;
  }[];
  evidenceLinks: {
    source_type: string;
    source_id: string;
    source_run_id: string;
    relationship_type: string;
    evidence_strength: EvidenceStrength;
    amount_contribution: number;
    currency_code: string;
  }[];
  alerts: PurchaseAlert[];
}
