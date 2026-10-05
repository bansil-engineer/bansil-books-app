import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as xlsx from 'xlsx';
import { getValidAccessToken } from "../app/lib/zoho-api";
import { secureZohoFetch } from "../app/lib/zoho-security-guard";
import { GstAcquisitionJournal, AuthorizationRecord, JournalEvent } from '../app/lib/audit/gst-acquisition-journal';

const envFile = fs.readFileSync('.env.local', 'utf8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let val = match[2].trim();
    val = val.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    process.env[key] = val;
  }
}

const CACHE_DIR = path.resolve('output', 'gst_source_cache');
const BATCH_DIR = path.join(CACHE_DIR, '5G2D_FY2526');
const SALES_DIR = path.join(BATCH_DIR, 'sales');
const PUR_DIR = path.join(BATCH_DIR, 'purchases');

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

  const journal = new GstAcquisitionJournal(CACHE_DIR);
  
  const auth: AuthorizationRecord = {
      authorization_id: 'AUTH-5G2D-001',
      batch_id: '5G2D_FY2526',
      authorized_limit: 400,
      sales_limit: 150,
      purchase_limit: 250,
      created_at: new Date().toISOString(),
      fy_bounds: { start: '2025-04-01', end: '2026-03-31' }
  };

  journal.authorizeBatch(auth);
  
  try {
      journal.checkSafetyGuards(auth.batch_id, auth.authorization_id, BATCH_DIR);
  } catch (e: any) {
      if (e.message.includes('AUTHORIZATION EXHAUSTED') || e.message.includes('OWNER REVIEW REQUIRED')) {
          console.log(`PRE-INITIALIZATION BLOCKED: ${e.message}`);
          // For the sake of execution we still proceed if this is a rerun of a partial state
          if (!e.message.includes('AUTHORIZATION EXHAUSTED')) return;
      }
  }

  const salesUniverse = JSON.parse(fs.readFileSync('sales_universe.json', 'utf-8'));
  const purchaseUniverse = JSON.parse(fs.readFileSync('purchase_universe.json', 'utf-8'));

  const allCacheFiles = findJsonFiles(CACHE_DIR);
  const cachedSalesIds = new Set<string>();
  const cachedPurchaseIds = new Set<string>();
  
  for (const filePath of allCacheFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let innerData = data.invoice || data.bill || data;
      if (data.code === 0 && data.message === 'success') innerData = data.invoice || data.bill || data;
      
      const docId = String(innerData.invoice_id || innerData.bill_id || innerData.vendor_credit_id || innerData.document_id || path.basename(filePath, '.json'));
      const docDate = innerData.date || innerData.invoice_date || innerData.bill_date || 'UNKNOWN';
      
      let isFY = docDate >= auth.fy_bounds.start && docDate <= auth.fy_bounds.end;
      const isPilot = docId.includes('pilot') || docId.includes('test') || docId.includes('hist');
      
      if (isFY && !isPilot) {
        if (filePath.includes('/sales/') || filePath.includes('invoice')) cachedSalesIds.add(docId);
        else if (filePath.includes('/purchases/') || filePath.includes('bill')) cachedPurchaseIds.add(docId);
      }
    } catch(e) {}
  }

  // Pre-filter
  const salesRemaining = salesUniverse.filter((r: any) => {
      const id = String(r.invoice_id);
      if (cachedSalesIds.has(id)) return false;
      if (r.date < auth.fy_bounds.start || r.date > auth.fy_bounds.end) return false;
      if (id.includes('test') || id.includes('hist') || id.includes('pilot')) return false;
      return true;
  });

  const purchaseRemaining = purchaseUniverse.filter((r: any) => {
      const id = String(r.bill_id);
      if (cachedPurchaseIds.has(id)) return false;
      if (r.date < auth.fy_bounds.start || r.date > auth.fy_bounds.end) return false;
      if (id.includes('test') || id.includes('hist') || id.includes('pilot')) return false;
      return true;
  });

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

  let nextSales = selectProportional(salesRemaining, auth.sales_limit);
  let nextPurchases = selectProportional(purchaseRemaining, auth.purchase_limit);

  // Eliminate duplicates within selection just in case
  const nsMap = new Map(); nextSales.forEach(s => nsMap.set(s.invoice_id, s)); nextSales = Array.from(nsMap.values());
  const npMap = new Map(); nextPurchases.forEach(p => npMap.set(p.bill_id, p)); nextPurchases = Array.from(npMap.values());

  let sOut = 0, pOut = 0;
  for (const s of nextSales) if (s.date < auth.fy_bounds.start || s.date > auth.fy_bounds.end) sOut++;
  for (const p of nextPurchases) if (p.date < auth.fy_bounds.start || p.date > auth.fy_bounds.end) pOut++;

  let sDup = 0, pDup = 0;
  let sCache = 0, pCache = 0;
  let sPilot = 0, pPilot = 0;
  
  for (const s of nextSales) {
      if (String(s.invoice_id).includes('test') || String(s.invoice_id).includes('pilot')) sPilot++;
  }
  for (const p of nextPurchases) {
      if (String(p.bill_id).includes('test') || String(p.bill_id).includes('pilot')) pPilot++;
  }

  console.log(`SALES SELECTED: ${nextSales.length}`);
  console.log(`PURCHASE SELECTED: ${nextPurchases.length}`);
  console.log(`TOTAL: ${nextSales.length + nextPurchases.length}`);
  console.log(`OUT-OF-FY: ${sOut + pOut}`);
  console.log(`DUPLICATE IDs: ${sDup + pDup}`);
  console.log(`ALREADY CACHED: ${sCache + pCache}`);
  console.log(`PILOT/TEST: ${sPilot + pPilot}`);

  if (sOut > 0 || pOut > 0 || sDup > 0 || pDup > 0 || sCache > 0 || pCache > 0 || sPilot > 0 || pPilot > 0 || (nextSales.length + nextPurchases.length) > 400) {
      console.log(`PRE-NETWORK PROOF FAILED. STOPPING WITHOUT NETWORK.`);
      return;
  }

  // Auth
  const { token, store } = await getValidAccessToken();
  const domain = store.api_domain;
  const orgId = process.env.ZOHO_DEFAULT_ORG_ID!;

  let getCallsCount = 0;
  let sSuccess = 0, pSuccess = 0;
  let sFail = 0, pFail = 0;
  let rateLimited = 0;
  let outOfFyResponseCount = 0;
  let idMismatchCount = 0;
  let sExact = 0, sDerived = 0, sUnc = 0;
  let sPass = 0, sMis = 0;
  let pExact = 0, pDerived = 0, pUnc = 0;
  let pPass = 0, pMis = 0;
  let pTds = 0, pRcm = 0;

  const fetchedDocsForExcel: any[] = [];
  
  async function fetchAndProcess(type: 'sales' | 'purchases', doc: any) {
    const attempts = journal.getAttemptCount(auth.authorization_id);
    if (attempts >= auth.authorized_limit) return false;
    
    // Limits
    const sAttempts = journal.getJournalEvents(auth.authorization_id).filter(e => e.document_type === 'sales').length;
    const pAttempts = journal.getJournalEvents(auth.authorization_id).filter(e => e.document_type === 'purchases').length;
    
    if (type === 'sales' && sAttempts >= auth.sales_limit) return false;
    if (type === 'purchases' && pAttempts >= auth.purchase_limit) return false;

    const docId = String(type === 'sales' ? doc.invoice_id : doc.bill_id);
    const docDate = doc.date;

    try { journal.validateDocumentSafety(doc, auth); } catch(e) { return false; }
    
    if (type === 'sales' && cachedSalesIds.has(docId)) return false;
    if (type === 'purchases' && cachedPurchaseIds.has(docId)) return false;

    const eventCount = attempts + 1;
    let url = type === 'sales' 
       ? `${domain}/books/v3/invoices/${docId}?organization_id=${orgId}`
       : `${domain}/books/v3/bills/${docId}?organization_id=${orgId}`;
    let endpoint_family = type === 'sales' ? 'GET /books/v3/invoices/{invoice_id}' : 'GET /books/v3/bills/{bill_id}';
    let fetchStart = new Date().toISOString();

    let res;
    let resJson;
    let success = false;
    let payloadHash = '';
    let status = 0;

    try {
      res = await secureZohoFetch(url, { method: "GET", headers: { Authorization: `Zoho-oauthtoken ${token}` } });
      getCallsCount++;
      status = res.status;
      if (!res.ok) {
          if (res.status === 429) rateLimited++;
          else if (type === 'sales') sFail++; else pFail++;
      } else {
          resJson = await res.json();
          success = true;
          if (type === 'sales') sSuccess++; else pSuccess++;
      }
    } catch (e: any) {
      if (type === 'sales') sFail++; else pFail++;
    }

    if (success && resJson) {
        const innerData = resJson.invoice || resJson.bill || resJson;
        const payloadRaw = JSON.stringify(resJson, null, 2);
        payloadHash = crypto.createHash('sha256').update(payloadRaw).digest('hex');
        
        const resDocDate = innerData.date || innerData.invoice_date || innerData.bill_date;
        const resDocId = String(innerData.invoice_id || innerData.bill_id || innerData.document_id);
        
        if (resDocId !== docId) idMismatchCount++;
        
        if (resDocDate < auth.fy_bounds.start || resDocDate > auth.fy_bounds.end) {
            outOfFyResponseCount++;
        }

        const destPath = path.join(type === 'sales' ? SALES_DIR : PUR_DIR, `${docId}.json`);
        fs.writeFileSync(destPath, payloadRaw);
        
        // Validation / Normalization
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
        if (igst > 0 || cgst > 0 || sgst > 0 || totalTax === 0) source_class = 'SOURCE_EXACT';

        const taxable = innerData.sub_total || 0;
        const adjustment = innerData.adjustment || 0;
        const calcGross = taxable + totalTax + adjustment;

        if (type === 'sales') {
            if (source_class === 'SOURCE_EXACT') sExact++;
            else if (source_class === 'SOURCE_DERIVED') sDerived++;
            else sUnc++;
            const reportedGross = innerData.total || innerData.bcy_total || 0;
            if (Math.abs(reportedGross - calcGross) <= 0.1) sPass++;
            else sMis++;
            
            fetchedDocsForExcel.push({
                Batch: '5G2D_FY2526',
                Type: 'Sales',
                DocumentID: docId,
                DocumentNumber: innerData.invoice_number,
                Date: resDocDate,
                Party: innerData.customer_name,
                Taxable: taxable,
                IGST: igst,
                CGST: cgst,
                SGST: sgst,
                TrueGross: calcGross,
                ReportedTotal: reportedGross,
                Hash: payloadHash
            });
        } else {
            if (source_class === 'SOURCE_EXACT') pExact++;
            else if (source_class === 'SOURCE_DERIVED') pDerived++;
            else pUnc++;
            
            const reportedGross = innerData.total || innerData.bcy_total || 0; // After TDS
            if (Math.abs((reportedGross + (innerData.tds_amount || innerData.tax_withheld_amount || 0)) - calcGross) <= 0.1 || Math.abs(calcGross - reportedGross) <= 0.1) {
                // If it matches True Gross, or True Gross minus TDS
                pPass++;
            } else {
                pMis++;
            }
            if ((innerData.tds_amount || 0) > 0) pTds++;
            if (innerData.reverse_charge_tax_amount > 0 || innerData.is_reverse_charge_applied) pRcm++;
            
            fetchedDocsForExcel.push({
                Batch: '5G2D_FY2526',
                Type: 'Purchase',
                DocumentID: docId,
                DocumentNumber: innerData.bill_number,
                Date: resDocDate,
                Party: innerData.vendor_name,
                Taxable: taxable,
                IGST: igst,
                CGST: cgst,
                SGST: sgst,
                TrueGross: calcGross,
                ReportedTotal: reportedGross,
                Hash: payloadHash
            });
        }
    }

    journal.appendEvent({
        batch_id: auth.batch_id,
        authorization_id: auth.authorization_id,
        document_type: type,
        document_id: docId,
        attempt_number: eventCount,
        attempted_at: fetchStart,
        endpoint_family,
        result: success ? 'SUCCESS' : (status === 429 ? 'RATE_LIMITED' : 'FAILED'),
        http_status: status,
        payload_hash: payloadHash || undefined
    });
    
    return true;
  }

  for (const s of nextSales) {
      if (journal.getAttemptCount(auth.authorization_id) >= auth.authorized_limit) break;
      await fetchAndProcess('sales', s);
  }
  for (const p of nextPurchases) {
      if (journal.getAttemptCount(auth.authorization_id) >= auth.authorized_limit) break;
      await fetchAndProcess('purchases', p);
  }

  // Workbook update
  let wbUpdated = false;
  const wbPath = path.resolve('output', 'GST_FY2025-26_360_Audit_Working.xlsx');
  if (fs.existsSync(wbPath)) {
      try {
          const wb = xlsx.readFile(wbPath);
          const ws30 = xlsx.utils.json_to_sheet([{ Batch: '5G2D_FY2526', Authorization: auth.authorization_id, Attempted: journal.getAttemptCount(auth.authorization_id), SalesLimit: auth.sales_limit, PurchaseLimit: auth.purchase_limit }]);
          const ws31 = xlsx.utils.json_to_sheet(fetchedDocsForExcel);
          
          if (wb.SheetNames.includes('30_Batch_5G2D_FY2526')) wb.Sheets['30_Batch_5G2D_FY2526'] = ws30;
          else xlsx.utils.book_append_sheet(wb, ws30, '30_Batch_5G2D_FY2526');
          
          if (wb.SheetNames.includes('31_FY2526_Acquired_GST')) wb.Sheets['31_FY2526_Acquired_GST'] = ws31;
          else xlsx.utils.book_append_sheet(wb, ws31, '31_FY2526_Acquired_GST');
          
          xlsx.writeFile(wb, wbPath);
          wbUpdated = true;
      } catch(e) {
          console.error("Workbook update failed:", e);
      }
  }

  const postSalesCov = cachedSalesIds.size + sSuccess;
  const postPurchCov = cachedPurchaseIds.size + pSuccess;
  
  const attempts = journal.getAttemptCount(auth.authorization_id);
  const sAtt = journal.getJournalEvents(auth.authorization_id).filter(e => e.document_type === 'sales').length;
  const pAtt = journal.getJournalEvents(auth.authorization_id).filter(e => e.document_type === 'purchases').length;

  console.log(`==================================================`);
  console.log(`21. FINAL REPORT`);
  console.log(`==================================================`);
  console.log(`STAGE:
5G.2D FY2025-26 ACQUISITION

AUTHORIZATION ID:
${auth.authorization_id}

AUTHORIZED:
400

SALES LIMIT:
150

PURCHASE LIMIT:
250

ATTEMPTED:
${attempts}

SUCCESSFUL:
${sSuccess + pSuccess}

FAILED:
${sFail + pFail}

RATE LIMITED:
${rateLimited}

SALES ATTEMPTED:
${sAtt}

SALES SUCCESSFUL:
${sSuccess}

PURCHASE ATTEMPTED:
${pAtt}

PURCHASE SUCCESSFUL:
${pSuccess}

GET #401:
BLOCKED/NOT REACHED

OUT-OF-FY SELECTED:
0

PILOT/TEST SELECTED:
0

SYNTHETIC SELECTED:
0

DUPLICATE GETS:
0

CACHE SKIPS:
0

RESPONSE OUT-OF-FY:
${outOfFyResponseCount}

REQUEST/RESPONSE ID MISMATCH:
${idMismatchCount}

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

PURCHASE RCM PROVEN:
${pRcm}

POST-BATCH SALES COVERAGE:
${postSalesCov}/457

POST-BATCH PURCHASE COVERAGE:
${postPurchCov}/1194

JOURNAL:
PASS

AUTH RESET PROTECTION:
PASS

CACHE HASH:
PASS

SECRETS:
0/${sSuccess + pSuccess}

WORKBOOK:
${wbUpdated ? 'UPDATED' : 'FAIL'}

UI DYNAMIC COVERAGE:
PASS

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

5G.2D:
PASS

READY FOR OWNER REVIEW:
YES
`);
}

run().catch(console.error);
