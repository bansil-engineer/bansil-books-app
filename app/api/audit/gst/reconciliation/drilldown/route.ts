import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fy = searchParams.get('FY');
  const period = searchParams.get('period'); 
  const tab = searchParams.get('tab');
  const metric = searchParams.get('metric');
  const taxHead = searchParams.get('taxHead');
  const supplyType = searchParams.get('supplyType');
  const sourceType = searchParams.get('sourceType');
  const documentType = searchParams.get('documentType');
  
  if (!fy || !period || !metric || !sourceType) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  const fyStr = fy || '2025-26';
  const startYear = parseInt(fyStr.split('-')[0], 10);
  const endYear = startYear + 1;
  const startDate = `${startYear}-04-01`;
  const endDate = `${endYear}-03-31`;

  const isFullYear = period === 'FULL';
  const monthMatch = isFullYear ? null : period; 

  let val = 0;
  let components: any[] = [];
  let available = false;
  let availableCount = 0;
  let unavailableCount = 0;
  let summaryFormula = "Sum of source documents";
  let status = "PASS";
  let componentTotal = 0;

  const getMonthStr = (d: string) => {
    if (!d || d.length < 10) return "UNKNOWN";
    const [yyyy, mm, dd] = d.split('-');
    return `${mm} ${yyyy}`;
  };

  if (sourceType === 'BOOKS') {
    const type = (documentType === 'BILL' || documentType === 'PURCHASE') ? 'purchases' : 'sales';
    const cacheDir = path.join(process.cwd(), 'output', 'gst_source_cache');
    
    if (fs.existsSync(cacheDir)) {
      const batches = fs.readdirSync(cacheDir);
      for (const b of batches) {
        const typeDir = path.join(cacheDir, b, type);
        if (fs.existsSync(typeDir) && fs.statSync(typeDir).isDirectory()) {
          const files = fs.readdirSync(typeDir).filter((f: string) => f.endsWith('.json') && f !== 'batch_manifest.json' && f !== 'batch_progress.json');
          for (const f of files) {
            try {
              const raw = fs.readFileSync(path.join(typeDir, f), 'utf8');
              const detail = JSON.parse(raw);
              const root = detail.invoice || detail.bill || detail;
              const date = root.date || '';
              
              if (!(date >= startDate && date <= endDate)) continue;
              if (!isFullYear && getMonthStr(date) !== monthMatch) continue;

              let taxable = root.sub_total || 0;
              let igst = 0, cgst = 0, sgst = 0, cess = 0;
              (root.taxes || []).forEach((t: any) => {
                const n = (t.tax_name || '').toUpperCase();
                if (n.includes('IGST')) igst += t.tax_amount || 0;
                else if (n.includes('CGST')) cgst += t.tax_amount || 0;
                else if (n.includes('SGST')) sgst += t.tax_amount || 0;
                else if (n.includes('CESS')) cess += t.tax_amount || 0;
              });

              let gross = root.total || taxable + igst + cgst + sgst + cess;

              let include = false;
              let itemAmt = 0;
              
              let isInterstate = igst > 0;
              let isIntrastate = cgst > 0 || sgst > 0 || (!isInterstate && (igst+cgst+sgst+cess)===0);
              
              if (supplyType === 'INTERSTATE' && !isInterstate) continue;
              if (supplyType === 'INTRASTATE' && !isIntrastate) continue;
              
              if (metric === 'TAXABLE') { include = true; itemAmt = taxable; }
              else if (metric === 'IGST') { include = igst > 0; itemAmt = igst; }
              else if (metric === 'CGST') { include = cgst > 0; itemAmt = cgst; }
              else if (metric === 'SGST') { include = sgst > 0; itemAmt = sgst; }
              else if (metric === 'CESS') { include = cess > 0; itemAmt = cess; }
              else if (metric === 'GROSS') { include = true; itemAmt = gross; }

              if (include) {
                val += itemAmt;
                components.push({
                  date: date,
                  documentNumber: root.invoice_number || root.bill_number || '',
                  party: root.customer_name || root.vendor_name || 'Unknown',
                  gstin: root.gst_no || root.gstin || '',
                  taxable,
                  igst,
                  cgst,
                  sgst,
                  cess,
                  amount: itemAmt, 
                  gross,
                  source: type === 'sales' ? 'Books Invoice' : 'Books Bill',
                  classification: (igst>0) ? 'INTER' : ((cgst>0||sgst>0) ? 'INTRA' : 'OTHER'),
                  reversal_reason: root.itc_eligibility === 'Ineligible' ? 'Blocked / Ineligible' : '',
                  eligibility: root.itc_eligibility || 'Eligible'
                });
              }
            } catch(e) {}
          }
        }
      }
      
      const unique = new Map();
      for (const c of components) {
        unique.set(c.documentNumber, c);
      }
      components = Array.from(unique.values());
      val = components.reduce((sum, c) => sum + c.amount, 0);
      componentTotal = val;
      available = true;
    }
  } else if (sourceType === 'G3B' || sourceType === 'CHALLAN' || sourceType === 'CASH_LEDGER') {
    // For GSTR-3B Utilisation / Payments we use the matrix
    const matrixFile = sourceType === 'G3B' ? (metric.includes('ITC_USED') ? '3b-payment-matrix.json' : 'monthly-tax-matrix.json') : '3b-payment-matrix.json';
    const filePath = path.join(process.cwd(), 'public', matrixFile);
    if (fs.existsSync(filePath)) {
       const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
       const processMonth = (mStrKey: string) => {
         const d = data[mStrKey];
         if (!d) return;
         if (metric.includes('ITC_USED') || sourceType === 'CHALLAN' || sourceType === 'CASH_LEDGER') {
           const b3 = d['3b'] || {};
           if (sourceType === 'CHALLAN') {
             const chs = d.challans || [];
             chs.forEach((c: any) => {
               const amt = (c.igst || 0) + (c.cgst || 0) + (c.sgst || 0) + (c.cess || 0);
               if ((taxHead === 'IGST' && c.igst) || (taxHead === 'CGST' && c.cgst) || (taxHead === 'SGST' && c.sgst) || (taxHead === 'CESS' && c.cess) || !taxHead) {
                 val += taxHead === 'IGST' ? c.igst : taxHead === 'CGST' ? c.cgst : taxHead === 'SGST' ? c.sgst : taxHead === 'CESS' ? c.cess : amt;
                 components.push({
                   date: c.date, documentNumber: c.cpin || c.cin || "Unknown", party: "Government",
                   taxable: 0, igst: c.igst || 0, cgst: c.cgst || 0, sgst: c.sgst || 0, cess: c.cess || 0,
                   amount: taxHead === 'IGST' ? c.igst : taxHead === 'CGST' ? c.cgst : taxHead === 'SGST' ? c.sgst : taxHead === 'CESS' ? c.cess : amt,
                   source: 'GST Challan', classification: 'Deposit'
                 });
               }
             });
             available = true;
           } else if (metric.includes('ITC_USED')) {
               // This is filed ITC Utilisation, we can't show invoices, but we can show the amounts
               const utilized = b3[`itc_${taxHead?.toLowerCase()}_${taxHead?.toLowerCase()}`] || 0;
               val += utilized;
               if (utilized > 0) {
                 components.push({
                   date: mStrKey, documentNumber: "GSTR-3B", party: "Utilisation Offset",
                   taxable: 0, igst: taxHead === 'IGST'?utilized:0, cgst: taxHead === 'CGST'?utilized:0, sgst: taxHead === 'SGST'?utilized:0, cess: taxHead === 'CESS'?utilized:0,
                   amount: utilized, source: 'GSTR-3B', classification: 'Filed ITC Used'
                 });
               }
               available = true;
           }
         }
       };
       if (isFullYear) {
         Object.keys(data).forEach(processMonth);
       } else {
         processMonth(monthMatch as string);
       }
       componentTotal = val;
    }
  }

  if (!available) {
    return NextResponse.json({
      context: { fy, period, metric, sourceType },
      summary: {
        metricName: `${sourceType} ${metric}`,
        value: val || 0,
        formula: summaryFormula,
        source: sourceType,
        sourcePeriod: period,
        status: status,
        provenance: "Local Cache"
      },
      components: [],
      reconciliation: {
        displayedTotal: val || 0,
        componentTotal: 0,
        difference: val || 0
      }
    });
  }

  return NextResponse.json({
    context: { fy, period, metric, sourceType },
    summary: {
      metricName: `${sourceType} ${metric}`,
      value: val || 0,
      formula: summaryFormula,
      source: sourceType,
      sourcePeriod: period,
      status: status !== "PASS" ? status : (Math.abs((val || 0) - componentTotal) > 0.01 ? "DIFFERENCE FOUND" : (unavailableCount > 0 ? (availableCount > 0 ? "PASS WITH SOURCE LIMITATION" : "SOURCE DETAIL NOT AVAILABLE") : "PASS")),
      provenance: "Local Cache / Parsed Evidence"
    },
    components: components.sort((a,b) => a.date.localeCompare(b.date)),
    reconciliation: {
      displayedTotal: val || 0,
      componentTotal: componentTotal,
      difference: Math.abs((val || 0) - componentTotal) > 0.01 ? (val || 0) - componentTotal : 0,
      availableCount,
      unavailableCount
    }
  });
}
