// ============================================================
// Bansil Books Analytics — Customer Material Control Excel Builder
// 9-Sheet Workbook:
//   1. Customer Material Summary
//   2. Balance Material to Invoice
//   3. Shortfall Material to Purchase
//   4. Reconciled Items
//   5. Purchase Evidence
//   6. Sales Invoice Evidence
//   7. Latest Purchase Rate Evidence
//   8. Customer Details Missing
//   9. Audit / Report Metadata
// Pure Node OpenXML · No external dependencies · Zero Zoho API calls
// ============================================================

import * as zlib from "zlib";
import type { CustomerMaterialControlReport } from "../customer-material-control-engine.ts";
import { getDatabase } from "../db/database.ts";

// ─────────────────────────────────────────────────────────────
// ZIP / OpenXML plumbing
// ─────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}
function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry { path: string; data: Buffer; }

function packZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = e.data;
    const c32 = crc32(raw);
    const comp = zlib.deflateRawSync(raw);
    const nameB = Buffer.from(e.path, "utf8");
    const lh = Buffer.alloc(30 + nameB.length);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(c32, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameB.length, 26); lh.writeUInt16LE(0, 28); nameB.copy(lh, 30);
    const cd = Buffer.alloc(46 + nameB.length);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(8, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(c32, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameB.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42); nameB.copy(cd, 46);
    locals.push(lh, comp);
    cds.push(cd);
    offset += lh.length + comp.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function colLetter(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function buildWorksheet(headers: string[], dataRows: Array<Array<string | number | null>>): string {
  const colCount = headers.length;
  const refEnd = `${colLetter(colCount - 1)}${1 + dataRows.length}`;
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView tabSelected="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>`;
  for (let c = 0; c < colCount; c++) {
    xml += `<col min="${c + 1}" max="${c + 1}" width="18" customWidth="1"/>`;
  }
  xml += `</cols><sheetData>`;

  // Header row
  xml += `<row r="1">`;
  for (let c = 0; c < colCount; c++) {
    xml += `<c r="${colLetter(c)}1" s="2" t="inlineStr"><is><t>${esc(headers[c])}</t></is></c>`;
  }
  xml += `</row>`;

  // Data rows
  for (let r = 0; r < dataRows.length; r++) {
    const rowNum = r + 2;
    xml += `<row r="${rowNum}">`;
    const row = dataRows[r];
    for (let c = 0; c < colCount; c++) {
      const v = row[c];
      const colL = colLetter(c);
      if (typeof v === "number") {
        xml += `<c r="${colL}${rowNum}" s="1" t="n"><v>${v}</v></c>`;
      } else {
        xml += `<c r="${colL}${rowNum}" s="0" t="inlineStr"><is><t>${esc(v ?? "")}</t></is></c>`;
      }
    }
    xml += `</row>`;
  }

  xml += `</sheetData>
<autoFilter ref="A1:${refEnd}"/>
</worksheet>`;
  return xml;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
  <numFmt numFmtId="164" formatCode="#,##0.00"/>
  <numFmt numFmtId="165" formatCode="[$₹-en-IN]#,##0.00"/>
</numFmts>
<fonts count="2">
  <font><sz val="11"/><name val="Segoe UI"/><color rgb="FF1E293B"/></font>
  <font><b/><sz val="11"/><name val="Segoe UI"/><color rgb="FFFFFFFF"/></font>
</fonts>
<fills count="3">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/></border>
  <border>
    <left style="thin"><color rgb="FFE2E8F0"/></left>
    <right style="thin"><color rgb="FFE2E8F0"/></right>
    <top style="thin"><color rgb="FFE2E8F0"/></top>
    <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>
</cellXfs>
</styleSheet>`;

function assembleWorkbook(sheetNames: string[], sheetsData: string[]): Buffer {
  const zipEntries: ZipEntry[] = [
    {
      path: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`),
    },
    {
      path: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n  ")}
</Relationships>`),
    },
    {
      path: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${sheetNames.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n    ")}
  </sheets>
</workbook>`),
    },
    {
      path: "xl/styles.xml",
      data: Buffer.from(STYLES_XML),
    },
    ...sheetsData.map((xml, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(xml),
    })),
  ];

  return packZip(zipEntries);
}

