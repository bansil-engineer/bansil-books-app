// POST /api/zoho/select-org
// Saves the selected organization to the token store.
// Also fetches org details to confirm the ID belongs to this authenticated account.
//
// Auto-selection hint: if ZOHO_DEFAULT_ORG_ID is set in env, the org list API
// will attempt to auto-select it — but only after confirming it exists in the
// authenticated account. This does not bypass the org-list fetch.

import { NextRequest, NextResponse } from "next/server";
import { fetchOrganizations } from "@/app/lib/zoho-api";
import { updateOrganization } from "@/app/lib/zoho-token-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { organizationId } = body as { organizationId: string };

    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required" },
        { status: 400 }
      );
    }

    // Always fetch the full org list and verify the requested ID belongs
    // to this authenticated account — never trust the client-supplied ID alone.
    const organizations = await fetchOrganizations();
    const org = organizations.find((o) => o.organization_id === organizationId);

    if (!org) {
      // Provide helpful context: list which org IDs ARE available
      const available = organizations
        .map((o) => `${o.name} (${o.organization_id})`)
        .join(", ");
      return NextResponse.json(
        {
          error:
            `Organization ID ${organizationId} was not found in this Zoho account. ` +
            `Available organizations: ${available || "none"}`,
        },
        { status: 404 }
      );
    }

    updateOrganization(
      org.organization_id,
      org.name,
      org.currency_code,
      org.currency_symbol
    );

    console.log(
      `[API/select-org] Organization confirmed and selected: ` +
      `${org.name} (ID: ${org.organization_id}, Currency: ${org.currency_code})`
    );

    return NextResponse.json({
      success: true,
      organization: {
        id: org.organization_id,
        name: org.name,
        currencyCode: org.currency_code,
        currencySymbol: org.currency_symbol,
        country: org.country,
        timeZone: org.time_zone,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to select organization";
    console.error("[API/select-org]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
