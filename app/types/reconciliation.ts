// ============================================================
// Bansil Books Analytics — Shared Reconciliation Types
// Phase-1: Material Reconciliation Engine & Export Contracts
// ============================================================

export type OperationalMismatchTab =
  | "ALL_MISMATCHES"
  | "BALANCE"
  | "YET_TO_SALE"
  | "YET_TO_PURCHASE"
  | "PURCHASE_ONLY"
  | "SALE_ONLY"
  | "MISSING_CUSTOMER"
  | "RECONCILED";

export type ItemClassification = "MATERIAL" | "SERVICE" | "ALL";

export interface BreakdownRequestPayload {
  customerId: string;
  customerName?: string;
  itemId: string;
  itemName?: string;
  sku?: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
  period?: string;
}

export interface ReconciliationFilter {
  financialYear?: string; // e.g. "2026-27" or "2025-26"
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  period?: string; // e.g. "TODAY", "THIS_WEEK", "THIS_MONTH", "THIS_QUARTER", "CURRENT_FY", "PREVIOUS_FY", "ALL_FY", "CUSTOM"
  operationalTab?: OperationalMismatchTab; // Legacy single tab
  operationalTabs?: OperationalMismatchTab[]; // Multi-status checkbox group
  customerId?: string;
  customerName?: string;
  itemId?: string;
  itemName?: string;
  sku?: string;
  vendorName?: string;
  search?: string;
  status?: string;
  classification?: ItemClassification;
  includeExcludedItems?: boolean;
}

export interface ReconciliationSummaryItem {
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string;
  purchaseQty: number;
  purchaseAmount: number;
  salesQty: number;
  salesAmount: number;
  balanceQty: number;
  yetToPurchaseQty: number;
  yetToSaleQty: number;
  reconciledQty: number;
  status: "RECONCILED" | "PENDING SALE" | "SHORTFALL" | "INACTIVE";
  invoiceNumbers?: string;
  billNumbers?: string;
}

export interface ReconciliationTransactionDetail {
  transactionDate: string; // YYYY-MM-DD
  financialYear: string;
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string;
  salesInvoiceNumber?: string;
  salesInvoiceUrl?: string;
  salesQty: number;
  salesAmount: number;
  purchaseBillNumber?: string;
  purchaseBillUrl?: string;
  vendorName?: string;
  purchaseQty: number;
  purchaseAmount: number;
  customerDataStatus: "VERIFIED" | "CUSTOMER DETAILS MISSING";
}

export interface CustomerDetailsMissingItem {
  billDate: string;
  billNumber: string;
  billUrl?: string;
  vendorName: string;
  itemId: string;
  itemName: string;
  sku: string;
  quantity: number;
  purchaseAmount: number;
  description: string;
  customerDataStatus: "CUSTOMER DETAILS MISSING";
}

export interface ReconciliationReportResult {
  filter: ReconciliationFilter;
  generatedAt: string; // ISO timestamp
  dataLastSynced?: string; // Timestamp of last successful Zoho sync
  isOffline?: boolean;
  organizationName: string;
  organizationId: string;
  summaryItems: ReconciliationSummaryItem[];
  transactionDetails: ReconciliationTransactionDetail[];
  exceptionItems: CustomerDetailsMissingItem[];
  totals: {
    purchaseQty: number;
    purchaseAmount: number;
    salesQty: number;
    salesAmount: number;
    balanceQty: number;
    yetToPurchaseQty: number;
    yetToSaleQty: number;
    reconciledQty: number;
  };
}

export interface MasterInventoryMismatchItem {
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  purchaseQty: number;
  purchaseAmount: number;
  avgPurchaseRate?: number;
  salesQty: number;
  salesAmount: number;
  avgSalesRate?: number;
  balanceQty: number;
  yetToPurchaseQty: number;
  yetToSaleQty: number;
  reconciledQty: number;
  mismatchValue?: number;
  approxRefPurchaseRate?: number | null;
  approxShortageValue?: number | null;
  approxSurplusValue?: number | null;
  approxRateBasis?: string;
  approxRateDate?: string;
  approxRateBillNumber?: string;
  approxRateVendor?: string;
  status:
    | "SHORTAGE"
    | "SURPLUS"
    | "RECONCILED"
    | "INACTIVE"
    | "PURCHASE ONLY — NO SALE / INVOICE"
    | "SALE ONLY — NO PURCHASE";
  salesInvoiceCount: number;
  purchaseBillCount: number;
  invoiceNumbers?: string;
  billNumbers?: string;
  isExcluded?: boolean;
  purchaseRates?: number[];
  salesRates?: number[];
  singlePurchaseRate?: number | null;
  singleSalesRate?: number | null;
  billList?: { billNumber: string; billUrl?: string }[];
  invoiceList?: { invoiceNumber: string; invoiceUrl?: string }[];
}

