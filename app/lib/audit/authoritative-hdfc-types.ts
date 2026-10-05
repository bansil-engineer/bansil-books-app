export interface AuthoritativeEntityContext {
  entityName: string; // "Bansil Engineers"
  entityType: string; // "Proprietorship"
  legalName: string; // "Bansil Engineers"
  organizationId: string; // "774390949"
  platform: string; // "Antigravity Audit Workspace"
  zohoWriteMode: number; // 0
}

export interface AuthoritativeHdfcSource {
  financialYear: string;
  bankName: string;
  accountName: string;
  accountNumberMasked: string;
  statementFile: string;
  statementPages: number;
  bookRows: number;
  statementRows: number;
  openingBalance: number;
  depositsTotal: number;
  withdrawalsTotal: number;
  statementClosingBalance: number;
  bookClosingBalance: number;
  closingDifference: number;
  arithmeticContinuityPass: boolean;
  arithmeticDiscrepancy: number;
  directMatches: number;
  groupedCases: number;
  groupedStatementComponents: number;
  humanResolved: number;
  unresolvedRows: number;
  coveragePct: number;
  entity: AuthoritativeEntityContext;
  rawEvidence: any;
}

export function getAuthoritativeEntityContext(): AuthoritativeEntityContext {
  return {
    entityName: "Bansil Engineers",
    entityType: "Proprietorship",
    legalName: "Bansil Engineers",
    organizationId: "774390949",
    platform: "Antigravity Audit Workspace",
    zohoWriteMode: 0,
  };
}

export function formatINR(val: number | string | undefined | null): string {
  if (val === undefined || val === null || val === "") return "NOT AVAILABLE";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "NOT AVAILABLE";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(num);
}
