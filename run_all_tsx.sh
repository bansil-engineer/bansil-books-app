#!/bin/bash
set -e
export AI_WORKSPACE_DB_PATH="/tmp/test_ai_workspace.db"
export ESTIMATION_DB_PATH="/tmp/test_estimation.sqlite"
echo "Hashing DBs before..."
shasum -a 256 data/bansil_books.db data/audit_workspace.db data/ai_workspace.db > before_hash.txt

npx --yes tsx scripts/phase-4c-scope-boq-tests.ts || echo "4C FAILED"
npx --yes tsx scripts/phase-4b-tender-intake-tests.ts || echo "4B FAILED"
npx --yes tsx scripts/phase-4a-estimation-foundation-tests.ts || echo "4A FAILED"


# Run others to see if any fail
npx --yes tsx scripts/phase-3d-proactive-recovery-tests.ts || echo "3D FAILED"
npx --yes tsx scripts/phase-3c-ai-cost-routing-tests.ts || echo "3C FAILED"
npx --yes tsx scripts/phase-3b-independent-checker-tests.ts || echo "3B FAILED"
npx --yes tsx scripts/phase-3a-ceo-governance-tests.ts || echo "3A FAILED"

npx --yes tsx scripts/phase-2a-workforce-budget-tests.ts || echo "2A FAILED"
npx --yes tsx scripts/phase-2b-memory-agent-reuse-tests.ts || echo "2B FAILED"
npx --yes tsx scripts/phase-2c-autonomous-lifecycle-tests.ts || echo "2C FAILED"
npx --yes tsx scripts/phase-2d-capability-tool-tests.ts || echo "2D FAILED"
npx --yes tsx scripts/phase-2e-source-discovery-tests.ts || echo "2E FAILED"
npx --yes tsx scripts/phase-2g-fast-path-tests.ts || echo "2G FAILED"
npx --yes tsx scripts/phase-2h-response-contract-tests.ts || echo "2H FAILED"

npm run test:security || echo "SEC FAILED"
npm run build || echo "BUILD FAILED"

echo "Hashing DBs after..."
shasum -a 256 data/bansil_books.db data/audit_workspace.db data/ai_workspace.db > after_hash.txt
