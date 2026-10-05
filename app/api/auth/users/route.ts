import { NextRequest, NextResponse } from "next/server";
import {
  verifyToken,
  getAllUsers,
  generateSalt,
  hashPassword,
  AUTH_COOKIE_NAME,
} from "../../../lib/auth.ts";

function requireSuperAdmin(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || payload.role !== "super_admin") return null;
  return payload;
}

// List all users (sans password hashes)
export async function GET(request: NextRequest) {
  const admin = requireSuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = getAllUsers().map(({ salt, hash, ...rest }) => rest);
  return NextResponse.json({ users });
}

// Add a new user — returns updated AUTH_USERS JSON for env var
export async function POST(request: NextRequest) {
  const admin = requireSuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, name, password, role, modules } = await request.json();

  if (!email || !name || !password) {
    return NextResponse.json(
      { error: "email, name, and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const validRoles = ["admin", "viewer"];
  const userRole = validRoles.includes(role) ? role : "viewer";
  const userModules = Array.isArray(modules) ? modules : ["dashboard"];

  const existing = getAllUsers();
  if (existing.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return NextResponse.json(
      { error: "User with this email already exists" },
      { status: 409 }
    );
  }

  const salt = generateSalt();
  const hash = hashPassword(password, salt);

  const updated = [
    ...existing,
    { email, name, role: userRole, salt, hash, modules: userModules },
  ];

  return NextResponse.json({
    ok: true,
    message:
      "User created. Update AUTH_USERS env var with the value below, then redeploy.",
    AUTH_USERS: JSON.stringify(updated),
  });
}

// Delete a user — returns updated AUTH_USERS JSON
export async function DELETE(request: NextRequest) {
  const admin = requireSuperAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email } = await request.json();
  if (!email) {
    return NextResponse.json(
      { error: "email is required" },
      { status: 400 }
    );
  }

  // Cannot delete yourself
  if (email.toLowerCase() === admin.sub.toLowerCase()) {
    return NextResponse.json(
      { error: "Cannot delete your own account" },
      { status: 400 }
    );
  }

  const updated = getAllUsers().filter(
    (u) => u.email.toLowerCase() !== email.toLowerCase()
  );

  return NextResponse.json({
    ok: true,
    message: "User removed. Update AUTH_USERS env var with the value below.",
    AUTH_USERS: JSON.stringify(updated),
  });
}
