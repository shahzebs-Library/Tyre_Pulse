// Run the `sign-in` edge function LOCALLY (deno) against a stand-in Supabase whose
// RPCs are answered by the LOCAL staging copy (resolve_sign_in_user, the lockout
// functions, auth.users). Nothing is deployed and no hosted project is contacted.
//
//   node e2e/multi_company/sign_in_edge_local.mjs            (needs: psql, npx deno@2)
// Env: STAGING_DB (default tp_auth_test, prepared by supabase/tests/multi_company_auth/run_staging.sh)
//
// The stand-in GoTrue accepts the password "correct-horse-1" for any account in auth.users.
import http from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FN = join(HERE, '..', '..', 'supabase', 'functions', 'sign-in', 'index.ts')
const DB = process.env.STAGING_DB || 'tp_auth_test'
const HOST = process.env.STAGING_HOST || '127.0.0.1'
if (!['127.0.0.1', 'localhost'].includes(HOST)) { console.error('Refusing: local staging only'); process.exit(1) }
const MOCK_PORT = 54398, FN_PORT = 54397
const GOOD_PW = 'correct-horse-1'
let resolverMissing = false
let resolverBroken = false

function sql(query, vars = {}) {
  const args = ['-X', '-qAt', '-h', HOST, '-p', '54329', '-U', 'postgres', '-d', DB]
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  // Through stdin, not -c: psql interpolates :'var' only in script input.
  return execFileSync('psql', [...args, '-v', 'ON_ERROR_STOP=1'], { input: `${query};\n`, encoding: 'utf8' }).trim()
}

const RPCS = new Set(['resolve_sign_in_user', 'login_attempt_status', 'record_login_failure'])
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const url = new URL(req.url, 'http://x')
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
    try {
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
      if (rpc && RPCS.has(rpc[1])) {
        if (rpc[1] === 'resolve_sign_in_user' && resolverMissing) return send(404, { code: 'PGRST202', message: 'Could not find the function' })
        if (rpc[1] === 'resolve_sign_in_user' && resolverBroken) return send(500, { code: 'XX000', message: 'boom' })
        const id = JSON.parse(body || '{}').p_identifier ?? ''
        // psql :'v' quoting keeps the identifier a literal (no injection).
        const out = sql(`select to_jsonb(public.${rpc[1]}(:'v'))`, { v: id })
        return send(200, out ? JSON.parse(out) : null)
      }
      const prof = url.pathname === '/rest/v1/profiles'
      if (prof) {
        const col = url.searchParams.has('username') ? 'username' : 'employee_id'
        const pat = (url.searchParams.get(col) || '').replace(/^ilike\./, '')
        const out = sql(`select coalesce(jsonb_agg(jsonb_build_object('id', id)), '[]') from (select id from public.profiles where ${col} ilike :'v' limit 1) s`, { v: pat })
        return send(200, JSON.parse(out))
      }
      const u = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/)
      if (u) {
        const out = sql(`select to_jsonb(s) from (select id, email from auth.users where id = :'v'::uuid) s`, { v: u[1] })
        return out ? send(200, JSON.parse(out)) : send(404, { msg: 'User not found' })
      }
      if (url.pathname === '/auth/v1/token') {
        const { email, password } = JSON.parse(body || '{}')
        const id = sql(`select id from auth.users where lower(email) = lower(:'v')`, { v: email || '' })
        if (!id || password !== GOOD_PW) return send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
        return send(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, expires_at: 1, token_type: 'bearer', user: { id } })
      }
      return send(404, { message: 'not mocked' })
    } catch (e) {
      return send(500, { message: String(e.message || e) })
    }
  })
})

