// ============================================================
// Bansil Books Analytics — Central Export Field Configuration
// Schema-driven field definitions, groups, defaults, and capabilities per report
// Pure Local Configuration · Zero Zoho API Calls
// ============================================================

export interface ExportFieldConfig {
  key: string;
  label: string;
  group: string;
  type: "text" | "number" | "currency" | "date" | "status";
  defaultSelected: boolean;
  excelSupported?: boolean;
  pdfSupported?: boolean;
  totalSupported?: boolean;
  widthHint?: number; // Approximate display width in characters or points
  alignment?: "left" | "right" | "center";
}

export interface ReportExportConfig {
  reportType: string;
  title: string;
  subtitle: string;
  fieldGroups: string[];
  fields: ExportFieldConfig[];
  includeTotalsSupported: boolean;
  excelEnabled: boolean;
  pdfEnabled: boolean;
}

// ─────────────────────────────────────────────────────────────
// 1. MASTER RECONCILIATION CONFIG
// ─────────────────────────────────────────────────────────────
export const MASTER_RECONCILIATION_CONFIG: ReportExportConfig = {
  reportType: "summary",
  title: "Reconciliation Statement Export",
  subtitle: "Customer-wise & Item-wise Reconciliation Report",
  fieldGroups: ["GENERAL", "PURCHASE", "SALES", "RECONCILIATION", "EXCLUSION / AUDIT"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // GENERAL
    { key: "sr", label: "Sr.", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 6, alignment: "center" },
    { key: "period", label: "Period", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "customerName", label: "Customer Name", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "customerId", label: "Customer ID", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "itemName", label: "Item Name", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "itemId", label: "Item ID", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "sku", label: "SKU / Code", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 14 },
    { key: "status", label: "Status", group: "GENERAL", type: "status", defaultSelected: true, widthHint: 14, alignment: "center" },

    // PURCHASE
    { key: "billNumber", label: "Bill No.", group: "PURCHASE", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "billDate", label: "Bill Date", group: "PURCHASE", type: "date", defaultSelected: false, widthHint: 12, alignment: "center" },
    { key: "vendorName", label: "Vendor", group: "PURCHASE", type: "text", defaultSelected: false, widthHint: 24 },
    { key: "vendorId", label: "Vendor ID", group: "PURCHASE", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "purchaseQty", label: "Purchase Qty", group: "PURCHASE", type: "number", defaultSelected: true, totalSupported: true, widthHint: 12, alignment: "right" },
    { key: "purchaseRate", label: "Purchase Rate", group: "PURCHASE", type: "currency", defaultSelected: true, widthHint: 14, alignment: "right" },
    { key: "purchaseAmount", label: "Purchase Amount", group: "PURCHASE", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },
    { key: "purchaseCustomerDetails", label: "Purchase Customer Details", group: "PURCHASE", type: "text", defaultSelected: false, widthHint: 24 },

    // SALES
    { key: "invoiceNumber", label: "Invoice No.", group: "SALES", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "invoiceDate", label: "Invoice Date", group: "SALES", type: "date", defaultSelected: false, widthHint: 12, alignment: "center" },
    { key: "salesQty", label: "Sales Qty", group: "SALES", type: "number", defaultSelected: true, totalSupported: true, widthHint: 12, alignment: "right" },
    { key: "salesRate", label: "Sales Rate", group: "SALES", type: "currency", defaultSelected: true, widthHint: 14, alignment: "right" },
    { key: "salesAmount", label: "Sales Amount", group: "SALES", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },

    // RECONCILIATION
    { key: "balanceQty", label: "Balance Qty", group: "RECONCILIATION", type: "number", defaultSelected: true, totalSupported: true, widthHint: 12, alignment: "right" },
    { key: "yetToPurchase", label: "Yet to Purchase Qty", group: "RECONCILIATION", type: "number", defaultSelected: false, totalSupported: true, widthHint: 16, alignment: "right" },
    { key: "yetToSale", label: "Yet to Sale Qty", group: "RECONCILIATION", type: "number", defaultSelected: false, totalSupported: true, widthHint: 16, alignment: "right" },
    { key: "reconciledQty", label: "Reconciled Qty", group: "RECONCILIATION", type: "number", defaultSelected: false, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "approxShortageValue", label: "Approx Shortage Value", group: "RECONCILIATION", type: "currency", defaultSelected: false, totalSupported: true, widthHint: 18, alignment: "right" },
    { key: "approxSurplusValue", label: "Approx Surplus Value", group: "RECONCILIATION", type: "currency", defaultSelected: false, totalSupported: true, widthHint: 18, alignment: "right" },
    { key: "approxRefPurchaseRate", label: "Ref Purchase Rate", group: "RECONCILIATION", type: "currency", defaultSelected: false, widthHint: 16, alignment: "right" },
    { key: "rateBasis", label: "Rate Basis", group: "RECONCILIATION", type: "text", defaultSelected: false, widthHint: 20 },
    { key: "approxRateDate", label: "Ref Bill Date", group: "RECONCILIATION", type: "date", defaultSelected: false, widthHint: 12, alignment: "center" },
    { key: "approxRateBillNumber", label: "Ref Bill No.", group: "RECONCILIATION", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "approxRateVendor", label: "Ref Vendor", group: "RECONCILIATION", type: "text", defaultSelected: false, widthHint: 22 },

    // EXCLUSION / AUDIT
    { key: "includedInReconciliation", label: "Included in Reconciliation", group: "EXCLUSION / AUDIT", type: "text", defaultSelected: false, widthHint: 16, alignment: "center" },
    { key: "isExcluded", label: "Excluded", group: "EXCLUSION / AUDIT", type: "text", defaultSelected: false, widthHint: 10, alignment: "center" },
    { key: "exclusionScope", label: "Exclusion Scope", group: "EXCLUSION / AUDIT", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "exclusionReason", label: "Exclusion Reason", group: "EXCLUSION / AUDIT", type: "text", defaultSelected: false, widthHint: 24 },
    { key: "remarks", label: "Remarks", group: "EXCLUSION / AUDIT", type: "text", defaultSelected: false, widthHint: 24 },
    { key: "approvedBy", label: "Approved By", group: "EXCLUSION / AUDIT", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "approvedDate", label: "Approved Date", group: "EXCLUSION / AUDIT", type: "date", defaultSelected: false, widthHint: 12, alignment: "center" },
  ],
};

