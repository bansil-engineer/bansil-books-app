export type AgentDepartment =
  | "EXECUTIVE"
  | "FINANCE"
  | "ACCOUNTS"
  | "SALES"
  | "PURCHASE"
  | "ESTIMATION"
  | "PROJECTS"
  | "SITE_EXECUTION"
  | "BILLING"
  | "HR"
  | "QUALITY"
  | "INVENTORY"
  | "LEGAL_COMPLIANCE"
  | "IT"
  | "RESEARCH";

export type AgentLevel = "CEO" | "VP" | "GM" | "MANAGER" | "SPECIALIST" | "REVIEWER";
export type AgentStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "IDLE"
  | "BUSY"
  | "PAUSED"
  | "RETIRED"
  | "BLOCKED"
  | "INACTIVE";

export type RunStatus =
  | "RECEIVED"
  | "PLANNING"
  | "MEMORY_RETRIEVAL"
  | "WORKFORCE_SELECTION"
  | "BUDGET_CHECK"
  | "READY"
  | "RUNNING"
  | "WAITING_DEPENDENCY"
  | "WAITING_REVIEW"
  | "WAITING_OWNER"
  | "RETRYING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "CANCELLED"
  | "BLOCKED";

export type TaskStatus =
  | "PLANNED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "WAITING_DEPENDENCY"
  | "WAITING_REVIEW"
  | "WAITING_OWNER"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type BudgetPeriodStatus =
  | "NORMAL"
  | "WARNING"
  | "HIGH"
  | "CRITICAL"
  | "HARD_STOP"
  | "OWNER_APPROVAL_REQUIRED";

export type ModelTier = "FAST" | "STANDARD" | "REASONING" | "HIGH_REASONING" | "REVIEWER";

