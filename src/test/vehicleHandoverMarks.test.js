import { describe, it, expect } from 'vitest'
import {
  handoverViewsFor, handoverStemFor, viewImageUrl, normalizeMarker, newMarker, percentFromClick,
  marksFromDamages, damagesFromMarks, numberMarks, markCountByView, viewsWithPlacedMarks,
  damageSummaryText, markLabel,
} from '../lib/vehicleHandoverMarks'
import { buildHandoverPayload, EMPTY_WIZARD } from '../lib/vehicleHandoverView'
import { handoverExportRows } from '../lib/vehicleHandoverAnalytics'
import { pinGeometry, handoverPdfRows } from '../lib/vehicleHandoverPdf'
import { damageCount } from '../lib/handoverReports'

const mixer = { asset_no: 'TM514', vehicle_type: 'TR-MIXER', make: 'Sany', model: 'Transit mixer' }

describe('vehicleHandoverMarks', () => {
  it('resolves the asset board and the five distinct sides', () => {
    const stem = handoverStemFor(mixer)
    expect(stem).toBe('transit_mixer_3axle_five_view_v1')
    expect(viewImageUrl(stem, 'front')).toBe('/vehicle-views/transit_mixer_3axle_five_view_v1_front.webp')
    expect(viewImageUrl(stem, 'roof')).toBeNull()
    expect(viewImageUrl('made_up_stem', 'front')).toBeNull()
    const views = handoverViewsFor(mixer)
    expect([...views].sort()).toEqual(['front', 'left', 'rear', 'right', 'top'])
    expect(handoverStemFor(null)).toBeNull()
  })

  it('bus order follows the case family order without a duplicate front', () => {
    const views = handoverViewsFor({ asset_no: 'BS001', vehicle_type: 'BUS' })
    expect(views).toEqual(['left', 'front', 'right', 'rear', 'top'])
  })

  it('normalizes markers and clamps positions', () => {
    const m = normalizeMarker({ view: 'LEFT', x: 120, y: -4, type: 'crack', level: 'weird', note: 'x'.repeat(500), photo_url: 'javascript:alert(1)' })
    expect(m).toMatchObject({ view: 'left', x: 100, y: 0, type: 'cracked', level: 'minor', photo_url: '' })
    expect(m.note.length).toBe(200)
    expect(normalizeMarker({ view: 'roof' })).toBeNull()
    expect(normalizeMarker({ view: 'front', x: 5, y: null }).x).toBeNull()
    expect(newMarker({ view: 'front', x: 50, y: 50 }).type).toBe('dent')
  })

  it('turns a click into image percentages', () => {
    expect(percentFromClick(150, 100, { left: 100, top: 50, width: 200, height: 100 })).toEqual({ x: 25, y: 50 })
    expect(percentFromClick(1, 1, { left: 0, top: 0, width: 0, height: 10 })).toBeNull()
  })

  it('round-trips markers through the stored damages', () => {
    const marks = [newMarker({ view: 'front', x: 40, y: 60 }), { ...newMarker({ view: 'left', x: 10, y: 20 }), level: 'severe', type: 'broken', note: 'mirror' }]
    const damages = damagesFromMarks(marks, { stem: 'transit_mixer_3axle_five_view_v1' })
    expect(damages).toHaveLength(2)
    expect(damages[1]).toMatchObject({ kind: 'marker', number: 2, view: 'left', type: 'broken', level: 'severe', note: 'mirror', stem: 'transit_mixer_3axle_five_view_v1', label: 'Left: Broken, Major' })
    expect(damageCount({ damages })).toBe(2)
    const back = marksFromDamages(damages)
    expect(back.stem).toBe('transit_mixer_3axle_five_view_v1')
    expect(back.marks.map((m) => [m.view, m.x, m.y, m.level])).toEqual([['front', 40, 60, 'minor'], ['left', 10, 20, 'severe']])
    expect(damagesFromMarks(marks, { stem: 'unknown' })[0].stem).toBeNull()
  })

  it('reads older per-side entries as unplaced markers', () => {
    const { marks, stem } = marksFromDamages([
      { zone: 'rear', condition: 'dent', label: 'Rear: Dent' },
      { zone: 'left', condition: 'good' },
      { zone: 'roof', condition: 'damaged' },
      'junk',
    ])
    expect(stem).toBeNull()
    expect(marks).toHaveLength(1)
    expect(marks[0]).toMatchObject({ view: 'rear', x: null, y: null, type: 'dent', level: 'moderate', legacy: true })
    expect(viewsWithPlacedMarks(marks)).toEqual([])
    expect(marksFromDamages(null).marks).toEqual([])
  })

  it('numbers, counts and summarises', () => {
    const marks = numberMarks([newMarker({ view: 'front', x: 1, y: 1 }), newMarker({ view: 'front', x: 2, y: 2 }), newMarker({ view: 'top', x: 3, y: 3 })])
    expect(marks.map((m) => m.number)).toEqual([1, 2, 3])
    expect(markCountByView(marks)).toEqual({ front: 2, top: 1 })
    expect(viewsWithPlacedMarks(marks)).toEqual(['front', 'top'])
    expect(markLabel(marks[0])).toBe('Front: Dent, Minor')
    expect(damageSummaryText(damagesFromMarks(marks))).toBe('1 Front Dent (Minor); 2 Front Dent (Minor); 3 Top Dent (Minor)')
    expect(damageSummaryText(null)).toBe('')
  })

  it('wizard payload stores markers and keeps the zone fallback', () => {
    const withMarks = buildHandoverPayload({ ...EMPTY_WIZARD, asset_no: 'tm514', driver_name: 'A', marks: [newMarker({ view: 'rear', x: 5, y: 5 })], artwork_stem: 'transit_mixer_3axle_five_view_v1' })
    expect(withMarks.damage_count).toBe(1)
    expect(withMarks.damages[0].kind).toBe('marker')
    const zonesOnly = buildHandoverPayload({ ...EMPTY_WIZARD, asset_no: 'tm514', driver_name: 'A', zones: { ...EMPTY_WIZARD.zones, rear: 'dent' } })
    expect(zonesOnly.damages[0].zone).toBe('rear')
    const clean = buildHandoverPayload({ ...EMPTY_WIZARD, asset_no: 'tm514', driver_name: 'A' })
    expect(clean.damages).toBeNull()
  })

  it('exports the marker summary and PDF geometry', () => {
    const damages = damagesFromMarks([newMarker({ view: 'left', x: 50, y: 25 })])
    expect(handoverExportRows([{ asset_no: 'T1', damages }])[0].damage_marks).toBe('1 Left Dent (Minor)')
    const pins = pinGeometry(numberMarks(marksFromDamages(damages).marks), 'left', 600)
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ number: 1, cx: 300, cy: 150 })
    expect(pinGeometry([], 'left')).toEqual([])
    const rows = handoverPdfRows({ asset_no: 'T1', odometer_km: null, handover_type: 'checkin' })
    expect(rows.find((r) => r[0] === 'Odometer')[1]).toBe('N/A')
    expect(rows.find((r) => r[0] === 'Type')[1]).toBe('Check-in')
  })
})
