// ============================================================
// Bansil Books Analytics — Module Lock Configuration
// Protected Baselines: Owner Approved Stable Modules
// ============================================================

export interface ModuleLockConfig {
  status: "LOCKED" | "UNLOCKED";
  reason: string;
  lockedAt: string;
  protectedAreas: string[];
}

export const MODULE_LOCKS: Record<"Inventory" | "Customers" | "Reports", ModuleLockConfig> = {
  Inventory: {
    status: "LOCKED",
    reason: "OWNER APPROVED STABLE MODULE",
    lockedAt: "2026-09-12T18:55:00+05:30",
    protectedAreas: [
      "app/components/InventoryStockView.tsx",
      "app/components/ItemDetailDrawer.tsx",
      "app/lib/stock-engine.ts",
      "app/lib/stock-utils.ts",
      "app/api/stock/route.ts",
    ],
  },
  Customers: {
    status: "LOCKED",
    reason: "OWNER APPROVED STABLE MODULE",
    lockedAt: "2026-09-12T18:55:00+05:30",
    protectedAreas: [
      "app/components/CustomerDetailsView.tsx",
      "app/lib/customer-details-engine.ts",
      "app/api/customer-details/route.ts",
    ],
  },
  Reports: {
    status: "LOCKED",
    reason: "OWNER APPROVED STABLE MODULE",
    lockedAt: "2026-09-12T18:55:00+05:30",
    protectedAreas: [
      "app/components/BreakdownReportView.tsx",
      "app/components/ActionTakenView.tsx",
      "app/lib/action-taken-engine.ts",
      "app/lib/reconciliation-engine.ts",
      "app/lib/export/excel-builder.ts",
      "app/lib/export/pdf-builder.ts",
      "app/lib/export/stock-excel-builder.ts",
    ],
  },
};

export function isModuleLocked(moduleName: "Inventory" | "Customers" | "Reports"): boolean {
  return MODULE_LOCKS[moduleName]?.status === "LOCKED";
}
