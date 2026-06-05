import Anthropic from '@anthropic-ai/sdk'

function getClient() {
  const key = import.meta.env.VITE_ANTHROPIC_API_KEY
  if (!key) throw new Error('VITE_ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
}

export async function askAI(question, dataContext) {
  const client = getClient()

  const system = `You are TyrePulse Smart Analytics, an analytics assistant for a fleet tyre management platform.
You receive pre-aggregated tyre fleet statistics and answer questions about them.
Respond ONLY with valid JSON matching this exact structure — no markdown, no explanation outside the JSON:
{
  "answer": "2-4 sentence direct answer",
  "chartType": "bar" | "line" | "doughnut" | "none",
  "chartTitle": "string",
  "chartData": {
    "labels": ["string"],
    "datasets": [{"label": "string", "data": [number], "backgroundColor": ["string"]}]
  },
  "tableHeaders": ["string"],
  "tableRows": [["string or number"]],
  "insights": ["up to 3 short bullet insights"],
  "exportTitle": "string"
}
Set chartData to null if chartType is "none". Set tableHeaders/tableRows to null if no table is relevant.
Currency is SAR. Keep table rows to 15 max.`

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system,
    messages: [{ role: 'user', content: `Question: ${question}\n\nData:\n${JSON.stringify(dataContext, null, 2)}` }],
  })

  const raw = msg.content[0].text.trim()
  // Strip markdown fences if present
  const clean = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(clean)
}

export function buildDataContext(records = [], anomalies = []) {
  if (!records.length) return { error: 'No records loaded' }

  const totalCost = records.reduce((s, r) => s + (r.cost_per_tyre || 0) * (r.qty || 1), 0)

  const bySite = {}
  const byBrand = {}
  const byCategory = {}
  const byRisk = {}
  const byAsset = {}
  const byMonth = {}

  records.forEach(r => {
    const cost = (r.cost_per_tyre || 0) * (r.qty || 1)
    const isHigh = r.risk_level === 'High' || r.risk_level === 'Critical'

    if (r.site) {
      if (!bySite[r.site]) bySite[r.site] = { count: 0, cost: 0, highRisk: 0 }
      bySite[r.site].count++; bySite[r.site].cost += cost
      if (isHigh) bySite[r.site].highRisk++
    }
    if (r.brand) {
      if (!byBrand[r.brand]) byBrand[r.brand] = { count: 0, cost: 0 }
      byBrand[r.brand].count++; byBrand[r.brand].cost += cost
    }
    if (r.category) byCategory[r.category] = (byCategory[r.category] || 0) + 1
    if (r.risk_level) byRisk[r.risk_level] = (byRisk[r.risk_level] || 0) + 1
    if (r.asset_no) {
      if (!byAsset[r.asset_no]) byAsset[r.asset_no] = { count: 0, cost: 0 }
      byAsset[r.asset_no].count++; byAsset[r.asset_no].cost += cost
    }
    if (r.issue_date) {
      const m = r.issue_date.substring(0, 7)
      if (!byMonth[m]) byMonth[m] = { count: 0, cost: 0 }
      byMonth[m].count++; byMonth[m].cost += cost
    }
  })

  const round = n => Math.round(n)
  const topN = (obj, key, n = 10) =>
    Object.entries(obj).sort((a, b) => b[1][key] - a[1][key]).slice(0, n)
      .map(([k, v]) => ({ name: k, ...v, cost: round(v.cost || 0) }))

  return {
    summary: { totalRecords: records.length, totalCost: round(totalCost), avgCost: round(totalCost / records.length) },
    bySite: topN(bySite, 'cost'),
    byBrand: topN(byBrand, 'count'),
    byCategory: Object.entries(byCategory).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({ category: k, count: v })),
    byRisk,
    byMonth: Object.entries(byMonth).sort().slice(-12).map(([m, v]) => ({ month: m, count: v.count, cost: round(v.cost) })),
    topAssets: topN(byAsset, 'cost'),
    anomalies: { total: anomalies.length, high: anomalies.filter(a => a.severity === 'high').length },
  }
}
