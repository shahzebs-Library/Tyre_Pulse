// Svix (Resend webhook) signature check. Uses WebCrypto only (Deno + Node 20+).
// Signed content: `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256 with the
// base64 secret after the "whsec_" prefix. The header may carry several
// space-separated "v1,<base64>" signatures (key rotation); any match passes.
export const SVIX_TOLERANCE_SECONDS = 300

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function svixSign(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', b64ToBytes(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  return bytesToB64(new Uint8Array(sig))
}

export async function verifySvix(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!secret) return { ok: false, reason: 'not configured' }
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing headers' }
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > SVIX_TOLERANCE_SECONDS) return { ok: false, reason: 'stale timestamp' }
  const expected = await svixSign(secret, id, timestamp, body)
  const match = signature.split(' ').some(part => {
    const [version, sig] = part.split(',')
    return version === 'v1' && !!sig && timingSafeEqual(sig, expected)
  })
  return match ? { ok: true } : { ok: false, reason: 'bad signature' }
}
