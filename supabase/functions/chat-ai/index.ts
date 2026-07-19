import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, requireApprovedRole } from '../_shared/auth.ts'

// Model is locked server-side - never accept a client-supplied value
const MODEL = 'claude-haiku-4-5-20251001'
// Base model id (without date suffix) logged to ai_token_logs so it matches the
// rate table the AI Cost Monitor dashboard uses for cost estimation.
const MODEL_BASE = 'claude-haiku-4-5'

// Per-model price in USD per 1M tokens (input / output). Used for cost tracking.
const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
}

// Cache + rate-limit tunables (env-overridable)
const CACHE_TTL_SECONDS = Number(Deno.env.get('AI_CACHE_TTL_SECONDS') ?? '300')        // 5 min
const RL_PER_MIN        = Number(Deno.env.get('AI_RATE_LIMIT_PER_MIN') ?? '20')
const RL_PER_DAY        = Number(Deno.env.get('AI_RATE_LIMIT_PER_DAY') ?? '500')

// Service-role client (bypasses RLS) for usage logging, caching and rate-limiting.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected into edge functions.
function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── System Configuration (console System Configuration page) ─────────────────
// Read the global AI controls so the admin switches are REAL: master enable,
// per-minute rate limit, cache TTL and the monthly budget cap. Fail-SAFE: any
// read error keeps AI enabled with the env/default limits (never hard-off).
async function loadAiConfig(svc: ReturnType<typeof serviceClient>): Promise<{
  enabled: boolean; ratePerMin: number; cacheTtlSec: number; monthlyBudget: number;
}> {
  const dflt = { enabled: true, ratePerMin: RL_PER_MIN, cacheTtlSec: CACHE_TTL_SECONDS, monthlyBudget: 0 }
  if (!svc) return dflt
  try {
    const { data } = await svc.from('system_config').select('key, value')
      .in('key', ['ai_enabled', 'ai_rate_limit_per_min', 'ai_cache_ttl_hours', 'ai_monthly_budget_usd'])
    const m: Record<string, string> = {}
    for (const r of data ?? []) m[r.key] = String(r.value ?? '')
    const num = (k: string, d: number) => {
      const n = Number(m[k]); return Number.isFinite(n) && n > 0 ? n : d
    }
    return {
      enabled: !(m.ai_enabled && ['false', '0', 'off', 'no'].includes(m.ai_enabled.trim().toLowerCase())),
      ratePerMin: num('ai_rate_limit_per_min', RL_PER_MIN),
      cacheTtlSec: m.ai_cache_ttl_hours ? num('ai_cache_ttl_hours', CACHE_TTL_SECONDS / 3600) * 3600 : CACHE_TTL_SECONDS,
      monthlyBudget: num('ai_monthly_budget_usd', 0),
    }
  } catch {
    return dflt
  }
}

// Current-month AI spend (USD) across ai_token_logs, for the budget guard.
async function monthSpendUsd(svc: ReturnType<typeof serviceClient>): Promise<number> {
  if (!svc) return 0
  try {
    const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0)
    const { data } = await svc.from('ai_token_logs').select('cost_usd').gte('created_at', start.toISOString())
    let sum = 0
    for (const r of data ?? []) sum += Number(r.cost_usd) || 0
    return sum
  } catch {
    return 0
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model] ?? { in: 1.0, out: 5.0 }
  const cost = (inputTokens / 1_000_000) * p.in + (outputTokens / 1_000_000) * p.out
  return Math.round(cost * 1_000_000) / 1_000_000 // 6dp
}

