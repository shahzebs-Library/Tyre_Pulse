// Pure decision + job-processing logic for the ai-tyre-inspection worker.
// No Deno globals, no network, no remote imports, so vitest can import this file
// and exercise malformed provider output, cost accounting and budget handling
// against injected fakes. index.ts wires the real Supabase/provider dependencies.
//
// Money rules (see docs/AI_TYRE_INSPECTION_HANDOVER.md):
//  * A budget reservation is taken BEFORE any paid provider call.
//  * Every provider attempt (ok, malformed, non-JSON, HTTP error, timeout) is
//    settled against the budget. Unknown usage is charged at the reservation
//    (conservative) but the job/log cost stays NULL = unknown, never 0.
//  * A job whose provider was already called is never called again.

import type { MonthlyBudgetDecision } from "./budget.ts";

export type Json = Record<string, unknown>;

export const ENQUEUE_ROLES = ["admin", "manager", "director", "maintenance supervisor", "tyre man"] as const;
export const REVIEW_ROLES = ["admin", "manager", "director", "maintenance supervisor"] as const;
export const BACKFILL_ROLES = ["admin", "manager", "director", "maintenance supervisor", "pmv manager"] as const;
export const PROMPT_VERSION = "tyre-photo-v2";

const norm = (role: unknown) => String(role ?? "").trim().toLowerCase();
export const roleAllowed = (role: unknown, allowed: readonly string[]) => allowed.includes(norm(role));
export const canEnqueue = (role: unknown) => roleAllowed(role, ENQUEUE_ROLES);
export const canReview = (role: unknown) => roleAllowed(role, REVIEW_ROLES);
export const canBackfill = (role: unknown) => roleAllowed(role, BACKFILL_ROLES);

// Model text is shown to users: em/en dashes are replaced by commas so reports stay plain ASCII punctuation.
const plain = (v: string) => v.replace(/\s*[\u2014\u2013]\s*/g, ", ");
export const str = (value: unknown, length = 300) =>
  typeof value === "string" ? plain(value.trim()).slice(0, length) : "";

export function normalizeAnalysis(raw: unknown): Json {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid AI response");
  const body = raw as Json;
  const allowed = new Set(["uneven_wear", "shoulder_wear", "center_wear", "tread_wear",
    "sidewall_cut", "tread_cut", "cracking", "bulge", "exposed_cord", "suspected_separation",
    "embedded_object", "puncture_evidence", "other_visible_damage", "uncertain"]);
  const defects = (Array.isArray(body.defects) ? body.defects : []).slice(0, 12)
    .filter(d => d && typeof d === "object").map(d => {
      const x = d as Json;
      return { type: allowed.has(str(x.type)) ? x.type : "uncertain",
        description: str(x.description, 450), visibleEvidence: str(x.visibleEvidence, 450),
        severity: ["none", "low", "moderate", "high", "urgent", "unknown"].includes(str(x.severity))
          ? x.severity : "unknown" };
    });
  return { assessable: body.assessable === true, reason: str(body.reason, 400),
    recommendation: str(body.recommendation, 700),
    defects: body.assessable === true ? defects : [],
    humanReviewRequired: true, exactTreadDepthMm: null, remainingTreadLifeKm: null };
}

/** Strip optional markdown fences, parse, normalise. Throws on anything unusable. */
export function parseModelOutput(output: unknown): Json {
  const text = String(output || "").trim();
  const clean = text.replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/, "");
  try { return normalizeAnalysis(JSON.parse(clean)); } catch { /* try tolerant extraction below */ }
  // Models sometimes add a sentence around the JSON or stop mid-object: take the outermost object,
  // and if it was cut off, close open strings/brackets so the usable fields still parse.
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object in model output");
  const end = text.lastIndexOf("}");
  if (end > start) {
    try { return normalizeAnalysis(JSON.parse(text.slice(start, end + 1))); } catch { /* fall through to repair */ }
  }
  return normalizeAnalysis(JSON.parse(repairTruncatedJson(text.slice(start))));
}