export interface ItemTransactionBreakdown {
  customerId: string;
  customerName: string;
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  period?: string;
  status?: string;
  isExcluded?: boolean;
  totalPurchaseQty: number;
  totalPurchaseAmount: number;
  totalSalesQty: number;
  totalSalesAmount: number;
  balanceQty: number;
  yetToPurchaseQty: number;
  yetToSaleQty: number;
  reconciledQty: number;
  purchaseStatus?: string;
  vendorStatus?: string;
  approxRefPurchaseRate?: number | null;
  approxShortageValue?: number | null;
  approxSurplusValue?: number | null;
  approxRateBasis?: string;
  approxRateDate?: string;
  approxRateBillNumber?: string;
  approxRateVendor?: string;
  salesTransactions: {
    lineItemId?: string;
    invoiceId: string;
    invoiceNumber: string;
    invoiceUrl?: string;
    date: string;
    customerName: string;
    itemName?: string;
    sku?: string;
    quantity: number;
    rate: number;
    amount: number;
    description?: string;
    exclusionStatus?: string;
  }[];
  purchaseTransactions: {
    lineItemId?: string;
    billId: string;
    billNumber: string;
    billUrl?: string;
    date: string;
    vendorName: string;
    itemName?: string;
    sku?: string;
    purchaseCustomerDetails?: string;
    quantity: number;
    rate: number;
    amount: number;
    description?: string;
    customerDataStatus?: string;
    exclusionStatus?: string;
  }[];
}

export interface CustomerDetailsMissingRecord {
  lineItemId?: string;
  billId: string;
  billNumber: string;
  billDate: string;
  vendorName: string;
  itemId: string;
  itemName: string;
  sku: string;
  quantity: number;
  rate: number;
  amount: number;
  description: string;
  billUrl?: string;
}

export interface MasterInventoryMismatchReportResult {
  generatedAt: string;
  dataLastSynced: string;
  isOffline: boolean;
  financialYear: string;
  filter: ReconciliationFilter;
  organizationName: string;
  organizationId: string;
  items: MasterInventoryMismatchItem[];
  allMismatches: MasterInventoryMismatchItem[];
  yetToSale: MasterInventoryMismatchItem[];
  yetToPurchase: MasterInventoryMismatchItem[];
  purchaseOnly: MasterInventoryMismatchItem[];
  saleOnly: MasterInventoryMismatchItem[];
  customerDetailsMissing: CustomerDetailsMissingRecord[];
  reconciled: MasterInventoryMismatchItem[];
  transactionLines?: any[]; // Full line-item breakdown
  rawPurchaseLines?: any[];
  rawSalesLines?: any[];
  tabCounts: {
    allMismatches: number;
    balance?: number;
    yetToSale: number;
    yetToPurchase: number;
    purchaseOnly: number;
    saleOnly: number;
    missingCustomer: number;
    reconciled: number;
    excludedCount?: number;
  };
  filterCounts?: {
    allMismatches: number;
    balance?: number;
    yetToSale: number;
    yetToPurchase: number;
    purchaseOnly: number;
    saleOnly: number;
    missingCustomer: number;
    reconciled: number;
    excludedCount?: number;
  };
  totals: {
    totalPurchaseQty: number;
    totalPurchaseAmount: number;
    totalSalesQty: number;
    totalSalesAmount: number;
    netBalanceQty: number;
    totalYetToPurchaseQty: number;
    totalYetToSaleQty: number;
    totalReconciledQty: number;
    netMismatchValue: number;
    totalApproxShortageValue: number;
    totalApproxSurplusValue: number;
    totalItems: number;
    shortageCount: number;
    surplusCount: number;
    reconciledCount: number;
  };
  filterOptions: {
    customers: { id: string; name: string }[];
    items: { id: string; name: string; sku: string }[];
    coverageStatus: "COMPLETE" | "PARTIAL" | "NOT_SYNCED";
    totalRecordsInPeriod: number;
  };
}

export type ExportFieldCategory =
  | "GENERAL"
  | "PURCHASE"
  | "SALES"
  | "RECONCILIATION"
  | "EXCLUSION / AUDIT";

