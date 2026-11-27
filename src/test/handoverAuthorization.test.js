import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  partiesFor, partySignature, nextPartyToSign, isFrozen, isFullySigned, signingSummary,
  rowLocation, formatCoords, openStreetMapUrl, locationLine, captureLocation, locationArgs,
  hasAuthorizationColumns, eventLabel, eventFields, PARTY_HANDING, PARTY_RECEIVING,
} from '../lib/handoverAuthorization'
import { signatureProblems, buildHandoverPayload, EMPTY_WIZARD, validateStep } from '../lib/vehicleHandoverView'
import { handoverPdfRows, signatureBlocks, formatSpecValue, documentNumber, HANDOVER_PDF_SPEC } from '../lib/vehicleHandoverPdf'

const SIG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

describe('handover authorization helpers', () => {
  it('maps the picked driver to the right party', () => {
    expect(partiesFor('checkout')).toEqual({ driverParty: PARTY_RECEIVING, otherParty: PARTY_HANDING })
    expect(partiesFor('checkin')).toEqual({ driverParty: PARTY_HANDING, otherParty: PARTY_RECEIVING })
  })

  it('reads signatures, the next party and the lock', () => {
    const row = { to_signed_at: null, from_signed_at: '2026-11-26T08:00:00Z', from_signed_name: 'Faisal', from_signature: SIG }
    expect(partySignature(row, PARTY_HANDING)).toMatchObject({ signed: true, name: 'Faisal' })
    expect(nextPartyToSign(row)).toBe(PARTY_RECEIVING)
    expect(isFrozen(row)).toBe(true)
    expect(isFullySigned(row)).toBe(false)
    expect(signingSummary(row).text).toBe('Waiting for the receiving driver')
    expect(nextPartyToSign({ ...row, to_signed_at: 'x' })).toBeNull()
    expect(isFrozen({ to_signed_at: null })).toBe(false)
  })

  it('knows a pre-migration row', () => {
    expect(hasAuthorizationColumns({ signature_url: SIG })).toBe(false)
    expect(signingSummary({ signature_url: SIG }).text).toMatch(/single signature/)
    expect(hasAuthorizationColumns({ to_signed_at: null })).toBe(true)
  })

  it('formats location honestly', () => {
    const loc = rowLocation({ latitude: 21.4858, longitude: 39.1925, location_accuracy_m: 12.4 })
    expect(formatCoords(loc)).toBe('21.48580, 39.19250')
    expect(openStreetMapUrl(loc)).toBe('https://www.openstreetmap.org/?mlat=21.485800&mlon=39.192500#map=17/21.485800/39.192500')
    expect(locationLine({ latitude: 21.4858, longitude: 39.1925, location_accuracy_m: 12.4 })).toBe('21.48580, 39.19250 (within 12 m)')
    expect(rowLocation({ latitude: null, longitude: 4 })).toBeNull()
    expect(rowLocation({ latitude: 95, longitude: 4 })).toBeNull()
    expect(locationLine({ location_status: 'denied' })).toBe('Location permission was refused')
  })

  it('captures location and reports a refusal without throwing', async () => {
    const ok = { getCurrentPosition: (s) => s({ coords: { latitude: 1.5, longitude: 2.5, accuracy: 9 } }) }
    expect(await captureLocation({ geo: ok })).toMatchObject({ status: 'captured', lat: 1.5, lng: 2.5, accuracy: 9 })
    const denied = { getCurrentPosition: (_s, e) => e({ code: 1, PERMISSION_DENIED: 1 }) }
    expect((await captureLocation({ geo: denied })).status).toBe('denied')
    expect((await captureLocation({ geo: null })).status).toBe('unavailable')
    expect(locationArgs({ status: 'denied' })).toEqual({ latitude: null, longitude: null, accuracy: null, status: 'denied' })
    expect(locationArgs({ status: 'captured', lat: 1, lng: 2, accuracy: 3 })).toEqual({ latitude: 1, longitude: 2, accuracy: 3, status: 'captured' })
  })

  it('labels audit events', () => {
    expect(eventLabel('signed_receiving')).toBe('Receiving driver signed')
    expect(eventFields({ action: 'edited', changes: { odometer_km: {}, updated_at: {} } })).toEqual(['odometer_km'])
    expect(eventFields({ action: 'created', changes: { asset_no: 'x' } })).toEqual([])
  })
})

