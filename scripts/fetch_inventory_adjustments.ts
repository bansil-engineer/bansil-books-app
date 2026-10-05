import * as fs from 'fs';
import * as path from 'path';
const envContent = fs.readFileSync('.env.local', 'utf-8');
envContent.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length > 0) {
        process.env[key.trim()] = vals.join('=').trim().replace(/^"|"$/g, '');
    }
});

import { getValidAccessToken } from '../app/lib/zoho-api';
import { secureZohoFetch } from '../app/lib/zoho-security-guard';

const SURVIVING_IDS = [
    "3166667000019647237",
    "3166667000019647191",
    "3166667000019647152",
    "3166667000019595949",
    "3166667000019647044",
    "3166667000019395148",
    "3166667000019394338",
    // Target specific IDs
    "3166667000019328230", // 19 Sep
    "3166667000019273050", // 19 Sep
    "3166667000019284224", // 19 Sep
];

async function main() {
    try {
        const { token, store } = await getValidAccessToken();
        const orgId = store.organization_id || "774390949";

        for (const id of SURVIVING_IDS) {
            const url = `${store.api_domain}/books/v3/inventoryadjustments/${id}?organization_id=${orgId}`;
            const res = await secureZohoFetch(url, {
                headers: {
                    Authorization: `Zoho-oauthtoken ${token}`,
                    "Content-Type": "application/json",
                },
            });

            console.log(`\nID: ${id} - Status: ${res.status}`);
            if (res.ok) {
                const data = await res.json();
                const adj = data.inventory_adjustment || {};
                console.log(`Date: ${adj.date}, Reason: ${adj.reason}, Description: ${adj.description}`);
                console.log(`Total Value: ${adj.total}`);
                for (const line of (adj.line_items || [])) {
                    console.log(`  Item ID: ${line.item_id}, Name: ${line.name}, Qty: ${line.quantity_adjusted}, Value: ${line.item_total}`);
                }
            } else {
                if (res.status === 404) {
                    console.log("Not found (Deleted).");
                } else {
                    console.log(await res.text());
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

main();
