// TEST-ONLY stand-in for "next/headers" (see server.mjs). Request-scoped
// helpers are not available outside a real Next.js request.
export async function cookies() {
  throw new Error("next/headers cookies() is unavailable in the OA-RBAC-2a test harness");
}
export async function headers() {
  throw new Error("next/headers headers() is unavailable in the OA-RBAC-2a test harness");
}
