// Run the `sign-in` edge function LOCALLY (deno) against a stand-in Supabase whose
// RPCs are answered by the LOCAL staging copy (resolve_sign_in_user, the lockout
// functions, auth.users). Nothing is deployed and no hosted project is contacted.
//
//   node e2e/multi_company/sign_in_edge_local.mjs            (needs: psql, npx deno@2)
// Env: STAGING_DB (default tp_auth550). The script creates it itself as a copy of the
// local staging mirror (tp_mirror2, production-identical functions) with the TEN-9f
// migration applied, i.e. production as it stands after 2026-11-16.
//
// The stand-in GoTrue accepts the password "correct-horse-1" for any account in auth.users.
// With captchaOn it behaves like Supabase CAPTCHA protection: a password grant without a
// token, or with an unknown or already used token, is refused with captcha_failed.
import http from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FN = join(HERE, '..', '..', 'supabase', 'functions', 'sign-in', 'index.ts')
const DB = process.env.STAGING_DB || 'tp_auth550'
const HOST = process.env.STAGING_HOST || '127.0.0.1'
if (!['127.0.0.1', 'localhost'].includes(HOST)) { console.error('Refusing: local staging only'); process.exit(1) }
const MOCK_PORT = 54398, FN_PORT = 54397
const GOOD_PW = 'correct-horse-1'
let lockoutBroken = false
let profilesBroken = false
let captchaOn = false
const issuedTokens = new Set()

function sql(query, vars = {}) {
  const args = ['-X', '-qAt', '-h', HOST, '-p', '54329', '-U', 'postgres', '-d', DB]
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  // Through stdin, not -c: psql interpolates :'var' only in script input.
  return execFileSync('psql', [...args, '-v', 'ON_ERROR_STOP=1'], { input: `${query};\n`, encoding: 'utf8' }).trim()
}

const RPCS = new Set(['login_attempt_status', 'record_login_failure'])
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const url = new URL(req.url, 'http://x')
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
    try {
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)
      if (rpc && RPCS.has(rpc[1])) {
        if (rpc[1] === 'login_attempt_status' && lockoutBroken) return send(500, { code: 'XX000', message: 'boom' })
        const id = JSON.parse(body || '{}').p_identifier ?? ''
        // psql :'v' quoting keeps the identifier a literal (no injection).
        const out = sql(`select to_jsonb(public.${rpc[1]}(:'v'))`, { v: id })
        return send(200, out ? JSON.parse(out) : null)
      }
      const prof = url.pathname === '/rest/v1/profiles'
      if (prof) {
        if (profilesBroken) return send(500, { code: 'XX000', message: 'boom' })
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
        const { email, password, gotrue_meta_security: meta } = JSON.parse(body || '{}')
        if (captchaOn) {
          const tok = meta?.captcha_token
          if (!tok || !issuedTokens.has(tok)) return send(400, { error_code: 'captcha_failed', msg: 'captcha protection: request disallowed (no token, invalid token or already used)' })
          issuedTokens.delete(tok) // single use, like Turnstile
        }
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
async function call(identifier, password = GOOD_PW, captcha_token) {
  const t0 = Date.now()
  const r = await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password, ...(captcha_token ? { captcha_token } : {}) }) })
  return { status: r.status, body: await r.json().catch(() => null), ms: Date.now() - t0 }
}

