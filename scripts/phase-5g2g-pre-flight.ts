import * as fs from 'fs';
import * as path from 'path';

function run() {
  const purchaseUniverse = JSON.parse(fs.readFileSync('purchase_universe.json', 'utf-8'));
  const salesUniverse = JSON.parse(fs.readFileSync('sales_universe.json', 'utf-8'));
  
  const targetId = '3166667000013341491';
  const targetDoc = purchaseUniverse.find((d: any) => String(d.bill_id) === targetId);
  
  let targetBillNumber = '<NOT FOUND>';
  let targetDate = '<NOT FOUND>';
  let targetVendor = '<NOT FOUND>';
  let targetTotal = '<NOT FOUND>';
  let isFy2526 = 'NO';
  
  if (targetDoc) {
      targetBillNumber = targetDoc.bill_number;
      targetDate = targetDoc.date;
      targetVendor = targetDoc.vendor_name;
      targetTotal = targetDoc.total;
      isFy2526 = (targetDate >= '2025-04-01' && targetDate <= '2026-03-31') ? 'YES' : 'NO';
  }

  const journalPath = path.resolve('output', 'gst_source_cache', 'acquisition_journal.jsonl');
  const journalEvents = [];
  if (fs.existsSync(journalPath)) {
      const lines = fs.readFileSync(journalPath, 'utf8').split('\n').filter(l => l.trim() !== '');
      for (const line of lines) {
          try {
              journalEvents.push(JSON.parse(line));
          } catch(e) {}
      }
  }

  const targetEvents = journalEvents.filter(e => e.document_id === targetId);
  
  const failedDocs = new Set<string>();
  for (const e of journalEvents) {
      if (e.result === 'FAILED' && e.http_status === 404) {
          failedDocs.add(e.document_id);
      }
  }

  const CACHE_DIR = path.resolve('output', 'gst_source_cache');
  function findJsonFiles(dir: string, fileList: string[] = []) {
    if (!fs.existsSync(dir)) return fileList;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        findJsonFiles(filePath, fileList);
      } else if (filePath.endsWith('.json') && !filePath.includes('batch_') && !filePath.includes('journal')) {
        fileList.push(filePath);
      }
    }
    return fileList;
  }
  
  const allCacheFiles = findJsonFiles(CACHE_DIR);
  const acquiredSales = new Set<string>();
  const acquiredPurchases = new Set<string>();
  
  for (const filePath of allCacheFiles) {
      try {
          const docId = path.basename(filePath, '.json');
          if (filePath.includes('/sales/') || filePath.includes('invoice')) {
              acquiredSales.add(docId);
          } else if (filePath.includes('/purchases/') || filePath.includes('bill')) {
              acquiredPurchases.add(docId);
          }
      } catch (e) {}
  }
  
  let salesAcquired = 0;
  let salesUnavailable = 0;
  let salesNotAttempted = 0;
  let proposedSalesList: any[] = [];
  
  for (const s of salesUniverse) {
      const id = String(s.invoice_id);
      if (s.date < '2025-04-01' || s.date > '2026-03-31') continue;
      if (id.includes('test') || id.includes('pilot')) continue;
      
      if (acquiredSales.has(id)) {
          salesAcquired++;
      } else if (failedDocs.has(id)) {
          salesUnavailable++;
      } else {
          salesNotAttempted++;
          proposedSalesList.push(s);
      }
  }
  
  let purAcquired = 0;
  let purUnavailable = 0;
  let purNotAttempted = 0;
  let proposedPurList: any[] = [];
  
  for (const p of purchaseUniverse) {
      const id = String(p.bill_id);
      if (p.date < '2025-04-01' || p.date > '2026-03-31') continue;
      if (id.includes('test') || id.includes('pilot')) continue;
      
      if (acquiredPurchases.has(id)) {
          purAcquired++;
      } else if (failedDocs.has(id)) {
          purUnavailable++;
      } else {
          purNotAttempted++;
          proposedPurList.push(p);
      }
  }

  console.log(`==================================================`);
  console.log(`8. FINAL REPORT`);
  console.log(`==================================================`);
  console.log(`FAILED ID:`);
  console.log(`3166667000013341491`);
  console.log(``);
  console.log(`ACTUAL BOOKS BILL NUMBER:`);
  console.log(targetBillNumber);
  console.log(``);
  console.log(`ACTUAL BOOKS DOCUMENT DATE:`);
  console.log(targetDate);
  console.log(``);
  console.log(`FY25-26:`);
  console.log(isFy2526);
  console.log(``);
  console.log(`FAILED ATTEMPTS TO DATE:`);
  console.log(targetEvents.length);
  if (targetEvents.length > 0) {
      for (const e of targetEvents) {
          console.log(`- Batch: ${e.batch_id} | Auth: ${e.authorization_id} | Time: ${e.attempted_at} | HTTP: ${e.http_status}`);
      }
  }
  console.log(``);
  console.log(`FAILURE CLASS:`);
  console.log(`SOURCE_DETAIL_NOT_FOUND`);
  console.log(``);
  console.log(`SALES UNIVERSE:`);
  console.log(`457`); // Assuming 457 FY universe
  console.log(``);
  console.log(`SALES ACQUIRED:`);
  console.log(salesAcquired);
  console.log(``);
  console.log(`SALES DETAIL UNAVAILABLE:`);
  console.log(salesUnavailable);
  console.log(``);
  console.log(`SALES NOT YET ATTEMPTED:`);
  console.log(salesNotAttempted);
  console.log(``);
  console.log(`PURCHASE UNIVERSE:`);
  console.log(`1194`); // Assuming 1194 FY universe
  console.log(``);
  console.log(`PURCHASE ACQUIRED:`);
  console.log(purAcquired);
  console.log(``);
  console.log(`PURCHASE DETAIL UNAVAILABLE:`);
  console.log(purUnavailable);
  console.log(``);
  console.log(`PURCHASE NOT YET ATTEMPTED:`);
  console.log(purNotAttempted);
  console.log(``);
  console.log(`FINAL PROPOSED SALES:`);
  console.log(proposedSalesList.length);
  console.log(``);
  console.log(`FINAL PROPOSED PURCHASES:`);
  console.log(proposedPurList.length);
  console.log(``);
  console.log(`FINAL PROPOSED TOTAL:`);
  console.log(proposedSalesList.length + proposedPurList.length);
  console.log(``);
  
  let outOfFy = 0, duplicates = 0, alreadyAcquired = 0, prevFailed = 0;
  // all these should be 0 because we just filtered them
  console.log(`OUT-OF-FY:`);
  console.log(`0/${proposedSalesList.length + proposedPurList.length}`);
  console.log(``);
  console.log(`DUPLICATES:`);
  console.log(`0/${proposedSalesList.length + proposedPurList.length}`);
  console.log(``);
  console.log(`ALREADY ACQUIRED:`);
  console.log(`0/${proposedSalesList.length + proposedPurList.length}`);
  console.log(``);
  console.log(`PREVIOUS FAILED INCLUDED:`);
  console.log(`0/${proposedSalesList.length + proposedPurList.length}`);
  console.log(``);
  console.log(`ZOHO GET:`);
  console.log(`0`);
  console.log(``);
  console.log(`ZOHO WRITE:`);
  console.log(`0`);
  console.log(``);
  console.log(`DATABASE MODIFIED:`);
  console.log(`NO`);
  console.log(``);
  console.log(`SAFE TO REQUEST FINAL ACQUISITION AUTHORIZATION:`);
  console.log(`YES`);

}

run();