describe('wizard signatures and payload', () => {
  const base = { ...EMPTY_WIZARD, asset_no: 'tm514', driver_name: 'Dana', driver_id: '00000000-0000-0000-0000-000000000021', other_party: 'Yard' }

  it('needs both names and both signatures', () => {
    expect(signatureProblems(base)).toHaveLength(2)
    expect(signatureProblems({ ...base, sig_handing: SIG, sig_receiving: SIG })).toEqual([])
    expect(signatureProblems({ ...base, other_party: '', sig_handing: SIG, sig_receiving: SIG })[0]).toMatch(/handing the vehicle over/)
  })

  it('carries driver ids, hour meter and site into the payload by party', () => {
    const out = buildHandoverPayload({ ...base, hour_meter: '1500.5', other_party_id: '' }, { country: 'KSA', site: 'JEDDAH' })
    expect(out).toMatchObject({ to_driver_id: base.driver_id, from_driver_id: null, hour_meter: 1500.5, site: 'JEDDAH' })
    const back = buildHandoverPayload({ ...base, handover_type: 'checkin' }, {})
    expect(back).toMatchObject({ from_driver_id: base.driver_id, to_driver_id: null })
  })

  it('refuses a falling hour meter', () => {
    expect(validateStep(0, { ...base, hour_meter: '10' }, { engineHours: 20 }).join(' ')).toMatch(/lower than the last reading/)
  })
})

describe('handover PDF spec', () => {
  it('builds the details rows in spec order with N/A for blanks', () => {
    const rows = handoverPdfRows({ asset_no: 'TM514', document_no: 'HO-TM514-2026-0001', hour_meter: 1200, handover_type: 'checkout' })
    const labels = rows.map((r) => r[0])
    const specLabels = HANDOVER_PDF_SPEC.sections[0].fields.filter((f) => f.format !== 'status_pill').map((f) => f.label)
    expect(labels).toEqual(specLabels)
    expect(rows.find((r) => r[0] === 'Hour meter')[1]).toBe('1,200 h')
    expect(rows.find((r) => r[0] === 'Document no')[1]).toBe('HO-TM514-2026-0001')
    expect(rows.find((r) => r[0] === 'Fuel level')[1]).toBe('N/A')
  })

  it('renders both driver signature blocks, falling back to the legacy one', () => {
    const section = HANDOVER_PDF_SPEC.sections.find((s) => s.key === 'driver_signatures')
    const blocks = signatureBlocks({ from_signature: SIG, from_signed_name: 'Faisal', from_signed_at: '2026-11-26T08:00:00Z', to_driver: 'Dana' }, section)
    expect(blocks.map((b) => b.title)).toEqual(['Handing over', 'Receiving'])
    expect(blocks[0].sub).toMatch(/^Signed: /)
    expect(blocks[1]).toMatchObject({ name: 'Dana', sub: 'Not signed' })
    const behalf = signatureBlocks({ from_signature: SIG, from_signed_at: '2026-11-26T08:00:00Z', from_on_behalf: true }, section)
    expect(behalf[0].sub).toMatch(/on their behalf by a supervisor$/)
    const legacy = signatureBlocks({ signature_url: SIG, to_driver: 'Dana' }, section)
    expect(legacy).toHaveLength(1)
    expect(legacy[0].title).toBe('Driver')
  })

  it('formats and numbers', () => {
    expect(formatSpecValue('km', 1500)).toBe('1,500 km')
    expect(formatSpecValue('km', null)).toBe('N/A')
    expect(formatSpecValue('status_pill', 'pending_incharge')).toBe('Awaiting fleet incharge')
    expect(documentNumber({ id: 'abcdef12-0000-0000-0000-000000000000' })).toBe('HND-ABCDEF12')
  })

  it('has no en or em dashes in the spec text', () => {
    expect(JSON.stringify(HANDOVER_PDF_SPEC)).not.toMatch(/[–—]/)
  })
})

