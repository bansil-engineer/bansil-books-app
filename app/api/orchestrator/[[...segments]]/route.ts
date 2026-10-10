import * as path from "node:path";
import { Store } from "@/tools/chatgpt-antigravity-orchestrator/src/store.ts";
import { runTask } from "@/tools/chatgpt-antigravity-orchestrator/src/engine.ts";
import { configStatus, configureSecret, configureSecrets, configureWorkflow, currentSecrets, usageStatus, workflowStatus } from "@/tools/chatgpt-antigravity-orchestrator/src/providers.ts";
import { SecretsVault } from "@/tools/chatgpt-antigravity-orchestrator/src/secrets.ts";
import { WorkflowError } from "@/tools/chatgpt-antigravity-orchestrator/src/types.ts";
import type { Decision } from "@/tools/chatgpt-antigravity-orchestrator/src/types.ts";
import { guardRoute } from "@/app/lib/route-guard";
import { policyFor } from "@/app/lib/route-policy-manifest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Active = { promise: Promise<void>; controller: AbortController };
type RuntimeState = { store: Store; vault: SecretsVault; active: Map<string, Active>; token: string };
const globalRuntime = globalThis as typeof globalThis & { __bansilOrchestrator?: RuntimeState };

function runtimeState() {
  if (globalRuntime.__bansilOrchestrator) return globalRuntime.__bansilOrchestrator;
  const root = process.cwd();
  process.env.ORCHESTRATOR_PROJECT_DIR ||= root;
  process.env.ORCHESTRATOR_PYTHON ||= path.join(root, "tools/chatgpt-antigravity-orchestrator/.venv/bin/python");
  process.env.ORCHESTRATOR_OPENAI_MODEL ||= "gpt-4.1-mini";
  process.env.ORCHESTRATOR_CLAUDE_MODEL ||= "claude-sonnet-5";
  const token = process.env.ORCHESTRATOR_OWNER_TOKEN || "bansil-orchestrator-owner-20260918";
  const dataDir = path.join(root, "tools/chatgpt-antigravity-orchestrator/data");
  const vault = new SecretsVault(token, path.join(dataDir, "api-keys.enc"));
  const saved = vault.load();
  configureSecrets(saved.openai || process.env.OPENAI_API_KEY || "", saved.gemini || process.env.GEMINI_API_KEY || "", saved.claude || process.env.ANTHROPIC_API_KEY || "");
  const store = new Store(path.join(dataDir, "orchestrator.db"));
  store.recover();
  globalRuntime.__bansilOrchestrator = { store, vault, active: new Map(), token };
  return globalRuntime.__bansilOrchestrator;
}

function startQueued(state: RuntimeState) {
  if (state.active.size) return;
  const task = state.store.claim();
  if (!task) return;
  const controller = new AbortController();
  const promise = runTask(state.store, task, undefined, controller.signal).finally(() => {
    state.active.delete(task.id);
    startQueued(state);
  });
  state.active.set(task.id, { promise, controller });
}

function saveSecrets(state: RuntimeState) { state.vault.save(currentSecrets()); }
function response(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
async function payload(request: Request) {
  const text = await request.text();
  if (text.length > 20000) throw new WorkflowError("Request too large", 413);
  const value = text ? JSON.parse(text) : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowError("Invalid JSON", 400);
  return value as Record<string, unknown>;
}
function auth(request: Request, state: RuntimeState) { if (request.headers.get("x-orchestrator-token") !== state.token) throw new WorkflowError("Owner token required", 401); }
type Context = { params: Promise<{ segments?: string[] }> };

async function handle(request: Request, context: Context) {
  // OA-RBAC-2a: centralized server-side authorization (live session + permission check)
  const rbacGuard = await guardRoute(request, policyFor("orchestrator/[[...segments]]", request.method), "orchestrator/[[...segments]] (dispatch)");
  if (!rbacGuard.ok) return rbacGuard.response;
  try {
    const state = runtimeState(); auth(request, state);
    const segments = (await context.params).segments || [];
    const route = segments.join("/");
    if (request.method === "GET" && route === "tasks") return response({ tasks: state.store.list(), configuration: configStatus(), workflow: workflowStatus(), usage: usageStatus(), site: { live: true, status: 200, url: new URL(request.url).origin, checkedAt: new Date().toISOString() } });
    if (request.method === "GET" && segments[0] === "tasks" && segments.length === 2) return response({ task: state.store.get(segments[1]), approval: state.store.pending(segments[1]), history: state.store.history(segments[1]) });
    if (request.method !== "POST") return response({ error: "Not found" }, 404);
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new WorkflowError("Same-origin request required", 403);
    const body = await payload(request);
    if (route === "config/key") { const provider = String(body.provider); if (!['openai','gemini','claude'].includes(provider) || typeof body.key !== 'string' || body.key.trim().length < 20) throw new WorkflowError("Select a provider and enter a valid API key.", 400); configureSecret(provider as 'openai'|'gemini'|'claude', body.key); saveSecrets(state); return response({ configuration: configStatus(), workflow: workflowStatus() }); }
    if (route === "config/clear") { configureSecrets("", "", ""); saveSecrets(state); return response({ configuration: configStatus(), workflow: workflowStatus() }); }
    if (route === "workflow") { if (typeof body.chatgpt !== 'boolean' || typeof body.claude !== 'boolean' || typeof body.antigravity !== 'boolean' || !['chatgpt','claude'].includes(String(body.planner)) || !['chatgpt','claude'].includes(String(body.reviewer))) throw new WorkflowError("Invalid AI role configuration.", 400); configureWorkflow({ chatgpt: body.chatgpt, claude: body.claude, antigravity: body.antigravity, planner: body.planner as 'chatgpt'|'claude', reviewer: body.reviewer as 'chatgpt'|'claude' }); return response({ configuration: configStatus(), workflow: workflowStatus() }); }
    if (route === "tasks") { if (typeof body.request !== 'string' || typeof body.auto !== 'boolean' || typeof body.maxRounds !== 'number') throw new WorkflowError("request, auto and maxRounds required", 400); const task = state.store.create(body.request, body.auto, body.maxRounds); startQueued(state); return response({ task }, 201); }
    if (segments[0] === "tasks" && segments.length === 3) { const id = segments[1], action = segments[2]; if (action === "decision") return response({ task: state.store.decide(id, String(body.approvalId), String(body.decision) as Decision, String(body.note || "")) }); if (action === "delete") { state.store.remove(id); return response({ deleted: true }); } if (action === "pause") { const active = state.active.get(id); if (active) active.controller.abort("OWNER_PAUSE"); else state.store.pause(id); return response({ task: state.store.get(id) }); } if (action === "stop") { const active = state.active.get(id); if (active) active.controller.abort("OWNER_STOP"); else state.store.stop(id); return response({ task: state.store.get(id) }); } if (action === "resume") { const task = state.store.resume(id); startQueued(state); return response({ task }); } }
    return response({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof WorkflowError) return response({ error: error.message }, error.status);
    return response({ error: error instanceof Error ? error.message : "Request failed" }, 500);
  }
}
export const GET = handle;
export const POST = handle;
