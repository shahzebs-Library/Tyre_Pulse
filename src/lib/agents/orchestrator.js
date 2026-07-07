// ─────────────────────────────────────────────────────────────────────────────
// orchestrator.js — multi-agent orchestration for the TyrePulse AI OS.
//
// The single-agent router (aiRouter.classifyQuery) picks ONE specialist. This
// orchestrator handles cross-domain questions the way a small agent graph would:
//   1. classifyQueryMulti → the set of relevant specialist agents (primary first)
//   2. run them (in parallel — they read shared read-only context, no ordering)
//   3. if more than one contributed, a synthesis node (Executive Assistant) fuses
//      their outputs into one coherent answer via the chat-ai edge function
//
// Dependency-free (no LangGraph runtime): the graph here is small and static, so
// plain fan-out + a reduce/synthesis step is the right, testable shape. The pure
// pieces (buildSynthesisPrompt) are unit-tested; the async runner takes its
// runners + aiCaller by injection so it can be tested without the network.
// ─────────────────────────────────────────────────────────────────────────────
import { classifyQueryMulti, AGENT_LABELS, AGENT_TYPES } from '../aiRouter'
import {
  runAnalystAgent, runTyreEngineerAgent, runQaDataAgent, runPlannerAgent,
  callAiEdgeFunction,
} from './index'

/** Default wiring: agent type → its runner. */
export const AGENT_RUNNERS = {
  [AGENT_TYPES.ANALYST]:       runAnalystAgent,
  [AGENT_TYPES.TYRE_ENGINEER]: runTyreEngineerAgent,
  [AGENT_TYPES.QA_DATA]:       runQaDataAgent,
  [AGENT_TYPES.PLANNER]:       runPlannerAgent,
}

const SYNTHESIS_SYSTEM =
  'You are the Tyre Pulse Executive Assistant. Several specialist agents have ' +
  'each answered part of a fleet manager\'s question. Fuse their findings into ' +
  'ONE concise, non-repetitive answer. Lead with the direct answer, then the ' +
  'supporting detail, then a short prioritized action list. Do not invent data ' +
  'beyond what the specialists provided; if they disagree, say so.'

/**
 * Build the synthesis user-prompt from each contributing agent's answer.
 * Pure + unit-tested.
 * @param {string} query
 * @param {Array<{agentType:string, response:string}>} contributions
 * @returns {string}
 */
export function buildSynthesisPrompt(query, contributions) {
  const blocks = (contributions || [])
    .filter(c => c && c.response)
    .map(c => `## ${AGENT_LABELS[c.agentType] || c.agentType} agent\n${c.response}`)
    .join('\n\n')
  return `Fleet manager's question:\n"${query}"\n\nSpecialist findings:\n\n${blocks}\n\n` +
    'Now produce the unified executive answer.'
}

/**
 * Run the orchestration graph for a query.
 *
 * @param {string} query
 * @param {object} context   shared read-only context passed to every agent
 * @param {object} [opts]
 * @param {object} [opts.runners]  agent type → runner (defaults to AGENT_RUNNERS)
 * @param {Function} [opts.aiCaller] (system, user) → Promise<string> for synthesis
 * @returns {Promise<{agentType, agents, response, synthesized, contributions, ...primaryData}>}
 */
export async function runOrchestration(query, context = {}, opts = {}) {
  const runners = opts.runners || AGENT_RUNNERS
  const aiCaller = opts.aiCaller || callAiEdgeFunction

  const agents = classifyQueryMulti(query)
  const primary = agents[0]

  // Fan out. One agent failing must not sink the whole answer.
  const settled = await Promise.all(agents.map(async (type) => {
    const fn = runners[type]
    if (!fn) return { agentType: type, result: { response: '' } }
    try {
      return { agentType: type, result: await fn(query, context) }
    } catch (err) {
      return { agentType: type, result: { response: `The ${AGENT_LABELS[type] || type} agent could not complete.`, error: err?.message } }
    }
  }))

  const primaryResult = settled.find(s => s.agentType === primary)?.result ?? { response: '' }
  const contributions = settled.map(s => ({ agentType: s.agentType, response: s.result.response }))

  // Single specialist → return its result directly (unchanged behaviour).
  if (agents.length === 1) {
    return { ...primaryResult, agentType: primary, agents, synthesized: false, contributions }
  }

  // Multiple specialists → fuse. If synthesis fails, fall back to the primary
  // agent's answer so the user still gets something useful.
  let fused = primaryResult.response
  let synthesized = false
  try {
    const out = await aiCaller(SYNTHESIS_SYSTEM, buildSynthesisPrompt(query, contributions))
    if (out && !/^AI unavailable/i.test(out) && !/^Unable to generate/i.test(out)) {
      fused = out
      synthesized = true
    }
  } catch { /* keep primary answer */ }

  // Preserve the primary agent's structured panels (kpis/costTrend/…) but swap
  // in the fused narrative.
  return { ...primaryResult, response: fused, agentType: primary, agents, synthesized, contributions }
}
