import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/auth.ts'

type Channel = 'email' | 'sms'
type Purpose = 'password_recovery' | 'contact_verification'

const CODE_TTL_MS = 10 * 60_000
const WINDOW_MS = 15 * 60_000
const MAX_REQUESTS = 5
const MAX_ATTEMPTS = 5
const encoder = new TextEncoder()

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

function env(name: string): string {
  return Deno.env.get(name)?.trim() || ''
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? '').trim().toLowerCase()
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function normalizePhone(value: unknown): string | null {
  const raw = String(value ?? '').trim().replace(/[\s().-]/g, '')
  const phone = raw.startsWith('00') ? `+${raw.slice(2)}` : raw
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return null
  return phone
}

function normalizeDestination(channel: Channel, value: unknown): string | null {
  return channel === 'email' ? normalizeEmail(value) : normalizePhone(value)
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1))
  return String(bytes[0] % 1_000_000).padStart(6, '0')
}

async function hmac(value: string): Promise<string> {
  const secret = env('RECOVERY_HMAC_SECRET')
  if (secret.length < 32) throw new Error('RECOVERY_HMAC_SECRET must be at least 32 characters')
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return diff === 0
}

function requesterKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || req.headers.get('cf-connecting-ip') || 'unknown'
}

async function sendEmail(to: string, code: string): Promise<void> {
  const apiKey = env('RESEND_API_KEY')
  const from = env('RECOVERY_EMAIL_FROM')
  if (!apiKey || !from) throw new Error('Recovery email provider is not configured')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your TyrePulse recovery code',
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2>TyrePulse account recovery</h2><p>Enter this code in TyrePulse:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, ignore this message.</p></div>`,
    }),
  })
  if (!response.ok) throw new Error(`Recovery email provider returned ${response.status}`)
}

async function sendSms(to: string, code: string): Promise<void> {
  const sid = env('TWILIO_ACCOUNT_SID')
  const token = env('TWILIO_AUTH_TOKEN')
  const from = env('TWILIO_FROM_NUMBER')
  if (!sid || !token || !from) throw new Error('Recovery SMS provider is not configured')
  const body = new URLSearchParams({ To: to, From: from, Body: `Your TyrePulse recovery code is ${code}. It expires in 10 minutes.` })
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!response.ok) throw new Error(`Recovery SMS provider returned ${response.status}`)
}

async function deliver(channel: Channel, destination: string, code: string): Promise<void> {
  if (channel === 'email') await sendEmail(destination, code)
  else await sendSms(destination, code)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return noStore(jsonResponse(req, { error: 'Method not allowed' }, 405))

  const supabaseUrl = env('SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return noStore(jsonResponse(req, { error: 'Recovery service unavailable' }, 503))
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return noStore(jsonResponse(req, { error: 'Invalid JSON' }, 400)) }
  const action = String(body.action ?? '')
  const channel = body.channel === 'sms' ? 'sms' : body.channel === 'email' ? 'email' : null

  try {
    if (action === 'request_recovery') {
      if (!channel) return noStore(jsonResponse(req, { error: 'Choose email or SMS' }, 400))
      const destination = normalizeDestination(channel, body.destination)
      if (!destination) return noStore(jsonResponse(req, { error: channel === 'email' ? 'Enter a valid email address' : 'Enter a mobile number in international format' }, 400))

      const requesterHash = await hmac(`requester:${requesterKey(req)}`)
      const destinationHash = await hmac(`destination:${channel}:${destination}`)
      // Opportunistic retention keeps codes and request metadata short-lived
      // even when no scheduled cleanup job is configured.
      await admin.from('password_recovery_challenges').delete().lt('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      const windowStart = new Date(Date.now() - WINDOW_MS).toISOString()
      const { count } = await admin.from('password_recovery_challenges')
        .select('id', { count: 'exact', head: true })
        .or(`requester_hash.eq.${requesterHash},destination_hash.eq.${destinationHash}`)
        .gte('created_at', windowStart)
      if ((count ?? 0) >= MAX_REQUESTS) {
        return noStore(jsonResponse(req, { accepted: true, retryAfterSeconds: 900 }, 202))
      }

      const column = channel === 'email' ? 'recovery_email' : 'recovery_phone'
      const verifiedColumn = channel === 'email' ? 'recovery_email_verified_at' : 'recovery_phone_verified_at'
      const { data: profile } = await admin.from('profiles')
        .select(`id,approved,locked,${column},${verifiedColumn}`).eq(column, destination).maybeSingle()
      const eligible = profile?.approved === true && profile?.locked !== true && Boolean(profile?.[verifiedColumn])
      const challengeId = crypto.randomUUID()
      const code = randomCode()
      const codeHash = await hmac(`code:${challengeId}:${destinationHash}:${code}`)
      const { error: insertError } = await admin.from('password_recovery_challenges').insert({
        id: challengeId,
        user_id: eligible ? profile.id : null,
        purpose: 'password_recovery' satisfies Purpose,
        channel,
        destination_hash: destinationHash,
        code_hash: codeHash,
        requester_hash: requesterHash,
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      })
      if (insertError) throw insertError

      if (eligible) {
        try { await deliver(channel, destination, code) }
        catch (deliveryError) {
          console.error('account-recovery delivery failed', deliveryError)
          await admin.from('password_recovery_challenges').delete().eq('id', challengeId)
        }
      }
      // Identical public response for known, unknown, unverified, locked and
      // delivery-failed destinations prevents account enumeration.
      return noStore(jsonResponse(req, { accepted: true, challengeId }, 202))
    }

    if (action === 'verify_recovery') {
      if (!channel) return noStore(jsonResponse(req, { error: 'Choose email or SMS' }, 400))
      const destination = normalizeDestination(channel, body.destination)
      const challengeId = String(body.challengeId ?? '')
      const code = String(body.code ?? '').trim()
      if (!destination || !/^[0-9]{6}$/.test(code) || !/^[0-9a-f-]{36}$/i.test(challengeId)) {
        return noStore(jsonResponse(req, { error: 'The code is invalid or expired' }, 400))
      }
      const { data: challenge } = await admin.from('password_recovery_challenges').select('*').eq('id', challengeId).maybeSingle()
      if (!challenge || challenge.purpose !== 'password_recovery' || challenge.channel !== channel || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= MAX_ATTEMPTS) {
        return noStore(jsonResponse(req, { error: 'The code is invalid or expired' }, 400))
      }
      await admin.from('password_recovery_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challengeId).is('consumed_at', null)
      const destinationHash = await hmac(`destination:${channel}:${destination}`)
      const expected = await hmac(`code:${challengeId}:${destinationHash}:${code}`)
      if (!challenge.user_id || !safeEqual(destinationHash, challenge.destination_hash) || !safeEqual(expected, challenge.code_hash)) {
        return noStore(jsonResponse(req, { error: 'The code is invalid or expired' }, 400))
      }
      const consumedAt = new Date().toISOString()
      const { data: consumed } = await admin.from('password_recovery_challenges')
        .update({ consumed_at: consumedAt }).eq('id', challengeId).is('consumed_at', null).select('id').maybeSingle()
      if (!consumed) return noStore(jsonResponse(req, { error: 'The code is invalid or expired' }, 400))

      const { data: userResult, error: userError } = await admin.auth.admin.getUserById(challenge.user_id)
      const email = userResult?.user?.email
      if (userError || !email) return noStore(jsonResponse(req, { error: 'Recovery is unavailable for this account' }, 400))
      const appUrl = env('APP_URL').replace(/\/$/, '')
      if (!/^https:\/\//.test(appUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(appUrl)) throw new Error('APP_URL is not configured safely')
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${appUrl}/reset-password` },
      })
      if (linkError || !link?.properties?.action_link) throw linkError || new Error('Recovery link was not generated')
      return noStore(jsonResponse(req, { verified: true, actionLink: link.properties.action_link }))
    }

    if (action === 'request_contact' || action === 'verify_contact' || action === 'contact_status' || action === 'remove_contact') {
      const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
      if (!token) return noStore(jsonResponse(req, { error: 'Sign in first' }, 401))
      const { data: authData, error: authError } = await admin.auth.getUser(token)
      if (authError || !authData.user) return noStore(jsonResponse(req, { error: 'Invalid session' }, 401))
      const userId = authData.user.id

      if (action === 'contact_status') {
        const { data: profile } = await admin.from('profiles')
          .select('recovery_email,recovery_email_verified_at,recovery_phone,recovery_phone_verified_at').eq('id', userId).single()
        return noStore(jsonResponse(req, { contacts: profile ?? {} }))
      }

      if (!channel) return noStore(jsonResponse(req, { error: 'Choose email or SMS' }, 400))

      if (action === 'remove_contact') {
        const field = channel === 'email' ? 'recovery_email' : 'recovery_phone'
        const verifiedField = channel === 'email' ? 'recovery_email_verified_at' : 'recovery_phone_verified_at'
        const { error: removeError } = await admin.from('profiles').update({ [field]: null, [verifiedField]: null }).eq('id', userId)
        if (removeError) throw removeError
        return noStore(jsonResponse(req, { removed: true }))
      }

      const destination = normalizeDestination(channel, body.destination)
      if (!destination) return noStore(jsonResponse(req, { error: channel === 'email' ? 'Enter a valid email address' : 'Enter a mobile number in international format' }, 400))

      if (action === 'request_contact') {
        const requesterHash = await hmac(`user:${userId}`)
        const windowStart = new Date(Date.now() - WINDOW_MS).toISOString()
        const { count } = await admin.from('password_recovery_challenges')
          .select('id', { count: 'exact', head: true }).eq('requester_hash', requesterHash).gte('created_at', windowStart)
        if ((count ?? 0) >= MAX_REQUESTS) return noStore(jsonResponse(req, { error: 'Too many requests. Try again in 15 minutes.' }, 429))
        const challengeId = crypto.randomUUID()
        const code = randomCode()
        const destinationHash = await hmac(`destination:${channel}:${destination}`)
        const codeHash = await hmac(`code:${challengeId}:${destinationHash}:${code}`)
        const { error: insertError } = await admin.from('password_recovery_challenges').insert({
          id: challengeId, user_id: userId, purpose: 'contact_verification' satisfies Purpose, channel,
          destination_hash: destinationHash, code_hash: codeHash, requester_hash: requesterHash,
          expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        })
        if (insertError) throw insertError
        try { await deliver(channel, destination, code) }
        catch (deliveryError) {
          await admin.from('password_recovery_challenges').delete().eq('id', challengeId)
          console.error('account-recovery contact delivery failed', deliveryError)
          return noStore(jsonResponse(req, { error: `${channel === 'email' ? 'Email' : 'SMS'} delivery is not configured or failed` }, 503))
        }
        return noStore(jsonResponse(req, { accepted: true, challengeId }, 202))
      }

      const challengeId = String(body.challengeId ?? '')
      const code = String(body.code ?? '').trim()
      const { data: challenge } = await admin.from('password_recovery_challenges').select('*').eq('id', challengeId).maybeSingle()
      if (!challenge || challenge.user_id !== userId || challenge.purpose !== 'contact_verification' || challenge.channel !== channel || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now() || challenge.attempts >= MAX_ATTEMPTS || !/^[0-9]{6}$/.test(code)) {
        return noStore(jsonResponse(req, { error: 'The code is invalid or expired' }, 400))
      }
      await admin.from('password_recovery_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challengeId).is('consumed_at', null)
      const destinationHash = await hmac(`destination:${channel}:${destination}`)
      const expected = await hmac(`code:${challengeId}:${destinationHash}:${code}`)
      if (!safeEqual(destinationHash, challenge.destination_hash) || !safeEqual(expected, challenge.code_hash)) {
        return noStore(jsonResponse(req, { error: 'The code is invalid or expired' }, 400))
      }
      const field = channel === 'email' ? 'recovery_email' : 'recovery_phone'
      const verifiedField = channel === 'email' ? 'recovery_email_verified_at' : 'recovery_phone_verified_at'
      const { error: profileError } = await admin.from('profiles').update({ [field]: destination, [verifiedField]: new Date().toISOString() }).eq('id', userId)
      if (profileError) {
        const conflict = profileError.code === '23505'
        return noStore(jsonResponse(req, { error: conflict ? 'That recovery contact is already used by another account' : 'Could not save the recovery contact' }, conflict ? 409 : 500))
      }
      await admin.from('password_recovery_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', challengeId).is('consumed_at', null)
      return noStore(jsonResponse(req, { verified: true }))
    }

    return noStore(jsonResponse(req, { error: 'Unknown action' }, 400))
  } catch (error) {
    console.error('account-recovery error', error)
    return noStore(jsonResponse(req, { error: 'Recovery service unavailable' }, 503))
  }
})
