// embed-worker - cron-driven auto-embedding for the Knowledge Base (V96).
//
// Invoked every 10 minutes by pg_cron with an `x-cron-secret` header (same
// gate as send-scheduled-reports: the secret lives in the service-role-only
// `cron_config` table, so a stray anon call is a 401).
//
// Embeds every knowledge_documents row where embedding IS NULL (imports, API
// inserts, manual adds that skipped the client-side indexer) using the same
// OpenAI model as generate-embedding, in one batched OpenAI call per sweep.
// Cost is logged to ai_token_logs (feature 'embedding-worker') exactly like
// the interactive path, and a logging failure never affects embedding work.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_PRICE_PER_1M = 0.02 // USD, input tokens only
const BATCH_LIMIT = 32              // rows per sweep; one OpenAI call
const MAX_CHARS = 8000              // per-input truncation (mirrors client)

type DocRow = { id: string; title: string | null; content: string | null }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'function environment not configured' }, 500)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Gate: only the DB cron job knows the secret.
  const given = req.headers.get('x-cron-secret') ?? ''
  const { data: cfg } = await svc.from('cron_config').select('value').eq('name', 'cron_secret').maybeSingle()
  if (!cfg?.value || given !== cfg.value) return json({ error: 'unauthorised' }, 401)

  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
  if (!OPENAI_API_KEY) {
    // Not an error state worth alerting every 10 minutes - embedding is
    // simply disabled until the secret is configured.
    return json({ embedded: 0, skipped: 'OPENAI_API_KEY not configured' })
  }

  const { data: rows, error: rowsErr } = await svc
    .from('knowledge_documents')
    .select('id,title,content')
    .is('embedding', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)
  if (rowsErr) return json({ error: `select failed: ${rowsErr.message}` }, 500)

  const docs = (rows ?? []).filter((r: DocRow) => (r.content ?? '').trim().length > 0)
  if (docs.length === 0) return json({ embedded: 0 })

  const inputs = docs.map((r: DocRow) =>
    `${(r.title ?? '').trim()}\n\n${(r.content ?? '').trim()}`.slice(0, MAX_CHARS)
  )

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: inputs, model: EMBEDDING_MODEL }),
  })
  if (!response.ok) {
    const err = await response.text()
    return json({ error: `OpenAI API error: ${response.status} ${err}` }, 502)
  }

  const data = await response.json()
  const embeddings: number[][] = (data.data ?? [])
    .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
    .map((d: { embedding: number[] }) => d.embedding)

  let embedded = 0
  const failures: string[] = []
  for (let i = 0; i < docs.length; i++) {
    const embedding = embeddings[i]
    if (!embedding) {
      failures.push(docs[i].id)
      continue
    }
    const { error: updErr } = await svc
      .from('knowledge_documents')
      .update({ embedding, updated_at: new Date().toISOString() })
      .eq('id', docs[i].id)
    if (updErr) failures.push(docs[i].id)
    else embedded++
  }

  // Best-effort cost logging (mirrors generate-embedding).
  try {
    const promptTokens = Number(data.usage?.prompt_tokens ?? 0)
    const cost = Math.round((promptTokens / 1_000_000) * EMBEDDING_PRICE_PER_1M * 1_000_000) / 1_000_000
    await svc.from('ai_token_logs').insert({
      user_id: null,
      model: EMBEDDING_MODEL,
      feature: 'embedding-worker',
      prompt_tokens: promptTokens,
      completion_tokens: 0,
      cost_usd: cost,
      created_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[embed-worker] ai_token_logs insert threw (ignored):', e)
  }

  return json({ embedded, failed: failures.length, failures })
})
