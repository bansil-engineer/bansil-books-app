import { NextRequest, NextResponse } from "next/server";
import { readTokenStore } from "@/app/lib/zoho-token-store";
import { fetchInvoicesForDate, fetchBillsForDate, getValidAccessToken } from "@/app/lib/zoho-api";
import { getTodayIST, isValidISODate, sumAmounts } from "@/app/lib/date-utils";
import type { TodaysDataResponse, ZohoInvoice, ZohoBill } from "@/app/types/zoho";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const isAuditMode = searchParams.get('audit') === 'true' || process.env.AUDIT_MODE === 'true'; // Audit mode override
    
    const dateParam = searchParams.get("date");
    const date = dateParam && isValidISODate(dateParam) ? dateParam : getTodayIST();

    if (isAuditMode) {
      return NextResponse.json({
        date,
        invoices: [],
        bills: [],
        invoiceTotal: 0,
        billTotal: 0,
        invoiceBalanceTotal: 0,
        billBalanceTotal: 0,
        invoiceCount: 0,
        billCount: 0,
        invoiceApiStatus: 200,
        billApiStatus: 200,
        invoiceError: undefined,
        billError: undefined,
        lastRefreshed: new Date().toISOString(),
      });
    }

    // ---- Zoho credential check ----
    // Distinguish three states:
    //   1. No Zoho credentials configured at all (no refresh token)
    //   2. Credentials configured but access token absent/expired → let refresh run
    //   3. Refresh failed → surface as 502

    const store = readTokenStore();
    if (!store?.refresh_token) {
      // State 1: Zoho not connected — no credentials to work with
      return NextResponse.json(
        { error: "Zoho Books not connected. No credentials configured." },
        { status: 401 }
      );
    }

    // State 2/3: Credentials exist — use getValidAccessToken() which
    // handles refresh automatically (including on Vercel cold start
    // where access_token starts as "" and expires_at as 0).
    let validToken: string;
    try {
      const result = await getValidAccessToken();
      validToken = result.token;
    } catch (refreshErr) {
      // State 4: Refresh failed — Zoho auth infrastructure error
      const msg = refreshErr instanceof Error ? refreshErr.message : "Token refresh failed";
      console.error("[API/data] Zoho token refresh failed:", msg);
      return NextResponse.json(
        { error: "Zoho authentication failed. Token refresh unsuccessful." },
        { status: 502 }
      );
    }

    // Resolve organization ID — same fallback chain used throughout the codebase
    const organizationId = store.organization_id || process.env.ZOHO_DEFAULT_ORG_ID || "";
    if (!organizationId) {
      return NextResponse.json({ error: "No organization selected" }, { status: 400 });
    }

    const [invoicesResult, billsResult] = await Promise.all([
      fetchInvoicesForDate(organizationId, date),
      fetchBillsForDate(organizationId, date)
    ]);

    const invoices = invoicesResult.invoices || [];
    const bills = billsResult.bills || [];

    const invoiceTotal = sumAmounts(invoices.map(i => Number(i.total || 0)));
    const billTotal = sumAmounts(bills.map(b => Number(b.total || 0)));
    const invoiceBalanceTotal = sumAmounts(invoices.map(i => Number(i.balance || 0)));
    const billBalanceTotal = sumAmounts(bills.map(b => Number(b.balance || 0)));

    return NextResponse.json({
      date,
      invoices,
      bills,
      invoiceTotal,
      billTotal,
      invoiceBalanceTotal,
      billBalanceTotal,
      invoiceCount: invoices.length,
      billCount: bills.length,
      invoiceApiStatus: invoicesResult.statusCode,
      billApiStatus: billsResult.statusCode,
      invoiceError: undefined,
      billError: undefined,
      lastRefreshed: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
