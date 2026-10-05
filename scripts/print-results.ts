import { executeFastPathQuery } from '../app/lib/ai/ceo/fast-path-tools';
import { resolvePeriod } from '../app/lib/ai/ceo/date-resolver';
async function run() {
  console.log(await executeFastPathQuery("SALES_QUERY", "last month sale?"));
  console.log("-----");
  console.log(await executeFastPathQuery("PURCHASE_QUERY", "last month purchase?"));
  console.log("-----");
  console.log(await executeFastPathQuery("CUSTOMER_QUERY", "top 5 customers last month"));
  console.log("-----");
  console.log(await executeFastPathQuery("VENDOR_QUERY", "top 5 vendors last month"));
}
run();
