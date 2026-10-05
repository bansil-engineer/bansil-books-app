import { assertConnectionAllowed } from '@/app/lib/external-connections.cjs';
import { NextResponse } from "next/server";
import { readTokenStore } from "@/app/lib/zoho-token-store";
import { getDatabase, getSyncMetadata, getLatestSyncedDocumentDate } from "@/app/lib/db/database";
import { formatDisplayDateTime, formatDisplayDate } from "@/app/lib/date-utils";
import type { ConnectionStatus } from "@/app/types/zoho";

export async function GET() {
  let permitted = false;
  try { assertConnectionAllowed("zoho"); permitted = true; } catch { /* disconnected or unreadable policy */ }
  const store = permitted ? readTokenStore() : null;
  let lastSuccessfulSyncTime: string | null = null;
  let syncedThrough: string | null = null;

  try {
    const db = getDatabase();
    lastSuccessfulSyncTime = getSyncMetadata(db, "last_successful_sync_time");
    syncedThrough = getLatestSyncedDocumentDate(db);
  } catch {
    // DB offline fallback
  }

  const lastSyncAt = lastSuccessfulSyncTime ? formatDisplayDateTime(lastSuccessfulSyncTime) : null;
  const syncedThroughDisplay = syncedThrough ? formatDisplayDate(syncedThrough) : null;

  if (!store) {
    const status: ConnectionStatus = {
      connected: false,
      lastSyncAt,
      lastSuccessfulSyncTime,
      syncedThrough,
      syncedThroughDisplay,
    };
    return NextResponse.json(status);
  }

  const status: ConnectionStatus = {
    connected: true,
    organizationId: store.organization_id,
    organizationName: store.organization_name,
    currencyCode: store.currency_code,
    currencySymbol: store.currency_symbol,
    apiDomain: store.api_domain,
    location: store.location,
    accountsUrl: store.accounts_url,
    expiresAt: store.expires_at,
    lastSyncAt,
    lastSuccessfulSyncTime,
    syncedThrough,
    syncedThroughDisplay,
  };

  return NextResponse.json(status);
}
