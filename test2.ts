import { handleOwnerMessage } from "./app/lib/ai/ceo/ceo-orchestrator";
async function test() {
  try {
    const res = await handleOwnerMessage("last month sale?", []);
    console.log("Success:", res);
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
