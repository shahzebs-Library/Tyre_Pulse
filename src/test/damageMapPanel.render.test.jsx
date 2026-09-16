import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// The panel is exercised against a MOCKED data boundary; the engine
// (vehicleDamageViews + accidentCaseVocab + vehicleTyreLayout) runs for real.
vi.mock('../lib/api/accidentDamageAssessment', () => ({
  readMarks: vi.fn(),
  saveDamageAssessment: vi.fn(),
  upsertDamageMark: vi.fn(),
  removeDamageMark: vi.fn(),
}))
vi.mock('../lib/api/accidentEvidence', () => ({ uploadEvidenceFile: vi.fn() }))

import * as api from '../lib/api/accidentDamageAssessment'
import DamageMapPanel, { markSummary } from '../components/accidents/DamageMapPanel'
import { DAMAGE_TYPES } from '../lib/accidentCaseVocab'

const ASSESSMENT = {
  id: 'as1',
  damage_areas: [
    { view: 'left', region_key: 'front_door', region_label: 'Front door', damage_type: 'dent', severity: 'severe', photo_refs: ['a.jpg', 'b.jpg'], note: 'deep crease' },
    { view: 'front', region_key: 'grille', component_label: 'Grille / bonnet', damage_type: 'crack', severity: 'minor', photo_refs: [] },
  ],
}

function mockRead(overrides = {}) {
  const marks = overrides.marks ?? ASSESSMENT.damage_areas.map((m) => ({ ...m, damage_type: m.damage_type === 'crack' ? 'cracked' : m.damage_type, source: 'assessment' }))
  api.readMarks.mockResolvedValue({
    assessment: 'assessment' in overrides ? overrides.assessment : ASSESSMENT, // an explicit null means "no assessment yet"
    marks,
    counts: { assessment: marks.filter((m) => m.source === 'assessment').length, mobile: marks.filter((m) => m.source === 'mobile').length },
  })
}

async function mount(props = {}) {
  const utils = render(<DamageMapPanel accidentId="acc1" vehicleType="Pickup" assetNo="PL077" elevated {...props} />)
  await waitFor(() => expect(screen.queryByText(/Loading the damage map/)).not.toBeInTheDocument())
  return utils
}

beforeEach(() => {
  vi.clearAllMocks()
  api.upsertDamageMark.mockResolvedValue(ASSESSMENT)
  api.removeDamageMark.mockResolvedValue(ASSESSMENT)
  api.saveDamageAssessment.mockResolvedValue({ id: 'new1', damage_areas: [] })
})

