import fitz
import sys
import pandas as pd

pdf_path = "/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/05_Banking_&_Loan_Statements/FY26_HDFC_Current_Account/Acct_Statement_XXXXXXXX7642_13092026.pdf"

doc = fitz.open(pdf_path)

all_records = []
for page_num, page in enumerate(doc):
    tabs = page.find_tables()
    for tab in tabs:
        df = tab.to_pandas()
        for i in range(len(df)):
            cols = [str(df.iloc[i, j]).split('\n') for j in range(len(df.columns))]
            max_len = max(len(c) for c in cols)
            print(f"Page {page_num} Table {i} max_len: {max_len}")
            for r in range(min(5, max_len)):
                print([c[r] if r < len(c) else '' for c in cols])
        break # just first table per page