export interface CustomerMaterialExportOptions {
  selectedFields?: string[];
  includeTotals?: boolean;
}

const CM_COLUMN_MAPPINGS: Record<
  string,
  {
    header: string;
    getValue: (item: any, idx: number, report: CustomerMaterialControlReport) => string | number | null;
  }
> = {
  sr: { header: "Sr.", getValue: (it, idx) => it.sr || (idx + 1) },
  customerName: { header: "Customer Name", getValue: (it, _, rep) => it.customer_name || rep.summary.customer_name },
  itemName: { header: "Item Name", getValue: (it) => it.item_name },
  sku: { header: "SKU / Code", getValue: (it) => it.sku },
  description: { header: "Description", getValue: (it) => it.description },
  purchaseQty: { header: "Purchase Qty", getValue: (it) => it.purchase_qty },
  salesQty: { header: "Sales Qty", getValue: (it) => it.sales_qty },
  balanceQty: { header: "Balance Qty", getValue: (it) => it.balance_qty },
  balanceMaterialToInvoice: { header: "Balance Material to Invoice", getValue: (it) => it.balance_material_to_invoice },
  shortfallMaterialToPurchase: { header: "Shortfall Material to Purchase", getValue: (it) => it.shortfall_material_to_purchase },
  reconciledQty: { header: "Reconciled Qty", getValue: (it) => it.reconciled_qty },
  latestPurchaseRate: { header: "Latest Purchase Rate", getValue: (it) => it.latest_purchase_rate ?? "N/A" },
  approxShortfallValue: { header: "Approx Shortfall Value", getValue: (it) => it.approx_shortfall_value ?? "N/A" },
  status: { header: "Status", getValue: (it) => it.status },
  actionStatus: { header: "Action Status", getValue: (it) => it.action_status },
  siteRemark: { header: "Site Remark", getValue: (it) => it.site_remark || "—" },
  actionRequired: { header: "Action Required", getValue: (it) => it.action_required || "—" },
  responsiblePerson: { header: "Responsible Person", getValue: (it) => it.responsible_person || "—" },
  targetDate: { header: "Target Date", getValue: (it) => it.target_date || "—" },
  latestVendor: { header: "Latest Vendor", getValue: (it) => it.latest_purchase_vendor || "—" },
  latestBillNo: { header: "Latest Bill No", getValue: (it) => it.latest_purchase_doc || "—" },
  latestDate: { header: "Latest Date", getValue: (it) => it.latest_purchase_date || "—" },
};

