// ─────────────────────────────────────────────────────────────────────────────
// aiRouter.js - Multi-agent routing for TyrePulse AI OS
// Classifies every query and routes to the best agent.
// ─────────────────────────────────────────────────────────────────────────────

// Agent ids, patterns and classifiers come from the ONE shared registry that the
// ai-orchestrator edge function also uses, so the label the UI previews and the
// agent the server actually runs can never disagree.
import { AGENT_TYPES, classifyQuery, classifyQueryMulti } from '../../supabase/functions/_shared/aiAgents.ts'
export { AGENT_TYPES, classifyQuery, classifyQueryMulti }

export const AGENT_LABELS = {
  [AGENT_TYPES.ANALYST]:       'Analyst',
  [AGENT_TYPES.TYRE_ENGINEER]: 'Tyre Engineer',
  [AGENT_TYPES.QA_DATA]:       'QA Data',
  [AGENT_TYPES.PLANNER]:       'Planner',
  [AGENT_TYPES.SAFETY]:        'Safety & HSE',
  [AGENT_TYPES.PROCUREMENT]:   'Procurement',
}

export const AGENT_COLORS = {
  [AGENT_TYPES.ANALYST]:       { bg: 'bg-blue-900/40', text: 'text-blue-300', border: 'border-blue-700/50' },
  [AGENT_TYPES.TYRE_ENGINEER]: { bg: 'bg-amber-900/40', text: 'text-amber-300', border: 'border-amber-700/50' },
  [AGENT_TYPES.QA_DATA]:       { bg: 'bg-purple-900/40', text: 'text-purple-300', border: 'border-purple-700/50' },
  [AGENT_TYPES.PLANNER]:       { bg: 'bg-emerald-900/40', text: 'text-emerald-300', border: 'border-emerald-700/50' },
  [AGENT_TYPES.SAFETY]:        { bg: 'bg-red-900/40', text: 'text-red-300', border: 'border-red-700/50' },
  [AGENT_TYPES.PROCUREMENT]:   { bg: 'bg-teal-900/40', text: 'text-teal-300', border: 'border-teal-700/50' },
}

export const AGENT_DESCRIPTIONS = {
  [AGENT_TYPES.ANALYST]:       'KPI trends, cost breakdown, fleet comparison',
  [AGENT_TYPES.TYRE_ENGINEER]: 'Root cause, wear patterns, pressure, alignment, failure diagnosis',
  [AGENT_TYPES.QA_DATA]:       'Data cleaning, duplicate detection, validation, anomaly flags',
  [AGENT_TYPES.PLANNER]:       'Maintenance scheduling, replacement forecasting, budget planning',
  [AGENT_TYPES.SAFETY]:        'Accidents, inspection compliance, corrective actions, driver risk',
  [AGENT_TYPES.PROCUREMENT]:   'Brand/vendor value ranking, purchasing and order planning',
}

// ── Agent Routing ─────────────────────────────────────────────────────────────

/**
 * Route a query to the correct agent and execute.
 * @param {string}   query
 * @param {Object}   context   - { records, inspections, actions, assetNo, site }
 * @param {Object}   agentFns  - { analyst, tyre_engineer, qa_data, planner }
 * @returns {Promise<{ agentType, response, ...agentData }>}
 */
export async function routeQuery(query, context = {}, agentFns = {}) {
  const agentType = classifyQuery(query)
  const agentFn = agentFns[agentType] ?? agentFns[AGENT_TYPES.ANALYST]

  if (!agentFn) {
    return {
      agentType,
      response: 'No agent available to handle this query.',
    }
  }

  try {
    const result = await agentFn(query, context)
    return { agentType, ...result }
  } catch (err) {
    console.error(`Agent ${agentType} error:`, err)
    return {
      agentType,
      response: `The ${AGENT_LABELS[agentType]} agent encountered an error. Please try again.`,
      error: err.message,
    }
  }
}
