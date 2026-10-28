// Edge function: AI tyre inspection orchestration.
// No browser model keys. Worker remains disabled until configured with AI_PROVIDER_KEY.
// Request modes: enqueue (JWT), review (JWT), work (service secret).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  canBackfill, canEnqueue, canReview, canRetry, resolveRates, processJob, drainQueue, ProviderCallError, str,
  callWithFallback, imageDimensions, parseConcurrency, createRateLimitGate,
  type Deps, type Json, type JobRow, type Photo, type ProviderAttempt,
} from "./logic.ts";
import {
  evaluateMonthlyBudget, monthStartUtc, parseAiControls, sumMonthSpend,
  type MonthlyBudgetDecision,
} from "./budget.ts";

const ALLOWED_ORIGINS = [
  ...(Deno.env.get("AI_ALLOWED_ORIGIN") ?? "").split(",").map(x => x.trim()).filter(Boolean),
  "https://app.tyrepulse.app",
  "https://tyrepulse.app",
  "https://www.tyrepulse.app",
  "http://localhost:5173",
  "http://localhost:5174",
];
// Echo the caller origin only when allow-listed (a single fixed origin made the browser
// block calls from tyrepulse.app / www as "Failed to send a request to the Edge Function").
let currentOrigin = ALLOWED_ORIGINS[0] ?? "https://app.tyrepulse.app";
const cors = {
  get "access-control-allow-origin"() { return currentOrigin; },
  "vary": "Origin",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-worker-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};
const response = (payload: Json, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...cors, "content-type": "application/json" } });
const fail = (message: string, status = 400) => response({ error: message }, status);
const apiUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });
const isUUID = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const retryMax = 3;

