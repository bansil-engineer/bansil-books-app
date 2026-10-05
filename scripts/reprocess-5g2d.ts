import * as fs from 'fs';
import * as path from 'path';

const PUR_DIR = path.resolve('output', 'gst_source_cache', '5G2D_FY2526', 'purchases');
const files = fs.readdirSync(PUR_DIR).filter(f => f.endsWith('.json'));

let pPass = 0, pMis = 0, pUnc = 0;
let pTdsFailures = 0;

for (const file of files) {
    const raw = fs.readFileSync(path.join(PUR_DIR, file), 'utf8');
    const data = JSON.parse(raw);
    const innerData = data.bill || data;

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
    
    const taxable = innerData.sub_total || 0;
    const discount = innerData.discount_amount || 0;
    const shipping = innerData.shipping_charge || 0;
    const adjustment = innerData.adjustment || 0;
    
    const calcGross = taxable - discount + shipping + totalTax + adjustment;
    
    const reportedGross = innerData.total || innerData.bcy_total || 0;
    const tds = innerData.tds_amount || innerData.tax_withheld_amount || 0;
    
    // Check if TDS semantics break anything
    if (tds > 0) {
        const mismatchBecauseOfTDS = Math.abs(reportedGross - calcGross) > 0.1 && Math.abs((reportedGross + tds) - calcGross) > 0.1;
        if (mismatchBecauseOfTDS) {
            pTdsFailures++;
        }
    }

    const match1 = Math.abs((reportedGross + tds) - calcGross) <= 0.1;
    const match2 = Math.abs(calcGross - reportedGross) <= 0.1;
    
    if (match1 || match2) {
        pPass++;
    } else {
        pMis++;
    }
}

console.log(`AFTER OFFLINE CORRECTION:\nPASS: ${pPass}/250\nMISMATCH: ${pMis}\nNOT COMPUTABLE: ${pUnc}`);
console.log(`TDS SEMANTIC FAILURES: ${pTdsFailures}`);
