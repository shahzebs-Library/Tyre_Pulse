import { describe, it, expect } from 'vitest'
import {
  ITEM_TYPES, fleetKind, splitFleet, rowsForType, registerFor, filterOptions, filterRegister, rowStatus,
  labelDetailLines, toEntry, expandCopies, clampCopies, addToQueue, queueLabelCount, queueToPrint,
  batchNumber, makeBatch, buildQrKpis, normalizeDesign, saveTemplate, normalizeQrLevel, cleanCustomText,
  LABEL_INFO, PAGE_TABS, TAB_EMPTY, SIZE_TABS,
} from '../lib/qrLabelsView'
import { labelGrid, clampCustomWidth, resolveLabelSize, pageCount, CUSTOM_WIDTH, PAGE_W } from '../lib/qrLabelLayout'

const fleet = [
  { id: 1, asset_no: 'TM360', vehicle_type: 'TR-MIXER', make: 'Sany', site: 'NHC', registration_no: '1234 ABC', ops_status: 'running' },
  { id: 2, asset_no: 'GN103', vehicle_type: 'GENERATOR', make: 'Caterpillar', site: 'JED', status: 'Active' },
  { id: 3, asset_no: 'BP041', vehicle_type: 'BT-PLANT', site: 'NHC', ops_status: 'breakdown' },
  { id: 4, asset_no: 'PL077', vehicle_type: 'PICKUP', make: 'Toyota', site: 'JED' },
]
const tyres = [
  { id: 't1', serial_number: 'EP060420711', asset_no: 'TM360', position: 'LHF1', brand: 'Triangle', size: '315/80R22.5', site: 'NHC', risk_level: 'High' },
  { id: 't2', serial_number: null, asset_no: 'TM361', brand: 'Pirelli', size: '385/65R22.5', site: 'JED' },
]

describe('item types', () => {
  it('offers tyres, vehicles and equipment', () => {
    expect(ITEM_TYPES.map((t) => t.key)).toEqual(['tyres', 'vehicles', 'equipment'])
  })
  it('splits the fleet by whether a machine carries tyres, using the diagram list', () => {
    expect(fleetKind(fleet[0])).toBe('vehicles')
    expect(fleetKind(fleet[1])).toBe('equipment')
    expect(fleetKind(fleet[2])).toBe('equipment')
    expect(fleetKind({ vehicle_type: null })).toBe('vehicles')
    const s = splitFleet(fleet)
    expect(s.vehicles.map((r) => r.id)).toEqual([1, 4])
    expect(s.equipment.map((r) => r.id)).toEqual([2, 3])
    expect(splitFleet(null)).toEqual({ vehicles: [], equipment: [] })
  })
  it('reads the right register and rows per type', () => {
    expect(registerFor('tyres')).toBe('tyres')
    expect(registerFor('equipment')).toBe('fleet')
    expect(rowsForType(fleet, 'equipment')).toHaveLength(2)
    expect(rowsForType(tyres, 'tyres')).toHaveLength(2)
  })
})

describe('filters', () => {
  it('builds options from the loaded rows only', () => {
    const o = filterOptions(tyres, 'tyres')
    expect(o.makers).toEqual(['Pirelli', 'Triangle'])
    expect(o.sizes).toEqual(['315/80R22.5', '385/65R22.5'])
    expect(o.sites).toEqual(['JED', 'NHC'])
    expect(filterOptions(fleet, 'vehicles').makers).toContain('Sany')
  })
  it('filters by maker, size, site and search together', () => {
    expect(filterRegister(tyres, { type: 'tyres', maker: 'Pirelli' }).map((r) => r.id)).toEqual(['t2'])
    expect(filterRegister(tyres, { type: 'tyres', size: '315/80R22.5' }).map((r) => r.id)).toEqual(['t1'])
    expect(filterRegister(fleet, { type: 'vehicles', site: 'JED' }).map((r) => r.id)).toEqual([2, 4])
    expect(filterRegister(fleet, { type: 'vehicles', search: 'tm3' }).map((r) => r.id)).toEqual([1])
  })
})

describe('status pill', () => {
  it('maps tyre risk and fleet status to tones, and says nothing when unknown', () => {
    expect(rowStatus(tyres[0], 'tyres')).toEqual({ label: 'High', tone: 'bad' })
    expect(rowStatus(tyres[1], 'tyres')).toBeNull()
    expect(rowStatus(fleet[0], 'vehicles')).toEqual({ label: 'Running', tone: 'good' })
    expect(rowStatus(fleet[2], 'equipment').tone).toBe('bad')
    expect(rowStatus({}, 'vehicles')).toBeNull()
  })
})

describe('label content', () => {
  it('prints brand and size, the asset, and the site for a tyre', () => {
    const lines = labelDetailLines(tyres[0], 'tyres', undefined, '')
    expect(lines).toEqual(['Triangle 315/80R22.5 | Asset TM360 LHF1', 'NHC'])
  })
  it('honours the toggles and adds custom text', () => {
    const lines = labelDetailLines(fleet[0], 'vehicles', { spec: false, ref: true, site: false, custom: true }, '  Property   of fleet ')
    expect(lines).toEqual(['1234 ABC', 'Property of fleet'])
    expect(labelDetailLines(fleet[0], 'vehicles', { spec: false, ref: false, site: false, custom: false })).toEqual([])
  })
  it('keeps the code and QR always on and the barcode honestly unavailable', () => {
    expect(LABEL_INFO.find((f) => f.key === 'code').locked).toBe(true)
    expect(LABEL_INFO.find((f) => f.key === 'qr').locked).toBe(true)
    expect(LABEL_INFO.find((f) => f.key === 'barcode').unavailable).toMatch(/barcode/i)
  })
  it('caps custom text and keeps it on one line', () => {
    expect(cleanCustomText('a\nb')).toBe('a b')
    expect(cleanCustomText('x'.repeat(80))).toHaveLength(40)
    expect(cleanCustomText(null)).toBe('')
  })
})

