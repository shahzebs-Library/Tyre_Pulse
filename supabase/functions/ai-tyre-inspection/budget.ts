// Pure monthly-budget policy for the ai-tyre-inspection worker (no Deno globals, no network).
//
// Mirrors the platform switch that chat-ai / ai-orchestrator enforce (system_config
// ai_monthly_budget_usd, 0 or unset = uncapped, ai_enabled = master switch) but is stricter for the
// paid tyre-photo path, which is a HARD stop:
//  * the call is refused when spent + the per-call reservation would EXCEED the limit
//    (chat-ai only refuses once spent >= limit);
//  * an unreadable control, an unparsable limit or an unreadable spend total fails CLOSED;
//  * a tyre-inspection call whose cost is unknown (NULL) is charged the reservation, never 0.
//
// This pure check is only an early, cheap PRE-FLIGHT (read-then-act). The authoritative monthly
// decision is atomic: ai_tyre_reserve_budget_atomic (migration 20261026095000) re-computes the month
// ledger under an advisory lock and reserves in the same transaction, so concurrent workers cannot
// overshoot. Month totals are GLOBAL (all tenants, all AI features), matching chat-ai.

export type BudgetState = "uncapped" | "ok" | "reached" | "disabled" | "unavailable";

export interface MonthlyBudgetDecision {
  allowed: boolean;
  state: BudgetState;
  /** Plain-English reason, safe to show to users. */
  reason: string;
  limitUsd: number | null;
  spentUsd: number | null;
}

export interface AiControls { enabled: boolean; limitUsd: number; invalidLimit: boolean }

const OFF = new Set(["false", "0", "off", "no"]);

/** Parse the system_config rows for ai_enabled / ai_monthly_budget_usd. */
export function parseAiControls(rows: Array<{ key?: unknown; value?: unknown }> | null | undefined): AiControls {
  const m: Record<string, string> = {};
  for (const r of rows ?? []) if (r && typeof r.key === "string") m[r.key] = String(r.value ?? "").trim();
  const enabled = !(m.ai_enabled && OFF.has(m.ai_enabled.toLowerCase()));
  const raw = (m.ai_monthly_budget_usd ?? "").replace(/^"+|"+$/g, "").trim();
  if (raw === "") return { enabled, limitUsd: 0, invalidLimit: false };
  const n = Number(raw);
  // A non-numeric or negative limit is a misconfiguration: fail closed rather than silently uncapped.
  if (!Number.isFinite(n) || n < 0) return { enabled, limitUsd: 0, invalidLimit: true };
  return { enabled, limitUsd: n, invalidLimit: false };
}

/** First instant of the current UTC month (the window chat-ai also uses). */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export interface SpendRow { cost_usd?: unknown; feature?: unknown; status?: unknown }
export interface JobSpendRow { cost_usd?: unknown; provider_called_at?: unknown; prior_billed_usd?: unknown }

/**
 * Month spend across BOTH ledgers, without double counting:
 *  - ai_token_logs: every feature EXCEPT ai_tyre_inspection (chat / orchestrator / embeddings). NULL costs
 *    count as 0, same as chat-ai.
 *  - ai_tyre_inspection_jobs: the authoritative ledger for this path. The worker writes a token-log row
 *    only for FAILED calls, so successful tyre calls exist only here, and failed ones exist in both.
 *    A job whose provider was called (provider_called_at set) with a NULL cost is "usage unknown, may have
 *    been billed" and is charged `unknownCallUsd` (the per-call reservation), never 0.
 * Returns null when any cost is present but not a finite non-negative number (corrupt data must not read
 * as a low total). Jobs attempted before provider_called_at existed are not visible here (see handover).
 */
export function sumMonthSpend(
  logs: SpendRow[] | null | undefined, jobs: JobSpendRow[] | null | undefined, unknownCallUsd: number,
): number | null {
  let sum = 0;
  for (const r of logs ?? []) {
    if (r?.feature === "ai_tyre_inspection") continue;
    if (r?.cost_usd === null || r?.cost_usd === undefined) continue;
    const n = Number(r.cost_usd);
    if (!Number.isFinite(n) || n < 0) return null;
    sum += n;
  }
  for (const j of jobs ?? []) {
    // Spend carried over from a forced admin re-queue of a possibly-billed attempt.
    const prior = Number(j?.prior_billed_usd);
    if (Number.isFinite(prior) && prior > 0) sum += prior;
    if (!j?.provider_called_at) continue;
    if (j.cost_usd === null || j.cost_usd === undefined) { sum += unknownCallUsd; continue; }
    const n = Number(j.cost_usd);
    if (!Number.isFinite(n) || n < 0) return null;
    sum += n;
  }
  return Number(sum.toFixed(6));
}

/** Decide whether ONE more paid call (worst case `reserveUsd`) may start. Pure. */
export function evaluateMonthlyBudget(input: {
  controls: AiControls | null; spentUsd: number | null; reserveUsd: number;
}): MonthlyBudgetDecision {
  const { controls, spentUsd, reserveUsd } = input;
  if (!controls) {
    return { allowed: false, state: "unavailable", reason: "AI budget control unavailable", limitUsd: null, spentUsd: null };
  }
  if (!controls.enabled) {
    return { allowed: false, state: "disabled", reason: "AI is switched off by an administrator", limitUsd: null, spentUsd: null };
  }
  if (controls.invalidLimit) {
    return { allowed: false, state: "unavailable", reason: "AI monthly budget setting is invalid", limitUsd: null, spentUsd: null };
  }
  if (controls.limitUsd <= 0) {
    return { allowed: true, state: "uncapped", reason: "No monthly AI budget cap is set", limitUsd: null, spentUsd };
  }
  if (spentUsd === null || !Number.isFinite(spentUsd) || spentUsd < 0) {
    return { allowed: false, state: "unavailable", reason: "AI monthly spend could not be read", limitUsd: controls.limitUsd, spentUsd: null };
  }
  const reserve = Number.isFinite(reserveUsd) && reserveUsd > 0 ? reserveUsd : 0;
  if (spentUsd + reserve > controls.limitUsd + 1e-9) {
    return {
      allowed: false, state: "reached",
      reason: `Monthly AI budget reached (${spentUsd.toFixed(2)} of ${controls.limitUsd.toFixed(2)} USD)`,
      limitUsd: controls.limitUsd, spentUsd,
    };
  }
  return { allowed: true, state: "ok", reason: "Within monthly AI budget", limitUsd: controls.limitUsd, spentUsd };
}
