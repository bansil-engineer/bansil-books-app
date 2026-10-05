const fs = require('fs');
const files = [
  'app/api/ai/chat/route.ts',
  'app/lib/ai/ceo/ceo-orchestrator.ts',
  'app/lib/ai/ceo/execution-lifecycle.ts',
  'app/lib/ai/ceo/planning-engine.ts',
  'app/lib/ai/ceo/tool-executor.ts',
  'app/lib/ai/ceo/working-capital.ts',
  'app/lib/db/ai-database.ts'
];
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.split('\n').map(line => line.replace(/\s+$/, '')).join('\n');
  fs.writeFileSync(f, content);
});
