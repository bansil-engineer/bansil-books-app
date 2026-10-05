import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fy = searchParams.get('fy') || '2025-26';
  const cacheDir = path.resolve('output', 'gst_source_cache');
  const dir5G2A = path.join(cacheDir, '5G2A');
  const dir5G2B = path.join(cacheDir, '5G2B');
  const dir5G2C = path.join(cacheDir, '5G2C_FY2526');
  const dir5G2D = path.join(cacheDir, '5G2D_FY2526');
  const dir5G2E = path.join(cacheDir, '5G2E_FY2526');
  const dir5G2F = path.join(cacheDir, '5G2F_FY2526');
  const dir5G2G = path.join(cacheDir, '5G2G_FINAL_FY2526');
  
  const progressPath = path.join(dir5G2B, 'batch_progress.json');
  const manifestPath = path.join(dir5G2B, 'batch_manifest.json');

  let progress = null;
  let batchManifest = [];
  if (fs.existsSync(progressPath) && fs.existsSync(manifestPath)) {
    progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    batchManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  const allDocs = new Map();

  const processDir = (dirPath: string, type: 'sales'|'purchase'|'auto', sourceBatch: string, classifierSets?: any) => {
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json') && f !== 'batch_manifest.json' && f !== 'batch_progress.json');
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const detail = JSON.parse(raw);
        const root = detail.invoice || detail.bill || detail.creditnote || detail.vendor_credit || detail;
        
        let docId = '';
        if (detail.invoice || file.startsWith('invoice_')) docId = root.invoice_id || root.creditnote_id || root.bill_id || '';
        else if (detail.bill || file.startsWith('bill_')) docId = root.bill_id || root.invoice_id || '';
        else if (detail.creditnote || file.startsWith('creditnote_')) docId = root.creditnote_id || root.invoice_id || '';
        else if (detail.vendor_credit || file.startsWith('vendorcredit_')) docId = root.vendor_credit_id || root.bill_id || '';
        
        if (!docId) {
          docId = root.invoice_id || root.bill_id || root.creditnote_id || root.vendor_credit_id || file.replace('.json', '').replace('bill_', '').replace('invoice_', '').replace('creditnote_', '').replace('vendorcredit_', '');
        }
        
        if (allDocs.has(docId)) continue;
        
        let actualType: string = type;
        if (type === 'auto' && classifierSets) {
          if (classifierSets.sales.has(docId)) actualType = 'sales';
          else if (classifierSets.purchases.has(docId)) actualType = 'purchase';
          else if (classifierSets.salesCN.has(docId)) actualType = 'creditnote';
          else if (classifierSets.vendorCredits.has(docId)) actualType = 'vendorcredit';
          else continue; // unclassified
        }
        
        const docDate = root.date || '';
        const isFY2526 = docDate >= "2025-04-01" && docDate <= "2026-03-31";
        
        let taxable = root.sub_total || 0;
        let discount = root.discount_amount || 0;
        let shipping = root.shipping_charge || 0;
        let tds = root.tds_amount || root.tax_withheld_amount || 0;
        let vendor = root.customer_name || root.vendor_name || '';
        let adjustment = root.adjustment || 0;
        
        let igst = 0, cgst = 0, sgst = 0, cess = 0, other = 0;
        const taxes = root.taxes || [];
        for (let t of taxes) {
          let name = (t.tax_name || '').toUpperCase();
          let amt = t.tax_amount || 0;
          if (name.includes('IGST')) igst += amt;
          else if (name.includes('CGST')) cgst += amt;
          else if (name.includes('SGST')) sgst += amt;
          else if (name.includes('CESS')) cess += amt;
          else other += amt;
        }

        let total_tax = igst + cgst + sgst + cess + other;
        let source_class = 'UNCLASSIFIED';
        if (igst > 0 || cgst > 0 || sgst > 0 || total_tax === 0) {
          source_class = 'SOURCE_EXACT';
        }

        let calcGross = taxable - discount + shipping + total_tax + adjustment;
        let gross = actualType === 'sales' ? (root.total || 0) : calcGross;

        let reportedGross = root.total || root.bcy_total || 0;
        let diff = actualType === 'sales' 
            ? Math.abs(reportedGross - calcGross) 
            : Math.min(Math.abs((reportedGross + tds) - calcGross), Math.abs(calcGross - reportedGross));
        
        let arithmetic_status = diff <= 0.1 ? 'PASS' : 'MISMATCH';
        let hasIgst = igst > 0;
        let hasCgst = cgst > 0;
        let taxCategory = hasIgst ? "IGST" : (hasCgst ? "CGST+SGST" : ((igst + cgst + sgst + cess) === 0 ? "Zero Tax" : "Other"));

        allDocs.set(docId, {
          document_id: docId,
          document_number: root.invoice_number || root.bill_number || root.creditnote_number || root.vendor_credit_number || '',
          document_date: docDate,
          document_type: actualType,
          vendor,
          taxable,
          gross,
          tds,
          igst,
          cgst,
          sgst,
          cess,
          sourceBatch,
          isFY2526,
          periodStatus: isFY2526 ? 'FY2025-26' : 'OUT_OF_PERIOD',
          source_class,
          arithmetic_status,
          taxCategory,
          fetch_status: 'SUCCESS',
          isPilot: false,
          isRcm: root.is_reverse_charge_applied || false
        });
      } catch (e) {
      }
    }
  };

  if (fy === '2022-23') {
    const listFile = path.resolve('data', 'audit', '2022-23', 'zoho_list_cache.json');
    let classifierSets = null;
    let listData = { invoices: [], bills: [], creditnotes: [], vendorcredits: [] };
    if (fs.existsSync(listFile)) {
      listData = JSON.parse(fs.readFileSync(listFile, 'utf8'));
      classifierSets = {
        sales: new Set((listData.invoices || []).map((s:any) => s.invoice_id)),
        purchases: new Set((listData.bills || []).map((p:any) => p.bill_id)),
        salesCN: new Set((listData.creditnotes || []).map((cn:any) => cn.creditnote_id)),
        vendorCredits: new Set((listData.vendorcredits || []).map((vc:any) => vc.vendor_credit_id))
      };
    }
    const dir2223 = path.resolve('data', 'audit', '2022-23', 'detail_cache');
    const samples2223 = path.resolve('data', 'audit', '2022-23', 'detail_samples');
    processDir(samples2223, 'auto', '22-23-SYNC', classifierSets);
    processDir(dir2223, 'auto', '22-23-SYNC', classifierSets);
  } else {
    const cacheDir = path.resolve('output', 'gst_source_cache');
    const dir5G2A = path.join(cacheDir, '5G2A');
    const dir5G2B = path.join(cacheDir, '5G2B');
    const dir5G2C = path.join(cacheDir, '5G2C_FY2526');
    const dir5G2D = path.join(cacheDir, '5G2D_FY2526');
    const dir5G2E = path.join(cacheDir, '5G2E_FY2526');
    const dir5G2F = path.join(cacheDir, '5G2F_FY2526');
    const dir5G2G = path.join(cacheDir, '5G2G_FINAL_FY2526');
    processDir(path.join(dir5G2A, 'sales'), 'sales', '5G2A');
    processDir(path.join(dir5G2A, 'purchases'), 'purchase', '5G2A');
    processDir(path.join(dir5G2B, 'sales'), 'sales', '5G2B');
    processDir(path.join(dir5G2B, 'purchases'), 'purchase', '5G2B');
    processDir(path.join(dir5G2C, 'sales'), 'sales', '5G2C_FY2526');
    processDir(path.join(dir5G2C, 'purchases'), 'purchase', '5G2C_FY2526');
    processDir(path.join(dir5G2D, 'sales'), 'sales', '5G2D_FY2526');
    processDir(path.join(dir5G2D, 'purchases'), 'purchase', '5G2D_FY2526');
    processDir(path.join(dir5G2E, 'sales'), 'sales', '5G2E_FY2526');
    processDir(path.join(dir5G2E, 'purchases'), 'purchase', '5G2E_FY2526');
    processDir(path.join(dir5G2F, 'sales'), 'sales', '5G2F_FY2526');
    processDir(path.join(dir5G2F, 'purchases'), 'purchase', '5G2F_FY2526');
    processDir(path.join(dir5G2G, 'sales'), 'sales', '5G2G_FINAL_FY2526');
    processDir(path.join(dir5G2G, 'purchases'), 'purchase', '5G2G_FINAL_FY2526');
  }

  // Hardcoded mock pilot records removed per owner instruction

  const allEvidence = Array.from(allDocs.values());
  allEvidence.sort((a, b) => a.document_date.localeCompare(b.document_date));

  let salesAcquired = 0, purchasesAcquired = 0, salesCNAcquired = 0, vendorCreditAcquired = 0;
  let rcmDocsFound = 0, rcmTaxable = 0;
  
  let salesTaxable = 0;
  let purchaseTaxable = 0;
  let salesCNTaxable = 0;
  let vendorCreditTaxable = 0;

  for (const doc of allEvidence) {
    if (!doc.isPilot) {
      if (doc.document_type === 'sales') {
        salesAcquired++;
        salesTaxable += doc.taxable || 0;
      }
      else if (doc.document_type === 'purchase') {
        purchasesAcquired++;
        purchaseTaxable += doc.taxable || 0;
        if (doc.isRcm) {
          rcmDocsFound++;
          rcmTaxable += doc.taxable || 0;
        }
      }
      else if (doc.document_type === 'creditnote') {
        salesCNAcquired++;
        salesCNTaxable += doc.taxable || 0;
      }
      else if (doc.document_type === 'vendorcredit') {
        vendorCreditAcquired++;
        vendorCreditTaxable += doc.taxable || 0;
      }
    }
  }

  let metrics = {
    salesAcquired: salesAcquired,
    purchasesAcquired: purchasesAcquired,
    totalSalesTarget: 457,
    totalPurchasesTarget: 1194,
    purchaseUnavailable: 1
  };
  
  if (fy === '2022-23') {
    metrics.totalSalesTarget = 134;
    metrics.totalPurchasesTarget = 491;
    metrics.purchaseUnavailable = 0;
  }

  const coverage = {
    sales: {
      universe: metrics.totalSalesTarget,
      acquired: salesAcquired,
      remaining: Math.max(0, metrics.totalSalesTarget - salesAcquired)
    },
    purchases: {
      universe: metrics.totalPurchasesTarget,
      acquired: purchasesAcquired,
      remaining: Math.max(0, metrics.totalPurchasesTarget - purchasesAcquired)
    },
    salesCreditNotes: {
      universe: fy === '2022-23' ? 1 : 0,
      acquired: salesCNAcquired,
      remaining: Math.max(0, (fy === '2022-23' ? 1 : 0) - salesCNAcquired)
    },
    vendorCredits: {
      universe: 0,
      acquired: vendorCreditAcquired,
      remaining: 0
    },
    rcm: {
      inspected: purchasesAcquired,
      docsFound: rcmDocsFound,
      taxable: rcmTaxable
    },
    total: {
      universe: metrics.totalSalesTarget + metrics.totalPurchasesTarget + (fy === '2022-23' ? 1 : 0),
      acquired: salesAcquired + purchasesAcquired + salesCNAcquired + vendorCreditAcquired,
      remaining: Math.max(0, (metrics.totalSalesTarget + metrics.totalPurchasesTarget + (fy === '2022-23' ? 1 : 0)) - (salesAcquired + purchasesAcquired + salesCNAcquired + vendorCreditAcquired))
    },
    commercial: {
      sales_invoices_taxable: salesTaxable,
      sales_credit_notes_taxable: salesCNTaxable,
      sales_invoices_count: salesAcquired,
      sales_credit_notes_count: salesCNAcquired,
      purchase_bills_taxable: purchaseTaxable,
      vendor_credits_taxable: vendorCreditTaxable,
      purchase_bills_count: purchasesAcquired,
      vendor_credits_count: vendorCreditAcquired,
      source_limitation: null as string | null,
      landed_cost_included: false
    }
  };
  
  if (coverage.sales.remaining > 0 || coverage.purchases.remaining > 0 || coverage.salesCreditNotes.remaining > 0 || coverage.vendorCredits.remaining > 0) {
    coverage.commercial.source_limitation = 'Incomplete Books Details';
  }

  return NextResponse.json({
    progress: progress || { status: 'UNKNOWN', owner_authorized_get_limit: 0 },
    metrics,
    coverage,
    allEvidence
  });
}
