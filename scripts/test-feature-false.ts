import { getFeatureSettings, updateFeatureSetting } from "../app/lib/db/database";

const key = "test_feature_key";
try {
  updateFeatureSetting(undefined, key, false);
  const settings = getFeatureSettings();
  if (settings[key] === false) {
    console.log("PASS: DB handles false correctly");
  } else {
    console.log("FAIL: DB treated false as", settings[key]);
  }
} catch (e) {
  console.log("FAIL:", e);
}
