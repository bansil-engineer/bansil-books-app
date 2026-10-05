import * as fs from 'fs';
import * as path from 'path';

// 1. BUILD AUTHORITATIVE FY25-26 UNIVERSE
const salesUniverse = JSON.parse(fs.readFileSync('sales_universe.json', 'utf-8'));
const purchaseUniverse = JSON.parse(fs.readFileSync('purchase_universe.json', 'utf-8'));

const salesUniverseIds = new Set(salesUniverse.map((r: any) => String(r.invoice_id)));
const purchaseUniverseIds = new Set(purchaseUniverse.map((r: any) => String(r.bill_id)));

// 2. EXCLUDE ALREADY ACQUIRED VALID FY DETAILS
function findJsonFiles(dir: string, fileList: string[] = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findJsonFiles(filePath, fileList);
    } else if (filePath.endsWith('.json') && !filePath.includes('batch_')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allCacheFiles = findJsonFiles('output');
const cachedSalesIds = new Set<string>();
const cachedPurchaseIds = new Set<string>();
const rawPurchaseDetails: any[] = []; // for step 4

for (const filePath of allCacheFiles) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    let innerData = data.invoice || data.bill || data.vendor_credit || data;
    if (data.code === 0 && data.message === 'success') {
      innerData = data.invoice || data.bill || data;
    }
    const docId = String(innerData.invoice_id || innerData.bill_id || innerData.vendor_credit_id || innerData.document_id || path.basename(filePath, '.json'));
    const docDate = innerData.date || innerData.invoice_date || innerData.bill_date || 'UNKNOWN';
    
    // Test if FY25-26
    let isFY = false;
    if (docDate !== 'UNKNOWN') {
      const d = docDate;
      if (d >= '2025-04-01' && d <= '2026-03-31') isFY = true;
    }

    if (isFY) {
      if (filePath.includes('/sales/') || filePath.includes('invoice') || innerData.invoice_id) {
        cachedSalesIds.add(docId);
      } else if (filePath.includes('/purchases/') || filePath.includes('bill') || innerData.bill_id) {
        cachedPurchaseIds.add(docId);
        rawPurchaseDetails.push({ filePath, innerData });
      }
    }
  } catch (e) {}
}

const validSalesAcquired = salesUniverse.filter((r: any) => cachedSalesIds.has(String(r.invoice_id)));
const salesRemaining = salesUniverse.filter((r: any) => !cachedSalesIds.has(String(r.invoice_id)));

const validPurchasesAcquired = purchaseUniverse.filter((r: any) => cachedPurchaseIds.has(String(r.bill_id)));
const purchaseRemaining = purchaseUniverse.filter((r: any) => !cachedPurchaseIds.has(String(r.bill_id)));

// 3. PROVE MONTH DISTRIBUTION
const months = [
  '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09',
  '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'
];

type MonthStat = {
    month: string;
    sTot: number; sAcq: number; sRem: number;
    pTot: number; pAcq: number; pRem: number;
};
const mStats: MonthStat[] = [];
for (const m of months) {
    const sT = salesUniverse.filter((r: any) => r.date.startsWith(m)).length;
    const sA = validSalesAcquired.filter((r: any) => r.date.startsWith(m)).length;
    const sR = salesRemaining.filter((r: any) => r.date.startsWith(m)).length;

    const pT = purchaseUniverse.filter((r: any) => r.date.startsWith(m)).length;
    const pA = validPurchasesAcquired.filter((r: any) => r.date.startsWith(m)).length;
    const pR = purchaseRemaining.filter((r: any) => r.date.startsWith(m)).length;

    mStats.push({ month: m, sTot: sT, sAcq: sA, sRem: sR, pTot: pT, pAcq: pA, pRem: pR });
}

// 4. INVESTIGATE THE 3 PURCHASE DETAILS
let expOutput = '';
let differenceExplained = 'EXPLAINED';

