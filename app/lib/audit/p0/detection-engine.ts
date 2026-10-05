// ============================================================
// Bansil Books Analytics — Phase F.0 P0 Detection Engine
// Pure, deterministic, side-effect-free — same philosophy as
// app/lib/audit/learning/rule-evaluator.ts. No AI, no network call,
// no DB access inside these functions; callers supply already-fetched
// rows and persist the returned alert drafts.
// ============================================================

import type { DetectionState, Severity } from "./p0-types.ts";
import type { SeverityConfig } from "./severity-config-service.ts";

export interface AlertDraft {
  entityType: "INVOICE" | "BILL" | "CUSTOMER" | "VENDOR";
  entityId: string;
  ruleId: string;
  severity: Severity;
  detectionState: DetectionState;
  title: string;
  description: string;
  affectedAmount: string | null;
  evidence: Record<string, unknown>;
  recommendedAction: string;
  requiresProfessionalReview: boolean;
  zohoModifiedAt: string | null;
  dedupKey: string;
}

function daysPastDue(dueDate: string | null, asOf: Date): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  return Math.floor((asOf.getTime() - due.getTime()) / 86400000);
}

/**
 * Severity is a function of BOTH how overdue (a time/risk factor) AND
 * whether the amount clears the owner-governed materiality threshold —
 * NEVER amount alone, per the owner's explicit instruction. All bands and
 * the threshold come from `SeverityConfig` (see severity-config-service.ts)
 * — never a hardcoded constant. Two invoices of the same age but different
 * amounts can land in different tiers; two invoices of the same amount but
 * different age can also land in different tiers. An invoice past the
 * "critical" day band is only escalated to CRITICAL when it is ALSO
 * material — a large overdue amount is never automatically CRITICAL by
 * amount alone without also clearing the age band, and a very old but
 * immaterial amount stays at HIGH, never silently upgraded.
 */
function overdueSeverity(days: number, amount: number, config: SeverityConfig): Severity {
  const material = amount >= config.amountMaterialityThreshold;
  if (days >= config.overdueBandCriticalDays) return material ? "CRITICAL" : "HIGH";
  if (days >= config.overdueBandHighDays) return material ? "HIGH" : "MEDIUM";
  if (days >= config.overdueBandMediumDays) return "MEDIUM";
  if (days > 30) return "LOW";
  return "INFO";
}

export interface ReceivablePayableRow {
  id: string;
  number: string;
  partyId: string;
  partyName: string;
  dueDate: string | null;
  balance: number;
  lastModifiedTime: string | null;
}

/** Rule: overdue outstanding — a receivable past its due date with a positive balance. `config` is always the owner-governed SeverityConfig — never a hardcoded threshold. */
export function detectOverdueReceivables(invoices: ReceivablePayableRow[], config: SeverityConfig, asOf: Date = new Date()): AlertDraft[] {
  const out: AlertDraft[] = [];
  for (const inv of invoices) {
    const days = daysPastDue(inv.dueDate, asOf);
    if (days === null || days <= 30) continue;
    out.push({
      entityType: "INVOICE",
      entityId: inv.id,
      ruleId: "OVERDUE_RECEIVABLE",
      severity: overdueSeverity(days, inv.balance, config),
      detectionState: "REVIEW_REQUIRED",
      title: `Overdue receivable: invoice ${inv.number} (${days} days past due)`,
      description: `Invoice ${inv.number} for ${inv.partyName} has an outstanding balance and is ${days} days past its due date (${inv.dueDate}).`,
      affectedAmount: inv.balance.toFixed(2),
      evidence: { invoiceId: inv.id, invoiceNumber: inv.number, customerId: inv.partyId, customerName: inv.partyName, dueDate: inv.dueDate, daysPastDue: days, balance: inv.balance, severityConfigStatus: config.reviewStatus },
      recommendedAction: "Follow up for collection; confirm whether a dispute, delivery issue, or genuine delay explains the delay before escalating.",
      requiresProfessionalReview: false,
      zohoModifiedAt: inv.lastModifiedTime,
      dedupKey: `OVERDUE_RECEIVABLE:${inv.id}`,
    });
  }
  return out;
}

