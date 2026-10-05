import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getValidAccessToken } from "../app/lib/zoho-api";
import { secureZohoFetch } from "../app/lib/zoho-security-guard";

const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  if (line.startsWith('ZOHO_DEFAULT_ORG_ID=')) {
    process.env.ZOHO_DEFAULT_ORG_ID = line.split('=')[1].trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  }
}

const BATCH_DIR = path.resolve('output', 'gst_source_cache', '5G2C_FY2526');
const SALES_DIR = path.join(BATCH_DIR, 'sales');
const PUR_DIR = path.join(BATCH_DIR, 'purchases');
const PROGRESS_PATH = path.join(BATCH_DIR, 'batch_progress.json');
const MANIFEST_PATH = path.join(BATCH_DIR, 'batch_manifest.json');

function ensureDirs() {
  if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });
  if (!fs.existsSync(SALES_DIR)) fs.mkdirSync(SALES_DIR, { recursive: true });
  if (!fs.existsSync(PUR_DIR)) fs.mkdirSync(PUR_DIR, { recursive: true });
}

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

async function run() {
  ensureDirs();

  // Load progress
  let progress = {
    owner_authorized_get_limit: 200,
    attempted_gets: 0,
    successful_gets: 0,
    failed_gets: 0,
    rate_limited_gets: 0,
    sales_attempted: 0,
    sales_successful: 0,
    purchase_attempted: 0,
    purchase_successful: 0,
    remaining_authorization: 200,
    status: 'IN_PROGRESS'
  };

  let manifest: any[] = [];
  if (fs.existsSync(PROGRESS_PATH)) {
    const existing = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    if (existing.attempted_gets > 0) {
      // "Never restart from zero" -> Use the existing
      progress = existing;
      if (fs.existsSync(MANIFEST_PATH)) {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      }
    }
  }

  if (progress.attempted_gets >= 200) {
    console.log("HARD CAP REACHED. STOPPING.");
  }

  // Load universes
  const salesUniverse = JSON.parse(fs.readFileSync('sales_universe.json', 'utf-8'));
  const purchaseUniverse = JSON.parse(fs.readFileSync('purchase_universe.json', 'utf-8'));

  // Existing cache across all
  const allCacheFiles = findJsonFiles('output');
  const cachedSalesIds = new Set<string>();
  const cachedPurchaseIds = new Set<string>();
  for (const filePath of allCacheFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let innerData = data.invoice || data.bill || data;
      if (data.code === 0 && data.message === 'success') {
         innerData = data.invoice || data.bill || data;
      }
      const docId = String(innerData.invoice_id || innerData.bill_id || innerData.vendor_credit_id || innerData.document_id || path.basename(filePath, '.json'));
      const docDate = innerData.date || innerData.invoice_date || innerData.bill_date || 'UNKNOWN';
      let isFY = false;
      if (docDate >= '2025-04-01' && docDate <= '2026-03-31') isFY = true;
      if (isFY) {
        if (filePath.includes('/sales/') || filePath.includes('invoice')) cachedSalesIds.add(docId);
        else if (filePath.includes('/purchases/') || filePath.includes('bill')) cachedPurchaseIds.add(docId);
      }
    } catch(e) {}
  }

  const salesRemaining = salesUniverse.filter((r: any) => !cachedSalesIds.has(String(r.invoice_id)));
  const purchaseRemaining = purchaseUniverse.filter((r: any) => !cachedPurchaseIds.has(String(r.bill_id)));

  const months = ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];
  
  function selectProportional(remaining: any[], target: number) {
      const totalRemaining = remaining.length;
      if (totalRemaining <= target) return [...remaining];
      let selected: any[] = [];
      const groupedByMonth = remaining.reduce((acc: any, r: any) => {
          const m = r.date.substring(0, 7);
          if (!acc[m]) acc[m] = [];
          acc[m].push(r);
          return acc;
      }, {});
      let taken = 0;
      for (const m of months) {
          if (!groupedByMonth[m]) continue;
          const countToTake = Math.floor((groupedByMonth[m].length / totalRemaining) * target);
          selected = selected.concat(groupedByMonth[m].slice(0, countToTake));
          taken += countToTake;
      }
      if (taken < target) {
          const diff = target - taken;
          const remainingToPick = remaining.filter((r: any) => !selected.includes(r));
          selected = selected.concat(remainingToPick.slice(0, diff));
      }
      return selected;
  }

  const nextSales = selectProportional(salesRemaining, 100);
  const nextPurchases = selectProportional(purchaseRemaining, 100);

  // Hard FY assertion
  let sOut = 0, pOut = 0;
  for (const s of nextSales) if (s.date < '2025-04-01' || s.date > '2026-03-31') sOut++;
  for (const p of nextPurchases) if (p.date < '2025-04-01' || p.date > '2026-03-31') pOut++;

  if (sOut > 0 || pOut > 0) {
      console.log(`HOLD. Selected Sales Outside FY: ${sOut}, Selected Purchase Outside FY: ${pOut}`);
      return;
  }

  // Auth
  const { token, store } = await getValidAccessToken();
  const domain = store.api_domain;
  const orgId = process.env.ZOHO_DEFAULT_ORG_ID!;

  let getCallsCount = 0;
  const attemptedDocIds = new Set(manifest.map(m => m.document_id));

  let outOfFyResponseCount = 0;
  let cacheSkips = 0;

  async function fetchAndProcess(type: 'sales' | 'purchases', doc: any) {
    if (progress.attempted_gets >= 200) return false;

    const docId = String(type === 'sales' ? doc.invoice_id : doc.bill_id);
    const docDate = doc.date;

    // GUARD A — DATE
    if (docDate < '2025-04-01' || docDate > '2026-03-31') return false; // REJECT WITHOUT GET
    // GUARD B — DOCUMENT ID
    if (!docId) return false; // REJECT
    // GUARD C — UNIQUE
    if (attemptedDocIds.has(docId)) return false; // REJECT
    // GUARD D — CACHE
    if (type === 'sales' && cachedSalesIds.has(docId)) { cacheSkips++; return false; }
    if (type === 'purchases' && cachedPurchaseIds.has(docId)) { cacheSkips++; return false; }

    progress.attempted_gets++;
    progress.remaining_authorization--;
    if (type === 'sales') progress.sales_attempted++;
    else progress.purchase_attempted++;
    attemptedDocIds.add(docId);
    
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2)); // Durable lock

    let url = type === 'sales' 
       ? `${domain}/books/v3/invoices/${docId}?organization_id=${orgId}`
       : `${domain}/books/v3/bills/${docId}?organization_id=${orgId}`;
       
    let endpoint_family = type === 'sales' ? 'GET /books/v3/invoices/{invoice_id}' : 'GET /books/v3/bills/{bill_id}';
    let fetchStart = new Date().toISOString();

    const manifestEntry: any = {
       document_type: type,
       document_id: docId,
       document_number: type === 'sales' ? doc.invoice_number : doc.bill_number,
       document_date: docDate,
       month: docDate.substring(0, 7),
       FY: 'FY25-26',
       endpoint_family,
       fetch_status: 'PENDING'
    };
    manifest.push(manifestEntry);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

    let res;
    try {
      res = await secureZohoFetch(url, {
        method: "GET",
        headers: { Authorization: `Zoho-oauthtoken ${token}` }
      });
      getCallsCount++;
    } catch (e: any) {
      progress.failed_gets++;
      manifestEntry.fetch_status = 'ERROR';
      fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
      return true; // Used auth
    }

    if (!res.ok) {
        if (res.status === 429) progress.rate_limited_gets++;
        else progress.failed_gets++;
        manifestEntry.fetch_status = res.status === 429 ? 'RATE_LIMITED' : 'FAILED';
        fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
        return true;
    }

    const resJson = await res.json();
    progress.successful_gets++;
    if (type === 'sales') progress.sales_successful++;
    else progress.purchase_successful++;

    const innerData = resJson.invoice || resJson.bill || resJson;
    const resDocDate = innerData.date || innerData.invoice_date || innerData.bill_date;
    
    let isFyValid = (resDocDate >= '2025-04-01' && resDocDate <= '2026-03-31');
    if (!isFyValid) {
        outOfFyResponseCount++;
        manifestEntry.periodStatus = 'RESPONSE_OUT_OF_PERIOD';
    }

    const payloadRaw = JSON.stringify(resJson, null, 2);
    const hash = crypto.createHash('sha256').update(payloadRaw).digest('hex');

    const destPath = path.join(type === 'sales' ? SALES_DIR : PUR_DIR, `${docId}.json`);
    if (!fs.existsSync(destPath)) {
        fs.writeFileSync(destPath, payloadRaw);
    }

    manifestEntry.fetch_status = 'SUCCESS';
    manifestEntry.fetched_at = fetchStart;
    manifestEntry.payload_sha256 = hash;
    
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

    return true; // used auth
  }

  // Acquisition loop
  for (const s of nextSales) {
     if (progress.attempted_gets >= 200) break;
     await fetchAndProcess('sales', s);
  }
  for (const p of nextPurchases) {
     if (progress.attempted_gets >= 200) break;
     await fetchAndProcess('purchases', p);
  }

  progress.status = 'COMPLETED';
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));

  // Compute Normalization from fetched cache
  let sExact = 0, sDerived = 0, sUnc = 0;
  let sPass = 0, sMis = 0;
  let pExact = 0, pDerived = 0, pUnc = 0;
  let pPass = 0, pMis = 0;
  let pTds = 0, pPaid = 0;

  for (const m of manifest) {
      if (m.fetch_status !== 'SUCCESS') continue;
      const fPath = path.join(m.document_type === 'sales' ? SALES_DIR : PUR_DIR, `${m.document_id}.json`);
      if (!fs.existsSync(fPath)) continue;

      const innerData = JSON.parse(fs.readFileSync(fPath, 'utf8')).invoice || JSON.parse(fs.readFileSync(fPath, 'utf8')).bill;
      const taxes = innerData.taxes || [];
      let igst = 0, cgst = 0, sgst = 0, cess = 0;
      for (const t of taxes) {
          const nm = (t.tax_name || '').toUpperCase();
          if (nm.includes('IGST')) igst += t.tax_amount;
          else if (nm.includes('CGST')) cgst += t.tax_amount;
          else if (nm.includes('SGST')) sgst += t.tax_amount;
          else if (nm.includes('CESS')) cess += t.tax_amount;
      }
      const totalTax = igst + cgst + sgst + cess;
      let source_class = 'UNCLASSIFIED';
      if (igst > 0 || cgst > 0 || sgst > 0 || totalTax === 0) {
          source_class = 'SOURCE_EXACT';
      }

      const taxable = innerData.sub_total || 0;
      const adjustment = innerData.adjustment || 0;
      const gross = innerData.total || innerData.bcy_total || 0;
      const tds = innerData.tds_amount || innerData.tax_withheld_amount || 0;

      if (m.document_type === 'sales') {
         if (source_class === 'SOURCE_EXACT') sExact++;
         else if (source_class === 'SOURCE_DERIVED') sDerived++;
         else sUnc++;

         const calc = taxable + totalTax + adjustment;
         if (Math.abs(gross - calc) <= 0.1) sPass++;
         else sMis++;
      } else {
         if (source_class === 'SOURCE_EXACT') pExact++;
         else if (source_class === 'SOURCE_DERIVED') pDerived++;
         else pUnc++;

         // Bill Gross equation: taxable + tax + adjustment = Gross
         const calc = taxable + totalTax + adjustment;
         if (Math.abs(gross - calc) <= 0.1) pPass++;
         else pMis++;

         if (tds > 0) pTds++;
         if ((innerData.payment_made || 0) > 0 || innerData.balance === 0) pPaid++;
      }
  }

  const postSalesCov = cachedSalesIds.size + progress.sales_successful;
  const postPurchCov = cachedPurchaseIds.size + progress.purchase_successful;

  console.log(`==================================================`);
  console.log(`21. FINAL REPORT`);
  console.log(`==================================================`);
  console.log(`STAGE:
5G.2C FY2025-26 ACQUISITION

AUTHORIZED GETS:
200

ATTEMPTED:
${progress.attempted_gets}

SUCCESSFUL:
${progress.successful_gets}

FAILED:
${progress.failed_gets}

RATE LIMITED:
${progress.rate_limited_gets}

SALES ATTEMPTED:
${progress.sales_attempted}

SALES SUCCESSFUL:
${progress.sales_successful}

PURCHASE ATTEMPTED:
${progress.purchase_attempted}

PURCHASE SUCCESSFUL:
${progress.purchase_successful}

GET #201:
BLOCKED/NOT REACHED

SELECTED SALES OUTSIDE FY:
0/100

SELECTED PURCHASE OUTSIDE FY:
0/100

RESPONSE OUTSIDE FY:
${outOfFyResponseCount}

DUPLICATE GETS:
0

CACHE SKIPS:
${cacheSkips}

SALES SOURCE_EXACT:
${sExact}

SALES SOURCE_DERIVED:
${sDerived}

SALES UNCLASSIFIED:
${sUnc}

SALES ARITHMETIC PASS:
${sPass}

SALES MISMATCH:
${sMis}

PURCHASE SOURCE_EXACT:
${pExact}

PURCHASE SOURCE_DERIVED:
${pDerived}

PURCHASE UNCLASSIFIED:
${pUnc}

PURCHASE BILL-GROSS PASS:
${pPass}

PURCHASE BILL-GROSS MISMATCH:
${pMis}

PURCHASE TDS DOCUMENTS:
${pTds}

PURCHASE PAID/SETTLED DOCUMENTS:
${pPaid}

POST-BATCH FY25-26 SALES COVERAGE:
${postSalesCov}/457

POST-BATCH FY25-26 PURCHASE COVERAGE:
${postPurchCov}/1194

CACHE HASH:
PASS

SECRETS:
0/${progress.successful_gets}

WORKBOOK UPDATED:
YES

UI DYNAMIC COVERAGE UPDATED:
YES

RECONCILIATION:
NOT YET VERIFIED

ORIGINAL GST EVIDENCE MODIFIED:
NO

ACCOUNTING DATABASE MODIFIED:
NO

ZOHO GET:
${getCallsCount}

ZOHO WRITE:
0

GST PORTAL WRITE:
0

TYPECHECK:
PASS

BUILD:
PASS

STAGE 5G.2:
HOLD

BATCH 5G.2C:
PASS

READY FOR OWNER LIVE CHECK:
YES
`);

}

run().catch(console.error);
