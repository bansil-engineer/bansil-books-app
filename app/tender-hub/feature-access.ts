import { DatabaseSync } from 'node:sqlite';
import { getBansilBooksDbPath } from '../lib/db/db-resolver';
import { isFeatureEffectivelyEnabled } from '../lib/feature-registry';
export const HUB_FEATURE = 'sub_est_tender_hub';
/** Read-only, fail-closed; never invoke legacy database initialisation/migrations. */
export function tenderHubEnabled(path = getBansilBooksDbPath()) {
    let db: DatabaseSync | undefined;
    try {
        db = new DatabaseSync(path, { readOnly: true });
        const settings: Record<string, boolean> = {};
        for (const row of db.prepare('SELECT feature_key,enabled FROM app_feature_settings').all())
            settings[String(row.feature_key)] = Boolean(row.enabled);
        return isFeatureEffectivelyEnabled(HUB_FEATURE, settings);
    }
    catch {
        return false;
    }
    finally {
        db?.close();
    }
}
