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
export const RETRY_ROLES = ["admin", "manager", "director"] as const;
export const PROMPT_VERSION = "tyre-photo-v3";

const norm = (role: unknown) => String(role ?? "").trim().toLowerCase();
export const roleAllowed = (role: unknown, allowed: readonly string[]) => allowed.includes(norm(role));
export const canEnqueue = (role: unknown) => roleAllowed(role, ENQUEUE_ROLES);
export const canReview = (role: unknown) => roleAllowed(role, REVIEW_ROLES);
export const canBackfill = (role: unknown) => roleAllowed(role, BACKFILL_ROLES);
export const canRetry = (role: unknown) => roleAllowed(role, RETRY_ROLES);

/** Failure kinds that cannot have been billed: safe to re-queue (automatically, with backoff). Mirrors the SQL. */
export const AUTO_RETRY_KINDS = ["photo_unavailable", "provider_rate_limited"] as const;
export const RETRY_SAFE_KINDS = ["photo_unavailable", "provider_rate_limited", "photo_unusable"] as const;
/** HTTP statuses where the provider refused the request before doing billable work. 529 keeps its legacy kind. */
export const isRateLimitStatus = (s: unknown) => [429, 500, 502, 503, 504].includes(Number(s));

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
  const out: Json = { assessable: body.assessable === true, reason: str(body.reason, 400),
    recommendation: str(body.recommendation, 700),
    defects: body.assessable === true ? defects : [],
    humanReviewRequired: true, exactTreadDepthMm: null, remainingTreadLifeKm: null };
  const q = body.imageQuality;
  if (q && typeof q === "object" && !Array.isArray(q)) {
    const pick = (v: unknown, ok: string[]) => ok.includes(str(v, 20).toLowerCase()) ? str(v, 20).toLowerCase() : "unknown";
    const x = q as Json;
    out.imageQuality = { focus: pick(x.focus, ["good", "blurry"]), lighting: pick(x.lighting, ["good", "dark", "overexposed"]),
      subject: pick(x.subject, ["tyre", "not_tyre"]) };
  }
  return out;
}

// ---- Photo quality + consistency heuristics (pure, cheap, no model call) -------------------------------

export interface QualityFlag { code: string; severity: "info" | "warn" | "block"; message: string; source: "metadata" | "model" | "history" }

/** Width/height from JPEG, PNG or WebP headers; null when not readable. Never throws. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const m = bytes[i + 1];
        if (m === 0xff) { i++; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
        }
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
      }
      return null;
    }
    const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
    if (bytes.length > 30 && tag(0) === "RIFF" && tag(8) === "WEBP") {
      const kind = tag(12);
      if (kind === "VP8X") return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      if (kind === "VP8 ") return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
      if (kind === "VP8L") { const b = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    }
  } catch { /* unreadable header */ }
  return null;
}

/** Pre-spend gate from file metadata only. `block` => do not pay for this photograph. */
export function photoQualityFlags(meta: { bytes?: number; width?: number; height?: number; mediaType?: string }): { flags: QualityFlag[]; block: boolean } {
  const flags: QualityFlag[] = [];
  const bytes = Number(meta.bytes), w = Number(meta.width), h = Number(meta.height);
  const dims = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const minSide = dims ? Math.min(w, h) : null;
  if ((Number.isFinite(bytes) && bytes > 0 && bytes < 8000) || (minSide !== null && minSide < 200)) {
    flags.push({ code: "photo_too_small", severity: "block", source: "metadata",
      message: "Photo is too small to assess (under 200 px or 8 KB); retake it" });
  } else if (minSide !== null && minSide < 480) {
    flags.push({ code: "low_resolution", severity: "warn", source: "metadata", message: "Low resolution photo; findings may be unreliable" });
  }
  if (dims && Number.isFinite(bytes) && bytes > 0 && /jpe?g|webp/i.test(String(meta.mediaType ?? "")) && bytes / (w * h) < 0.04) {
    flags.push({ code: "low_detail", severity: "warn", source: "metadata",
      message: "Very little image detail for its size; possibly blurry, too dark or blank" });
  }
  return { flags, block: flags.some(f => f.severity === "block") };
}

