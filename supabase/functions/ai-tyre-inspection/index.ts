// Edge function: AI tyre inspection orchestration.
// No browser model keys. Worker remains disabled until configured with AI_PROVIDER_KEY.
// Request modes: enqueue (JWT), review (JWT), work (service secret).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

type Json = Record<string, unknown>;
const cors = {
  "access-control-allow-origin": Deno.env.get("AI_ALLOWED_ORIGIN") ?? "https://app.tyrepulse.app",
  "access-control-allow-headers": "authorization, apikey, content-type, x-worker-secret",
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
const str = (value: unknown, length = 300) => typeof value === "string" ? value.trim().slice(0, length) : "";
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
  if (!["Admin","Manager","Director","Maintenance Supervisor","Tyre Man"].includes(profile.role)) return fail("Inspection operation not authorized",403);
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
  const role=String(profile.role||"").toLowerCase();
  if(!["admin","manager","director","maintenance supervisor","pmv manager"].includes(role)){
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
  const PAGE_SIZE=100;
  const {data:inspections,error}=await client.from("inspections")
    .select("id,organisation_id,tyre_conditions,created_at")
    .eq("organisation_id",profile.organisation_id)
    .gte("created_at",new Date(start).toISOString())
    .lt("created_at",new Date(end).toISOString())
    .order("created_at",{ascending:true})
    .order("id",{ascending:true})
    .range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1);
  if(error)return fail("Could not read historical inspections",500);
  let eligible=0,created=0;
  for(const inspection of inspections||[]){
    const refs=eligibleEvidence(inspection);
    eligible+=refs.length;
    for(const item of refs){
      const hash=await fingerprint(item.ref);
      const {data:inserted,error:queueError}=await admin.from("ai_tyre_inspection_jobs")
        .upsert({organisation_id:inspection.organisation_id,
          inspection_id:inspection.id,tyre_position:item.position,
          photo_ref:item.ref,photo_sha256:hash,status:"pending"},
          {onConflict:"organisation_id,inspection_id,tyre_position,photo_sha256",ignoreDuplicates:true})
        .select("id");
      if(queueError)return fail("Historical queue could not be completed",500);
      if(inserted?.length)created++;
    }
  }
  return response({scanned:(inspections||[]).length,eligible,created,
    page,next_page:(inspections||[]).length===PAGE_SIZE?page+1:null});
}
async function review(req:Request, payload:Json) {
  const { profile, user, client } = await authenticated(req);
  if (!["Admin","Manager","Director","Maintenance Supervisor"].includes(profile.role)) {
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
function normalizeAnalysis(raw: unknown): Json {
  if (!raw || typeof raw !== "object") throw new Error("Invalid AI response");
  const body = raw as Json;
  const allowed = new Set(["uneven_wear","shoulder_wear","center_wear","tread_wear",
    "sidewall_cut","tread_cut","cracking","bulge","exposed_cord","suspected_separation",
    "embedded_object","puncture_evidence","other_visible_damage","uncertain"]);
  const defects = (Array.isArray(body.defects) ? body.defects : []).slice(0,12)
    .filter(d => d && typeof d === "object").map(d => {
      const x = d as Json;
      return { type: allowed.has(str(x.type)) ? x.type : "uncertain",
        description:str(x.description,450), visibleEvidence:str(x.visibleEvidence,450),
        severity:["none","low","moderate","high","urgent","unknown"].includes(str(x.severity))
          ? x.severity : "unknown" };
    });
  return { assessable:body.assessable === true, reason:str(body.reason,400),
    recommendation:str(body.recommendation,700),
    defects:body.assessable === true ? defects : [],
    humanReviewRequired:true, exactTreadDepthMm:null, remainingTreadLifeKm:null };
}
async function work(req:Request) {
  // Cron workers authenticate using the dedicated x-worker-secret header.
  // Interactive user actions verify their bearer token separately.
  const provided = req.headers.get("x-worker-secret");
  const expected = Deno.env.get("AI_WORKER_SECRET");
  if (!expected || !provided || provided !== expected) return fail("Worker unauthorized",403);
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const providerName = anthropicKey ? "anthropic" : "google";
  const providerKey = anthropicKey || Deno.env.get("AI_PROVIDER_KEY");
  const model = Deno.env.get("AI_MODEL") || (anthropicKey ? "claude-haiku-5-5" : "gemini-2.5-flash-lite");
  if (!providerKey) return fail("AI provider is not configured",503);
  // A default USD daily ceiling prevents unattended image jobs from running up a bill.
  const dailyLimit = Math.max(0, Math.min(Number(Deno.env.get("AI_DAILY_LIMIT_USD") ?? "1"), 100));
  const dayStart = new Date(); dayStart.setUTCHours(0,0,0,0);
  const {data:charges,error:chargesError} = await admin.from("ai_tyre_inspection_jobs")
    .select("cost_usd").gte("billed_at",dayStart.toISOString()).not("cost_usd","is",null);
  if (chargesError) return fail("Unable to enforce AI spending ceiling",503);
  const spent = (charges || []).reduce((sum,row)=>sum + Number(row.cost_usd || 0),0);
  if (spent >= dailyLimit) return response({processed:0,reason:"Daily AI spending limit reached",dailyLimit,spent});
  const {data:items,error} = await admin.from("ai_tyre_inspection_jobs")
    .select("id,organisation_id,inspection_id,photo_ref,tyre_position,attempts")
    .eq("status","pending").order("created_at",{ascending:true}).limit(4);
  if (error) return fail("Queue unavailable",500);
  let processed = 0;
  for (const job of items || []) {
    const {data: claimed} = await admin.from("ai_tyre_inspection_jobs")
      .update({status:"processing",attempts:job.attempts+1,updated_at:new Date().toISOString()})
      .eq("id",job.id).eq("status","pending").select("id").maybeSingle();
    if (!claimed) continue;
    try {
      // Stop repeated paid attempts until an operator has explicitly reviewed failures.
      if (job.attempts > 0) {
        await admin.from("ai_tyre_inspection_jobs").update({status:"failed",error_message:"Prior attempt requires manual review",updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","processing");
        continue;
      }
      const ref = parsedStorage(job.photo_ref);
      if (!ref) throw new Error("Invalid private media reference");
      const {data:file,error:readError} = await admin.storage.from(ref.bucket).download(ref.path);
      if (readError || !file) throw new Error("Photo unavailable");
      if (!file.type.startsWith("image/") || file.size > 6_000_000) throw new Error("Unsupported photo");
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Restrict cost and memory before base64 conversion.
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const base64 = btoa(binary);
      const prompt = "Inspect this commercial vehicle tyre photograph. Return a short, valid JSON object with keys assessable (boolean), reason (string), defects (max 4 items each containing type, description, severity, visibleEvidence), recommendation (string). Keep each description under 80 characters. Output no markdown, no commentary. Note whether the image is clear enough. Distinguish normal visible wear from defects; flag uncertain findings. Do NOT invent groove depth millimetres, remaining tread percentage, remaining kilometres, engine readings, tyre pressure or roadworthiness certification.";
      const ctl = new AbortController();
      const timeout = setTimeout(()=>ctl.abort(),25000);
      let provider: any;
      try {
        if (providerName === "anthropic") {
          const completion = await fetch("https://api.anthropic.com/v1/messages",{
            method:"POST",signal:ctl.signal,
            headers:{"x-api-key":providerKey,"anthropic-version":"2023-06-01","content-type":"application/json"},
            body:JSON.stringify({
              model, max_tokens:1100,
              messages:[{role:"user",content:[
                {type:"text",text:prompt},
                {type:"image",source:{type:"base64",media_type:file.type,data:base64}},
              ]}],
            }),
          });
          if (!completion.ok) {
            if ([401,403,400].includes(completion.status)) throw new Error("Anthropic credentials or model access unavailable");
            if (completion.status === 429) throw new Error("Anthropic rate limit");
            throw new Error("Anthropic provider request failed");
          }
          provider = await completion.json();
        } else {
          const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" +
            encodeURIComponent(model) + ":generateContent";
          const completion = await fetch(endpoint,{
            method:"POST",signal:ctl.signal,
            headers:{"x-goog-api-key":providerKey,"content-type":"application/json"},
            body:JSON.stringify({
              generationConfig:{responseMimeType:"application/json",maxOutputTokens:1100,temperature:0.1},
              contents:[{parts:[{text:prompt},{inline_data:{mime_type:file.type,data:base64}}]}],
            }),
          });
          if (!completion.ok) throw new Error("Google provider request failed");
          provider = await completion.json();
        }
      } finally { clearTimeout(timeout); }
      const output = providerName === "anthropic"
        ? provider?.content?.filter((part:Json)=>part.type==="text").map((part:Json)=>part.text).join("")
        : provider?.candidates?.[0]?.content?.parts?.[0]?.text;
      const usage = providerName === "anthropic" ? provider?.usage : provider?.usageMetadata;
      const inputTokens = providerName === "anthropic" ? Number(usage?.input_tokens) : Number(usage?.promptTokenCount);
      const outputTokens = providerName === "anthropic" ? Number(usage?.output_tokens) : Number(usage?.candidatesTokenCount);
      const hasUsage = usage != null && Number.isFinite(inputTokens) && Number.isFinite(outputTokens);
      const standardRate = providerName === "anthropic"
        ? (model === "claude-haiku-5-5" ? [0.10,0.50] : model === "claude-sonnet-5-5" ? [2,10] : null)
        : (model === "gemini-2.5-flash-lite" ? [0.10,0.40] : null);
      const inputRate = Number(Deno.env.get("AI_INPUT_USD_PER_MILLION") ?? standardRate?.[0]);
      const outputRate = Number(Deno.env.get("AI_OUTPUT_USD_PER_MILLION") ?? standardRate?.[1]);
      const hasRates = Number.isFinite(inputRate) && Number.isFinite(outputRate) && inputRate>0 && outputRate>0;
      const estimatedCost = hasUsage && hasRates
        ? Number(((inputTokens*inputRate+outputTokens*outputRate)/1e6).toFixed(6)) : null;

      // Meter model usage before parsing: malformed JSON can still be billable.
      let analysis: Json;
      try {
        const cleanOutput = String(output || "").replace(/^`{3}(?:json)?\s*/i,"").replace(/\s*`{3}$/,"");
      analysis = normalizeAnalysis(JSON.parse(cleanOutput));
      } catch (_parseError) {
        await admin.from("ai_token_logs").insert({
          organisation_id:job.organisation_id,model,feature:"ai_tyre_inspection",
          prompt_tokens:hasUsage?inputTokens:0,completion_tokens:hasUsage?outputTokens:0,
          cost_usd:estimatedCost,status:"error",error:"Unusable model response (JSON validation)",
        });
        await admin.from("ai_tyre_inspection_jobs").update({
          status:"failed",error_message:"Unusable model response; manual review required; no automatic paid retry",
          input_tokens:hasUsage?inputTokens:null,output_tokens:hasUsage?outputTokens:null,
          total_tokens:hasUsage?inputTokens+outputTokens:null,
          provider:providerName,model_version:model,cost_usd:estimatedCost,
          billed_at:hasUsage?new Date().toISOString():null,
          updated_at:new Date().toISOString(),
        }).eq("id",job.id).eq("status","processing");
        continue;
      }
      await admin.from("ai_tyre_inspection_jobs").update({
        status:"completed",analysis,model_version:model,
        provider:providerName, input_tokens:hasUsage?inputTokens:null,
        output_tokens:hasUsage?outputTokens:null,
        total_tokens:hasUsage?Number(usage?.totalTokenCount ?? inputTokens+outputTokens):null,
        pricing_usd_per_million_input:hasRates?inputRate:null,
        pricing_usd_per_million_output:hasRates?outputRate:null,
        cost_usd:estimatedCost,billed_at:hasUsage?new Date().toISOString():null,
        updated_at:new Date().toISOString(),error_message:null,
      }).eq("id",job.id).eq("status","processing");
      processed++;
    } catch (error) {
      const retry = false; // No automatic paid retries, including malformed output.
      await admin.from("ai_tyre_inspection_jobs").update({
        status:retry?"pending":"failed",
        error_message:str(error instanceof Error?error.message:"AI processing error",160),
        updated_at:new Date().toISOString(),
      }).eq("id",job.id).eq("status","processing");
    }
  }
  return response({ processed, claimed:(items||[]).length });
}
Deno.serve(async req => {
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
