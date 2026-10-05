import fitz
import re

pdf_path = "/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/05_Banking_&_Loan_Statements/FY26_HDFC_Current_Account/Acct_Statement_XXXXXXXX7642_13092026.pdf"
doc = fitz.open(pdf_path)
date_regex = re.compile(r'^\d{2}/\d{2}/\d{2}$')
stmt_transactions = []
current_tx = None

for page_idx, page in enumerate(doc):
    words = page.get_text("words")
    words.sort(key=lambda w: (round(w[1] / 3), w[0]))
    for w in words:
        x0, y0, x1, y1, text, _, _, _ = w
        if date_regex.match(text) and x0 < 60:
            if current_tx: stmt_transactions.append(current_tx)
            current_tx = {"date": text, "amount": 0.0, "dir": "", "bal": 0.0, "page": page_idx + 1, "tokens": []}
        elif current_tx:
            if 380 <= x0 < 450:
                try:
                    val = float(text.replace(',', '').strip())
                    if val > 0:
                        current_tx["amount"] = val; current_tx["dir"] = "DEBIT"; current_tx["tokens"].append((text, w))
                except: pass
            elif 450 <= x0 < 510:
                try:
                    val = float(text.replace(',', '').strip())
                    if val > 0:
                        current_tx["amount"] = val; current_tx["dir"] = "CREDIT"; current_tx["tokens"].append((text, w))
                except: pass
            elif x0 >= 510:
                try:
                    val = float(text.replace(',', '').strip())
                    if val > 0 and current_tx["bal"] == 0.0: current_tx["bal"] = val
                except: pass
if current_tx: stmt_transactions.append(current_tx)

prev_balance = 3693463.01
for i, t in enumerate(stmt_transactions):
    if t["bal"] != 0.0:
        expected = prev_balance + (t["amount"] if t["dir"] == "CREDIT" else -t["amount"])
        if abs(expected - t["bal"]) > 0.02:
            print(f"Page: {t['page']}")
            print(f"Date: {t['date']}")
            print(f"Parsed WD: {t['amount'] if t['dir']=='DEBIT' else 0.0}")
            print(f"Parsed DEP: {t['amount'] if t['dir']=='CREDIT' else 0.0}")
            print(f"Parsed Closing: {t['bal']}")
            print(f"Expected Amount (for continuity): {abs(t['bal'] - prev_balance):.2f}")
            print(f"Unexpected Tokens: {t['tokens']}")
            print("---")
        prev_balance = t["bal"]