// Fresh production-shaped copy: staging mirror + TEN-9f.
const PG = ['-X', '-q', '-h', HOST, '-p', '54329', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
execFileSync('psql', [...PG, '-d', 'postgres', '-c', `drop database if exists ${DB}`, '-c', `create database ${DB} template tp_mirror2`])
execFileSync('psql', [...PG, '-d', DB, '-f', join(HERE, '..', '..', 'supabase', 'pending_migrations', '20261116100000_ten9f_login_lockout_per_account.sql')])
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
  sql("delete from public.login_attempts")
  const ADMIN = sql("select id from auth.users where email = 'alpha.admin@staging.tyrepulse.invalid'")
  let r = await call('alpha.admin')
  check('username -> 200, the address is never returned', r.status === 200 && r.body?.user?.id === ADMIN && !JSON.stringify(r.body).includes('@'), JSON.stringify(r))
  r = await call('EMP-0001')
  check('employee id -> 200', r.status === 200 && r.body?.user?.id === ADMIN, JSON.stringify(r))
  r = await call('nobody.at.all')
  check('unknown name -> 401, same answer as a wrong password', r.status === 401 && r.body?.error === 'invalid_credentials', JSON.stringify(r))
  r = await call('alpha.manager', 'wrong-password')
  const MGR = sql("select id from auth.users where email = 'alpha.manager@staging.tyrepulse.invalid'")
  let cnt = sql(`select attempt_count from public.login_attempts where identifier = 'u:${MGR}'`)
  check('wrong password -> 401, counted once on the account (TEN-9f key)', r.status === 401 && cnt === '1', `${JSON.stringify(r)} count=${cnt}`)
  for (let i = 0; i < 4; i++) r = await call('EMP-0002', 'wrong-password')
  check('5th wrong password (by employee id) -> 429 locked, 15 minutes', r.status === 429 && r.body?.retry_after_seconds === 900, JSON.stringify(r))
  r = await call('alpha.manager')
  check('locked account refused even with the right password', r.status === 429, JSON.stringify(r))
  sql("delete from public.login_attempts")

  lockoutBroken = true
  r = await call('alpha.admin')
  check('lockout check erroring -> 503 unavailable (fails closed), no session', r.status === 503 && r.body?.error === 'unavailable' && !r.body?.access_token, JSON.stringify(r))
  cnt = sql(`select count(*) from public.login_attempts`)
  check('a refused-while-down request is not counted as a failure', cnt === '0', `rows=${cnt}`)
  lockoutBroken = false
  r = await call('alpha.admin')
  check('lockout check back -> signs in again', r.status === 200, JSON.stringify(r))

  profilesBroken = true
  r = await call('alpha.admin')
  check('account lookup erroring -> 503 unavailable, no session', r.status === 503 && !r.body?.access_token, JSON.stringify(r))
  profilesBroken = false

  captchaOn = true
  r = await call('alpha.admin')
  check('CAPTCHA on, no token -> refused with captcha_failed, no session', r.status === 400 && r.body?.error === 'captcha_failed' && !r.body?.access_token, JSON.stringify(r))
  cnt = sql(`select count(*) from public.login_attempts where identifier = 'u:${ADMIN}'`)
  check('a CAPTCHA refusal is not counted as a wrong password', cnt === '0', `rows=${cnt}`)
  r = await call('alpha.admin', GOOD_PW, 'invented-token')
  check('CAPTCHA on, invalid token -> captcha_failed', r.status === 400 && r.body?.error === 'captcha_failed', JSON.stringify(r))
  issuedTokens.add('tok-1')
  r = await call('alpha.admin', GOOD_PW, 'tok-1')
  check('CAPTCHA on, valid token -> 200', r.status === 200, JSON.stringify(r))
  r = await call('alpha.admin', GOOD_PW, 'tok-1')
  check('CAPTCHA on, same token reused -> captcha_failed', r.status === 400 && r.body?.error === 'captcha_failed', JSON.stringify(r))
  issuedTokens.add('tok-2')
  r = await call('alpha.admin', 'wrong-password', 'tok-2')
  check('CAPTCHA on, valid token + wrong password -> 401 and counted', r.status === 401, JSON.stringify(r))
  captchaOn = false
} finally {
  try { process.kill(-fn.pid, 'SIGTERM') } catch { fn.kill('SIGTERM') }
  mock.close()
}
const failed = results.filter((x) => !x).length
if (failed) console.log(fnLog.slice(-2000))
console.log(`sign-in edge function (local): ${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
