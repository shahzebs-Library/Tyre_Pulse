// ============================================================================
// tenant-export - server-side FULL tenant dump for the super-admin console.
//
// The browser export (Console -> Tenant Export) pages rows into the tab and
// truncates the biggest tables at a ceiling. This function pages every table
// in the server safelist (public._tenant_export_tables(), the ONE list) by
// keyset on id (Postgres renders each page as NDJSON through the
// service-role-only public._tenant_export_ndjson) and writes gzip NDJSON part files into the PRIVATE Storage
// bucket `tenant-exports`:
//
//   <org_id>/<job_id>/<table>/part-0001.ndjson.gz   (<= PART_ROWS rows each)
//   <org_id>/<job_id>/manifest.json                 (per-table expected vs exported)
//
// Edge functions cap wall-clock AND CPU time per request, so the work runs in
// bounded slices (BUDGET_MS / SLICE_ROWS) in the background (EdgeRuntime.waitUntil). A slice that
// runs out of time checkpoints the job row (table index + keyset cursor + files)
// and invokes this function again with a per-job continuation token whose
// sha256 lives in tenant_export_jobs.token_hash. The cursor only advances after
// a part file is uploaded, so a crashed slice resumes without gaps.
// Checkpoints are optimistic (matched on updated_at): if two slices ever race,
// the loser stops instead of writing duplicate parts.
//
// HONESTY: a table whose read fails is recorded as FAILED with its error, never
// "0 rows"; a table whose exported count differs from the count taken when it
// started is flagged as drifted. Either makes the job PARTIAL.
//
// Deployed with verify_jwt=false so CORS-wrapped JSON errors reach the browser.
// Every user action re-validates the caller (JWT -> profiles.is_super_admin,
// not locked) and the SQL RPCs re-check is_super_admin() and write the
// console_sessions audit. `continue` takes no JWT; it is authorised only by the
// continuation token of a job that is still running.
//
// Actions (POST JSON):
//   { action:'start', org_id, reason, tables? }  -> { ok, job_id }
//   { action:'resume', job_id }                  -> { ok }   (stalled job only)
//   { action:'download', job_id }                -> { ok, expires_in, files:[{table,path,rows,bytes,url}] }
//   { action:'continue', job_id, token }         -> internal chaining
//   { action:'cleanup', trigger?, actor? }       -> retention purge (x-cron-secret only;
//        called by pg_cron and by admin_tenant_export_purge_now via pg_net)
//
// RETENTION (20260924122000): Supabase refuses a direct SQL DELETE on
// storage.objects (storage.protect_delete), so SQL only decides which jobs are
// due (_tenant_export_due_for_purge) and records the outcome
// (_tenant_export_mark_expired). This function lists each due job's prefix,
// removes the objects through the Storage API, confirms the prefix is empty,
// and only then marks the job expired. A failure is logged and retried next run.
// ============================================================================

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const BUCKET = 'tenant-exports'
const PAGE = 5000            // rows per _tenant_export_ndjson call (NDJSON built in Postgres)
const PART_ROWS = 25000      // rows per NDJSON part file
const SLICE_ROWS = 25000     // rows per invocation: the edge runtime caps CPU time per request
const BUDGET_MS = 100_000    // one background slice
const RESERVE_MS = 12_000    // time kept back for the last upload + checkpoint
const MAX_INVOCATIONS = 400  // hard stop for a runaway chain
const STALL_MS = 120_000     // resume is only allowed after this much silence
const SIGN_SECONDS = 300     // signed download URL lifetime
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABLE_RE = /^[a-z_][a-z0-9_]{0,62}$/
const PURGE_JOBS = 50        // jobs handled per cleanup call

