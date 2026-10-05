import fitz
import re

pdf_path = "/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/05_Banking_&_Loan_Statements/FY26_HDFC_Current_Account/Acct_Statement_XXXXXXXX7642_13092026.pdf"
doc = fitz.open(pdf_path)

date_regex = re.compile(r'^\d{2}/\d{2}/\d{2}$')

def is_footer_marker(text):
    t = text.lower()
    return "page" == t or "summary" == t or "generated" == t or "earmarked" == t or "gstin" == t or "gstn" == t or "gstn:" in t

stmt_transactions = []
invalid_transactions = []
raw_candidate_count = 0

for page_idx, page in enumerate(doc):
    words = page.get_text("words")
    # sort by y, then x
    words.sort(key=lambda w: (round(w[1] / 3), w[0]))
    
    # 1. find bottom_y (footer start)
    bottom_y = 9999
    for w in words:
        x0, y0, x1, y1, text, _, _, _ = w
        # Only look for footers in the bottom half of the page
        if y0 > 400 and is_footer_marker(text):
            bottom_y = min(bottom_y, y0)
            
    # 2. Extract dates to form block boundaries
    dates = []
    for w in words:
        x0, y0, x1, y1, text, _, _, _ = w
        if date_regex.match(text) and x0 < 60 and y1 <= bottom_y:
            dates.append((text, y0, y1))
            
    filtered_dates = []
    for d in dates:
        if not filtered_dates or abs(filtered_dates[-1][1] - d[1]) > 5:
            filtered_dates.append(d)
            
    # 3. Build transactions by block
    for i, (date_text, d_y0, d_y1) in enumerate(filtered_dates):
        raw_candidate_count += 1
        block_top = d_y0 - 5 
        block_bottom = filtered_dates[i+1][1] - 5 if i + 1 < len(filtered_dates) else bottom_y
        
        tx = {
            "id": f"stmt_{raw_candidate_count}",
            "date": date_text,
            "narration_parts": [],
            "amount": 0.0,
            "direction": "",
            "balance": 0.0,
            "page": page_idx + 1,
            "raw_amounts": [] # to debug
        }
        
        for w in words:
            x0, y0, x1, y1, text, _, _, _ = w
            if y0 >= block_top and y1 <= block_bottom:
                if 60 <= x0 < 380:
                    tx["narration_parts"].append(text)
                elif 380 <= x0 < 450:
                    try:
                        val = float(text.replace(',', '').strip())
                        if val > 0:
                            tx["raw_amounts"].append(val)
                            tx["amount"] = val
                            tx["direction"] = "DEBIT"
                    except: pass
                elif 450 <= x0 < 510:
                    try:
                        val = float(text.replace(',', '').strip())
                        if val > 0:
                            tx["raw_amounts"].append(val)
                            tx["amount"] = val
                            tx["direction"] = "CREDIT"
                    except: pass
                elif x0 >= 510:
                    try:
                        val = float(text.replace(',', '').strip())
                        if val > 0 and tx["balance"] == 0.0:
                            tx["balance"] = val
                    except: pass
        stmt_transactions.append(tx)

print(f"Pages processed: {doc.page_count}")
print(f"Raw candidates: {raw_candidate_count}")
print(f"Parsed transactions: {len(stmt_transactions)}")

rows_checked = 0
rows_pass = 0
rows_fail = 0
max_diff = 0.0

if stmt_transactions:
    t = stmt_transactions[0]
    expected_opening = t["balance"] - (t["amount"] if t["direction"] == "CREDIT" else -t["amount"])
    prev_balance = round(expected_opening, 2)
    print(f"Derived Opening Balance: {prev_balance}")

for t in stmt_transactions:
    if t["balance"] != 0.0:
        rows_checked += 1
        expected = prev_balance + (t["amount"] if t["direction"] == "CREDIT" else -t["amount"])
        expected = round(expected, 2)
        actual = round(t["balance"], 2)
        diff = abs(expected - actual)
        
        if diff <= 0.02:
            rows_pass += 1
        else:
            rows_fail += 1
            max_diff = max(max_diff, diff)
            invalid_transactions.append(t)
        prev_balance = actual

print(f"ROWS CHECKED: {rows_checked}")
print(f"ROWS PASS: {rows_pass}")
print(f"ROWS FAIL: {rows_fail}")
print(f"MAX DIFFERENCE: {max_diff}")

if rows_fail > 0:
    print("FAILED ROWS:")
    for inv in invalid_transactions:
        print(f"Page {inv['page']} | Date {inv['date']} | Narration: {' '.join(inv['narration_parts'][:5])}... | WD: {inv['amount'] if inv['direction']=='DEBIT' else 0} | DEP: {inv['amount'] if inv['direction']=='CREDIT' else 0} | BAL: {inv['balance']} | RAW: {inv['raw_amounts']}")
