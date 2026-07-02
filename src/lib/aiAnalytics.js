import { supabase } from './supabase'

// ── Per-agent system prompts ───────────────────────────────────────────────────
const AGENT_SYSTEMS = {

  analyst: `You are TyrePulse Fleet Analyst, a senior data analyst for a fleet tyre management platform.
You receive pre-aggregated fleet statistics and must deliver deep analytical responses.
Your analysis must cover: KPIs, trends, cost patterns, site comparisons, brand performance, risk distribution, root insights.
Never summarise shallowly. Always extract non-obvious insights.
Respond ONLY with valid JSON matching this exact structure - no markdown, no text outside the JSON:
{
  "answer": "3-5 sentences with concrete numbers and meaningful insight",
  "agentType": "analyst",
  "chartType": "bar" | "line" | "doughnut" | "none",
  "chartTitle": "string",
  "chartData": { "labels": ["string"], "datasets": [{"label":"string","data":[number],"backgroundColor":["string"]}] },
  "tableHeaders": ["string"],
  "tableRows": [["string"]],
  "insights": ["3-5 specific bullet insights with numbers"],
  "rootCause": "string or null",
  "recommendations": ["2-4 specific actionable recommendations"],
  "riskLevel": "Low" | "Medium" | "High" | "Critical",
  "exportTitle": "string"
}
Set chartData null if chartType is "none". Keep table rows to 15 max. Currency is SAR. Always include concrete numbers.`,

  tyre_engineer: `You are TyrePulse Tyre Engineer, a senior tyre and fleet engineering specialist.
You diagnose tyre failures, identify root causes, evaluate wear patterns, and recommend engineering interventions.
Always investigate: inflation, alignment, load, driver behavior, road conditions, maintenance quality.
Link every finding to a financial and operational impact.
Respond ONLY with valid JSON - no markdown, no text outside JSON:
{
  "answer": "3-5 sentences with engineering diagnosis and specific findings",
  "agentType": "tyre_engineer",
  "chartType": "bar" | "line" | "doughnut" | "none",
  "chartTitle": "string",
  "chartData": { "labels": ["string"], "datasets": [{"label":"string","data":[number],"backgroundColor":["string"]}] },
  "tableHeaders": ["string"],
  "tableRows": [["string"]],
  "insights": ["3-5 engineering insights with root cause indicators"],
  "rootCause": "Detailed root cause analysis paragraph",
  "recommendations": ["3-5 specific engineering interventions with priority"],
  "riskLevel": "Low" | "Medium" | "High" | "Critical",
  "exportTitle": "string"
}
Set chartData null if no chart applies. Currency is SAR.`,

  qa_data: `You are TyrePulse QA Data Agent, a data quality specialist for fleet tyre management.
You identify: duplicates, invalid serials, missing readings, inconsistent entries, suspicious patterns, data integrity issues.
Quantify every issue found. Provide specific remediation steps.
Respond ONLY with valid JSON - no markdown, no text outside JSON:
{
  "answer": "3-5 sentences with specific data quality findings and counts",
  "agentType": "qa_data",
  "chartType": "bar" | "doughnut" | "none",
  "chartTitle": "string",
  "chartData": { "labels": ["string"], "datasets": [{"label":"string","data":[number],"backgroundColor":["string"]}] },
  "tableHeaders": ["string"],
  "tableRows": [["string"]],
  "insights": ["3-5 data quality findings with counts and impact"],
  "rootCause": "string describing data quality root issue",
  "recommendations": ["3-5 data remediation steps"],
  "riskLevel": "Low" | "Medium" | "High" | "Critical",
  "exportTitle": "string"
}`,

  planner: `You are TyrePulse Planner Agent, a maintenance planning and forecasting specialist.
You produce: replacement schedules, budget forecasts, procurement plans, workshop load analysis, upcoming risk predictions.
Always quantify: when, how many, at what cost, what priority.
Respond ONLY with valid JSON - no markdown, no text outside JSON:
{
  "answer": "3-5 sentences with concrete forecast numbers and timeline",
  "agentType": "planner",
  "chartType": "bar" | "line" | "none",
  "chartTitle": "string",
  "chartData": { "labels": ["string"], "datasets": [{"label":"string","data":[number],"backgroundColor":["string"]}] },
  "tableHeaders": ["string"],
  "tableRows": [["string"]],
  "insights": ["3-5 planning insights with dates and quantities"],
  "rootCause": null,
  "recommendations": ["3-5 planning actions with timeline"],
  "riskLevel": "Low" | "Medium" | "High" | "Critical",
  "exportTitle": "string"
}`,
}