/** Flags from the model's own imageQuality field (when present). */
export function modelQualityFlags(analysis: Json): QualityFlag[] {
  const q = analysis?.imageQuality as Json | undefined;
  if (!q || typeof q !== "object") return [];
  const out: QualityFlag[] = [];
  if (q.focus === "blurry") out.push({ code: "blurry", severity: "warn", source: "model", message: "Model reports the photo is blurry" });
  if (q.lighting === "dark" || q.lighting === "overexposed") {
    out.push({ code: q.lighting === "dark" ? "too_dark" : "overexposed", severity: "warn", source: "model",
      message: q.lighting === "dark" ? "Model reports the photo is too dark" : "Model reports the photo is overexposed" });
  }
  if (q.subject === "not_tyre") out.push({ code: "wrong_subject", severity: "warn", source: "model", message: "Model reports the photo does not show a tyre" });
  return out;
}

export interface PreviousReading { analysis: Json | null; jobId?: string; inspectionDate?: string | null }
const PERSISTENT_DEFECTS = new Set(["sidewall_cut", "tread_cut", "bulge", "exposed_cord", "suspected_separation"]);
const defectsOf = (a: Json | null | undefined) => (Array.isArray(a?.defects) ? a!.defects as Json[] : []);

/** Flags a reading that contradicts the same tyre's previous inspection. Pure. */
export function consistencyFlags(current: Json, previous: PreviousReading | null | undefined): QualityFlag[] {
  if (!previous?.analysis || current.assessable !== true || previous.analysis.assessable !== true) return [];
  const prevSevere = defectsOf(previous.analysis).filter(d => PERSISTENT_DEFECTS.has(String(d.type)) && ["moderate", "high", "urgent"].includes(String(d.severity)));
  const curTypes = new Set(defectsOf(current).map(d => String(d.type)));
  const out: QualityFlag[] = [];
  if (prevSevere.length && !prevSevere.some(d => curTypes.has(String(d.type)))) {
    out.push({ code: "contradicts_previous", severity: "warn", source: "history",
      message: `Previous inspection found ${String(prevSevere[0].type).replace(/_/g, " ")}; this reading does not. Tyre damage does not heal, so verify the position` });
  }
  const prevClean = defectsOf(previous.analysis).length === 0;
  if (prevClean && defectsOf(current).some(d => ["high", "urgent"].includes(String(d.severity)))) {
    out.push({ code: "new_severe_defect", severity: "info", source: "history", message: "Severe defect where the previous inspection found none" });
  }
  return out;
}

export interface ProviderAttempt { providerName: string; model: string; call: (photo: Photo) => Promise<{ provider: any; output: unknown }> }
export interface ServedResult { provider: any; output: unknown; served: { providerName: string; model: string };
  fallbackFrom?: { providerName: string; model: string; kind: string } }
/** Timeout, 429 or 5xx on the first provider may fall through to the next; auth/4xx and bad bodies may not. */
export function isFallbackable(e: unknown): boolean {
  if (!(e instanceof ProviderCallError)) return false;
  return e.kind === "provider_timeout" || (e.kind === "provider_http_error" && (Number(e.status) === 429 || Number(e.status) >= 500));
}
/** Try providers in order; record which one served. Throws the LAST error when every provider fails. */
export async function callWithFallback(attempts: ProviderAttempt[], photo: Photo): Promise<ServedResult> {
  let first: { providerName: string; model: string; kind: string } | undefined;
  let lastError: unknown = new ProviderCallError("provider_http_error", "No AI provider configured");
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    try {
      const r = await a.call(photo);
      return { ...r, served: { providerName: a.providerName, model: a.model }, ...(first ? { fallbackFrom: first } : {}) };
    } catch (e) {
      lastError = e;
      if (!isFallbackable(e) || i === attempts.length - 1) throw e;
      first ??= { providerName: a.providerName, model: a.model, kind: (e as ProviderCallError).kind };
    }
  }
  throw lastError;
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
  | "invalid_model_output" | "prior_attempt" | "stalled" | "monthly_budget_reached"
  | "provider_rate_limited" | "photo_unusable";

