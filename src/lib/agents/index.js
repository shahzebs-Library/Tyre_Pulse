// ─────────────────────────────────────────────────────────────────────────────
// agents/index.js — Agent registry and shared AI edge function caller
// All agents share this single callAiEdgeFunction to maintain consistency.
// ─────────────────────────────────────────────────────────────────────────────

export { runAnalystAgent }      from './analystAgent'
export { runTyreEngineerAgent } from './tyreEngineerAgent'
export { runQaDataAgent }       from './qaDataAgent'
export { runPlannerAgent }      from './plannerAgent'

/**
 * Invoke the Supabase Edge Function 'chat-ai'.
 * Single shared call point for all agents — standardises error handling,
 * model selection, and logging.
 *
 * Edge Function contract:
 *   Input:  { system: string, user: string, model: string, max_tokens?: number }
 *   Output: { content: string }
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {string} [model]
 * @param {number} [maxTokens]
 * @returns {Promise<string>} AI response text
 */
export async function callAiEdgeFunction(
  systemPrompt,
  userPrompt,
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 1500
) {
  const { supabase } = await import('../supabase')

  const { data, error } = await supabase.functions.invoke('chat-ai', {
    body: {
      system:     systemPrompt,
      user:       userPrompt,
      model,
      max_tokens: maxTokens,
    },
  })

  if (error) {
    console.error('[callAiEdgeFunction] Edge function error:', error)
    return 'Unable to generate AI response. Please check your connection and try again.'
  }

  if (!data?.content) {
    console.error('[callAiEdgeFunction] Empty response from edge function:', data)
    return 'The AI returned an empty response. Please try again.'
  }

  return data.content
}
