// ─────────────────────────────────────────────────────────────────────────────
// agents/index.js — Agent registry and shared AI caller
// Uses Anthropic SDK directly (same pattern as aiAnalytics.js).
// Falls back gracefully when API key is not configured.
// ─────────────────────────────────────────────────────────────────────────────
import Anthropic from '@anthropic-ai/sdk'

export { runAnalystAgent }      from './analystAgent'
export { runTyreEngineerAgent } from './tyreEngineerAgent'
export { runQaDataAgent }       from './qaDataAgent'
export { runPlannerAgent }      from './plannerAgent'

function getAnthropicClient() {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!key) throw new Error('VITE_ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
}

export async function callAiEdgeFunction(
  systemPrompt,
  userPrompt,
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 1500
) {
  try {
    const client = getAnthropicClient()
    const msg = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    return msg.content[0]?.text ?? 'No response generated.'
  } catch (err) {
    console.error('[callAiEdgeFunction] Error:', err)
    if (err.message?.includes('VITE_ANTHROPIC_API_KEY')) {
      return 'AI features require VITE_ANTHROPIC_API_KEY to be configured in your environment.'
    }
    return 'Unable to generate AI response. Please try again.'
  }
}

