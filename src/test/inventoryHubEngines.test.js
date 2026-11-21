import { describe, it, expect } from 'vitest'
import { resolveSection, visibleGroups, makeCan, SECTION_KEYS, sectionGroup } from '../lib/inventory/hubSections'
import { sumByCurrency, balanceValue, isOwned, formatMoney, formatTotals } from '../lib/inventory/inventoryMoney'
import {
  sanitizeCounterLines, validateAuditDraft, availableActions, canApproveAdjustment, buildReconciliationRows,
  needsRecount, summarizeReconciliation, nextDiscrepancyStatuses, discrepancyReadyForApproval,
} from '../lib/inventory/auditView'
import { buildTree, flattenTree, filterTree, labelCode, parseLabelCode, validateLocationDraft } from '../lib/inventory/locationTree'
import { mapHeaders, missingRequired, mapRows, summarizeBatch, canApproveBatch } from '../lib/inventory/openingBalance'
import { summarizeCustody, conflictEvidence, isOpenConflict } from '../lib/inventory/tyreInventoryView'
import { makeReportRef, describeFilters, exportRowsFor, reportByKey } from '../lib/inventory/reportCatalog'
import { available, belowReorder, summarizeBalances, reorderSignals } from '../lib/inventory/balanceView'

describe('hub sections', () => {
  it('has the seventeen sections and resolves unknown params to overview', () => {
    expect(SECTION_KEYS).toHaveLength(17)
    expect(resolveSection('AUDITS')).toBe('audits')
    expect(resolveSection('nope')).toBe('overview')
    expect(resolveSection(undefined)).toBe('overview')
    expect(sectionGroup('tyres')).toBe('assets')
  })
  it('hides valuation without view_value and never renders an empty group', () => {
    const groups = visibleGroups(() => false)
    const keys = groups.flatMap((g) => g.sections.map((s) => s.key))
    expect(keys).not.toContain('valuation')
    expect(groups.every((g) => g.sections.length > 0)).toBe(true)
    const all = visibleGroups(() => true).flatMap((g) => g.sections.map((s) => s.key))
    expect(all).toContain('valuation')
  })
  it('falls back to standard capabilities but prefers a dedicated grant', () => {
    const caps = { 'stock:edit': true }
    const can = makeCan({ hasCapability: (m, c) => !!caps[`${m}:${c}`], canExport: () => false })
    expect(can('count')).toBe(true)
    expect(can('adjustment_approve')).toBe(false)
    expect(can('export')).toBe(false)
    expect(makeCan({})('view')).toBe(false)
  })
})

describe('inventory money', () => {
  it('sums per currency, never blends, counts unvalued separately', () => {
    const rows = [
      { qty_on_hand: 2, avg_unit_cost: 10, currency: 'sar' },
      { qty_on_hand: 1, avg_unit_cost: 5, currency: 'AED' },
      { qty_on_hand: 3, avg_unit_cost: null, currency: 'SAR' },
      { qty_on_hand: 1, avg_unit_cost: 1, currency: '' },
    ]
    const s = sumByCurrency(rows, balanceValue, (r) => r.currency)
    expect(s.totals).toEqual([{ currency: 'AED', amount: 5, rows: 1 }, { currency: 'SAR', amount: 20, rows: 1 }])
    expect(s.unvalued).toBe(1)
    expect(s.noCurrency).toBe(1)
    expect(s.mixed).toBe(true)
    expect(formatTotals(s.totals)).toBe('AED 5.00 | SAR 20.00')
  })
  it('renders N/A instead of 0 and treats consignment as not owned', () => {
    expect(formatMoney(null, 'SAR')).toBe('N/A')
    expect(formatTotals([])).toBe('N/A')
    expect(isOwned({ ownership: 'consignment' })).toBe(false)
    expect(isOwned({})).toBe(true)
  })
})

