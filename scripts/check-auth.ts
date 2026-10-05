import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clientId = process.env.ZOHO_CLIENT_ID;
const clientSecret = process.env.ZOHO_CLIENT_SECRET;

console.log('Client ID: ' + (clientId ? 'PRESENT' : 'MISSING'));
console.log('Client secret: ' + (clientSecret ? 'PRESENT' : 'MISSING'));

const tokenFile = path.join(process.cwd(), '.tokens.json');
let tokenStore: any = null;

if (fs.existsSync(tokenFile)) {
  console.log('Token store: PRESENT');
  try {
    const raw = fs.readFileSync(tokenFile, 'utf-8');
    tokenStore = JSON.parse(raw);
    console.log('Token store fields: ' + Object.keys(tokenStore).join(', '));
    const now = Date.now();
    const isExpired = now >= tokenStore.expires_at;
    console.log('Access token state: ' + (isExpired ? 'EXPIRED' : 'VALID'));
  } catch (e) {
    console.log('Token parse error:', e.message);
  }
} else {
  console.log('Token store: MISSING');
}