describe('DamageMapPanel: view chips per family in the mock order', () => {
  it('pickup: Left | Right | Front | Rear | Top, first one active, titled as the orthographic multi-view mapper', async () => {
    mockRead()
    await mount()
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Left', 'Right', 'Front', 'Rear', 'Top'])
    expect(screen.getByTestId('view-chip-left')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/Orthographic multi-view mapper/)).toBeInTheDocument()
    expect(screen.getByText('Mark vehicle damage')).toBeInTheDocument()
  })

  it('bus: Left | Front-left | Front | Right | Rear | Top', async () => {
    mockRead({ marks: [], assessment: null })
    await mount({ vehicleType: 'Bus', assetNo: 'BS001' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Left', 'Front-left', 'Front', 'Right', 'Rear', 'Top'])
  })

  it('concrete pump: Top | Left | Right | Front | Rear, titled as equipment, with named components on the Top view', async () => {
    mockRead({ marks: [], assessment: null })
    await mount({ vehicleType: 'Concrete Pump', assetNo: 'MP093' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Top', 'Left', 'Right', 'Front', 'Rear'])
    expect(screen.getByText('Mark equipment damage')).toBeInTheDocument()
    const surface = screen.getByTestId('damage-surface')
    expect(within(surface).getByText('Boom section 3')).toBeInTheDocument()
    expect(within(surface).getByText('Hopper')).toBeInTheDocument()
    expect(within(surface).getByText('Outrigger, front left')).toBeInTheDocument()
  })

  it('an unknown vehicle type gets the generic strip, never an invented body', async () => {
    mockRead({ marks: [], assessment: null })
    await mount({ vehicleType: 'HOVERCRAFT', assetNo: '' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Left', 'Right', 'Front', 'Rear', 'Top'])
  })
})

describe('DamageMapPanel: markers, selected card, marked list', () => {
  it('numbers the marks 1..N on the surface and in the Marked areas list, with type . level . photo count', async () => {
    mockRead()
    await mount()
    // Left view is active; mark 1 is on the left front door.
    expect(screen.getByTestId('marker-1')).toHaveTextContent('1')
    expect(screen.getByText('Marked areas (2)')).toBeInTheDocument()
    const list = screen.getByTestId('marked-list')
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Front door')
    expect(rows[0]).toHaveTextContent('Dent · Major · 2 photos')
    expect(rows[1]).toHaveTextContent('Grille / bonnet')
    expect(rows[1]).toHaveTextContent('Cracked · Minor · 0 photos') // legacy 'crack' canonicalised
    expect(screen.getByText('Edit all')).toBeInTheDocument()
  })

  it('clicking a marked region opens the selected-area card (label, summary, Edit | Remove) and captions the surface', async () => {
    mockRead()
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /^1\. Front door/ }))
    const card = screen.getByTestId('selected-card')
    expect(within(card).getByText('Front door')).toBeInTheDocument()
    expect(within(card).getByText('Dent · Major · 2 photos')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Edit/ })).toBeEnabled()
    expect(within(card).getByRole('button', { name: /Remove/ })).toBeEnabled()
    expect(screen.getByTestId('surface-caption')).toHaveTextContent('1. Front door')
  })

  it('clicking a list row switches to that mark\'s view and selects it', async () => {
    mockRead()
    await mount()
    fireEvent.click(within(screen.getByTestId('marked-list')).getAllByRole('button')[1])
    expect(screen.getByTestId('view-chip-front')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('selected-card')).toHaveTextContent('Grille / bonnet')
  })

  it('Remove on a selected web mark calls removeDamageMark with the stored view + region and reloads', async () => {
    mockRead()
    await mount()
    fireEvent.click(screen.getByRole('button', { name: /^1\. Front door/ }))
    fireEvent.click(within(screen.getByTestId('selected-card')).getByRole('button', { name: /Remove/ }))
    await waitFor(() => expect(api.removeDamageMark).toHaveBeenCalledWith('as1', ASSESSMENT.damage_areas, 'left', 'front_door'))
    expect(api.readMarks).toHaveBeenCalledTimes(2)
  })

  it('a mark recorded on the phone is shown, numbered and editable, but Remove is disabled with the honest reason', async () => {
    mockRead({
      marks: [{ view: 'left', region_key: 'rear_door', region_label: 'Rear door', damage_type: 'scratch', severity: 'minor', photo_refs: [], source: 'mobile' }],
    })
    await mount()
    expect(screen.getByText(/1 mark recorded on the phone/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^1\. Rear door/ }))
    const card = screen.getByTestId('selected-card')
    expect(within(card).getByRole('button', { name: /Remove/ })).toBeDisabled()
    expect(within(card).getByRole('button', { name: /Edit/ })).toBeEnabled()
  })

  it('an old pump mark stored under overview lights the Top view component as mark 1', async () => {
    mockRead({ marks: [{ view: 'overview', region_key: 'hopper', component_label: 'Hopper', damage_type: 'dent', severity: 'moderate', photo_refs: [], source: 'assessment' }] })
    await mount({ vehicleType: 'Concrete Pump', assetNo: 'MP093' })
    expect(screen.getByTestId('view-chip-top')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('marker-1')).toBeInTheDocument()
  })
})