// ─────────────────────────────────────────────────────────────
// 2. STOCK EXPORT CONFIG (Inventory Valuation Summary)
// ─────────────────────────────────────────────────────────────
export const STOCK_EXPORT_CONFIG: ReportExportConfig = {
  reportType: "stock",
  title: "Inventory Stock Export",
  subtitle: "Stock on Hand & Inventory Valuation Statement",
  fieldGroups: ["GENERAL", "MOVEMENT", "RATES", "VALUE", "EVIDENCE"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // GENERAL
    { key: "sr", label: "Sr.", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "itemName", label: "Item Name", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 32 },
    { key: "itemId", label: "Item ID", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "sku", label: "SKU / Code", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "classification", label: "Classification", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 14, alignment: "center" },
    { key: "stockStatus", label: "Stock Status", group: "GENERAL", type: "status", defaultSelected: true, widthHint: 14, alignment: "center" },

    // MOVEMENT
    { key: "purchaseQty", label: "Purchase Qty", group: "MOVEMENT", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "salesQty", label: "Sales Qty", group: "MOVEMENT", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "stockQty", label: "Stock Qty", group: "MOVEMENT", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },

    // RATES
    { key: "latestPurchaseRate", label: "Latest Purchase Rate", group: "RATES", type: "currency", defaultSelected: true, widthHint: 16, alignment: "right" },
    { key: "latestSalesRate", label: "Latest Sales Rate", group: "RATES", type: "currency", defaultSelected: false, widthHint: 16, alignment: "right" },

    // VALUE
    { key: "approxStockValue", label: "Approx Stock Value", group: "VALUE", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 18, alignment: "right" },

    // EVIDENCE
    { key: "customersCount", label: "Customers Count", group: "EVIDENCE", type: "number", defaultSelected: false, totalSupported: false, widthHint: 14, alignment: "right" },
    { key: "billsCount", label: "Bills Count", group: "EVIDENCE", type: "number", defaultSelected: false, totalSupported: false, widthHint: 12, alignment: "right" },
    { key: "invoicesCount", label: "Invoices Count", group: "EVIDENCE", type: "number", defaultSelected: false, totalSupported: false, widthHint: 12, alignment: "right" },
    { key: "lastPurchaseDate", label: "Last Purchase Date", group: "EVIDENCE", type: "date", defaultSelected: false, widthHint: 14, alignment: "center" },
    { key: "lastSalesDate", label: "Last Sales Date", group: "EVIDENCE", type: "date", defaultSelected: false, widthHint: 14, alignment: "center" },
  ],
};