export function buildCustomerMaterialExcel(
  report: CustomerMaterialControlReport,
  options?: CustomerMaterialExportOptions
): Buffer {
  const { summary, items } = report;

  // Sheet 1: Customer Material Summary
  let s1Headers: string[];
  let s1Rows: Array<Array<string | number | null>>;

  if (options?.selectedFields && options.selectedFields.length > 0) {
    const validFields = options.selectedFields
      .map((k) => ({ key: k, mapping: CM_COLUMN_MAPPINGS[k] }))
      .filter((item): item is { key: string; mapping: (typeof CM_COLUMN_MAPPINGS)[string] } => Boolean(item.mapping));

    if (validFields.length > 0) {
      s1Headers = validFields.map((f) => f.mapping.header);
      s1Rows = items.map((it, idx) =>
        validFields.map((f) => f.mapping.getValue(it, idx, report))
      );
    } else {
      s1Headers = [
        "Sr.", "Item Name", "SKU / Code", "Description", "Purchase Qty", "Sales Qty",
        "Balance Qty", "Balance Material to Invoice", "Shortfall Material to Purchase",
        "Reconciled Qty", "Latest Purchase Rate", "Approx Shortfall Value", "Status",
        "Action Status", "Site Remark", "Action Required", "Responsible Person", "Target Date"
      ];
      s1Rows = items.map((it) => [
        it.sr, it.item_name, it.sku, it.description, it.purchase_qty, it.sales_qty,
        it.balance_qty, it.balance_material_to_invoice, it.shortfall_material_to_purchase,
        it.reconciled_qty, it.latest_purchase_rate ?? "N/A", it.approx_shortfall_value ?? "N/A",
        it.status, it.action_status, it.site_remark || "—", it.action_required || "—",
        it.responsible_person || "—", it.target_date || "—"
      ]);
    }
  } else {
    s1Headers = [
      "Sr.", "Item Name", "SKU / Code", "Description", "Purchase Qty", "Sales Qty",
      "Balance Qty", "Balance Material to Invoice", "Shortfall Material to Purchase",
      "Reconciled Qty", "Latest Purchase Rate", "Approx Shortfall Value", "Status",
      "Action Status", "Site Remark", "Action Required", "Responsible Person", "Target Date"
    ];
    s1Rows = items.map((it) => [
      it.sr, it.item_name, it.sku, it.description, it.purchase_qty, it.sales_qty,
      it.balance_qty, it.balance_material_to_invoice, it.shortfall_material_to_purchase,
      it.reconciled_qty, it.latest_purchase_rate ?? "N/A", it.approx_shortfall_value ?? "N/A",
      it.status, it.action_status, it.site_remark || "—", it.action_required || "—",
      it.responsible_person || "—", it.target_date || "—"
    ]);
  }

  // Sheet 2: Balance Material to Invoice
  const s2Headers = [
    "Sr.", "Item Name", "SKU", "Description", "Purchase Qty", "Sales Qty",
    "Balance Material to Invoice", "Latest Sales Rate", "Reference Sales Value", "Status"
  ];
  const s2Rows = items
    .filter((it) => it.balance_material_to_invoice > 0)
    .map((it, idx) => [
      idx + 1, it.item_name, it.sku, it.description, it.purchase_qty, it.sales_qty,
      it.balance_material_to_invoice, it.latest_sales_rate ?? "N/A", it.reference_sales_value ?? "N/A", it.status
    ]);

  // Sheet 3: Shortfall Material to Purchase
  const s3Headers = [
    "Sr.", "Item Name", "SKU", "Description", "Sales Qty", "Purchase Qty",
    "Shortfall Material to Purchase", "Latest Purchase Rate", "Approx Purchase Requirement Value",
    "Latest Vendor", "Latest Bill No", "Latest Date", "Status"
  ];
  const s3Rows = items
    .filter((it) => it.shortfall_material_to_purchase > 0)
    .map((it, idx) => [
      idx + 1, it.item_name, it.sku, it.description, it.sales_qty, it.purchase_qty,
      it.shortfall_material_to_purchase, it.latest_purchase_rate ?? "N/A",
      it.approx_shortfall_value ?? "N/A", it.latest_purchase_vendor || "—",
      it.latest_purchase_doc || "—", it.latest_purchase_date || "—", it.status
    ]);

  // Sheet 4: Reconciled Items
  const s4Headers = [
    "Sr.", "Item Name", "SKU", "Description", "Purchase Qty", "Sales Qty", "Reconciled Qty", "Status"
  ];
  const s4Rows = items
    .filter((it) => it.status === "RECONCILED")
    .map((it, idx) => [
      idx + 1, it.item_name, it.sku, it.description, it.purchase_qty, it.sales_qty, it.reconciled_qty, it.status
    ]);

  // Sheet 5: Purchase Evidence
  const s5Headers = [
    "Bill Date", "Bill No", "Vendor", "Item", "Description", "Customer Details",
    "Purchase Qty", "Rate", "Taxable Value", "Matched Qty", "Balance Qty Available"
  ];
  const s5Rows: Array<Array<string | number | null>> = [];
  for (const it of items) {
    for (const be of it.balance_evidence) {
      s5Rows.push([
        be.bill_date, be.bill_no, be.vendor, be.item, be.description, be.customer_details,
        be.purchase_qty, be.rate, be.taxable_value, be.matched_reconciled_qty, be.balance_qty_available
      ]);
    }
  }

  // Sheet 6: Sales Invoice Evidence
  const s6Headers = [
    "Invoice Date", "Invoice No", "Customer", "Item", "Description",
    "Sales Qty", "Rate", "Taxable Value", "Matched Purchase Qty", "Shortfall Qty"
  ];
  const s6Rows: Array<Array<string | number | null>> = [];
  for (const it of items) {
    for (const se of it.shortfall_evidence) {
      s6Rows.push([
        se.invoice_date, se.invoice_no, se.customer, se.item, se.description,
        se.qty, se.rate, se.taxable_value, se.matched_purchase_qty, se.unsupported_shortfall_qty
      ]);
    }
  }

  // Sheet 7: Latest Purchase Rate Evidence
  const s7Headers = [
    "Item Name", "SKU", "Latest Rate", "Bill No", "Bill Date", "Vendor", "Basis"
  ];
  const s7Rows = items.map((it) => [
    it.item_name, it.sku, it.latest_purchase_rate ?? "N/A", it.latest_purchase_doc || "—",
    it.latest_purchase_date || "—", it.latest_purchase_vendor || "—", it.latest_purchase_basis || "—"
  ]);

  // Sheet 8: Customer Details Missing
  const db = getDatabase();
  const unmappedRows = db.prepare(`
    SELECT pb.date, pb.bill_number, pb.vendor_name, pli.item_name, pli.quantity, pli.rate, pli.line_total
    FROM purchase_bill_line_items pli
    JOIN purchase_bills pb ON pli.bill_id = pb.bill_id
    WHERE UPPER(pb.status) NOT IN ('VOID', 'DRAFT')
      AND pb.date >= ? AND pb.date <= ?
      AND (pli.customer_data_status = 'CUSTOMER DETAILS MISSING'
           OR COALESCE(pli.purchase_line_customer_name, pli.bbt_customer_name, '') IN ('', 'CUSTOMER DETAILS MISSING'))
      AND (pli.item_id IS NULL OR pli.item_id NOT IN (SELECT item_id FROM reconciliation_exclusions WHERE status = 'ACTIVE' AND item_id IS NOT NULL))
    ORDER BY pb.date DESC
  `).all(summary.from_date, summary.to_date) as Array<{
    date: string;
    bill_number: string;
    vendor_name: string;
    item_name: string;
    quantity: number;
    rate: number;
    line_total: number;
  }>;

  const s8Headers = [
    "Bill Date", "Bill No", "Vendor", "Item", "Quantity", "Rate", "Taxable Value"
  ];
  const s8Rows = unmappedRows.map((r) => [
    r.date, r.bill_number, r.vendor_name, r.item_name, r.quantity, r.rate, r.line_total
  ]);

  // Sheet 9: Audit / Report Metadata
  const s9Headers = ["Property", "Value"];
  const s9Rows = [
    ["Report Name", "CUSTOMER MATERIAL CONTROL REPORT"],
    ["Prepared For", "Site Engineer / Site In-charge"],
    ["Customer Name", summary.customer_name],
    ["Customer ID", summary.customer_id],
    ["Period", summary.period_label],
    ["Date Range", `${summary.from_date} to ${summary.to_date}`],
    ["Total Items", summary.total_items],
    ["Total Purchase Qty", summary.total_purchase_qty],
    ["Total Sales Qty", summary.total_sales_qty],
    ["Total Balance Material to Invoice", summary.total_balance_material_to_invoice],
    ["Total Shortfall Material to Purchase", summary.total_shortfall_material_to_purchase],
    ["Total Reconciled Qty", summary.total_reconciled_qty],
    ["Total Approx Purchase Requirement", summary.total_approx_purchase_requirement_value],
    ["Unmapped Purchase Lines", summary.unmapped_purchase_lines_count],
    ["Unmapped Purchase Qty", summary.unmapped_purchase_qty],
    ["Generated At", new Date().toISOString()],
    ["Data Source", "Local SQLite Cache (Offline First)"],
    ["Security Guard", "Zoho Books API: 0 writes, 0 calls on export"],
  ];

  const sheetNames = [
    "Material Summary",
    "Balance to Invoice",
    "Shortfall to Purchase",
    "Reconciled Items",
    "Purchase Evidence",
    "Sales Evidence",
    "Rate Evidence",
    "Customer Missing",
    "Audit Metadata",
  ];

  const sheetsData = [
    buildWorksheet(s1Headers, s1Rows),
    buildWorksheet(s2Headers, s2Rows),
    buildWorksheet(s3Headers, s3Rows),
    buildWorksheet(s4Headers, s4Rows),
    buildWorksheet(s5Headers, s5Rows),
    buildWorksheet(s6Headers, s6Rows),
    buildWorksheet(s7Headers, s7Rows),
    buildWorksheet(s8Headers, s8Rows),
    buildWorksheet(s9Headers, s9Rows),
  ];

  return assembleWorkbook(sheetNames, sheetsData);
}