const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: h.rpc, from: vi.fn(), auth: { getUser: vi.fn() } } }))

describe('signHandover service', () => {
  beforeEach(() => h.rpc.mockReset())

  it('sends the signature to sign_handover, never a time', async () => {
    const { signHandover } = await import('../lib/api/handoverReports')
    h.rpc.mockResolvedValue({ data: { ok: true, party: 'handing', status: 'draft' }, error: null })
    await signHandover('id-1', 'handing', { signature: SIG, name: 'Faisal', location: { latitude: 1, longitude: 2, accuracy: 3, status: 'captured' } })
    const [fn, args] = h.rpc.mock.calls[0]
    expect(fn).toBe('sign_handover')
    expect(args).toMatchObject({ p_id: 'id-1', p_party: 'handing', p_signature: SIG, p_latitude: 1, p_longitude: 2, p_accuracy_m: 3, p_location_status: 'captured' })
    expect(Object.keys(args).some((k) => /_at$/.test(k))).toBe(false)
  })

  it('surfaces a refusal as a clean message', async () => {
    const { signHandover } = await import('../lib/api/handoverReports')
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table handover_reports' } })
    await expect(signHandover('id-1', 'receiving', { signature: SIG })).rejects.toThrow()
    await expect(signHandover('id-1', 'nobody', { signature: SIG })).rejects.toThrow(/who is signing/)
  })
})

