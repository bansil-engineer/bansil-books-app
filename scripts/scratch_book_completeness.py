import sqlite3
from collections import Counter
from datetime import datetime

db_path = "data/audit_workspace.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
c = conn.cursor()

# Get the exact account ID for HDFC XXXX7642
c.execute("SELECT account_id, account_name FROM audit_zoho_bank_accounts WHERE account_name LIKE '%HDFC%' OR account_name LIKE '%7642%'")
account = c.fetchone()
print(f"Account: {dict(account)}")
acc_id = account['account_id']

# 1. LOCAL SYNC COMPLETENESS
c.execute(f"""
    SELECT transaction_id, date, amount, debit_or_credit
    FROM audit_zoho_bank_transactions
    WHERE account_id = '{acc_id}'
      AND date >= '2025-04-01' AND date <= '2026-03-31'
""")
rows = c.fetchall()
print(f"Local Transaction Count: {len(rows)}")
dates = [r['date'] for r in rows]
if dates:
    print(f"Min Date: {min(dates)}")
    print(f"Max Date: {max(dates)}")
else:
    print("No local dates found.")

# Monthly counts
months = ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", 
          "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]
monthly_counts = {m: 0 for m in months}
for r in rows:
    ym = r['date'][:7]
    if ym in monthly_counts:
        monthly_counts[ym] += 1
print("Monthly Counts:")
for m in months:
    print(f"{m}: {monthly_counts[m]}")

# We will dump all Local IDs for later comparison
local_ids = {r['transaction_id'] for r in rows}

# Print the 5 ambiguous candidates from our pilot result JSON
import json
with open("data/bank_pilot_result.json") as f:
    results = json.load(f)

print("\n--- 5 AMBIGUOUS ROWS ---")
ambiguous_matches = [m for m in results["matches"] if m["status"] == "AMBIGUOUS"]

for am in ambiguous_matches:
    print(f"Ambiguous Book ID: {am['book_id']}, Date: {am['book_date']}, Amount: {am['book_amount']}, Dir: {am['direction']}")
    
    # Let's find competing candidates from the stmt_transactions from the PDF
    # We will need to re-parse or look at how they matched
    print("Masked narration:", am.get('stmt_narration', 'Multiple Candidates Found'))

