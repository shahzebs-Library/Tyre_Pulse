/**
 * Cross-module action contracts.
 *
 * Producers use a stable source key so retries can find the action they already
 * created. Database RLS remains the authority for tenant access; callers never
 * supply an organisation id here.
 */

const TYPES = new Set(['inspection', 'work_order', 'stock', 'accident'])
const EVENTS = {
  inspection: new Set(['failed', 'defect_found', 'overdue']),
  work_order: new Set(['overdue', 'blocked', 'parts_shortage']),
  stock: new Set(['low_stock', 'out_of_stock']),
  accident: new Set(['reported', 'evidence_missing', 'approval_overdue']),
}

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max)

export function operationalSourceKey(type, sourceId, event) {
  const t = clean(type, 30).toLowerCase()
  const e = clean(event, 40).toLowerCase()
  const id = clean(sourceId, 100).replace(/[^a-zA-Z0-9_.:-]/g, '_')
  if (!TYPES.has(t)) throw new Error('Unsupported operational source type.')
  if (!EVENTS[t]?.has(e)) throw new Error('Unsupported operational event.')
  if (!id) throw new Error('A source record id is required.')
  return `auto:${t}:${id}:${e}`
}

export function buildOperationalAction({ type, sourceId, event, title, ...values } = {}) {
  const source = operationalSourceKey(type, sourceId, event)
  const safeTitle = clean(title, 300)
  if (!safeTitle) throw new Error('An action title is required.')
  return {
    title: safeTitle,
    source,
    category: clean(values.category, 40) || (type === 'stock' ? 'cost' : type === 'accident' ? 'safety' : type),
    severity: clean(values.severity, 20) || 'medium',
    asset_no: clean(values.asset_no, 120) || null,
    country: clean(values.country, 100) || null,
    due_date: values.due_date || null,
    impact: clean(values.impact, 4000) || null,
    recommended_action: clean(values.recommended_action, 4000) || null,
    notes: clean(values.notes, 8000) || null,
  }
}

/** Pure producer helpers keep module pages from inventing incompatible tasks. */
export const actionFromInspection = (inspection, event = 'failed') => buildOperationalAction({
  type: 'inspection', sourceId: inspection?.id, event,
  title: `Inspection action: ${inspection?.asset_no || inspection?.id}`,
  asset_no: inspection?.asset_no, country: inspection?.country,
  category: 'inspection', severity: event === 'failed' ? 'high' : 'medium',
  recommended_action: 'Review the inspection findings and assign corrective work.',
})

export const actionFromWorkOrder = (order, event = 'overdue') => buildOperationalAction({
  type: 'work_order', sourceId: order?.id, event,
  title: `Work order ${order?.work_order_no || order?.id}: ${event.replaceAll('_', ' ')}`,
  asset_no: order?.asset_no, country: order?.country,
  category: 'maintenance', severity: event === 'parts_shortage' ? 'high' : 'medium',
  recommended_action: event === 'parts_shortage' ? 'Review shortages and reserve or procure stock.' : 'Review ownership and recovery date.',
})

export const actionFromStock = (stock, event = 'low_stock') => buildOperationalAction({
  type: 'stock', sourceId: stock?.id, event,
  title: `${stock?.description || 'Stock item'} is ${event.replaceAll('_', ' ')}`,
  country: stock?.country, category: 'cost',
  severity: event === 'out_of_stock' ? 'critical' : 'high',
  impact: stock?.site ? `Supply risk at ${clean(stock.site, 120)}.` : null,
  recommended_action: 'Replenish or transfer stock and confirm the expected delivery date.',
})

export const actionFromAccident = (accident, event = 'reported') => buildOperationalAction({
  type: 'accident', sourceId: accident?.id, event,
  title: `Accident ${accident?.reference_no || accident?.id}: ${event.replaceAll('_', ' ')}`,
  asset_no: accident?.asset_no, country: accident?.country,
  category: 'safety', severity: event === 'reported' ? 'critical' : 'high',
  recommended_action: 'Assign an owner, secure evidence and progress the incident workflow.',
})
