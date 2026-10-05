// ============================================================
// Bansil Books Analytics — Governed Memory & Learning Store
// Phase 2B: Persistent Memory, Authority Precedence, Learning Consolidation
// ============================================================

import { getAiDatabase } from "@/app/lib/db/ai-database";
import {
  AiMemoryEntry,
  MemoryType,
  MemoryScopeType,
  MemoryAuthorityLevel,
  MemoryStatus,
  WorkflowPattern,
  LearningCandidate,
} from "./ceo-types";

/**
 * Authority Precedence Weights:
 * 1. SYSTEM_HARD_POLICY (100)
 * 2. OWNER_APPROVED_RULE (80)
 * 3. VERIFIED_COMPANY_RULE (60)
 * 4. REVIEWED_SUCCESSFUL_OUTCOME (40)
 * 5. AGENT_LEARNED_LESSON (20)
 *
 * Rule: Higher authority always overrides lower authority.
 */
export const MEMORY_AUTHORITY_WEIGHTS: Record<MemoryAuthorityLevel, number> = {
  SYSTEM_HARD_POLICY: 100,
  OWNER_APPROVED_RULE: 80,
  VERIFIED_COMPANY_RULE: 60,
  REVIEWED_SUCCESSFUL_OUTCOME: 40,
  AGENT_LEARNED_LESSON: 20,
};

/**
 * Hard Policy Gate:
 * Memory must NEVER override or bypass:
 * 1. ZOHO WRITE = 0
 * 2. ₹15,000 monthly hard budget
 * 3. Permission boundaries / company-money restrictions
 * 4. Security policies
 */
export function validateAgainstHardPolicies(title: string, content: string): void {
  const combined = `${title || ""} ${content || ""}`.toLowerCase();

  // Check 1: ZOHO_WRITE attempts
  if (
    combined.includes("zoho_write") ||
    combined.includes("zoho write") ||
    combined.includes("write to zoho") ||
    combined.includes("zoho books api") ||
    combined.includes("zoho books write") ||
    combined.includes("post /books") ||
    combined.includes("put /books") ||
    combined.includes("delete /books") ||
    combined.includes("enable zoho write") ||
    combined.includes("allow write to zoho") ||
    combined.includes("allow zoho write")
  ) {
    throw new Error(
      "HARD POLICY VIOLATION: Cannot create or store memory that violates permanent ZOHO WRITE = 0 rule."
    );
  }

  // Check 2: Budget cap manipulation
  if (
    combined.includes("increase budget") ||
    combined.includes("increase monthly") ||
    combined.includes("exceed 15000") ||
    combined.includes("bypass 15000") ||
    combined.includes("bypass budget") ||
    combined.includes("fake budget") ||
    (combined.includes("budget") && (combined.includes("50,000") || combined.includes("50000"))) ||
    combined.includes("ignore budget limit")
  ) {
    throw new Error(
      "HARD POLICY VIOLATION: Cannot create or store memory that violates the governed ₹15,000 monthly AI budget cap."
    );
  }

  // Check 3: Real company money / banking authority
  if (
    combined.includes("payment authority") ||
    combined.includes("banking write") ||
    combined.includes("contract signing") ||
    combined.includes("statutory filing") ||
    combined.includes("bank transfer") ||
    combined.includes("disburse") ||
    combined.includes("company money") ||
    combined.includes("sign company checks")
  ) {
    throw new Error(
      "HARD POLICY VIOLATION: Cannot create or store memory that grants real company money authority or banking execution."
    );
  }

  // Check 4: Security policy / permission escalation
  if (
    combined.includes("bypass security") ||
    combined.includes("root bash") ||
    combined.includes("escalate permission") ||
    combined.includes("bypass approval") ||
    combined.includes("disable audit")
  ) {
    throw new Error(
      "HARD POLICY VIOLATION: Cannot create or store memory that escalates permissions or bypasses security policies."
    );
  }
}

/**
 * Record a new memory entry in persistent storage.
 */
