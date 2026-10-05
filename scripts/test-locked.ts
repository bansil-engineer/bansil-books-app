import { NextRequest } from "next/server";
import { POST } from "../app/api/settings/route";
import { FEATURE_REGISTRY } from "../app/lib/feature-registry";

async function run() {
  const lockedDef = FEATURE_REGISTRY.find(f => f.server_guard_required);
  console.log("Locked def found:", lockedDef);
}
run();
