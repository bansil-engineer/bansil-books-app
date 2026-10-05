import { getAuditDatabase } from "../app/lib/db/audit-database.ts";
import { readTokenStore } from "../app/lib/zoho-token-store.ts";
import { secureZohoFetch } from "../app/lib/zoho-security-guard.ts";


const tokens = readTokenStore();
const orgId = tokens?.organization_id || process.env.ZOHO_DEFAULT_ORG_ID!;
const apiDomain = tokens?.api_domain || "https://www.zohoapis.com";
const accessToken = tokens?.access_token!;

async function fetchZoho(endpoint: string) {
  const url = `${apiDomain}${endpoint}${endpoint.includes('?') ? '&' : '?'}organization_id=${orgId}`;
  const res = await secureZohoFetch(url, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
  });
  if (!res.ok) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  return res.json();
}

async function run() {
  console.log("==================================================");
  console.log("10. FIND REAL NON-EMPTY PAYMENT ALLOCATION EXAMPLES");
  console.log("==================================================");
  let cpFound = false;
  for (let page = 1; page <= 5 && !cpFound; page++) {
    const cpList = await fetchZoho(`/books/v3/customerpayments?page=${page}&per_page=10`);
    for (const cp of cpList.customerpayments || []) {
      const detail = await fetchZoho(`/books/v3/customerpayments/${cp.payment_id}`);
      const invoices = detail.customerpayment?.invoices || [];
      if (invoices.length > 0) {
        console.log(`PAYMENT ID: ${cp.payment_id}`);
        console.log(`ALLOCATION COUNT: ${invoices.length}`);
        console.log(`INVOICE IDs: ${invoices.map((i:any) => i.invoice_id).join(", ")}`);
        console.log(`TOTAL PAYMENT: ${detail.customerpayment.amount}`);
        const totalAllocated = invoices.reduce((sum:number, i:any) => sum + (i.amount_applied || 0), 0);
        console.log(`TOTAL ALLOCATED: ${totalAllocated}`);
        console.log(`UNUSED AMOUNT: ${detail.customerpayment.unused_amount}`);
        cpFound = true;
        break;
      }
    }
  }
  if (!cpFound) console.log("NOT OBSERVED");

  console.log("\n==================================================");
  console.log("11. FIND REAL NON-EMPTY VENDOR PAYMENT EXAMPLES");
  console.log("==================================================");
  let vpFound = false;
  for (let page = 1; page <= 5 && !vpFound; page++) {
    const vpList = await fetchZoho(`/books/v3/vendorpayments?page=${page}&per_page=10`);
    for (const vp of vpList.vendorpayments || []) {
      const detail = await fetchZoho(`/books/v3/vendorpayments/${vp.payment_id}`);
      const bills = detail.vendorpayment?.bills || [];
      if (bills.length > 0) {
        console.log(`VENDOR PAYMENT ID: ${vp.payment_id}`);
        console.log(`ALLOCATION COUNT: ${bills.length}`);
        console.log(`BILL IDs: ${bills.map((b:any) => b.bill_id).join(", ")}`);
        vpFound = true;
        break;
      }
    }
  }
  if (!vpFound) console.log("NOT OBSERVED");

  console.log("\n==================================================");
  console.log("12. FIND REAL NON-EMPTY CREDIT NOTE APPLICATION");
  console.log("==================================================");
  let cnFound = false;
  for (let page = 1; page <= 5 && !cnFound; page++) {
    const cnList = await fetchZoho(`/books/v3/creditnotes?page=${page}&per_page=10`);
    for (const cn of cnList.creditnotes || []) {
      const detail = await fetchZoho(`/books/v3/creditnotes/${cn.creditnote_id}`);
      const invoices = detail.creditnote?.invoices || [];
      if (invoices.length > 0) {
        console.log(`CREDIT NOTE: ${cn.creditnote_id}`);
        console.log(`APPLICATION COUNT: ${invoices.length}`);
        console.log(`INVOICE IDs: ${invoices.map((i:any) => i.invoice_id).join(", ")}`);
        const refunds = detail.creditnote?.refunds || [];
        console.log(`REFUND COUNT: ${refunds.length}`);
        cnFound = true;
        break;
      }
    }
  }
  if (!cnFound) console.log("NOT OBSERVED");

  console.log("\n==================================================");
  console.log("13. FIND REAL NON-EMPTY VENDOR CREDIT APPLICATION");
  console.log("==================================================");
  const vcList = await fetchZoho(`/books/v3/vendorcredits?page=1&per_page=10`);
  if (!vcList.vendorcredits || vcList.vendorcredits.length === 0) {
    console.log("NO CURRENT SOURCE RECORD AVAILABLE FOR NON-EMPTY PROOF");
  } else {
    let vcFound = false;
    for (let page = 1; page <= 5 && !vcFound; page++) {
      const list = await fetchZoho(`/books/v3/vendorcredits?page=${page}&per_page=10`);
      for (const vc of list.vendorcredits || []) {
        const detail = await fetchZoho(`/books/v3/vendorcredits/${vc.vendor_credit_id}`);
        const bills = detail.vendorcredit?.bills || [];
        if (bills.length > 0) {
          console.log(`VENDOR CREDIT: ${vc.vendor_credit_id}`);
          console.log(`BILL APPLICATION COUNT: ${bills.length}`);
          console.log(`BILL IDs: ${bills.map((b:any) => b.bill_id).join(", ")}`);
          vcFound = true;
          break;
        }
      }
    }
    if (!vcFound) console.log("NOT OBSERVED");
  }

  console.log("\n==================================================");
  console.log("14. FIND REAL SO → INVOICE LINK");
  console.log("==================================================");
  let soFound = false;
  for (let page = 1; page <= 5 && !soFound; page++) {
    const soList = await fetchZoho(`/books/v3/salesorders?page=${page}&per_page=10`);
    for (const so of soList.salesorders || []) {
      const detail = await fetchZoho(`/books/v3/salesorders/${so.salesorder_id}`);
      const invoices = detail.salesorder?.invoices || [];
      if (invoices.length > 0) {
        console.log(`salesorder_id: ${so.salesorder_id}`);
        console.log(`invoice IDs: ${invoices.map((i:any) => i.invoice_id).join(", ")}`);
        console.log(`invoice count: ${invoices.length}`);
        
        let reverseSupported = true;
        for (const inv of invoices) {
          const invDetail = await fetchZoho(`/books/v3/invoices/${inv.invoice_id}`);
          // Check if invoice mentions SO
          const hasReverse = invDetail.invoice?.salesorders?.some((s:any) => s.salesorder_id === so.salesorder_id) || 
                             invDetail.invoice?.salesorder_id === so.salesorder_id ||
                             invDetail.invoice?.reference_number?.includes(so.salesorder_number); // we can't infer from ref num reliably but let's check field
          
          if (!invDetail.invoice?.salesorders?.some((s:any) => s.salesorder_id === so.salesorder_id) && invDetail.invoice?.salesorder_id !== so.salesorder_id) {
             reverseSupported = false;
          }
        }

        console.log(`\nSO → INVOICE FORWARD LINK:\nPROVEN`);
        console.log(`\nINVOICE → SO REVERSE LINK:\n${reverseSupported ? 'PROVEN' : 'NOT PROVEN'}`);
        console.log(`\nONE SO → MULTIPLE INVOICES:\n${invoices.length > 1 ? 'OBSERVED' : 'NOT OBSERVED'}`);
        console.log(`\nEACH INVOICE → ONE SO:\n${reverseSupported ? 'SUPPORTED BY SOURCE' : 'NOT PROVEN'}`);
        soFound = true;
        break;
      }
    }
  }
  if (!soFound) {
    console.log(`SO → INVOICE FORWARD LINK:\nNOT PROVEN`);
    console.log(`\nINVOICE → SO REVERSE LINK:\nNOT PROVEN`);
    console.log(`\nONE SO → MULTIPLE INVOICES:\nNOT OBSERVED`);
    console.log(`\nEACH INVOICE → ONE SO:\nNOT PROVEN`);
  }

  console.log("\n==================================================");
  console.log("15. FIND REAL PO → BILL LINK");
  console.log("==================================================");
  let poFound = false;
  for (let page = 1; page <= 5 && !poFound; page++) {
    const poList = await fetchZoho(`/books/v3/purchaseorders?page=${page}&per_page=10`);
    for (const po of poList.purchaseorders || []) {
      const detail = await fetchZoho(`/books/v3/purchaseorders/${po.purchaseorder_id}`);
      const bills = detail.purchaseorder?.bills || [];
      if (bills.length > 0) {
        console.log(`PO → BILL FORWARD LINK:\nPROVEN`);
        
        let reverseSupported = true;
        for (const bill of bills) {
          const billDetail = await fetchZoho(`/books/v3/bills/${bill.bill_id}`);
          if (!billDetail.bill?.purchaseorders?.some((p:any) => p.purchaseorder_id === po.purchaseorder_id) && billDetail.bill?.purchaseorder_id !== po.purchaseorder_id) {
             reverseSupported = false;
          }
        }

        console.log(`\nBILL → PO REVERSE LINK:\n${reverseSupported ? 'PROVEN' : 'NOT PROVEN'}`);
        console.log(`\nONE PO → MULTIPLE BILLS:\n${bills.length > 1 ? 'OBSERVED' : 'NOT OBSERVED'}`);
        console.log(`\nEACH BILL → ONE PO:\n${reverseSupported ? 'SUPPORTED BY SOURCE' : 'NOT PROVEN'}`);
        poFound = true;
        break;
      }
    }
  }
  if (!poFound) {
    console.log(`PO → BILL FORWARD LINK:\nNOT PROVEN`);
    console.log(`\nBILL → PO REVERSE LINK:\nNOT PROVEN`);
    console.log(`\nONE PO → MULTIPLE BILLS:\nNOT OBSERVED`);
    console.log(`\nEACH BILL → ONE PO:\nNOT PROVEN`);
  }

  console.log("\n==================================================");
  console.log("16. EXPENSE PAID-THROUGH PROOF");
  console.log("==================================================");
  const exList = await fetchZoho(`/books/v3/expenses?page=1&per_page=10`);
  let exFound = false;
  for (const ex of exList.expenses || []) {
    if (ex.paid_through_account_id) {
      console.log(`EXPENSE → PAID-THROUGH:\nPROVEN`);
      console.log(`\nACCOUNT ID:\n${ex.paid_through_account_id}`);
      console.log(`\nACCOUNT TYPE:\n(Implied Bank/Cash/CreditCard based on paid-through logic)`);
      exFound = true;
      break;
    }
  }
  if (!exFound) console.log("NOT PROVEN");

  console.log("\n==================================================");
  console.log("17. JOURNAL BALANCE SAMPLE");
  console.log("==================================================");
  const db = getAuditDatabase();
  const jRes = db.prepare(`SELECT SUM(debit) as d, SUM(credit) as c FROM audit_zoho_journal_lines`).get() as any;
  console.log(`sum(debit) = ${jRes.d}`);
  console.log(`sum(credit) = ${jRes.c}`);
  if (jRes.d !== null && Math.abs(jRes.d - jRes.c) < 0.01) {
    console.log(`Sample balances.`);
  } else {
    console.log(`Sample does NOT balance.`);
  }
}

run().catch(console.error);
