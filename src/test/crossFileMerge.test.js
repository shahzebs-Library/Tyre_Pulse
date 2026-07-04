import { describe, it, expect } from 'vitest'
import { mergeCrossFileRows } from '../lib/import'

/**
 * Cross-file merge (cost-of-record wins).
 *
 * The Gulf scenario: one Job Card (work_order_no) is described in two files:
 *   - "Vehicle Complaints History" - operational detail, NO cost columns.
 *   - "Work Order Details"         - the cost of record (tyre_cost, summed).
 *
 * The legacy engine classified the second file's row as a duplicate and skipped
 * it. The correct behaviour merges them into ONE record where the cost file wins
 * conflicts and the complaint file enriches the blanks.
 */

// Build an annotated wizard row the way runValidation/aggregateStagedRows do:
// { raw, mapped, transformed, custom:{line_items,line_count}, validationStatus, issues }.
function stageRow(transformed, { validationStatus = 'ready', issues = [], custom = {} } = {}) {
  const raw = { ...transformed }
  return {
    raw,
    mapped: { ...transformed },
    transformed: { ...transformed },
    custom: { line_items: [raw], line_count: 1, ...custom },
    validationStatus,
    issues,
  }
}

describe('import engine - cross-file merge (cost-of-record wins)', () => {
  it('(a) collapses the same natural key across two files into a single record', () => {
    const complaints = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0001', asset_no: 'BH009',
      site: 'KSP-TP', complaint: 'Tyre pressure',
    })
    const workOrderDetails = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0001', asset_no: 'BH009',
      tyre_cost: 131, total_cost: 131,
    })

    const merged = mergeCrossFileRows([complaints, workOrderDetails], 'workorder')
    expect(merged).toHaveLength(1)
    expect(merged[0].transformed.work_order_no).toBe('GCKR/JC/0001')
    expect(merged[0].crossFileMerged).toBe(true)
    expect(merged[0].mergedFrom).toBe(2)
  })

  it('(b) the cost file wins a conflicting field regardless of file order', () => {
    // Both files carry asset_no but disagree; the cost file (Work Order Details)
    // must win. Assert order-independence by trying both input orders.
    const complaints = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0002', asset_no: 'WRONG-99',
    })
    const cost = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0002', asset_no: 'BH010', tyre_cost: 250,
    })

    const a = mergeCrossFileRows([complaints, cost], 'workorder')
    const b = mergeCrossFileRows([cost, complaints], 'workorder')
    expect(a[0].transformed.asset_no).toBe('BH010')
    expect(b[0].transformed.asset_no).toBe('BH010')
    expect(a[0].transformed.tyre_cost).toBe(250)
    expect(b[0].transformed.tyre_cost).toBe(250)
  })

  it('(c) a field blank in the cost file is enriched from the other file', () => {
    const complaints = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0003', asset_no: 'BH011',
      site: 'KSP-TP', complaint: 'Puncture', opened_at: '2026-02-02',
    })
    const cost = stageRow({
      // Work Order Details has the cost but no site/complaint/opened_at.
      country: 'KSA', work_order_no: 'GCKR/JC/0003', asset_no: 'BH011', tyre_cost: 90,
    })

    const merged = mergeCrossFileRows([cost, complaints], 'workorder')
    expect(merged).toHaveLength(1)
    // Cost preserved from the cost file...
    expect(merged[0].transformed.tyre_cost).toBe(90)
    // ...blanks enriched from the complaint file.
    expect(merged[0].transformed.site).toBe('KSP-TP')
    expect(merged[0].transformed.complaint).toBe('Puncture')
    expect(merged[0].transformed.opened_at).toBe('2026-02-02')
  })

  it('(c2) a cost field is NEVER back-filled from a non-cost file', () => {
    // Cost row leaves total_cost blank; the complaint file must not supply cost.
    const complaints = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0009', asset_no: 'BH019', total_cost: 9999,
    })
    const cost = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0009', asset_no: 'BH019', tyre_cost: 100,
    })

    // The cost row is the one with more populated cost fields (tyre_cost). Its
    // blank total_cost must stay blank, not inherit the complaint file's 9999.
    const merged = mergeCrossFileRows([cost, complaints], 'workorder')
    expect(merged[0].transformed.tyre_cost).toBe(100)
    expect(merged[0].transformed.total_cost).toBeUndefined()
  })

  it('(d) unrelated natural keys stay as separate records, order preserved', () => {
    const r1 = stageRow({ country: 'KSA', work_order_no: 'JC/A', asset_no: 'A1', tyre_cost: 10 })
    const r2 = stageRow({ country: 'KSA', work_order_no: 'JC/B', asset_no: 'B1', tyre_cost: 20 })
    const r3 = stageRow({ country: 'KSA', work_order_no: 'JC/C', asset_no: 'C1' })

    const merged = mergeCrossFileRows([r1, r2, r3], 'workorder')
    expect(merged).toHaveLength(3)
    expect(merged.map((r) => r.transformed.work_order_no)).toEqual(['JC/A', 'JC/B', 'JC/C'])
    // Distinct-country rows are also distinct even with the same WO number.
    const cross = mergeCrossFileRows(
      [stageRow({ country: 'KSA', work_order_no: 'JC/X', asset_no: 'X1' }),
        stageRow({ country: 'UAE', work_order_no: 'JC/X', asset_no: 'X9' })],
      'workorder',
    )
    expect(cross).toHaveLength(2)
  })

  it('(e) line-item aggregation is preserved across the merge (no double-counted cost)', () => {
    // Work Order Details already aggregated two store-issue lines per file:
    // tyre_cost summed to 300 with both source lines kept in custom.line_items.
    const cost = stageRow(
      { country: 'KSA', work_order_no: 'GCKR/JC/0100', asset_no: 'BH050', tyre_cost: 300 },
      { custom: { line_items: [{ Trye: 120 }, { Trye: 180 }], line_count: 2 } },
    )
    const complaints = stageRow({
      country: 'KSA', work_order_no: 'GCKR/JC/0100', asset_no: 'BH050', complaint: 'Wear',
    })

    const merged = mergeCrossFileRows([cost, complaints], 'workorder')
    expect(merged).toHaveLength(1)
    // Aggregated cost is carried through unchanged (never re-summed / doubled).
    expect(merged[0].transformed.tyre_cost).toBe(300)
    // Every source line from BOTH files is preserved for audit.
    expect(merged[0].custom.line_items).toHaveLength(3)
    expect(merged[0].custom.line_count).toBe(3)
    expect(merged[0].transformed.complaint).toBe('Wear')
  })

  it('rolls up the worst validation status and de-duplicates issues', () => {
    const cost = stageRow(
      { country: 'KSA', work_order_no: 'JC/W', asset_no: 'W1', tyre_cost: 50 },
      { validationStatus: 'ready' },
    )
    const complaints = stageRow(
      { country: 'KSA', work_order_no: 'JC/W', asset_no: 'W1' },
      { validationStatus: 'warning', issues: [{ code: 'DATE_AMBIGUOUS', field: 'opened_at', severity: 'warning', message: 'x' }] },
    )
    const merged = mergeCrossFileRows([cost, complaints], 'workorder')
    expect(merged[0].validationStatus).toBe('warning')
    expect(merged[0].issues).toHaveLength(1)
    expect(merged[0].issues[0].code).toBe('DATE_AMBIGUOUS')
  })

  it('is side-effect-free: inputs are never mutated', () => {
    const complaints = stageRow({ country: 'KSA', work_order_no: 'JC/P', asset_no: 'BAD' })
    const cost = stageRow({ country: 'KSA', work_order_no: 'JC/P', asset_no: 'GOOD', tyre_cost: 5 })
    const snapshotComplaint = JSON.parse(JSON.stringify(complaints))
    const snapshotCost = JSON.parse(JSON.stringify(cost))

    mergeCrossFileRows([complaints, cost], 'workorder')
    expect(complaints).toEqual(snapshotComplaint)
    expect(cost).toEqual(snapshotCost)
  })

  it('passes rows without a usable natural key straight through', () => {
    const noKey = stageRow({ country: 'KSA' }) // no work_order_no
    const keyed = stageRow({ country: 'KSA', work_order_no: 'JC/K', asset_no: 'K1' })
    const merged = mergeCrossFileRows([noKey, keyed], 'workorder')
    expect(merged).toHaveLength(2)
  })
})
