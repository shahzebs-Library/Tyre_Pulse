// Minimal HS256 JWT sign/verify with node:crypto. Test harness only.
import crypto from 'node:crypto'
const b64 = (b) => Buffer.from(b).toString('base64url')
export function sign(payload, secret) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}
export function verify(token, secret) {
  const [h, p, s] = String(token || '').split('.')
  if (!h || !p || !s) return null
  const want = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  const a = Buffer.from(s), b = Buffer.from(want)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    if (payload.exp && payload.exp < Date.now() / 1000) return null
    return payload
  } catch { return null }
}