describe('DamageMapPanel: area sheet (type chips, level chips, photos, note 0/200, save)', () => {
  it('tapping an unmarked region opens the sheet with exactly the DAMAGE_TYPES chips and Minor | Moderate | Major', async () => {
    mockRead()
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Rear fender' }))
    const sheet = screen.getByTestId('area-sheet')
    const typeChips = within(within(sheet).getByRole('group', { name: 'Damage type' })).getAllByRole('button').map((b) => b.textContent)
    expect(typeChips).toEqual(DAMAGE_TYPES.map((d) => d.label))
    expect(typeChips).toEqual(['Dent', 'Scratch', 'Cracked', 'Broken', 'Missing', 'Bent', 'Other'])
    const levelChips = within(within(sheet).getByRole('group', { name: 'Level' })).getAllByRole('button').map((b) => b.textContent)
    expect(levelChips).toEqual(['Minor', 'Moderate', 'Major'])
    expect(within(sheet).queryByRole('combobox')).not.toBeInTheDocument() // the old select is gone
    expect(within(sheet).getByText('Add close-up photos')).toBeInTheDocument()
    expect(within(sheet).getByTestId('photo-input')).toHaveAttribute('multiple')
    expect(within(sheet).getByText('Save marked area')).toBeInTheDocument()
    expect(within(sheet).getByText('Save area and continue')).toBeInTheDocument()
  })

  it('the note shows a live n/200 counter and is capped at 200 characters', async () => {
    mockRead()
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Rear fender' }))
    expect(screen.getByTestId('note-counter')).toHaveTextContent('0/200')
    const ta = screen.getByLabelText('Note (optional)')
    expect(ta).toHaveAttribute('maxlength', '200')
    fireEvent.change(ta, { target: { value: 'x'.repeat(250) } })
    expect(screen.getByTestId('note-counter')).toHaveTextContent('200/200')
    expect(ta.value).toHaveLength(200)
  })

  it('Save marked area writes the chosen type/level (severe stored for Major) under the active view and shows the new area card', async () => {
    mockRead()
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Rear fender' }))
    fireEvent.click(screen.getByTestId('type-chip-bent'))
    fireEvent.click(screen.getByTestId('level-chip-severe'))
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'bent inward' } })
    fireEvent.click(screen.getByText('Save marked area'))
    await waitFor(() => expect(api.upsertDamageMark).toHaveBeenCalledTimes(1))
    const [id, areas, mark] = api.upsertDamageMark.mock.calls[0]
    expect(id).toBe('as1')
    expect(areas).toBe(ASSESSMENT.damage_areas)
    expect(mark).toMatchObject({
      view: 'left', region_key: 'rear_fender', region_label: 'Rear fender', component_label: 'Rear fender',
      damage_type: 'bent', severity: 'severe', note: 'bent inward', photo_refs: [],
    })
    expect(api.saveDamageAssessment).not.toHaveBeenCalled() // an assessment already existed
    await waitFor(() => expect(screen.queryByTestId('area-sheet')).not.toBeInTheDocument())
  })

  it('editing an old overview pump mark keeps its STORED view on the write so the edit never duplicates it under top', async () => {
    mockRead({ marks: [{ view: 'overview', region_key: 'hopper', component_label: 'Hopper', damage_type: 'dent', severity: 'moderate', photo_refs: [], source: 'assessment' }] })
    await mount({ vehicleType: 'Concrete Pump', assetNo: 'MP093' })
    fireEvent.click(screen.getByRole('button', { name: /^1\. Hopper/ }))
    fireEvent.click(within(screen.getByTestId('selected-card')).getByRole('button', { name: /Edit/ }))
    fireEvent.click(screen.getByText('Save marked area'))
    await waitFor(() => expect(api.upsertDamageMark).toHaveBeenCalledTimes(1))
    expect(api.upsertDamageMark.mock.calls[0][2]).toMatchObject({ view: 'overview', region_key: 'hopper' })
  })

  it('with no assessment yet, the first save creates a bare draft first and writes into it', async () => {
    mockRead({ marks: [], assessment: null })
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Front door' }))
    fireEvent.click(screen.getByText('Save area and continue'))
    await waitFor(() => expect(api.upsertDamageMark).toHaveBeenCalledTimes(1))
    expect(api.saveDamageAssessment).toHaveBeenCalledWith('acc1', {}, {})
    expect(api.upsertDamageMark.mock.calls[0][0]).toBe('new1')
    expect(api.upsertDamageMark.mock.calls[0][1]).toEqual([])
    await waitFor(() => expect(screen.queryByTestId('area-sheet')).not.toBeInTheDocument())
    expect(screen.queryByTestId('selected-card')).not.toBeInTheDocument() // continue = ready for the next area
  })

  it('a save error is shown through toUserMessage, never a raw error', async () => {
    mockRead()
    api.upsertDamageMark.mockRejectedValue(Object.assign(new Error('new row violates row-level security policy for table "accident_damage_assessments"'), { code: '42501' }))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Rear fender' }))
    fireEvent.click(screen.getByText('Save marked area'))
    await waitFor(() => expect(screen.getByText(/permission|Could not save/i)).toBeInTheDocument())
    expect(screen.queryByText(/row-level security/)).not.toBeInTheDocument()
  })

  it('a non-elevated viewer can look at marks but cannot open the sheet on an empty region', async () => {
    mockRead()
    await mount({ elevated: false })
    expect(screen.getByRole('button', { name: 'Rear fender' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^1\. Front door/ }))
    expect(screen.getByTestId('selected-card')).toBeInTheDocument()
    expect(within(screen.getByTestId('selected-card')).getByRole('button', { name: /Edit/ })).toBeDisabled()
    expect(screen.queryByText('Edit all')).not.toBeInTheDocument()
  })
})

describe('markSummary', () => {
  it('prints type . level . photo count, tolerating an empty mark', () => {
    expect(markSummary({ damage_type: 'dent', severity: 'severe', photo_refs: ['a'] })).toBe('Dent · Major · 1 photo')
    expect(markSummary({})).toBe('0 photos')
  })
})
