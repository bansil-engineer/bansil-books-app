import * as fs from 'fs';
import * as path from 'path';

const BATCH_DIR = path.resolve('output', 'gst_source_cache', '5G2C_FY2526');
const MANIFEST_PATH = path.join(BATCH_DIR, 'batch_manifest.json');
const PROGRESS_PATH = path.join(BATCH_DIR, 'batch_progress.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

console.log("== 1. INVESTIGATE FAILED GET ==");
const failed = manifest.find((m: any) => m.fetch_status !== 'SUCCESS');
if (failed) {
    console.log(`Failed Document: ${failed.document_id} (${failed.document_number})`);
    console.log(`Date: ${failed.document_date}`);
    console.log(`Status: ${failed.fetch_status}`);
    console.log(`Type: ${failed.document_type}`);
    // Check if partial exists
    const pPath = path.join(BATCH_DIR, failed.document_type, `${failed.document_id}.json`);
    console.log(`Cache exists: ${fs.existsSync(pPath)}`);
}

console.log("\n== 2 & 3 & 4 & 5. MISMATCH ANALYSIS ==");
const mismatches = [];
const corrected = [];
let parserTds = 0, sourceDev = 0;

for (const m of manifest) {
    if (m.document_type !== 'purchases' || m.fetch_status !== 'SUCCESS') continue;
    const fPath = path.join(BATCH_DIR, 'purchases', `${m.document_id}.json`);
    if (!fs.existsSync(fPath)) continue;
    
    const data = JSON.parse(fs.readFileSync(fPath, 'utf8'));
    const bill = data.bill || data;
    
    const taxable = bill.sub_total || 0;
    const adjustment = bill.adjustment || 0;
    const taxes = bill.taxes || [];
    let totalTax = 0;
    for (const t of taxes) totalTax += t.tax_amount;
    
    const grossCalc = taxable + totalTax + adjustment;
    const grossReported = bill.total || bill.bcy_total || 0;
    const tds = bill.tds_amount || bill.tax_withheld_amount || 0;
    const paid = bill.payment_made || 0;
    const balance = bill.balance || 0;
    
    if (Math.abs(grossReported - grossCalc) > 0.1) {
        // Original logic was mismatching here? Wait, original script was:
        // const calc = taxable + totalTax + adjustment;
        // if (Math.abs(gross - calc) > 0.1) mismatch...
        
        const vendorName = bill.vendor_name;
        mismatches.push({
            id: m.document_id,
            num: m.document_number,
            date: m.document_date,
            vendor: vendorName,
            taxable, totalTax, adjustment,
            calc: grossCalc,
            reported: grossReported,
            tds, paid, balance
        });
    }
}

console.log(`Found ${mismatches.length} original mismatches.`);
for (const mis of mismatches) {
    console.log(`\nBill ID: ${mis.id} (${mis.num}) [${mis.date}] ${mis.vendor}`);
    console.log(`  Taxable: ${mis.taxable}, Tax: ${mis.totalTax}, Adj: ${mis.adjustment} -> Calc: ${mis.calc}`);
    console.log(`  Reported Gross: ${mis.reported}, TDS: ${mis.tds}, Paid: ${mis.paid}, Bal: ${mis.balance}`);
    
    // Check if the original logic in phase-5g2c-acquisition.ts was doing what the user said:
    // Wait, the original logic WAS taxable + totalTax + adjustment.
    // If that didn't match `bill.total`, what WAS `bill.total`?
    // Let's print out what we see.
}

