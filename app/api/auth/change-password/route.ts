import { NextRequest, NextResponse } from "next/server";
import {
  verifyToken,
  authenticate,
  generateSalt,
  hashPassword,
  getAllUsers,
  AUTH_COOKIE_NAME,
} from "../../../lib/auth.ts";
import { isDbStore, runDbHandler } from "../../../lib/auth-guard.ts";
import { dbChangePassword } from "../../../lib/auth-service.ts";

export async function POST(request: NextRequest) {
  // OA-U2: DB store persists immediately and ends other sessions at their next
  // server-side session check (auth/account routes in Phase 1); no AUTH_USERS
  // JSON is ever returned.
  if (isDbStore()) return runDbHandler(request, dbChangePassword);

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { currentPassword, newPassword } = await request.json();

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: "Both current and new password are required" },
      { status: 400 }
    );
  }

  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "New password must be at least 8 characters" },
      { status: 400 }
    );
  }

  // Verify current password
  const user = authenticate(payload.sub, currentPassword);
  if (!user) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 }
    );
  }

  // Generate new hash
  const salt = generateSalt();
  const hash = hashPassword(newPassword, salt);

  // Build updated users array
  const users = getAllUsers().map((u) => {
    if (u.email.toLowerCase() === payload.sub.toLowerCase()) {
      return { ...u, salt, hash };
    }
    return u;
  });

  // Return the new AUTH_USERS value for the user to update in their env vars
  return NextResponse.json({
    ok: true,
    message:
      "Password hash generated. Update AUTH_USERS environment variable with the value below, then redeploy.",
    AUTH_USERS: JSON.stringify(users),
  });
}
