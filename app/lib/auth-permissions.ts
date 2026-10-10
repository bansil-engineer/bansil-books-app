// ============================================================
// Bansil Books — OA-U2 Permission Model (server-side, deny-by-default)
//
// Keeps the existing wire format used by the JWT, AuthProvider and the
// UserManagementView permission matrix:
//   "*"                     → all modules, all functions
//   "dashboard"             → dashboard, all functions
//   "dashboard:view,export" → dashboard, view + export only
//
// Adds:
//   - strict validation (unknown modules/functions are rejected, never
//     silently ignored)
//   - a viewer ceiling: role "viewer" can only ever view/export
//   - "*" grants only for role "admin"
//   - category diffing for the audit log (module vs function changes)
// ============================================================

import { ALL_MODULES, MODULE_FUNCTIONS } from "./auth.ts";

export type Role = "super_admin" | "admin" | "viewer";
/** Roles the Owner may assign. super_admin is never assignable. */
export const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "viewer"] as const;
export const VIEWER_FUNCTION_CEILING: readonly string[] = ["view", "export"];

const MODULE_SET = new Set<string>(ALL_MODULES);
const FUNCTION_SET = new Set<string>(MODULE_FUNCTIONS);

/** Normalized permission grant: module ("*" allowed) → functions ("*" = all). */
export interface PermissionGrant {
  module: string;
  functions: "*" | string[];
}

export type ParseResult =
  | { ok: true; grants: PermissionGrant[] }
  | { ok: false; error: string };

/** Parse and strictly validate the client-supplied modules array. */
export function parsePermissions(input: unknown, role: Role): ParseResult {
  if (!Array.isArray(input)) return { ok: false, error: "modules must be an array" };
  if (input.length > 64) return { ok: false, error: "Too many permission entries" };

  const byModule = new Map<string, PermissionGrant>();
  for (const raw of input) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) {
      return { ok: false, error: "Invalid permission entry" };
    }
    const [mod, fnPart, extra] = raw.split(":");
    if (extra !== undefined) return { ok: false, error: `Invalid permission entry "${raw}"` };

    if (mod === "*") {
      if (fnPart !== undefined) return { ok: false, error: `"*" cannot be combined with functions` };
      if (role !== "admin") return { ok: false, error: `Only the admin role may be granted "*"` };
      byModule.set("*", { module: "*", functions: "*" });
      continue;
    }
    if (!MODULE_SET.has(mod)) return { ok: false, error: `Unknown module "${mod}"` };

    let functions: "*" | string[] = "*";
    if (fnPart !== undefined) {
      const fns = Array.from(new Set(fnPart.split(",").map((f) => f.trim()).filter(Boolean)));
      if (fns.length === 0) return { ok: false, error: `No functions given for "${mod}"` };
      for (const f of fns) {
        if (!FUNCTION_SET.has(f)) return { ok: false, error: `Unknown function "${f}" for "${mod}"` };
      }
      functions = fns.length === MODULE_FUNCTIONS.length ? "*" : fns.sort();
    }

    if (byModule.has(mod)) return { ok: false, error: `Duplicate entry for module "${mod}"` };
    byModule.set(mod, { module: mod, functions });
  }

  let grants = Array.from(byModule.values());
  if (byModule.has("*")) grants = [{ module: "*", functions: "*" }];

  // Viewer ceiling — reject rather than silently trimming, so the Owner
  // always sees exactly what was stored.
  if (role === "viewer") {
    for (const g of grants) {
      const fns = g.functions === "*" ? [...MODULE_FUNCTIONS] : g.functions;
      const over = fns.filter((f) => !VIEWER_FUNCTION_CEILING.includes(f));
      if (over.length) {
        return {
          ok: false,
          error: `Viewer role is limited to view/export; "${g.module}" requests ${over.join(", ")}`,
        };
      }
    }
  }

  grants.sort((a, b) => a.module.localeCompare(b.module));
  return { ok: true, grants };
}

/**
 * Import helper: narrow legacy viewer grants to the viewer ceiling.
 * Only ever REMOVES functions; entries with nothing left are dropped.
 * Non-array / non-string input is passed through for parsePermissions
 * to reject.
 */
export function capToViewerCeiling(input: unknown): { modules: unknown; capped: boolean } {
  if (!Array.isArray(input)) return { modules: input, capped: false };
  let capped = false;
  const out: unknown[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") {
      out.push(raw);
      continue;
    }
    if (raw === "*") {
      capped = true;
      for (const m of ALL_MODULES) out.push(`${m}:${VIEWER_FUNCTION_CEILING.join(",")}`);
      continue;
    }
    const [mod, fnPart] = raw.split(":");
    const fns = fnPart === undefined ? [...MODULE_FUNCTIONS] : fnPart.split(",").map((f) => f.trim());
    const kept = fns.filter((f) => VIEWER_FUNCTION_CEILING.includes(f));
    if (kept.length !== fns.length) capped = true;
    if (kept.length) out.push(`${mod}:${kept.join(",")}`);
  }
  return { modules: out, capped };
}

/** Grants → existing string-array wire format (JWT / UI). */
export function grantsToModuleStrings(grants: PermissionGrant[]): string[] {
  return grants.map((g) =>
    g.module === "*" ? "*" : g.functions === "*" ? g.module : `${g.module}:${g.functions.join(",")}`,
  );
}

/**
 * Deny-by-default authorization decision.
 * super_admin (the Owner) is always allowed. Everyone else needs an
 * explicit grant; viewer is additionally capped at view/export.
 */
export function isAllowed(role: string, moduleStrings: string[], mod: string, fn: string): boolean {
  if (role === "super_admin") return true;
  if (role !== "admin" && role !== "viewer") return false;
  if (!MODULE_SET.has(mod) || !FUNCTION_SET.has(fn)) return false;
  if (role === "viewer" && !VIEWER_FUNCTION_CEILING.includes(fn)) return false;

  for (const entry of moduleStrings) {
    if (entry === "*") return role === "admin";
    const [m, fns] = entry.split(":");
    if (m !== mod) continue;
    if (fns === undefined) return true;
    return fns.split(",").includes(fn);
  }
  return false;
}

/** Which permission categories differ between two grant sets (for the audit log). */
export function diffPermissionCategories(before: PermissionGrant[], after: PermissionGrant[]): string[] {
  const modsA = new Set(before.map((g) => g.module));
  const modsB = new Set(after.map((g) => g.module));
  const modulesChanged = modsA.size !== modsB.size || [...modsA].some((m) => !modsB.has(m));

  const fnKey = (g: PermissionGrant) => (g.functions === "*" ? "*" : g.functions.join(","));
  const mapA = new Map(before.map((g) => [g.module, fnKey(g)]));
  let functionsChanged = false;
  for (const g of after) {
    if (mapA.has(g.module) && mapA.get(g.module) !== fnKey(g)) functionsChanged = true;
  }
  const out: string[] = [];
  if (modulesChanged) out.push("module_permissions");
  if (functionsChanged) out.push("function_permissions");
  return out;
}
