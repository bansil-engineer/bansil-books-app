import { NextRequest, NextResponse } from "next/server";
import { destroyOwnerSession, OWNER_SESSION_COOKIE } from "@/app/lib/audit/owner-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(OWNER_SESSION_COOKIE)?.value;
  destroyOwnerSession(token);
  const res = NextResponse.json({ success: true });
  res.cookies.delete(OWNER_SESSION_COOKIE);
  return res;
}
