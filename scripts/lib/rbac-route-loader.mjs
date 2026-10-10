// OA-RBAC-2a — test-only Node module resolve hooks (used by scripts/oa-rbac-2a-tests.ts).
// Lets plain `node --experimental-strip-types` import real route handlers:
//   - "@/x"                 → <repo>/x(.ts|.tsx|.js|/index.ts)
//   - extensionless "./x"   → ./x(.ts|.tsx|.js|/index.ts)
//   - "next/server", "next/headers" → real package when installed, otherwise
//     the minimal shim in ./next-shim/ (tests only; never used by the app).
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let ROOT = "";
let SHIM_DIR = "";
let USE_SHIM = false;

export async function initialize(data) {
  ROOT = data.root;
  SHIM_DIR = data.shimDir;
  USE_SHIM = data.useShim;
}

const EXTS = [".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function tryResolve(base) {
  if (isFile(base)) return base;
  for (const e of EXTS) if (isFile(base + e)) return base + e;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server" || specifier === "next/headers") {
    if (USE_SHIM) {
      const f = path.join(SHIM_DIR, specifier === "next/server" ? "server.mjs" : "headers.mjs");
      return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    // Real package: Next 16 ships no "exports" map, so plain-Node ESM needs the
    // explicit ".js" file (found by the native macOS run, 2026-10-10).
    return nextResolve(`${specifier}.js`, context);
  }
  if (specifier.startsWith("@/")) {
    const f = tryResolve(path.join(ROOT, specifier.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!isFile(base)) {
      const f = tryResolve(base);
      if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export function nextAvailable(root) {
  return existsSync(path.join(root, "node_modules", "next", "server.js"));
}
