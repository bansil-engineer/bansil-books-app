import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getValidAccessToken } from "@/app/lib/zoho-api";
import { secureZohoFetch } from "@/app/lib/zoho-security-guard";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

const ZOHO_DEFAULT_ORG_ID = process.env.ZOHO_DEFAULT_ORG_ID;
const MAX_GETS_PER_RUN = 100;

interface SyncRequest {
  fy: string;
  period: string;
  syncModule: "sales" | "purchase" | "all";
}

function getFyDates(fy: string) {
  const years = fy.split("-");
  const startYear = parseInt(years[0], 10);
  const endYear = startYear + 1;
  return {
    start: `${startYear}-04-01`,
    end: `${endYear}-03-31`
  };
}

export async function POST(req: Request) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(req, policyFor("audit/evidence/zoho-sync", "POST"), "audit/evidence/zoho-sync POST");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const body = await req.json() as SyncRequest;
    const { fy, period, syncModule } = body;

    if (!fy || !period || !syncModule) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    if (fy === "2025-26") {
      return NextResponse.json({ error: "FY2025-26 is authoritative and locked from destructive bulk sync. Please use manual refresh check." }, { status: 403 });
    }

    const CACHE_DIR = path.join(process.cwd(), "data", "audit", fy);
    const LIST_CACHE_FILE = path.join(CACHE_DIR, "zoho_list_cache.json");
    const DETAIL_CACHE_DIR = path.join(CACHE_DIR, "detail_cache");

    if (!fs.existsSync(DETAIL_CACHE_DIR)) {
      fs.mkdirSync(DETAIL_CACHE_DIR, { recursive: true });
    }

    // Move existing samples if they exist from our manual test to proper detail_cache
    const SAMPLES_DIR = path.join(CACHE_DIR, "detail_samples");
    if (fs.existsSync(SAMPLES_DIR)) {
      const samples = fs.readdirSync(SAMPLES_DIR);
      for (const sample of samples) {
        if (!sample.endsWith(".json")) continue;
        const d = JSON.parse(fs.readFileSync(path.join(SAMPLES_DIR, sample), 'utf-8'));
        const typePrefix = sample.startsWith("invoice") ? "invoice_" : (sample.startsWith("bill") ? "bill_" : "creditnote_");
        const id = d.invoice_id || d.bill_id || d.creditnote_id;
        if (id) {
          fs.writeFileSync(path.join(DETAIL_CACHE_DIR, `${typePrefix}${id}.json`), JSON.stringify(d, null, 2));
        }
      }
    }

    let getsUsed = 0;
    const { token, store } = await getValidAccessToken();

    async function fetchZoho(endpoint: string, params: Record<string, any> = {}) {
      // NOTE: Using a direct URL query string approach as some endpoints expect ID directly in the path for Details.
      // fetchZoho is for LIST endpoints in this helper. For Detail GETs, the loop below explicitly calls secureZohoFetch.
      const searchParams = new URLSearchParams({ organization_id: ZOHO_DEFAULT_ORG_ID!, ...params });
      const url = `${store.api_domain}/books/v3/${endpoint}?${searchParams.toString()}`;
      const res = await secureZohoFetch(url, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (res.status === 429) {
        throw new Error("429 Too Many Requests");
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return res.json();
    }

    // 1. Ensure List Cache
    let listCache: { invoices: any[], bills: any[], creditnotes: any[], vendorcredits: any[] } = { invoices: [], bills: [], creditnotes: [], vendorcredits: [] };
    const { start, end } = getFyDates(fy);

    if (fs.existsSync(LIST_CACHE_FILE)) {
      listCache = JSON.parse(fs.readFileSync(LIST_CACHE_FILE, "utf-8"));
    } else {
      // Basic List Sync
      const fetchList = async (type: string, maxPages: number) => {
        let page = 1;
        let hasMore = true;
        const items = [];
        while (page <= maxPages && hasMore && getsUsed < MAX_GETS_PER_RUN) {
          getsUsed++;
          const data = await fetchZoho(type, { date_start: start, date_end: end, page, per_page: 200 });
          const key = type === 'vendorcredits' ? 'vendor_credits' : type; 
          const records = data[type] || data[key] || [];
          items.push(...records);
          hasMore = data.page_context?.has_more_page || false;
          page++;
        }
        return items;
      };

      if (syncModule === "sales" || syncModule === "all") {
        listCache.invoices = await fetchList('invoices', 10);
        listCache.creditnotes = await fetchList('creditnotes', 10);
      }
      if (syncModule === "purchase" || syncModule === "all") {
        listCache.bills = await fetchList('bills', 10);
        listCache.vendorcredits = await fetchList('vendorcredits', 10);
      }
      fs.writeFileSync(LIST_CACHE_FILE, JSON.stringify(listCache, null, 2));
    }

    // 2. Queue missing details
    const toFetch: { type: string, id: string, filePrefix: string }[] = [];
    
    function needsFetch(filePrefix: string, item: any, idField: string) {
      const id = item[idField];
      const filePath = path.join(DETAIL_CACHE_DIR, `${filePrefix}${id}.json`);
      if (!fs.existsSync(filePath)) return true;
      try {
        const cached = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (cached.last_modified_time && item.last_modified_time && cached.last_modified_time !== item.last_modified_time) {
          return true; // changed
        }
        return false; // unchanged
      } catch (e) {
        return true; // invalid cache
      }
    }

    if (syncModule === "sales" || syncModule === "all") {
      for (const inv of listCache.invoices || []) {
        if (needsFetch('invoice_', inv, 'invoice_id')) {
          toFetch.push({ type: 'invoices', id: inv.invoice_id, filePrefix: 'invoice_' });
        }
      }
      for (const cn of listCache.creditnotes || []) {
        if (needsFetch('creditnote_', cn, 'creditnote_id')) {
          toFetch.push({ type: 'creditnotes', id: cn.creditnote_id, filePrefix: 'creditnote_' });
        }
      }
    }
    
    if (syncModule === "purchase" || syncModule === "all") {
      for (const bill of listCache.bills || []) {
        if (needsFetch('bill_', bill, 'bill_id')) {
          toFetch.push({ type: 'bills', id: bill.bill_id, filePrefix: 'bill_' });
        }
      }
      for (const vc of listCache.vendorcredits || []) {
        const vcId = vc.vendor_credit_id || vc.vendor_credit_refund_id;
        if (vcId && needsFetch('vendorcredit_', { ...vc, vendor_credit_id: vcId }, 'vendor_credit_id')) {
          toFetch.push({ type: 'vendorcredits', id: vcId, filePrefix: 'vendorcredit_' });
        }
      }
    }

    // 3. Fetch Details
    let fetchIndex = 0;
    while (fetchIndex < toFetch.length && getsUsed < MAX_GETS_PER_RUN) {
      const item = toFetch[fetchIndex];
      getsUsed++;
      try {
        const url = `${store.api_domain}/books/v3/${item.type}/${item.id}?organization_id=${ZOHO_DEFAULT_ORG_ID}`;
        const res = await secureZohoFetch(url, {
          headers: {
            'Authorization': `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (res.status === 429) {
          throw new Error("429");
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        
        const dataKey = item.type === 'invoices' ? 'invoice' : (item.type === 'bills' ? 'bill' : (item.type === 'creditnotes' ? 'creditnote' : 'vendor_credit'));
        const detail = data[dataKey] || data;
        fs.writeFileSync(path.join(DETAIL_CACHE_DIR, `${item.filePrefix}${item.id}.json`), JSON.stringify(detail, null, 2));
      } catch (e: any) {
        console.error(`Failed to fetch detail for ${item.type} ${item.id}`, e);
        if (e.message && e.message.includes("429")) {
          break; // Pause on rate limit
        }
      }
      fetchIndex++;
    }

    const remaining = toFetch.length - fetchIndex;
    const isPaused = remaining > 0;

    const universeSize = (listCache.invoices?.length || 0) + (listCache.bills?.length || 0) + (listCache.creditnotes?.length || 0) + (listCache.vendorcredits?.length || 0);
    const report = {
      status: isPaused ? "paused" : "completed",
      universe: universeSize,
      cachedBeforeRun: universeSize - toFetch.length,
      getsUsed,
      remaining,
      newlyFetched: fetchIndex,
      totalCachedNow: universeSize - remaining
    };

    return NextResponse.json(report);

  } catch (error: any) {
    console.error("Zoho Sync API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