export class ProviderCallError extends Error {
  constructor(public kind: "provider_timeout" | "provider_http_error" | "provider_non_json",
    message: string, public status?: number) { super(message); }
}

export interface JobRow { id: string; organisation_id: string; photo_ref: string; attempts: number; inspection_id?: string; tyre_position?: string }
export interface Photo { mediaType: string; base64: string; bytes?: number; width?: number; height?: number;
  /** SHA-256 (hex) of the downloaded photo BYTES; used to reuse an identical earlier analysis. */
  sha256?: string }
export interface ReusableAnalysis { id: string; analysis: Json }

export interface Deps {
  config: { providerName: string; model: string; rates: Rates | null; reserveUsd: number; dailyLimitUsd: number; monthlyLimitUsd?: number };
  /** Pricing for the provider that actually served (fallback may differ from config). */
  ratesFor?: (providerName: string, model: string) => Rates | null;
  /** Previous completed reading for the same asset + tyre position; best effort, errors ignored. */
  loadPrevious?: (job: JobRow) => Promise<PreviousReading | null>;
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
  reserveBudget: (orgId: string, jobId: string, estimateUsd: number, limitUsd: number, monthlyLimitUsd?: number) =>
    Promise<{ ok: boolean; reason?: string; scope?: "monthly" | "daily" }>;
  settleBudget: (jobId: string, actualUsd: number | null, providerCalled: boolean) => Promise<void>;
  loadPhoto: (ref: string) => Promise<Photo>;
  /**
   * Same-organisation, same-prompt-version completed analysis of identical photo bytes, or null.
   * MUST be scoped to job.organisation_id; never reuse across organisations. Errors => treated as no match.
   */
  findReusable?: (job: JobRow, sha256: string, promptVersion: string) => Promise<ReusableAnalysis | null>;
  /** Called when the provider answered with a rate-limit/overload status (drives the shared backoff gate). */
  onProviderRateLimited?: (providerName: string) => void;
  /** Called after a provider answered usefully (resets the backoff). */
  onProviderOk?: (providerName: string) => void;
  /** Performs exactly ONE paid provider request. Throws ProviderCallError on failure. */
  callProvider: (photo: Photo) => Promise<{ provider: any; output: unknown; served?: { providerName: string; model: string };
    fallbackFrom?: { providerName: string; model: string; kind: string } }>;
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

    // Cheap pre-spend photo gate (metadata only): never pay to analyse an unusable photograph.
    const quality = photoQualityFlags(photo);
    if (quality.block) {
      await failJob(d, job, "photo_unusable", quality.flags.map(f => f.message).join("; "));
      return "failed";
    }

    // Identical bytes already analysed (same organisation, same prompt version): copy, no provider call, cost 0.
    if (photo.sha256 && d.findReusable) {
      let source: ReusableAnalysis | null = null;
      try { source = await d.findReusable(job, photo.sha256, PROMPT_VERSION); } catch { source = null; }
      if (source?.analysis && source.id !== job.id) {
        const src = source.analysis;
        const original = typeof src.reusedFrom === "string" && src.reusedFrom ? src.reusedFrom : source.id;
        const flags: QualityFlag[] = [...quality.flags, ...modelQualityFlags(src)];
        if (d.loadPrevious) {
          try { flags.push(...consistencyFlags(src, await d.loadPrevious(job))); } catch { /* history is best effort */ }
        }
        const analysis: Json = { ...src, flags, reusedFrom: original,
          serving: { ...((src.serving as Json) ?? {}), reused: true } };
        const ok = await d.updateJob(job.id, { status: "completed", analysis, error_message: null, failure_kind: null,
          photo_content_sha256: photo.sha256, prompt_version: PROMPT_VERSION,
          input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0, updated_at: stamp(d) }, "processing");
        if (ok) return "completed";
      }
    }

