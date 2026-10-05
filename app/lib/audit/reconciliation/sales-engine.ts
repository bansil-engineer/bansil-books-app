import type { 
  SalesSettlementInput, 
  SettlementStatus, 
  EvidenceStrength, 
  Severity 
} from "./types.ts";

export interface SalesReconciliationResult {
  status: SettlementStatus; // Legacy, keep for compatibility
  settlementStatus: SettlementStatus;
  baseAmount: number;
  expectedSettlement: number;
  observedSettlementAmount: number;
  remainingAmount: number;
  differenceAmount: number;
  alerts: Array<{ type: string; severity: Severity; message: string; evidence: EvidenceStrength[] }>;
  amountBridge: {
    component_type: string;
    component_sign: number;
    component_amount: number;
    currency_code: string;
    source_type: string;
    source_id: string;
    source_run_id?: string;
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
}

export function evaluateSalesSettlement(input: SalesSettlementInput): SalesReconciliationResult {
  const invoiceTotal = Number(input.invoice.total) || 0;
  const currency = input.invoice.currency_code || 'INR';
  const sourceRunId = input.invoice.source_run_id;
  
  const amountBridge: SalesReconciliationResult['amountBridge'] = [];
  const evidenceLinks: SalesReconciliationResult['evidenceLinks'] = [];

  amountBridge.push({
    component_type: 'INVOICE_GROSS',
    component_sign: 1,
    component_amount: invoiceTotal,
    currency_code: currency,
    source_type: 'ZOHO_INVOICE',
    source_id: input.invoice.invoice_id,
    source_run_id: sourceRunId
  });

  let allocatedTotal = 0;
  for (const alloc of input.paymentAllocations) {
    const amt = Number(alloc.amount_applied) || 0;
    allocatedTotal += amt;
    amountBridge.push({
      component_type: 'PAYMENT_ALLOCATION',
      component_sign: -1,
      component_amount: amt,
      currency_code: currency,
      source_type: 'ZOHO_PAYMENT_ALLOCATION',
      source_id: alloc.payment_id,
      source_run_id: alloc.source_run_id || sourceRunId
    });
    evidenceLinks.push({
      source_type: 'ZOHO_CUSTOMER_PAYMENT',
      source_id: alloc.payment_id,
      source_run_id: alloc.source_run_id || sourceRunId,
      relationship_type: 'SETTLES',
      evidence_strength: 'EXPLICIT_ALLOCATION',
      amount_contribution: amt,
      currency_code: currency
    });
  }

  // Adjustments (TDS, Write-offs, etc.)
  let tdsAdjustments = 0;
  for (const adj of input.futureTdsAdjustments) {
    const amt = Number(adj.amount) || 0;
    tdsAdjustments += amt;
    amountBridge.push({
      component_type: 'TDS_ADJUSTMENT',
      component_sign: -1,
      component_amount: amt,
      currency_code: currency,
      source_type: 'ZOHO_SALES_ADJUSTMENT',
      source_id: adj.adjustment_id,
      source_run_id: adj.source_run_id || sourceRunId
    });
    evidenceLinks.push({
      source_type: 'ZOHO_SALES_ADJUSTMENT',
      source_id: adj.adjustment_id,
      source_run_id: adj.source_run_id || sourceRunId,
      relationship_type: 'ADJUSTS',
      evidence_strength: 'EXPLICIT_SOURCE_LINK',
      amount_contribution: amt,
      currency_code: currency
    });
  }
  
  let otherAdjustments = 0;
  for (const cr of input.creditAdjustments) {
    const amt = Number(cr.amount) || 0;
    otherAdjustments += amt;
    amountBridge.push({
      component_type: 'CREDIT_NOTE',
      component_sign: -1,
      component_amount: amt,
      currency_code: currency,
      source_type: 'ZOHO_CREDIT_NOTE',
      source_id: cr.creditnote_id,
      source_run_id: cr.source_run_id || sourceRunId
    });
    evidenceLinks.push({
      source_type: 'ZOHO_CREDIT_NOTE',
      source_id: cr.creditnote_id,
      source_run_id: cr.source_run_id || sourceRunId,
      relationship_type: 'ADJUSTS',
      evidence_strength: 'EXPLICIT_SOURCE_LINK',
      amount_contribution: amt,
      currency_code: currency
    });
  }

  const accountedTotal = allocatedTotal + tdsAdjustments + otherAdjustments;
  
  // Calculate unallocated based on total minus accounted
  const differenceAmount = Math.round((invoiceTotal - accountedTotal) * 100) / 100;
  const remainingAmount = Number(input.invoice.balance) || 0;

  let settlementStatus: SettlementStatus = "UNSETTLED";
  const alerts: SalesReconciliationResult["alerts"] = [];

  if (accountedTotal === 0) {
    settlementStatus = "UNSETTLED";
  } else if (Math.abs(differenceAmount) < 0.05) {
    settlementStatus = "FULLY_SETTLED";
    
    // Check if bank evidence is missing
    if (!input.bankTransactions || input.bankTransactions.length === 0) {
      settlementStatus = "BANK_EVIDENCE_MISSING";
      alerts.push({
        type: "PAYMENT_WITHOUT_BANK_EVIDENCE",
        severity: "CRITICAL",
        message: `Invoice ${input.invoice.invoice_number} is fully allocated but bank transaction is missing.`,
        evidence: ["EXPLICIT_ALLOCATION"]
      });
    }
  } else if (differenceAmount > 0.05) {
    if (allocatedTotal > 0) {
      settlementStatus = "PARTIALLY_SETTLED";
    }
  } else if (differenceAmount < -0.05) {
    settlementStatus = "OVER_SETTLED";
    alerts.push({
      type: "OVER_SETTLED",
      severity: "HIGH",
      message: `Invoice ${input.invoice.invoice_number} has allocations exceeding its total.`,
      evidence: ["EXPLICIT_ALLOCATION"]
    });
  }

  if (differenceAmount !== 0) {
      amountBridge.push({
          component_type: 'DIFFERENCE',
          component_sign: 1,
          component_amount: differenceAmount,
          currency_code: currency,
          source_type: 'ANALYTICAL_RESULT',
          source_id: 'CALCULATED',
          source_run_id: undefined
      });
  }

  return {
    status: settlementStatus,
    settlementStatus,
    baseAmount: invoiceTotal,
    expectedSettlement: invoiceTotal - tdsAdjustments - otherAdjustments,
    observedSettlementAmount: allocatedTotal,
    remainingAmount,
    differenceAmount,
    alerts,
    amountBridge,
    evidenceLinks
  };
}
