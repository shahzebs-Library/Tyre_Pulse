/**
 * AI Orchestrator client - the frontend boundary for the `ai-orchestrator`
 * edge function (V99 server-side copilot memory). Sends turns to the
 * router/multi-agent orchestrator and reads the durable, owner-private
 * `ai_conversations` / `ai_messages` history that RLS scopes to the signed-in
 * user. Explicit column lists (no SELECT *); Supabase failures surface as
 * ServiceError via the shared unwrap.
 */
import { supabase } from './supabase'
import { unwrap } from './api/_client'

// ai_conversations columns for the thread sidebar. Omits user_id /
// organisation_id (RLS-scoped, never rendered).
const CONVERSATION_COLS = 'id,title,agent,archived,created_at,updated_at'

// ai_messages columns for the transcript. Omits token accounting columns
// (tokens_in / tokens_out - server-side cost telemetry only).
const MESSAGE_COLS = 'id,role,content,tool_name,created_at'

/**
 * Send one user turn to the ai-orchestrator edge function. The orchestrator
 * routes to an agent, persists both turns, and (when conversationId is null)
 * creates the conversation - always thread the returned conversation_id into
 * the next call.
 *
 * @param {object} opts
 * @param {string} opts.message                  the user's message
 * @param {string|null} [opts.conversationId]    existing thread id, or null to start one
 * @param {string} [opts.agent='auto']           'auto'|'analyst'|'tyre_engineer'|'qa_data'|'planner'
 * @returns {Promise<{content:string, conversation_id:string, tool_calls?:Array<object>}>}
 */
export async function sendOrchestratorMessage({ message, conversationId = null, agent = 'auto' } = {}) {
  return unwrap(
    await supabase.functions.invoke('ai-orchestrator', {
      body: { message, conversation_id: conversationId, agent },
    })
  )
}

/**
 * List the signed-in user's active (non-archived) conversations, most
 * recently updated first.
 * @param {{limit?: number}} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function listConversations({ limit = 30 } = {}) {
  return unwrap(
    await supabase
      .from('ai_conversations')
      .select(CONVERSATION_COLS)
      .eq('archived', false)
      .order('updated_at', { ascending: false })
      .limit(limit)
  )
}

/**
 * Full transcript of one conversation in turn order (user / assistant / tool).
 * @param {string} conversationId
 * @returns {Promise<Array<object>>}
 */
export async function listConversationMessages(conversationId) {
  return unwrap(
    await supabase
      .from('ai_messages')
      .select(MESSAGE_COLS)
      .eq('conversation_id', conversationId)
      .order('id', { ascending: true })
  )
}

/**
 * Archive a conversation (soft-hide from the sidebar; history is retained).
 * @param {string} id
 */
export async function archiveConversation(id) {
  return unwrap(await supabase.from('ai_conversations').update({ archived: true }).eq('id', id))
}
