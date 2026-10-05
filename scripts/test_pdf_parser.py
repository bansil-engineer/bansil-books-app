import sys
import unittest
from types import SimpleNamespace

class MockPage:
    def __init__(self, words):
        self.words = words
    def get_text(self, kind):
        return self.words

class MockDoc:
    def __init__(self, pages):
        self.pages = pages
        self.page_count = len(pages)
    def __iter__(self):
        return iter(self.pages)

# Import the parser function we just created
import importlib.util
spec = importlib.util.spec_from_file_location("pilot", "scripts/pilot-bank-reconciliation.py")
pilot = importlib.util.module_from_spec(spec)
sys.modules["pilot"] = pilot
# We only want to load the function, not execute the whole script which opens a real DB.
# Let's extract just the function source and eval it to be safe from side effects of pilot-bank-reconciliation.py
with open("scripts/pilot-bank-reconciliation.py") as f:
    src = f.read()

import re
from datetime import datetime
func_src = src[src.find("def parse_hdfc_statement"):src.find("if __name__ ==")]
exec(func_src)

class TestPDFParser(unittest.TestCase):
    def test_footer_exclusion(self):
        # Date, narration, amount, and a footer number in the DEPOSIT x-range (450)
        # Footer text triggers exclusion
        words = [
            (30, 100, 50, 110, "01/04/25", 0,0,0),
            (70, 100, 150, 110, "Valid", 0,0,0),
            (400, 100, 430, 110, "500.0", 0,0,0), # Withdrawal
            (520, 100, 550, 110, "1000.0", 0,0,0), # Balance
            
            # Footer section
            (70, 450, 150, 460, "Page", 0,0,0),
            (460, 470, 490, 480, "9999999.0", 0,0,0) # Deposit x-range!
        ]
        doc = MockDoc([MockPage(words)])
        res = parse_hdfc_statement(doc)
        
        self.assertEqual(len(res["transactions"]), 1)
        tx = res["transactions"][0]
        self.assertEqual(tx["direction"], "DEBIT")
        self.assertEqual(tx["amount"], 500.0)
        self.assertEqual(tx["balance"], 1000.0)
        
    def test_multiline_narration(self):
        words = [
            (30, 100, 50, 110, "01/04/25", 0,0,0),
            (70, 100, 150, 110, "Line1", 0,0,0),
            (70, 120, 150, 130, "Line2", 0,0,0),
            (460, 100, 490, 110, "200.0", 0,0,0), # Deposit
            (520, 100, 550, 110, "1200.0", 0,0,0), # Balance
        ]
        doc = MockDoc([MockPage(words)])
        res = parse_hdfc_statement(doc)
        tx = res["transactions"][0]
        self.assertEqual(tx["narration"], "Line1 Line2")
        self.assertEqual(tx["direction"], "CREDIT")
        self.assertEqual(tx["amount"], 200.0)
        
    def test_first_row_continuity(self):
        words = [
            (30, 100, 50, 110, "01/04/25", 0,0,0),
            (70, 100, 150, 110, "Init", 0,0,0),
            (460, 100, 490, 110, "500.0", 0,0,0), # Deposit
            (520, 100, 550, 110, "1500.0", 0,0,0), # Balance
        ]
        doc = MockDoc([MockPage(words)])
        res = parse_hdfc_statement(doc)
        self.assertTrue(res["parser_proven"])
        self.assertEqual(res["opening"], 1000.0) # 1500 - 500
        
    def test_invalid_row_detection(self):
        # Create a row where math fails
        words = [
            (30, 100, 50, 110, "01/04/25", 0,0,0),
            (70, 100, 150, 110, "Tx1", 0,0,0),
            (460, 100, 490, 110, "500.0", 0,0,0), 
            (520, 100, 550, 110, "1500.0", 0,0,0), # Opening will be 1000
            
            (30, 150, 50, 160, "02/04/25", 0,0,0),
            (70, 150, 150, 160, "Tx2", 0,0,0),
            (460, 150, 490, 160, "500.0", 0,0,0), 
            (520, 150, 550, 160, "9999.0", 0,0,0), # Fails math: 1500 + 500 = 2000 != 9999
        ]
        doc = MockDoc([MockPage(words)])
        res = parse_hdfc_statement(doc)
        self.assertFalse(res["parser_proven"])
        self.assertEqual(res["rows_fail"], 1)

if __name__ == '__main__':
    unittest.main()
