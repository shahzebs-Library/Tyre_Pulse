// ─────────────────────────────────────────────────────────────────────────────
// agents/index.js — Agent registry and shared AI caller
// Routes all AI calls through the `chat-ai` Supabase Edge Function.
// API keys live server-side only — never exposed in the browser bundle.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../supabase'

export { runAnalystAgent }      from './analystAgent'
export { runTyreEngineerAgent } from './tyreEngineerAgent'
export { runQaDataAgent }       from './qaDataAgent'
export { runPlannerAgent }      from './plannerAgent'

export async function callAiEdgeFunction(
  systemPrompt,
  userPrompt,
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 1500
) {
  try {
    const { data, error } = await supabase.functions.invoke('chat-ai', {
      body: { system: systemPrompt, user: userPrompt, model, max_tokens: maxTokens },
    })
    if (error) throw error
    return data?.content ?? 'No response generated.'
  } catch (err) {
    console.error('[callAiEdgeFunction] Error:', err)
    return 'Unable to generate AI response. Please ensure the chat-ai Edge Function is deployed.'
  }
}

