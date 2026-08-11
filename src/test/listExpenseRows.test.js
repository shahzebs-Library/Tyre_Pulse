import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * "Download rows (Excel)" produced an EMPTY workbook over a table holding
 * 208,375 expense lines, and told the owner "No expense rows in this period."
 *
 * The cause was a single wrong key: fetchAllPages resolves { data, error,
 * truncated }, and listExpenseRows destructured `rows`, which is always
 * undefined. `rows || []` then turned that into a clean empty result, so the
 * bug produced no error anywhere - it looked exactly like a period with no
 * expenses.
 *
 * This pins the contract between the two, because nothing else can: the page
 * cannot tell "no data" from "read the wrong key" on its own.
 */

const fetchAllPages = vi.fn()
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: (...a) => fetchAllPages(...a) }))
vi.mock('../lib/api/_client', () => ({
  supabase: {
    from: () => {
      const q = {
        select: () => q, order: () => q, range: () => q, eq: () => q, gte: () => q, lte: () => q,
      }
      return q
    },
  },
}))

const { listExpenseRows } = await import('../lib/api/partsConsumption')

beforeEach(() => fetchAllPages.mockReset())

describe('listExpenseRows', () => {
  it('returns the rows fetchAllPages produced - the bug that emptied the export', () => {
    // fetchAllPages resolves `data`. Reading any other key silently yields [].
    fetchAllPages.mockResolvedValue({
      data: [{ event_date: '2026-08-01', line_cost: 100 }, { event_date: '2026-08-02', line_cost: 250 }],
      error: null, truncated: false,
    })
    return listExpenseRows({ country: 'KSA' }).then((res) => {
      expect(res.rows).toHaveLength(2)
      expect(res.rows[0].line_cost).toBe(100)
      expect(res.truncated).toBe(false)
    })
  })

  it('surfaces the cap so a truncated export is never silent', async () => {
    fetchAllPages.mockResolvedValue({ data: [{ line_cost: 1 }], error: null, truncated: true })
    expect((await listExpenseRows({})).truncated).toBe(true)
  })

  it('throws on a read error instead of returning an empty export', async () => {
    // An empty workbook and a failed read must never look the same to the page.
    fetchAllPages.mockResolvedValue({ data: [], error: new Error('denied'), truncated: false })
    await expect(listExpenseRows({})).rejects.toThrow('denied')
  })

  it('returns an empty list only when the read genuinely found nothing', async () => {
    fetchAllPages.mockResolvedValue({ data: [], error: null, truncated: false })
    expect((await listExpenseRows({})).rows).toEqual([])
  })

  it('scopes by country only when one is chosen', async () => {
    fetchAllPages.mockResolvedValue({ data: [], error: null, truncated: false })
    await listExpenseRows({ country: 'All' })
    await listExpenseRows({ country: 'KSA' })
    expect(fetchAllPages).toHaveBeenCalledTimes(2)
  })
})