/** Close a truncated JSON object: drop a dangling key/comma, terminate a string, close brackets. */
export function repairTruncatedJson(src: string): string {
  const stack: string[] = [];
  let inString = false, escaped = false, out = "";
  for (const ch of src) {
    out += ch;
    if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inString) out += '"';
  out = out.replace(/,\s*$/, "").replace(/,?\s*"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
  return out + stack.reverse().join("");
}

export interface Usage { known: boolean; input: number | null; output: number | null; total: number | null }

export function extractUsage(providerName: string, provider: any): Usage {
  const usage = providerName === "anthropic" ? provider?.usage : provider?.usageMetadata;
  const input = providerName === "anthropic" ? Number(usage?.input_tokens) : Number(usage?.promptTokenCount);
  const output = providerName === "anthropic" ? Number(usage?.output_tokens) : Number(usage?.candidatesTokenCount);
  const known = usage != null && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0;
  if (!known) return { known: false, input: null, output: null, total: null };
  const total = providerName === "google" && Number.isFinite(Number(usage?.totalTokenCount))
    ? Number(usage.totalTokenCount) : input + output;
  return { known: true, input, output, total };
}

export interface Rates { input: number; output: number }
/** USD per million tokens, or null when pricing is not verified for this model. */
export function resolveRates(providerName: string, model: string, env: (k: string) => string | undefined): Rates | null {
  const standard = providerName === "anthropic"
    ? (model === "claude-haiku-5-5" ? [0.10, 0.50] : model === "claude-sonnet-5-5" ? [2, 10] : null)
    : (model === "gemini-2.5-flash-lite" ? [0.10, 0.40] : null);
  const input = Number(env("AI_INPUT_USD_PER_MILLION") ?? standard?.[0]);
  const output = Number(env("AI_OUTPUT_USD_PER_MILLION") ?? standard?.[1]);
  return Number.isFinite(input) && Number.isFinite(output) && input > 0 && output > 0 ? { input, output } : null;
}

/** Estimated cost; null (unknown, never 0) when usage or pricing is missing. */
export function estimateCost(usage: Usage, rates: Rates | null): number | null {
  if (!usage.known || !rates) return null;
  return Number((((usage.input as number) * rates.input + (usage.output as number) * rates.output) / 1e6).toFixed(6));
}

export type FailureKind =
  | "photo_unavailable" | "invalid_reference" | "budget_deferred"
  | "provider_timeout" | "provider_http_error" | "provider_non_json"
  | "invalid_model_output" | "prior_attempt" | "stalled" | "monthly_budget_reached";

export class ProviderCallError extends Error {
  constructor(public kind: "provider_timeout" | "provider_http_error" | "provider_non_json",
    message: string, public status?: number) { super(message); }
}

export interface JobRow { id: string; organisation_id: string; photo_ref: string; attempts: number }
export interface Photo { mediaType: string; base64: string }

export interface Deps {
  config: { providerName: string; model: string; rates: Rates | null; reserveUsd: number; dailyLimitUsd: number };
  now: () => Date;
  /** Update a job only while it is in fromStatus. Returns whether a row changed. */
  updateJob: (id: string, patch: Json, fromStatus: string) => Promise<boolean>;
  insertTokenLog: (row: Json) => Promise<void>;
  /**
   * HARD monthly cap (system_config ai_monthly_budget_usd). Optional so existing callers/tests keep
   * working; index.ts always wires it. Must resolve a decision; a throw is treated as "unavailable"
   * (fail closed). Called before the photo is downloaded and before any reservation.
   */
  checkMonthlyBudget?: (reserveUsd: number) => Promise<MonthlyBudgetDecision>;
  reserveBudget: (orgId: string, jobId: string, estimateUsd: number, limitUsd: number) => Promise<{ ok: boolean; reason?: string }>;
  settleBudget: (jobId: string, actualUsd: number | null, providerCalled: boolean) => Promise<void>;
  loadPhoto: (ref: string) => Promise<Photo>;
  /** Performs exactly ONE paid provider request. Throws ProviderCallError on failure. */
  callProvider: (photo: Photo) => Promise<{ provider: any; output: unknown }>;
}

export type Outcome = "completed" | "failed" | "deferred" | "skipped_prior_attempt";

const stamp = (d: Deps) => d.now().toISOString();

async function failJob(d: Deps, job: JobRow, kind: FailureKind, message: string, extra: Json = {}) {
  await d.updateJob(job.id, { status: "failed", failure_kind: kind, error_message: str(message, 160),
    updated_at: stamp(d), ...extra }, "processing");
}

/** Process one claimed (status=processing) job. Never throws. */
export async function processJob(d: Deps, job: JobRow): Promise<Outcome> {
  const { providerName, model, rates } = d.config;
  let reserved = false, called = false, settled = false;
  const settle = async (cost: number | null) => { if (!settled) { settled = true; await d.settleBudget(job.id, cost, called); } };
  try {
    // Hard stop: a photo that was already attempted is never paid for again.
    if (job.attempts > 0) {
      await failJob(d, job, "prior_attempt", "Prior attempt requires manual review");
      return "skipped_prior_attempt";
    }
    // Hard monthly cap: nothing is downloaded, reserved or billed when the cap is reached/unreadable.
    if (d.checkMonthlyBudget) {
      let decision: MonthlyBudgetDecision;
      try { decision = await d.checkMonthlyBudget(d.config.reserveUsd); }
      catch {
        decision = { allowed: false, state: "unavailable", reason: "AI budget control unavailable", limitUsd: null, spentUsd: null };
      }
      if (!decision.allowed) {
        // Visible, auditable stop: a 'blocked' log row (like chat-ai) and the job returns un-attempted.
        try {
          await d.insertTokenLog({ organisation_id: job.organisation_id, model, feature: "ai_tyre_inspection",
            prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, status: "blocked",
            error: str(`${decision.state}: ${decision.reason}`, 300) });
        } catch { /* logging must never turn a safe stop into a crash */ }
        await d.updateJob(job.id, { status: "pending", attempts: job.attempts, failure_kind: "monthly_budget_reached",
          error_message: str(decision.reason, 160), updated_at: stamp(d) }, "processing");
        return "deferred";
      }
    }
    let photo: Photo;
    try { photo = await d.loadPhoto(job.photo_ref); }
    catch (e) {
      const invalid = e instanceof Error && e.message === "Invalid private media reference";
      await failJob(d, job, invalid ? "invalid_reference" : "photo_unavailable",
        e instanceof Error ? e.message : "Photo unavailable");
      return "failed";
    }

    // Atomic, concurrency-safe reservation BEFORE the paid call.
    const reservation = await d.reserveBudget(job.organisation_id, job.id, d.config.reserveUsd, d.config.dailyLimitUsd);
    if (!reservation.ok) {
      // No provider call happened: hand the job back un-attempted for a later day/run.
      await d.updateJob(job.id, { status: "pending", attempts: job.attempts, failure_kind: "budget_deferred",
        error_message: str(reservation.reason || "Daily AI spending limit reached", 160), updated_at: stamp(d) }, "processing");
      return "deferred";
    }
    reserved = true;
    // Persist the fact of the attempt before the request so a crash cannot cause a second charge.
    await d.updateJob(job.id, { provider_attempts: 1, provider_called_at: stamp(d), provider: providerName,
      model_version: model, prompt_version: PROMPT_VERSION }, "processing");

    called = true;
    let result: { provider: any; output: unknown };
    try {
      result = await d.callProvider(photo);
    } catch (e) {
      const kind = e instanceof ProviderCallError ? e.kind : "provider_http_error";
      const message = e instanceof Error ? e.message : "AI provider request failed";
      // Usage unknown: the request may still have been billed. Cost stays NULL (unknown), never 0.
      await d.insertTokenLog({ organisation_id: job.organisation_id, model, feature: "ai_tyre_inspection",
        prompt_tokens: 0, completion_tokens: 0, cost_usd: null, status: "error",
        error: `${message} (usage unknown; may have been billed)`.slice(0, 300) });
      await failJob(d, job, kind, `${message}; usage unknown, manual review required; no automatic paid retry`,
        { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null, provider: providerName });
      await settle(null);
      return "failed";
    }

    const usage = extractUsage(providerName, result.provider);
    const cost = estimateCost(usage, rates);
    const usageFields = {
      provider: providerName, model_version: model, input_tokens: usage.input, output_tokens: usage.output,
      total_tokens: usage.total, cost_usd: cost, billed_at: usage.known ? stamp(d) : null,
      pricing_usd_per_million_input: rates?.input ?? null, pricing_usd_per_million_output: rates?.output ?? null,
    };
    let analysis: Json;
    try {
      analysis = parseModelOutput(result.output);
    } catch (_e) {
      // Meter usage BEFORE giving up on the content: malformed JSON can still be billable.
      await d.insertTokenLog({ organisation_id: job.organisation_id, model, feature: "ai_tyre_inspection",
        prompt_tokens: usage.known ? usage.input : 0, completion_tokens: usage.known ? usage.output : 0,
        cost_usd: cost, status: "error", error: "Unusable model response (JSON validation)" });
      await failJob(d, job, "invalid_model_output",
        "Unusable model response; manual review required; no automatic paid retry", usageFields);
      await settle(cost);
      return "failed";
    }
    await d.updateJob(job.id, { status: "completed", analysis, error_message: null, failure_kind: null,
      updated_at: stamp(d), ...usageFields }, "processing");
    await settle(cost);
    return "completed";
  } catch (error) {
    await failJob(d, job, called ? "provider_http_error" : "photo_unavailable",
      error instanceof Error ? error.message : "AI processing error");
    if (reserved) { try { await settle(null); } catch { /* reaper settles stale reservations */ } }
    return "failed";
  }
}

export interface DrainDeps {
  /** Oldest pending jobs, at most n. */
  fetchBatch: (n: number) => Promise<JobRow[]>;
  /** Atomically move pending -> processing (and count the attempt). False when another worker won. */
  claim: (job: JobRow) => Promise<boolean>;
  process: (job: JobRow) => Promise<Outcome>;
  nowMs: () => number;
}
export interface DrainOptions { batchSize: number; maxBatches: number; budgetMs: number }
export const DEFAULT_DRAIN: DrainOptions = { batchSize: 4, maxBatches: 10, budgetMs: 90_000 };
export type DrainStop = "empty" | "deferred" | "time" | "batches" | "no_progress" | "queue_error";
export interface DrainResult {
  processed: number; failed: number; deferred: number; skipped: number; claimed: number;
  batches: number; stoppedBecause: DrainStop;
}

/**
 * Drains the pending queue in bounded batches inside ONE worker run, instead of a single batch per
 * cron tick. Stops when the queue is empty, the daily budget defers a job, the wall-clock budget is
 * used up (checked before every job so an edge-function timeout cannot cut a paid call short), the
 * batch cap is hit, or a whole batch was claimed by other workers (no progress, so no spinning).
 * A job is claimed before it is processed and processJob never retries, so draining cannot cause a
 * second paid call for the same photograph.
 */
export async function drainQueue(d: DrainDeps, opts: Partial<DrainOptions> = {}): Promise<DrainResult> {
  const o = { ...DEFAULT_DRAIN, ...opts };
  const started = d.nowMs();
  const r: DrainResult = { processed: 0, failed: 0, deferred: 0, skipped: 0, claimed: 0, batches: 0, stoppedBecause: "empty" };
  while (r.batches < o.maxBatches) {
    let batch: JobRow[];
    try { batch = await d.fetchBatch(o.batchSize); }
    catch { r.stoppedBecause = "queue_error"; return r; }
    if (!batch.length) { r.stoppedBecause = "empty"; return r; }
    r.batches++;
    let claimedThisBatch = 0;
    for (const job of batch) {
      if (d.nowMs() - started >= o.budgetMs) { r.stoppedBecause = "time"; return r; }
      if (!(await d.claim(job))) continue;
      claimedThisBatch++; r.claimed++;
      const outcome = await d.process(job);
      if (outcome === "completed") r.processed++;
      else if (outcome === "failed") r.failed++;
      else if (outcome === "skipped_prior_attempt") r.skipped++;
      else if (outcome === "deferred") { r.deferred++; r.stoppedBecause = "deferred"; return r; }
    }
    if (!claimedThisBatch) { r.stoppedBecause = "no_progress"; return r; }
  }
  r.stoppedBecause = "batches";
  return r;
}
