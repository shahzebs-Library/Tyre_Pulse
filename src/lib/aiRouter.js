// ─────────────────────────────────────────────────────────────────────────────
// aiRouter.js — Multi-agent routing for TyrePulse AI OS
// Classifies every query and routes to the best agent.
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_TYPES = {
  ANALYST:        'analyst',
  TYRE_ENGINEER:  'tyre_engineer',
  QA_DATA:        'qa_data',
  PLANNER:        'planner',
}

export const AGENT_LABELS = {
  [AGENT_TYPES.ANALYST]:       'Analyst',
  [AGENT_TYPES.TYRE_ENGINEER]: 'Tyre Engineer',
  [AGENT_TYPES.QA_DATA]:       'QA Data',
  [AGENT_TYPES.PLANNER]:       'Planner',
}

export const AGENT_COLORS = {
  [AGENT_TYPES.ANALYST]:       { bg: 'bg-blue-900/40', text: 'text-blue-300', border: 'border-blue-700/50' },
  [AGENT_TYPES.TYRE_ENGINEER]: { bg: 'bg-amber-900/40', text: 'text-amber-300', border: 'border-amber-700/50' },
  [AGENT_TYPES.QA_DATA]:       { bg: 'bg-purple-900/40', text: 'text-purple-300', border: 'border-purple-700/50' },
  [AGENT_TYPES.PLANNER]:       { bg: 'bg-emerald-900/40', text: 'text-emerald-300', border: 'border-emerald-700/50' },
}

export const AGENT_DESCRIPTIONS = {
  [AGENT_TYPES.ANALYST]:       'KPI trends, cost breakdown, fleet comparison',
  [AGENT_TYPES.TYRE_ENGINEER]: 'Root cause, wear patterns, pressure, alignment, failure diagnosis',
  [AGENT_TYPES.QA_DATA]:       'Data cleaning, duplicate detection, validation, anomaly flags',
  [AGENT_TYPES.PLANNER]:       'Maintenance scheduling, replacement forecasting, budget planning',
}

// ── Query Classification ──────────────────────────────────────────────────────

/**
 * Classify a user query into an agent type based on keyword/pattern matching.
 * Rules are ordered by specificity — QA and Planner checked before Engineer and Analyst.
 * @param {string} query
 * @returns {string} AGENT_TYPES value
 */
export function classifyQuery(query) {
  const q = query.toLowerCase().trim()

  // QA Data agent: data quality, duplicates, cleaning, validation, data errors
  if (/duplicat|data qualit|clean|incorrect|invalid|missing data|serial.*(error|wrong|dup)|error in data|wrong entry|bad data|corrupt|data issue|verify data/.test(q)) {
    return AGENT_TYPES.QA_DATA
  }

  // Planner agent: scheduling, forecasting, when, planning, budget, next period, upcoming
  if (/schedul|forecast|when.*(replac|due|expire|next)|plan|next month|next quarter|next year|budget|replacement date|upcoming|predict|demand|inventory need|stock plan|order plan|how many.*next|procurement plan/.test(q)) {
    return AGENT_TYPES.PLANNER
  }

  // Tyre Engineer agent: root cause, wear, pressure, alignment, failure diagnosis, technical
  if (/root cause|why.*fail|why.*wear|why.*blow|wear pattern|abnormal wear|shoulder wear|center wear|pressure|inflation|under.?inflat|over.?inflat|alignment|camber|toe.in|toe.out|suspension|failure mode|blowout|puncture|sidewall|diagnos|engineer|technical analysis|tyre.*(issue|problem|fault)|heat buildup|ply separat|bead damage/.test(q)) {
    return AGENT_TYPES.TYRE_ENGINEER
  }

  // Default: Analyst agent for trends, KPIs, cost, comparison, report, summary
  return AGENT_TYPES.ANALYST
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