describe('audit view', () => {
  it('strips expected figures from counter lines', () => {
    const [l] = sanitizeCounterLines([{ item_code: 'A', expected_qty: 9, unit_cost: 3, book_qty: 9, variance: 1 }])
    expect(l).toEqual({ item_code: 'A' })
  })
  it('validates the create form including counter != reviewer and no past due date', () => {
    const now = new Date('2026-11-19T10:00:00')
    const bad = validateAuditDraft({ audit_type: 'cycle', site: 'NHC', counter_id: 'u1', reviewer_id: 'u1', due_at: '2026-11-18' }, { now })
    expect(bad.errors.reviewer_id).toBe('inventory.audits.errors.sameReviewer')
    expect(bad.errors.due_at).toBe('inventory.audits.errors.duePast')
    expect(validateAuditDraft({ audit_type: 'cycle', site: 'NHC', counter_id: 'u1', reviewer_id: 'u2', due_at: '2026-11-19' }, { now }).ok).toBe(true)
  })
  it('never offers approve or reconcile to the counter', () => {
    const can = () => true
    const audit = { status: 'approval', counter_id: 'c', created_by: 'x' }
    expect(availableActions(audit, 'c', can)).not.toContain('approve')
    expect(availableActions(audit, 'x', can)).not.toContain('approve')
    expect(availableActions(audit, 'z', can)).toContain('approve')
    expect(availableActions({ status: 'counting_completed', counter_id: 'c' }, 'c', can)).not.toContain('reconcile')
    expect(availableActions({ status: 'in_progress', counter_id: 'c' }, 'c', can)).toContain('count')
    expect(availableActions({ status: 'in_progress', counter_id: 'c' }, 'z', can)).not.toContain('count')
    // assignment-based, as inv_count_submit: the approved recounter counts without the 'count' capability
    expect(availableActions({ status: 'recount', counter_id: 'c', recount_counter_id: 'r' }, 'r', () => false)).toContain('count')
    expect(availableActions({ status: 'recount', counter_id: 'c', recount_counter_id: 'r' }, 'c', () => true)).not.toContain('count')
  })
  it('converts the correct quantity a person enters into the signed correction the server stores, and back', async () => {
    const { targetToCorrection, correctionToTarget } = await import('../lib/inventory/auditView')
    expect(targetToCorrection({ expected_qty: 6 }, '4')).toBe(-2)
    expect(targetToCorrection({ expected_qty: 6 }, 9)).toBe(3)
    expect(targetToCorrection({ expected_qty: null }, 2)).toBe(2) // an unexpected line has no book quantity
    expect(targetToCorrection({ expected_qty: 6 }, '')).toBeNull()
    expect(targetToCorrection({ expected_qty: 6 }, -1)).toBeNull()
    expect(correctionToTarget({ expected_qty: 6, proposed_qty: -2 })).toBe('4')
    expect(correctionToTarget({ expected_qty: 6, proposed_qty: null })).toBe('')
  })
  it('offers "finish counting" to the counter, recounter, creator or an audit_create holder only', () => {
    const none = () => false
    expect(availableActions({ status: 'in_progress', counter_id: 'c' }, 'c', none)).toContain('finish')
    expect(availableActions({ status: 'in_progress', counter_id: 'c' }, 'z', none)).not.toContain('finish')
    expect(availableActions({ status: 'in_progress', counter_id: 'c' }, 'z', (c) => c === 'audit_create')).toContain('finish')
    expect(availableActions({ status: 'recount', counter_id: 'c', recount_counter_id: 'r' }, 'r', none)).toContain('finish')
    expect(availableActions({ status: 'counting_completed', counter_id: 'c' }, 'c', none)).not.toContain('finish')
  })
  it('enforces segregation of duties for adjustment approval', () => {
    const can = (c) => c === 'adjustment_approve'
    expect(canApproveAdjustment({ audit: { counter_id: 'c' }, userId: 'c', can }).reason).toBe('inventory.approve.segregation')
    expect(canApproveAdjustment({ audit: { counter_id: 'c' }, adjustment: { created_by: 'm' }, userId: 'm', can }).ok).toBe(false)
    expect(canApproveAdjustment({ audit: { counter_id: 'c' }, userId: 'm', can }).ok).toBe(true)
    expect(canApproveAdjustment({ audit: {}, userId: 'm', can: () => false }).reason).toBe('inventory.approve.noCapability')
  })
  it('builds reconciliation with latest round, null for uncounted, unexpected lines', () => {
    const snapshot = [
      { location_id: 'L1', item_id: 'I1', expected_qty: 10, expected_cost: 5, currency: 'SAR' },
      { location_id: 'L1', item_id: 'I2', expected_qty: 4, expected_cost: 2, currency: 'SAR' },
      { location_id: 'L1', item_id: 'I3', expected_qty: 1, expected_cost: null, currency: 'SAR' },
    ]
    const counts = [
      { location_id: 'L1', item_id: 'I1', counted_qty: 7, round: 1 },
      { location_id: 'L1', item_id: 'I1', counted_qty: 9, round: 2 },
      { location_id: 'L1', item_id: 'I3', confirmed_zero: true, counted_qty: null, round: 1 },
      { location_id: 'L2', item_id: 'I9', counted_qty: 2, round: 1 },
    ]
    const rows = buildReconciliationRows(snapshot, counts)
    const by = Object.fromEntries(rows.map((r) => [r.item_id, r]))
    expect(by.I1).toMatchObject({ counted_qty: 9, variance: -1, value_impact: -5, status: 'short', round: 2 })
    expect(by.I2).toMatchObject({ counted_qty: null, variance: null, status: 'not_counted' })
    expect(by.I3).toMatchObject({ counted_qty: 0, variance: -1, value_impact: null })
    expect(by.I9).toMatchObject({ status: 'unexpected', expected_qty: 0, counted_qty: 2 })
    const sum = summarizeReconciliation(rows)
    expect(sum.byStatus).toMatchObject({ short: 2, not_counted: 1, unexpected: 1 })
    expect(sum.net.totals).toEqual([{ currency: 'SAR', amount: -5, rows: 1 }])
    expect(sum.abs.totals[0].amount).toBe(5)
    expect(sum.accuracyPct).toBe(0)
  })
  it('sums every line of the latest round per item/location, like inv_audit_reconcile', () => {
    const snapshot = [{ location_id: 'L1', item_id: 'I1', expected_qty: 10, expected_cost: 2, currency: 'SAR' }]
    const counts = [
      { location_id: 'L1', item_id: 'I1', counted_qty: 50, round: 1 },
      { location_id: 'L1', item_id: 'I1', counted_qty: 4, round: 2, counted_at: '2026-11-20T10:00:00Z' },
      { location_id: 'L1', item_id: 'I1', counted_qty: 5, round: 2, counted_at: '2026-11-20T10:05:00Z' },
      { location_id: 'L1', item_id: 'I1', confirmed_zero: true, counted_qty: null, round: 2 },
      { location_id: 'L2', item_id: 'I9', counted_qty: 1, round: 1 },
      { location_id: 'L2', item_id: 'I9', counted_qty: 2, round: 1 },
    ]
    const by = Object.fromEntries(buildReconciliationRows(snapshot, counts).map((r) => [r.item_id, r]))
    expect(by.I1).toMatchObject({ counted_qty: 9, variance: -1, value_impact: -2, status: 'short', round: 2 })
    expect(by.I9).toMatchObject({ status: 'unexpected', counted_qty: 3, variance: 3 })
  })
  it('gives serial lines zero tolerance and quantity lines a band', () => {
    expect(needsRecount({ status: 'short', variance: -1, serial_no: 'S1', expected_qty: 1, value_impact: null })).toBe(true)
    expect(needsRecount({ status: 'short', variance: -1, expected_qty: 100, value_impact: -10 })).toBe(false)
    expect(needsRecount({ status: 'short', variance: -5, expected_qty: 100, value_impact: -10 })).toBe(true)
    expect(needsRecount({ status: 'short', variance: -1, expected_qty: 100, value_impact: -900 })).toBe(true)
    expect(needsRecount({ status: 'match', variance: 0 })).toBe(false)
    expect(needsRecount({ status: 'not_counted', variance: null })).toBe(true)
  })
  it('keeps discrepancy approval outside the investigation flow', () => {
    expect(nextDiscrepancyStatuses('investigating')).toEqual(['proposed', 'closed'])
    expect(nextDiscrepancyStatuses('approved')).toEqual([])
    expect(discrepancyReadyForApproval({ category: 'damaged', investigation_notes: 'x', proposed_qty: 0 }).ok).toBe(true)
    expect(discrepancyReadyForApproval({ category: 'damaged' }).missing).toEqual(['notes', 'proposed_qty'])
  })
})

