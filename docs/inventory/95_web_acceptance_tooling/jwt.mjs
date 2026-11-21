import crypto from 'node:crypto'
export const SECRET = 'qa-acceptance-local-secret-0123456789abcdef-not-production'
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
export function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload)
  const s = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url')
  return `${h}.${p}.${s}`
}
export function decode(t) { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()) } catch { return null } }
export const ANON = sign({ role: 'anon', iss: 'supabase', iat: 1795000000, exp: 1900000000 })
export const USERS = {
  admin: 'a0000000-0000-4000-8000-000000000001', manager: 'a0000000-0000-4000-8000-000000000002',
  storekeeper: 'a0000000-0000-4000-8000-000000000003', invctl: 'a0000000-0000-4000-8000-000000000004',
  finance: 'a0000000-0000-4000-8000-000000000005', pmv: 'a0000000-0000-4000-8000-000000000006',
  otherco: 'a0000000-0000-4000-8000-000000000007',
}
export function userObj(id, email) {
  return { id, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: '2026-11-20T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, factors: [], identities: [],
    created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', is_anonymous: false }
}
export function session(name) {
  const id = USERS[name], email = `qa.${name}@example.invalid`, now = Math.floor(Date.now() / 1000)
  const exp = now + 8 * 3600
  const access_token = sign({ sub: id, role: 'authenticated', aud: 'authenticated', email, aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }], session_id: crypto.randomUUID(), iat: now, exp, iss: 'http://localhost:54321/auth/v1' })
  return { access_token, refresh_token: 'rt-' + name, token_type: 'bearer', expires_in: 8 * 3600, expires_at: exp, user: userObj(id, email) }
}