export interface AllPendingCustomersExcelOptions {
  periodLabel?: string;
  financialYear?: string;
  fromDate?: string;
  toDate?: string;
}

export function buildAllPendingCustomersExcel(
  reports: CustomerMaterialControlReport[],
  options?: AllPendingCustomersExcelOptions
): Buffer {
  if (!reports || reports.length === 0) {
    throw new Error("Excel export failed: reports list is empty.");
  }

  // Filter to pending reports
  const validReports = reports.filter((r) => {
    if (!r || !r.items) return false;
    const hasBalance = r.items.some((it) => it.balance_material_to_invoice > 0.001);
    const hasShortfall = r.items.some((it) => it.shortfall_material_to_purchase > 0.001);
    return hasBalance || hasShortfall;
  });

  if (validReports.length === 0) {
    throw new Error("Excel export failed: no pending customers found.");
  }

  // Sheet 1: Pending Customer Summary
  const s1Headers = [
    "Sr.", "Customer Name", "Customer ID", "Total Items",
    "Balance Material to Invoice", "Shortfall Material to Purchase",
    "Reconciled Qty", "Approx Requirement Value"
  ];
  let totalBalance = 0;
  let totalShortfall = 0;
  let totalApproxReq = 0;

  const s1Rows: Array<Array<string | number | null>> = [];
  validReports.forEach((r, idx) => {
    totalBalance += r.summary.total_balance_material_to_invoice;
    totalShortfall += r.summary.total_shortfall_material_to_purchase;
    totalApproxReq += r.summary.total_approx_purchase_requirement_value;

    s1Rows.push([
      idx + 1,
      r.customer.name,
      r.customer.id,
      r.summary.total_items,
      r.summary.total_balance_material_to_invoice,
      r.summary.total_shortfall_material_to_purchase,
      r.summary.total_reconciled_qty,
      r.summary.total_approx_purchase_requirement_value > 0 ? r.summary.total_approx_purchase_requirement_value : 0,
    ]);
  });

  // Sheet 2: All Balance Material to Invoice
  const s2Headers = [
    "Sr.", "Customer Name", "Customer ID", "Item Name", "SKU", "Description",
    "Purchase Qty", "Invoiced Qty", "Balance Material to Invoice",
    "Latest Sales Rate", "Reference Sales Value", "Status"
  ];
  const s2Rows: Array<Array<string | number | null>> = [];
  let s2Sr = 1;
  for (const r of validReports) {
    for (const it of r.items) {
      if (it.balance_material_to_invoice > 0.001) {
        s2Rows.push([
          s2Sr++,
          r.customer.name,
          r.customer.id,
          it.item_name,
          it.sku,
          it.description,
          it.purchase_qty,
          it.sales_qty,
          it.balance_material_to_invoice,
          it.latest_sales_rate ?? "N/A",
          it.reference_sales_value ?? "N/A",
          it.status,
        ]);
      }
    }
  }

  // Sheet 3: All Shortfall Material to Purchase
  const s3Headers = [
    "Sr.", "Customer Name", "Customer ID", "Item Name", "SKU", "Description",
    "Invoiced Qty", "Purchase Qty", "Shortfall Material to Purchase",
    "Latest Purchase Rate", "Approx Purchase Requirement Value",
    "Latest Vendor", "Latest Bill No", "Latest Date", "Status"
  ];
  const s3Rows: Array<Array<string | number | null>> = [];
  let s3Sr = 1;
  for (const r of validReports) {
    for (const it of r.items) {
      if (it.shortfall_material_to_purchase > 0.001) {
        s3Rows.push([
          s3Sr++,
          r.customer.name,
          r.customer.id,
          it.item_name,
          it.sku,
          it.description,
          it.sales_qty,
          it.purchase_qty,
          it.shortfall_material_to_purchase,
          it.latest_purchase_rate ?? "N/A",
          it.approx_shortfall_value ?? "N/A",
          it.latest_purchase_vendor || "—",
          it.latest_purchase_doc || "—",
          it.latest_purchase_date || "—",
          it.status,
        ]);
      }
    }
  }

  // Sheet 4: All Site Actions & Remarks
  const s4Headers = [
    "Sr.", "Customer Name", "Customer ID", "Item Name", "SKU",
    "Action Required", "Site Remark", "Responsible Person", "Target Date", "Action Status"
  ];
  const s4Rows: Array<Array<string | number | null>> = [];
  let s4Sr = 1;
  for (const r of validReports) {
    for (const it of r.items) {
      if (it.site_remark || it.action_required || it.action_status !== "OPEN") {
        s4Rows.push([
          s4Sr++,
          r.customer.name,
          r.customer.id,
          it.item_name,
          it.sku,
          it.action_required || "—",
          it.site_remark || "—",
          it.responsible_person || "—",
          it.target_date || "—",
          it.action_status,
        ]);
      }
    }
  }

  // Sheet 5: Audit Metadata
  const periodLabel = options?.periodLabel || validReports[0]?.summary.period_label || "ALL";
  const fromDate = options?.fromDate || validReports[0]?.summary.from_date || "—";
  const toDate = options?.toDate || validReports[0]?.summary.to_date || "—";

  const s5Headers = ["Property", "Value"];
  const s5Rows = [
    ["Report Name", "CUSTOMER MATERIAL CONTROL REPORT — ALL PENDING CUSTOMERS"],
    ["Prepared For", "Site Engineer / Site In-charge"],
    ["Period", periodLabel],
    ["Date Range", `${fromDate} to ${toDate}`],
    ["Total Pending Customers", validReports.length],
    ["Total Balance Material to Invoice", totalBalance],
    ["Total Shortfall Material to Purchase", totalShortfall],
    ["Total Approx Purchase Requirement", totalApproxReq],
    ["Generated At", new Date().toISOString()],
    ["Data Source", "Local SQLite Cache (Offline First)"],
    ["Security Guard", "Zoho Books API: 0 writes, 0 calls on export"],
  ];

  const sheetNames = [
    "Pending Summary",
    "Balance to Invoice",
    "Shortfall to Purchase",
    "Site Actions",
    "Audit Metadata",
  ];

  const sheetsData = [
    buildWorksheet(s1Headers, s1Rows),
    buildWorksheet(s2Headers, s2Rows),
    buildWorksheet(s3Headers, s3Rows),
    buildWorksheet(s4Headers, s4Rows),
    buildWorksheet(s5Headers, s5Rows),
  ];

  return assembleWorkbook(sheetNames, sheetsData);
}

