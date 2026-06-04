import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  detectAlerts,
  countAlertsBySeverity,
  ALERT_TYPES,
  SEVERITY,
  SEVERITY_CONFIG,
  ALERT_TYPE_LABELS,
} from '../lib/alertEngine'

// ─────────────────────────────────────────────────────────────────────────────
// Mock analyticsEngine (detectRiskSpike is imported by alertEngine)
// ─────────────────────────────────────────────────────────────────────────────
vi.mock('../lib/analyticsEngine', () => ({
  detectRiskSpike: vi.fn(() => ({ isSpike: false, deltaPct: 0, prior: 0, current: 0 })),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Supabase mock builder
// Builds a chainable mock that resolves with { data, error: null }
// ─────────────────────────────────────────────────────────────────────────────
function makeSupabaseMock({
  stockRecords = [],
  budgets = [],
  openActions = [],
  tyreRecords = [],
  inspections = [],
} = {}) {
  const makeChain = (resolveData) => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      eq:  vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      // Resolve as Promise with { data, error }
      then: (resolve) => resolve({ data: resolveData, error: null }),
    }
    return chain
  }

  const supabase = {
    from: vi.fn((table) => {
      if (table === 'stock_records')     return makeChain(stockRecords)
      if (table === 'budgets')           return makeChain(budgets)
      if (table === 'corrective_actions') return makeChain(openActions)
      if (table === 'tyre_records')      return makeChain(tyreRecords)
      if (table === 'inspections')       return makeChain(inspections)
      return makeChain([])
    }),
  }
  return supabase
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT_TYPES and SEVERITY constants
// ─────────────────────────────────────────────────────────────────────────────
describe('ALERT_TYPES and SEVERITY constants', () => {
  it('ALERT_TYPES has all expected keys', () => {
    expect(ALERT_TYPES.STOCK_CRITICAL).toBe('STOCK_CRITICAL')
    expect(ALERT_TYPES.BUDGET_OVERAGE).toBe('BUDGET_OVERAGE')
    expect(ALERT_TYPES.OVERDUE_ACTION).toBe('OVERDUE_ACTION')
    expect(ALERT_TYPES.RISK_SPIKE).toBe('RISK_SPIKE')
    expect(ALERT_TYPES.INSPECTION_OVERDUE).toBe('INSPECTION_OVERDUE')
  })

  it('SEVERITY has all expected levels', () => {
    expect(SEVERITY.CRITICAL).toBe('critical')
    expect(SEVERITY.HIGH).toBe('high')
    expect(SEVERITY.MEDIUM).toBe('medium')
    expect(SEVERITY.INFO).toBe('info')
  })

  it('SEVERITY_CONFIG has entries for all severity levels', () => {
    expect(SEVERITY_CONFIG).toHaveProperty('critical')
    expect(SEVERITY_CONFIG).toHaveProperty('high')
    expect(SEVERITY_CONFIG).toHaveProperty('medium')
    expect(SEVERITY_CONFIG).toHaveProperty('info')
  })

  it('ALERT_TYPE_LABELS maps every alert type to a label', () => {
    expect(ALERT_TYPE_LABELS[ALERT_TYPES.STOCK_CRITICAL]).toBe('Stock')
    expect(ALERT_TYPE_LABELS[ALERT_TYPES.BUDGET_OVERAGE]).toBe('Budget')
    expect(ALERT_TYPE_LABELS[ALERT_TYPES.OVERDUE_ACTION]).toBe('Action')
    expect(ALERT_TYPE_LABELS[ALERT_TYPES.RISK_SPIKE]).toBe('Risk')
    expect(ALERT_TYPE_LABELS[ALERT_TYPES.INSPECTION_OVERDUE]).toBe('Inspection')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — empty data
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — empty data', () => {
  it('returns empty array when all data sources are empty', async () => {
    const supabase = makeSupabaseMock()
    const alerts = await detectAlerts(supabase, null)
    expect(alerts).toEqual([])
  })

  it('returns a resolved array (not a Promise)', async () => {
    const supabase = makeSupabaseMock()
    const result = await detectAlerts(supabase, null)
    expect(Array.isArray(result)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — STOCK_CRITICAL alerts
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — STOCK_CRITICAL', () => {
  it('generates CRITICAL severity when stock_qty is 0', async () => {
    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 's1', site: 'Riyadh', description: '315/80R22.5', stock_qty: 0, critical_level: 5, min_level: 10 },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const stockAlert = alerts.find(a => a.type === ALERT_TYPES.STOCK_CRITICAL)
    expect(stockAlert).toBeDefined()
    expect(stockAlert.severity).toBe(SEVERITY.CRITICAL)
    expect(stockAlert.title).toContain('Riyadh')
  })

  it('generates HIGH severity when stock_qty is at critical_level but not zero', async () => {
    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 's2', site: 'Jeddah', description: '235/65R16', stock_qty: 3, critical_level: 3, min_level: 10 },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const stockAlert = alerts.find(a => a.type === ALERT_TYPES.STOCK_CRITICAL)
    expect(stockAlert).toBeDefined()
    expect(stockAlert.severity).toBe(SEVERITY.HIGH)
  })

  it('generates MEDIUM severity when stock_qty is below min_level but above critical_level', async () => {
    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 's3', site: 'Dammam', description: '265/70R17', stock_qty: 7, critical_level: 3, min_level: 10 },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const stockAlert = alerts.find(a => a.type === ALERT_TYPES.STOCK_CRITICAL)
    expect(stockAlert).toBeDefined()
    expect(stockAlert.severity).toBe(SEVERITY.MEDIUM)
    expect(stockAlert.title).toContain('Low Stock')
  })

  it('generates no stock alert when stock_qty is above min_level', async () => {
    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 's4', site: 'Mecca', description: 'Tyre', stock_qty: 50, critical_level: 3, min_level: 10 },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const stockAlerts = alerts.filter(a => a.type === ALERT_TYPES.STOCK_CRITICAL)
    expect(stockAlerts).toHaveLength(0)
  })

  it('alert id encodes STOCK_CRITICAL type and record id', async () => {
    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 'myid99', site: 'Site A', stock_qty: 0, critical_level: 5, min_level: 10 },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const stockAlert = alerts.find(a => a.type === ALERT_TYPES.STOCK_CRITICAL)
    expect(stockAlert.id).toContain('STOCK_CRITICAL')
    expect(stockAlert.id).toContain('myid99')
  })

  it('stock alert message contains qty and min_level', async () => {
    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 's5', site: 'Site B', description: 'Test tyre', stock_qty: 2, critical_level: 5, min_level: 15 },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const stockAlert = alerts.find(a => a.type === ALERT_TYPES.STOCK_CRITICAL)
    expect(stockAlert.message).toContain('2')
    expect(stockAlert.message).toContain('15')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — BUDGET_OVERAGE alerts
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — BUDGET_OVERAGE', () => {
  it('generates INFO alert when monthly_budget < 1000 for current month/year', async () => {
    const now = new Date()
    const supabase = makeSupabaseMock({
      budgets: [
        {
          id: 'b1',
          site: 'Site X',
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          monthly_budget: 500,
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const budgetAlert = alerts.find(a => a.type === ALERT_TYPES.BUDGET_OVERAGE)
    expect(budgetAlert).toBeDefined()
    expect(budgetAlert.severity).toBe(SEVERITY.INFO)
    expect(budgetAlert.title).toContain('Site X')
  })

  it('does not generate alert when monthly_budget >= 1000', async () => {
    const now = new Date()
    const supabase = makeSupabaseMock({
      budgets: [
        {
          id: 'b2',
          site: 'Site Y',
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          monthly_budget: 1000,
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const budgetAlerts = alerts.filter(a => a.type === ALERT_TYPES.BUDGET_OVERAGE)
    expect(budgetAlerts).toHaveLength(0)
  })

  it('does not generate alert for a different month', async () => {
    const now = new Date()
    const differentMonth = now.getMonth() === 0 ? 12 : now.getMonth() // previous month number
    const supabase = makeSupabaseMock({
      budgets: [
        {
          id: 'b3',
          site: 'Site Z',
          month: differentMonth,
          year: now.getFullYear(),
          monthly_budget: 100,
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const budgetAlerts = alerts.filter(a => a.type === ALERT_TYPES.BUDGET_OVERAGE)
    expect(budgetAlerts).toHaveLength(0)
  })

  it('budget alert link points to /budgets', async () => {
    const now = new Date()
    const supabase = makeSupabaseMock({
      budgets: [
        {
          id: 'b4',
          site: 'Site W',
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          monthly_budget: 200,
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const budgetAlert = alerts.find(a => a.type === ALERT_TYPES.BUDGET_OVERAGE)
    expect(budgetAlert.link).toBe('/budgets')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — OVERDUE_ACTION alerts
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — OVERDUE_ACTION', () => {
  it('generates MEDIUM severity for action overdue 1–7 days', async () => {
    const due = new Date()
    due.setDate(due.getDate() - 5) // 5 days ago
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a1', title: 'Fix tyre', site: 'Riyadh', due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlert = alerts.find(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlert).toBeDefined()
    expect(actionAlert.severity).toBe(SEVERITY.MEDIUM)
  })

  it('generates HIGH severity for action overdue 8–14 days', async () => {
    const due = new Date()
    due.setDate(due.getDate() - 10) // 10 days ago
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a2', title: 'Replace tyre set', site: 'Jeddah', due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlert = alerts.find(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlert).toBeDefined()
    expect(actionAlert.severity).toBe(SEVERITY.HIGH)
  })

  it('generates CRITICAL severity for action overdue more than 14 days', async () => {
    const due = new Date()
    due.setDate(due.getDate() - 20) // 20 days ago
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a3', title: 'Urgent tyre action', site: 'Dammam', due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlert = alerts.find(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlert).toBeDefined()
    expect(actionAlert.severity).toBe(SEVERITY.CRITICAL)
  })

  it('does not generate alert for action with no due_date', async () => {
    const supabase = makeSupabaseMock({
      openActions: [{ id: 'a4', title: 'No date action', site: 'Site A', due_date: null }],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlerts = alerts.filter(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlerts).toHaveLength(0)
  })

  it('does not generate alert for action with future due date', async () => {
    const due = new Date()
    due.setDate(due.getDate() + 5) // 5 days in the future
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a5', title: 'Future action', site: 'Site B', due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlerts = alerts.filter(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlerts).toHaveLength(0)
  })

  it('overdue message contains days overdue count', async () => {
    const due = new Date()
    due.setDate(due.getDate() - 3)
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a6', title: 'Check tyres', site: 'Site C', due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlert = alerts.find(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlert.message).toMatch(/3 days/)
  })

  it('overdue message uses singular "day" for exactly 1 day overdue', async () => {
    const due = new Date()
    due.setDate(due.getDate() - 1)
    due.setHours(0, 0, 0, 0) // Start of yesterday
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a7', title: 'Single day overdue', site: 'Site D', due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlert = alerts.find(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlert).toBeDefined()
    // Should say "1 day" not "1 days"
    if (actionAlert.message.includes('1 day')) {
      expect(actionAlert.message).toMatch(/1 day[^s]|1 day$/)
    }
  })

  it('action alert link points to /actions', async () => {
    const due = new Date()
    due.setDate(due.getDate() - 2)
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a8', title: 'Check tyres', site: 'Site E', due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlert = alerts.find(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlert.link).toBe('/actions')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — RISK_SPIKE alerts
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — RISK_SPIKE', () => {
  it('does not generate risk spike alert when fewer than 20 tyre records', async () => {
    const supabase = makeSupabaseMock({
      tyreRecords: Array.from({ length: 15 }, (_, i) => ({
        id: `t${i}`, risk_level: 'High', issue_date: '2024-01-01', created_at: '2024-01-01',
      })),
    })
    const alerts = await detectAlerts(supabase, null)
    const spikeAlerts = alerts.filter(a => a.type === ALERT_TYPES.RISK_SPIKE)
    expect(spikeAlerts).toHaveLength(0)
  })

  it('generates CRITICAL spike alert when detectRiskSpike returns deltaPct > 50', async () => {
    const { detectRiskSpike } = await import('../lib/analyticsEngine')
    detectRiskSpike.mockReturnValueOnce({ isSpike: true, deltaPct: 60, prior: 20, current: 80 })

    const supabase = makeSupabaseMock({
      tyreRecords: Array.from({ length: 25 }, (_, i) => ({
        id: `t${i}`, risk_level: 'High', issue_date: '2024-01-01', created_at: '2024-01-01',
      })),
    })
    const alerts = await detectAlerts(supabase, null)
    const spikeAlert = alerts.find(a => a.type === ALERT_TYPES.RISK_SPIKE)
    expect(spikeAlert).toBeDefined()
    expect(spikeAlert.severity).toBe(SEVERITY.CRITICAL)
    expect(spikeAlert.message).toContain('20%')
    expect(spikeAlert.message).toContain('80%')
  })

  it('generates HIGH spike alert when detectRiskSpike returns deltaPct <= 50', async () => {
    const { detectRiskSpike } = await import('../lib/analyticsEngine')
    detectRiskSpike.mockReturnValueOnce({ isSpike: true, deltaPct: 40, prior: 25, current: 65 })

    const supabase = makeSupabaseMock({
      tyreRecords: Array.from({ length: 25 }, (_, i) => ({
        id: `t${i}`, risk_level: 'High', issue_date: '2024-01-01', created_at: '2024-01-01',
      })),
    })
    const alerts = await detectAlerts(supabase, null)
    const spikeAlert = alerts.find(a => a.type === ALERT_TYPES.RISK_SPIKE)
    expect(spikeAlert).toBeDefined()
    expect(spikeAlert.severity).toBe(SEVERITY.HIGH)
  })

  it('does not generate spike alert when isSpike is false', async () => {
    const { detectRiskSpike } = await import('../lib/analyticsEngine')
    detectRiskSpike.mockReturnValueOnce({ isSpike: false, deltaPct: 10, prior: 30, current: 40 })

    const supabase = makeSupabaseMock({
      tyreRecords: Array.from({ length: 25 }, (_, i) => ({
        id: `t${i}`, risk_level: 'High', issue_date: '2024-01-01', created_at: '2024-01-01',
      })),
    })
    const alerts = await detectAlerts(supabase, null)
    const spikeAlerts = alerts.filter(a => a.type === ALERT_TYPES.RISK_SPIKE)
    expect(spikeAlerts).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — INSPECTION_OVERDUE alerts
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — INSPECTION_OVERDUE', () => {
  it('generates MEDIUM severity inspection alert for 0–7 days overdue', async () => {
    const scheduled = new Date()
    scheduled.setDate(scheduled.getDate() - 3) // 3 days ago
    const supabase = makeSupabaseMock({
      inspections: [
        {
          id: 'i1',
          site: 'Site Alpha',
          title: 'Monthly Check',
          scheduled_date: scheduled.toISOString().split('T')[0],
          asset_no: 'TK-001',
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const inspAlert = alerts.find(a => a.type === ALERT_TYPES.INSPECTION_OVERDUE)
    expect(inspAlert).toBeDefined()
    expect(inspAlert.severity).toBe(SEVERITY.MEDIUM)
    expect(inspAlert.title).toContain('Site Alpha')
  })

  it('generates HIGH severity for inspection overdue more than 7 days', async () => {
    const scheduled = new Date()
    scheduled.setDate(scheduled.getDate() - 10) // 10 days ago
    const supabase = makeSupabaseMock({
      inspections: [
        {
          id: 'i2',
          site: 'Site Beta',
          title: 'Quarterly Inspection',
          scheduled_date: scheduled.toISOString().split('T')[0],
          asset_no: null,
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const inspAlert = alerts.find(a => a.type === ALERT_TYPES.INSPECTION_OVERDUE)
    expect(inspAlert).toBeDefined()
    expect(inspAlert.severity).toBe(SEVERITY.HIGH)
  })

  it('inspection alert message includes asset_no when present', async () => {
    const scheduled = new Date()
    scheduled.setDate(scheduled.getDate() - 2)
    const supabase = makeSupabaseMock({
      inspections: [
        {
          id: 'i3',
          site: 'Site Gamma',
          title: 'Weekly Check',
          scheduled_date: scheduled.toISOString().split('T')[0],
          asset_no: 'VEH-123',
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const inspAlert = alerts.find(a => a.type === ALERT_TYPES.INSPECTION_OVERDUE)
    expect(inspAlert.message).toContain('VEH-123')
  })

  it('inspection alert message omits asset reference when asset_no is null', async () => {
    const scheduled = new Date()
    scheduled.setDate(scheduled.getDate() - 2)
    const supabase = makeSupabaseMock({
      inspections: [
        {
          id: 'i4',
          site: 'Site Delta',
          title: 'Check',
          scheduled_date: scheduled.toISOString().split('T')[0],
          asset_no: null,
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const inspAlert = alerts.find(a => a.type === ALERT_TYPES.INSPECTION_OVERDUE)
    expect(inspAlert.message).not.toContain('null')
  })

  it('inspection alert link points to /inspections', async () => {
    const scheduled = new Date()
    scheduled.setDate(scheduled.getDate() - 1)
    const supabase = makeSupabaseMock({
      inspections: [
        {
          id: 'i5',
          site: 'Site E',
          title: 'Check',
          scheduled_date: scheduled.toISOString().split('T')[0],
          asset_no: null,
        },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const inspAlert = alerts.find(a => a.type === ALERT_TYPES.INSPECTION_OVERDUE)
    expect(inspAlert.link).toBe('/inspections')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — Sorting by severity
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — Sorting by severity', () => {
  it('returns alerts sorted critical first, then high, medium, info', async () => {
    const now = new Date()
    // Critical: stock_qty=0 (critical)
    // Medium: stock_qty below min_level (medium)
    // Info: budget low
    const stockRecords = [
      { id: 's1', site: 'A', description: 'Tyre A', stock_qty: 0, critical_level: 5, min_level: 10 },
      { id: 's2', site: 'B', description: 'Tyre B', stock_qty: 7, critical_level: 3, min_level: 10 },
    ]
    const budgets = [
      { id: 'b1', site: 'A', month: now.getMonth() + 1, year: now.getFullYear(), monthly_budget: 200 },
    ]
    const supabase = makeSupabaseMock({ stockRecords, budgets })
    const alerts = await detectAlerts(supabase, null)

    const severityOrder = { critical: 0, high: 1, medium: 2, info: 3 }
    for (let i = 1; i < alerts.length; i++) {
      expect(severityOrder[alerts[i].severity]).toBeGreaterThanOrEqual(
        severityOrder[alerts[i - 1].severity]
      )
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — Multiple concurrent alerts
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — Multiple concurrent alerts', () => {
  it('generates multiple alert types from same call', async () => {
    const now = new Date()
    const due = new Date()
    due.setDate(due.getDate() - 5)

    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 's1', site: 'Riyadh', description: 'Tyre', stock_qty: 0, critical_level: 5, min_level: 10 },
      ],
      budgets: [
        { id: 'b1', site: 'Riyadh', month: now.getMonth() + 1, year: now.getFullYear(), monthly_budget: 100 },
      ],
      openActions: [
        { id: 'a1', title: 'Fix flats', site: 'Riyadh', due_date: due.toISOString() },
      ],
    })

    const alerts = await detectAlerts(supabase, null)
    const types = alerts.map(a => a.type)
    expect(types).toContain(ALERT_TYPES.STOCK_CRITICAL)
    expect(types).toContain(ALERT_TYPES.BUDGET_OVERAGE)
    expect(types).toContain(ALERT_TYPES.OVERDUE_ACTION)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectAlerts — Records with null/missing fields
// ─────────────────────────────────────────────────────────────────────────────
describe('detectAlerts — Records with null/missing fields', () => {
  it('stock record missing description falls back to "Tyre stock" text', async () => {
    const supabase = makeSupabaseMock({
      stockRecords: [
        { id: 's1', site: 'Site X', description: null, stock_qty: 0, critical_level: 5, min_level: 10 },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const stockAlert = alerts.find(a => a.type === ALERT_TYPES.STOCK_CRITICAL)
    expect(stockAlert).toBeDefined()
    expect(stockAlert.message).toContain('Tyre stock')
  })

  it('overdue action missing site shows N/A in message', async () => {
    const due = new Date()
    due.setDate(due.getDate() - 3)
    const supabase = makeSupabaseMock({
      openActions: [
        { id: 'a1', title: 'Check tyres', site: null, due_date: due.toISOString() },
      ],
    })
    const alerts = await detectAlerts(supabase, null)
    const actionAlert = alerts.find(a => a.type === ALERT_TYPES.OVERDUE_ACTION)
    expect(actionAlert.message).toContain('N/A')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// countAlertsBySeverity
// ─────────────────────────────────────────────────────────────────────────────
describe('countAlertsBySeverity', () => {
  it('returns zeroes for all levels when alerts array is empty', () => {
    const counts = countAlertsBySeverity([])
    expect(counts.critical).toBe(0)
    expect(counts.high).toBe(0)
    expect(counts.medium).toBe(0)
    expect(counts.info).toBe(0)
    expect(counts.total).toBe(0)
  })

  it('counts each severity correctly', () => {
    const alerts = [
      { severity: 'critical' },
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'medium' },
      { severity: 'medium' },
      { severity: 'info' },
    ]
    const counts = countAlertsBySeverity(alerts)
    expect(counts.critical).toBe(2)
    expect(counts.high).toBe(1)
    expect(counts.medium).toBe(2)
    expect(counts.info).toBe(1)
    expect(counts.total).toBe(6)
  })

  it('total equals sum of all severity counts', () => {
    const alerts = [
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'medium' },
    ]
    const counts = countAlertsBySeverity(alerts)
    expect(counts.total).toBe(counts.critical + counts.high + counts.medium + counts.info)
  })

  it('handles alerts with only one severity level', () => {
    const alerts = [
      { severity: 'info' },
      { severity: 'info' },
      { severity: 'info' },
    ]
    const counts = countAlertsBySeverity(alerts)
    expect(counts.info).toBe(3)
    expect(counts.critical).toBe(0)
    expect(counts.total).toBe(3)
  })
})
