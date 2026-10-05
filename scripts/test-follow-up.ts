import { classifyIntent } from "../app/lib/ai/ceo/planning-engine";

function getEffectiveMessage(message: string, history: any[]) {
  let effectiveMessage = message;
  let intent = classifyIntent(message);

  if (history.length > 0) {
    const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
    const lower = message.toLowerCase();
    const hasTimeIndicator = lower.includes("month") || lower.includes("week") || lower.includes("today") || lower.includes("yesterday") || lower.includes("fy") || lower.includes("year");

    if (lastUserMsg) {
      if (intent === "DIRECT_CHAT") {
        const combinedIntent = classifyIntent(lastUserMsg.content + " " + message);
        if (combinedIntent !== "DIRECT_CHAT") {
          intent = combinedIntent;
          if (!hasTimeIndicator) {
            effectiveMessage = message + " " + lastUserMsg.content;
          }
        }
      } else if (!hasTimeIndicator) {
        effectiveMessage = message + " " + lastUserMsg.content;
      }
    }
  }
  return { intent, effectiveMessage };
}

console.log(getEffectiveMessage("can you give all data structured in table format?", [{role: 'user', content: 'last month sale?'}]));
console.log(getEffectiveMessage("show top 5 customers also", [{role: 'user', content: 'last month sale?'}]));
console.log(getEffectiveMessage("how much payable?", [{role: 'user', content: 'last month sale?'}]));
console.log(getEffectiveMessage("show top customers this month", [{role: 'user', content: 'last month sale?'}]));
console.log(getEffectiveMessage("last month sale?", []));
