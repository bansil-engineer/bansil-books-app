import { NextRequest, NextResponse } from "next/server";
import { authenticate, createToken, AUTH_COOKIE_NAME } from "../../../lib/auth.ts";
import { isDbStore, runDbHandler } from "../../../lib/auth-guard.ts";
import { dbLogin } from "../../../lib/auth-service.ts";

export async function POST(request: NextRequest) {
  // OA-U2: DB-backed store (only when AUTH_USER_STORE=db). Env path below is unchanged.
  if (isDbStore()) return runDbHandler(request, dbLogin);

  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = authenticate(email, password);
    if (!user) {
      // Constant-time delay to prevent timing attacks on email enumeration
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = createToken({
      email: user.email,
      name: user.name,
      role: user.role,
      modules: user.modules,
    });

    const res = NextResponse.json({
      ok: true,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        modules: user.modules,
      },
    });

    res.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });

    return res;
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