describe('location tree', () => {
  const rows = [
    { id: 'w', code: 'WH1', name: 'Main', location_type: 'warehouse', site: 'NHC' },
    { id: 'z2', code: 'Z10', name: 'Zone 10', parent_id: 'w', location_type: 'zone', site: 'NHC' },
    { id: 'z1', code: 'Z2', name: 'Zone 2', parent_id: 'w', location_type: 'zone', site: 'NHC' },
    { id: 'b', code: 'B1', name: 'Bin', parent_id: 'z1', location_type: 'bin', site: 'NHC' },
    { id: 'o', code: 'O1', name: 'Orphan', parent_id: 'gone', location_type: 'bin', site: 'NHC' },
    { id: 'c1', code: 'C1', name: 'Cyc1', parent_id: 'c2', location_type: 'bin', site: 'NHC' },
    { id: 'c2', code: 'C2', name: 'Cyc2', parent_id: 'c1', location_type: 'bin', site: 'NHC' },
  ]
  it('builds a numeric-sorted tree, keeps orphans and cuts cycles', () => {
    const roots = buildTree(rows)
    const flat = flattenTree(roots)
    expect(flat).toHaveLength(7)
    const w = roots.find((r) => r.id === 'w')
    expect(w.children.map((c) => c.code)).toEqual(['Z2', 'Z10'])
    expect(flat.find((n) => n.id === 'b').path).toBe('Main / Zone 2 / Bin')
    expect(roots.map((r) => r.id)).toEqual(expect.arrayContaining(['o', 'c1', 'c2']))
  })
  it('filters keeping ancestors', () => {
    const f = filterTree(buildTree(rows), 'bin')
    expect(flattenTree(f).some((n) => n.id === 'w')).toBe(true)
  })
  it('makes and reads label codes', () => {
    expect(labelCode('abc')).toBe('TP:LOC:abc')
    expect(parseLabelCode('https://x/y?c=tp:loc:abc-1')).toBe('abc-1')
    expect(parseLabelCode('nothing')).toBeNull()
  })
  it('validates codes, uniqueness per site and self-parenting', () => {
    expect(validateLocationDraft({ code: 'b1', name: 'x', location_type: 'bin', site: 'NHC' }, rows).errors.code).toBe('inventory.locations.errors.codeTaken')
    expect(validateLocationDraft({ code: 'B1', name: 'x', location_type: 'bin', site: 'JED' }, rows).ok).toBe(true)
    expect(validateLocationDraft({ id: 'q', parent_id: 'q', code: 'Q', name: 'x', location_type: 'bin', site: 'NHC' }).errors.parent_id).toBeTruthy()
    expect(validateLocationDraft({ code: '-bad', name: 'x', location_type: 'bin', site: 'NHC' }).errors.code).toBe('inventory.locations.errors.codeFormat')
  })
})