export function recordMemoryEntry(
  entry: Omit<AiMemoryEntry, "id" | "created_at" | "updated_at"> & { id?: string }
): AiMemoryEntry {
  validateAgainstHardPolicies(entry.title, entry.content);

  const db = getAiDatabase();
  const id =
    entry.id ||
    `mem_${(entry.scope_type || "global").toLowerCase()}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowIso = new Date().toISOString();

  const record: AiMemoryEntry = {
    id,
    memory_type: entry.memory_type,
    scope_type: entry.scope_type || "GLOBAL",
    scope_id: entry.scope_id || "GLOBAL",
    title: entry.title,
    content: entry.content,
    source_type: entry.source_type || "SYSTEM",
    source_reference: entry.source_reference ?? null,
    authority_level: entry.authority_level,
    confidence: typeof entry.confidence === "number" ? entry.confidence : 1.0,
    status: entry.status || "ACTIVE",
    supersedes_memory_id: entry.supersedes_memory_id ?? null,
    superseded_by_memory_id: entry.superseded_by_memory_id ?? null,
    effective_from: entry.effective_from || nowIso,
    effective_to: entry.effective_to ?? null,
    created_by: entry.created_by || "CEO",
    approved_by: entry.approved_by ?? null,
    metadata: entry.metadata || {},
    created_at: nowIso,
    updated_at: nowIso,
  };

  db.prepare(`
    INSERT INTO ai_memory_entries (
      id, memory_type, scope_type, scope_id, title, content,
      source_type, source_reference, authority_level, confidence, status,
      supersedes_memory_id, superseded_by_memory_id, effective_from, effective_to,
      created_by, approved_by, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      authority_level = excluded.authority_level,
      confidence = excluded.confidence,
      status = excluded.status,
      supersedes_memory_id = excluded.supersedes_memory_id,
      superseded_by_memory_id = excluded.superseded_by_memory_id,
      effective_to = excluded.effective_to,
      approved_by = excluded.approved_by,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `).run(
    record.id,
    record.memory_type,
    record.scope_type,
    record.scope_id ?? "GLOBAL",
    record.title,
    record.content,
    record.source_type,
    record.source_reference ?? null,
    record.authority_level,
    record.confidence ?? 1.0,
    record.status ?? "ACTIVE",
    record.supersedes_memory_id ?? null,
    record.superseded_by_memory_id ?? null,
    record.effective_from ?? nowIso,
    record.effective_to ?? null,
    record.created_by ?? "CEO",
    record.approved_by ?? null,
    JSON.stringify(record.metadata || {}),
    record.created_at ?? nowIso,
    record.updated_at ?? nowIso
  );

  return record;
}

// Convenient alias for recordMemoryEntry
export const createMemory = recordMemoryEntry;

/**
 * Get memory entry by ID.
 */
export function getMemory(id: string): AiMemoryEntry | null {
  const db = getAiDatabase();
  const row = db.prepare(`SELECT * FROM ai_memory_entries WHERE id = ?`).get(id) as Record<string, any> | undefined;
  if (!row) return null;
  return deserializeMemory(row);
}

// Convenient alias for getMemory
export const getMemoryById = getMemory;

/**
 * Store Owner-Approved Guidance rule.
 * Authority: OWNER_APPROVED_RULE (80).
 * Status: ACTIVE immediately.
 * Supports both signatures:
 * storeOwnerGuidance(title, content, scopeType?, scopeId?, metadata?)
 * storeOwnerGuidance({ title, content, scopeType?, scopeId?, metadata? })
 */
export function storeOwnerGuidance(
  titleOrParams:
    | string
    | {
        title: string;
        content: string;
        scopeType?: MemoryScopeType;
        scope_type?: MemoryScopeType;
        scopeId?: string;
        scope_id?: string;
        metadata?: Record<string, any>;
      },
  content?: string,
  scopeType: MemoryScopeType = "GLOBAL",
  scopeId: string = "GLOBAL",
  metadata?: Record<string, any>
): AiMemoryEntry {
  let titleStr = "";
  let contentStr = "";
  let targetScopeType: MemoryScopeType = scopeType;
  let targetScopeId = scopeId;
  let meta = metadata;

  if (typeof titleOrParams === "object") {
    titleStr = titleOrParams.title;
    contentStr = titleOrParams.content;
    targetScopeType = titleOrParams.scopeType || titleOrParams.scope_type || "GLOBAL";
    targetScopeId = titleOrParams.scopeId || titleOrParams.scope_id || "GLOBAL";
    meta = titleOrParams.metadata;
  } else {
    titleStr = titleOrParams;
    contentStr = content || "";
  }

  return recordMemoryEntry({
    memory_type: "OWNER_GUIDANCE",
    scope_type: targetScopeType,
    scope_id: targetScopeId,
    title: titleStr,
    content: contentStr,
    source_type: "OWNER_EXPLICIT",
    authority_level: "OWNER_APPROVED_RULE",
    confidence: 1.0,
    status: "ACTIVE",
    effective_from: new Date().toISOString(),
    created_by: "OWNER",
    approved_by: "OWNER",
    metadata: meta,
  });
}

export type AugmentedSupersedeResult = AiMemoryEntry & {
  oldEntry: AiMemoryEntry;
  newEntry: AiMemoryEntry;
};

/**
 * Supersede a prior rule/memory with a new correction.
 *
 * Rules:
 * 1. Old memory status transitions from ACTIVE to SUPERSEDED.
 * 2. Old memory points to new replacement (superseded_by_memory_id).
 * 3. New memory points to old rule (supersedes_memory_id) and becomes ACTIVE.
 * 4. Lower authority CANNOT supersede higher authority.
 * 5. Full audit history is retained (no silent deletion).
 */
export function supersedeMemory(
  oldMemoryIdOrParams:
    | string
    | {
        targetMemoryId?: string;
        oldMemoryId?: string;
        newTitle?: string;
        title?: string;
        newContent?: string;
        content?: string;
        correctedBy?: string;
        reason?: string;
        authority_level?: MemoryAuthorityLevel;
        scope_type?: MemoryScopeType;
        scope_id?: string;
        metadata?: Record<string, any>;
      },
  newEntryParams?: {
    title?: string;
    newTitle?: string;
    content?: string;
    newContent?: string;
    memory_type?: MemoryType;
    scope_type?: MemoryScopeType;
    scope_id?: string;
    authority_level?: MemoryAuthorityLevel;
    created_by?: string;
    correctedBy?: string;
    approved_by?: string;
    reason?: string;
    metadata?: Record<string, any>;
  }
): AugmentedSupersedeResult {
  let targetOldId = "";
  let newTitle = "";
  let newContent = "";
  let authorityLevel: MemoryAuthorityLevel = "OWNER_APPROVED_RULE";
  let createdBy = "OWNER";
  let approvedBy = "OWNER";
  let reason = "Owner correction";
  let meta: Record<string, any> = {};
  let scopeType: MemoryScopeType | undefined;
  let scopeId: string | undefined;
  let memoryType: MemoryType = "CORRECTION";

  if (typeof oldMemoryIdOrParams === "object") {
    targetOldId = oldMemoryIdOrParams.targetMemoryId || oldMemoryIdOrParams.oldMemoryId || "";
    newTitle = oldMemoryIdOrParams.newTitle || oldMemoryIdOrParams.title || "Corrected Policy";
    newContent = oldMemoryIdOrParams.newContent || oldMemoryIdOrParams.content || "";
    createdBy = oldMemoryIdOrParams.correctedBy || "OWNER";
    approvedBy = oldMemoryIdOrParams.correctedBy || "OWNER";
    reason = oldMemoryIdOrParams.reason || "Owner correction";
    authorityLevel = oldMemoryIdOrParams.authority_level || "OWNER_APPROVED_RULE";
    scopeType = oldMemoryIdOrParams.scope_type;
    scopeId = oldMemoryIdOrParams.scope_id;
    meta = oldMemoryIdOrParams.metadata || {};
  } else {
    targetOldId = oldMemoryIdOrParams;
    newTitle = newEntryParams?.newTitle || newEntryParams?.title || "Corrected Policy";
    newContent = newEntryParams?.newContent || newEntryParams?.content || "";
    createdBy = newEntryParams?.correctedBy || newEntryParams?.created_by || "OWNER";
    approvedBy = newEntryParams?.approved_by || "OWNER";
    reason = newEntryParams?.reason || "Owner correction";
    authorityLevel = newEntryParams?.authority_level || "OWNER_APPROVED_RULE";
    scopeType = newEntryParams?.scope_type;
    scopeId = newEntryParams?.scope_id;
    meta = newEntryParams?.metadata || {};
  }

  const oldEntry = getMemory(targetOldId);
  if (!oldEntry) {
    throw new Error(`Cannot supersede memory: Memory with id '${targetOldId}' not found.`);
  }

  const oldWeight = MEMORY_AUTHORITY_WEIGHTS[oldEntry.authority_level] || 0;
  const newWeight = MEMORY_AUTHORITY_WEIGHTS[authorityLevel] || 80;

  if (newWeight < oldWeight) {
    throw new Error(
      `Authority Violation: Lower authority level '${authorityLevel}' (weight: ${newWeight}) cannot supersede higher authority memory '${oldEntry.authority_level}' (weight: ${oldWeight}).`
    );
  }

  validateAgainstHardPolicies(newTitle, newContent);

  const db = getAiDatabase();
  const nowIso = new Date().toISOString();
  const newId = `mem_corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  db.exec("BEGIN IMMEDIATE;");
  try {
    // 1. Mark old memory as SUPERSEDED
    db.prepare(`
      UPDATE ai_memory_entries
      SET status = 'SUPERSEDED',
          superseded_by_memory_id = ?,
          effective_to = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newId, nowIso, nowIso, targetOldId);

    // 2. Insert new replacement memory as ACTIVE
    const newRecord: AiMemoryEntry = {
      id: newId,
      memory_type: memoryType,
      scope_type: scopeType || oldEntry.scope_type,
      scope_id: scopeId || oldEntry.scope_id,
      title: newTitle,
      content: newContent,
      source_type: "OWNER_EXPLICIT",
      source_reference: `Supersedes ${targetOldId}`,
      authority_level: authorityLevel,
      confidence: 1.0,
      status: "ACTIVE",
      supersedes_memory_id: targetOldId,
      superseded_by_memory_id: null,
      effective_from: nowIso,
      effective_to: null,
      created_by: createdBy,
      approved_by: approvedBy,
      metadata: {
        ...meta,
        supersededReason: reason,
        supersededOldTitle: oldEntry.title,
      },
      created_at: nowIso,
      updated_at: nowIso,
    };

    db.prepare(`
      INSERT INTO ai_memory_entries (
        id, memory_type, scope_type, scope_id, title, content,
        source_type, source_reference, authority_level, confidence, status,
        supersedes_memory_id, superseded_by_memory_id, effective_from, effective_to,
        created_by, approved_by, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newRecord.id,
      newRecord.memory_type,
      newRecord.scope_type,
      newRecord.scope_id ?? "GLOBAL",
      newRecord.title,
      newRecord.content,
      newRecord.source_type,
      newRecord.source_reference ?? null,
      newRecord.authority_level,
      newRecord.confidence ?? 1.0,
      newRecord.status ?? "ACTIVE",
      newRecord.supersedes_memory_id ?? null,
      newRecord.superseded_by_memory_id ?? null,
      newRecord.effective_from ?? nowIso,
      newRecord.effective_to ?? null,
      newRecord.created_by ?? "OWNER",
      newRecord.approved_by ?? null,
      JSON.stringify(newRecord.metadata || {}),
      newRecord.created_at ?? nowIso,
      newRecord.updated_at ?? nowIso
    );

    db.exec("COMMIT;");

    const updatedOld = getMemory(targetOldId)!;
    return Object.assign({}, newRecord, {
      oldEntry: updatedOld,
      newEntry: newRecord,
    }) as AugmentedSupersedeResult;
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {}
    throw err;
  }
}

/**
 * Store agent-learned lesson.
 * Starts in CANDIDATE status to prevent unverified model outputs from becoming truth.
 */
export function storeAgentLesson(params: {
  title: string;
  content: string;
  agentId: string;
  role?: string;
  department?: string;
  entityId?: string;
  scopeType?: MemoryScopeType;
  scopeId?: string;
  confidence?: number;
}): AiMemoryEntry {
  const scopeType = params.scopeType || (params.entityId ? "ENTITY" : params.department ? "DEPARTMENT" : "AGENT");
  const scopeId = params.scopeId || params.entityId || params.department || params.agentId;

  return recordMemoryEntry({
    memory_type: "AGENT_LEARNING",
    scope_type: scopeType,
    scope_id: scopeId,
    title: params.title,
    content: params.content,
    source_type: "AGENT",
    source_reference: `Agent: ${params.agentId}`,
    authority_level: "AGENT_LEARNED_LESSON",
    confidence: params.confidence || 0.75,
    status: "CANDIDATE",
    effective_from: new Date().toISOString(),
    created_by: params.agentId,
    metadata: {
      agentId: params.agentId,
      role: params.role,
      department: params.department,
      entityId: params.entityId,
    },
  });
}

/**
 * Create a governed Learning Candidate.
 * Authority is typically AGENT_LEARNED_LESSON or REVIEWED_SUCCESSFUL_OUTCOME.
 * Status is CANDIDATE (does NOT automatically become an OWNER_APPROVED_RULE).
 */
export function createLearningCandidate(candidate: LearningCandidate): AiMemoryEntry {
  return recordMemoryEntry({
    memory_type: candidate.memory_type,
    scope_type: candidate.scope_type,
    scope_id: candidate.scope_id,
    title: candidate.title,
    content: candidate.content,
    source_type: candidate.source_type,
    source_reference: candidate.source_reference || null,
    authority_level: candidate.authority_level || "AGENT_LEARNED_LESSON",
    confidence: candidate.confidence || 0.75,
    status: candidate.status || "CANDIDATE",
    effective_from: new Date().toISOString(),
    created_by: "CEO",
    metadata: {
      reason: candidate.reason,
    },
  });
}

/**
 * Store Role Knowledge that applies across all agents in that role.
 */
export function storeRoleKnowledge(
  roleOrParams:
    | string
    | {
        role: string;
        title: string;
        content: string;
        createdBy?: string;
      },
  title?: string,
  content?: string,
  createdBy: string = "CEO"
): AiMemoryEntry {
  let role = "";
  let t = "";
  let c = "";
  let creator = createdBy;

  if (typeof roleOrParams === "object") {
    role = roleOrParams.role;
    t = roleOrParams.title;
    c = roleOrParams.content;
    creator = roleOrParams.createdBy || "CEO";
  } else {
    role = roleOrParams;
    t = title || "";
    c = content || "";
  }

  return recordMemoryEntry({
    memory_type: "ROLE_KNOWLEDGE",
    scope_type: "ROLE",
    scope_id: role,
    title: t,
    content: c,
    source_type: "SYSTEM",
    source_reference: `Role: ${role}`,
    authority_level: "VERIFIED_COMPANY_RULE",
    confidence: 1.0,
    status: "ACTIVE",
    effective_from: new Date().toISOString(),
    created_by: creator,
    approved_by: "CEO",
  });
}

/**
 * Store CEO Workflow Pattern for recurring multi-agent workflows.
 */
export function storeWorkflowPattern(
  pattern:
    | Omit<WorkflowPattern, "created_at" | "updated_at">
    | {
        workflowName?: string;
        workflow_name?: string;
        triggerPattern?: string;
        trigger_pattern?: string;
        requiredRoles?: string[];
        required_roles?: string[];
        dependencyOrder?: string[];
        dependency_order?: string[];
        typicalModelTier?: string;
        typical_model_tier?: any;
        description?: string;
        id?: string;
      }
): any {
  const name = (pattern as any).workflowName || (pattern as any).workflow_name || "Custom Workflow";
  const desc = (pattern as any).description || name;
  const trigger = (pattern as any).triggerPattern || (pattern as any).trigger_pattern || "";
  const roles = (pattern as any).requiredRoles || (pattern as any).required_roles || [];
  const deps = (pattern as any).dependencyOrder || (pattern as any).dependency_order || [];
  const tier = (pattern as any).typicalModelTier || (pattern as any).typical_model_tier || "BALANCED_CORE";
  const id = (pattern as any).id || `wf_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  validateAgainstHardPolicies(name, desc);

  const nowIso = new Date().toISOString();
  const record = {
    id,
    workflow_name: name,
    workflowName: name,
    description: desc,
    trigger_pattern: trigger,
    triggerPattern: trigger,
    required_roles: roles,
    requiredRoles: roles,
    dependency_order: deps,
    dependencyOrder: deps,
    typical_model_tier: tier,
    typicalModelTier: tier,
    historical_cost_basis: 0,
    successful_completion_count: 1,
    created_at: nowIso,
    updated_at: nowIso,
  };

  recordMemoryEntry({
    id: `mem_${id}`,
    memory_type: "WORKFLOW_PATTERN",
    scope_type: "WORKFLOW",
    scope_id: id,
    title: name,
    content: JSON.stringify(record),
    source_type: "SYSTEM",
    source_reference: trigger,
    authority_level: "REVIEWED_SUCCESSFUL_OUTCOME",
    confidence: 1.0,
    status: "ACTIVE",
    effective_from: nowIso,
    created_by: "CEO",
    approved_by: "CEO",
    metadata: {
      trigger_pattern: trigger,
      required_roles: roles,
    },
  });

  return record;
}

/**
 * Retrieve CEO Workflow Pattern matching trigger term.
 */
export function retrieveWorkflowPattern(trigger: string): any | null {
  const db = getAiDatabase();
  const lowerTrigger = trigger.toLowerCase();

  const rows = db.prepare(`
    SELECT * FROM ai_memory_entries
    WHERE memory_type = 'WORKFLOW_PATTERN' AND status = 'ACTIVE'
  `).all() as Record<string, any>[];

  for (const row of rows) {
    const memory = deserializeMemory(row);
    try {
      const parsed = JSON.parse(memory.content);
      const triggerPattern = parsed.trigger_pattern || parsed.triggerPattern || "";
      const terms = triggerPattern.toLowerCase().split("|").map((t: string) => t.trim());
      const termMatches = terms.some((term: string) => {
        if (!term) return false;
        if (lowerTrigger.includes(term)) return true;
        const words = term.split(/\s+/).filter(Boolean);
        return words.length > 0 && words.every((w: string) => lowerTrigger.includes(w));
      });
      if (
        termMatches ||
        memory.title.toLowerCase().includes(lowerTrigger) ||
        lowerTrigger.includes(memory.title.toLowerCase())
      ) {
        return {
          ...parsed,
          workflowName: parsed.workflowName || parsed.workflow_name,
          requiredRoles: parsed.requiredRoles || parsed.required_roles,
          dependencyOrder: parsed.dependencyOrder || parsed.dependency_order,
          typicalModelTier: parsed.typicalModelTier || parsed.typical_model_tier,
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}

/**
 * Promote Candidate Memory to ACTIVE status.
 */
export function promoteCandidateMemory(memoryId: string, approvedBy: string = "CEO"): boolean {
  const db = getAiDatabase();
  const nowIso = new Date().toISOString();
  const result = db.prepare(`
    UPDATE ai_memory_entries
    SET status = 'ACTIVE', approved_by = ?, updated_at = ?
    WHERE id = ? AND status = 'CANDIDATE'
  `).run(approvedBy, nowIso, memoryId);

  return result.changes > 0;
}

/**
 * Retrieve relevant active memories for a given task/execution context.
 */
export function retrieveRelevantMemories(params: {
  scopeType?: MemoryScopeType;
  scope?: MemoryScopeType;
  scopeId?: string;
  department?: string;
  role?: string;
  agentId?: string;
  entity?: string;
  memoryTypes?: MemoryType[];
  includeGlobal?: boolean;
}): AiMemoryEntry[] {
  const db = getAiDatabase();
  const includeGlobal = params.includeGlobal !== false;

  const scopeFilters: Array<{ type: string; id: string }> = [];
  if (includeGlobal) {
    scopeFilters.push({ type: "GLOBAL", id: "GLOBAL" });
  }
  if (params.department) {
    scopeFilters.push({ type: "DEPARTMENT", id: params.department });
  }
  if (params.role) {
    scopeFilters.push({ type: "ROLE", id: params.role });
  }
  if (params.agentId) {
    scopeFilters.push({ type: "AGENT", id: params.agentId });
  }
  if (params.entity) {
    scopeFilters.push({ type: "ENTITY", id: params.entity });
  }
  const effectiveScopeType = params.scope || params.scopeType;
  if (effectiveScopeType && params.scopeId) {
    scopeFilters.push({ type: effectiveScopeType, id: params.scopeId });
  }

  // Base query: only ACTIVE memories
  const rawRows = db.prepare(`
    SELECT * FROM ai_memory_entries
    WHERE status = 'ACTIVE'
    ORDER BY created_at DESC
  `).all() as Record<string, any>[];

  const allActive = rawRows.map(deserializeMemory);

  // Filter by matching scopes
  const matched = allActive.filter((m) => {
    if (params.memoryTypes && params.memoryTypes.length > 0) {
      if (!params.memoryTypes.includes(m.memory_type)) return false;
    }

    if (m.scope_type === "GLOBAL") return includeGlobal;

    return scopeFilters.some(
      (sf) => sf.type === m.scope_type && sf.id.toUpperCase() === m.scope_id.toUpperCase()
    );
  });

  // Authority Precedence & Conflict Resolution
  const resolved = resolveMemoryConflicts(matched);

  // Sort by authority level weight descending, then updated_at descending
  return resolved.sort((a, b) => {
    const weightA = MEMORY_AUTHORITY_WEIGHTS[a.authority_level] || 0;
    const weightB = MEMORY_AUTHORITY_WEIGHTS[b.authority_level] || 0;
    if (weightA !== weightB) return weightB - weightA;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

/**
 * Conflict Resolution Engine:
 * When two memories target the same topic/key/scope:
 * 1. Higher authority strictly overrides lower authority.
 * 2. If same authority and mutual conflict exists, flag conflict.
 */
export function resolveMemoryConflicts(memories: AiMemoryEntry[]): AiMemoryEntry[] {
  const topicMap = new Map<string, AiMemoryEntry>();

  for (const mem of memories) {
    const normalizedKey = `${mem.scope_type}:${mem.scope_id}:${mem.title.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    const existing = topicMap.get(normalizedKey);
    if (!existing) {
      topicMap.set(normalizedKey, mem);
    } else {
      const existingWeight = MEMORY_AUTHORITY_WEIGHTS[existing.authority_level] || 0;
      const memWeight = MEMORY_AUTHORITY_WEIGHTS[mem.authority_level] || 0;

      if (memWeight > existingWeight) {
        topicMap.set(normalizedKey, mem);
      }
    }
  }

  return Array.from(topicMap.values());
}

export interface ConflictItem {
  a: AiMemoryEntry;
  b: AiMemoryEntry;
  reason: string;
  conflictStatus: string;
}

/**
 * Detect same-authority conflicts between active rules.
 */
export function detectConflicts(memories: AiMemoryEntry[]): ConflictItem[] {
  const conflicts: ConflictItem[] = [];
  const activeOnly = memories.filter((m) => m.status === "ACTIVE");

  for (let i = 0; i < activeOnly.length; i++) {
    for (let j = i + 1; j < activeOnly.length; j++) {
      const a = activeOnly[i];
      const b = activeOnly[j];

      const sameScope = a.scope_type === b.scope_type && a.scope_id === b.scope_id;
      const titleWordsA = a.title.toLowerCase().split(/\s+/);
      const titleWordsB = b.title.toLowerCase().split(/\s+/);
      const commonWords = titleWordsA.filter((w) => w.length > 3 && titleWordsB.includes(w));
      const similarTopic = a.title.toLowerCase() === b.title.toLowerCase() || commonWords.length >= 2;

      if (sameScope && similarTopic && a.content !== b.content) {
        const weightA = MEMORY_AUTHORITY_WEIGHTS[a.authority_level] || 0;
        const weightB = MEMORY_AUTHORITY_WEIGHTS[b.authority_level] || 0;

        if (weightA === weightB) {
          conflicts.push({
            a,
            b,
            reason: `Direct contradictory directives with identical authority level '${a.authority_level}' on scope '${a.scope_id}'. Requires Owner review.`,
            conflictStatus: "CONFLICT_REQUIRES_REVIEW",
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Learning Consolidation Service:
 * Callable service to maintain memory health:
 * 1. Merges duplicate candidate memories.
 * 2. Promotes repeatedly observed successful candidate lessons to ACTIVE.
 * 3. Identifies obsolete superseded rules.
 */
export function consolidateLearning(periodId?: string): {
  mergedCount: number;
  merged_count: number;
  promotedCount: number;
  promoted_count: number;
  candidateCount: number;
  activeCount: number;
  supersededCount: number;
} {
  const db = getAiDatabase();
  const allRows = db.prepare(`SELECT * FROM ai_memory_entries`).all() as Record<string, any>[];
  const allMemories = allRows.map(deserializeMemory);

  const candidates = allMemories.filter((m) => m.status === "CANDIDATE");
  const candidateCounts = new Map<string, { count: number; ids: string[]; latest: AiMemoryEntry }>();

  let mergedCount = 0;
  let promotedCount = 0;

  for (const c of candidates) {
    const key = `${c.scope_type}:${c.scope_id}:${c.title.toLowerCase().trim()}:${c.content.toLowerCase().trim()}`;
    const group = candidateCounts.get(key) || { count: 0, ids: [], latest: c };
    group.count += 1;
    group.ids.push(c.id);
    group.latest = c;
    candidateCounts.set(key, group);
  }

  const nowIso = new Date().toISOString();

  // Deduplicate and promote candidates observed 3+ times
  for (const [_, group] of candidateCounts) {
    const keepId = group.latest.id;

    if (group.ids.length > 1) {
      const removeIds = group.ids.filter((id) => id !== keepId);
      for (const remId of removeIds) {
        db.prepare(`DELETE FROM ai_memory_entries WHERE id = ?`).run(remId);
        mergedCount++;
      }
    }

    // Promotion rule: If repeated observation >= 3, promote to ACTIVE
    if (group.count >= 3) {
      db.prepare(`
        UPDATE ai_memory_entries
        SET status = 'ACTIVE',
            authority_level = 'REVIEWED_SUCCESSFUL_OUTCOME',
            approved_by = 'CEO_CONSOLIDATION',
            updated_at = ?
        WHERE id = ?
      `).run(nowIso, keepId);
      promotedCount++;
    }
  }

  const currentMemories = (db.prepare(`SELECT * FROM ai_memory_entries`).all() as Record<string, any>[]).map(deserializeMemory);

  return {
    mergedCount,
    merged_count: mergedCount,
    promotedCount,
    promoted_count: promotedCount,
    candidateCount: currentMemories.filter((m) => m.status === "CANDIDATE").length,
    activeCount: currentMemories.filter((m) => m.status === "ACTIVE").length,
    supersededCount: currentMemories.filter((m) => m.status === "SUPERSEDED").length,
  };
}

/**
 * List memories with optional filtering.
 */
export function listMemories(filter?: {
  status?: MemoryStatus;
  memory_type?: MemoryType;
  scope_type?: MemoryScopeType;
  scope_id?: string;
  title?: string;
}): AiMemoryEntry[] {
  const db = getAiDatabase();
  let sql = `SELECT * FROM ai_memory_entries WHERE 1=1`;
  const params: any[] = [];

  if (filter?.status) {
    sql += ` AND status = ?`;
    params.push(filter.status);
  }
  if (filter?.memory_type) {
    sql += ` AND memory_type = ?`;
    params.push(filter.memory_type);
  }
  if (filter?.scope_type) {
    sql += ` AND scope_type = ?`;
    params.push(filter.scope_type);
  }
  if (filter?.scope_id) {
    sql += ` AND scope_id = ?`;
    params.push(filter.scope_id);
  }

  sql += ` ORDER BY created_at DESC`;

  const rows = db.prepare(sql).all(...params) as Record<string, any>[];
  let list = rows.map(deserializeMemory);

  if (filter?.title) {
    const t = filter.title.toLowerCase();
    list = list.filter((m) => m.title.toLowerCase().includes(t));
  }

  return list;
}

function deserializeMemory(row: Record<string, any>): AiMemoryEntry {
  let meta = {};
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    meta = {};
  }

  return {
    id: row.id,
    memory_type: row.memory_type,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    title: row.title,
    content: row.content,
    source_type: row.source_type,
    source_reference: row.source_reference || null,
    authority_level: row.authority_level,
    confidence: Number(row.confidence),
    status: row.status,
    supersedes_memory_id: row.supersedes_memory_id || null,
    superseded_by_memory_id: row.superseded_by_memory_id || null,
    effective_from: row.effective_from,
    effective_to: row.effective_to || null,
    created_by: row.created_by,
    approved_by: row.approved_by || null,
    metadata: meta,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
