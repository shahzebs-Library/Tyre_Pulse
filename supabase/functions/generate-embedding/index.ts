import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, requireApprovedRole } from '../_shared/auth.ts'

// Per-model embedding price in USD per 1M tokens (input only — no completion side).
const EMBEDDING_PRICING: Record<string, number> = {
  'text-embedding-3-small': 0.02,
  'text-embedding-3-large': 0.13,
}

// Service-role client (bypasses RLS) used only for best-effort cost logging.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected into edge functions.
function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

function embeddingCostUsd(model: string, promptTokens: number): number {
  const rate = EMBEDDING_PRICING[model] ?? 0.02
  const cost = (promptTokens / 1_000_000) * rate
  return Math.round(cost * 1_000_000) / 1_000_000 // 6dp
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    const auth = await requireApprovedRole(req, ['admin', 'manager', 'director'])
    if (auth instanceof Response) return auth
    const userId = auth.profile.id

    const { text, model = 'text-embedding-3-small' } = await req.json()

    if (!text || typeof text !== 'string') {
      return jsonResponse(req, { error: 'Missing or invalid required field: text' }, 400)
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
    if (!OPENAI_API_KEY) {
      return jsonResponse(req, { error: 'OPENAI_API_KEY not configured' }, 500)
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text.slice(0, 8000),
        model,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${err}`)
    }

    const data = await response.json()
    const embedding = data.data?.[0]?.embedding

    if (!embedding) throw new Error('No embedding returned')

    // ── Best-effort cost logging for the AI Cost Monitor dashboard ────────────
    // Embeddings report usage.prompt_tokens (no completion side). Wrapped so a
    // logging failure can NEVER affect the user-facing embedding response.
    try {
      const svc = serviceClient()
      if (svc) {
        const promptTokens = Number(data.usage?.prompt_tokens ?? 0)
        svc.from('ai_token_logs').insert({
          user_id: userId,
          model,
          feature: 'embedding',
          prompt_tokens: promptTokens,
          completion_tokens: 0,
          cost_usd: embeddingCostUsd(model, promptTokens),
          created_at: new Date().toISOString(),
        }).then(({ error }) => {
          if (error) console.error('[generate-embedding] ai_token_logs insert failed:', error.message)
        })
      }
    } catch (e) {
      console.error('[generate-embedding] ai_token_logs insert threw (ignored):', e)
    }

    return jsonResponse(req, { embedding })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return jsonResponse(req, { error: message }, 500)
  }
})
