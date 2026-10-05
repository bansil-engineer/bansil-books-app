import {
  PurchaseSettlementInput,
  PurchaseReconciliationResult,
  PurchaseAlert,
  BankMatchResult,
  EvidenceStrength,
  SettlementStatus
} from "./types.ts";
import {
  getAccountTypePolicy,
  evaluateDateEvidence,
  evaluateAmountEvidence,
  evaluateReferenceEvidence,
  determineBankMatch,
  classifySettlementStatus
} from "./rules.ts";

export function evaluatePurchaseSettlement(input: PurchaseSettlementInput): PurchaseReconciliationResult {
  const alerts: PurchaseAlert[] = [];
  const amountBridge: PurchaseReconciliationResult['amountBridge'] = [];
  const evidenceLinks: PurchaseReconciliationResult['evidenceLinks'] = [];

  // Handle Unallocated Vendor Advance (Payment level only, no bill)
  if (!input.bill) {
     const bankMatchResults: PurchaseReconciliationResult['bankMatchResults'] = [];
     let bankSupportedAmount = 0;
     let hasMissingBank = false;
     let hasPendingClearing = false;
     let hasUnknownAccount = false;

     for (const payment of input.payments) {
       let account = null;
       if (payment.paidThroughAccountId) {
         account = input.paymentAccounts.find(a => a.accountId === payment.paidThroughAccountId);
       }
       const policy = getAccountTypePolicy(account ? account.accountType : 'unknown');

       if (policy === 'CASH_BOOK_EVIDENCE') {
          bankMatchResults.push({
            paymentId: payment.paymentId,
            matchResult: 'NO_MATCH',
            evidenceStrength: 'NO_MATCH'
          });
          bankSupportedAmount += payment.amount;
          continue;
       }
       
       if (policy === 'CLEARING_RESOLUTION_REQUIRED') {
          bankMatchResults.push({
            paymentId: payment.paymentId,
            matchResult: 'NO_MATCH',
            evidenceStrength: 'NO_MATCH'
          });
          hasPendingClearing = true;
          continue;
       }
       
       if (policy === 'OWNER_REVIEW') {
          bankMatchResults.push({
            paymentId: payment.paymentId,
            matchResult: 'NO_MATCH',
            evidenceStrength: 'NO_MATCH'
          });
          hasUnknownAccount = true;
          continue;
       }

       let bestMatchTxn: any = null;
       let bestMatchResult: BankMatchResult = 'NO_MATCH';
       let bestStrength: EvidenceStrength | 'NO_MATCH' = 'NO_MATCH';
       let ambiguousCandidates = [];
       let conflictCount = 0;

       for (const txn of input.bankTransactions) {
         // Vendor payments represent cash OUTFLOW. In Zoho Books bank transactions, outflow is a 'credit' to the bank account.
         if (txn.debitOrCredit !== 'credit') continue;
         if (payment.paidThroughAccountId && txn.accountId && payment.paidThroughAccountId !== txn.accountId) {
           continue;
         }

         const refEv = evaluateReferenceEvidence(payment.referenceNumber, txn.referenceNumber);
         const amtEv = evaluateAmountEvidence(payment.amount, txn.amount, payment.currencyCode, 'purchase');
         const dateEv = evaluateDateEvidence(payment.date, txn.date);

         const matchRes = determineBankMatch(refEv, dateEv, amtEv);

         if (matchRes === 'CONFLICT') {
            conflictCount++;
            if (bestMatchResult === 'NO_MATCH') {
               bestMatchResult = 'CONFLICT';
            }
            continue;
         }

         if (matchRes === 'CONFIRMED_BANK_REFERENCE' || matchRes === 'CONFIRMED_AMOUNT_DATE_ACCOUNT') {
           if (bestMatchResult === matchRes) {
             ambiguousCandidates.push(txn);
           } else if (matchRes === 'CONFIRMED_BANK_REFERENCE') {
             bestMatchTxn = txn;
             bestMatchResult = matchRes;
             bestStrength = refEv;
             ambiguousCandidates = [txn];
           } else if (bestMatchResult !== 'CONFIRMED_BANK_REFERENCE') {
             bestMatchTxn = txn;
             bestMatchResult = matchRes;
             bestStrength = amtEv;
             ambiguousCandidates = [txn];
           }
         }
       }

       if (ambiguousCandidates.length > 1) {
         bestMatchResult = 'AMBIGUOUS';
         alerts.push('AMBIGUOUS_BANK_MATCH');
       }

       if (bestMatchResult === 'CONFIRMED_BANK_REFERENCE' || bestMatchResult === 'CONFIRMED_AMOUNT_DATE_ACCOUNT') {
         bankSupportedAmount += payment.amount;
         bankMatchResults.push({
           paymentId: payment.paymentId,
           bankTransactionId: bestMatchTxn.transactionId,
           matchResult: bestMatchResult,
           evidenceStrength: bestStrength
         });
         evidenceLinks.push({
           source_type: 'bank_transaction',
           source_id: bestMatchTxn.transactionId,
           source_run_id: bestMatchTxn.sourceRunId,
           relationship_type: 'PAYMENT_TO_BANK',
           evidence_strength: bestStrength as EvidenceStrength,
           amount_contribution: payment.amount,
           currency_code: payment.currencyCode
         });
       } else {
         bankMatchResults.push({
           paymentId: payment.paymentId,
           matchResult: bestMatchResult,
           evidenceStrength: 'NO_MATCH'
         });
         hasMissingBank = true;
         alerts.push('PAYMENT_WITHOUT_BANK_EVIDENCE');
       }
     }

     let settlementStatus: SettlementStatus = 'UNALLOCATED_VENDOR_ADVANCE';
     if (hasUnknownAccount) settlementStatus = 'OWNER_REVIEW_REQUIRED';
     else if (hasPendingClearing) settlementStatus = 'CLEARING_EVIDENCE_PENDING';
     else if (hasMissingBank) settlementStatus = 'BANK_EVIDENCE_MISSING';

     return {
       expectedSettlement: 0,
       allocatedPaymentAmount: 0,
       bankSupportedAmount,
       remainingAmount: 0,
       differenceAmount: 0,
       settlementStatus,
       bankMatchResults,
       amountBridge,
       evidenceLinks,
       alerts
     };
  }

  const bill = input.bill;
  const currencyCode = bill.currencyCode;
  
  // 1. Initial Gross Amount
  amountBridge.push({
    component_type: 'GROSS_BILL',
    component_sign: 1,
    component_amount: bill.total,
    currency_code: currencyCode,
    source_type: 'bill',
    source_id: bill.billId,
    source_run_id: bill.sourceRunId,
    reason_code: 'SOURCE_TOTAL'
  });

  // 2. Process Adjustments to find expected settlement (Cash obligation)
  let expectedSettlement = bill.total;
  for (const adj of input.adjustments) {
    const isDeduction = ['TDS', 'RETENTION', 'DISCOUNT', 'VENDOR_CREDIT', 'DEBIT_NOTE', 'ADVANCE_ADJUSTMENT'].includes(adj.adjustmentType);
    const sign = isDeduction ? -1 : 1;
    
    expectedSettlement += (adj.amount * sign);
    
    amountBridge.push({
      component_type: adj.adjustmentType,
      component_sign: sign,
      component_amount: adj.amount,
      currency_code: adj.currencyCode,
      source_type: 'adjustment',
      source_id: adj.adjustmentId,
      source_run_id: adj.sourceRunId,
      reason_code: adj.evidenceStatus || 'APPROVED_ADJUSTMENT'
    });
  }

  // 3. Process Payments & Allocations (Bill Level)
  let allocatedPaymentAmount = 0;
  for (const alloc of input.paymentAllocations) {
    if (alloc.billId === bill.billId) {
      allocatedPaymentAmount += alloc.amountApplied;
      evidenceLinks.push({
        source_type: 'payment_allocation',
        source_id: alloc.paymentId,
        source_run_id: alloc.sourceRunId,
        relationship_type: 'BILL_TO_PAYMENT',
        evidence_strength: 'EXPLICIT_ALLOCATION',
        amount_contribution: alloc.amountApplied,
        currency_code: currencyCode
      });
    }
  }

  // 4. Process Bank Matching (Payment Level)
  // Vendor Payment -> Bank Transaction
  const bankMatchResults: PurchaseReconciliationResult['bankMatchResults'] = [];
  let bankSupportedAmount = 0;
  let hasMissingBank = false;
  let hasPendingClearing = false;
  let hasUnknownAccount = false;

  for (const alloc of input.paymentAllocations) {
    if (alloc.billId !== bill.billId) continue;

    const payment = input.payments.find(p => p.paymentId === alloc.paymentId);
    if (!payment) continue;

    // Check account policy
    let account = null;
    if (payment.paidThroughAccountId) {
      account = input.paymentAccounts.find(a => a.accountId === payment.paidThroughAccountId);
    }
    
    const policy = getAccountTypePolicy(account ? account.accountType : 'unknown');
    
    if (policy === 'CASH_BOOK_EVIDENCE') {
       bankMatchResults.push({
         paymentId: payment.paymentId,
         matchResult: 'NO_MATCH',
         evidenceStrength: 'NO_MATCH'
       });
       bankSupportedAmount += payment.amount; // Assume fully supported by internal evidence
       continue;
    }
    
    if (policy === 'CLEARING_RESOLUTION_REQUIRED') {
       bankMatchResults.push({
         paymentId: payment.paymentId,
         matchResult: 'NO_MATCH',
         evidenceStrength: 'NO_MATCH'
       });
       hasPendingClearing = true;
       continue;
    }
    
    if (policy === 'OWNER_REVIEW') {
       bankMatchResults.push({
         paymentId: payment.paymentId,
         matchResult: 'NO_MATCH',
         evidenceStrength: 'NO_MATCH'
       });
       hasUnknownAccount = true;
       continue;
    }

    // Try to match against provided bank transactions (for BANK_STATEMENT_REQUIRED and CARD_STATEMENT_REQUIRED)
    let bestMatchTxn: any = null;
    let bestMatchResult: BankMatchResult = 'NO_MATCH';
    let bestStrength: EvidenceStrength | 'NO_MATCH' = 'NO_MATCH';
    let ambiguousCandidates = [];
    let conflictCount = 0;

    for (const txn of input.bankTransactions) {
      // Must be a credit for vendor payment (outflow from bank)
      if (txn.debitOrCredit !== 'credit') continue;

      // Account must match if explicitly provided on both sides
      if (payment.paidThroughAccountId && txn.accountId && payment.paidThroughAccountId !== txn.accountId) {
        continue;
      }

      const refEv = evaluateReferenceEvidence(payment.referenceNumber, txn.referenceNumber);
      const amtEv = evaluateAmountEvidence(payment.amount, txn.amount, payment.currencyCode, 'purchase');
      const dateEv = evaluateDateEvidence(payment.date, txn.date);

      const matchRes = determineBankMatch(refEv, dateEv, amtEv);

      if (matchRes === 'CONFLICT') {
         conflictCount++;
         if (bestMatchResult === 'NO_MATCH') {
            bestMatchResult = 'CONFLICT';
         }
         continue;
      }

      if (matchRes === 'CONFIRMED_BANK_REFERENCE' || matchRes === 'CONFIRMED_AMOUNT_DATE_ACCOUNT') {
        if (bestMatchResult === matchRes) {
          // Both are same level of match. E.g. two exact amounts on same day.
          ambiguousCandidates.push(txn);
        } else if (matchRes === 'CONFIRMED_BANK_REFERENCE') {
          bestMatchTxn = txn;
          bestMatchResult = matchRes;
          bestStrength = refEv;
          ambiguousCandidates = [txn];
        } else if (bestMatchResult !== 'CONFIRMED_BANK_REFERENCE') {
          bestMatchTxn = txn;
          bestMatchResult = matchRes;
          bestStrength = amtEv;
          ambiguousCandidates = [txn];
        }
      }
    }

    if (ambiguousCandidates.length > 1) {
      bestMatchResult = 'AMBIGUOUS';
      alerts.push('AMBIGUOUS_BANK_MATCH');
    }

    if (bestMatchResult === 'CONFIRMED_BANK_REFERENCE' || bestMatchResult === 'CONFIRMED_AMOUNT_DATE_ACCOUNT') {
      bankSupportedAmount += payment.amount;
      bankMatchResults.push({
        paymentId: payment.paymentId,
        bankTransactionId: bestMatchTxn.transactionId,
        matchResult: bestMatchResult,
        evidenceStrength: bestStrength
      });
      evidenceLinks.push({
        source_type: 'bank_transaction',
        source_id: bestMatchTxn.transactionId,
        source_run_id: bestMatchTxn.sourceRunId,
        relationship_type: 'PAYMENT_TO_BANK',
        evidence_strength: bestStrength as EvidenceStrength,
        amount_contribution: payment.amount,
        currency_code: payment.currencyCode
      });
    } else {
      bankMatchResults.push({
        paymentId: payment.paymentId,
        matchResult: bestMatchResult,
        evidenceStrength: 'NO_MATCH'
      });
      hasMissingBank = true;
      if (bestMatchResult === 'AMBIGUOUS') {
        alerts.push('AMBIGUOUS_BANK_MATCH');
      } else if (bestMatchResult === 'CONFLICT') {
        alerts.push('BANK_EVIDENCE_CONFLICT');
      } else if (bestMatchResult === 'NO_MATCH') {
        alerts.push('PAYMENT_WITHOUT_BANK_EVIDENCE');
      } else if (bestMatchResult === 'SUGGESTED_REVIEW') {
        alerts.push('PAYMENT_WITHOUT_BANK_EVIDENCE');
      }
    }
  }

  // 5. Finalize Settlement Status
  let settlementStatus: SettlementStatus;
  
  if (hasUnknownAccount) {
    settlementStatus = 'OWNER_REVIEW_REQUIRED';
    alerts.push('BANK_EVIDENCE_MISSING'); // Still alert, but explicitly requires owner review
  } else if (hasPendingClearing) {
    settlementStatus = 'CLEARING_EVIDENCE_PENDING';
    alerts.push('CLEARING_EVIDENCE_REQUIRED');
  } else {
    // If we have an expected balance and it's 0 in the source system, but our allocated amount is less than expected:
    let isSourceBalanceZero = (bill.balance === 0);
    
    if (allocatedPaymentAmount === 0 && expectedSettlement > 0 && input.paymentAllocations.length === 0 && input.payments.length > 0) {
       // If there's a payment but no allocation to this bill yet... Wait, we are evaluating the Bill.
       // Actually advance payment is when there's a payment with NO allocations to ANY bill.
       // The engine currently evaluates from the perspective of a Bill. 
       // If it's a completely unallocated payment, the engine wouldn't be triggered by a Bill for it, but if it is passed in:
    }
    
    if (isSourceBalanceZero && allocatedPaymentAmount > 0 && allocatedPaymentAmount < expectedSettlement) {
       settlementStatus = 'UNEXPLAINED_DIFFERENCE';
    } else {
       let baseStatus = classifySettlementStatus(expectedSettlement, allocatedPaymentAmount, !hasMissingBank);
       if (baseStatus === 'BANK_EVIDENCE_MISSING') {
          let hasConflict = bankMatchResults.some(r => r.matchResult === 'CONFLICT');
          let hasAmbiguous = bankMatchResults.some(r => r.matchResult === 'AMBIGUOUS');
          if (hasConflict) settlementStatus = 'BANK_EVIDENCE_CONFLICT';
          else if (hasAmbiguous) settlementStatus = 'AMBIGUOUS_BANK_EVIDENCE';
          else settlementStatus = 'BANK_EVIDENCE_MISSING';
       } else {
          settlementStatus = baseStatus;
       }
    }
  }

  const remainingAmount = expectedSettlement - allocatedPaymentAmount;
  const differenceAmount = Math.abs(remainingAmount);
  
  if (settlementStatus === 'PARTIALLY_SETTLED') {
    alerts.push('BILL_PARTIALLY_SETTLED');
  } else if (settlementStatus === 'OVER_SETTLED') {
    alerts.push('OVER_SETTLED');
  } else if (settlementStatus === 'UNEXPLAINED_DIFFERENCE') {
    alerts.push('AMOUNT_DIFFERENCE');
  }

  if (input.purchaseOrder) {
    evidenceLinks.push({
      source_type: 'purchase_order',
      source_id: input.purchaseOrder.purchaseorderId,
      source_run_id: input.purchaseOrder.sourceRunId,
      relationship_type: 'PO_TO_BILL',
      evidence_strength: 'EXPLICIT_SOURCE_LINK',
      amount_contribution: 0,
      currency_code: currencyCode
    });
  } else {
    alerts.push('BILL_WITHOUT_PO');
  }

  return {
    billId: bill.billId,
    sourceRunId: bill.sourceRunId,
    purchaseOrderId: input.purchaseOrder?.purchaseorderId,
    expectedSettlement,
    allocatedPaymentAmount,
    bankSupportedAmount,
    remainingAmount,
    differenceAmount,
    settlementStatus,
    bankMatchResults,
    amountBridge,
    evidenceLinks,
    alerts
  };
}
