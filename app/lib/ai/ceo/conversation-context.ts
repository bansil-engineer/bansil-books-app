/**
 * Deterministic follow-up context for the AI CEO fast path.
 *
 * No model call is ever made here. Context is derived from the conversation's
 * persisted messages: the most recent fast-path assistant result (heading +
 * "Data Basis" footer) tells us the business intent, the period that was
 * actually used and the result that was shown.
 */

import { Message } from "../types";
import { DateRange, hasExplicitPeriod } from "./date-resolver";
import { BusinessIntent, classifyIntent } from "./planning-engine";

export interface ConversationContext {
  lastBusinessIntent: BusinessIntent | null;
  /** Period shown in the previous result. null for point-in-time results (receivable/payable). */
  lastResolvedPeriod: DateRange | null;
  lastEntityScope: "ALL" | "TOP_5_CUSTOMERS" | "TOP_5_VENDORS" | null;
  lastBusinessResultType: string | null;
  lastResultContent: string | null;
}

export type FollowUpKind = "NONE" | "REFORMAT" | "INHERIT_PERIOD";

export interface FollowUpResolution {
  intent: BusinessIntent | "REFORMAT_FOLLOW_UP";
  kind: FollowUpKind;
  periodOverride?: DateRange;
  reformattedContent?: string;
  context: ConversationContext;
}

const EMPTY_CONTEXT: ConversationContext = {
  lastBusinessIntent: null,
  lastResolvedPeriod: null,
  lastEntityScope: null,
  lastBusinessResultType: null,
  lastResultContent: null,
};

const HEADING_MAP: Array<[string, BusinessIntent, ConversationContext["lastEntityScope"]]> = [
  ["### Sales Summary", "SALES_QUERY", "ALL"],
  ["### Purchase Summary", "PURCHASE_QUERY", "ALL"],
  ["### Receivables Summary", "RECEIVABLE_QUERY", "ALL"],
  ["### Payables Summary", "PAYABLE_QUERY", "ALL"],
  ["### Top 5 Customers", "CUSTOMER_QUERY", "TOP_5_CUSTOMERS"],
  ["### Top 5 Vendors", "VENDOR_QUERY", "TOP_5_VENDORS"],
];

function ddmmyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parsePeriodLabel(label: string): DateRange | null {
  const parts = label.trim().split(/\s*[–-]\s*/);
  if (parts.length === 2) {
    const s = ddmmyyyyToIso(parts[0]);
    const e = ddmmyyyyToIso(parts[1]);
    if (s && e) return { startDate: s, endDate: e, description: label.trim() };
  } else if (parts.length === 1) {
    const d = ddmmyyyyToIso(parts[0]);
    if (d) return { startDate: d, endDate: d, description: label.trim() };
  }
  return null; // e.g. "Current"
}

/**
 * `history` normally already contains the current owner message as its last
 * entry (the chat route persists it before calling us). It is excluded so the
 * context only reflects what came BEFORE the current turn. A brand-new
 * conversation therefore always yields an empty context.
 */
export function deriveConversationContext(history: Message[], currentMessage: string): ConversationContext {
  const prior = [...history];
  const last = prior[prior.length - 1];
  if (last && last.role === "user" && last.content === currentMessage) prior.pop();

  const lastAssistant = [...prior].reverse().find(m => m.role === "assistant");
  if (!lastAssistant || !lastAssistant.content.includes("Data Basis:")) return { ...EMPTY_CONTEXT };

  const content = lastAssistant.content;
  const hit = HEADING_MAP.find(([h]) => content.includes(h));
  if (!hit) return { ...EMPTY_CONTEXT };

  const periodMatch = content.match(/- Period: (.+)/);
  return {
    lastBusinessIntent: hit[1],
    lastResolvedPeriod: periodMatch ? parsePeriodLabel(periodMatch[1]) : null,
    lastEntityScope: hit[2],
    lastBusinessResultType: hit[0].replace("### ", ""),
    lastResultContent: content,
  };
}

const REFORMAT_PATTERNS = [
  /\b(in|into|as)\s+(a\s+)?(table|tabular)/,
  /\btable\s+format/,
  /\bstructured\b/,
  /\bmake it (simple|simpler|short|shorter|clear|clearer)/,
  /\b(show|give)\s+(me\s+)?(all|full|complete)\s+(the\s+)?(data|details?|numbers)/,
  /\ball data\b/,
  /\bsummari[sz]e\b/,
  /\bformat\s+(this|it|that)\b/,
  /\bexplain\s+(this|it|that)\b/,
];

export function isReformatRequest(message: string): boolean {
  const lower = message.toLowerCase();
  return REFORMAT_PATTERNS.some(r => r.test(lower));
}

function wantsSummaryOnly(lower: string): boolean {
  const table = /table|structured|all data|all the data|format/.test(lower);
  return !table && /summari[sz]e|simple|simpler|short|explain|clear/.test(lower);
}

/** Re-render the already verified previous result. Values and footer are copied verbatim. */
export function reformatPreviousResult(ctx: ConversationContext, message: string): string {
  const content = ctx.lastResultContent || "";
  const footerIdx = content.indexOf("\n\nData Basis:");
  const body = footerIdx >= 0 ? content.slice(0, footerIdx) : content;
  const footer = footerIdx >= 0 ? content.slice(footerIdx) : "";

  const title = (body.match(/^###\s+.+$/m) || [`### ${ctx.lastBusinessResultType || "Result"}`])[0];
  const summaryMatch = body.match(/\*\*Executive Summary\*\*\n([\s\S]*?)(?=\n\n\||$)/);
  const tableLines = body.split("\n").filter(l => l.trim().startsWith("|")).join("\n");
  const periodLine = ctx.lastResolvedPeriod ? `**Period:** ${ctx.lastResolvedPeriod.description}\n\n` : "";
  const note = "_Reformatted from the previous verified result. No new query was run._";

  if (wantsSummaryOnly(message.toLowerCase()) && summaryMatch) {
    return `${title}\n\n${periodLine}**Executive Summary**\n${summaryMatch[1].trim()}\n\n${note}${footer}`;
  }
  return `${title}\n\n${periodLine}${tableLines}\n\n${note}${footer}`;
}

const PERIOD_BASED: BusinessIntent[] = ["SALES_QUERY", "PURCHASE_QUERY", "CUSTOMER_QUERY", "VENDOR_QUERY"];

export function resolveFollowUp(message: string, history: Message[]): FollowUpResolution {
  const ctx = deriveConversationContext(history, message);
  const intent = classifyIntent(message);

  // 1. Reformat the immediately previous verified result (generic chat otherwise).
  if (intent === "DIRECT_CHAT" && ctx.lastResultContent && isReformatRequest(message)) {
    return {
      intent: "REFORMAT_FOLLOW_UP",
      kind: "REFORMAT",
      reformattedContent: reformatPreviousResult(ctx, message),
      context: ctx,
    };
  }

  // 2. Period inheritance. An explicit period in the new message always wins,
  //    and point-in-time intents (receivable/payable) never inherit.
  if (
    PERIOD_BASED.includes(intent) &&
    ctx.lastResolvedPeriod &&
    !hasExplicitPeriod(message)
  ) {
    return { intent, kind: "INHERIT_PERIOD", periodOverride: ctx.lastResolvedPeriod, context: ctx };
  }

  return { intent, kind: "NONE", context: ctx };
}