describe('copies and the print queue', () => {
  const e1 = toEntry(tyres[0], 'tyres', { code: 'EP060420711', qr: 'data:q1' })
  const e2 = toEntry(fleet[0], 'vehicles', { code: 'TM360', qr: 'data:q2' })
  const noQr = toEntry(fleet[1], 'equipment', { code: 'GN103', qr: null })

  it('clamps copies and keeps copies of one label together', () => {
    expect(clampCopies(0)).toBe(1)
    expect(clampCopies(99)).toBe(20)
    expect(clampCopies('x')).toBe(1)
    expect(expandCopies([e1, e2], 2).map((e) => e.val)).toEqual(['EP060420711', 'EP060420711', 'TM360', 'TM360'])
    expect(expandCopies([e1], 1)[0]).toBe(e1)
  })
  it('never queues a label without a QR, and never queues one twice', () => {
    const a = addToQueue(new Map(), [e1, noQr], 3)
    expect(a.added).toBe(1)
    expect(queueLabelCount(a.queue)).toBe(3)
    const b = addToQueue(a.queue, [e1, e2], 1)
    expect(b.added).toBe(1)
    expect(b.queue.size).toBe(2)
    expect(queueLabelCount(b.queue)).toBe(2)
    expect(queueToPrint(b.queue)).toHaveLength(2)
  })
  it('keys entries by type so a tyre and a vehicle with one id never collide', () => {
    expect(toEntry({ id: 5 }, 'tyres', {}).key).not.toBe(toEntry({ id: 5 }, 'vehicles', {}).key)
  })
})

describe('batches', () => {
  it('numbers a batch by date and sequence', () => {
    expect(batchNumber(7, new Date(2026, 8, 29))).toBe('QR-20260929-007')
    const b = makeBatch({ seq: 1, type: 'tyres', items: 3, labels: 6, action: 'pdf', at: new Date(2026, 0, 2) })
    expect(b).toMatchObject({ batchNo: 'QR-20260102-001', items: 3, labels: 6, action: 'pdf', by: 'You' })
  })
})

describe('KPIs', () => {
  it('reports register counts and leaves unmeasured tiles as null', () => {
    const k = buildQrKpis({ tyres: 11132, fleet, sessionLabels: 4 })
    expect(k).toEqual({ generated: 4, tyres: 11132, vehicles: 2, equipment: 2, active: null, unassigned: null })
  })
  it('keeps unknown counts unknown rather than zero', () => {
    const k = buildQrKpis({})
    expect(k.tyres).toBeNull()
    expect(k.vehicles).toBeNull()
    expect(k.generated).toBe(0)
  })
})

describe('tabs and templates', () => {
  it('has six tabs with an honest reason for every record-keeping tab', () => {
    expect(PAGE_TABS.map((t) => t.key)).toEqual(['generate', 'inventory', 'assigned', 'scans', 'prints', 'settings'])
    for (const k of ['inventory', 'assigned', 'scans', 'prints']) expect(TAB_EMPTY[k].body.length).toBeGreaterThan(40)
  })
  it('normalises a stored design and rejects junk', () => {
    const d = normalizeDesign({ size: 'huge', qrLevel: 'Z', copies: 500, logo: 'x', info: { spec: false } })
    expect(d.size).toBe('md')
    expect(d.qrLevel).toBe('M')
    expect(d.copies).toBe(20)
    expect(d.logo).toBe('company')
    expect(d.info.spec).toBe(false)
    expect(d.info.site).toBe(true)
    expect(normalizeQrLevel('H')).toBe('H')
    expect(SIZE_TABS.map((t) => t.key)).toEqual(['md', 'sm', 'lg', 'custom'])
  })
  it('upserts templates by name and caps the list', () => {
    let list = saveTemplate([], 'Tyre stickers', { size: 'sm' })
    list = saveTemplate(list, 'tyre STICKERS', { size: 'lg' })
    expect(list).toHaveLength(1)
    expect(list[0].design.size).toBe('lg')
    expect(saveTemplate(list, '   ', {})).toBe(list)
    for (let i = 0; i < 20; i++) list = saveTemplate(list, `t${i}`, {})
    expect(list).toHaveLength(12)
  })
})

describe('custom label size', () => {
  it('clamps the width and derives a grid that fits A4', () => {
    expect(clampCustomWidth(5)).toBe(CUSTOM_WIDTH.min)
    expect(clampCustomWidth(500)).toBe(CUSTOM_WIDTH.max)
    expect(clampCustomWidth('abc')).toBe(CUSTOM_WIDTH.default)
    for (const w of [30, 45, 64, 100]) {
      const g = labelGrid('custom', { customW: w })
      expect(g.w).toBe(w)
      expect(g.marginX * 2 + g.cols * g.w + (g.cols - 1) * g.gap).toBeLessThanOrEqual(PAGE_W + 0.001)
      expect(g.perPage).toBeGreaterThan(0)
    }
    expect(resolveLabelSize('custom', 62).label).toBe('Custom')
    expect(resolveLabelSize('md').w).toBe(55)
    expect(pageCount(0, 'custom', { customW: 40 })).toBe(0)
    expect(pageCount(21, 'custom', { customW: 40 })).toBe(2)
  })
  it('leaves the presets exactly as they were', () => {
    expect(labelGrid('md').perPage).toBe(labelGrid('md', { customW: 99 }).perPage)
  })
})
