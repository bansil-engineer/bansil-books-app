// ============================================================
// Bansil Books Analytics — Controlled Learning: Rule Evaluator (Milestone E)
// Pure, deterministic, side-effect-free. Interprets a RuleConfig as DATA
// only — never eval(), never a child process, never a network call, never
// reads/writes any table. A malformed pattern is treated as "no match",
// never thrown past the caller and never silently treated as "applies".
// ============================================================

import type { RuleConfig, RuleExampleInput } from "./learning-types.ts";

export class RuleEvaluationError extends Error {}

/** Returns whether `config` would apply to `input`. Never throws — a bad regex/missing field resolves to false (does not apply), which is the safe default. */
export function evaluateRule(config: RuleConfig, input: RuleExampleInput): boolean {
  if (!config || !config.matchField || typeof config.matchPattern !== "string") return false;
  const fieldValue = input[config.matchField];
  if (fieldValue === undefined || fieldValue === null) return false;
  const valueStr = String(fieldValue);

  if (config.matchPattern.startsWith("regex:")) {
    const patternBody = config.matchPattern.slice("regex:".length);
    try {
      const re = new RegExp(patternBody, config.caseSensitive === false ? "i" : "");
      return re.test(valueStr);
    } catch {
      return false;
    }
  }

  if (config.caseSensitive === false) {
    return valueStr.toLowerCase() === config.matchPattern.toLowerCase();
  }
  return valueStr === config.matchPattern;
}

export interface ExampleResult {
  exampleId: string;
  exampleType: string;
  expectedApply: boolean;
  actualApply: boolean;
  passed: boolean;
}

export interface RuleTestSummary {
  totalExamples: number;
  passed: number;
  failed: number;
  results: ExampleResult[];
  allPassed: boolean;
}

/** Runs every declared example against the rule config and reports pass/fail per example — never alters an assertion to force a PASS. */
export function runExamplesAgainstRule(
  config: RuleConfig,
  examples: Array<{ exampleId: string; exampleType: string; expectedApply: boolean; input: RuleExampleInput }>
): RuleTestSummary {
  const results: ExampleResult[] = examples.map((ex) => {
    const actualApply = evaluateRule(config, ex.input);
    return {
      exampleId: ex.exampleId,
      exampleType: ex.exampleType,
      expectedApply: ex.expectedApply,
      actualApply,
      passed: actualApply === ex.expectedApply,
    };
  });
  const passed = results.filter((r) => r.passed).length;
  return {
    totalExamples: results.length,
    passed,
    failed: results.length - passed,
    results,
    allPassed: results.length > 0 && passed === results.length,
  };
}
