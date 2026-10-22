// Edge function: AI tyre inspection orchestration.
// No browser model keys. Worker remains disabled until configured with AI_PROVIDER_KEY.
// Request modes: enqueue (JWT), review (JWT), work (service secret).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  canBackfill, canEnqueue, canReview, resolveRates, processJob, ProviderCallError, str,
  type Deps, type Json, type Photo,
} from "./logic.ts";

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
  return response({ inspection_id: inspection.id, eligible: evidence.length, enqueued:created });
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
          body: JSON.stringify({ model: cfg.model, max_tokens: 1100, messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.base64 } },
          ] }] }),
        })
        : await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(cfg.model) + ":generateContent", {
          method: "POST", signal: ctl.signal,
          headers: { "x-goog-api-key": cfg.providerKey, "content-type": "application/json" },
          body: JSON.stringify({
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1100, temperature: 0.1 },
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
const PROMPT = "Inspect this commercial vehicle tyre photograph. Return a short, valid JSON object with keys assessable (boolean), reason (string), defects (max 4 items each containing type, description, severity, visibleEvidence), recommendation (string). Keep each description under 80 characters. Output no markdown, no commentary. Note whether the image is clear enough. Distinguish normal visible wear from defects; flag uncertain findings. Do NOT invent groove depth millimetres, remaining tread percentage, remaining kilometres, engine readings, tyre pressure or roadworthiness certification.";

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

  // Stalled "processing" locks: the provider may have been called; fail for manual review, never retry.
  const { error: reapError } = await admin.rpc("ai_tyre_fail_stale_processing", { p_minutes: 15 });
  if (reapError) return fail("Unable to reconcile stalled AI jobs",503);

  const {data:items,error} = await admin.from("ai_tyre_inspection_jobs")
    .select("id,organisation_id,inspection_id,photo_ref,tyre_position,attempts")
    .eq("status","pending").order("created_at",{ascending:true}).limit(4);
  if (error) return fail("Queue unavailable",500);

  const deps: Deps = {
    config: { providerName, model, rates, reserveUsd, dailyLimitUsd: dailyLimit },
    now: () => new Date(),
    updateJob: async (id, patch, fromStatus) => {
      const { data } = await admin.from("ai_tyre_inspection_jobs").update(patch)
        .eq("id", id).eq("status", fromStatus).select("id").maybeSingle();
      return !!data;
    },
    insertTokenLog: async (row) => { await admin.from("ai_token_logs").insert(row); },
    reserveBudget: async (orgId, jobId, estimate, limit) => {
      const { data, error: rpcError } = await admin.rpc("ai_tyre_reserve_budget",
        { p_job: jobId, p_estimate: estimate, p_limit: limit });
      // Fail closed: no reservation, no paid call.
      if (rpcError || !data) return { ok: false, reason: "Unable to reserve AI budget" };
      return { ok: (data as Json).ok === true, reason: String((data as Json).reason ?? "") };
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
      return { mediaType: file.type, base64: btoa(binary) };
    },
    callProvider: (photo) => callProvider({ providerName, providerKey, model }, PROMPT, photo),
  };

  let processed = 0, deferred = 0;
  for (const job of items || []) {
    const {data: claimed} = await admin.from("ai_tyre_inspection_jobs")
      .update({status:"processing",attempts:job.attempts+1,updated_at:new Date().toISOString()})
      .eq("id",job.id).eq("status","pending").select("id").maybeSingle();
    if (!claimed) continue;
    const outcome = await processJob(deps, job);
    if (outcome === "completed") processed++;
    if (outcome === "deferred") { deferred++; break; } // ceiling reached: stop the run
  }
  return response({ processed, deferred, claimed:(items||[]).length, dailyLimit });
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
    if (payload.action === "backfill") return await backfill(req,payload);
    if (payload.action === "work") return await work(req);
    return fail("Unknown action");
  } catch (error) {
    if (error instanceof Error && error.message === "unauthenticated") return fail("Unauthorized",401);
    return fail("Request could not be completed",500);
  }
});
