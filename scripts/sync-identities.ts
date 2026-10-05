import fs from 'node:fs';
import path from 'node:path';
import { getValidAccessToken } from '../app/lib/zoho-api.ts';

async function syncIdentities() {
  const tokenInfo = await getValidAccessToken();
  const orgId = process.env.ZOHO_ORGANIZATION_ID || '774390949';
  const url = `https://www.zohoapis.com/books/v3/users?organization_id=${orgId}`;
  
  console.log('Fetching users...');
  const res = await fetch(url, { headers: { 'Authorization': `Zoho-oauthtoken ${tokenInfo.token}` } });
  const data = await res.json();
  
  if (!data.users) {
    console.error('Failed to fetch users:', data);
    return;
  }
  
  const users = data.users;
  const cacheMap: Record<string, string> = {};
  for (const user of users) {
    cacheMap[user.user_id] = user.name;
  }
  
  const cachePath = path.join(process.cwd(), 'data', 'zoho-users-cache.json');
  fs.writeFileSync(cachePath, JSON.stringify(cacheMap, null, 2), 'utf-8');
  console.log(`Saved ${Object.keys(cacheMap).length} identities to data/zoho-users-cache.json`);
}

syncIdentities().catch(console.error);