export type ExportFieldKey =
  // GENERAL
  | "sr"
  | "period"
  | "customerName"
  | "customerId"
  | "itemName"
  | "itemId"
  | "sku"
  | "status"
  // PURCHASE
  | "billNumber"
  | "billDate"
  | "vendorName"
  | "vendorId"
  | "purchaseQty"
  | "purchaseRate"
  | "purchaseAmount"
  | "purchaseCustomerDetails"
  // SALES
  | "invoiceNumber"
  | "invoiceDate"
  | "salesQty"
  | "salesRate"
  | "salesAmount"
  // RECONCILIATION
  | "balanceQty"
  | "yetToPurchase"
  | "yetToSale"
  | "reconciledQty"
  | "approxShortageValue"
  | "approxSurplusValue"
  | "approxRefPurchaseRate"
  | "approxRateBasis"
  | "approxRateDate"
  | "approxRateBillNumber"
  | "approxRateVendor"
  // EXCLUSION / AUDIT
  | "includedInReconciliation"
  | "isExcluded"
  | "exclusionScope"
  | "exclusionReason"
  | "remarks"
  | "approvedBy"
  | "approvedDate";

export type ExportReportType =
  | "summary"
  | "master-inventory-mismatch"
  | "transaction-breakdown"
  | "full-breakdown"
  | "bills"
  | "invoices"
  | "detail"
  | "services"
  | "customer-missing"
  | "customer-details-missing"
  | "excluded-items"
  | "price-reference"
  | "customer-details"
  | "action-taken"
  | "composite-assembly"
  | "stock"
  | "inventory-stock"
  | "item-detail"
  | "stock-breakdown"
  | "customer-material-control";

export interface ExportFieldDefinition {
  key: ExportFieldKey;
  label: string;
  category: ExportFieldCategory;
  isDefault: boolean;
  type: "text" | "number" | "currency" | "date" | "status";
  applicableReports?: ExportReportType[];
}

export interface ExportOptions {
  selectedFields?: ExportFieldKey[];
  includeTotals?: boolean;
  includeMetadata?: boolean;
  sortBy?: string;
  sortOrder?: string;
  reportType?: ExportReportType;
  format?: "excel" | "pdf";
}

