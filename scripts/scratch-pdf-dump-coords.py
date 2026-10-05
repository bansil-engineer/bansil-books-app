import fitz
import sys

pdf_path = "/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/05_Banking_&_Loan_Statements/FY26_HDFC_Current_Account/Acct_Statement_XXXXXXXX7642_13092026.pdf"

doc = fitz.open(pdf_path)
page = doc[0]
blocks = page.get_text("dict")["blocks"]

for b in blocks:
    if "lines" not in b: continue
    for l in b["lines"]:
        for s in l["spans"]:
            text = s["text"].strip()
            if "9,409.00" in text or "100,000.00" in text or "3,702,872.01" in text:
                print(f"Text: {text}, x0: {s['bbox'][0]}")
