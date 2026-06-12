import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { system, user, messages, model = 'claude-haiku-4-5-20251001', max_tokens = 2000 } = body

    // Support both single-turn (user string) and multi-turn (messages array)
    const messageArray = messages && Array.isArray(messages) && messages.length > 0
      ? messages
      : [{ role: 'user', content: user ?? '' }]

    if (!messageArray.length || !messageArray[messageArray.length - 1]?.content) {
      return new Response(JSON.stringify({ error: 'Missing message content' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens,
        ...(system ? { system } : {}),
        messages: messageArray,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`API error: ${response.status} ${err}`)
    }

    const data = await response.json()
    const content = data.content?.[0]?.text ?? ''

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