/** Rule: overdue/open liability inconsistency — a payable past its due date with a positive balance. */
export function detectOverduePayables(bills: ReceivablePayableRow[], config: SeverityConfig, asOf: Date = new Date()): AlertDraft[] {
  const out: AlertDraft[] = [];
  for (const bill of bills) {
    const days = daysPastDue(bill.dueDate, asOf);
    if (days === null || days <= 30) continue;
    out.push({
      entityType: "BILL",
      entityId: bill.id,
      ruleId: "OVERDUE_PAYABLE",
      severity: overdueSeverity(days, bill.balance, config),
      detectionState: "REVIEW_REQUIRED",
      title: `Overdue payable: bill ${bill.number} (${days} days past due)`,
      description: `Bill ${bill.number} from ${bill.partyName} has an outstanding balance and is ${days} days past its due date (${bill.dueDate}).`,
      affectedAmount: bill.balance.toFixed(2),
      evidence: { billId: bill.id, billNumber: bill.number, vendorId: bill.partyId, vendorName: bill.partyName, dueDate: bill.dueDate, daysPastDue: days, balance: bill.balance, severityConfigStatus: config.reviewStatus },
      recommendedAction: "Arrange payment or confirm a dispute before an early-payment discount is lost or vendor relationship/interest exposure grows.",
      requiresProfessionalReview: false,
      zohoModifiedAt: bill.lastModifiedTime,
      dedupKey: `OVERDUE_PAYABLE:${bill.id}`,
    });
  }
  return out;
}

/** Rule: duplicate invoice number — always CRITICAL regardless of amount; a data-integrity fact, not a judgment call. */
export function detectDuplicateInvoiceNumbers(invoices: ReceivablePayableRow[]): AlertDraft[] {
  const byNumber = new Map<string, ReceivablePayableRow[]>();
  for (const inv of invoices) {
    if (!inv.number) continue;
    const list = byNumber.get(inv.number) ?? [];
    list.push(inv);
    byNumber.set(inv.number, list);
  }
  const out: AlertDraft[] = [];
  for (const [number, group] of byNumber) {
    if (group.length < 2) continue;
    for (const inv of group) {
      out.push({
        entityType: "INVOICE",
        entityId: inv.id,
        ruleId: "DUPLICATE_INVOICE_NUMBER",
        severity: "CRITICAL",
        detectionState: "AUTO_DETECTED",
        title: `Duplicate invoice number: ${number}`,
        description: `Invoice number ${number} appears on ${group.length} distinct invoice records (IDs: ${group.map((g) => g.id).join(", ")}).`,
        affectedAmount: inv.balance.toFixed(2),
        evidence: { invoiceNumber: number, duplicateInvoiceIds: group.map((g) => g.id), count: group.length },
        recommendedAction: "Verify in Zoho Books whether this is a genuine duplicate entry, a legitimate reissue, or a data-sync artifact — do not assume either without checking the source records.",
        requiresProfessionalReview: false,
        zohoModifiedAt: inv.lastModifiedTime,
        dedupKey: `DUPLICATE_INVOICE_NUMBER:${inv.id}`,
      });
    }
  }
  return out;
}

/** Rule: duplicate bill number — same reasoning as invoices, mirrored for vendor bills. */
export function detectDuplicateBillNumbers(bills: ReceivablePayableRow[]): AlertDraft[] {
  const byNumber = new Map<string, ReceivablePayableRow[]>();
  for (const bill of bills) {
    if (!bill.number) continue;
    const list = byNumber.get(bill.number) ?? [];
    list.push(bill);
    byNumber.set(bill.number, list);
  }
  const out: AlertDraft[] = [];
  for (const [number, group] of byNumber) {
    // A single vendor legitimately reusing its own bill numbering across
    // vendors is not itself suspicious; only same-vendor duplicates are a
    // real data-integrity concern here.
    const byVendor = new Map<string, ReceivablePayableRow[]>();
    for (const b of group) {
      const list = byVendor.get(b.partyId) ?? [];
      list.push(b);
      byVendor.set(b.partyId, list);
    }
    for (const [, vendorGroup] of byVendor) {
      if (vendorGroup.length < 2) continue;
      for (const bill of vendorGroup) {
        out.push({
          entityType: "BILL",
          entityId: bill.id,
          ruleId: "DUPLICATE_BILL_NUMBER",
          severity: "CRITICAL",
          detectionState: "AUTO_DETECTED",
          title: `Duplicate bill number: ${number} (same vendor)`,
          description: `Bill number ${number} appears ${vendorGroup.length} times for vendor ${bill.partyName} (IDs: ${vendorGroup.map((g) => g.id).join(", ")}).`,
          affectedAmount: bill.balance.toFixed(2),
          evidence: { billNumber: number, vendorId: bill.partyId, vendorName: bill.partyName, duplicateBillIds: vendorGroup.map((g) => g.id), count: vendorGroup.length },
          recommendedAction: "Verify whether this vendor bill was recorded twice (risking a duplicate payment) before any payment is released.",
          requiresProfessionalReview: false,
          zohoModifiedAt: bill.lastModifiedTime,
          dedupKey: `DUPLICATE_BILL_NUMBER:${bill.id}`,
        });
      }
    }
  }
  return out;
}