    // Atomic, concurrency-safe reservation BEFORE the paid call (daily + monthly under one lock).
    const reservation = await d.reserveBudget(job.organisation_id, job.id, d.config.reserveUsd, d.config.dailyLimitUsd, d.config.monthlyLimitUsd);
    if (!reservation.ok) {
      // No provider call happened: hand the job back un-attempted for a later day/run.
      await d.updateJob(job.id, { status: "pending", attempts: job.attempts,
        failure_kind: reservation.scope === "monthly" ? "monthly_budget_reached" : "budget_deferred",
        error_message: str(reservation.reason || "Daily AI spending limit reached", 160), updated_at: stamp(d) }, "processing");
      return "deferred";
    }
    reserved = true;
    // Persist the fact of the attempt before the request so a crash cannot cause a second charge.
    await d.updateJob(job.id, { provider_attempts: 1, provider_called_at: stamp(d), provider: providerName,
      model_version: model, prompt_version: PROMPT_VERSION,
      ...(photo.sha256 ? { photo_content_sha256: photo.sha256 } : {}) }, "processing");

    called = true;
    let result: { provider: any; output: unknown };
    try {
      result = await d.callProvider(photo);
    } catch (e) {
      const kind: FailureKind = e instanceof ProviderCallError
        ? (e.kind === "provider_http_error" && isRateLimitStatus(e.status) ? "provider_rate_limited" : e.kind)
        : "provider_http_error";
      if (kind === "provider_rate_limited") { try { d.onProviderRateLimited?.(providerName); } catch { /* advisory */ } }
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

    const served = result.served ?? { providerName, model };
    try { d.onProviderOk?.(served.providerName); } catch { /* advisory */ }
    const servedRates = d.ratesFor ? d.ratesFor(served.providerName, served.model) : rates;
    const usage = extractUsage(served.providerName, result.provider);
    const cost = estimateCost(usage, servedRates);
    const usageFields = {
      provider: served.providerName, model_version: served.model, input_tokens: usage.input, output_tokens: usage.output,
      total_tokens: usage.total, cost_usd: cost, billed_at: usage.known ? stamp(d) : null,
      pricing_usd_per_million_input: servedRates?.input ?? null, pricing_usd_per_million_output: servedRates?.output ?? null,
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
    const flags: QualityFlag[] = [...quality.flags, ...modelQualityFlags(analysis)];
    if (d.loadPrevious) {
      try { flags.push(...consistencyFlags(analysis, await d.loadPrevious(job))); } catch { /* history is best effort */ }
    }
    analysis = { ...analysis, flags,
      serving: { provider: served.providerName, model: served.model, ...(result.fallbackFrom ? { fallbackFrom: result.fallbackFrom } : {}) } };
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
  /** Milliseconds every worker should wait before claiming more work (shared provider backoff); 0 = none. */
  cooldownMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export interface DrainOptions { batchSize: number; maxBatches: number; budgetMs: number; concurrency: number }
export const DEFAULT_CONCURRENCY = 4;
export const MAX_CONCURRENCY = 6;
export const DEFAULT_DRAIN: DrainOptions = { batchSize: 4, maxBatches: 10, budgetMs: 90_000, concurrency: DEFAULT_CONCURRENCY };
/** AI_WORKER_CONCURRENCY parser: integer clamped to 1..6, default 4 on missing/garbage. */
export function parseConcurrency(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, n));
}
export type DrainStop = "empty" | "deferred" | "time" | "batches" | "no_progress" | "queue_error";
export interface DrainResult {
  processed: number; failed: number; deferred: number; skipped: number; claimed: number;
  batches: number; stoppedBecause: DrainStop; concurrency?: number;
}

/**
 * Shared exponential backoff for provider rate limits (429/5xx). One instance per worker run, shared by all
 * concurrent jobs: every rate-limit hit doubles the wait (cap), any success resets it. Pure given nowMs.
 */
export function createRateLimitGate(nowMs: () => number, baseMs = 2000, maxMs = 30_000) {
  const state = new Map<string, { until: number; hits: number }>();
  return {
    hit(provider: string) {
      const cur = state.get(provider) ?? { until: 0, hits: 0 };
      const hits = cur.hits + 1;
      state.set(provider, { hits, until: Math.max(cur.until, nowMs() + Math.min(maxMs, baseMs * 2 ** (hits - 1))) });
    },
    ok(provider: string) { state.delete(provider); },
    waitMs() {
      let w = 0; const t = nowMs();
      for (const v of state.values()) w = Math.max(w, v.until - t);
      return Math.max(0, w);
    },
  };
}

/**
 * Drains the pending queue in bounded batches inside ONE worker run. Within a batch up to `concurrency`
 * jobs are processed at once by a bounded pool. Guarantees:
 *  - claim atomicity: a job is claimed (pending -> processing, DB-atomic) by exactly one worker right before
 *    it is processed; processJob never retries, so concurrency cannot cause a second paid call;
 *  - a deferral (daily/monthly budget) or the wall-clock budget stops NEW claims at once; jobs already in
 *    flight finish (they hold reservations and must settle);
 *  - the time budget is checked before every claim so an edge timeout cannot cut a paid call short;
 *  - a shared provider cooldown (rate limit backoff) delays new claims for all workers;
 *  - one job's failure/throw never affects the others.
 * Budget safety under concurrency comes from the atomic DB reservation, not from this loop: at most
 * `concurrency` reservations can be in flight, so overshoot is bounded by concurrency x reserve.
 */
export async function drainQueue(d: DrainDeps, opts: Partial<DrainOptions> = {}): Promise<DrainResult> {
  const o = { ...DEFAULT_DRAIN, ...opts };
  const conc = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(Number(o.concurrency)) || 1));
  const batchSize = Math.max(o.batchSize, conc);
  const started = d.nowMs();
  const r: DrainResult = { processed: 0, failed: 0, deferred: 0, skipped: 0, claimed: 0, batches: 0, stoppedBecause: "empty", concurrency: conc };
  let stop = null as DrainStop | null;
  const setStop = (s: DrainStop) => { if (!stop) stop = s; };
  while (r.batches < o.maxBatches) {
    let batch: JobRow[];
    try { batch = await d.fetchBatch(batchSize); }
    catch { r.stoppedBecause = "queue_error"; return r; }
    if (!batch.length) { r.stoppedBecause = "empty"; return r; }
    r.batches++;
    let claimedThisBatch = 0, next = 0;
    const worker = async () => {
      while (!stop) {
        const job = batch[next++];
        if (!job) return;
        const cool = d.cooldownMs?.() ?? 0;
        if (cool > 0 && d.sleep) {
          // Never sleep past the wall-clock budget.
          const left = o.budgetMs - (d.nowMs() - started);
          if (cool >= left) { setStop("time"); return; }
          await d.sleep(cool);
          if (stop) return;
        }
        if (d.nowMs() - started >= o.budgetMs) { setStop("time"); return; }
        let won = false;
        try { won = await d.claim(job); } catch { won = false; }
        if (!won) continue;
        claimedThisBatch++; r.claimed++;
        let outcome: Outcome;
        try { outcome = await d.process(job); } catch { outcome = "failed"; }
        if (outcome === "completed") r.processed++;
        else if (outcome === "failed") r.failed++;
        else if (outcome === "skipped_prior_attempt") r.skipped++;
        else if (outcome === "deferred") { r.deferred++; setStop("deferred"); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, batch.length) }, worker));
    if (stop) { r.stoppedBecause = stop; return r; }
    if (!claimedThisBatch) { r.stoppedBecause = "no_progress"; return r; }
  }
  r.stoppedBecause = "batches";
  return r;
}
