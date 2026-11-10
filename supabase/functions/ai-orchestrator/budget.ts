// Pure budget policy for ai-orchestrator (no Deno globals, no network) so it is unit-testable in vitest.
//
// The authoritative monthly decision is ATOMIC and server-side: ai_orchestrator_reserve_budget
// (migration 20261112100000) re-computes the month ledger under the same advisory lock the tyre-photo
// worker uses and reserves a worst-case estimate in the same transaction, so concurrent requests cannot
// overshoot the cap. ai_orchestrator_settle_budget then records the actual cost exactly once per attempt.
// This module only shapes those calls and interprets their answers.

export interface Pricing { in: number; out: number }

const OFF = new Set(["false", "0", "off", "no"]);

/** True when a system_config value means "switched off". Unknown/blank = on (the default). */
export function isSwitchedOff(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return OFF.has(String(value).replace(/^"+|"+$/g, "").trim().toLowerCase());
}

/** USD for a token count at a per-1M price. Rounded to 6 dp like ai_token_logs.cost_usd. */
export function costUsd(pricing: Pricing, inTok: number, outTok: number): number {
  const i = Number.isFinite(inTok) && inTok > 0 ? inTok : 0;
  const o = Number.isFinite(outTok) && outTok > 0 ? outTok : 0;
  return Math.round(((i / 1e6) * pricing.in + (o / 1e6) * pricing.out) * 1e6) / 1e6;
}

/**
 * Worst-case cost of ONE orchestrator request: every tool round at its input ceiling and full output.
 * An env override (AI_ORCH_RESERVE_USD) wins when it is a positive number. Clamped to [0.01, 5] because
 * the reserve RPC refuses anything above 5 USD.
 */
export function estimateReserveUsd(opts: {
  rounds: number; inputTokensPerRound: number; outputTokensPerRound: number; pricing: Pricing; override?: unknown;
}): number {
  const ov = Number(opts.override);
  if (opts.override !== undefined && opts.override !== null && opts.override !== "" && Number.isFinite(ov) && ov > 0) {
    return Math.min(5, Math.max(0.01, ov));
  }
  const rounds = Math.max(1, Math.floor(opts.rounds || 1));
  const est = rounds * costUsd(opts.pricing, opts.inputTokensPerRound, opts.outputTokensPerRound);
  return Math.min(5, Math.max(0.01, Math.round(est * 1e6) / 1e6));
}

/** PostgREST / Postgres "function does not exist" (migration not applied yet). */
export function isMissingFunctionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  const code = String(e.code ?? "");
  if (code === "PGRST202" || code === "42883") return true;
  const msg = String(e.message ?? "").toLowerCase();
  return msg.includes("could not find the function") || (msg.includes("function") && msg.includes("does not exist"));
}

export type ReserveOutcome =
  | { mode: "reserved"; attemptId: string; reservedUsd: number }
  | { mode: "legacy" }
  | { mode: "refuse"; httpStatus: number; logStatus: "blocked"; userMessage: string; detail: string };

const UNAVAILABLE = "AI service controls are temporarily unavailable. Please try again later.";

/**
 * Turn the reserve RPC answer into what the handler does next. FAIL CLOSED:
 *  - RPC missing + a monthly cap configured  => 503 (the cap cannot be enforced atomically).
 *  - RPC missing + no cap                    => legacy mode (nothing to overshoot; token log written directly).
 *  - any other RPC error / malformed answer  => 503.
 */
