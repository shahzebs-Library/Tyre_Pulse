// Blind-count submit: extras resolved to ids, rejected lines kept on screen,
// and a retry resends the identical payload with the same request key.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { resolveLocationCode, pickItem, payloadSignature, splitSubmitResult } from '../lib/inventory/countSubmit'

const calls = []
const state = { submit: [] }
const VIEW = {
  audit: { id: 'a1' },
  lines: [{ id: 'l1', item_id: 'I1', location_id: 'L1', item_code: 'A' }],
  locations: [{ id: 'L1', code: 'NHC-A1', name: 'Rack A1' }, { id: 'L2', code: 'NHC-B1', name: 'Rack B1' }],
}
const MASTER = [{ id: 'I9', item_code: 'BOLT-9', item_name: 'Bolt', country: 'KSA', barcode: null }]

function builder(table) {
  const b = {}
  for (const m of ['select', 'eq', 'not', 'in', 'or', 'gte', 'lte', 'order', 'range', 'limit', 'is']) b[m] = () => b
  const res = () => ({ data: table === 'material_master' ? MASTER : [], error: null })
  b.maybeSingle = () => Promise.resolve(res())
  b.then = (ok, bad) => Promise.resolve(res()).then(ok, bad)
  return b
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (t) => builder(t),
    rpc: (fn, args) => {
      calls.push({ fn, args: JSON.parse(JSON.stringify(args)) })
      if (fn === 'inv_audit_counter_view') return Promise.resolve({ data: VIEW, error: null })
      const next = state.submit.shift()
      if (next instanceof Error) return Promise.reject(next)
      return Promise.resolve({ data: next, error: null })
    },
  },
}))

import AuditCounterView from '../components/inventory/AuditCounterView'
import { LanguageProvider } from '../contexts/LanguageContext'

const submits = () => calls.filter((c) => c.fn === 'inv_count_submit').map((c) => c.args.p_payload)
const ui = (props = {}) => render(<LanguageProvider><AuditCounterView audit={{ id: 'a1', country: 'KSA' }} {...props} /></LanguageProvider>)

async function fillAndConfirm() {
  fireEvent.change(await screen.findByLabelText('Counted quantity for A'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: /Add item found/ }))
  const inputs = screen.getAllByRole('textbox')
  // extra row: item, location, remarks are text inputs; quantity is a spinbutton
  fireEvent.change(inputs[0], { target: { value: 'bolt-9' } })
  fireEvent.change(inputs[1], { target: { value: 'nhc-b1' } })
  const qtys = screen.getAllByRole('spinbutton')
  fireEvent.change(qtys[qtys.length - 1], { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: /Submit count/ }))
  fireEvent.click(screen.getByRole('button', { name: /Yes, submit/ }))
}

beforeEach(() => { calls.length = 0; state.submit = [] })

describe('countSubmit helpers', () => {
  it('resolves location codes only within the audit and refuses guesses', () => {
    expect(resolveLocationCode(' nhc-a1 ', VIEW.locations)).toEqual({ id: 'L1', error: null })
    expect(resolveLocationCode('', VIEW.locations)).toEqual({ id: null, error: null })
    expect(resolveLocationCode('X', VIEW.locations).error).toBe('inventory.count.extraLocationUnknown')
    expect(resolveLocationCode('D', [{ id: 1, code: 'D' }, { id: 2, code: 'd' }]).error).toBe('inventory.count.extraLocationAmbiguous')
  })
  it('picks one item, preferring the audit country, never a guess', () => {
    const c = [{ id: 'k', item_code: 'T1', country: 'KSA' }, { id: 'u', item_code: 'T1', country: 'UAE' }]
    expect(pickItem('t1', c, 'KSA')).toEqual({ id: 'k', error: null })
    expect(pickItem('t1', c, null).error).toBe('inventory.count.extraItemAmbiguous')
    expect(pickItem('zz', c, 'KSA').error).toBe('inventory.count.extraItemUnknown')
  })
  it('treats an unanswered line as not saved and stable payloads as equal', () => {
    const r = splitSubmitResult({ accepted: ['u1'], duplicates: ['u2'], rejected: [{ client_uuid: 'u3', reason: 'Unknown location or item' }] },
      [{ client_uuid: 'u1' }, { client_uuid: 'u2' }, { client_uuid: 'u3' }, { client_uuid: 'u4' }])
    expect([...r.done]).toEqual(['u1', 'u2'])
    expect(r.rejected.get('u3')).toBe('Unknown location or item')
    expect(r.rejected.has('u4')).toBe(true)
    expect(r.allDone).toBe(false)
    const l = [{ client_uuid: 'x', item_id: 'I', counted_qty: 1 }]
    expect(payloadSignature(l)).toBe(payloadSignature(JSON.parse(JSON.stringify(l))))
  })
})

describe('blind count submit', () => {
  it('sends the found item as ids (not codes) and closes only when every line is saved', async () => {
    const onSubmitted = vi.fn()
    state.submit = [{ accepted: [], duplicates: [], rejected: [] }]
    ui({ onSubmitted })
    await fillAndConfirm()
    await waitFor(() => expect(submits()).toHaveLength(1))
    const p = submits()[0]
    const extra = p.lines.find((l) => l.unexpected)
    expect(extra).toMatchObject({ item_id: 'I9', location_id: 'L2', counted_qty: 2, unexpected: true })
    expect(extra.item_code).toBeUndefined()
    // the server answered nothing for the two lines -> not assumed saved
    expect(onSubmitted).not.toHaveBeenCalled()
  })

  it('a retry after a lost answer resends the identical payload and key', async () => {
    state.submit = [new Error('network down')]
    ui()
    await fillAndConfirm()
    await waitFor(() => expect(submits()).toHaveLength(1))
    state.submit = [{ accepted: [], duplicates: [], rejected: [] }]
    fireEvent.click(screen.getByRole('button', { name: /Submit count/ }))
    fireEvent.click(screen.getByRole('button', { name: /Yes, submit/ }))
    await waitFor(() => expect(submits()).toHaveLength(2))
    const [a, b] = submits()
    expect(b).toEqual(a)
  })

  it('shows the server reason on a rejected line and resends only that line', async () => {
    const onSubmitted = vi.fn()
    ui({ onSubmitted })
    fireEvent.change(await screen.findByLabelText('Counted quantity for A'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit count/ }))
    state.submit = [{ accepted: [], duplicates: [], get rejected() { return [{ client_uuid: submits()[0].lines[0].client_uuid, reason: 'Counting is not open for this line' }] } }]
    fireEvent.click(screen.getByRole('button', { name: /Yes, submit/ }))
    expect(await screen.findByText('Not accepted: Counting is not open for this line')).toBeTruthy()
    expect(onSubmitted).not.toHaveBeenCalled()
    const uuid = submits()[0].lines[0].client_uuid
    state.submit = [{ accepted: [uuid], duplicates: [], rejected: [] }]
    fireEvent.click(screen.getByRole('button', { name: /Submit count/ }))
    fireEvent.click(screen.getByRole('button', { name: /Yes, submit/ }))
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    expect(submits()[1].lines.map((l) => l.client_uuid)).toEqual([uuid])
  })
})
