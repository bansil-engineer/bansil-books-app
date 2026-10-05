import sys
import pdfplumber
import json
import glob
import re

def parse_float(val, context=""):
    if val is None: return None
    original_val = str(val)
    val = original_val.strip()
    if val == '': return None
    if val == '-': return 0.0
    
    val_clean = re.sub(r'\s+', '', val)
    val_clean = val_clean.replace(',', '').replace('₹', '')
    
    if "notavailable" in val_clean.lower() or "na" == val_clean.lower():
        sys.stderr.write(json.dumps({"diagnostic": "Unparseable non-empty cell", "raw_cell": original_val, "context": context}) + "\n")
        return None
        
    m = re.search(r'\(?(-?\d+\.?\d*)\)?', val_clean)
    if m:
        num_str = m.group(1)
        try:
            res = float(num_str)
            if '(' in val_clean and ')' in val_clean:
                res = -abs(res)
            return res
        except:
            pass
            
    sys.stderr.write(json.dumps({"diagnostic": "Unparseable non-empty cell", "raw_cell": original_val, "context": context}) + "\n")
    return None

def test_parser():
    cases = {
        "9201.00": 9201.00,
        "F\n9201.00": 9201.00,
        "₹9,201.00": 9201.00,
        "9,201.00\nF": 9201.00,
        "0.00": 0.00,
        "": None,
        "Not available": None
    }
    
    failed = False
    for k, expected in cases.items():
        res = parse_float(k, context="test")
        if res != expected:
            print(f"FAIL: '{k}' -> {res} (Expected: {expected})")
            failed = True
    if failed:
        sys.exit(1)

def add_val(current, new):
    if current is None and new is None:
        return None
    return (current or 0.0) + (new or 0.0)