async function authenticated(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("unauthenticated");
  const client = createClient(apiUrl, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await client.auth.getUser(auth.slice(7));
  if (error || !user) throw new Error("unauthenticated");
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,organisation_id,role").eq("id", user.id).single();
  if (profileError || !profile?.organisation_id) throw new Error("profile unavailable");
  return { user, profile, client };
}

function eligibleCondition(value: unknown) {
  return /(worn|wear|damag|cut|crack|bulg|punct|flat|separat|cord|burst)/i.test(str(value));
}
function photos(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(photos);
  if (value && typeof value === "object") {
    const item = value as Json;
    return photos(item.ref || item.path || item.uri);
  }
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (text.startsWith("[")) {
    try { return photos(JSON.parse(text)); } catch { /* strict refs checked below */ }
  }
  return text ? [text] : [];
}
function parsedStorage(value: string) {
  if (!value.startsWith("tp-storage://")) return null;
  const raw = value.slice("tp-storage://".length);
  const i = raw.indexOf("/");
  if (i <= 0) return null;
  const bucket = raw.slice(0, i);
  const path = raw.slice(i + 1);
  if (!/^[a-z0-9_-]+$/.test(bucket) || !path || path.includes("..") || path.startsWith("/")) return null;
  return { bucket, path };
}
async function fingerprint(input: string) {
  const bytes = new TextEncoder().encode(input);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map(x => x.toString(16).padStart(2, "0")).join("");
}
async function inspectionFor(client: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await client.from("inspections")
    .select("id,organisation_id,tyre_conditions,asset_no,site,country")
    .eq("id", id).single();
  if (error || !data) throw new Error("inspection not available");
  return data;
}
function eligibleEvidence(inspection: Json, includeHealthy = false) {
  const result: { position:string; ref:string; condition:string }[] = [];
  const conditions = inspection.tyre_conditions && typeof inspection.tyre_conditions === "object"
    ? inspection.tyre_conditions as Json : {};
  for (const [position, value] of Object.entries(conditions)) {
    if (!value || typeof value !== "object") continue;
    const data = value as Json;
    const condition = str(data.condition || data.status, 120);
    if (!includeHealthy && !eligibleCondition(condition)) continue;
    const seen = new Set<string>();
    for (const ref of [...photos(data.photo_url), ...photos(data.photo), ...photos(data.photos), ...photos(data.photo_refs)]) {
      if (!parsedStorage(ref) || seen.has(ref)) continue;
      seen.add(ref);
      result.push({ position: position.slice(0,80), ref, condition });
    }
  }
  return result.slice(0,100);
}
async function enqueue(req: Request, payload: Json) {
  const { profile, client } = await authenticated(req);
  if (!isUUID(payload.inspection_id)) return fail("Valid inspection ID required");
  const inspection = await inspectionFor(client, payload.inspection_id);
  if (inspection.organisation_id !== profile.organisation_id) return fail("Inspection unavailable", 403);
  if (!canEnqueue(profile.role)) return fail("Inspection operation not authorized",403);
  // Full visual screening is only user requested; automatic queue remains defect-only.
  const includeHealthy = payload.action === "screen";
  const evidence = eligibleEvidence(inspection, includeHealthy);
  let created = 0;
  for (const item of evidence) {
    // Path-hash is an idempotency identifier, not proof that bytes are immutable.
    // A deployed worker should store a content hash after downloading bytes.
    const hash = await fingerprint(item.ref);
    const { error } = await admin.from("ai_tyre_inspection_jobs").upsert({
      organisation_id: inspection.organisation_id,
      inspection_id: inspection.id,
      tyre_position: item.position,
      photo_ref: item.ref,
      photo_sha256: hash,
      status: "pending",
    }, { onConflict: "organisation_id,inspection_id,tyre_position,photo_sha256", ignoreDuplicates: true });
    if (error) return fail("Could not enqueue all evidence",500);
    created++;
  }
  // Start the worker now instead of waiting for the 5-minute cron (cron stays as the safety net).
  const triggered = created > 0 ? await triggerWorkerSoon() : false;
  return response({ inspection_id: inspection.id, eligible: evidence.length, enqueued:created, worker_triggered: triggered });
}
// ---- Immediate worker kick -------------------------------------------------------------------------
// In-isolate debounce + a DB lock (ai_tyre_try_acquire_worker_lock) so a burst of enqueues starts ONE
// worker, not one per request. Auth is unchanged: the self-call carries the same x-worker-secret
// (AI_WORKER_SECRET) the cron uses and the work path still rejects anything else. Every failure here is
// swallowed: the cron picks the jobs up within 5 minutes.
const KICK_DEBOUNCE_MS = 10_000;
const KICK_LOCK_SECONDS = 45;
let lastKickAt = 0;
async function triggerWorkerSoon(): Promise<boolean> {
  try {
    const secret = Deno.env.get("AI_WORKER_SECRET");
    if (!secret) return false;
    const nowMs = Date.now();
    if (nowMs - lastKickAt < KICK_DEBOUNCE_MS) return false;
    lastKickAt = nowMs;
    // Fail closed: if the lock cannot be taken (RPC missing or error) the cron handles it.
    const { data, error } = await admin.rpc("ai_tyre_try_acquire_worker_lock", { p_ttl_seconds: KICK_LOCK_SECONDS });
    if (error || data !== true) return false;
    const call = fetch(`${apiUrl}/functions/v1/ai-tyre-inspection`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${serviceKey}`, "x-worker-secret": secret },
      body: JSON.stringify({ action: "work" }),
    }).then(r => r.body?.cancel(), () => {});
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(call);
    return true;
  } catch { return false; }
}
/** Organization-bound on-demand backfill. Range is capped and paged by created_at.
 * Requires a managerial role. Evidence lookup reuses exactly the regular enqueue
 * allowlist, so inspecting historic rows never grants access to arbitrary URLs.
 */
async function backfill(req: Request, payload: Json) {
  const {profile,client} = await authenticated(req);
  if(!canBackfill(profile.role)){
    return fail("Manager role required",403);
  }
  const from=str(payload.from,40);
  const to=str(payload.to,40);
  const page=Number(payload.page??0);
  const start=Date.parse(from),end=Date.parse(to);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||
     end-start>32*86400000||!Number.isInteger(page)||page<0||page>100){
    return fail("Invalid date range or page",400);
  }
  const PAGE_SIZE=50;
  const dryRun=payload.dry_run===true;
  const {data:inspections,error}=await client.from("inspections")
    .select("id,organisation_id,tyre_conditions,created_at")
    .eq("organisation_id",profile.organisation_id)
    .gte("created_at",new Date(start).toISOString())
    .lt("created_at",new Date(end).toISOString())
    .order("created_at",{ascending:true})
    .order("id",{ascending:true})
    .range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1);
  if(error)return fail("Could not read historical inspections",500);
  const list=inspections||[];
  // Only photographs with NO job yet are candidates: one prefetch instead of a write per photo.
  const existing=new Set<string>();
  if(list.length){
    const {data:jobs,error:jobsError}=await admin.from("ai_tyre_inspection_jobs")
      .select("inspection_id,tyre_position,photo_ref")
      .eq("organisation_id",profile.organisation_id)
      .in("inspection_id",list.map(i=>i.id));
    if(jobsError)return fail("Could not read existing AI jobs",500);
    (jobs||[]).forEach(j=>existing.add(`${j.inspection_id}|${j.tyre_position}|${j.photo_ref}`));
  }
  let eligible=0,skippedExisting=0;
  const pending:{organisation_id:string;inspection_id:string;tyre_position:string;photo_ref:string}[]=[];
  for(const inspection of list){
    for(const item of eligibleEvidence(inspection)){
      eligible++;
      if(existing.has(`${inspection.id}|${item.position}|${item.ref}`)){skippedExisting++;continue;}
      pending.push({organisation_id:inspection.organisation_id,inspection_id:inspection.id,
        tyre_position:item.position,photo_ref:item.ref});
    }
  }
  let created=0;
  if(!dryRun&&pending.length){
    const hashes=await Promise.all(pending.map(x=>fingerprint(x.photo_ref)));
    const rows=pending.map((x,i)=>({...x,photo_sha256:hashes[i],status:"pending"}));
    for(let i=0;i<rows.length;i+=200){
      const {data:inserted,error:queueError}=await admin.from("ai_tyre_inspection_jobs")
        .upsert(rows.slice(i,i+200),
          {onConflict:"organisation_id,inspection_id,tyre_position,photo_sha256",ignoreDuplicates:true})
        .select("id");
      if(queueError)return fail("Historical queue could not be completed",500);
      created+=inserted?.length||0;
    }
  }
  return response({scanned:list.length,eligible,skipped_existing:skippedExisting,
    pending:pending.length,created,dry_run:dryRun,
    page,next_page:list.length===PAGE_SIZE?page+1:null});
}
/**
 * Admin re-queue of failed jobs (elevated roles, own organisation only). By default only failure kinds that
 * cannot have been billed are re-queued; include_billed:true is the admin's explicit decision to pay again for
 * a job that may already have been billed (its estimated prior spend stays in the month ledger).
 */
async function retry(req: Request, payload: Json) {
  const { profile, user } = await authenticated(req);
  if (!canRetry(profile.role)) return fail("Admin, manager or director role required", 403);
  const ids = Array.isArray(payload.job_ids) ? payload.job_ids : [];
  if (!ids.length || ids.length > 100 || !ids.every(isUUID)) return fail("Between 1 and 100 valid job IDs required");
  const { data, error } = await admin.rpc("ai_tyre_requeue_jobs", {
    p_org: profile.organisation_id, p_job_ids: ids, p_include_billed: payload.include_billed === true, p_actor: user.id,
  });
  if (error || !data || (data as Json).ok !== true) return fail("Could not re-queue jobs", 500);
  return response({ requeued: (data as Json).requeued, skipped: (data as Json).skipped, include_billed: payload.include_billed === true });
}
async function review(req:Request, payload:Json) {
  const { profile, user, client } = await authenticated(req);
  if (!canReview(profile.role)) {
    return fail("Supervisor role required",403);
  }
  if (!isUUID(payload.job_id) || !["accepted","rejected","corrected"].includes(String(payload.decision))) {
    return fail("Invalid review request");
  }
  const { data: job } = await admin.from("ai_tyre_inspection_jobs")
    .select("id,inspection_id,organisation_id,status,review_status")
    .eq("id",payload.job_id).single();
  if (!job || job.organisation_id !== profile.organisation_id) return fail("Job not found",404);
  await inspectionFor(client, job.inspection_id);
  if (job.status !== "completed" || job.review_status !== "unreviewed") return fail("Job cannot be reviewed",409);
  const { data: updated, error } = await admin.from("ai_tyre_inspection_jobs").update({
    review_status:payload.decision, reviewer_note:str(payload.note,800),
    reviewer_id:user.id, reviewed_at:new Date().toISOString(),
  }).eq("id", job.id).eq("review_status","unreviewed").select("id").maybeSingle();
  if (error || !updated) return fail("Review changed concurrently",409);
  return response({reviewed:true,job_id:updated.id});
}
async function callProvider(cfg: { providerName: string; providerKey: string; model: string }, prompt: string, photo: Photo) {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 25000);
  try {
    let completion: Response;
    try {
      completion = cfg.providerName === "anthropic"
        ? await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: ctl.signal,
          headers: { "x-api-key": cfg.providerKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: cfg.model, max_tokens: 1800, messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
          ] }] }),
        })
        : await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(cfg.model) + ":generateContent", {
          method: "POST", signal: ctl.signal,
          headers: { "x-goog-api-key": cfg.providerKey, "content-type": "application/json" },
          body: JSON.stringify({
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1800, temperature: 0.1 },
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: photo.mediaType, data: photo.base64 } }] }],
          }),
        });
    } catch (e) {
      throw new ProviderCallError("provider_timeout",
        ctl.signal.aborted ? "AI provider timed out" : "AI provider network error");
    }
    if (!completion.ok) throw new ProviderCallError("provider_http_error", "AI provider HTTP " + completion.status, completion.status);
    let provider: any;
    try { provider = await completion.json(); }
    catch { throw new ProviderCallError("provider_non_json", "AI provider returned a non-JSON body"); }
    const output = cfg.providerName === "anthropic"
      ? provider?.content?.filter((part: Json) => part.type === "text").map((part: Json) => part.text).join("")
      : provider?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { provider, output };
  } finally { clearTimeout(timeout); }
}
/**
 * HARD monthly cap. Reads system_config (ai_enabled, ai_monthly_budget_usd) and the month's spend from
 * ai_token_logs (other features) plus ai_tyre_inspection_jobs (this path's own ledger; paged: PostgREST silently truncates a plain select at 1000 rows, which would under-count
 * and let the cap be exceeded). Any read problem => state 'unavailable' => no paid call (fail closed).
 */
async function monthlyBudgetDecision(reserveUsd: number): Promise<MonthlyBudgetDecision> {
  try {
    const { data: cfg, error: cfgError } = await admin.from("system_config").select("key,value")
      .in("key", ["ai_enabled", "ai_monthly_budget_usd"]);
    if (cfgError) return evaluateMonthlyBudget({ controls: null, spentUsd: null, reserveUsd });
    const controls = parseAiControls(cfg);
    // No cap configured (or AI off / bad setting): nothing to sum.
    if (!controls.enabled || controls.invalidLimit || controls.limitUsd <= 0) {
      return evaluateMonthlyBudget({ controls, spentUsd: null, reserveUsd });
    }
    const since = monthStartUtc(new Date()).toISOString();
    const PAGE = 1000, MAX_PAGES = 100;
    // Pages through a ledger; returns null (=> fail closed) on any error or when the page ceiling is hit.
    const pageAll = async (build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) => {
      const out: Json[] = [];
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) return null;
        const { data, error } = await build(page * PAGE, (page + 1) * PAGE - 1);
        if (error) return null;
        out.push(...((data || []) as Json[]));
        if ((data || []).length < PAGE) return out;
      }
    };
    const logs = await pageAll((f, t) => admin.from("ai_token_logs").select("id,cost_usd,feature,status")
      .gte("created_at", since).order("id", { ascending: true }).range(f, t));
    const jobs = await pageAll((f, t) => admin.from("ai_tyre_inspection_jobs").select("id,cost_usd,provider_called_at,prior_billed_usd")
      .or(`provider_called_at.gte.${since},last_retry_at.gte.${since}`).order("id", { ascending: true }).range(f, t));
    if (!logs || !jobs) return evaluateMonthlyBudget({ controls, spentUsd: null, reserveUsd });
    return evaluateMonthlyBudget({ controls, spentUsd: sumMonthSpend(logs, jobs, reserveUsd), reserveUsd });
  } catch {
    return evaluateMonthlyBudget({ controls: null, spentUsd: null, reserveUsd });
  }
}
const PROMPT = "Inspect this commercial vehicle tyre photograph. Return a short, valid JSON object with keys assessable (boolean), reason (string), defects (max 4 items each containing type, description, severity, visibleEvidence), recommendation (string). Keep each description under 80 characters. Output no markdown, no commentary. Never use em dashes or en dashes. Also include imageQuality with keys focus (good or blurry), lighting (good, dark or overexposed) and subject (tyre or not_tyre). Note whether the image is clear enough. Distinguish normal visible wear from defects; flag uncertain findings. Do NOT invent groove depth millimetres, remaining tread percentage, remaining kilometres, engine readings, tyre pressure or roadworthiness certification.";

async function work(req:Request) {
  // Cron workers authenticate using the dedicated x-worker-secret header.
  const provided = req.headers.get("x-worker-secret");
  const expected = Deno.env.get("AI_WORKER_SECRET");
  if (!expected || !provided || provided !== expected) return fail("Worker unauthorized",403);
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const providerName = anthropicKey ? "anthropic" : "google";
  const providerKey = anthropicKey || Deno.env.get("AI_PROVIDER_KEY");
  const model = Deno.env.get("AI_MODEL") || (anthropicKey ? "claude-haiku-5-5" : "gemini-2.5-flash-lite");
  if (!providerKey) return fail("AI provider is not configured",503);
  const env = (k: string) => Deno.env.get(k);
  const dailyLimit = Math.max(0, Math.min(Number(env("AI_DAILY_LIMIT_USD") ?? "1"), 100));
  // Worst-case per-call reservation; settled to the real estimate (or kept when usage is unknown).
  const reserveUsd = Math.max(0.0001, Math.min(Number(env("AI_RESERVE_USD_PER_CALL") ?? "0.01"), 1));
  const rates = resolveRates(providerName, model, env);
  // Secondary provider (used only on primary timeout / 429 / 5xx) when its key exists.
  const attempts: ProviderAttempt[] = [{ providerName, model,
    call: (photo: Photo) => callProvider({ providerName, providerKey, model }, PROMPT, photo) }];
  const gKey = Deno.env.get("AI_PROVIDER_KEY");
  if (providerName === "anthropic" && gKey) {
    const gModel = Deno.env.get("AI_FALLBACK_MODEL") || "gemini-2.5-flash-lite";
    attempts.push({ providerName: "google", model: gModel,
      call: (photo: Photo) => callProvider({ providerName: "google", providerKey: gKey, model: gModel }, PROMPT, photo) });
  }

  // Pre-flight: if the monthly cap is already reached, claim nothing and report a visible state.
  let lastBudget = await monthlyBudgetDecision(reserveUsd);
  if (!lastBudget.allowed) {
    return response({ processed: 0, failed: 0, deferred: 0, skipped: 0, claimed: 0, batches: 0,
      stoppedBecause: "monthly_budget", budget: lastBudget, dailyLimit });
  }

  // Bounded automatic retry with exponential backoff, only for failures that cannot have been billed.
  // Possibly-billed jobs (prior_attempt, stalled, timeout, invalid output) are never auto-retried.
  await admin.rpc("ai_tyre_auto_requeue", { p_max_retries: 3, p_base_minutes: 10, p_limit: 50 }).then(() => {}, () => {});

  // Stalled "processing" locks: the provider may have been called; fail for manual review, never retry.
  const { error: reapError } = await admin.rpc("ai_tyre_fail_stale_processing", { p_minutes: 15 });
  if (reapError) return fail("Unable to reconcile stalled AI jobs",503);

  const gate = createRateLimitGate(() => Date.now());
  const deps: Deps = {
    config: { providerName, model, rates, reserveUsd, dailyLimitUsd: dailyLimit, monthlyLimitUsd: lastBudget.limitUsd ?? 0 },
    ratesFor: (name, m) => (name === providerName && m === model ? rates : resolveRates(name, m, () => undefined)),
    loadPrevious: async (job) => {
      if (!job.inspection_id || !job.tyre_position) return null;
      const { data: cur } = await admin.from("inspections").select("asset_no,created_at").eq("id", job.inspection_id).maybeSingle();
      if (!cur?.asset_no) return null;
      const { data: older } = await admin.from("inspections").select("id,created_at")
        .eq("organisation_id", job.organisation_id).eq("asset_no", cur.asset_no).neq("id", job.inspection_id)
        .lt("created_at", cur.created_at).order("created_at", { ascending: false }).limit(10);
      const ids = (older || []).map((i: Json) => i.id as string);
      if (!ids.length) return null;
      const { data: prev } = await admin.from("ai_tyre_inspection_jobs").select("id,analysis,inspection_id")
        .eq("organisation_id", job.organisation_id).eq("tyre_position", job.tyre_position).eq("status", "completed")
        .in("inspection_id", ids).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return prev ? { analysis: prev.analysis as Json, jobId: prev.id as string } : null;
    },
    now: () => new Date(),
    updateJob: async (id, patch, fromStatus) => {
      const { data } = await admin.from("ai_tyre_inspection_jobs").update(patch)
        .eq("id", id).eq("status", fromStatus).select("id").maybeSingle();
      return !!data;
    },
    insertTokenLog: async (row) => { await admin.from("ai_token_logs").insert(row); },
    checkMonthlyBudget: async (reserve) => { lastBudget = await monthlyBudgetDecision(reserve); return lastBudget; },
    reserveBudget: async (_orgId, jobId, estimate, limit, monthlyLimit) => {
      // Atomic daily + monthly reservation under one DB lock (migration 20261026095000).
      const { data, error: rpcError } = await admin.rpc("ai_tyre_reserve_budget_atomic",
        { p_job: jobId, p_estimate: estimate, p_daily_limit: limit, p_month_limit: monthlyLimit ?? 0 });
      // Fail closed: no reservation, no paid call.
      if (rpcError || !data) return { ok: false, reason: "Unable to reserve AI budget" };
      const d = data as Json;
      return { ok: d.ok === true, reason: String(d.reason ?? ""), scope: d.scope === "monthly" ? "monthly" : "daily" };
    },
    settleBudget: async (jobId, actual, providerCalled) => {
      await admin.rpc("ai_tyre_settle_budget", { p_job: jobId, p_actual: actual, p_provider_called: providerCalled });
    },
    loadPhoto: async (refText) => {
      const ref = parsedStorage(refText);
      if (!ref) throw new Error("Invalid private media reference");
      const {data:file,error:readError} = await admin.storage.from(ref.bucket).download(ref.path);
      if (readError || !file) throw new Error("Photo unavailable");
      if (!file.type.startsWith("image/") || file.size > 6_000_000) throw new Error("Unsupported photo");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const dims = imageDimensions(bytes);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
        .map(x => x.toString(16).padStart(2, "0")).join("");
      return { mediaType: file.type, base64: btoa(binary), bytes: bytes.length, sha256, ...(dims ?? {}) };
    },
    findReusable: async (job, sha256, promptVersion) => {
      // Strictly the same organisation + same prompt version + identical bytes. Rejected readings are not reused.
      const { data } = await admin.from("ai_tyre_inspection_jobs").select("id,analysis")
        .eq("organisation_id", job.organisation_id).eq("photo_content_sha256", sha256)
        .eq("prompt_version", promptVersion).eq("status", "completed").neq("review_status", "rejected")
        .neq("id", job.id).not("analysis", "is", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data?.analysis ? { id: data.id as string, analysis: data.analysis as Json } : null;
    },
    onProviderRateLimited: (name) => gate.hit(name),
    onProviderOk: (name) => gate.ok(name),
    callProvider: (photo) => callWithFallback(attempts, photo),
  };

  // Drain the queue in bounded batches (time- and budget-limited) instead of one batch per tick.
  const drained = await drainQueue({
    fetchBatch: async (n) => {
      const {data,error} = await admin.from("ai_tyre_inspection_jobs")
        .select("id,organisation_id,inspection_id,photo_ref,tyre_position,attempts")
        .eq("status","pending").order("created_at",{ascending:true}).limit(n);
      if (error) throw new Error("Queue unavailable");
      return (data || []) as JobRow[];
    },
    claim: async (job) => {
      const {data: claimed} = await admin.from("ai_tyre_inspection_jobs")
        .update({status:"processing",attempts:job.attempts+1,updated_at:new Date().toISOString()})
        .eq("id",job.id).eq("status","pending").select("id").maybeSingle();
      return !!claimed;
    },
    process: (job) => processJob(deps, job),
    nowMs: () => Date.now(),
    cooldownMs: () => gate.waitMs(),
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  }, { concurrency: parseConcurrency(env("AI_WORKER_CONCURRENCY")) });
  if (drained.stoppedBecause === "queue_error" && drained.batches === 0) return fail("Queue unavailable",500);
  return response({ ...drained, dailyLimit, budget: lastBudget });
}
Deno.serve(async req => {
  { const o = req.headers.get("origin") ?? ""; currentOrigin = ALLOWED_ORIGINS.includes(o) ? o : (ALLOWED_ORIGINS[0] ?? "https://app.tyrepulse.app"); }
  if (req.method === "OPTIONS") return new Response(null,{headers:cors});
  if (req.method !== "POST") return fail("Method not allowed",405);
  try {
    const payload = await req.json() as Json;
    if (!payload || typeof payload !== "object") return fail("Invalid request");
    if (payload.action === "enqueue" || payload.action === "screen") return await enqueue(req,payload);
    if (payload.action === "review") return await review(req,payload);
    if (payload.action === "retry") return await retry(req,payload);
    if (payload.action === "backfill") return await backfill(req,payload);
    if (payload.action === "work") return await work(req);
    return fail("Unknown action");
  } catch (error) {
    if (error instanceof Error && error.message === "unauthenticated") return fail("Unauthorized",401);
    return fail("Request could not be completed",500);
  }
});
