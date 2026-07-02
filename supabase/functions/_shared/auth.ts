import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type AppRole = 'admin' | 'manager' | 'director' | 'inspector' | 'tyre_man' | 'reporter'

type Profile = {
  id: string
  role: string | null
  approved: boolean | null
  locked?: boolean | null
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://tyrepulse.app',
  'https://www.tyrepulse.app',
  'http://localhost:5173',
  'http://localhost:5174',
]

// Any Vercel deployment of this app (stable production alias + the rotating
// per-push preview subdomains). Safe to allow broadly here because every
// function still enforces a valid, approved-user JWT via requireApprovedRole -
// the origin allowance alone grants no data access.
const VERCEL_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin) || VERCEL_ORIGIN.test(origin)
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const configured = Deno.env.get('ALLOWED_ORIGINS')
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const allowedOrigins = configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS

  return {
    'Access-Control-Allow-Origin': !origin || isOriginAllowed(origin, allowedOrigins) ? (origin ?? '*') : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

export function normaliseRole(raw: string | null | undefined): AppRole {
  const key = (raw ?? 'reporter').trim().toLowerCase().replace(/\s+/g, '_')
  return ['admin', 'manager', 'director', 'inspector', 'tyre_man', 'reporter'].includes(key)
    ? key as AppRole
    : 'reporter'
}

export async function requireApprovedRole(
  req: Request,
  allowedRoles: AppRole[],
): Promise<{ profile: Profile; role: AppRole } | Response> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace(/^Bearer\s+/i, '')
  if (!token) return jsonResponse(req, { error: 'Missing bearer token' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(req, { error: 'Supabase function environment is not configured' }, 500)
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError || !userData.user) return jsonResponse(req, { error: 'Invalid session' }, 401)

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, role, approved, locked')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (profileError || !profile) return jsonResponse(req, { error: 'Profile not found' }, 403)
  if (profile.approved === false || profile.locked === true) {
    return jsonResponse(req, { error: 'Account is not approved for this action' }, 403)
  }

  const role = normaliseRole(profile.role)
  if (!allowedRoles.includes(role)) {
    return jsonResponse(req, { error: 'Insufficient role for this action' }, 403)
  }

  return { profile, role }
}
