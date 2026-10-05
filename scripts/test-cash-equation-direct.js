"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var cash_equation_ts_1 = require("../app/lib/audit/cash-equation.ts");
var audit_database_ts_1 = require("../app/lib/db/audit-database.ts");
var db = (0, audit_database_ts_1.getAuditDatabase)();
var accounts = db.prepare("SELECT DISTINCT account_id, account_name FROM audit_zoho_bank_transactions WHERE account_name IN ('ATIT SHAH', 'Cash For Company')").all();
for (var _i = 0, accounts_1 = accounts; _i < accounts_1.length; _i++) {
    var acc = accounts_1[_i];
    var res = (0, cash_equation_ts_1.calculateCashEquation)(acc.account_id, '2025-04-01', '2026-03-31');
    console.log("".concat(acc.account_name, ": OP=").concat(res.opening_balance, " CL=").concat(res.closing_balance));
}