export const EXPORT_FIELD_DEFINITIONS: ExportFieldDefinition[] = [
  // GENERAL
  { key: "sr", label: "Sr.", category: "GENERAL", isDefault: true, type: "text" },
  { key: "period", label: "Period", category: "GENERAL", isDefault: false, type: "text" },
  { key: "customerName", label: "Customer Name", category: "GENERAL", isDefault: true, type: "text" },
  { key: "customerId", label: "Customer ID", category: "GENERAL", isDefault: false, type: "text" },
  { key: "itemName", label: "Item Name", category: "GENERAL", isDefault: true, type: "text" },
  { key: "itemId", label: "Item ID", category: "GENERAL", isDefault: false, type: "text" },
  { key: "sku", label: "SKU / Code", category: "GENERAL", isDefault: true, type: "text" },
  { key: "status", label: "Status", category: "GENERAL", isDefault: true, type: "status" },

  // PURCHASE
  { key: "billNumber", label: "Bill No.", category: "PURCHASE", isDefault: false, type: "text" },
  { key: "billDate", label: "Bill Date", category: "PURCHASE", isDefault: false, type: "date" },
  { key: "vendorName", label: "Vendor", category: "PURCHASE", isDefault: false, type: "text" },
  { key: "vendorId", label: "Vendor ID", category: "PURCHASE", isDefault: false, type: "text" },
  { key: "purchaseQty", label: "Purchase Qty", category: "PURCHASE", isDefault: true, type: "number" },
  { key: "purchaseRate", label: "Purchase Rate", category: "PURCHASE", isDefault: true, type: "currency" },
  { key: "purchaseAmount", label: "Purchase Amount", category: "PURCHASE", isDefault: true, type: "currency" },
  { key: "purchaseCustomerDetails", label: "Purchase Customer Details", category: "PURCHASE", isDefault: false, type: "text" },

  // SALES
  { key: "invoiceNumber", label: "Invoice No.", category: "SALES", isDefault: false, type: "text" },
  { key: "invoiceDate", label: "Invoice Date", category: "SALES", isDefault: false, type: "date" },
  { key: "salesQty", label: "Sales Qty", category: "SALES", isDefault: true, type: "number" },
  { key: "salesRate", label: "Sales Rate", category: "SALES", isDefault: true, type: "currency" },
  { key: "salesAmount", label: "Sales Amount", category: "SALES", isDefault: true, type: "currency" },

  // RECONCILIATION
  { key: "balanceQty", label: "Balance Qty", category: "RECONCILIATION", isDefault: true, type: "number" },
  { key: "yetToPurchase", label: "Yet to Purchase Qty", category: "RECONCILIATION", isDefault: false, type: "number" },
  { key: "yetToSale", label: "Yet to Sale Qty", category: "RECONCILIATION", isDefault: false, type: "number" },
  { key: "reconciledQty", label: "Reconciled Qty", category: "RECONCILIATION", isDefault: false, type: "number" },
  { key: "approxShortageValue", label: "Approx Shortage Value", category: "RECONCILIATION", isDefault: false, type: "currency" },
  { key: "approxSurplusValue", label: "Approx Surplus Value", category: "RECONCILIATION", isDefault: false, type: "currency" },
  { key: "approxRefPurchaseRate", label: "Ref Purchase Rate", category: "RECONCILIATION", isDefault: false, type: "currency" },
  { key: "approxRateBasis", label: "Rate Basis", category: "RECONCILIATION", isDefault: false, type: "text" },
  { key: "approxRateDate", label: "Ref Bill Date", category: "RECONCILIATION", isDefault: false, type: "date" },
  { key: "approxRateBillNumber", label: "Ref Bill No.", category: "RECONCILIATION", isDefault: false, type: "text" },
  { key: "approxRateVendor", label: "Ref Vendor", category: "RECONCILIATION", isDefault: false, type: "text" },

  // EXCLUSION / AUDIT
  { key: "includedInReconciliation", label: "Included in Reconciliation", category: "EXCLUSION / AUDIT", isDefault: false, type: "text" },
  { key: "isExcluded", label: "Excluded", category: "EXCLUSION / AUDIT", isDefault: false, type: "text" },
  { key: "exclusionScope", label: "Exclusion Scope", category: "EXCLUSION / AUDIT", isDefault: false, type: "text" },
  { key: "exclusionReason", label: "Exclusion Reason", category: "EXCLUSION / AUDIT", isDefault: false, type: "text" },
  { key: "remarks", label: "Remarks", category: "EXCLUSION / AUDIT", isDefault: false, type: "text" },
  { key: "approvedBy", label: "Approved By", category: "EXCLUSION / AUDIT", isDefault: false, type: "text" },
  { key: "approvedDate", label: "Approved Date", category: "EXCLUSION / AUDIT", isDefault: false, type: "date" },
];

export const DEFAULT_EXPORT_FIELD_KEYS: ExportFieldKey[] = [
  "sr",
  "customerName",
  "itemName",
  "sku",
  "purchaseQty",
  "purchaseRate",
  "purchaseAmount",
  "salesQty",
  "salesRate",
  "salesAmount",
  "balanceQty",
  "status",
];

/**
 * Returns the relevant fields for a specific report type.
 * Ensures irrelevant fields are not displayed for specific reports.
 */
export function getAvailableFieldsForReport(reportType?: ExportReportType): ExportFieldDefinition[] {
  if (!reportType || reportType === "summary" || reportType === "master-inventory-mismatch" || reportType === "full-breakdown" || reportType === "transaction-breakdown" || reportType === "detail") {
    return EXPORT_FIELD_DEFINITIONS;
  }

  if (reportType === "bills") {
    return EXPORT_FIELD_DEFINITIONS.filter((f) =>
      f.category === "GENERAL" || f.category === "PURCHASE" || f.category === "EXCLUSION / AUDIT"
    );
  }

  if (reportType === "invoices") {
    return EXPORT_FIELD_DEFINITIONS.filter((f) =>
      f.category === "GENERAL" || f.category === "SALES" || f.category === "EXCLUSION / AUDIT"
    );
  }

  if (reportType === "customer-missing") {
    return EXPORT_FIELD_DEFINITIONS.filter((f) =>
      f.key === "sr" ||
      f.key === "period" ||
      f.key === "itemName" ||
      f.key === "itemId" ||
      f.key === "sku" ||
      f.category === "PURCHASE" ||
      f.category === "EXCLUSION / AUDIT"
    );
  }

  if (reportType === "excluded-items") {
    return EXPORT_FIELD_DEFINITIONS.filter((f) =>
      f.category === "GENERAL" || f.category === "EXCLUSION / AUDIT" || f.key === "purchaseQty" || f.key === "salesQty" || f.key === "balanceQty"
    );
  }

  return EXPORT_FIELD_DEFINITIONS;
}

