/**
 * Regression cover for the add-stock LOCATION picker.
 *
 * `listStockSites` used to say `.limit(2000)`. PostgREST caps every response at
 * 1,000 rows whatever a limit says, and vehicle_fleet is 1,617 rows - so the
 * read returned 1,000, and because it is ordered by site the sites late in the
 * alphabet never reached the picker. Worse, the caller only falls back to
 * free-text entry on a THROWN error, never on a partial read, so a truncated
 * list looked exactly like a complete one.
 */
const state: {
  rows: Array<{ site: string | null }>
  error: any
  ranges: Array<[number, number]>
  orders: string[]
} = { rows: [], error: null, ranges: [], orders: [] }

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const b: any = {
        select: () => b,
        not: () => b,
        order: (col: string) => { state.orders.push(col); return b },
        range: (from: number, to: number) => {
          state.ranges.push([from, to])
          if (state.error) return Promise.resolve({ data: null, error: state.error })
          return Promise.resolve({ data: state.rows.slice(from, to + 1), error: null })
        },
      }
      return b
    },
  },
}))
jest.mock('../lib/recordQueue', () => ({ saveCommand: jest.fn() }))

import { listStockSites } from '../lib/stock'

beforeEach(() => {
  state.rows = []
  state.error = null
  state.ranges = []
  state.orders = []
})

describe('listStockSites', () => {
  it('pages past the 1000-row cap so late-alphabet sites still reach the picker', async () => {
    // 1,617 fleet rows: the first 1,000 are one site, the tail is another. An
    // un-paged read would return only the first site.
    state.rows = [
      ...Array.from({ length: 1000 }, () => ({ site: 'AMAALA' })),
      ...Array.from({ length: 617 }, () => ({ site: 'YANBU' })),
    ]
    const out = await listStockSites()
    expect(out).toEqual(['AMAALA', 'YANBU'])
    expect(state.ranges.length).toBeGreaterThan(1)
    expect(state.ranges[0]).toEqual([0, 999])
  })

  it('orders on a UNIQUE tiebreak so a page boundary cannot drop or repeat rows', async () => {
    await listStockSites()
    expect(state.orders).toContain('id')
  })

  it('dedupes, trims and sorts the site names', async () => {
    state.rows = [{ site: ' RUMAH ' }, { site: 'NHC' }, { site: 'RUMAH' }, { site: null }, { site: '  ' }]
    expect(await listStockSites()).toEqual(['NHC', 'RUMAH'])
  })

  it('degrades to [] (free-text entry) when the read fails', async () => {
    state.error = { message: 'boom' }
    expect(await listStockSites()).toEqual([])
  })
})