// ─────────────────────────────────────────────────────────────
// 3. CUSTOMER MATERIAL CONTROL EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const CUSTOMER_MATERIAL_CONTROL_CONFIG: ReportExportConfig = {
  reportType: "customer-material-control",
  title: "Customer Material Control Export",
  subtitle: "Site Material Statement for Site Engineer / Site In-charge",
  fieldGroups: ["GENERAL", "MATERIAL", "RATE / VALUE", "SITE ACTION", "AUDIT"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // GENERAL
    { key: "sr", label: "Sr.", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "customerName", label: "Customer Name", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "itemName", label: "Item Name", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 28 },
    { key: "sku", label: "SKU / Code", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "status", label: "Status", group: "GENERAL", type: "status", defaultSelected: true, widthHint: 14, alignment: "center" },

    // MATERIAL
    { key: "purchaseQty", label: "Purchase Qty", group: "MATERIAL", type: "number", defaultSelected: true, totalSupported: true, widthHint: 13, alignment: "right" },
    { key: "salesQty", label: "Invoiced Qty", group: "MATERIAL", type: "number", defaultSelected: true, totalSupported: true, widthHint: 13, alignment: "right" },
    { key: "balanceQty", label: "Balance Qty", group: "MATERIAL", type: "number", defaultSelected: false, totalSupported: true, widthHint: 13, alignment: "right" },
    { key: "balanceToInvoice", label: "Balance to Invoice", group: "MATERIAL", type: "number", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },
    { key: "shortfallToPurchase", label: "Shortfall to Purchase", group: "MATERIAL", type: "number", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },
    { key: "reconciledQty", label: "Reconciled Qty", group: "MATERIAL", type: "number", defaultSelected: false, totalSupported: true, widthHint: 14, alignment: "right" },

    // RATE / VALUE
    { key: "latestPurchaseRate", label: "Latest Purchase Rate", group: "RATE / VALUE", type: "currency", defaultSelected: true, widthHint: 16, alignment: "right" },
    { key: "latestSalesRate", label: "Latest Sales Rate", group: "RATE / VALUE", type: "currency", defaultSelected: false, widthHint: 16, alignment: "right" },
    { key: "approxPurchaseRequirement", label: "Approx Purchase Requirement", group: "RATE / VALUE", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 18, alignment: "right" },
    { key: "latestVendor", label: "Latest Vendor", group: "RATE / VALUE", type: "text", defaultSelected: true, widthHint: 26 },

    // SITE ACTION
    { key: "siteRemark", label: "Site Remark", group: "SITE ACTION", type: "text", defaultSelected: false, widthHint: 26 },
    { key: "actionRequired", label: "Action Required", group: "SITE ACTION", type: "text", defaultSelected: false, widthHint: 26 },
    { key: "responsiblePerson", label: "Responsible Person", group: "SITE ACTION", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "targetDate", label: "Target Date", group: "SITE ACTION", type: "date", defaultSelected: false, widthHint: 12, alignment: "center" },
    { key: "actionStatus", label: "Action Status", group: "SITE ACTION", type: "status", defaultSelected: false, widthHint: 14, alignment: "center" },

    // AUDIT
    { key: "period", label: "Period", group: "AUDIT", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "generatedDate", label: "Generated Date", group: "AUDIT", type: "date", defaultSelected: false, widthHint: 14, alignment: "center" },
  ],
};

