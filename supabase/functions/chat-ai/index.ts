import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse, requireApprovedRole } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    const auth = await requireApprovedRole(req, ['admin', 'manager', 'director'])
    if (auth instanceof Response) return auth

    const body = await req.json()
    const { system, user, messages, max_tokens = 2000 } = body
    // Model is locked server-side — never accept client-supplied value
    const MODEL = 'claude-haiku-4-5-20251001'
    const safeMaxTokens = Math.min(Math.max(Number(max_tokens) || 1000, 1), 2000)

    // Support both single-turn (user string) and multi-turn (messages array)
    const messageArray = messages && Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: user ?? '' }]

    if (!messageArray.length || !messageArray[messageArray.length - 1]?.content) {
      return jsonResponse(req, { error: 'Missing message content' }, 400)
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      console.error('[chat-ai] ANTHROPIC_API_KEY not configured')
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
      return jsonResponse(req, { error: 'AI service temporarily unavailable' }, 502)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text ?? ''

    return jsonResponse(req, { content })
  } catch (err) {
    console.error('[chat-ai] Unhandled error:', err)
    return jsonResponse(req, { error: 'AI service temporarily unavailable' }, 500)
  }
})
