process.loadEnvFile('.env.local');
import { getSalesOrderByNumber } from '../app/lib/audit/accounts/zoho-read-transactions';

async function testRead() {
  const orgId = process.env.ZOHO_ORGANIZATION_ID || '774390949';
  if (!orgId) {
    console.error("Missing ZOHO_ORGANIZATION_ID");
    return;
  }
  
  try {
    const so = await getSalesOrderByNumber(orgId, "SO-2627124");
    if (so) {
      console.log("READ_SUCCESS");
      // console.log(JSON.stringify(so, null, 2));
    } else {
      console.log("NOT_FOUND");
    }
  } catch (error: any) {
    if (error.message && error.message.includes("scope")) {
      console.log("SCOPE_BLOCKED");
    } else if (error.message && error.message.includes("auth")) {
      console.log("AUTH_BLOCKED");
    } else {
      console.log("OTHER_ERROR:", error.message);
    }
  }
}

testRead();