const results = []
const check = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'ok' : 'not ok'} - ${name}${cond ? '' : ` | ${detail}`}`) }
async function call(identifier, password = GOOD_PW) {
  const t0 = Date.now()
  const r = await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) })
  return { status: r.status, body: await r.json().catch(() => null), ms: Date.now() - t0 }
}

await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r))
const dir = mkdtempSync(join(tmpdir(), 'signin-fn-'))
const map = join(dir, 'import_map.json')
writeFileSync(map, JSON.stringify({ imports: { 'https://esm.sh/@supabase/supabase-js@2': 'npm:@supabase/supabase-js@2' } }))
const fn = spawn('npx', ['--yes', 'deno@2', 'run', '--no-config', `--import-map=${map}`, '--allow-net', '--allow-env', FN], {
  env: { ...process.env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${FN_PORT}`, PORT: String(FN_PORT),
    SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, SUPABASE_SERVICE_ROLE_KEY: 'service-stand-in', SUPABASE_ANON_KEY: 'anon-stand-in' },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true, // own process group, so the deno child of npx is stopped too
})
let fnLog = ''
fn.stdout.on('data', (d) => { fnLog += d }); fn.stderr.on('data', (d) => { fnLog += d })
for (let i = 0; i < 120; i++) {
  try { await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'OPTIONS' }); break } catch { await new Promise((r) => setTimeout(r, 1000)) }
}

try {
  // Text keys (V287) or account keys (TEN-9f): clear both for the accounts used here.
  sql("delete from public.login_attempts where identifier in ('alpha.manager','beta-haulage/beta.admin','alpha-readymix/beta.admin') or identifier like 'u:%'")
  const BETA = '9c149942-c3b2-54c6-a6e8-c34b2933bb3c'
  let r = await call('alpha.admin')
  check('plain username -> 200 (real-email account, address never returned)', r.status === 200 && !JSON.stringify(r.body).includes('@'), JSON.stringify(r))
  r = await call('EMP-0001')
  check('employee id -> 200', r.status === 200, JSON.stringify(r))
  r = await call('beta-haulage/beta.admin')
  check('code/username -> 200 as the Beta admin', r.status === 200 && r.body?.user?.id === BETA, JSON.stringify(r))
  r = await call(' Beta-Haulage / Beta.Admin ')
  check('code/username tolerates case and spaces', r.status === 200 && r.body?.user?.id === BETA, JSON.stringify(r))
  r = await call('alpha-readymix/beta.admin')
  check('code of ANOTHER company -> 401, same answer as unknown', r.status === 401 && r.body?.error === 'invalid_credentials' && r.ms >= 650, JSON.stringify(r))
  r = await call('nobody.at.all')
  check('unknown name -> 401 after the minimum refusal time', r.status === 401 && r.ms >= 650, JSON.stringify(r))
  r = await call('alpha.admin@staging.tyrepulse.invalid')
  check('email identifier -> 200', r.status === 200, JSON.stringify(r))
  r = await call('alpha.manager', 'wrong-password')
  const cnt = sql("select attempt_count from public.login_attempts where identifier in ('alpha.manager', 'u:63e831d7-f511-5432-976d-439af4ccaf18')")
  check('wrong password -> 401 and counted server-side once', r.status === 401 && cnt === '1', `${JSON.stringify(r)} count=${cnt}`)
  resolverMissing = true
  r = await call('beta.admin')
  check('resolver missing (PGRST202) -> old exact lookup still signs in', r.status === 200 && r.body?.user?.id === BETA, JSON.stringify(r))
  r = await call('beta-haulage/beta.admin')
  check('resolver missing -> code form is not understood (401), never a wrong account', r.status === 401, JSON.stringify(r))
  resolverMissing = false; resolverBroken = true
  r = await call('beta.admin')
  check('resolver erroring -> 503 unavailable, not counted as a failure', r.status === 503, JSON.stringify(r))
  resolverBroken = false
} finally {
  try { process.kill(-fn.pid, 'SIGTERM') } catch { fn.kill('SIGTERM') }
  mock.close()
}
const failed = results.filter((x) => !x).length
if (failed) console.log(fnLog.slice(-2000))
console.log(`sign-in edge function (local): ${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