export interface AiAgentConfig {
  id: string;
  name: string;
  title?: string;
  role: string;
  department: AgentDepartment | string;
  level: AgentLevel;
  reports_to: string | null;
  status: AgentStatus;
  purpose?: string;
  responsibilities?: string[];
  capabilities: string[];
  allowed_tools: string[];
  denied_tools: string[];
  max_task_budget?: number;
  monthly_budget?: number;
  temporary?: boolean;
  risk_class: string;
  created_by: "SYSTEM" | "CEO";
  created_reason?: string;
  performance_metrics?: {
    tasks_assigned?: number;
    tasks_completed?: number;
    failed_tasks?: number;
    retries?: number;
    average_cost?: number;
    budget_consumed?: number;
  };
  last_used_at?: string | null;
  current_workload?: number;
  tasks_completed?: number;
  tasks_failed?: number;
  retries?: number;
  reviewer_rework_count?: number;
  average_cost_per_task?: number;
  relevant_memory_count?: number;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Phase 2B: Memory & Learning Types
// ============================================================

export type MemoryType =
  | "OWNER_GUIDANCE"
  | "COMPANY_RULE"
  | "CEO_LEARNING"
  | "AGENT_LEARNING"
  | "WORKFLOW_PATTERN"
  | "CORRECTION"
  | "DECISION"
  | "TASK_OUTCOME"
  | "MISTAKE_LESSON"
  | "REVIEWER_FEEDBACK"
  | "ENTITY_HISTORY"
  | "ROLE_KNOWLEDGE";

export type MemoryScopeType =
  | "GLOBAL"
  | "CEO"
  | "DEPARTMENT"
  | "AGENT"
  | "ROLE"
  | "ENTITY"
  | "WORKFLOW";

export type MemoryAuthorityLevel =
  | "SYSTEM_HARD_POLICY"
  | "OWNER_APPROVED_RULE"
  | "VERIFIED_COMPANY_RULE"
  | "REVIEWED_SUCCESSFUL_OUTCOME"
  | "AGENT_LEARNED_LESSON";

export type MemoryStatus =
  | "ACTIVE"
  | "CANDIDATE"
  | "SUPERSEDED"
  | "REJECTED"
  | "ARCHIVED"
  | "CONFLICT_REQUIRES_REVIEW";

export interface AiMemoryEntry {
  id: string;
  memory_type: MemoryType;
  scope_type: MemoryScopeType;
  scope_id: string;
  title: string;
  content: string;
  source_type: "OWNER_EXPLICIT" | "SYSTEM" | "REVIEWER" | "AGENT" | "VERIFIED_DOC";
  source_reference?: string | null;
  authority_level: MemoryAuthorityLevel;
  confidence: number;
  status: MemoryStatus;
  supersedes_memory_id?: string | null;
  superseded_by_memory_id?: string | null;
  effective_from: string;
  effective_to?: string | null;
  created_by: string;
  approved_by?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface LearningCandidate {
  id?: string;
  memory_type: MemoryType;
  scope_type: MemoryScopeType;
  scope_id: string;
  title: string;
  content: string;
  source_type: "OWNER_EXPLICIT" | "SYSTEM" | "REVIEWER" | "AGENT" | "VERIFIED_DOC";
  source_reference?: string;
  authority_level: MemoryAuthorityLevel;
  confidence: number;
  status: MemoryStatus;
  reason?: string;
}

export interface WorkflowPattern {
  id: string;
  workflow_name: string;
  trigger_pattern: string;
  description: string;
  required_roles: string[];
  dependency_order: string[];
  reviewer_requirement: boolean;
  typical_model_tier: ModelTier;
  historical_cost?: number;
  successful_completion_count: number;
  created_at: string;
  updated_at: string;
}

export interface AgentMatchCriteria {
  department?: string;
  role?: string;
  requiredCapabilities?: string[];
  level?: AgentLevel;
  taskComplexity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface AgentReuseResult {
  action: "REUSED" | "CREATED" | "FALLBACK_CEO";
  agent: AiAgentConfig;
  reason: string;
}

export interface AiDepartment {
  id: string;
  name: string;
  purpose: string;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  parent_department: string | null;
  department_head_agent_id: string | null;
  active_agent_count: number;
  current_budget: number;
  current_consumption: number;
  created_by: string;
  created_reason: string;
  created_at: string;
  updated_at: string;
}

export interface AiBudgetPeriod {
  id: string;
  period_start: string;
  period_end: string;
  currency: string;
  monthly_limit: number;
  committed_amount: number;
  consumed_amount: number;
  available_amount: number;
  status: BudgetPeriodStatus;
  created_at: string;
  updated_at: string;
}

export interface AiDepartmentBudget {
  id: string;
  budget_period_id: string;
  department_id: string;
  allocated_amount: number;
  committed_amount: number;
  consumed_amount: number;
  available_amount: number;
  created_at: string;
  updated_at: string;
}

export interface AiAgentBudget {
  id: string;
  department_budget_id: string | null;
  agent_id: string;
  allocated_amount: number;
  committed_amount: number;
  consumed_amount: number;
  available_amount: number;
  created_at: string;
  updated_at: string;
}

export interface AiTaskBudget {
  id: string;
  task_id: string;
  agent_id: string;
  estimated_cost: number;
  approved_ceiling: number;
  actual_cost: number;
  status: "PLANNED" | "COMMITTED" | "CONSUMED" | "CANCELLED" | "REJECTED";
  created_at: string;
  completed_at: string | null;
}

export type CostStatus = "CONFIG_REQUIRED" | "ESTIMATED" | "FINAL" | "NO_METERED_COST";

export interface AiUsageLedgerEntry {
  id: string;
  budget_period_id: string;
  task_id: string | null;
  agent_id: string | null;
  department_id: string | null;
  provider: string;
  model: string;
  usage_type: string;
  cost_status: CostStatus;
  estimated_cost: number;
  actual_cost: number;
  currency: string;
  metadata_summary: string | null;
  created_at: string;
}

export interface AiBudgetTransfer {
  id: string;
  budget_period_id: string;
  from_department_id: string | null;
  to_department_id: string;
  amount: number;
  reason: string;
  initiated_by: string;
  created_at: string;
}

export interface ModelCostEntry {
  id: string;
  provider: string;
  model: string;
  tier: ModelTier;
  input_cost_basis: number;
  output_cost_basis: number;
  fixed_call_cost: number;
  status: CostStatus;
  enabled: boolean;
  notes?: string;
  effective_from: string;
}

export interface AiTask {
  id: string;
  parent_task_id: string | null;
  run_id: string | null;
  objective: string;
  assigned_agent_id: string | null;
  department?: string | null;
  requested_by: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: TaskStatus;
  dependency_status: string | null;
  dependencies?: string[];
  inputs?: Record<string, any> | string | null;
  expected_output?: string | null;
  evidence_requirements?: string | null;
  evidence_result?: string | null;
  estimated_cost?: number;
  committed_cost?: number;
  actual_cost?: number;
  retry_count?: number;
  max_retries?: number;
  failure_reason?: string | null;
  idempotency_key?: string | null;
  input_summary: string | null;
  result_summary: string | null;
  created_at: string;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface AiExecutionRun {
  id: string;
  conversation_id: string;
  message_id: string | null;
  requested_agent: string;
  selected_agent: string;
  selected_model: string | null;
  objective: string;
  status: RunStatus;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  risk_class: string;
  selected_workflow: string | null;
  selected_model_tier: ModelTier | null;
  estimated_cost: number;
  committed_cost: number;
  actual_cost: number;
  current_step: string;
  max_steps: number;
  step_count: number;
  retry_count: number;
  max_retries: number;
  reviewer_required: boolean;
  reviewer_status?: string | null;
  owner_approval_required: boolean;
  idempotency_key?: string | null;
  evidence_summary?: string | null;
  final_response?: string | null;
  failure_reason?: string | null;
  started_at: string;
  completed_at?: string | null;
}

export interface AgentHandoff {
  id: string;
  run_id: string;
  task_id: string;
  source_agent_id: string;
  target_agent_id: string;
  required_information: string;
  evidence_reference?: string | null;
  status: "PENDING" | "ACCEPTED" | "COMPLETED" | "REJECTED";
  created_at: string;
}

export interface FollowUpResult {
  nextAction:
    | "EXECUTE_TASK"
    | "WAITING_DEPENDENCY"
    | "TRIGGER_REVIEWER"
    | "WAITING_OWNER"
    | "CONSOLIDATE"
    | "COMPLETE"
    | "MAX_STEPS_EXCEEDED"
    | "RETRY_LIMIT_EXCEEDED"
    | "BUDGET_EXCEEDED"
    | "CANCELLED";
  taskId?: string;
  reason?: string;
  details?: Record<string, any>;
}

export interface ExecutionLifecycleOptions {
  conversationId?: string;
  ownerMessageId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskClass?: string;
  idempotencyKey?: string;
  maxSteps?: number;
  maxRetries?: number;
  useLifecycle?: boolean;
}

// ==================== PHASE 2D: CAPABILITY & TOOL TYPES ====================

export type ToolClass = import("../types").ToolClass;

export type CapabilityCategory =
  | "COMPANY_DATA"
  | "AUDIT"
  | "ACCOUNTING"
  | "SALES"
  | "PURCHASE"
  | "INVENTORY"
  | "PROJECT"
  | "BILLING"
  | "HR"
  | "INTEGRATION"
  | "DATA_READ"
  | "ANALYSIS"
  | "COMPLIANCE"
  | "CALCULATION"
  | "RESEARCH"
  | "SYSTEM"
  | string;

export interface AiCapability {
  id: string;
  code: string;
  name: string;
  description: string;
  category: CapabilityCategory;
  risk_class?: string;
  riskClass?: string;
  default_tool_class?: ToolClass;
  defaultToolClass?: ToolClass;
  active: boolean;
  created_by?: string;
  createdBy?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface AiToolDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
  provider: string;
  tool_class?: ToolClass;
  toolClass: ToolClass;
  required_capabilities?: string[];
  requiredCapabilities: string[];
  allowed_agents?: string[];
  allowedAgents?: string[];
  allowed_roles?: string[];
  allowedRoles?: string[];
  denied_capabilities?: string[];
  deniedCapabilities?: string[];
  requires_approval?: boolean;
  requiresApproval: boolean;
  active: boolean;
  server_only?: boolean;
  serverOnly: boolean;
  timeout_ms?: number;
  timeoutMs: number;
  input_schema?: Record<string, any>;
  inputSchema?: Record<string, any>;
  output_schema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  estimated_cost?: number;
  estimatedCost: number;
  cost_status?: CostStatus;
  costStatus: CostStatus;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export type DataSourceType =
  | "LOCAL_SQLITE"
  | "ZOHO_BOOKS"
  | "COMPANY_FILE"
  | "PROJECT_FILE"
  | "WEB"
  | "API"
  | "INTERNAL_SERVICE";

export type AccessMode =
  | "READ_ONLY"
  | "LOCAL_CONTROLLED_WRITE"
  | "EXTERNAL_WRITE_PROHIBITED";

export type FreshnessStrategy = "LIVE" | "CACHED" | "PERIODIC_SYNC" | "STATIC";
export type DataFreshness = "LIVE" | "CACHED" | "LAST_SYNC_AT" | "STALE" | "UNKNOWN" | "STATIC";

export type SourceHealthStatus =
  | "READY_LIVE"
  | "READY_CACHED"
  | "STALE"
  | "SCOPE_BLOCKED"
  | "AUTH_BLOCKED"
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "ERROR"
  | "UNKNOWN";

export type DataSensitivityClass =
  | "NORMAL_BUSINESS"
  | "FINANCIAL"
  | "EMPLOYEE_CONFIDENTIAL"
  | "SECURITY_SENSITIVE";

export interface AiDataSource {
  id: string;
  code: string;
  name: string;
  source_type?: DataSourceType;
  sourceType: DataSourceType;
  description: string;
  access_mode?: AccessMode;
  accessMode: AccessMode;
  freshness_strategy?: FreshnessStrategy;
  freshnessStrategy: FreshnessStrategy;
  current_status?: SourceHealthStatus;
  currentStatus?: SourceHealthStatus;
  sensitivity_class?: string;
  sensitivityClass?: string;
  implementation_path?: string;
  implementationPath?: string;
  last_successful_sync?: string | null;
  lastSuccessfulSync?: string | null;
  covered_period?: string | null;
  coveredPeriod?: string | null;
  supported_entities?: string[];
  supportedEntities?: string[];
  required_scopes?: string[];
  requiredScopes?: string[];
  current_scope_state?: string;
  currentScopeState?: string;
  storage_location?: string | null;
  storageLocation?: string | null;
  watermark_supported?: boolean;
  watermarkSupported?: boolean;
  last_watermark?: string | null;
  lastWatermark?: string | null;
  capabilities_enabled?: string[];
  capabilitiesEnabled?: string[];
  tool_binding?: string;
  toolBinding?: string;
  active: boolean;
  last_verified_at?: string | null;
  lastVerifiedAt?: string | null;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface AiEvidenceRecord {
  id: string;
  sourceId: string;
  entity: string;
  queryFingerprint: string;
  filters: Record<string, any>;
  period?: string;
  freshness: DataFreshness;
  fetchedAt: string;
  expiresAt?: string;
  staleRule?: string;
  resultReference: string;
  checksum?: string;
  summary: string;
  data?: any;
  createdAt: string;
  updatedAt: string;
}

export interface ZohoModuleStatus {
  module: string;
  implemented: boolean;
  currentAccess: "READY" | "READY_CACHED" | "READY_LIVE" | "SCOPE_BLOCKED" | "AUTH_BLOCKED" | "NOT_CONFIGURED" | "UNKNOWN";
  readMethod: "GET";
  writeAllowed: 0;
  recordCount?: number;
  lastSync?: string | null;
  coveredPeriod?: string | null;
  tokenScope?: string;
  liveProbeStatus?: "PASS" | "FAIL" | "NOT_TESTED";
  cacheExists?: boolean;
}

export interface SourceDiscoveryReport {
  timestamp: string;
  totalSources: number;
  readyLiveCount: number;
  readyCachedCount: number;
  staleCount: number;
  scopeBlockedCount: number;
  authBlockedCount: number;
  notConfiguredCount: number;
  zohoModules: ZohoModuleStatus[];
  sources: AiDataSource[];
}

export type CapabilityStatus = "ACTIVE" | "REVOKED" | "SUSPENDED";

export interface AiAgentCapability {
  id: string;
  agent_id?: string;
  agentId: string;
  capability_code?: string;
  capabilityCode: string;
  granted_by?: string;
  grantedBy: string;
  source_policy?: string;
  sourcePolicy: string;
  status: CapabilityStatus;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export type ToolExecutionStatus =
  | "SUCCESS"
  | "NO_DATA"
  | "STALE_DATA"
  | "PERMISSION_DENIED"
  | "CAPABILITY_MISSING"
  | "VALIDATION_ERROR"
  | "TIMEOUT"
  | "SOURCE_UNAVAILABLE"
  | "POLICY_BLOCKED";

export interface AiToolExecution {
  id: string;
  run_id?: string;
  task_id?: string;
  agent_id: string;
  tool_code: string;
  capability_code?: string;
  classification: ToolClass;
  input_summary?: string;
  result_summary?: string;
  evidence_reference?: string;
  freshness: DataFreshness;
  status: ToolExecutionStatus;
  cost: number;
  cost_status: CostStatus;
  cache_hit: boolean;
  started_at: string;
  completed_at?: string;
}

export interface RoleCapabilityTemplate {
  role: string;
  department: string;
  description: string;
  standardCapabilities?: string[];
  optionalCapabilities?: string[];
  defaultRiskClass?: string;
  default_capabilities?: string[];
  denied_capabilities?: string[];
}
