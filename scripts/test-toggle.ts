import { getDatabase, getFeatureSettings, updateFeatureSetting } from "../app/lib/db/database.ts";
const db = getDatabase();

console.log("1. Initial state in DB:");
console.log(getFeatureSettings(db)["settings_modules_page"]);

console.log("\n2. Updating to OFF...");
updateFeatureSetting(db, "settings_modules_page", false, "OWNER");

console.log("\n3. DB state after OFF:");
console.log(getFeatureSettings(db)["settings_modules_page"]);

console.log("\n4. Updating to ON...");
updateFeatureSetting(db, "settings_modules_page", true, "OWNER");

console.log("\n5. DB state after ON:");
console.log(getFeatureSettings(db)["settings_modules_page"]);
