import {
  DateEvidence,
  EvidenceStrength,
  Severity,
  SettlementStatus,
  BankMatchResult
} from "./types.ts";

export const RULESET_VERSION = 'BANK_SETTLEMENT_V1';
export const DATE_TOLERANCE_DAYS = 2;
export const FUZZY_AUTO_CONFIRM = false;

export function amountToleranceFor(currency: string, context: string): number {
  return 0; // EXACT AMOUNT by default unless explicitly configured
}

export function normalizeReference(ref: string): string {
  if (!ref) return '';
  return ref.trim().toUpperCase().replace(/\\s+/g, ' ');
}

export function evaluateDateEvidence(docDateStr: string, bankDateStr: string): DateEvidence {
  const doc = new Date(docDateStr);
  const bank = new Date(bankDateStr);
  const diffTime = bank.getTime() - doc.getTime();
  const diffDays = Math.round(diffTime / (1000 * 3600 * 24));
  
  if (diffDays === 0) return 'DATE_EXACT';
  if (Math.abs(diffDays) <= DATE_TOLERANCE_DAYS) return 'DATE_WITHIN_2_DAYS';
  return 'DATE_OUTSIDE_TOLERANCE';
}

export function evaluateAmountEvidence(docAmount: number, bankAmount: number, currency: string, context: string): EvidenceStrength | 'NO_MATCH' {
  const diff = Math.abs(docAmount - bankAmount);
  if (diff === 0) return 'EXACT_AMOUNT';
  if (diff <= amountToleranceFor(currency, context)) return 'ROUNDING_AMOUNT';
  return 'NO_MATCH';
}

export function evaluateReferenceEvidence(docRef: string, bankRef: string): EvidenceStrength | 'NO_MATCH' {
  if (!docRef || !bankRef) return 'NO_MATCH';
  if (normalizeReference(docRef) === normalizeReference(bankRef)) {
    return 'EXACT_BANK_REFERENCE';
  }
  return 'NO_MATCH';
}

export function determineBankMatch(
  refEvidence: EvidenceStrength | 'NO_MATCH',
  dateEvidence: DateEvidence,
  amountEvidence: EvidenceStrength | 'NO_MATCH',
  fuzzyEvidence: EvidenceStrength | 'NO_MATCH' = 'NO_MATCH'
): BankMatchResult {
  // Precedence 1: Exact reference matching
  if (refEvidence === 'EXACT_BANK_REFERENCE' || refEvidence === 'EXACT_UTR') {
    // Conflict: exact reference but financial amount contradicts
    if (amountEvidence === 'NO_MATCH') {
      return 'CONFLICT';
    }
    return 'CONFIRMED_BANK_REFERENCE';
  }

  // Precedence 2: Exact Amount + Acceptable Date
  if (amountEvidence === 'EXACT_AMOUNT' && (dateEvidence === 'DATE_EXACT' || dateEvidence === 'DATE_WITHIN_2_DAYS')) {
    return 'CONFIRMED_AMOUNT_DATE_ACCOUNT';
  }
  
  // Fuzzy can NEVER confirm
  if (fuzzyEvidence === 'FUZZY_SUGGESTION' && !FUZZY_AUTO_CONFIRM) {
    return 'SUGGESTED_REVIEW';
  }

  return 'NO_MATCH';
}

export function buildAmountBridge(base: number, adjustments: {amount: number, sign: number}[]): number {
  let net = base;
  for (const a of adjustments) {
    net += (a.amount * a.sign);
  }
  return net;
}

export function classifySettlementStatus(expected: number, actual: number, hasBank: boolean): SettlementStatus {
  if (actual === 0 && expected > 0) return 'UNSETTLED';
  if (expected === 0 && actual === 0) return 'UNSETTLED';
  if (!hasBank && expected > 0) return 'BANK_EVIDENCE_MISSING';
  if (expected === actual) return 'FULLY_SETTLED';
  if (actual > 0 && actual < expected) return 'PARTIALLY_SETTLED';
  if (actual > expected) return 'OVER_SETTLED';
  return 'UNEXPLAINED_DIFFERENCE';
}

export function calculateSeverity(diffAmount: number, ageDays: number, statutoryRelevance: boolean, evidenceStrength: EvidenceStrength, recurrence: boolean): Severity {
  if (statutoryRelevance && diffAmount > 1000) return 'CRITICAL';
  if (diffAmount > 50000) return 'HIGH';
  if (ageDays > 30) return 'MEDIUM';
  if (diffAmount > 0) return 'LOW';
  return 'INFO';
}

import { SettlementEvidencePolicy } from "./types.ts";

export function getAccountTypePolicy(rawType: string): SettlementEvidencePolicy {
  switch (rawType.toLowerCase()) {
    case 'bank': return 'BANK_STATEMENT_REQUIRED';
    case 'credit_card': return 'CARD_STATEMENT_REQUIRED';
    case 'cash': return 'CASH_BOOK_EVIDENCE';
    case 'payment_clearing': return 'CLEARING_RESOLUTION_REQUIRED';
    default: return 'OWNER_REVIEW';
  }
}
