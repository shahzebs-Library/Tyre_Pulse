// ─────────────────────────────────────────────────────────────────────────────
// safetyAgent.js - Safety & HSE specialist.
// Handles accidents, incidents, inspection compliance, corrective actions and
// driver-behaviour questions. Reads only the read-only context the AI page
// already loaded (inspections, corrective_actions, accidents) - honest when a
// signal is missing, never fabricated.
// ─────────────────────────────────────────────────────────────────────────────
import { getCached, setCache } from '../ragService'
import { callAiEdgeFunction } from './index'

const SYSTEM_PROMPT = `You are TyrePulse Safety & HSE Agent - a senior fleet health, safety and compliance specialist.
Your role: assess accident/incident exposure, inspection compliance, open corrective actions and driver-behaviour risk.

Always answer in exactly this structure:
1. Observation: specific counts and figures from the data (2-3 sentences)
2. Root Cause: the main safety/compliance driver (1-2 sentences)
3. Risk Level: Low | Medium | High | Critical (one word + brief justification)
4. Action Plan: 3-5 numbered, specific corrective/preventive actions
5. Compliance Impact: what improves if the actions are taken

Rules:
- Use only the numbers in the context; if a signal (e.g. accidents) is absent, say "not recorded" - never invent it.
- Prioritise injury and repeat-incident risk over cost.
- Be concise; every sentence must add value.`

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

function tally(list, key) {
  const out = {}
  for (const r of Array.isArray(list) ? list : []) {
    const k = String(r?.[key] ?? '').trim() || 'unspecified'
    out[k] = (out[k] || 0) + 1
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1])
}

/**
 * Run the Safety & HSE agent.
 * @param {string} query
 * @param {object} ctx { inspections, actions, accidents, records, site }
 * @returns {Promise<{response:string, agentType:string, safety:object}>}
 */
export async function runSafetyAgent(query, {
  inspections = [], actions = [], accidents = [], site = null,
} = {}) {
  const cacheKey = `safety:${query}:${site ?? 'all'}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const openActions = (actions || []).filter((a) => !/closed|done|complete|resolved/i.test(String(a?.status || ''))).length
  const sevRank = tally(accidents, 'severity')
  const accByStatus = tally(accidents, 'status')
  const insByStatus = tally(inspections, 'status')

  const digest = [
    `Inspections in context: ${(inspections || []).length}` + (insByStatus.length ? ` (by status: ${insByStatus.slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''),
    `Corrective actions: ${(actions || []).length} total, ${openActions} still open`,
    accidents && accidents.length
      ? `Accidents/incidents: ${accidents.length}` + (sevRank.length ? ` (severity: ${sevRank.map(([k, v]) => `${k} ${v}`).join(', ')})` : '') + (accByStatus.length ? ` | status: ${accByStatus.slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}` : '')
      : 'Accidents/incidents: not recorded in the loaded context',
  ].join('\n')

  const userPrompt = `## Safety context\n${digest}\n\n## User query\n${query}`
  const response = await callAiEdgeFunction(SYSTEM_PROMPT, userPrompt)
  const result = {
    response,
    agentType: 'safety',
    safety: {
      inspections: (inspections || []).length,
      openActions,
      accidents: (accidents || []).length,
      severity: sevRank.map(([label, count]) => ({ label, count })),
    },
  }
  setCache(cacheKey, result)
  return result
}