describe('opening balance', () => {
  it('maps headers by synonym and reports missing required fields', () => {
    const m = mapHeaders(['Item Code', 'Bin', 'Qty On Hand', 'Unit Cost'])
    expect(m).toMatchObject({ item_code: 'Item Code', location_code: 'Bin', qty: 'Qty On Hand', unit_cost: 'Unit Cost' })
    expect(missingRequired({ item_code: 'x' })).toEqual(['location_code', 'qty'])
  })
  it('flags missing cost without pricing it at 0, refuses negatives and duplicates', () => {
    const m = { item_code: 'i', location_code: 'l', qty: 'q', unit_cost: 'c' }
    const lines = mapRows([
      { i: 'A', l: 'B1', q: '5', c: '' },
      { i: 'A', l: 'B1', q: '1', c: '2' },
      { i: 'C', l: 'B1', q: '-1', c: '2' },
      { i: 'D', l: 'B1', q: '1,000', c: '3' },
    ], m, { defaultCurrency: 'SAR' })
    expect(lines[0]).toMatchObject({ missing_cost: true, unit_cost: null, issues: [] })
    expect(lines[1].issues).toContain('duplicate')
    expect(lines[2].issues).toContain('negative_qty')
    expect(lines[3]).toMatchObject({ qty: 1000, currency: 'SAR' })
    const s = summarizeBatch(lines)
    expect(s).toMatchObject({ lines: 4, ready: 2, blocking: 2, missingCost: 1 })
    expect(s.value.totals).toEqual([{ currency: 'SAR', amount: 3000, rows: 1 }])
    expect(s.value.unvalued).toBe(1)
  })
  it('requires an independent approver', () => {
    const can = () => true
    expect(canApproveBatch({ status: 'submitted', created_by: 'a' }, 'a', can).ok).toBe(false)
    expect(canApproveBatch({ status: 'draft', created_by: 'a' }, 'b', can).ok).toBe(false)
    expect(canApproveBatch({ status: 'submitted', created_by: 'a' }, 'b', can).ok).toBe(true)
  })
})

