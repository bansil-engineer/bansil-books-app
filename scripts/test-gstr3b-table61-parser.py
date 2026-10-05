import sys
import glob
import json
import importlib.util

# Load the parser module directly instead of starting new processes
spec = importlib.util.spec_from_file_location("gstr3b_parser", "scripts/gstr3b-table61-parser.py")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)

def parse_month(month):
    pdfs = glob.glob(f"/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/08_GST_&_TDS_Returns/GST_RETURN/{month}/*3B*.pdf")
    if not pdfs: return None
    return parser.extract_table_61(pdfs[0])

def test_month(res, month_name, expected_igst, expected_cgst, expected_sgst, expected_cess):
    total_igst = res['cash_igst'] + res['rcm_cash_igst']
    total_cgst = res['cash_cgst'] + res['rcm_cash_cgst']
    total_sgst = res['cash_sgst'] + res['rcm_cash_sgst']
    total_cess = res['cash_cess'] + res['rcm_cash_cess']

    if (total_igst != expected_igst or total_cgst != expected_cgst or 
        total_sgst != expected_sgst or total_cess != expected_cess):
        print(f"FAIL: {month_name}")
        print(f"Expected: IGST={expected_igst}, CGST={expected_cgst}, SGST={expected_sgst}, Cess={expected_cess}")
        print(f"Got: IGST={total_igst}, CGST={total_cgst}, SGST={total_sgst}, Cess={total_cess}")
        sys.exit(1)
    else:
        print(f"PASS: {month_name}")

if __name__ == '__main__':
    print("Running GSTR-3B Table 6.1 Parser Regression...")
    
    months = ["04 2025", "05 2025", "06 2025", "07 2025", "08 2025", "09 2025", 
              "10 2025", "11 2025", "12 2025", "01 2026", "02 2026", "03 2026"]
    
    results = {}
    for m in months:
        results[m] = parse_month(m)
        if not results[m]:
            print(f"Missing PDF for {m}")
            sys.exit(1)
            
    test_month(results["04 2025"], "04 2025", 0, 29004, 29652, 0)
    test_month(results["07 2025"], "07 2025", 0, 37355, 46660, 0)
    test_month(results["08 2025"], "08 2025", 0, 644595, 644597, 0)
    test_month(results["03 2026"], "03 2026", 11859, 68676, 68676, 0)
    
    igst, cgst, sgst, cess = 0, 0, 0, 0
    for m in months:
        res = results[m]
        igst += res['cash_igst'] + res['rcm_cash_igst']
        cgst += res['cash_cgst'] + res['rcm_cash_cgst']
        sgst += res['cash_sgst'] + res['rcm_cash_sgst']
        cess += res['cash_cess'] + res['rcm_cash_cess']

    if (igst != 543180 or cgst != 2503337 or sgst != 4022188 or cess != 0):
        print("FAIL: FY TOTAL")
        print(f"Expected: IGST=543180, CGST=2503337, SGST=4022188, Cess=0")
        print(f"Got: IGST={igst}, CGST={cgst}, SGST={sgst}, Cess={cess}")
        sys.exit(1)
    else:
        print("PASS: FY TOTAL")
        
    print("ALL REGRESSIONS PASSED.")
