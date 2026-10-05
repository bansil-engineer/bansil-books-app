# Standalone AI Orchestrator

This add-on runs independently from Bansil Books. It does not modify the existing application, its package configuration, databases, environment file, or port 3000 server.

## Setup

Requirements: Node.js 22.5+, Python 3.10+, and API keys for the AI providers you enable. Antigravity execution requires a Gemini API key.

```sh
cd tools/chatgpt-antigravity-orchestrator
/opt/homebrew/bin/python3.11 -m venv .venv
.venv/bin/python -m pip install -r bridge/requirements.txt
.venv/bin/python bridge/antigravity_bridge.py --check
```

Export configuration in the terminal used to start the add-on. Do not put secrets in the Bansil Books `.env.local` file:

```sh
export ORCHESTRATOR_PORT=3010
export ORCHESTRATOR_OWNER_TOKEN='use-a-long-random-local-token'
export ORCHESTRATOR_PROJECT_DIR='/Users/balkrishnapjoshi/Documents/Antigravity/bansil-books-zoho-test'
export ORCHESTRATOR_OPENAI_MODEL='your-structured-output-capable-model'
export ORCHESTRATOR_CLAUDE_MODEL='your-claude-model'
export ORCHESTRATOR_PYTHON="$PWD/.venv/bin/python"
export OPENAI_API_KEY='your-openai-key'
export GEMINI_API_KEY='your-gemini-key'
export ANTHROPIC_API_KEY='your-claude-key'
npm start
```

Open `http://127.0.0.1:3010`. The dashboard asks for the owner token. It remains in browser session storage only.

The dashboard saves or replaces each API key independently. Its separate workflow control enables or disables ChatGPT, Claude, and Antigravity without changing stored keys or task history. ChatGPT or Claude can be assigned as Planner or Reviewer / Auditor. Antigravity is the Executor. A selected Planner or Reviewer must be enabled; creating a task while Antigravity is disabled is blocked before the task is queued. Dashboard-entered API keys are stored locally in `data/api-keys.enc`, encrypted with AES-256-GCM using the owner token, restricted to the current OS user, and loaded automatically after restart. Keep the same owner token; changing it prevents the vault from being unlocked. The dashboard never returns saved key values to the browser.

## Safety and state

Task history is stored only in this folder at `data/orchestrator.db`. In unattended mode, only the first plan requires `ACCEPT`; project-scoped inspection, edits, test commands, normal reviews, later plans, and extra rounds continue automatically. Destructive, credential, external write, deployment, and reviewer `HUMAN` actions still pause. `REJECT` stops the task without undoing earlier approved operations. `UNTOUCH` leaves it paused. An interrupted task is marked failed at the next startup and is never replayed.

The Antigravity process receives a small environment that excludes OpenAI and Zoho credentials. It exposes only minimal engineering tools, disables daemons, limits commands to two minutes, and asks for owner approval for every tool call.

Run local workflow tests with:

```sh
npm test
```
