// ============================================================
// Bansil Books Analytics — Skill Package Guard (Milestone A)
// Static, non-executing content review of an uploaded Skill ZIP.
// This module never requires(), imports, evals, or shells out to
// any file inside the package. It only lists entries and scans
// declared TEXT content (SKILL.md, references/*.md, *.json, *.yaml)
// for instruction patterns that BANSIL_AUDIT_IMPLEMENTATION.md
// section 11 says outrank any skill:
//   - requesting a credential / secret / token
//   - requesting an OAuth scope change or Zoho write access
//   - requesting arbitrary code execution ("run this script",
//     "execute", "eval", shelling out, installers)
//   - requesting writes to external systems
//   - requesting cross-entity / cross-tenant access
//   - asking to bypass human review / approval
//   - asking to hide, suppress or zero out a discrepancy/finding
// A BLOCKED verdict does not delete the package — it is still stored
// as DRAFT with guard_verdict=BLOCKED so a reviewer can see exactly
// why, per "unsupported actions must be disabled with a clear
// explanation" rather than silently rejected.
//
// DETERMINISTIC ONLY — no AI/model call is used for this security
// decision, so the result is reviewable and reproducible from the
// package bytes alone.
//
// Negation/prohibition awareness: a Skill document is allowed to
// *describe a prohibition* ("Block cross-entity access", "do not
// execute this script") without being treated as *requesting* the
// prohibited behaviour. Detection is sentence-scoped: a banned phrase
// is only flagged when the SAME sentence contains no negation marker.
// This is intentionally simple pattern matching, not NLP — see the
// documented limitation below on double-negatives.
// ============================================================

import { createHash } from "node:crypto";
import { inspectZipBuffer, type ZipEntryInfo } from "./zip-inspect.ts";

export interface SkillGuardResult {
  verdict: "PASS" | "BLOCKED";
  reasons: string[];
  entries: ZipEntryInfo[];
  manifestText: string | null; // SKILL.md content if present, for reviewer preview
  packageSha256: string;
  packageSizeBytes: number;
}

interface BannedPattern {
  label: string;
  pattern: RegExp;
}

const BANNED_PATTERNS: BannedPattern[] = [
  {
    label: "requests a credential, API key, secret, or token",
    pattern:
      /\b(provide|send|enter|paste|expose|share)\b.{0,40}\b(api[\s_-]?key|client[\s_-]?secret|access[\s_-]?token|refresh[\s_-]?token|password|private[\s_-]?key)\b|\b(api[\s_-]?key|client[\s_-]?secret|access[\s_-]?token|refresh[\s_-]?token|password|private[\s_-]?key)\b.{0,40}\b(provide|send|enter|paste|expose|share)\b/i,
  },
  { label: "requests OAuth scope expansion or Zoho write access", pattern: /\b(oauth\s*scope|write\s*scope|ZohoBooks\.\w+\.(CREATE|UPDATE|DELETE))\b/i },
  { label: "requests arbitrary code execution", pattern: /\b(execute|run)\b.{0,30}\b(script|shell|command|binary|installer|\.exe|\.sh|\.py|\.js|\.sql)\b/i },
  { label: "requests writes to an external system", pattern: /\b(post|write|upload|push)\b.{0,30}\b(external|third[\s-]party|outside)\b.{0,30}\bsystem\b/i },
  { label: "requests cross-entity or cross-tenant access", pattern: /\bcross[\s-]?(entity|tenant|organization)\b.{0,30}\baccess\b/i },
  { label: "asks to bypass human review or approval", pattern: /\bbypass\b.{0,30}\b(human\s+review|approval|reviewer)\b/i },
  { label: "asks to hide or suppress a discrepancy/finding", pattern: /\b(hide|suppress|zero[\s-]?out|conceal)\b.{0,30}\b(discrepanc|mismatch|finding|variance)\w*\b/i },
];

// Any of these appearing in the SAME sentence as a banned phrase means the
// sentence is describing a prohibition/control, not issuing the request.
const NEGATION_MARKERS =
  /\b(do not|does not|did not|don't|doesn't|cannot|can not|can't|must not|mustn't|should not|shouldn't|will not|won't|never|forbid(s|den)?|disallow(s|ed)?|prevent(s|ed)?|prohibit(s|ed)?|banned?|block(s|ed)?|reject(s|ed)?|refuse(s|d)?|no\s)\b/i;

// Phrases that contain a negation WORD but flip the meaning back to an
// affirmative instruction ("don't forget to execute..." is a request, not a
// prohibition). Checked before trusting a NEGATION_MARKERS hit.
const NEGATION_OVERRIDES =
  /\b(do not forget to|don't forget to|doesn't forget to|make sure to|be sure to|remember to|ensure (that )?you)\b/i;

function isNegatedSentence(sentence: string): boolean {
  return NEGATION_MARKERS.test(sentence) && !NEGATION_OVERRIDES.test(sentence);
}

/** Splits free text into sentence-ish clauses so a banned phrase can be judged in its own local context. */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Scans an uploaded skill package buffer. Never throws for a package that
 * merely fails the content guard (that is a normal BLOCKED verdict); it
 * only throws if the ZIP structure itself is unreadable, since that is
 * not a package Settings > Skills can store at all.
 */
export function guardSkillPackage(fileBuffer: Buffer): SkillGuardResult {
  const inspection = inspectZipBuffer(fileBuffer);

  const manifestPath = Object.keys(inspection.textByPath).find((p) => /(^|\/)SKILL\.md$/i.test(p)) ?? null;
  const manifestText = manifestPath ? inspection.textByPath[manifestPath] : null;

  const reasons: string[] = [];

  if (!manifestPath) {
    reasons.push("Package does not contain a SKILL.md instruction manifest at its root or top-level folder");
  }

  for (const [filePath, fileText] of Object.entries(inspection.textByPath)) {
    const sentences = splitIntoSentences(fileText);
    for (const banned of BANNED_PATTERNS) {
      for (const sentence of sentences) {
        if (!banned.pattern.test(sentence)) continue;
        if (isNegatedSentence(sentence)) continue; // describes a prohibition — not a request
        const preview = sentence.length > 160 ? `${sentence.slice(0, 160)}…` : sentence;
        reasons.push(`Content guard match in ${filePath}: ${banned.label} — "${preview}"`);
      }
    }
  }

  const executableLikeEntries = inspection.entries.filter(
    (e) => !e.isDirectory && /\.(exe|dll|so|dylib|bat|ps1|msi|scr)$/i.test(e.path)
  );
  if (executableLikeEntries.length > 0) {
    reasons.push(
      `Package contains installer/binary-style entries that will never be executed by this application: ${executableLikeEntries
        .map((e) => e.path)
        .join(", ")}`
    );
  }

  return {
    verdict: reasons.length === 0 ? "PASS" : "BLOCKED",
    reasons,
    entries: inspection.entries,
    manifestText,
    packageSha256: createHash("sha256").update(fileBuffer).digest("hex"),
    packageSizeBytes: fileBuffer.byteLength,
  };
}