// ─────────────────────────────────────────────────────────────
// 4. PRICE REFERENCE EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const PRICE_REFERENCE_CONFIG: ReportExportConfig = {
  reportType: "price-reference",
  title: "Price Reference & Rate Discovery Export",
  subtitle: "Item Purchase and Sales Rate History Reference",
  fieldGroups: ["ITEM DETAILS", "RATES", "QUANTITIES & VALUES", "REFERENCE METADATA"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // ITEM DETAILS
    { key: "sr", label: "Sr.", group: "ITEM DETAILS", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "itemName", label: "Item Name", group: "ITEM DETAILS", type: "text", defaultSelected: true, widthHint: 28 },
    { key: "sku", label: "SKU / Code", group: "ITEM DETAILS", type: "text", defaultSelected: true, widthHint: 14 },
    { key: "customerName", label: "Customer", group: "ITEM DETAILS", type: "text", defaultSelected: true, widthHint: 24 },
    { key: "vendorName", label: "Vendor", group: "ITEM DETAILS", type: "text", defaultSelected: true, widthHint: 24 },
    { key: "docNumber", label: "Bill / Invoice No.", group: "ITEM DETAILS", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "docDate", label: "Date", group: "ITEM DETAILS", type: "date", defaultSelected: true, widthHint: 12, alignment: "center" },

    // RATES
    { key: "purchaseRate", label: "Purchase Rate", group: "RATES", type: "currency", defaultSelected: false, widthHint: 14, alignment: "right" },
    { key: "salesRate", label: "Sales Rate", group: "RATES", type: "currency", defaultSelected: false, widthHint: 14, alignment: "right" },
    { key: "lowestRate", label: "Lowest Rate", group: "RATES", type: "currency", defaultSelected: false, widthHint: 14, alignment: "right" },
    { key: "highestRate", label: "Highest Rate", group: "RATES", type: "currency", defaultSelected: false, widthHint: 14, alignment: "right" },
    { key: "weightedAverage", label: "Weighted Average", group: "RATES", type: "currency", defaultSelected: false, widthHint: 16, alignment: "right" },
    { key: "latestRate", label: "Latest Rate", group: "RATES", type: "currency", defaultSelected: true, widthHint: 14, alignment: "right" },
    { key: "rateBasis", label: "Rate Basis", group: "RATES", type: "text", defaultSelected: false, widthHint: 22 },

    // QUANTITIES & VALUES
    { key: "qty", label: "Qty", group: "QUANTITIES & VALUES", type: "number", defaultSelected: true, totalSupported: true, widthHint: 12, alignment: "right" },
    { key: "taxableValue", label: "Taxable Value", group: "QUANTITIES & VALUES", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },

    // REFERENCE METADATA
    { key: "financialYear", label: "Financial Year", group: "REFERENCE METADATA", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "priceType", label: "Price Type", group: "REFERENCE METADATA", type: "text", defaultSelected: false, widthHint: 12, alignment: "center" },
  ],
};

