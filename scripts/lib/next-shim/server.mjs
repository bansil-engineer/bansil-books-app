// TEST-ONLY minimal stand-in for "next/server", used by scripts/oa-rbac-2a-tests.ts
// ONLY when the real `next` package is not installed. Implements just what the
// route handlers under test touch. Never imported by the application.

function parseCookies(header) {
  const map = new Map();
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return map;
}

export class NextRequest extends Request {
  constructor(input, init) {
    super(input, init);
    const jar = parseCookies(this.headers.get("cookie"));
    this.cookies = {
      get: (name) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      has: (name) => jar.has(name),
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    };
    this.nextUrl = new URL(this.url);
  }
}

export class NextResponse extends Response {
  constructor(body, init) {
    super(body, init);
    const headers = this.headers;
    this.cookies = {
      set(name, value, opts = {}) {
        let c = `${name}=${encodeURIComponent(value)}; Path=${opts.path || "/"}`;
        if (opts.maxAge !== undefined) c += `; Max-Age=${opts.maxAge}`;
        if (opts.httpOnly) c += "; HttpOnly";
        headers.append("Set-Cookie", c);
      },
      delete(name) {
        headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0`);
      },
    };
  }
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
  static next() {
    return new NextResponse(null, { status: 200 });
  }
  static redirect(url, status = 307) {
    return new NextResponse(null, { status, headers: { Location: String(url) } });
  }
}
