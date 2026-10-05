import fitz
import sys

pdf_path = "/Users/balkrishnapjoshi/Library/CloudStorage/OneDrive-BansilEngineers/Accounts - Documents/FY 2025-26 Data/FY_2025-26_AY_2026-27/05_Banking_&_Loan_Statements/FY26_HDFC_Current_Account/Acct_Statement_XXXXXXXX7642_13092026.pdf"

try:
    doc = fitz.open(pdf_path)
    page = doc[0]
    tabs = page.find_tables()
    if tabs and tabs.tables:
        print("Table found!")
        df = tabs[0].to_pandas()
        print(df.head())
    else:
        print("No tables found by find_tables")
except Exception as e:
    print("Error:", e)
    sys.exit(1)
