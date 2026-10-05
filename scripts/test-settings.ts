import { getDatabase, getFeatureSettings, updateFeatureSetting } from "../app/lib/db/database.ts";

function run() {
  const db = getDatabase();
  console.log("Before:", getFeatureSettings(db)["sub_audit_workspaces"]);
  updateFeatureSetting(db, "sub_audit_workspaces", false);
  console.log("After OFF:", getFeatureSettings(db)["sub_audit_workspaces"]);
  updateFeatureSetting(db, "sub_audit_workspaces", true);
  console.log("After ON:", getFeatureSettings(db)["sub_audit_workspaces"]);
}

run();