export function interpretReserve(input: {
  data: unknown; error: unknown; capConfigured: boolean; attemptId: string; estimateUsd: number;
}): ReserveOutcome {
  const { data, error, capConfigured, attemptId, estimateUsd } = input;
  if (error) {
    if (isMissingFunctionError(error) && !capConfigured) return { mode: "legacy" };
    return { mode: "refuse", httpStatus: 503, logStatus: "blocked", userMessage: UNAVAILABLE,
      detail: isMissingFunctionError(error) ? "Budget reservation RPC not installed" : "AI budget control unavailable" };
  }
  const d = (data && typeof data === "object") ? data as Record<string, unknown> : null;
  if (!d) {
    return { mode: "refuse", httpStatus: 503, logStatus: "blocked", userMessage: UNAVAILABLE, detail: "Malformed budget reservation" };
  }
  if (d.ok === true) {
    const reserved = Number(d.reserved_usd);
    return { mode: "reserved", attemptId: String(d.attempt_id ?? attemptId),
      reservedUsd: Number.isFinite(reserved) && reserved > 0 ? reserved : estimateUsd };
  }
  const reason = typeof d.reason === "string" ? d.reason : "AI budget control unavailable";
  switch (d.state) {
    case "reached":
      return { mode: "refuse", httpStatus: 402, logStatus: "blocked",
        userMessage: "The monthly AI budget has been reached. Please contact your administrator.", detail: reason };
    case "disabled":
      return { mode: "refuse", httpStatus: 403, logStatus: "blocked",
        userMessage: "AI features are currently disabled by your administrator.", detail: reason };
    default:
      return { mode: "refuse", httpStatus: 503, logStatus: "blocked", userMessage: UNAVAILABLE, detail: reason };
  }
}

/**
 * Should the tool loop stop before starting another provider round? True when the cost so far plus a
 * worst-case next round would exceed what was reserved, so a request can never spend past its reservation.
 */
export function shouldStopForBudget(opts: {
  spentUsd: number; reservedUsd: number; lastInputTokens: number; maxOutputTokens: number; pricing: Pricing;
}): boolean {
  if (!(opts.reservedUsd > 0)) return false;
  // The next round re-sends the conversation (last input) plus new tool results: allow ~6k tokens growth.
  const nextRound = costUsd(opts.pricing, (opts.lastInputTokens || 0) + 6000, opts.maxOutputTokens);
  return opts.spentUsd + nextRound > opts.reservedUsd + 1e-9;
}

export interface SettleArgs {
  p_attempt: string; p_outcome: "success" | "error" | "released"; p_actual_usd: number | null;
  p_cost_known: boolean; p_model: string; p_prompt_tokens: number; p_completion_tokens: number;
  p_http_status: number | null; p_error: string | null; p_latency_ms: number | null;
}

/**
 * Build the settle RPC arguments. Rules:
 *  - success: cost known.
 *  - failure before any provider request: 'released' (nothing could have been billed).
 *  - failure after a provider request was sent: 'error' with cost UNKNOWN (the failed request may have
 *    been billed). The known partial cost of earlier rounds is still passed as actual_usd; the ledger
 *    keeps counting greatest(reserved, actual) for the rest of the month.
 */
export function buildSettleArgs(opts: {
  attemptId: string; ok: boolean; providerCalled: boolean; model: string; pricing: Pricing;
  inputTokens: number; outputTokens: number; httpStatus?: number | null; error?: string | null; latencyMs?: number | null;
}): SettleArgs {
  const actual = costUsd(opts.pricing, opts.inputTokens, opts.outputTokens);
  const base = {
    p_attempt: opts.attemptId, p_model: opts.model,
    p_prompt_tokens: Math.max(0, Math.floor(opts.inputTokens || 0)),
    p_completion_tokens: Math.max(0, Math.floor(opts.outputTokens || 0)),
    p_http_status: opts.httpStatus ?? null,
    p_error: opts.error ? String(opts.error).slice(0, 500) : null,
    p_latency_ms: opts.latencyMs ?? null,
  };
  if (opts.ok) return { ...base, p_outcome: "success", p_actual_usd: actual, p_cost_known: true, p_http_status: opts.httpStatus ?? 200 };
  if (!opts.providerCalled) return { ...base, p_outcome: "released", p_actual_usd: 0, p_cost_known: true };
  return { ...base, p_outcome: "error", p_actual_usd: actual, p_cost_known: false };
}
