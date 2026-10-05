import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/settings/route";
import { getFeatureSettings, updateFeatureSetting, getDatabase } from "../app/lib/db/database";
import { FEATURE_REGISTRY } from "../app/lib/feature-registry";

async function runTests() {
  let passed = 0;
  let total = 0;
  const assert = (cond: boolean, msg: string) => {
    total++;
    if (cond) {
      passed++;
      console.log("✅ PASS:", msg);
    } else {
      console.log("❌ FAIL:", msg);
    }
  };

  const testKey = "sub_recon_master"; // A known safe child feature

  // 1. False Override
  updateFeatureSetting(undefined, testKey, false);
  let dbSettings = getFeatureSettings();
  assert(dbSettings[testKey] === false, "Database treats 0 as false");

  // Mock GET request
  const getRes = await GET();
  const getJson = await getRes.json();
  assert(getJson.settings[testKey] === false, "GET /api/settings passes explicit false");

  // 2. True Override
  updateFeatureSetting(undefined, testKey, true);
  dbSettings = getFeatureSettings();
  assert(dbSettings[testKey] === true, "Database treats 1 as true");

  const getRes2 = await GET();
  const getJson2 = await getRes2.json();
  assert(getJson2.settings[testKey] === true, "GET /api/settings passes explicit true");

  // 3. Unauthorized mutation blocked
  const reqUnauth = new NextRequest("http://localhost/api/settings", {
    method: "POST",
    body: JSON.stringify({ key: testKey, enabled: false })
  });
  const resUnauth = await POST(reqUnauth);
  assert(resUnauth.status === 401, "Unauthorized mutation blocked with 401");

  // 4. Locked mutation blocked
  const lockedKey = "module_reconciliation"; // Wait, is it locked? Let's find one
  const lockedDef = FEATURE_REGISTRY.find(f => f.server_guard_required);
  if (lockedDef) {
    const reqLocked = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { cookie: "bansil_owner_session=MOCK_TOKEN" }, // bypass auth check failure for missing cookie? No, we need a real cookie to test the locked guard, or we can mock it
      body: JSON.stringify({ key: lockedDef.feature_key, enabled: false })
    });
    // For this test we can't easily mock the session token without inserting one, so let's just insert one
    const db = getDatabase();
    const token = "MOCK_TOKEN";
    const nowIso = new Date(Date.now() + 100000).toISOString();
    db.prepare(`INSERT INTO audit_sessions (session_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?)`).run(token, nowIso, nowIso, nowIso);
    
    const reqLocked2 = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { cookie: `bansil_owner_session=${token}` },
      body: JSON.stringify({ key: lockedDef.feature_key, enabled: false })
    });
    const resLocked = await POST(reqLocked2);
    assert(resLocked.status === 403, "Locked mutation blocked with 403");
  }

  console.log(`\nTests passed: ${passed}/${total}`);
}

runTests();