def extract_table_61(pdf_path):
    out = {
        'itc_igst_igst': None, 'itc_igst_cgst': None, 'itc_igst_sgst': None, 'itc_igst_cess': None,
        'itc_cgst_igst': None, 'itc_cgst_cgst': None, 'itc_cgst_sgst': None, 'itc_cgst_cess': None,
        'itc_sgst_igst': None, 'itc_sgst_cgst': None, 'itc_sgst_sgst': None, 'itc_sgst_cess': None,
        'itc_cess_igst': None, 'itc_cess_cgst': None, 'itc_cess_sgst': None, 'itc_cess_cess': None,
        'cash_igst': None, 'cash_cgst': None, 'cash_sgst': None, 'cash_cess': None,
        'rcm_cash_igst': None, 'rcm_cash_cgst': None, 'rcm_cash_sgst': None, 'rcm_cash_cess': None,
        'int_paid': None, 'late_paid': None,
        'table61_liab_igst': None, 'table61_liab_cgst': None, 'table61_liab_sgst': None, 'table61_liab_cess': None,
        'table61_rcm_liab_igst': None, 'table61_rcm_liab_cgst': None, 'table61_rcm_liab_sgst': None, 'table61_rcm_liab_cess': None,
        'net_itc_igst': None, 'net_itc_cgst': None, 'net_itc_sgst': None, 'net_itc_cess': None
    }

    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                text = page.extract_text()
                if text and "6.1 Payment of tax" in text:
                    tables = page.extract_tables()
                    for t_idx, t in enumerate(tables):
                        current_section = None
                        cash_idx = None
                        int_idx = None
                        late_idx = None
                        itc_igst_idx = None
                        itc_cgst_idx = None
                        itc_sgst_idx = None
                        itc_cess_idx = None
                        liab_idx = None
                        
                        for r_idx, row in enumerate(t):
                            if not row: continue
                            
                            row_str = " ".join([str(c) for c in row if c])
                            
                            # Identify header columns
                            if "in cash" in row_str and cash_idx is None:
                                for i, c in enumerate(row):
                                    if c and "in cash" in c and "Tax" in c: cash_idx = i
                                    elif c and "in cash" in c and "Interest" in c: int_idx = i
                                    elif c and "in cash" in c and "Late" in c: late_idx = i
                                if cash_idx is None:
                                    for i, c in enumerate(row):
                                        if c and "Tax paid" in c and "in cash" not in c: cash_idx = i
                            
                            if "Integrated" in row_str and itc_igst_idx is None:
                                for i, c in enumerate(row):
                                    if c and "Integrated" in c: itc_igst_idx = i
                                    elif c and "Central" in c: itc_cgst_idx = i
                                    elif c and "State" in c: itc_sgst_idx = i
                                    elif c and "Cess" in c: itc_cess_idx = i
                                    
                            if "payable" in row_str and liab_idx is None:
                                for i, c in enumerate(row):
                                    if c and "payable" in c: liab_idx = i
                            
                            if row[0] == '(A) Other than reverse charge':
                                current_section = 'other'
                            elif row[0] == '(B) Reverse charge and supplies made u/s 9(5)' or row[0] == '(B) Reverse charge':
                                current_section = 'rcm'
                                
                            if current_section and row[0] and ('Integrated' in row[0] or 'Central' in row[0] or 'State' in row[0] or 'Cess' in row[0]):
                                head = None
                                if 'Integrated' in row[0]: head = 'igst'
                                elif 'Central' in row[0]: head = 'cgst'
                                elif 'State' in row[0]: head = 'sgst'
                                elif 'Cess' in row[0]: head = 'cess'
                                
                                def get_val(idx, default_idx):
                                    if idx is not None and idx < len(row): return row[idx]
                                    if default_idx < len(row): return row[default_idx]
                                    return ""
                                
                                c_ctx = {"file": pdf_path, "page": page_num+1, "table": t_idx, "row": r_idx, "col_hint": "cash"}
                                csh = parse_float(get_val(cash_idx, -3), context=c_ctx)
                                
                                if current_section == 'other':
                                    if csh is not None: out[f'cash_{head}'] = csh
                                    
                                    i_ctx = {"file": pdf_path, "page": page_num+1, "table": t_idx, "row": r_idx, "col_hint": "int"}
                                    out['int_paid'] = add_val(out['int_paid'], parse_float(get_val(int_idx, -2), context=i_ctx))
                                    
                                    l_ctx = {"file": pdf_path, "page": page_num+1, "table": t_idx, "row": r_idx, "col_hint": "late"}
                                    out['late_paid'] = add_val(out['late_paid'], parse_float(get_val(late_idx, -1), context=l_ctx))
                                    
                                    def set_itc(idx, dst):
                                        if idx is not None and idx < len(row):
                                            ctx = {"file": pdf_path, "page": page_num+1, "table": t_idx, "row": r_idx, "col_hint": dst}
                                            v = parse_float(row[idx], context=ctx)
                                            if v is not None: out[dst] = v
                                            
                                    set_itc(itc_igst_idx, f'itc_{head}_igst')
                                    set_itc(itc_cgst_idx, f'itc_{head}_cgst')
                                    set_itc(itc_sgst_idx, f'itc_{head}_sgst')
                                    set_itc(itc_cess_idx, f'itc_{head}_cess')
                                        
                                    if liab_idx is not None and liab_idx < len(row):
                                        ctx = {"file": pdf_path, "page": page_num+1, "table": t_idx, "row": r_idx, "col_hint": "table61_liab"}
                                        v = parse_float(row[liab_idx], context=ctx)
                                        if v is not None: out[f'table61_liab_{head}'] = v
                                        
                                elif current_section == 'rcm':
                                    if csh is not None: out[f'rcm_cash_{head}'] = csh
                                    if liab_idx is not None and liab_idx < len(row):
                                        ctx = {"file": pdf_path, "page": page_num+1, "table": t_idx, "row": r_idx, "col_hint": "table61_rcm_liab"}
                                        v = parse_float(row[liab_idx], context=ctx)
                                        if v is not None: out[f'table61_rcm_liab_{head}'] = v

                if text and "4. Eligible ITC" in text:
                    tables = page.extract_tables()
                    for t_idx, t in enumerate(tables):
                        for r_idx, row in enumerate(t):
                            if not row: continue
                            row_str = " ".join([str(c) for c in row if c])
                            if "(C) Net ITC Available (A - B)" in row_str or "(C) Net ITC Available" in row_str:
                                def set_net(idx, dst):
                                    if idx < len(row):
                                        ctx = {"file": pdf_path, "page": page_num+1, "table": t_idx, "row": r_idx, "col_hint": dst}
                                        v = parse_float(row[idx], context=ctx)
                                        if v is not None: out[dst] = v
                                set_net(1, 'net_itc_igst')
                                set_net(2, 'net_itc_cgst')
                                set_net(3, 'net_itc_sgst')
                                set_net(4, 'net_itc_cess')

    except Exception as e:
        sys.stderr.write(f"Failed to process {pdf_path}: {e}\n")
    return out

if __name__ == '__main__':
    test_parser()
    if len(sys.argv) > 1:
        month = sys.argv[1]
        pdfs = glob.glob(f"/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/08_GST_&_TDS_Returns/GST_RETURN/{month}/*3B*.pdf")
        if pdfs:
            print(json.dumps(extract_table_61(pdfs[0])))
        else:
            print("{}")