// Best-effort failure log so the Admin Console can surface failed AI requests.
// Never throws; a logging failure must not affect the user-facing response.
function logAiFailure(
  svc: ReturnType<typeof serviceClient>,
  opts: { userId?: string | null; status: string; httpStatus: number; error: string },
): void {
  if (!svc) return
  try {
    svc.from('ai_token_logs').insert({
      user_id: opts.userId ?? null,
      model: MODEL_BASE,
      feature: 'chat',
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: 0,
      status: opts.status,
      http_status: opts.httpStatus,
      error: String(opts.error ?? '').slice(0, 500),
      created_at: new Date().toISOString(),
    }).then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error('[chat-ai] failure log insert failed:', error.message)
    })
  } catch (e) {
    console.error('[chat-ai] failure log threw (ignored):', e)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  let _uid: string | null = null
  try {
    const auth = await requireApprovedRole(req, ['admin', 'manager', 'director'])
    if (auth instanceof Response) return auth
    const userId = auth.profile.id
    _uid = userId

    const body = await req.json()
    const { system, user, messages, max_tokens = 2000 } = body
    const agent  = typeof body.agent === 'string' ? body.agent.slice(0, 60) : 'chat'
    const source = typeof body.source === 'string' ? body.source.slice(0, 30) : 'app'
    const country = typeof body.country === 'string' ? body.country.slice(0, 10) : null
    const site    = typeof body.site === 'string' ? body.site.slice(0, 200) : null
    const safeMaxTokens = Math.min(Math.max(Number(max_tokens) || 1000, 1), 2000)

    // Support both single-turn (user string) and multi-turn (messages array)
    const messageArray = messages && Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: user ?? '' }]

    if (!messageArray.length || !messageArray[messageArray.length - 1]?.content) {
      return jsonResponse(req, { error: 'Missing message content' }, 400)
    }

    const svc = serviceClient()
    const nowMs = Date.now()

    // ── Global AI controls (System Configuration) ─────────────────────────────
    const aiCfg = await loadAiConfig(svc)
    if (!aiCfg.enabled) {
      logAiFailure(svc, { userId, status: 'blocked', httpStatus: 403, error: 'AI disabled by admin' })
      return jsonResponse(req, { error: 'AI features are currently disabled by your administrator.' }, 403)
    }
    // Monthly budget cap (0 = uncapped). Global across the platform.
    if (aiCfg.monthlyBudget > 0) {
      const spend = await monthSpendUsd(svc)
      if (spend >= aiCfg.monthlyBudget) {
        logAiFailure(svc, { userId, status: 'blocked', httpStatus: 402, error: `Monthly AI budget reached (${spend.toFixed(2)}/${aiCfg.monthlyBudget})` })
        return jsonResponse(req, { error: 'The monthly AI budget has been reached. Please contact your administrator.' }, 402)
      }
    }

    // ── Per-user rate limiting (per-minute cap from System Configuration) ─────
    if (svc) {
      try {
        const sinceMin = new Date(nowMs - 60_000).toISOString()
        const sinceDay = new Date(nowMs - 86_400_000).toISOString()
        const [{ count: perMin }, { count: perDay }] = await Promise.all([
          svc.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceMin),
          svc.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', sinceDay),
        ])
        if ((perMin ?? 0) >= aiCfg.ratePerMin || (perDay ?? 0) >= RL_PER_DAY) {
          logAiFailure(svc, { userId, status: 'rate_limited', httpStatus: 429, error: 'Rate limit exceeded' })
          return jsonResponse(req, { error: 'Rate limit exceeded. Please wait before sending more AI requests.' }, 429)
        }
      } catch (e) {
        console.error('[chat-ai] rate-limit check failed (allowing request):', e)
      }
    }

    // ── Response cache (keyed by tenant + model + system + messages) ──────────
    // Tenant scope (userId) is folded into the hash so cached completions can
    // never be served across a user/org boundary.
    const cacheKey = await sha256Hex(`${userId}\n${MODEL}\n${system ?? ''}\n${JSON.stringify(messageArray)}`)
    if (svc) {
      try {
        const { data: hit } = await svc
          .from('ai_response_cache')
          .select('response, expires_at')
          .eq('query_hash', cacheKey)
          .gt('expires_at', new Date(nowMs).toISOString())
          .maybeSingle()
        if (hit?.response) {
          return jsonResponse(req, { content: hit.response, cached: true })
        }
      } catch (e) {
        console.error('[chat-ai] cache lookup failed (continuing):', e)
      }
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      console.error('[chat-ai] ANTHROPIC_API_KEY not configured')
      logAiFailure(svc, { userId, status: 'error', httpStatus: 500, error: 'ANTHROPIC_API_KEY not configured' })
      return jsonResponse(req, { error: 'AI service temporarily unavailable' }, 500)
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: safeMaxTokens,
        ...(system ? { system } : {}),
        messages: messageArray,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[chat-ai] Upstream API error ${response.status}:`, errText)
      logAiFailure(svc, { userId, status: 'error', httpStatus: 502, error: `Upstream ${response.status}: ${errText.slice(0, 200)}` })
      return jsonResponse(req, { error: 'AI service temporarily unavailable' }, 502)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text ?? ''
    const inputTokens  = Number(data.usage?.input_tokens ?? 0)
    const outputTokens = Number(data.usage?.output_tokens ?? 0)

    // ── Best-effort usage logging + cache store (never block the response) ────
    if (svc) {
      const usageRow = {
        user_id: userId,
        agent,
        model: MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cost_usd: costUsd(MODEL, inputTokens, outputTokens),
        country,
        site,
        source,
        created_at: new Date(nowMs).toISOString(),
      }
      svc.from('ai_usage_log').insert(usageRow).then(({ error }) => {
        if (error) console.error('[chat-ai] usage log insert failed:', error.message)
      })

      // AI Cost Monitor dashboard reads ai_token_logs. Fire-and-forget insert -
      // wrapped so a logging failure can NEVER affect the user-facing response.
      try {
        svc.from('ai_token_logs').insert({
          user_id: userId,
          model: MODEL_BASE,
          feature: 'chat',
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          cost_usd: costUsd(MODEL, inputTokens, outputTokens),
          site,
          country,
          created_at: new Date(nowMs).toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[chat-ai] ai_token_logs insert failed:', error.message)
        })
      } catch (e) {
        console.error('[chat-ai] ai_token_logs insert threw (ignored):', e)
      }
      if (content) {
        svc.from('ai_response_cache').upsert({
          query_hash: cacheKey,
          query_text: (messageArray[messageArray.length - 1]?.content ?? '').toString().slice(0, 2000),
          response: content,
          tokens_used: inputTokens + outputTokens,
          model: MODEL,
          created_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + aiCfg.cacheTtlSec * 1000).toISOString(),
        }, { onConflict: 'query_hash' }).then(({ error }) => {
          if (error) console.error('[chat-ai] cache store failed:', error.message)
        })
      }
    }

    return jsonResponse(req, { content })
  } catch (err) {
    console.error('[chat-ai] Unhandled error:', err)
    logAiFailure(serviceClient(), { userId: _uid, status: 'error', httpStatus: 500, error: err instanceof Error ? err.message : String(err) })
    return jsonResponse(req, { error: 'AI service temporarily unavailable' }, 500)
  }
})
