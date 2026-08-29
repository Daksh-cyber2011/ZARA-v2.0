/**
 * ZARA V1.0 — Result verification (Directive §19).
 *
 * NEVER "tool called → assume success → done". Verification combines the
 * tool's own declared strategy with sanity inspection of the returned data.
 * A tool whose result lacks verifiable substance for an "inspected" strategy
 * is treated as UNVERIFIED and reported honestly.
 */
import { ToolDefinition, ToolResult } from "../tools/ToolTypes";

export type VerificationOutcome =
  | { status: "verified"; detail: string }
  | { status: "failed"; detail: string }
  | { status: "unverified"; detail: string };

export function verifyResult(tool: ToolDefinition, result: ToolResult): VerificationOutcome {
  if (!result.ok) {
    return {
      status: "failed",
      detail: result.error?.message ?? result.summary ?? "The action failed."
    };
  }

  if (tool.verification === "result_ok") {
    // Native layer asserted completion (e.g. startActivity resolved).
    return { status: "verified", detail: result.summary };
  }

  // "inspected": the summary/data must carry concrete substance.
  const data = result.data ?? {};
  const hasSubstance =
    typeof result.summary === "string" && result.summary.length > 3 &&
    (Object.keys(data).length > 0 || /(\d|id|created|set|opened|enabled|disabled|at |%)/i.test(result.summary));

  if (hasSubstance) return { status: "verified", detail: result.summary };
  return {
    status: "unverified",
    detail: "The action reported success but returned no verifiable details — treat with caution."
  };
}

/** Phrase the outcome honestly for the model + the user (§19). */
export function outcomePhrase(tool: string, v: VerificationOutcome, result: ToolResult): string {
  switch (v.status) {
    case "verified":
      return result.summary || `${tool} completed.`;
    case "failed":
      return `I couldn't complete that: ${v.detail}`;
    case "unverified":
      return `${result.summary} (unverified — no confirmation details returned)`;
  }
}