// ─────────────────────────────────────────────────────────────
// 5. CUSTOMER DETAILS (Customer 360) EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const CUSTOMER_DETAILS_CONFIG: ReportExportConfig = {
  reportType: "customer-details",
  title: "Customer 360 Statement Export",
  subtitle: "Customer Overview, Invoices, and Purchase Linkages",
  fieldGroups: ["CUSTOMER INFO", "RECONCILIATION METRICS", "FINANCIAL TOTALS"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // CUSTOMER INFO
    { key: "customerName", label: "Customer Name", group: "CUSTOMER INFO", type: "text", defaultSelected: true, widthHint: 28 },
    { key: "customerId", label: "Customer ID", group: "CUSTOMER INFO", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "gstin", label: "GSTIN", group: "CUSTOMER INFO", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "pan", label: "PAN", group: "CUSTOMER INFO", type: "text", defaultSelected: false, widthHint: 12 },
    { key: "phone", label: "Phone", group: "CUSTOMER INFO", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "email", label: "Email", group: "CUSTOMER INFO", type: "text", defaultSelected: false, widthHint: 20 },

    // RECONCILIATION METRICS
    { key: "purchaseQty", label: "Purchase Qty", group: "RECONCILIATION METRICS", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "salesQty", label: "Sales Qty", group: "RECONCILIATION METRICS", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "balanceQty", label: "Balance Qty", group: "RECONCILIATION METRICS", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "shortfallQty", label: "Shortfall Qty", group: "RECONCILIATION METRICS", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "reconciledQty", label: "Reconciled Qty", group: "RECONCILIATION METRICS", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },

    // FINANCIAL TOTALS
    { key: "purchaseValue", label: "Total Purchase Value", group: "FINANCIAL TOTALS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 18, alignment: "right" },
    { key: "salesValue", label: "Total Invoiced Value", group: "FINANCIAL TOTALS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 18, alignment: "right" },
    { key: "approxRequirementValue", label: "Approx Shortfall Value", group: "FINANCIAL TOTALS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 18, alignment: "right" },
  ],
};

// ─────────────────────────────────────────────────────────────
// 6. TRANSACTION BILLS EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const TRANSACTION_BILLS_CONFIG: ReportExportConfig = {
  reportType: "bills",
  title: "Purchase Bills Export",
  subtitle: "Vendor Purchase Bills Statement",
  fieldGroups: ["BILL HEADER", "ITEM & QUANTITIES", "TAXES & TOTALS"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // BILL HEADER
    { key: "sr", label: "Sr.", group: "BILL HEADER", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "billNumber", label: "Bill No.", group: "BILL HEADER", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "billDate", label: "Bill Date", group: "BILL HEADER", type: "date", defaultSelected: true, widthHint: 12, alignment: "center" },
    { key: "vendorName", label: "Vendor", group: "BILL HEADER", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "vendorId", label: "Vendor ID", group: "BILL HEADER", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "customerDetails", label: "Customer Details", group: "BILL HEADER", type: "text", defaultSelected: false, widthHint: 24 },

    // ITEM & QUANTITIES
    { key: "itemName", label: "Item", group: "ITEM & QUANTITIES", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "sku", label: "SKU", group: "ITEM & QUANTITIES", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "qty", label: "Qty", group: "ITEM & QUANTITIES", type: "number", defaultSelected: true, totalSupported: true, widthHint: 12, alignment: "right" },
    { key: "rate", label: "Rate", group: "ITEM & QUANTITIES", type: "currency", defaultSelected: true, widthHint: 14, alignment: "right" },
    { key: "balanceQty", label: "Balance Qty", group: "ITEM & QUANTITIES", type: "number", defaultSelected: false, totalSupported: true, widthHint: 12, alignment: "right" },

    // TAXES & TOTALS
    { key: "taxableValue", label: "Taxable Value", group: "TAXES & TOTALS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },
    { key: "gst", label: "GST", group: "TAXES & TOTALS", type: "currency", defaultSelected: false, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "grandTotal", label: "Grand Total", group: "TAXES & TOTALS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },
  ],
};

// ─────────────────────────────────────────────────────────────
// 7. TRANSACTION INVOICES EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const TRANSACTION_INVOICES_CONFIG: ReportExportConfig = {
  reportType: "invoices",
  title: "Sales Invoices Export",
  subtitle: "Customer Sales Invoices Statement",
  fieldGroups: ["INVOICE HEADER", "ITEM & QUANTITIES", "TAXES & TOTALS"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // INVOICE HEADER
    { key: "sr", label: "Sr.", group: "INVOICE HEADER", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "invoiceNumber", label: "Invoice No.", group: "INVOICE HEADER", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "invoiceDate", label: "Invoice Date", group: "INVOICE HEADER", type: "date", defaultSelected: true, widthHint: 12, alignment: "center" },
    { key: "customerName", label: "Customer", group: "INVOICE HEADER", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "customerId", label: "Customer ID", group: "INVOICE HEADER", type: "text", defaultSelected: false, widthHint: 18 },

    // ITEM & QUANTITIES
    { key: "itemName", label: "Item", group: "ITEM & QUANTITIES", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "sku", label: "SKU", group: "ITEM & QUANTITIES", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "qty", label: "Qty", group: "ITEM & QUANTITIES", type: "number", defaultSelected: true, totalSupported: true, widthHint: 12, alignment: "right" },
    { key: "rate", label: "Rate", group: "ITEM & QUANTITIES", type: "currency", defaultSelected: true, widthHint: 14, alignment: "right" },
    { key: "balanceQty", label: "Balance Qty", group: "ITEM & QUANTITIES", type: "number", defaultSelected: false, totalSupported: true, widthHint: 12, alignment: "right" },

    // TAXES & TOTALS
    { key: "taxableValue", label: "Taxable Value", group: "TAXES & TOTALS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },
    { key: "gst", label: "GST", group: "TAXES & TOTALS", type: "currency", defaultSelected: false, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "grandTotal", label: "Grand Total", group: "TAXES & TOTALS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },
  ],
};

// ─────────────────────────────────────────────────────────────
// 8. EXCLUDED ITEMS EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const EXCLUDED_ITEMS_CONFIG: ReportExportConfig = {
  reportType: "excluded-items",
  title: "Excluded Items Audit Export",
  subtitle: "Items Globally Excluded from Reconciliation",
  fieldGroups: ["ITEM IDENTIFICATION", "EXCLUSION METADATA", "AUDIT"],
  includeTotalsSupported: false, // Owner rule: hide or disable for non-numeric/detail-only exports
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // ITEM IDENTIFICATION
    { key: "sr", label: "Sr.", group: "ITEM IDENTIFICATION", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "itemName", label: "Item Name", group: "ITEM IDENTIFICATION", type: "text", defaultSelected: true, widthHint: 30 },
    { key: "itemId", label: "Item ID", group: "ITEM IDENTIFICATION", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "sku", label: "SKU", group: "ITEM IDENTIFICATION", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "originalClassification", label: "Original Classification", group: "ITEM IDENTIFICATION", type: "text", defaultSelected: false, widthHint: 18, alignment: "center" },

    // EXCLUSION METADATA
    { key: "reason", label: "Reason", group: "EXCLUSION METADATA", type: "text", defaultSelected: true, widthHint: 26 },
    { key: "scope", label: "Scope", group: "EXCLUSION METADATA", type: "text", defaultSelected: true, widthHint: 14, alignment: "center" },
    { key: "excludedDate", label: "Excluded Date", group: "EXCLUSION METADATA", type: "date", defaultSelected: true, widthHint: 14, alignment: "center" },

    // AUDIT
    { key: "approvedBy", label: "Approved By", group: "AUDIT", type: "text", defaultSelected: true, widthHint: 18 },
    { key: "remarks", label: "Remarks", group: "AUDIT", type: "text", defaultSelected: true, widthHint: 26 },
  ],
};

// ─────────────────────────────────────────────────────────────
// 9. CUSTOMER DETAILS MISSING (Action Taken) EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const CUSTOMER_DETAILS_MISSING_CONFIG: ReportExportConfig = {
  reportType: "customer-details-missing",
  title: "Customer Details Missing Export",
  subtitle: "Purchase Lines Awaiting Customer Attribution & Action",
  fieldGroups: ["BILL IDENTIFICATION", "ITEM DETAILS", "ACTION STATUS"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // BILL IDENTIFICATION
    { key: "sr", label: "Sr.", group: "BILL IDENTIFICATION", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "billNumber", label: "Bill No.", group: "BILL IDENTIFICATION", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "billDate", label: "Bill Date", group: "BILL IDENTIFICATION", type: "date", defaultSelected: true, widthHint: 12, alignment: "center" },
    { key: "vendorName", label: "Vendor", group: "BILL IDENTIFICATION", type: "text", defaultSelected: true, widthHint: 26 },

    // ITEM DETAILS
    { key: "itemName", label: "Item Name", group: "ITEM DETAILS", type: "text", defaultSelected: true, widthHint: 28 },
    { key: "sku", label: "SKU", group: "ITEM DETAILS", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "qty", label: "Qty", group: "ITEM DETAILS", type: "number", defaultSelected: true, totalSupported: true, widthHint: 12, alignment: "right" },
    { key: "rate", label: "Rate", group: "ITEM DETAILS", type: "currency", defaultSelected: true, widthHint: 14, alignment: "right" },
    { key: "taxableValue", label: "Taxable Value", group: "ITEM DETAILS", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 16, alignment: "right" },

    // ACTION STATUS
    { key: "customerDetailsStatus", label: "Customer Details Status", group: "ACTION STATUS", type: "status", defaultSelected: true, widthHint: 20, alignment: "center" },
    { key: "reason", label: "Reason / Remark", group: "ACTION STATUS", type: "text", defaultSelected: false, widthHint: 26 },
  ],
};

// ─────────────────────────────────────────────────────────────
// 10. COMPOSITE ASSEMBLY EXPORT CONFIG
// ─────────────────────────────────────────────────────────────
export const COMPOSITE_ASSEMBLY_CONFIG: ReportExportConfig = {
  reportType: "composite-assembly",
  title: "Composite Assembly Statement Export",
  subtitle: "Component Consumption & Finished Composite Assemblies",
  fieldGroups: ["ASSEMBLY HEADER", "COMPOSITE OUTPUT", "COMPONENTS"],
  includeTotalsSupported: true,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // ASSEMBLY HEADER
    { key: "sr", label: "Sr.", group: "ASSEMBLY HEADER", type: "text", defaultSelected: false, widthHint: 6, alignment: "center" },
    { key: "assemblyNumber", label: "Assembly No.", group: "ASSEMBLY HEADER", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "assemblyDate", label: "Assembly Date", group: "ASSEMBLY HEADER", type: "date", defaultSelected: true, widthHint: 12, alignment: "center" },
    { key: "customerName", label: "Customer", group: "ASSEMBLY HEADER", type: "text", defaultSelected: true, widthHint: 26 },

    // COMPOSITE OUTPUT
    { key: "compositeItemName", label: "Composite Item", group: "COMPOSITE OUTPUT", type: "text", defaultSelected: true, widthHint: 28 },
    { key: "compositeSku", label: "SKU", group: "COMPOSITE OUTPUT", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "generatedQty", label: "Generated Qty", group: "COMPOSITE OUTPUT", type: "number", defaultSelected: true, totalSupported: true, widthHint: 14, alignment: "right" },
    { key: "unitMaterialCost", label: "Unit Material Cost", group: "COMPOSITE OUTPUT", type: "currency", defaultSelected: true, widthHint: 16, alignment: "right" },
    { key: "totalMaterialCost", label: "Total Material Cost", group: "COMPOSITE OUTPUT", type: "currency", defaultSelected: true, totalSupported: true, widthHint: 18, alignment: "right" },
    { key: "status", label: "Status", group: "COMPOSITE OUTPUT", type: "status", defaultSelected: true, widthHint: 14, alignment: "center" },

    // COMPONENTS
    { key: "componentsSummary", label: "Components Summary", group: "COMPONENTS", type: "text", defaultSelected: false, widthHint: 32 },
  ],
};

