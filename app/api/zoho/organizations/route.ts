// GET /api/zoho/organizations
// Fetches the list of accessible Zoho Books organizations.
// If ZOHO_DEFAULT_ORG_ID is set and matches exactly one org in the account,
// it is flagged as the suggested org — but the final selection is always
// confirmed via POST /api/zoho/select-org, which re-validates against the live list.

import { NextResponse } from "next/server";
import { fetchOrganizations } from "@/app/lib/zoho-api";

export async function GET() {
  try {
    const organizations = await fetchOrganizations();

    // If a default org ID hint is configured, flag which one it points to.
    // The UI can use this to pre-select, but must still call select-org to confirm.
    const defaultOrgId = process.env.ZOHO_DEFAULT_ORG_ID;
    const suggestedOrgId =
      defaultOrgId && organizations.find((o) => o.organization_id === defaultOrgId)
        ? defaultOrgId
        : undefined;

    if (suggestedOrgId) {
      console.log(
        `[API/organizations] ZOHO_DEFAULT_ORG_ID (${defaultOrgId}) found in account.`
      );
    } else if (defaultOrgId) {
      console.warn(
        `[API/organizations] ZOHO_DEFAULT_ORG_ID (${defaultOrgId}) is set but ` +
        `was NOT found among the ${organizations.length} organization(s) in this account.`
      );
    }

    return NextResponse.json({ organizations, suggestedOrgId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch organizations";
    console.error("[API/organizations]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