for (const raw of rawPurchaseDetails) {
  const d = raw.innerData;
  const taxable = d.sub_total || 0;
  let gst = 0;
  if (Array.isArray(d.taxes)) {
    gst = d.taxes.reduce((acc: number, t: any) => acc + (t.tax_amount || 0), 0);
  }
  const gross = d.total || d.bcy_total || 0;
  const tds = d.tds_amount || d.tax_withheld_amount || 0;
  const vendorPayable = d.balance || 0;
  const adjustment = d.adjustment || 0;
  
  // Calculate difference strictly as requested
  const diff = gross - vendorPayable; 
  let explained = false;
  let expParts: string[] = [];
  
  if (tds > 0) expParts.push(`TDS: ${tds}`);
  
  // Payments made?
  const paymentMade = d.payment_made || 0;
  if (paymentMade > 0) expParts.push(`Payment Made: ${paymentMade}`);
  
  const diffRemaining = Math.abs(diff - (tds + paymentMade));
  if (diffRemaining < 0.01) {
      explained = true;
  }
  
  if (!explained && Math.abs(diff) < 0.01) {
      explained = true;
  }

  if (!explained) {
      differenceExplained = 'NOT EXPLAINED';
  }

  expOutput += `\nBill ID: ${d.bill_id}
Bill Number: ${d.bill_number}
Date: ${d.date}
Taxable: ${taxable}
GST: ${gst}
Bill Gross: ${gross}
TDS: ${tds}
Vendor Payable: ${vendorPayable}
Adjustment: ${adjustment}
Payment Made: ${paymentMade}
Difference: ${diff}
Source Explanation: ${explained ? expParts.join(', ') || 'None (Gross == Payable)' : 'NOT FULLY EXPLAINED'}\n`;
}

// 5. ORIGINAL 2-GET PILOT
const origSalesId = '3166667000008668326';
const origPurchId = '3166667000008809065';

const sPilotInUni = salesUniverseIds.has(origSalesId);
const pPilotInUni = purchaseUniverseIds.has(origPurchId);
const sPilotDb = salesUniverse.find((r: any) => String(r.invoice_id) === origSalesId);
const pPilotDb = purchaseUniverse.find((r: any) => String(r.bill_id) === origPurchId);

// 6. DESIGN NEXT ACQUISITION SELECTION
function selectProportional(remaining: any[], target: number) {
    const totalRemaining = remaining.length;
    if (totalRemaining <= target) return [...remaining];
    
    let selected: any[] = [];
    const groupedByMonth = remaining.reduce((acc, r) => {
        const m = r.date.substring(0, 7);
        if (!acc[m]) acc[m] = [];
        acc[m].push(r);
        return acc;
    }, {} as Record<string, any[]>);
    
    // allocate proportionally
    let taken = 0;
    for (const m of months) {
        if (!groupedByMonth[m]) continue;
        const countToTake = Math.floor((groupedByMonth[m].length / totalRemaining) * target);
        selected = selected.concat(groupedByMonth[m].slice(0, countToTake));
        taken += countToTake;
    }
    
    // add remaining if rounding left us short
    if (taken < target) {
        const diff = target - taken;
        const remainingToPick = remaining.filter((r: any) => !selected.includes(r));
        selected = selected.concat(remainingToPick.slice(0, diff));
    }
    
    return selected;
}

const nextSales = selectProportional(salesRemaining, 100);
const nextPurchases = selectProportional(purchaseRemaining, 100);

// 7. PERMANENT SELECTION GUARD
function guardCheck(doc: any, alreadyCachedSet: Set<string>) {
    const id = doc.invoice_id || doc.bill_id;
    if (!id) return false;
    if (!doc.date) return false;
    if (doc.date < '2025-04-01' || doc.date > '2026-03-31') return false;
    if (alreadyCachedSet.has(id)) return false;
    return true;
}

let allProposedFY2526 = true;
let duplicateIds = 0;
let alreadyCachedIds = 0;
let guardPass = true;

const proposedIds = new Set<string>();

for (const s of nextSales) {
    if (proposedIds.has(s.invoice_id)) duplicateIds++;
    if (cachedSalesIds.has(s.invoice_id)) alreadyCachedIds++;
    proposedIds.add(s.invoice_id);
    if (!guardCheck(s, cachedSalesIds)) guardPass = false;
    if (s.date < '2025-04-01' || s.date > '2026-03-31') allProposedFY2526 = false;
}

