"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEligibleForFulfilment = isEligibleForFulfilment;
exports.calculateFulfilment = calculateFulfilment;
exports.processTraceNodesPhase1 = processTraceNodesPhase1;
exports.getCommercialTrace = getCommercialTrace;
exports.getAllCommercialTraces = getAllCommercialTraces;
const audit_database_ts_1 = require("../db/audit-database.ts");
const so_po_mapping_ts_1 = require("./so-po-mapping.ts");
function isEligibleForFulfilment(nodeType, status) {
    const st = (status || '').toLowerCase();
    if (st === 'void' || st === 'cancelled' || st === 'draft')
        return false;
    return true;
}
function calculateFulfilment(sourceQty, targetQty) {
    const balance = sourceQty - targetQty;
    if (sourceQty === 0 && targetQty === 0) {
        return { balance, percent: null, status: "NOT_STARTED" };
    }
    if (sourceQty === 0 && targetQty > 0) {
        return { balance, percent: null, status: "UNRESOLVED" };
    }
    const percent = (targetQty / sourceQty) * 100;
    let status = "NOT_STARTED";
    if (targetQty === 0)
        status = "NOT_STARTED";
    else if (targetQty > 0 && targetQty < sourceQty)
        status = "PARTIAL";
    else if (targetQty === sourceQty)
        status = "FULFILLED";
    else if (targetQty > sourceQty)
        status = "OVER_FULFILLED";
    return { balance, percent, status };
}
function processTraceNodesPhase1(salesOrderNumbers, db) {
    let fetchedAt = "";
    const globalSoLookup = (0, so_po_mapping_ts_1.buildGlobalSoLookup)(db);
    const salesOrders = [];
    const invoicesMap = new Map();
    const purchaseOrders = [];
    const billsMap = new Map();
    const customerPayments = [];
    const vendorPayments = [];
    const bankCandidates = [];
    const itemsMap = new Map();
    const alerts = [];
    const getOrInitItem = (itemId, name, sku) => {
        const id = itemId || `UNKNOWN_${name}_${sku}`;
        if (!itemsMap.has(id)) {
            itemsMap.set(id, {
                itemId: id, itemName: name || 'Unknown', sku: sku || '',
                classification: itemId ? "EXACT_ITEM_ID" : "UNRESOLVED",
                soQty: 0, poQty: 0, invoiceQty: 0, billQty: 0,
                soInvoiceBalanceQty: 0, soInvoiceFulfilmentPercent: null, soInvoiceStatus: "NOT_STARTED",
                poBillBalanceQty: 0, poBillFulfilmentPercent: null, poBillStatus: "NOT_STARTED",
                taxableRateStatus: "INCOMPLETE", sourceLineAmount: 0
            });
        }
        return itemsMap.get(id);
    };
    // 1. Fetch Sales Orders
    salesOrderNumbers.forEach(soNumber => {
        const so = db.prepare(`SELECT * FROM audit_zoho_sales_orders WHERE salesorder_number = ? ORDER BY fetched_at DESC LIMIT 1`).get(soNumber);
        if (so) {
            if (!fetchedAt)
                fetchedAt = so.fetched_at;
            const eligible = isEligibleForFulfilment('SO', so.status);
            salesOrders.push({
                nodeType: "SO", zohoId: so.salesorder_id, documentNumber: so.salesorder_number, date: so.date,
                partyId: so.customer_name, status: so.status, currency: so.currency, grossAmount: so.total || 0,
                taxableAmount: so.total_taxable_amount ?? null, taxableAmountStatus: so.total_taxable_amount != null ? "VERIFIED" : "INCOMPLETE", deductionStatus: "NOT_SYNCED",
                subTotal: so.sub_total, taxTotal: so.tax_total, adjustment: so.adjustment,
                isInclusiveTax: so.is_inclusive_tax === 1, discountTotal: so.discount_total,
                discountType: so.discount_type, isDiscountBeforeTax: so.is_discount_before_tax === 1,
                sourceEvidence: `audit_zoho_sales_orders:${so.salesorder_id}`, relationshipType: "PARENT", relationshipClassification: "DIRECT_ID",
                isExcludedFromFulfilment: !eligible, exclusionReason: !eligible ? `Status ${so.status} excluded` : undefined
            });
            if (eligible) {
                const soLines = db.prepare(`SELECT * FROM audit_zoho_sales_order_lines WHERE salesorder_id = ? AND source_run_id = ?`).all(so.salesorder_id, so.source_run_id);
                soLines.forEach(l => {
                    const item = getOrInitItem(l.item_id, l.item_name, l.sku);
                    item.soQty += (l.quantity || 0);
                    item.sourceLineAmount += (l.amount || 0);
                });
            }
        }
    });
    const soIds = salesOrders.map(so => so.zohoId);
    if (soIds.length > 0) {
        // 2. Fetch Invoices linked to SOs
        const allInvs = db.prepare(`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY invoice_id ORDER BY fetched_at DESC) as rn 
        FROM audit_zoho_invoices 
      ) WHERE rn = 1
    `).all();
        allInvs.forEach(inv => {
            let linked = false;
            let classification = "UNLINKED";
            if (inv.salesorder_id && soIds.includes(inv.salesorder_id)) {
                linked = true;
                classification = "DIRECT_ID";
            }
            else {
                let ref = inv.reference_number;
                if (!ref && inv.custom_fields_json) {
                    try {
                        const cf = JSON.parse(inv.custom_fields_json);
                        ref = (0, so_po_mapping_ts_1.extractCustomField)(cf, /Sales Order No/i);
                    }
                    catch (e) { }
                }
                if (ref) {
                    const res = (0, so_po_mapping_ts_1.resolveUniqueSalesOrder)(globalSoLookup, ref);
                    if (res.status === "MATCH" && soIds.includes(res.so.salesorder_id)) {
                        linked = true;
                        classification = "REFERENCE_SUPPORTED";
                    }
                }
            }
            if (linked) {
                const eligible = isEligibleForFulfilment('INVOICE', inv.status);
                invoicesMap.set(inv.invoice_id, {
                    nodeType: "INVOICE", zohoId: inv.invoice_id, documentNumber: inv.invoice_number, date: inv.date,
                    partyId: inv.customer_name, status: inv.status, currency: inv.currency_code, grossAmount: inv.total || 0,
                    taxableAmount: inv.total_taxable_amount ?? null, taxableAmountStatus: inv.total_taxable_amount != null ? "VERIFIED" : "INCOMPLETE", deductionStatus: "VERIFIED",
                    subTotal: inv.sub_total, taxTotal: inv.tax_total, totalTaxableAmount: inv.total_taxable_amount,
                    adjustment: inv.adjustment, isInclusiveTax: inv.is_inclusive_tax === 1,
                    discountTotal: inv.discount_total, discountType: inv.discount_type,
                    isDiscountBeforeTax: inv.is_discount_before_tax === 1, tdsAmount: inv.tds_amount, retentionAmount: inv.retention_amount,
                    sourceEvidence: `audit_zoho_invoices:${inv.invoice_id}`, relationshipType: "CHILD", relationshipClassification: classification,
                    isExcludedFromFulfilment: !eligible, exclusionReason: !eligible ? `Status ${inv.status} excluded` : undefined
                });
                if (inv.balance > 0 && eligible) {
                    alerts.push({
                        code: "INVOICE_PAYMENT_OUTSTANDING", severity: "WARNING", message: `Invoice ${inv.invoice_number} has outstanding balance ${inv.balance}`,
                        evidence: `invoice.balance=${inv.balance}`, relationshipClassification: classification, ownerReviewRequired: false
                    });
                }
                if (eligible) {
                    const lines = db.prepare(`SELECT * FROM audit_zoho_invoice_lines WHERE invoice_id = ? AND source_run_id = ?`).all(inv.invoice_id, inv.source_run_id);
                    lines.forEach(l => {
                        const item = getOrInitItem(l.item_id, l.item_name, l.sku);
                        item.invoiceQty += (l.quantity || 0);
                    });
                }
                // Fetch Customer Payments (Allocations)
                const allocations = db.prepare(`SELECT a.*, p.payment_number, p.amount, p.unused_amount, p.date as pdate, p.reference_number FROM audit_zoho_customer_payment_allocations a JOIN audit_zoho_customer_payments p ON a.payment_id = p.payment_id WHERE a.invoice_id = ? AND a.source_run_id = p.source_run_id`).all(inv.invoice_id);
                allocations.forEach(alloc => {
                    customerPayments.push({
                        nodeType: "CUSTOMER_PAYMENT", zohoId: alloc.payment_id, documentNumber: alloc.payment_number, date: alloc.pdate,
                        partyId: inv.customer_name, status: "applied", currency: inv.currency_code, grossAmount: alloc.amount || 0,
                        taxableAmount: null, taxableAmountStatus: "NOT_AVAILABLE", deductionStatus: "NOT_SYNCED",
                        sourceEvidence: `audit_zoho_customer_payment_allocations:${alloc.payment_id}`, relationshipType: "ALLOCATION", relationshipClassification: "DIRECT_ID",
                        allocatedAmount: alloc.amount_applied, unusedAmount: alloc.unused_amount
                    });
                    // Fetch Bank candidates (heuristic)
                    // date +/- 7 days, amount approx
                    const dateFrom = new Date(alloc.pdate);
                    dateFrom.setDate(dateFrom.getDate() - 7);
                    const dateTo = new Date(alloc.pdate);
                    dateTo.setDate(dateTo.getDate() + 7);
                    const bankTxns = db.prepare(`
             SELECT * FROM audit_zoho_bank_transactions 
             WHERE date >= ? AND date <= ?
           `).all(dateFrom.toISOString().split('T')[0], dateTo.toISOString().split('T')[0]);
                    let matchedCount = 0;
                    let bestMatch = null;
                    bankTxns.forEach(btx => {
                        if (Math.abs((btx.amount || 0) - alloc.amount) < 0.01) {
                            matchedCount++;
                            bestMatch = btx;
                        }
                    });
                    if (matchedCount > 0) {
                        let classif = matchedCount > 1 ? "AMBIGUOUS" : "CANDIDATE";
                        bankCandidates.push({
                            nodeType: "BANK_TX", zohoId: bestMatch.transaction_id, documentNumber: bestMatch.transaction_id, date: bestMatch.date,
                            partyId: bestMatch.payee || 'Unknown', status: bestMatch.status, currency: bestMatch.currency_code || inv.currency_code, grossAmount: bestMatch.amount,
                            taxableAmount: null, taxableAmountStatus: "NOT_AVAILABLE", deductionStatus: "NOT_SYNCED",
                            sourceEvidence: `audit_zoho_bank_transactions:${bestMatch.transaction_id}`, relationshipType: "RECONCILIATION", relationshipClassification: classif,
                            candidateCount: matchedCount
                        });
                        if (classif === "AMBIGUOUS") {
                            alerts.push({
                                code: "PAYMENT_BANK_AMBIGUOUS", severity: "WARNING", message: `Payment ${alloc.payment_number} has multiple bank candidates.`,
                                evidence: `candidates=${matchedCount}`, relationshipClassification: "AMBIGUOUS", ownerReviewRequired: true
                            });
                        }
                    }
                    else {
                        alerts.push({
                            code: "PAYMENT_BANK_UNLINKED", severity: "INFO", message: `Payment ${alloc.payment_number} unlinked in bank.`,
                            evidence: `no bank tx match`, relationshipClassification: "UNLINKED", ownerReviewRequired: false
                        });
                    }
                });
            }
        });
        // 3. Fetch Purchase Orders linked to SOs
        const allPOs = db.prepare(`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY purchaseorder_id ORDER BY fetched_at DESC) as rn 
        FROM audit_zoho_purchase_orders
      ) WHERE rn = 1
    `).all();
        allPOs.forEach(po => {
            let linked = false;
            let classification = "UNLINKED";
            if (po.custom_fields_json) {
                try {
                    const customFields = JSON.parse(po.custom_fields_json);
                    const ref = (0, so_po_mapping_ts_1.extractCustomField)(customFields, /Sales Order No/i);
                    if (ref) {
                        const res = (0, so_po_mapping_ts_1.resolveUniqueSalesOrder)(globalSoLookup, ref);
                        if (res.status === "MATCH" && soIds.includes(res.so.salesorder_id)) {
                            linked = true;
                            classification = "REFERENCE_SUPPORTED";
                        }
                        else if (res.status === "AMBIGUOUS_SO_REFERENCE") {
                            alerts.push({
                                code: "AMBIGUOUS_SO_REFERENCE", severity: "WARNING", message: `PO ${po.purchaseorder_number} has ambiguous SO ref ${ref}`,
                                evidence: `PO custom fields`, relationshipClassification: "AMBIGUOUS", ownerReviewRequired: true
                            });
                        }
                    }
                    else {
                        alerts.push({
                            code: "PO_MISSING_SO_REFERENCE", severity: "INFO", message: `PO ${po.purchaseorder_number} missing SO reference`,
                            evidence: `custom_fields=${po.custom_fields_json}`, relationshipClassification: "UNLINKED", ownerReviewRequired: false
                        });
                    }
                }
                catch (e) { }
            }
            else {
                alerts.push({
                    code: "PO_MISSING_SO_REFERENCE", severity: "INFO", message: `PO ${po.purchaseorder_number} missing SO reference`,
                    evidence: `no custom_fields_json`, relationshipClassification: "UNLINKED", ownerReviewRequired: false
                });
            }
            if (linked) {
                const eligible = isEligibleForFulfilment('PO', po.status);
                purchaseOrders.push({
                    nodeType: "PO", zohoId: po.purchaseorder_id, documentNumber: po.purchaseorder_number, date: po.date,
                    partyId: po.vendor_name, status: po.status, currency: po.currency, grossAmount: po.total || 0,
                    taxableAmount: po.total_taxable_amount ?? null, taxableAmountStatus: po.total_taxable_amount != null ? "VERIFIED" : "INCOMPLETE", deductionStatus: "NOT_SYNCED",
                    subTotal: po.sub_total, taxTotal: po.tax_total, adjustment: po.adjustment,
                    isInclusiveTax: po.is_inclusive_tax === 1, discountTotal: po.discount_total,
                    discountType: po.discount_type, isDiscountBeforeTax: po.is_discount_before_tax === 1,
                    sourceEvidence: `audit_zoho_purchase_orders:${po.purchaseorder_id}`, relationshipType: "CHILD", relationshipClassification: classification,
                    isExcludedFromFulfilment: !eligible, exclusionReason: !eligible ? `Status ${po.status} excluded` : undefined
                });
                if (eligible) {
                    const lines = db.prepare(`SELECT * FROM audit_zoho_purchase_order_lines WHERE purchaseorder_id = ? AND source_run_id = ?`).all(po.purchaseorder_id, po.source_run_id);
                    lines.forEach(l => {
                        const item = getOrInitItem(l.item_id, l.item_name, l.sku);
                        item.poQty += (l.quantity || 0);
                    });
                }
            }
        });
        // 4. Fetch Bills linked to POs
        const poIds = purchaseOrders.map(p => p.zohoId);
        if (poIds.length > 0) {
            const placeholders = poIds.map(() => '?').join(',');
            const bills = db.prepare(`
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER(PARTITION BY bill_id ORDER BY fetched_at DESC) as rn 
          FROM audit_zoho_bills 
          WHERE purchaseorder_id IN (${placeholders})
        ) WHERE rn = 1
      `).all(...poIds);
            bills.forEach(bill => {
                const eligible = isEligibleForFulfilment('BILL', bill.status);
                billsMap.set(bill.bill_id, {
                    nodeType: "BILL", zohoId: bill.bill_id, documentNumber: bill.bill_number, date: bill.date,
                    partyId: bill.vendor_name, status: bill.status, currency: bill.currency, grossAmount: bill.total || 0,
                    taxableAmount: bill.total_taxable_amount ?? null, taxableAmountStatus: bill.total_taxable_amount != null ? "VERIFIED" : "INCOMPLETE", deductionStatus: "VERIFIED",
                    subTotal: bill.sub_total, taxTotal: bill.tax_total, totalTaxableAmount: bill.total_taxable_amount,
                    adjustment: bill.adjustment, isInclusiveTax: bill.is_inclusive_tax === 1,
                    discountTotal: bill.discount_total, discountType: bill.discount_type,
                    isDiscountBeforeTax: bill.is_discount_before_tax === 1, tdsAmount: bill.tds_amount, retentionAmount: bill.retention_amount,
                    sourceEvidence: `audit_zoho_bills:${bill.bill_id}`, relationshipType: "CHILD", relationshipClassification: "DIRECT_ID",
                    isExcludedFromFulfilment: !eligible, exclusionReason: !eligible ? `Status ${bill.status} excluded` : undefined
                });
                if (bill.balance > 0 && eligible) {
                    alerts.push({
                        code: "BILL_PAYMENT_OUTSTANDING", severity: "WARNING", message: `Bill ${bill.bill_number} has outstanding balance ${bill.balance}`,
                        evidence: `bill.balance=${bill.balance}`, relationshipClassification: "DIRECT_ID", ownerReviewRequired: false
                    });
                }
                if (eligible) {
                    const lines = db.prepare(`SELECT * FROM audit_zoho_bill_lines WHERE bill_id = ? AND source_run_id = ?`).all(bill.bill_id, bill.source_run_id);
                    lines.forEach(l => {
                        const item = getOrInitItem(l.item_id, l.item_name, l.sku);
                        item.billQty += (l.quantity || 0);
                    });
                }
                // Fetch Vendor Payments (Allocations)
                const allocations = db.prepare(`SELECT a.*, p.payment_number, p.amount, p.date as pdate, p.reference_number FROM audit_zoho_vendor_payment_allocations a JOIN audit_zoho_vendor_payments p ON a.payment_id = p.payment_id WHERE a.bill_id = ? AND a.source_run_id = p.source_run_id`).all(bill.bill_id);
                allocations.forEach(alloc => {
                    vendorPayments.push({
                        nodeType: "VENDOR_PAYMENT", zohoId: alloc.payment_id, documentNumber: alloc.payment_number, date: alloc.pdate,
                        partyId: bill.vendor_name, status: "applied", currency: bill.currency, grossAmount: alloc.amount || 0,
                        taxableAmount: null, taxableAmountStatus: "NOT_AVAILABLE", deductionStatus: "NOT_SYNCED",
                        sourceEvidence: `audit_zoho_vendor_payment_allocations:${alloc.payment_id}`, relationshipType: "ALLOCATION", relationshipClassification: "DIRECT_ID",
                        allocatedAmount: alloc.amount_applied
                    });
                    // Bank candidates for Vendor Payment omitted for brevity, identical logic could be added
                });
            });
        }
    }
    // 5. Calculate Fulfilments & Items
    const items = Array.from(itemsMap.values());
    items.forEach(item => {
        const soRes = calculateFulfilment(item.soQty, item.invoiceQty);
        item.soInvoiceBalanceQty = soRes.balance;
        item.soInvoiceFulfilmentPercent = soRes.percent;
        item.soInvoiceStatus = soRes.status;
        if (item.classification === "UNRESOLVED") {
            alerts.push({
                code: "ITEM_UNRESOLVED", severity: "CRITICAL", message: `Item ${item.itemName} unmatched.`,
                evidence: `Qty: SO=${item.soQty}, INV=${item.invoiceQty}`, relationshipClassification: "UNLINKED", ownerReviewRequired: true
            });
        }
        if (soRes.status === "PARTIAL") {
            alerts.push({
                code: "SO_PARTIALLY_INVOICED", severity: "INFO", message: `Item ${item.itemName} partially invoiced.`,
                evidence: `balance=${soRes.balance}`, relationshipClassification: "DIRECT_ID", ownerReviewRequired: false
            });
        }
        else if (soRes.status === "OVER_FULFILLED" || (soRes.status === "UNRESOLVED" && item.invoiceQty > 0)) {
            alerts.push({
                code: "SO_OVER_INVOICED", severity: "CRITICAL", message: `Item ${item.itemName} over invoiced or unmapped.`,
                evidence: `balance=${soRes.balance}`, relationshipClassification: "DIRECT_ID", ownerReviewRequired: true
            });
        }
        const poRes = calculateFulfilment(item.poQty, item.billQty);
        item.poBillBalanceQty = poRes.balance;
        item.poBillFulfilmentPercent = poRes.percent;
        item.poBillStatus = poRes.status;
        if (poRes.status === "PARTIAL") {
            alerts.push({
                code: "PO_PARTIALLY_BILLED", severity: "INFO", message: `Item ${item.itemName} partially billed.`,
                evidence: `balance=${poRes.balance}`, relationshipClassification: "DIRECT_ID", ownerReviewRequired: false
            });
        }
        else if (poRes.status === "OVER_FULFILLED" || (poRes.status === "UNRESOLVED" && item.billQty > 0)) {
            alerts.push({
                code: "PO_OVER_BILLED", severity: "CRITICAL", message: `Item ${item.itemName} over billed.`,
                evidence: `balance=${poRes.balance}`, relationshipClassification: "DIRECT_ID", ownerReviewRequired: true
            });
        }
        if (item.soInvoiceBalanceQty !== 0 || item.poBillBalanceQty !== 0) {
            alerts.push({
                code: "QUANTITY_RESIDUAL", severity: "WARNING", message: `Residual quantity on ${item.itemName}`,
                evidence: `soInvBal=${item.soInvoiceBalanceQty}, poBillBal=${item.poBillBalanceQty}`, relationshipClassification: "DIRECT_ID", ownerReviewRequired: false
            });
        }
    });
    return {
        runId: "COMPUTED_PHASE1",
        fetchedAt,
        salesOrders,
        purchaseOrders,
        invoices: Array.from(invoicesMap.values()),
        bills: Array.from(billsMap.values()),
        customerPayments,
        vendorPayments,
        bankCandidates,
        items,
        alerts
    };
}
function getCommercialTrace(salesOrderNumber, sourceRunId) {
    const db = (0, audit_database_ts_1.getAuditDatabase)();
    return processTraceNodesPhase1([salesOrderNumber], db);
}
function getAllCommercialTraces(customerId, sourceRunId, from, to, period) {
    const db = (0, audit_database_ts_1.getAuditDatabase)();
    let query = `
    SELECT DISTINCT salesorder_number 
    FROM (
      SELECT *, ROW_NUMBER() OVER(PARTITION BY salesorder_id ORDER BY fetched_at DESC) as rn 
      FROM audit_zoho_sales_orders 
    ) WHERE rn = 1 AND customer_id = ?
  `;
    const params = [customerId];
    if (period !== 'ALL_PERIODS' && from && to) {
        query += ` AND date >= ? AND date <= ?`;
        params.push(from, to);
    }
    const sos = db.prepare(query).all(...params);
    if (sos.length === 0)
        return null;
    return processTraceNodesPhase1(sos.map(s => s.salesorder_number), db);
}
