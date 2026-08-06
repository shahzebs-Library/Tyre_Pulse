/**
 * Messaging the team.
 *
 * The rules worth pinning are the ones that stop a sender believing they
 * reached people they did not: reach must never be overstated, a half written
 * translation must not go out as if it were finished, and an audience with
 * nobody in it must say so instead of rendering as blank.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const table = vi.fn()
function builder(result) {
  const b = {
    select() { return b },
    order() { return b },
    limit() { return b },
    then(res, rej) { return Promise.resolve(result).then(res, rej) },
  }
  return b
}
vi.mock('../lib/api/_client', () => ({
  supabase: { rpc: (...a) => rpc(...a), from: (...a) => table(...a) },
}))

const api = await import('../lib/api/broadcast')

beforeEach(() => { rpc.mockReset(); table.mockReset() })

describe('validateBroadcast', () => {
  it('requires a title and a message', () => {
    expect(api.validateBroadcast({ title: '', body: 'x' })).toBe('Add a title.')
    expect(api.validateBroadcast({ title: 'x', body: '   ' })).toBe('Add a message.')
  })

  it('refuses a half written translation rather than sending it', () => {
    // an Arabic body with no Arabic title would arrive titled in English and
    // bodied in Arabic - unfinished, not bilingual
    expect(api.validateBroadcast({ title: 'a', body: 'b', bodyAr: 'نص' })).toContain('both')
    expect(api.validateBroadcast({ title: 'a', body: 'b', titleAr: 'عنوان' })).toContain('both')
  })

  it('accepts English only, and accepts a complete translation', () => {
    expect(api.validateBroadcast({ title: 'a', body: 'b' })).toBe('')
    expect(api.validateBroadcast({ title: 'a', body: 'b', titleAr: 'ع', bodyAr: 'ن' })).toBe('')
  })

  it('keeps the title short enough to read on a phone', () => {
    expect(api.validateBroadcast({ title: 'x'.repeat(121), body: 'b' })).toContain('120')
  })
})

describe('reachNote', () => {
  it('never implies a phone reach the device count does not support', () => {
    // 35 people of whom 0 carry the app is not a message to 35 phones
    const note = api.reachNote({ total: 35, with_app: 0 })
    expect(note).toContain('35 people will see it in the app')
    expect(note).toContain('no push will be delivered')
  })

  it('states the phone count separately when there is one', () => {
    expect(api.reachNote({ total: 16, with_app: 1 }))
      .toBe('16 people will see it in the app, and 1 of them has the phone app, so that one gets a push too.')
  })

  it('says plainly when nobody matches', () => {
    expect(api.reachNote({ total: 0, with_app: 0 })).toBe('Nobody matches this audience yet.')
    expect(api.reachNote()).toBe('Nobody matches this audience yet.')
  })
})

describe('audienceLabel', () => {
  it('calls an empty audience Everyone rather than rendering blank', () => {
    expect(api.audienceLabel({})).toBe('Everyone')
    expect(api.audienceLabel({ target_roles: [], target_countries: [] })).toBe('Everyone')
  })

  it('reads back the audience that was chosen', () => {
    expect(api.audienceLabel({
      target_roles: ['Tyre Man'], target_countries: ['KSA'], target_sites: ['NHC'],
    })).toBe('Tyre Man - KSA - NHC')
  })
})

describe('previewAudience', () => {
  it('asks the server, so the count shown is the one that decides delivery', async () => {
    rpc.mockResolvedValue({ data: { ok: true, total: 16, with_app: 1, by_role: [] }, error: null })
    const a = await api.previewAudience({ roles: ['Tyre Man'], countries: ['KSA'] })
    expect(rpc).toHaveBeenCalledWith('broadcast_audience',
      { p_roles: ['Tyre Man'], p_countries: ['KSA'], p_sites: [] })
    expect(a).toMatchObject({ ok: true, total: 16, with_app: 1 })
  })

  it('degrades to zero before the feature is provisioned, and never to a fake count', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function' } })
    await expect(api.previewAudience()).resolves.toEqual({ ok: false, total: 0, with_app: 0, by_role: [] })
  })

  it('still throws on a real failure', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied', code: '42501' } })
    await expect(api.previewAudience()).rejects.toBeTruthy()
  })
})

describe('sendBroadcast', () => {
  it('sends blank Arabic as null rather than an empty string', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 'b1', recipients: 3, pushes_queued: 1 }, error: null })
    await api.sendBroadcast({ title: 'a', body: 'b', titleAr: '', bodyAr: '' })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_title_ar: null, p_body_ar: null, p_send_push: true })
  })

  it('reports the real counts back', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 'b1', recipients: 16, pushes_queued: 1 }, error: null })
    await expect(api.sendBroadcast({ title: 'a', body: 'b' }))
      .resolves.toMatchObject({ ok: true, recipients: 16, pushes_queued: 1 })
  })

  it('surfaces a refusal instead of pretending it sent', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'empty' }, error: null })
    const r = await api.sendBroadcast({ title: '', body: '' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
    expect(r.recipients).toBe(0)
  })
})

describe('listBroadcasts', () => {
  it('returns an empty history before the table exists', async () => {
    table.mockReturnValue(builder({ data: null, error: { message: 'relation does not exist' } }))
    await expect(api.listBroadcasts()).resolves.toEqual([])
  })
})
