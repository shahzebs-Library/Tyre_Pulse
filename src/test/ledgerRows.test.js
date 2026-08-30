import { describe, expect, it } from 'vitest'
import { filterLedgerRows } from '../lib/ledgerRows'

const columns = [
  { key: 'site' },
  { key: 'reference' },
  { key: '__actions' },
]

describe('filterLedgerRows', () => {
  const rows = [
    { id: 1, site: 'Riyadh', reference: 'DN-100', active: true, rejected: false },
    { id: 2, site: 'Jeddah', reference: 'DN-200', active: false, rejected: 'yes' },
    { id: 3, site: 'Dammam', reference: 'DN-300', active: true, rejected: false },
  ]

  it('searches every declared data column case-insensitively', () => {
    expect(filterLedgerRows(rows, columns, { query: 'dn-200' }).map((row) => row.id)).toEqual([2])
    expect(filterLedgerRows(rows, columns, { query: 'RIYADH' }).map((row) => row.id)).toEqual([1])
  })

  it('filters site state without treating a missing active flag as inactive', () => {
    const withLegacyRow = [...rows, { id: 4, site: 'Legacy' }]
    expect(filterLedgerRows(withLegacyRow, columns, { stateField: 'active', state: 'active' }).map((row) => row.id))
      .toEqual([1, 3, 4])
    expect(filterLedgerRows(withLegacyRow, columns, { stateField: 'active', state: 'inactive' }).map((row) => row.id))
      .toEqual([2])
  })

  it('normalizes production rejection values and combines state with search', () => {
    expect(filterLedgerRows(rows, columns, { stateField: 'rejected', state: 'rejected' }).map((row) => row.id))
      .toEqual([2])
    expect(filterLedgerRows(rows, columns, {
      query: 'dammam',
      stateField: 'rejected',
      state: 'approved',
    }).map((row) => row.id)).toEqual([3])
  })

  it('tolerates missing inputs', () => {
    expect(filterLedgerRows(null, null, { query: 'anything' })).toEqual([])
  })
})
