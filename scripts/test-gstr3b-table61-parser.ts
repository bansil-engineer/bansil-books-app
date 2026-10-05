import { execSync } from 'child_process';

const PARSER_PATH = 'scripts/gstr3b-table61-parser.py';

function testMonth(monthName: string, expectedIgst: number, expectedCgst: number, expectedSgst: number, expectedCess: number) {
    const cmd = `node --experimental-strip-types -e "
        const { execSync } = require('child_process');
        const out = execSync('.venv/bin/python ${PARSER_PATH} \\"${monthName}\\"', {encoding: 'utf-8'});
        console.log(out);
    "`;
    try {
        const out = execSync(`.venv/bin/python ${PARSER_PATH} "${monthName}"`, {encoding: 'utf-8'});
        const res = JSON.parse(out.trim());
        
        const totalIgst = res['cash_igst'] + res['rcm_cash_igst'];
        const totalCgst = res['cash_cgst'] + res['rcm_cash_cgst'];
        const totalSgst = res['cash_sgst'] + res['rcm_cash_sgst'];
        const totalCess = res['cash_cess'] + res['rcm_cash_cess'];

        if (totalIgst !== expectedIgst || totalCgst !== expectedCgst || totalSgst !== expectedSgst || totalCess !== expectedCess) {
            console.error(`FAIL: ${monthName}`);
            console.error(`Expected: IGST=${expectedIgst}, CGST=${expectedCgst}, SGST=${expectedSgst}, Cess=${expectedCess}`);
            console.error(`Got: IGST=${totalIgst}, CGST=${totalCgst}, SGST=${totalSgst}, Cess=${totalCess}`);
            process.exit(1);
        } else {
            console.log(`PASS: ${monthName}`);
        }
    } catch (e: any) {
        console.error(`Error parsing ${monthName}: ${e.message}`);
        process.exit(1);
    }
}

function testFYTotal(expectedIgst: number, expectedCgst: number, expectedSgst: number, expectedCess: number) {
    const months = ["04 2025", "05 2025", "06 2025", "07 2025", "08 2025", "09 2025", "10 2025", "11 2025", "12 2025", "01 2026", "02 2026", "03 2026"];
    let igst = 0, cgst = 0, sgst = 0, cess = 0;
    
    for (const m of months) {
        const out = execSync(`.venv/bin/python ${PARSER_PATH} "${m}"`, {encoding: 'utf-8'});
        const res = JSON.parse(out.trim());
        igst += res['cash_igst'] + res['rcm_cash_igst'];
        cgst += res['cash_cgst'] + res['rcm_cash_cgst'];
        sgst += res['cash_sgst'] + res['rcm_cash_sgst'];
        cess += res['cash_cess'] + res['rcm_cash_cess'];
    }

    if (igst !== expectedIgst || cgst !== expectedCgst || sgst !== expectedSgst || cess !== expectedCess) {
        console.error(`FAIL: FY TOTAL`);
        console.error(`Expected: IGST=${expectedIgst}, CGST=${expectedCgst}, SGST=${expectedSgst}, Cess=${expectedCess}`);
        console.error(`Got: IGST=${igst}, CGST=${cgst}, SGST=${sgst}, Cess=${cess}`);
        process.exit(1);
    } else {
        console.log(`PASS: FY TOTAL`);
    }
}

console.log("Running GSTR-3B Table 6.1 Parser Regression...");
testMonth("04 2025", 0, 29004, 29652, 0);
testMonth("07 2025", 0, 37355, 46660, 0);
testMonth("08 2025", 0, 644595, 644597, 0);
testMonth("03 2026", 11859, 68676, 68676, 0);

testFYTotal(543180, 2503337, 4022188, 0);

console.log("ALL REGRESSIONS PASSED.");