// ─────────────────────────────────────────────────────────────
// 9. ZOHO ACTIVITY EXPORT CONFIG (Section 16: Export)
// Available fields must be only actual Zoho Activity columns.
// ─────────────────────────────────────────────────────────────
export const ZOHO_ACTIVITY_CONFIG: ReportExportConfig = {
  reportType: "zoho-activity",
  title: "Zoho Books Activity Logs Export",
  subtitle: "Audit Trail & Activity Log Statement — Current FY",
  fieldGroups: ["GENERAL", "ACTIVITY DETAILS", "METADATA"],
  includeTotalsSupported: false,
  excelEnabled: true,
  pdfEnabled: true,
  fields: [
    // GENERAL
    { key: "date", label: "Date", group: "GENERAL", type: "date", defaultSelected: true, widthHint: 12, alignment: "center" },
    { key: "time", label: "Time", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 10, alignment: "center" },
    { key: "user_name", label: "User Name", group: "GENERAL", type: "text", defaultSelected: true, widthHint: 20 },
    { key: "user_id", label: "User ID", group: "GENERAL", type: "text", defaultSelected: false, widthHint: 18 },

    // ACTIVITY DETAILS
    { key: "module", label: "Module", group: "ACTIVITY DETAILS", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "action", label: "Action", group: "ACTIVITY DETAILS", type: "text", defaultSelected: true, widthHint: 14 },
    { key: "description", label: "Description", group: "ACTIVITY DETAILS", type: "text", defaultSelected: true, widthHint: 36 },
    { key: "entity_number", label: "Reference / Transaction", group: "ACTIVITY DETAILS", type: "text", defaultSelected: true, widthHint: 18 },
    { key: "activity_type", label: "Activity Type", group: "ACTIVITY DETAILS", type: "text", defaultSelected: true, widthHint: 16 },
    { key: "entity_id", label: "Entity ID", group: "ACTIVITY DETAILS", type: "text", defaultSelected: false, widthHint: 18 },

    // METADATA
    { key: "activity_id", label: "Activity ID", group: "METADATA", type: "text", defaultSelected: false, widthHint: 18 },
    { key: "ip_address", label: "IP Address", group: "METADATA", type: "text", defaultSelected: false, widthHint: 16 },
    { key: "source", label: "Source", group: "METADATA", type: "text", defaultSelected: false, widthHint: 14 },
    { key: "created_time", label: "Created Time", group: "METADATA", type: "text", defaultSelected: false, widthHint: 22 },
    { key: "synced_at", label: "Synced At", group: "METADATA", type: "text", defaultSelected: false, widthHint: 22 },
  ],
};

