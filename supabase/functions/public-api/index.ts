// public-api - versioned read-only REST API for external integrations (V97).
//
// Auth: `x-api-key` header carrying a key minted by create_api_key(). The key
// is validated (sha256 lookup, active/expiry check) and rate-limited per
// minute by the api_key_authenticate RPC - this function never sees key
// hashes or does its own counting. Every query is hard-scoped to the key's
// organisation_id, so a key can only ever read its own tenant's rows.
//
// Deploy with verify_jwt=false (callers are external systems, not Supabase
// sessions); the API key IS the credential.
//
// Routes (GET, JSON):
//   /public-api/v1/vehicles      - vehicle_fleet
//   /public-api/v1/tyres         - tyre_records
//   /public-api/v1/inspections   - inspections
//   /public-api/v1/work-orders   - work_orders
//   /public-api/v1/accidents     - accidents
//   /public-api/v1/events        - domain_events (integration event feed)
// Query params: limit (<=100), offset, site, asset_no, since (ISO date,
// filters created_at >=). Responses: { data, pagination } + X-RateLimit-Remaining.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Resource = {
  table: string
  columns: string
  orderBy: string
  filters: {
    site?: string      // column name for ?site=
    asset?: string     // column name for ?asset_no=
    since?: string     // column name for ?since=
  }
}

// Least-privilege column allowlists - no uploader ids, no internal batch ids.
const RESOURCES: Record<string, Resource> = {
  'vehicles': {
    table: 'vehicle_fleet',
    columns: 'id,asset_no,site,country,region,vehicle_type,make,model,status,created_at',
    orderBy: 'created_at',
    filters: { site: 'site', asset: 'asset_no', since: 'created_at' },
  },
  'tyres': {
    table: 'tyre_records',
    columns: 'id,asset_no,site,country,region,brand,serial_no,position,category,risk_level,qty,cost_per_tyre,issue_date,km_at_fitment,km_at_removal,created_at',
    orderBy: 'created_at',
    filters: { site: 'site', asset: 'asset_no', since: 'created_at' },
  },
  'inspections': {
    table: 'inspections',
    columns: 'id,asset_no,site,country,region,inspection_type,status,scheduled_date,completed_date,inspector_name,tread_depth,pressure_reading,findings,created_at',
    orderBy: 'created_at',
    filters: { site: 'site', asset: 'asset_no', since: 'created_at' },
  },
  'work-orders': {
    table: 'work_orders',
    columns: 'id,asset_no,site,status,description,total_cost,created_at',
    orderBy: 'created_at',
    filters: { site: 'site', asset: 'asset_no', since: 'created_at' },
  },
  'accidents': {
    table: 'accidents',
    columns: 'id,asset_no,site,severity,status,closure_status,accident_date,description,created_at',
    orderBy: 'created_at',
    filters: { site: 'site', asset: 'asset_no', since: 'created_at' },
  },
  'events': {
    table: 'domain_events',
    columns: 'id,event_type,entity_type,entity_id,payload,created_at',
    orderBy: 'id',
    filters: { since: 'created_at' },
  },
}

const HEADERS = {
  'Content-Type': 'application/json',
  // NOTE: public-api authenticates with server-to-server API keys (X-API-Key),
  // NOT user sessions. These keys must NEVER be embedded in a browser / SPA —
  // doing so would expose the key to any site the browser visits. The '*' CORS
  // origin is intentional and safe ONLY because this endpoint is designed for
  // trusted backend-to-backend callers, where CORS does not apply.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: HEADERS })
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'not_configured' }, 500)
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ── Authenticate + rate limit ────────────────────────────────────────────
  const apiKey = req.headers.get('x-api-key') ?? ''
  if (!apiKey) return json({ error: 'missing_api_key' }, 401)

  const { data: auth, error: authErr } = await svc.rpc('api_key_authenticate', { p_key: apiKey })
  if (authErr) return json({ error: 'auth_failed' }, 500)
  if (!auth?.ok) {
    return auth?.error === 'rate_limited'
      ? json({ error: 'rate_limited', limit: auth.limit }, 429)
      : json({ error: 'invalid_api_key' }, 401)
  }
  const orgId: string = auth.organisation_id
  const remaining = String(auth.remaining ?? '')

  // ── Route ────────────────────────────────────────────────────────────────
  // Path: /public-api/v1/<resource>
  const parts = new URL(req.url).pathname.split('/').filter(Boolean)
  const fnIdx = parts.indexOf('public-api')
  const version = parts[fnIdx + 1]
  const resourceKey = parts[fnIdx + 2]

  if (version !== 'v1') return json({ error: 'unknown_version', supported: ['v1'] }, 404)
  const resource = RESOURCES[resourceKey ?? '']
  if (!resource) {
    return json({ error: 'unknown_resource', resources: Object.keys(RESOURCES) }, 404)
  }

  // ── Query ────────────────────────────────────────────────────────────────
  const params = new URL(req.url).searchParams
  const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '25', 10) || 25, 1), 100)
  const offset = Math.max(parseInt(params.get('offset') ?? '0', 10) || 0, 0)

  let q = svc
    .from(resource.table)
    .select(resource.columns, { count: 'exact' })
    .eq('organisation_id', orgId)
    .order(resource.orderBy, { ascending: false })
    .range(offset, offset + limit - 1)

  const site = params.get('site')
  if (site && resource.filters.site) q = q.eq(resource.filters.site, site)
  const asset = params.get('asset_no')
  if (asset && resource.filters.asset) q = q.eq(resource.filters.asset, asset)
  const since = params.get('since')
  if (since && resource.filters.since) {
    const d = new Date(since)
    if (isNaN(d.getTime())) return json({ error: 'invalid_since' }, 400)
    q = q.gte(resource.filters.since, d.toISOString())
  }

  const { data, count, error } = await q
  if (error) {
    console.error(`[public-api] ${resource.table} query failed:`, error.message)
    return json({ error: 'query_failed' }, 500)
  }

  return json(
    { data: data ?? [], pagination: { limit, offset, total: count ?? 0 } },
    200,
    { 'X-RateLimit-Remaining': remaining },
  )
})