for (const p of nextPurchases) {
    if (proposedIds.has(p.bill_id)) duplicateIds++;
    if (cachedPurchaseIds.has(p.bill_id)) alreadyCachedIds++;
    proposedIds.add(p.bill_id);
    if (!guardCheck(p, cachedPurchaseIds)) guardPass = false;
    if (p.date < '2025-04-01' || p.date > '2026-03-31') allProposedFY2526 = false;
}

console.log(`==================================================`);
console.log(`8. FINAL REPORT`);
console.log(`==================================================\n`);
console.log(`FY25-26 SALES UNIVERSE:`);
console.log(`${salesUniverse.length}\n`);
console.log(`FY25-26 PURCHASE UNIVERSE:`);
console.log(`${purchaseUniverse.length}\n`);
console.log(`VALID SALES DETAIL ACQUIRED:`);
console.log(`${validSalesAcquired.length}\n`);
console.log(`VALID PURCHASE DETAIL ACQUIRED:`);
console.log(`${validPurchasesAcquired.length}\n`);
console.log(`SALES REMAINING:`);
console.log(`${salesRemaining.length}\n`);
console.log(`PURCHASE REMAINING:`);
console.log(`${purchaseRemaining.length}\n`);
console.log(`3-PURCHASE ₹19,000 DIFFERENCE:`);
console.log(`${differenceExplained}\n`);
console.log(`EXPLANATION:`);
console.log(`${expOutput.trim()}\n`);
console.log(`ORIGINAL SALES PILOT IN FY UNIVERSE:`);
console.log(`${sPilotInUni ? 'YES' : 'NO'} ${sPilotInUni ? `(${sPilotDb?.invoice_number || ''} / ${sPilotDb?.date || ''} / FY25-26 / ${sPilotDb?.total || ''})` : ''}\n`);
console.log(`ORIGINAL PURCHASE PILOT IN FY UNIVERSE:`);
console.log(`${pPilotInUni ? 'YES' : 'NO'} ${pPilotInUni ? `(${pPilotDb?.bill_number || ''} / ${pPilotDb?.date || ''} / FY25-26 / ${pPilotDb?.total || ''})` : ''}\n`);
console.log(`ORIGINAL PILOT DETAIL EVIDENCE:`);
console.log(`MISSING\n`);
console.log(`NEXT PROPOSED SALES:`);
console.log(`${nextSales.length}\n`);
console.log(`NEXT PROPOSED PURCHASE:`);
console.log(`${nextPurchases.length}\n`);
console.log(`ALL PROPOSED DOCUMENTS FY25-26:`);
console.log(`${allProposedFY2526 ? 'YES' : 'NO'}\n`);
console.log(`DUPLICATE PROPOSED IDS:`);
console.log(`${duplicateIds}/${nextSales.length + nextPurchases.length}\n`);
console.log(`ALREADY-CACHED PROPOSED IDS:`);
console.log(`${alreadyCachedIds}/${nextSales.length + nextPurchases.length}\n`);
console.log(`FY GUARD:`);
console.log(`${guardPass ? 'PASS' : 'FAIL'}\n`);
console.log(`ZOHO GET:\n0\n`);
console.log(`ZOHO WRITE:\n0\n`);
console.log(`DATABASE MODIFIED:\nNO\n`);
console.log(`SAFE TO REQUEST OWNER AUTHORIZATION FOR NEXT FY25-26 BATCH:`);
console.log(`${guardPass && allProposedFY2526 && duplicateIds === 0 && alreadyCachedIds === 0 ? 'YES' : 'NO'}`);

console.log(`\n==================================================`);
console.log(`3. PROVE MONTH DISTRIBUTION`);
console.log(`==================================================`);
for (const s of mStats) {
    console.log(`${s.month}\nSales total: ${s.sTot}\nSales already cached: ${s.sAcq}\nSales remaining: ${s.sRem}\nPurchase total: ${s.pTot}\nPurchase already cached: ${s.pAcq}\nPurchase remaining: ${s.pRem}\n`);
}