// ─────────────────────────────────────────────────────────────
// REGISTRY LOOKUP FUNCTION
// ─────────────────────────────────────────────────────────────
const REGISTRY: Record<string, ReportExportConfig> = {
  // Master Reconciliation & variants
  summary: MASTER_RECONCILIATION_CONFIG,
  "master-inventory-mismatch": MASTER_RECONCILIATION_CONFIG,
  "transaction-breakdown": MASTER_RECONCILIATION_CONFIG,
  "full-breakdown": MASTER_RECONCILIATION_CONFIG,
  detail: MASTER_RECONCILIATION_CONFIG,

  // Stock
  stock: STOCK_EXPORT_CONFIG,
  "inventory-stock": STOCK_EXPORT_CONFIG,
  "item-detail": STOCK_EXPORT_CONFIG,
  "stock-breakdown": STOCK_EXPORT_CONFIG,

  // Customer Material Control
  "customer-material-control": CUSTOMER_MATERIAL_CONTROL_CONFIG,
  "all-pending-customer-material": {
    ...CUSTOMER_MATERIAL_CONTROL_CONFIG,
    reportType: "all-pending-customer-material",
    title: "All Pending Customers Material Statement",
    subtitle: "Consolidated Multi-Customer Shortfall & Balance Export",
  },

  // Price Reference
  "price-reference": PRICE_REFERENCE_CONFIG,

  // Customer 360 Details
  "customer-details": CUSTOMER_DETAILS_CONFIG,

  // Transactions
  bills: TRANSACTION_BILLS_CONFIG,
  invoices: TRANSACTION_INVOICES_CONFIG,

  // Excluded Items
  "excluded-items": EXCLUDED_ITEMS_CONFIG,

  // Customer Details Missing (Action Taken)
  "customer-details-missing": CUSTOMER_DETAILS_MISSING_CONFIG,
  "customer-missing": CUSTOMER_DETAILS_MISSING_CONFIG,
  "action-taken": CUSTOMER_DETAILS_MISSING_CONFIG,

  // Composite Assembly
  "composite-assembly": COMPOSITE_ASSEMBLY_CONFIG,

  // Zoho Activity (Section 16)
  "zoho-activity": ZOHO_ACTIVITY_CONFIG,
  activity: ZOHO_ACTIVITY_CONFIG,
  zoho_activity: ZOHO_ACTIVITY_CONFIG,
};

/**
 * Returns the complete schema configuration for any given report type.
 * Falls back to MASTER_RECONCILIATION_CONFIG if unknown.
 */
export function getReportExportConfig(reportType?: string): ReportExportConfig {
  if (!reportType) return MASTER_RECONCILIATION_CONFIG;
  const key = reportType.toLowerCase().trim();
  return REGISTRY[key] || MASTER_RECONCILIATION_CONFIG;
}

/**
 * Returns sensible default field keys for a given report type.
 */
export function getDefaultFieldsForReport(reportType?: string): string[] {
  const config = getReportExportConfig(reportType);
  return config.fields.filter((f) => f.defaultSelected).map((f) => f.key);
}

/**
 * Returns all available fields for a given report type.
 */
export function getAllFieldsForReport(reportType?: string): ExportFieldConfig[] {
  return getReportExportConfig(reportType).fields;
}
