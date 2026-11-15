// Local gateway for browser workflow tests. One origin that looks like a Supabase project URL:
//   /rest/v1/*      -> PostgREST (real, against the local database copy)
//   /auth/v1/*      -> sign-in shim: checks the bcrypt password in auth.users, signs a JWT
//   /functions/v1/sign-in -> same shim, username or employee id form
//   /storage/v1, other /functions/v1, /realtime/v1 -> honest 501 (these services do not exist locally)
// It never talks to anything except 127.0.0.1.
import http from 'node:http'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { sign, verify } from './jwt.mjs'

const SECRET = process.env.E2E_JWT_SECRET
const PORT = Number(process.env.GATEWAY_PORT || 54331)
const PGRST = Number(process.env.PGRST_PORT || 54330)
const DB = process.env.E2E_DB || 'tyrepulse_e2e'
const PGHOST = process.env.PGHOST_E2E || '127.0.0.1'
const PGPORT = process.env.PGPORT_E2E || '54329'
if (!SECRET) { console.error('E2E_JWT_SECRET is required'); process.exit(1) }
if (!['127.0.0.1', 'localhost'].includes(PGHOST)) { console.error('local database only'); process.exit(1) }

const CORS = (req) => ({
  'access-control-allow-origin': req.headers.origin || '*',
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-allow-headers': req.headers['access-control-request-headers'] || 'authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,x-supabase-api-version',
  'access-control-expose-headers': 'content-range,content-profile,range,x-total-count,preference-applied',
  'access-control-max-age': '600',
})
const send = (req, res, status, body, extra = {}) => {
  const data = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...CORS(req), ...extra }); res.end(data)
}
const readBody = (req) => new Promise((resolve) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks)))
})

// One parameterised query through psql. Values travel as psql variables, never spliced into SQL text.
function query(sql, vars = {}) {
  const args = ['-X', '-q', '-At', '-h', PGHOST, '-p', PGPORT, '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1']
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`)
  return new Promise((resolve, reject) => {
    const child = execFile('psql', args, { timeout: 15000 }, (err, stdout) => err ? reject(err) : resolve(stdout.trim()))
    child.stdin.end(sql)
  })
}
async function findUser(emailOrId, password) {
  const sql = password === undefined
    ? `select row_to_json(t) from (select id, email, raw_app_meta_data, raw_user_meta_data, created_at from auth.users where id::text = :'ident' and deleted_at is null) t;`
    : `select row_to_json(t) from (select id, email, raw_app_meta_data, raw_user_meta_data, created_at from auth.users
         where lower(email) = lower(:'ident') and deleted_at is null and (banned_until is null or banned_until < now())
           and encrypted_password = extensions.crypt(:'pw', encrypted_password)) t;`
  const out = await query(sql, password === undefined ? { ident: emailOrId } : { ident: emailOrId, pw: password })
  return out ? JSON.parse(out) : null
}
const userJson = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, phone: '',
  email_confirmed_at: u.created_at, confirmed_at: u.created_at, last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'], ...(u.raw_app_meta_data || {}) },
  user_metadata: u.raw_user_meta_data || {}, identities: [], factors: [],
  created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
})
function session(u) {
  const now = Math.floor(Date.now() / 1000), exp = now + 3600
  const sid = crypto.randomUUID()
  const access_token = sign({
    aud: 'authenticated', exp, iat: now, iss: 'tyrepulse-e2e/auth/v1', sub: u.id, email: u.email, phone: '',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data || {},
    role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: now }], session_id: sid, is_anonymous: false,
  }, SECRET)
  const refresh_token = sign({ typ: 'refresh', sub: u.id, iat: now, exp: now + 86400, jti: sid }, SECRET)
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token, user: userJson(u) }
}
const bearer = (req) => verify(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), SECRET)

async function auth(req, res, url) {
  const p = url.pathname.replace(/^\/auth\/v1/, '')
  const body = req.method === 'POST' || req.method === 'PUT' ? JSON.parse((await readBody(req)).toString() || '{}') : {}
  if (p === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type')
    if (grant === 'password') {
      const u = await findUser(String(body.email || ''), String(body.password || ''))
      if (!u) return send(req, res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
      return send(req, res, 200, session(u))
    }
    if (grant === 'refresh_token') {
      const c = verify(body.refresh_token, SECRET)
      const u = c?.typ === 'refresh' ? await findUser(c.sub) : null
      if (!u) return send(req, res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
      return send(req, res, 200, session(u))
    }
    return send(req, res, 400, { code: 400, error_code: 'unsupported_grant_type', msg: 'unsupported grant type in the local shim' })
  }
  if (p === '/user' && req.method === 'GET') {
    const c = bearer(req); const u = c?.sub ? await findUser(c.sub) : null
    if (!u) return send(req, res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })
    return send(req, res, 200, userJson(u))
  }
  if (p === '/logout' && req.method === 'POST') { res.writeHead(204, CORS(req)); return res.end() }
  if (p === '/settings') return send(req, res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: true })
  return send(req, res, 501, { code: 501, error_code: 'not_implemented', msg: `auth endpoint ${p} is not implemented in the local shim` })
}

async function signInFunction(req, res) {
  const body = JSON.parse((await readBody(req)).toString() || '{}')
  const email = await query(`select public.get_email_by_identifier(:'ident');`, { ident: String(body.identifier || '') }).catch(() => '')
  // The production RPC only returns synthetic field addresses. The local shim also resolves a username directly.
  const resolved = email && email.includes('@') ? email
    : await query(`select u.email from public.profiles p join auth.users u on u.id = p.id where lower(p.username) = lower(:'ident') limit 1;`, { ident: String(body.identifier || '') })
  const u = resolved ? await findUser(resolved, String(body.password || '')) : null
  if (!u) return send(req, res, 401, { error: 'invalid_credentials' })
  return send(req, res, 200, session(u))
}

function proxyRest(req, res, url) {
  const headers = { ...req.headers, host: `127.0.0.1:${PGRST}` }
  delete headers.origin
  const up = http.request({ host: '127.0.0.1', port: PGRST, method: req.method, path: url.pathname.replace(/^\/rest\/v1/, '') + url.search, headers }, (r) => {
    const h = { ...r.headers }
    for (const k of Object.keys(h)) if (k.startsWith('access-control-')) delete h[k]
    res.writeHead(r.statusCode, { ...h, ...CORS(req) }); r.pipe(res)
  })
  up.on('error', () => send(req, res, 502, { message: 'PostgREST is not reachable' }))
  req.pipe(up)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS(req)); return res.end() }
    if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url)
    if (url.pathname.startsWith('/auth/v1')) return await auth(req, res, url)
    if (url.pathname === '/functions/v1/sign-in' && req.method === 'POST') return await signInFunction(req, res)
    const svc = url.pathname.split('/')[1] || 'unknown'
    console.log(`[501] ${req.method} ${url.pathname}`)
    return send(req, res, 501, { message: `${svc} is not available in the local test stack`, error: 'not_implemented' })
  } catch (e) {
    console.error('[gateway error]', req.method, url.pathname, e.message)
    return send(req, res, 500, { message: 'gateway error' })
  }
})
// Realtime: there is no realtime server. Refuse the websocket upgrade plainly.
server.on('upgrade', (req, socket) => { socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n') })
server.listen(PORT, '127.0.0.1', () => console.log(`gateway on http://127.0.0.1:${PORT} -> postgrest ${PGRST}, db ${DB}`))