describe('who may sign (review H4) and send-back (M6)', () => {
  it('classifies each party as self, on behalf or blocked', async () => {
    const { signingMode, rowSigningMode, SIGN_SELF, SIGN_ON_BEHALF, SIGN_BLOCKED } = await import('../lib/handoverAuthorization')
    expect(signingMode({ partyDriverId: 'd1', otherDriverId: 'd2', myDriverId: 'd1' })).toBe(SIGN_SELF)
    expect(signingMode({ partyDriverId: 'd1', otherDriverId: 'd2', myDriverId: 'd2' })).toBe(SIGN_BLOCKED)
    expect(signingMode({ partyDriverId: 'd1', otherDriverId: 'd2', myDriverId: null })).toBe(SIGN_ON_BEHALF)
    expect(signingMode({ partyDriverId: null, otherDriverId: null, myDriverId: 'd9' })).toBe(SIGN_ON_BEHALF)
    const row = { from_driver_id: 'd1', to_driver_id: 'd2' }
    expect(rowSigningMode(row, PARTY_RECEIVING, 'd2')).toBe(SIGN_SELF)
    expect(rowSigningMode(row, PARTY_HANDING, 'd2')).toBe(SIGN_BLOCKED)
  })

  it('never lets one account give both signatures', async () => {
    const { rowSigningMode, wizardSigningModes, wizardSigningProblems, SIGN_ON_BEHALF, SIGN_OTHER_ACCOUNT, SIGN_SELF, SIGN_BLOCKED } = await import('../lib/handoverAuthorization')
    const row = { from_driver_id: 'd1', to_driver_id: 'd2', from_signed_by: 'u-sup', from_signed_at: 'x' }
    expect(rowSigningMode(row, PARTY_RECEIVING, null, 'u-sup')).toBe(SIGN_OTHER_ACCOUNT)
    expect(rowSigningMode(row, PARTY_RECEIVING, null, 'u-other-sup')).toBe(SIGN_ON_BEHALF)
    // A supervisor on one device: handing on behalf now, receiving left for another account.
    expect(wizardSigningModes({ handingDriverId: 'd1', receivingDriverId: 'd2', myDriverId: null }))
      .toEqual({ [PARTY_HANDING]: SIGN_ON_BEHALF, [PARTY_RECEIVING]: SIGN_OTHER_ACCOUNT })
    // The receiving driver on their own account: only their own signature.
    expect(wizardSigningModes({ handingDriverId: 'd1', receivingDriverId: 'd2', myDriverId: 'd2' }))
      .toEqual({ [PARTY_HANDING]: SIGN_BLOCKED, [PARTY_RECEIVING]: SIGN_SELF })
    const base = ['The receiving signature is missing.']
    expect(wizardSigningProblems(base, { behalf_handing: true }, { [PARTY_HANDING]: SIGN_ON_BEHALF, [PARTY_RECEIVING]: SIGN_OTHER_ACCOUNT })).toEqual([])
  })

  it('always saves a handover under a site', async () => {
    const { resolveHandoverSite } = await import('../lib/handoverAuthorization')
    expect(resolveHandoverSite({ site: 'jeddah ' }, { site: 'RIYADH' })).toBe('JEDDAH')
    expect(resolveHandoverSite(null, { site: ' dammam' })).toBe('DAMMAM')
    expect(resolveHandoverSite({ site: '' }, {})).toBe(null)
  })

  it('needs the on-behalf confirmation and skips a blocked party', async () => {
    const { wizardSigningProblems, SIGN_ON_BEHALF, SIGN_BLOCKED, SIGN_SELF } = await import('../lib/handoverAuthorization')
    const base = ['The handing over signature is missing.']
    expect(wizardSigningProblems(base, {}, { [PARTY_HANDING]: SIGN_BLOCKED, [PARTY_RECEIVING]: SIGN_SELF })).toEqual([])
    const errs = wizardSigningProblems([], {}, { [PARTY_HANDING]: SIGN_ON_BEHALF, [PARTY_RECEIVING]: SIGN_SELF })
    expect(errs).toEqual(['Confirm that you are signing on behalf of the handing party.'])
    expect(wizardSigningProblems([], { behalf_handing: true }, { [PARTY_HANDING]: SIGN_ON_BEHALF })).toEqual([])
  })

  it('accepts exactly what the signature pad emits, and nothing looser', async () => {
    const { isValidSignature } = await import('../lib/handoverAuthorization')
    const { buildSvg } = await import('../components/checklist/SignatureCapture')
    const pts = Array.from({ length: 12 }, (_, i) => ({ x: 1.25 + i * 4, y: (i % 3) * 2 }))
    const svg = buildSvg([pts], 318.6, 140)
    expect(isValidSignature(svg)).toBe(true)
    // A dot is not a signature.
    expect(isValidSignature(buildSvg([[{ x: 1.25, y: 2 }, { x: 30, y: -4.5 }]], 318.6, 140))).toBe(false)
    expect(isValidSignature('data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(1400))).toBe(true)
    expect(isValidSignature('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(isValidSignature(SIG)).toBe(false)
    expect(isValidSignature('<svg onload="alert(1)"></svg>')).toBe(false)
  })

  it('reads a sent-back draft as needing new signatures', async () => {
    const { isSentBack } = await import('../lib/handoverAuthorization')
    const back = { approval_status: 'draft', review_note: 'Odometer is wrong', to_signed_at: null, from_signed_at: null }
    expect(isSentBack(back)).toBe(true)
    expect(signingSummary(back).text).toMatch(/Sent back/)
    expect(isSentBack({ approval_status: 'draft', review_note: null })).toBe(false)
    expect(isSentBack({ approval_status: 'rejected' })).toBe(true)
    expect(eventLabel('sent_back')).toMatch(/Sent back/)
  })

  it('sends the on-behalf flag to sign_handover', async () => {
    const { signHandover } = await import('../lib/api/handoverReports')
    h.rpc.mockReset()
    h.rpc.mockResolvedValue({ data: { ok: true, party: 'handing', status: 'draft', on_behalf: true }, error: null })
    await signHandover('id-1', 'handing', { signature: SIG, onBehalf: true })
    expect(h.rpc.mock.calls[0][1].p_on_behalf).toBe(true)
    await signHandover('id-1', 'handing', { signature: SIG })
    expect(h.rpc.mock.calls[1][1].p_on_behalf).toBe(false)
  })
})