// ── Extended data context builder ──────────────────────────────────────────────
export function buildDataContext(records = [], anomalies = [], inspections = [], actions = []) {
  if (!records.length) return { error: 'No records loaded', summary: { totalRecords: 0, totalCost: 0, avgCost: 0 } }

  const totalCost = records.reduce((s, r) => s + (r.cost_per_tyre || 0) * (r.qty || 1), 0)

  const bySite     = {}
  const byBrand    = {}
  const byCategory = {}
  const byRisk     = {}
  const byAsset    = {}
  const byMonth    = {}
  const byCountry  = {}

  records.forEach(r => {
    const cost   = (r.cost_per_tyre || 0) * (r.qty || 1)
    const isHigh = r.risk_level === 'High' || r.risk_level === 'Critical'

    if (r.site) {
      if (!bySite[r.site]) bySite[r.site] = { count: 0, cost: 0, highRisk: 0, critical: 0 }
      bySite[r.site].count++
      bySite[r.site].cost += cost
      if (r.risk_level === 'Critical') bySite[r.site].critical++
      if (isHigh) bySite[r.site].highRisk++
    }
    if (r.brand) {
      if (!byBrand[r.brand]) byBrand[r.brand] = { count: 0, cost: 0, highRisk: 0 }
      byBrand[r.brand].count++
      byBrand[r.brand].cost += cost
      if (isHigh) byBrand[r.brand].highRisk++
    }
    if (r.category) byCategory[r.category] = (byCategory[r.category] || 0) + 1
    if (r.risk_level) byRisk[r.risk_level] = (byRisk[r.risk_level] || 0) + 1
    if (r.asset_no) {
      if (!byAsset[r.asset_no]) byAsset[r.asset_no] = { count: 0, cost: 0, highRisk: 0 }
      byAsset[r.asset_no].count++
      byAsset[r.asset_no].cost += cost
      if (isHigh) byAsset[r.asset_no].highRisk++
    }
    if (r.issue_date) {
      const m = r.issue_date.substring(0, 7)
      if (!byMonth[m]) byMonth[m] = { count: 0, cost: 0, highRisk: 0 }
      byMonth[m].count++
      byMonth[m].cost += cost
      if (isHigh) byMonth[m].highRisk++
    }
    if (r.country) {
      if (!byCountry[r.country]) byCountry[r.country] = { count: 0, cost: 0 }
      byCountry[r.country].count++
      byCountry[r.country].cost += cost
    }
  })

  const round = n => Math.round(n)
  const topN = (obj, key, n = 10) =>
    Object.entries(obj).sort((a, b) => b[1][key] - a[1][key]).slice(0, n)
      .map(([k, v]) => ({ name: k, ...v, cost: round(v.cost || 0) }))

  // Inspection summary
  const inspSummary = {
    total: inspections.length,
    completed: inspections.filter(i => i.status === 'Done').length,
    critical: inspections.filter(i => i.severity === 'Critical').length,
    high: inspections.filter(i => i.severity === 'High').length,
    sites: [...new Set(inspections.map(i => i.site).filter(Boolean))].length,
  }

  // Actions summary
  const actionSummary = {
    total: actions.length,
    open: actions.filter(a => a.status === 'Open').length,
    critical: actions.filter(a => a.priority === 'Critical').length,
    high: actions.filter(a => a.priority === 'High').length,
  }

  // Recent patterns
  const now = new Date()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7)
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 7)
  const lastMonthRecs  = records.filter(r => r.issue_date?.startsWith(lastMonthStart))
  const thisMonthRecs  = records.filter(r => r.issue_date?.startsWith(thisMonthStart))

  return {
    summary: {
      totalRecords: records.length,
      totalCost: round(totalCost),
      avgCost: records.length > 0 ? round(totalCost / records.length) : 0,
      criticalCount: byRisk.Critical || 0,
      highRiskCount: (byRisk.High || 0) + (byRisk.Critical || 0),
      highRiskRate: records.length > 0 ? ((((byRisk.High || 0) + (byRisk.Critical || 0)) / records.length) * 100).toFixed(1) + '%' : '0%',
    },
    monthlyTrend: Object.entries(byMonth).sort().slice(-12).map(([m, v]) => ({
      month: m, count: v.count, cost: round(v.cost), highRisk: v.highRisk,
    })),
    thisMonth: { count: thisMonthRecs.length, cost: round(thisMonthRecs.reduce((s, r) => s + (r.cost_per_tyre || 0) * (r.qty || 1), 0)) },
    lastMonth: { count: lastMonthRecs.length, cost: round(lastMonthRecs.reduce((s, r) => s + (r.cost_per_tyre || 0) * (r.qty || 1), 0)) },
    bySite: topN(bySite, 'cost'),
    byBrand: topN(byBrand, 'count').map(b => ({ ...b, highRiskRate: (b.highRisk / (b.count || 1) * 100).toFixed(1) + '%' })),
    byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ category: k, count: v })),
    byRisk,
    byCountry: topN(byCountry, 'count'),
    topAssets: topN(byAsset, 'cost').slice(0, 10).map(a => ({ ...a, highRiskRate: (a.highRisk / (a.count || 1) * 100).toFixed(1) + '%' })),
    anomalies: { total: anomalies.length, high: anomalies.filter(a => a.severity === 'high').length },
    inspections: inspSummary,
    actions: actionSummary,
  }
}

