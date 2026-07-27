/**
 * The scrap permission split and the scrapped register.
 *
 * These pin the two decisions that are easy to undo by accident:
 *
 *   - Marking a scrap and undoing one are SEPARATE rights, both answered by the
 *     server. Collapsing them back into one flag is exactly what handed a Tyre
 *     Data Collector either both buttons or neither.
 *   - Both FAIL CLOSED. A permission check that errors must not be read as
 *     "allowed", or a refused RPC gets a button in front of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a) => rpc(...a), from: () => { throw new Error('should not touch a table') } } }))

const api = await import('../lib/api/tyreExchange')

beforeEach(() => rpc.mockReset())

const answer = (map) => (name) => Promise.resolve(
  name in map ? map[name] : { data: null, error: { message: 'unexpected rpc ' + name } },
)

describe('getScrapPermissions', () => {
  it('reports the two rights independently', async () => {
    // the Tyre Data Collector case: may mark, may not undo
    rpc.mockImplementation(answer({
      tyre_scrap_allowed: { data: true, error: null },
      tyre_unscrap_allowed: { data: false, error: null },
    }))
    await expect(api.getScrapPermissions()).resolves.toEqual({ canScrap: true, canUndo: false })
  })

  it('gives an admin both', async () => {
    rpc.mockImplementation(answer({
      tyre_scrap_allowed: { data: true, error: null },
      tyre_unscrap_allowed: { data: true, error: null },
    }))
    await expect(api.getScrapPermissions()).resolves.toEqual({ canScrap: true, canUndo: true })
  })

  it('fails CLOSED when the check errors or the backend predates it', async () => {
    rpc.mockImplementation(answer({
      tyre_scrap_allowed: { data: null, error: { message: 'function does not exist' } },
      tyre_unscrap_allowed: { data: null, error: { message: 'function does not exist' } },
    }))
    await expect(api.getScrapPermissions()).resolves.toEqual({ canScrap: false, canUndo: false })
  })

  it('treats a non-true answer as no', async () => {
    // a null or a string must never be coerced into permission
    rpc.mockImplementation(answer({
      tyre_scrap_allowed: { data: null, error: null },
      tyre_unscrap_allowed: { data: 'yes', error: null },
    }))
    await expect(api.getScrapPermissions()).resolves.toEqual({ canScrap: false, canUndo: false })
  })
})

describe('listScrappedTyres', () => {
  it('passes the search and drops the All-countries token', async () => {
    rpc.mockResolvedValue({ data: { ok: true, rows: [], total: 0 }, error: null })
    await api.listScrappedTyres({ search: ' TM527 ', country: 'All' })
    expect(rpc).toHaveBeenCalledWith('list_scrapped_tyres',
      { p_search: 'TM527', p_country: null, p_limit: 500 })
  })

  it('keeps a real country', async () => {
    rpc.mockResolvedValue({ data: { ok: true, rows: [] }, error: null })
    await api.listScrappedTyres({ country: 'KSA' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_country: 'KSA', p_search: null })
  })

  it('returns the rows and the attribution counts', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        total: 3, marked_total: 2, unattributed_total: 1,
        rows: [{ serial: 'A1', marked: true, scrapped_by_name: 'IJAZ ALI SHAH' }],
      },
      error: null,
    })
    const out = await api.listScrappedTyres({})
    expect(out.total).toBe(3)
    expect(out.marked_total).toBe(2)
    // the unattributed count is the honest one: scrapped stock with no name on it
    expect(out.unattributed_total).toBe(1)
    expect(out.rows[0].scrapped_by_name).toBe('IJAZ ALI SHAH')
  })

  it('degrades to an empty register on a backend without the RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    const out = await api.listScrappedTyres({})
    expect(out).toEqual({ ok: false, rows: [], total: 0, marked_total: 0, unattributed_total: 0 })
  })

  it('still throws on a real failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } })
    await expect(api.listScrappedTyres({})).rejects.toBeTruthy()
  })

  it('never returns a non-array rows field', async () => {
    rpc.mockResolvedValue({ data: { ok: true, rows: null }, error: null })
    await expect(api.listScrappedTyres({})).resolves.toMatchObject({ rows: [] })
  })
})

describe('scrap mutations go through the gated RPCs, never the table', () => {
  it('updateScrapReason uses set_scrap_reason so the edit is gated and audited', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await api.updateScrapReason('A1', '  worn out  ')
    expect(rpc).toHaveBeenCalledWith('set_scrap_reason', { p_serial: 'A1', p_reason: 'worn out' })
  })

  it('unscrapTyreBySerial surfaces whether the real prior status was restored', async () => {
    // false means the mark predates the prior-status capture and the tyre was
    // set back to Active as a fallback - the caller has to be able to say so.
    rpc.mockResolvedValue({ data: { ok: true, restored_exactly: false }, error: null })
    await expect(api.unscrapTyreBySerial('A1')).resolves.toEqual({ ok: true, restoredExactly: false })
  })
})
