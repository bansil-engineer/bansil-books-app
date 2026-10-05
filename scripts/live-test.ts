
async function runLiveTest() {
  console.log("\n=== LIVE NEW EXECUTION TEST ===");

  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch("http://localhost:3000/api/ai/chat");
      if (res.status !== 405) { // POST is expected, so GET should be 405
         break;
      }
    } catch (e) {
      if (i === maxRetries - 1) {
        console.error("Server not reachable after retries.");
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log("Server is up. Sending chat request...");

  const chatResponse = await fetch("http://localhost:3000/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "analise FY 2025-26 balance sheet",
      conversationId: ""
    })
  });

  if (!chatResponse.ok) {
    console.error("Chat request failed:", chatResponse.status);
    process.exit(1);
  }

  const chatData = (await chatResponse.json()) as any;
  const reply = chatData.reply || chatData.response || chatData.message || chatData;
  console.log("\n--- CEO RESPONSE ---");
  console.log(reply.content || reply.text || reply);
  console.log("--------------------\n");

  const runId = chatData.runId || (reply && reply.runId);
  console.log("Run ID:", runId);

  console.log("\n=== REFRESH PERSISTENCE TEST ===");
  // Fetch run details via API
  const runsResponse = await fetch(`http://localhost:3000/api/ai/runs/${runId}`);
  if (!runsResponse.ok) {
     console.error("Failed to fetch runs:", runsResponse.status);
     process.exit(1);
  }
  const runsData = (await runsResponse.json()) as any;
  const fetchedRun = runsData.run || runsData;
  
   
  if (!fetchedRun) {
    console.error("Run not found in API response!");
    process.exit(1);
  }
  
  console.log(`Found Run in API: ${fetchedRun.id}`);
  console.log(`Reviewer Status: ${fetchedRun.reviewer_status}`);
  
  const tasksResponse = await fetch(`http://localhost:3000/api/ai/runs/${runId}/tasks`);
  if (!tasksResponse.ok) {
     console.error("Failed to fetch tasks:", tasksResponse.status);
     process.exit(1);
  }
  const tasksData = (await tasksResponse.json()) as any;
  const tasks = tasksData.tasks || tasksData;
  
  console.log(`Tasks for run: ${tasks.length}`);
  for (const t of tasks) {
    console.log(` - [${t.department}] ${t.objective} (Status: ${t.status})`);
  }
  
  console.log("\nTEST COMPLETED");
}

runLiveTest().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});