// ── Main AI call ───────────────────────────────────────────────────────────────
/**
 * @param {string}   question
 * @param {Object}   dataContext   - from buildDataContext()
 * @param {string}   [agentType]   - 'analyst' | 'tyre_engineer' | 'qa_data' | 'planner'
 * @param {Array}    [history]     - [{ role: 'user'|'assistant', content: string }]
 */
export async function askAI(question, dataContext, agentType = 'analyst', history = []) {
  const system = AGENT_SYSTEMS[agentType] ?? AGENT_SYSTEMS.analyst

  // Build conversation with history (last 4 exchanges max to save tokens)
  const recentHistory = history.slice(-4)
  const messages = [
    ...recentHistory.map(h => ({ role: h.role, content: h.content })),
    {
      role: 'user',
      content: `Question: ${question}\n\nFleet Data:\n${JSON.stringify(dataContext, null, 1)}`,
    },
  ]

  const { data, error } = await supabase.functions.invoke('chat-ai', {
    body: {
      system,
      messages,
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
    },
  })
  if (error) throw error
  const raw = (data?.content ?? '').trim()
  const clean = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(clean)
  return { ...parsed, agentType: parsed.agentType ?? agentType }
}

// ── Quick deep-analysis presets ────────────────────────────────────────────────
export const DEEP_ANALYSIS_PRESETS = [
  {
    id: 'cost_driver',
    label: 'Cost Driver Analysis',
    icon: 'DollarSign',
    agentType: 'analyst',
    question: 'Identify the top 3 cost drivers in the fleet. Break down by site, brand, and category. Show which combination drives the highest cost and give specific SAR amounts and percentages.',
  },
  {
    id: 'root_cause',
    label: 'Root Cause Analysis',
    icon: 'Search',
    agentType: 'tyre_engineer',
    question: 'Perform a root cause analysis of all critical and high risk tyre failures. Identify patterns in brands, sites, and asset types. What engineering interventions would prevent future failures?',
  },
  {
    id: 'fleet_health',
    label: 'Fleet Health Score',
    icon: 'Activity',
    agentType: 'analyst',
    question: 'Assess overall fleet health. Calculate risk rate by site, identify the 3 worst performing sites, and provide a fleet health score. What is the estimated monthly cost of current risk levels?',
  },
  {
    id: 'forecast',
    label: 'Replacement Forecast',
    icon: 'Calendar',
    agentType: 'planner',
    question: 'Based on current consumption and risk rates, forecast tyre replacements needed in the next 3 months by site. Estimate cost. Which sites need immediate procurement planning?',
  },
  {
    id: 'brand_compare',
    label: 'Brand Performance',
    icon: 'BarChart2',
    agentType: 'analyst',
    question: 'Compare all tyre brands by failure rate, cost per tyre, and high risk percentage. Which brand gives best value? Should any brand be discontinued based on data?',
  },
  {
    id: 'data_quality',
    label: 'Data Quality Audit',
    icon: 'Shield',
    agentType: 'qa_data',
    question: 'Audit the fleet data for quality issues. Identify records with missing fields, suspicious cost values, duplicate assets, and any data patterns that suggest entry errors.',
  },
]

// ── Suggested questions by agent ──────────────────────────────────────────────
export const SUGGESTED_QUESTIONS = {
  analyst: [
    'Which site has the highest tyre cost this month?',
    'Show the monthly cost trend for the last 6 months',
    'Compare high-risk rates across all sites',
    'Which assets cost the most to maintain?',
    'What is the cost breakdown by risk level?',
    'Which brand has the highest failure rate?',
    'Show category distribution with percentages',
    'What percentage of records are critical or high risk?',
  ],
  tyre_engineer: [
    'What are the main causes of critical tyre failures?',
    'Which positions on vehicles show the most wear?',
    'Is there evidence of under-inflation across the fleet?',
    'Which brands show abnormal wear patterns?',
    'What is the relationship between site and failure rate?',
    'Are there signs of alignment or suspension issues?',
    'Which assets need urgent engineering inspection?',
    'What preventive maintenance would reduce critical failures by 50%?',
  ],
  planner: [
    'How many tyres will need replacement next month?',
    'What is the estimated procurement budget for next quarter?',
    'Which sites need urgent tyre stock replenishment?',
    'Create a 3-month maintenance schedule by site',
    'What is the average tyre life across the fleet?',
    'Forecast annual tyre costs at current consumption rate',
    'Which assets are due for inspection based on risk?',
    'What procurement lead time should we plan for?',
  ],
  qa_data: [
    'Are there any duplicate tyre serial numbers?',
    'Which records have missing or invalid cost data?',
    'Identify assets with unrealistic tyre consumption rates',
    'Are there any suspicious data entry patterns?',
    'Which sites have the most incomplete records?',
    'Find records with inconsistent risk level classifications',
    'Are there any assets with impossible tyre counts?',
    'What percentage of records have complete data?',
  ],
}
