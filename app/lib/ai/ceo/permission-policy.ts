import { AiAgentConfig, AgentLevel } from "./ceo-types";

// The strict hierarchy order
const LEVEL_WEIGHTS: Record<AgentLevel, number> = {
  CEO: 100,
  VP: 80,
  GM: 60,
  MANAGER: 40,
  REVIEWER: 30,
  SPECIALIST: 20
};

const FORBIDDEN_CAPABILITIES = [
  "ZOHO_WRITE",
  "EXTERNAL_WRITE",
  "UNRESTRICTED_SHELL",
  "UNRESTRICTED_SQL",
  "PAYMENT_AUTHORITY",
  "BANKING_WRITE",
  "CONTRACT_SIGNING",
  "STATUTORY_FILING",
  "SECURITY_POLICY_OVERRIDE"
];

export function checkInheritanceRules(parent: AiAgentConfig, child: AiAgentConfig): boolean {
  const parentWeight = LEVEL_WEIGHTS[parent.level] || 0;
  const childWeight = LEVEL_WEIGHTS[child.level] || 0;

  // Rule 1: A child cannot have a higher or equal level than its creator (unless CEO creates a new CEO, which is theoretically impossible, but strictly parentWeight > childWeight)
  if (childWeight >= parentWeight) {
    throw new Error(`Permission Escalation Blocked: ${parent.level} cannot create a ${child.level}`);
  }

  // Rule 2: ZOHO_WRITE and EXTERNAL_WRITE are strictly forbidden anywhere in the downward path.
  if (child.allowed_tools.includes("ZOHO_WRITE") || child.allowed_tools.includes("EXTERNAL_WRITE")) {
    throw new Error("Permission Escalation Blocked: Cannot grant ZOHO_WRITE or EXTERNAL_WRITE to internal agents dynamically.");
  }

  // Rule 3: Check forbidden capabilities
  for (const cap of child.capabilities) {
    if (FORBIDDEN_CAPABILITIES.includes(cap.toUpperCase())) {
      throw new Error(`Permission Escalation Blocked: Cannot grant forbidden capability '${cap}' to agent.`);
    }
  }

  // Rule 4: Ensure ZOHO_WRITE is explicitly in denied_tools
  if (!child.denied_tools.includes("ZOHO_WRITE")) {
    child.denied_tools.push("ZOHO_WRITE");
  }

  return true;
}
