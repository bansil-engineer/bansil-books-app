import { secureZohoFetch } from '../app/lib/zoho-security-guard.ts';
import { getValidAccessToken } from '../app/lib/zoho-api.ts';
import * as fs from 'fs';

async function run() {
  try {
    const { token, store } = await getValidAccessToken();
    const domain = store.api_domain;
    const orgId = '774390949';
    
    const poId = '3166667000019215010';
    const submitterId = '3166667000018244032';

    // 1. Try fetching users
    try {
      const urlUser = `${domain}/books/v3/users/${submitterId}?organization_id=${orgId}`;
      const resUser = await secureZohoFetch(urlUser, {
        method: 'GET',
        headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
      });
      const dataUser = await resUser.json();
      console.log('--- USER DATA ---');
      console.log(JSON.stringify(dataUser, null, 2));
    } catch (e) {
      console.log('Error fetching user:', e.message);
    }

    // 2. Try fetching PO approvals (if endpoint exists)
    try {
      const urlApp = `${domain}/books/v3/purchaseorders/${poId}/approvals?organization_id=${orgId}`;
      const resApp = await secureZohoFetch(urlApp, {
        method: 'GET',
        headers: { 'Authorization': `Zoho-oauthtoken ${token}` }
      });
      const dataApp = await resApp.json();
      console.log('--- APPROVALS DATA ---');
      console.log(JSON.stringify(dataApp, null, 2));
    } catch (e) {
      console.log('Error fetching approvals:', e.message);
    }
  } catch (e) {
    console.error(e);
  }
}
run();
