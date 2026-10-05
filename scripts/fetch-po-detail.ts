import { secureZohoFetch } from '../app/lib/zoho-security-guard.ts';
import { getValidAccessToken } from '../app/lib/zoho-api.ts';
import * as fs from 'fs';

async function run() {
  try {
    const { token, store } = await getValidAccessToken();
    const domain = store.api_domain;
    const orgId = '774390949';
    
    const poId = '3166667000019215010';
    const url = `${domain}/books/v3/purchaseorders/${poId}?organization_id=${orgId}`;
    
    const res = await secureZohoFetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
    });
    
    const data = await res.json();
    fs.writeFileSync('scratch/po-2627289.json', JSON.stringify(data.purchaseorder || data, null, 2));
    console.log("Saved PO detail to scratch/po-2627289.json");
  } catch (e) {
    console.error(e);
  }
}
run();
