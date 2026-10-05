"use client";

import React from "react";
import { AuditFinding } from "../../lib/audit/audit-findings-service";
import { CashBooksView } from "../audit/cash/CashBooksView";

interface PreAuditCashTabProps {
  financialYear: string;
  findings: AuditFinding[];
}

export function PreAuditCashTab({ financialYear, findings }: PreAuditCashTabProps) {
  return (
    <div style={{ padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>
      <CashBooksView financialYear={financialYear} />
    </div>
  );
}
