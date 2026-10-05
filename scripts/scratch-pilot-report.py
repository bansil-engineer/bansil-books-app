import fitz
import re
from datetime import datetime
import json

pdf_path = "/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/05_Banking_&_Loan_Statements/FY26_HDFC_Current_Account/Acct_Statement_XXXXXXXX7642_13092026.pdf"

doc = fitz.open(pdf_path)

stmt_transactions = []
current_tx = None
date_regex = re.compile(r'^\d{2}/\d{2}/\d{2}$')

def parse_date(d_str):
    return datetime.strptime(d_str, "%d/%m/%y").strftime("%Y-%m-%d")

def clean_amount(val_str):
    return float(val_str.replace(',', '').strip())

raw_candidate_count = 0
fy_excluded_rows = 0

for page in doc:
    words = page.get_text("words")
    words.sort(key=lambda w: (round(w[1] / 3), w[0]))
    
    for w in words:
        x0, y0, x1, y1, text, _, _, _ = w
        if date_regex.match(text) and x0 < 60:
            if current_tx:
                stmt_transactions.append(current_tx)
            raw_candidate_count += 1
            current_tx = {
                "id": f"stmt_{raw_candidate_count}",
                "date": parse_date(text),
                "narration_parts": [],
                "amount": 0.0,
                "direction": "",
                "balance": 0.0
            }
        elif current_tx:
            if 60 <= x0 < 380:
                current_tx["narration_parts"].append(text)
            elif 380 <= x0 < 450:
                try:
                    val = clean_amount(text)
                    if val > 0:
                        current_tx["amount"] = val
                        current_tx["direction"] = "DEBIT"
                except: pass
            elif 450 <= x0 < 510:
                try:
                    val = clean_amount(text)
                    if val > 0:
                        current_tx["amount"] = val
                        current_tx["direction"] = "CREDIT"
                except: pass
            elif x0 >= 510:
                try:
                    val = clean_amount(text)
                    if val > 0:
                        if current_tx["balance"] == 0.0:
                            current_tx["balance"] = val
                except: pass

if current_tx:
    stmt_transactions.append(current_tx)

for t in stmt_transactions:
    t["narration"] = " ".join(t["narration_parts"])
    words_parts = t["narration_parts"]
    ref_candidates = [w for w in words_parts if len(w) > 10 and any(c.isdigit() for c in w) and any(c.isalpha() for c in w)]
    t["ref"] = ref_candidates[0] if ref_candidates else ""

# Balance Continuity Check
print("=== BALANCE CONTINUITY ===")
rows_checked = 0
rows_pass = 0
rows_fail = 0
max_diff = 0.0
failed_rows = []

prev_balance = 3693463.01 # From summary opening balance

for t in stmt_transactions:
    if t["balance"] != 0.0:
        rows_checked += 1
        expected = prev_balance + (t["amount"] if t["direction"] == "CREDIT" else -t["amount"])
        diff = abs(expected - t["balance"])
        if diff < 0.01:
            rows_pass += 1
        else:
            rows_fail += 1
            max_diff = max(max_diff, diff)
            failed_rows.append((t, prev_balance, expected, diff))
        prev_balance = t["balance"]

print(f"ROWS CHECKED: {rows_checked}")
print(f"ROWS PASS: {rows_pass}")
print(f"ROWS FAIL: {rows_fail}")
print(f"MAX DIFFERENCE: {max_diff}")
if failed_rows:
    for f in failed_rows:
        print("FAILED:", f)

print("\n=== TOP 3 ROWS ===")
for t in stmt_transactions[:3]:
    print(f"Date: {t['date']}, WD: {t['amount'] if t['direction']=='DEBIT' else 0}, DEP: {t['amount'] if t['direction']=='CREDIT' else 0}, BAL: {t['balance']}, NAR: {t['narration'][:50]}")

print("\n=== BOTTOM 3 ROWS ===")
for t in stmt_transactions[-3:]:
    print(f"Date: {t['date']}, WD: {t['amount'] if t['direction']=='DEBIT' else 0}, DEP: {t['amount'] if t['direction']=='CREDIT' else 0}, BAL: {t['balance']}, NAR: {t['narration'][:50]}")

print(f"\nraw_candidate_count: {raw_candidate_count}")
print(f"len(stmt_transactions): {len(stmt_transactions)}")