const ALLOWED_ORIGINS = ['https://tyrepulse.app', 'https://www.tyrepulse.app', 'https://app.tyrepulse.app', 'https://admin.tyrepulse.app']
const VERCEL_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  let allowOrigin = '*'
  if (origin) {
    allowOrigin = (ALLOWED_ORIGINS.includes(origin) || VERCEL_ORIGIN.test(origin) || origin.startsWith('http://localhost')) ? origin : 'null'
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') || 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}
const fail = (req: Request, status: number, error: string) => json(req, { ok: false, error }, status)

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
const pad = (n: number) => String(n).padStart(4, '0')
function background(p: Promise<unknown>) {
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p)
  else p.catch(() => {})
}
function pgMessage(err: unknown): string {
  const e = err as { message?: string; code?: string }
  return String(e?.message || 'Unknown error').slice(0, 300)
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const URL_ = Deno.env.get('SUPABASE_URL') || ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function adminClient(): SupabaseClient {
  return createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Validate the caller's JWT and that they are an unlocked super admin. */
async function requireSuperAdmin(req: Request): Promise<{ userClient: SupabaseClient; uid: string } | Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return fail(req, 401, 'Sign in required.')
  const userClient = createClient(URL_, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await userClient.auth.getUser(token)
  const uid = data?.user?.id
  if (error || !uid) return fail(req, 401, 'Your session has expired. Please sign in again.')
  const { data: prof } = await adminClient().from('profiles').select('is_super_admin, locked').eq('id', uid).maybeSingle()
  if (!prof?.is_super_admin || prof?.locked) return fail(req, 403, 'Only a super admin can export tenant data.')
  return { userClient, uid }
}

// ---------------------------------------------------------------------------
// The worker: one time-boxed slice
// ---------------------------------------------------------------------------
type Progress = {
  idx: number; after: string | null; part: number; table_rows: number
  errors: Record<string, string>; expected: Record<string, number | null>; invocations: number
}
type FileEntry = { table: string; path: string; rows: number; bytes: number }

async function runSlice(jobId: string, token: string) {
  const admin = adminClient()
  const deadline = Date.now() + BUDGET_MS
  const { data: job } = await admin.from('tenant_export_jobs')
    .select('id, org_id, reason, tables, status, mode, progress, files, row_counts, started_at, updated_at')
    .eq('id', jobId).maybeSingle()
  if (!job || job.mode !== 'server' || job.status !== 'running') return

  let seen: string = job.updated_at
  const tables: string[] = (Array.isArray(job.tables) ? job.tables : []).filter((t: unknown) => typeof t === 'string' && TABLE_RE.test(t as string))
  const prog: Progress = {
    idx: 0, after: null, part: 0, table_rows: 0, errors: {}, expected: {}, invocations: 0,
    ...(job.progress || {}),
  }
  const files: FileEntry[] = Array.isArray(job.files) ? job.files : []
  const counts: Record<string, number> = { ...(job.row_counts || {}) }
  const org: string = job.org_id

  // Claim the job (optimistic on updated_at): a racing slice stops here.
  prog.invocations += 1
  if (prog.invocations > MAX_INVOCATIONS) {
    await admin.from('tenant_export_jobs').update({
      status: 'failed', error: 'Stopped: the export needed too many server slices.', completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), token_hash: null,
    }).eq('id', jobId)
    return
  }
  const checkpoint = async (extra: Record<string, unknown> = {}): Promise<boolean> => {
    const now = new Date().toISOString()
    const { data: upd } = await admin.from('tenant_export_jobs')
      .update({ progress: prog, files, row_counts: counts, updated_at: now, ...extra })
      .eq('id', jobId).eq('updated_at', seen).eq('status', 'running')
      .select('updated_at')
    if (!upd || !upd.length) return false
    seen = upd[0].updated_at
    return true
  }
  if (!(await checkpoint())) return

  let sliceRows = 0
  try {
    while (prog.idx < tables.length) {
      if (Date.now() > deadline - RESERVE_MS || sliceRows >= SLICE_ROWS) break
      const t = tables[prog.idx]

      // Count at table start: the reference for drift.
      if (prog.after === null && prog.table_rows === 0 && !(t in prog.expected)) {
        const { count, error } = await admin.from(t).select('id', { count: 'exact', head: true }).eq('organisation_id', org)
        prog.expected[t] = error ? null : (count ?? null)
      }

      // Read one part. Postgres renders the NDJSON (service-role-only RPC), so
      // no row is parsed or re-serialised here: per-row JSON work in Deno is
      // what exhausted the edge CPU limit on the first live run.
      const chunks: string[] = []
      let nRows = 0
      let after = prog.after
      let tableDone = false
      let readErr: string | null = null
      while (nRows < PART_ROWS && Date.now() < deadline - RESERVE_MS) {
        const { data, error } = await admin.rpc('_tenant_export_ndjson', {
          p_org: org, p_table: t, p_after: after, p_limit: Math.min(PAGE, PART_ROWS - nRows),
        })
        if (error) { readErr = pgMessage(error); break }
        const pageRes = (data || {}) as { body?: string; n?: number; last?: string | null; done?: boolean }
        const n = Number(pageRes.n) || 0
        if (n > 0 && pageRes.body) { chunks.push(pageRes.body); nRows += n }
        if (pageRes.last) after = String(pageRes.last)
        if (pageRes.done || n === 0) { tableDone = true; break }
      }

      if (nRows) {
        const part = prog.part + 1
        const path = `${org}/${jobId}/${t}/part-${pad(part)}.ndjson.gz`
        const body = await gzip(chunks.join('\n') + '\n')
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, body, { contentType: 'application/gzip', upsert: true })
        if (upErr) {
          readErr = `Upload failed: ${pgMessage(upErr)}`
        } else {
          files.push({ table: t, path, rows: nRows, bytes: body.byteLength })
          prog.part = part
          prog.after = after
          prog.table_rows += nRows
          counts[t] = prog.table_rows
          sliceRows += nRows
        }
      }

      if (readErr) {
        // Honest failure: keep what was written, mark the table, move on.
        prog.errors[t] = readErr
        counts[t] = prog.table_rows
        tableDone = true
      }
      if (tableDone) {
        counts[t] = prog.table_rows
        prog.idx += 1
        prog.after = null
        prog.part = 0
        prog.table_rows = 0
      }
      if (!(await checkpoint())) return
    }

    if (prog.idx >= tables.length) {
      // Finish: manifest + final status.
      const per = tables.map((t) => {
        const expected = prog.expected[t] ?? null
        const exported = counts[t] ?? 0
        const error = prog.errors[t] || null
        const drifted = !error && expected !== null && expected !== exported
        return {
          table: t, expected, exported, error, drifted,
          outcome: error ? 'failed' : drifted ? 'drifted' : 'complete',
          files: files.filter((f) => f.table === t).map((f) => f.path),
        }
      })
      const failed = per.filter((p) => p.error).length
      const status = failed === per.length && per.length > 0 ? 'failed'
        : per.some((p) => p.error || p.drifted) ? 'partial' : 'completed'
      const manifest = {
        format: 'tyrepulse-tenant-export/1',
        encoding: 'ndjson+gzip, one JSON object per line, ordered by id',
        job_id: jobId, org_id: org, reason: job.reason, status,
        started_at: job.started_at, completed_at: new Date().toISOString(),
        total_rows: per.reduce((s, p) => s + p.exported, 0),
        tables: per,
      }
      const mBody = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
      const mPath = `${org}/${jobId}/manifest.json`
      const { error: mErr } = await admin.storage.from(BUCKET).upload(mPath, mBody, { contentType: 'application/json', upsert: true })
      if (!mErr) files.push({ table: '_manifest', path: mPath, rows: 0, bytes: mBody.byteLength })
      await checkpoint({
        status, completed_at: new Date().toISOString(), token_hash: null,
        error: mErr ? 'The manifest file could not be written.' : (failed ? `${failed} table(s) failed.` : null),
      })
      return
    }

    // Out of time: chain the next slice.
    await fetch(`${URL_}/functions/v1/tenant-export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ action: 'continue', job_id: jobId, token }),
    }).catch(() => { /* resume from the console recovers a broken chain */ })
  } catch (err) {
    await admin.from('tenant_export_jobs').update({
      status: 'failed', error: `Server export stopped: ${pgMessage(err)}`,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      progress: prog, files, row_counts: counts, token_hash: null,
    }).eq('id', jobId).eq('status', 'running')
  }
}

// ---------------------------------------------------------------------------
// Retention cleanup
// ---------------------------------------------------------------------------
type StoredObject = { path: string; bytes: number }

/** Every object under a job prefix (org/job/...), recursing into table folders. */
async function listPrefix(admin: SupabaseClient, prefix: string, depth = 0): Promise<StoredObject[]> {
  if (depth > 3) return []
  const out: StoredObject[] = []
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(`List failed: ${pgMessage(error)}`)
    const rows = data || []
    for (const e of rows as Array<{ name: string; id: string | null; metadata?: { size?: number } | null }>) {
      const p = `${prefix}/${e.name}`
      if (e.id === null) out.push(...(await listPrefix(admin, p, depth + 1)))
      else out.push({ path: p, bytes: Number(e.metadata?.size) || 0 })
    }
    if (rows.length < 1000) break
  }
  return out
}

async function purgeExpired(trigger: string, actor: string | null) {
  const admin = adminClient()
  const { data: due, error } = await admin.rpc('_tenant_export_due_for_purge', { p_limit: PURGE_JOBS })
  if (error) throw new Error(pgMessage(error))
  const list = (Array.isArray(due) ? due : []) as Array<{ job_id: string; org_id: string; prefix: string }>
  const results: Array<{ job_id: string; objects: number; bytes: number; ok: boolean }> = []
  for (const job of list) {
    const prefix = `${job.org_id}/${job.job_id}`
    if (!UUID_RE.test(job.org_id) || !UUID_RE.test(job.job_id)) continue
    let removed = 0
    let bytes = 0
    try {
      const objects = await listPrefix(admin, prefix)
      bytes = objects.reduce((s, o) => s + o.bytes, 0)
      for (let i = 0; i < objects.length; i += 100) {
        const batch = objects.slice(i, i + 100).map((o) => o.path)
        const { data: gone, error: rmErr } = await admin.storage.from(BUCKET).remove(batch)
        if (rmErr) throw new Error(`Remove failed: ${pgMessage(rmErr)}`)
        removed += (gone || []).length
      }
      const left = await listPrefix(admin, prefix)
      if (left.length) throw new Error(`${left.length} file(s) still present after removal`)
      await admin.rpc('_tenant_export_mark_expired', {
        p_job: job.job_id, p_objects: removed, p_bytes: bytes, p_trigger: trigger, p_actor: actor, p_error: null,
      })
      results.push({ job_id: job.job_id, objects: removed, bytes, ok: true })
    } catch (err) {
      await admin.rpc('_tenant_export_mark_expired', {
        p_job: job.job_id, p_objects: removed, p_bytes: bytes, p_trigger: trigger, p_actor: actor, p_error: pgMessage(err),
      })
      results.push({ job_id: job.job_id, objects: removed, bytes, ok: false })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return fail(req, 405, 'Method not allowed.')
  if (!URL_ || !ANON || !SERVICE) return fail(req, 503, 'Server export is not configured.')

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return fail(req, 400, 'Invalid request.') }
  const action = String(body.action || '')
  const jobId = typeof body.job_id === 'string' ? body.job_id : ''

  try {
    if (action === 'continue') {
      const token = typeof body.token === 'string' ? body.token : ''
      if (!UUID_RE.test(jobId) || token.length < 32) return fail(req, 401, 'Not allowed.')
      const { data: job } = await adminClient().from('tenant_export_jobs')
        .select('status, token_hash').eq('id', jobId).maybeSingle()
      const hash = await sha256Hex(token)
      if (!job || job.status !== 'running' || !job.token_hash || !timingSafeEqual(job.token_hash, hash)) {
        return fail(req, 401, 'Not allowed.')
      }
      background(runSlice(jobId, token))
      return json(req, { ok: true }, 202)
    }

    if (action === 'cleanup') {
      const secret = req.headers.get('x-cron-secret') || ''
      if (secret.length < 16) return fail(req, 401, 'Not allowed.')
      const { data: row } = await adminClient().from('cron_config').select('value').eq('name', 'cron_secret').maybeSingle()
      const expected = String(row?.value || '')
      if (!expected || !timingSafeEqual(await sha256Hex(expected), await sha256Hex(secret))) {
        return fail(req, 401, 'Not allowed.')
      }
      const trigger = body.trigger === 'manual' ? 'manual' : 'cron'
      const actor = typeof body.actor === 'string' && UUID_RE.test(body.actor) ? body.actor : null
      const results = await purgeExpired(trigger, actor)
      return json(req, { ok: true, jobs: results.length, results })
    }

    const auth = await requireSuperAdmin(req)
    if (auth instanceof Response) return auth
    const { userClient } = auth

    if (action === 'start') {
      const orgId = typeof body.org_id === 'string' ? body.org_id : ''
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      const tables = Array.isArray(body.tables) ? body.tables.filter((t) => typeof t === 'string') : null
      if (!UUID_RE.test(orgId)) return fail(req, 400, 'Choose an organisation.')
      if (reason.length < 5) return fail(req, 400, 'A reason of at least 5 characters is required.')
      const { data, error } = await userClient.rpc('admin_tenant_export_server_start', {
        p_org: orgId, p_reason: reason, p_tables: tables && tables.length ? tables : null,
      })
      if (error) {
        const msg = error.code === '55P03' ? 'A server export for this organisation is already running.'
          : error.code === '42501' ? 'Only a super admin can export tenant data.'
            : error.code === '22023' ? String(error.message || 'Invalid request.') : 'The export could not be started.'
        return fail(req, error.code === '42501' ? 403 : 400, msg)
      }
      const id = String((data as { job_id?: string })?.job_id || '')
      const token = crypto.randomUUID() + crypto.randomUUID()
      await adminClient().from('tenant_export_jobs').update({ token_hash: await sha256Hex(token) }).eq('id', id)
      background(runSlice(id, token))
      return json(req, { ok: true, job_id: id }, 202)
    }

    if (action === 'resume') {
      if (!UUID_RE.test(jobId)) return fail(req, 400, 'Invalid job.')
      const admin = adminClient()
      const { data: job } = await admin.from('tenant_export_jobs').select('status, mode, updated_at').eq('id', jobId).maybeSingle()
      if (!job || job.mode !== 'server') return fail(req, 404, 'Export job not found.')
      if (job.status !== 'running') return fail(req, 409, 'That export is not running.')
      if (Date.now() - Date.parse(job.updated_at) < STALL_MS) return fail(req, 409, 'That export is still making progress.')
      const token = crypto.randomUUID() + crypto.randomUUID()
      await admin.from('tenant_export_jobs').update({ token_hash: await sha256Hex(token) }).eq('id', jobId)
      await admin.from('console_sessions').insert({
        admin_id: auth.uid, action: 'tenant_export_resume', target_type: 'tenant_export_job', details: { job_id: jobId },
      })
      background(runSlice(jobId, token))
      return json(req, { ok: true }, 202)
    }

    if (action === 'download') {
      if (!UUID_RE.test(jobId)) return fail(req, 400, 'Invalid job.')
      const { data, error } = await userClient.rpc('admin_tenant_export_download_log', { p_job: jobId })
      if (error) {
        const msg = error.code === '55P03' ? 'That export is still running.'
          : error.code === 'P0002' ? 'Export job not found.'
            : error.code === '22023'
              ? (/expired/i.test(String(error.message || '')) ? 'That export has expired and its files were deleted.' : 'That export produced no files.')
              : 'The download could not be prepared.'
        return fail(req, error.code === '42501' ? 403 : 400, msg)
      }
      const list: FileEntry[] = Array.isArray((data as { files?: FileEntry[] })?.files) ? (data as { files: FileEntry[] }).files : []
      const orgPrefix = `${(data as { org_id: string }).org_id}/${jobId}/`
      const safe = list.filter((f) => typeof f?.path === 'string' && f.path.startsWith(orgPrefix))
      const { data: signed, error: sErr } = await adminClient().storage.from(BUCKET)
        .createSignedUrls(safe.map((f) => f.path), SIGN_SECONDS)
      if (sErr) return fail(req, 500, 'The download links could not be created.')
      const byPath = new Map((signed || []).map((s: { path: string | null; signedUrl: string }) => [s.path, s.signedUrl]))
      return json(req, {
        ok: true, expires_in: SIGN_SECONDS,
        files: safe.map((f) => ({ ...f, url: byPath.get(f.path) || null })),
      })
    }

    return fail(req, 400, 'Unknown action.')
  } catch {
    return fail(req, 500, 'The request failed.')
  }
})