describe('tyre inventory view', () => {
  it('keeps unknown counts null and totals only known states', () => {
    const s = summarizeCustody({ new_stock: 3, fitted: 10, unknown: 2 })
    expect(s.complete).toBe(false)
    expect(s.total).toBe(15)
    expect(s.inStock).toBe(3)
    expect(summarizeCustody({}).total).toBeNull()
  })
  it('flattens evidence from object or array', () => {
    expect(conflictEvidence({ evidence: { scrap_mark: 'yes' } })).toEqual([{ label: 'scrap mark', value: 'yes' }])
    expect(conflictEvidence({ evidence: [{ label: 'fitment', value: 'TM1 LHF1' }] })[0].label).toBe('fitment')
    expect(isOpenConflict({ status: 'resolved' })).toBe(false)
  })
})

describe('reports', () => {
  it('stamps a reference and describes filters', () => {
    expect(makeReportRef('register', new Date(2026, 10, 19, 14, 5))).toBe('INV-REGISTER-202611191405')
    expect(describeFilters({ country: 'KSA', site: 'NHC', from: '2026-11-01' })).toBe('Country: KSA | Site: NHC | From 2026-11-01 to today')
    expect(describeFilters({})).toBe('Country: All countries')
  })
  it('exports N/A for blanks and flattens evidence', () => {
    const rows = exportRowsFor(reportByKey('conflicts'), [{ serial_no: 'S', evidence: { a: 1 } }])
    expect(rows[0]).toMatchObject({ serial_no: 'S', status: 'N/A', evidence_text: '{"a":1}' })
  })
})

describe('balance view', () => {
  it('computes availability and reorder signals without inventing a reorder point', () => {
    expect(available({ qty_on_hand: 5, qty_reserved: 2 })).toBe(3)
    expect(belowReorder({ qty_on_hand: 5, qty_reserved: 2, reorder_point: 3 })).toBe(true)
    expect(belowReorder({ qty_on_hand: 1 })).toBe(false)
    const rows = [
      { item_code: 'A', qty_on_hand: 0, reorder_point: 4 },
      { item_code: 'B', qty_on_hand: 2, reorder_point: 3 },
      { item_code: 'C', qty_on_hand: 9, reorder_point: 3, ownership: 'consignment' },
    ]
    expect(reorderSignals(rows).map((r) => r.item_code)).toEqual(['A', 'B'])
    expect(summarizeBalances(rows)).toMatchObject({ lines: 3, items: 3, zero: 1, belowReorder: 2, consignmentLines: 1 })
  })
})
