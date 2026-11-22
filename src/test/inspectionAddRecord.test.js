import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/api/_client', () => ({
  supabase: {}, unwrap: (r) => r?.data, applyCountry: (q) => q, fetchAllPages: vi.fn(), ServiceError: class extends Error {},
}))

import {
  layoutKeyForVehicleType, assetAutofillPatch, approvalStatusForSave,
  stripRequiredMark, positionsRecordedValue,
} from '../lib/api/inspections'

describe('layoutKeyForVehicleType', () => {
  it('maps the fleet spelling to the diagram layout', () => {
    expect(layoutKeyForVehicleType('TR-MIXER')).toBe('Tri-mixer')
    expect(layoutKeyForVehicleType('Tri-mixer')).toBe('Tri-mixer')
  })
  it('returns empty for nothing', () => {
    expect(layoutKeyForVehicleType('')).toBe('')
    expect(layoutKeyForVehicleType(null)).toBe('')
  })
})

describe('assetAutofillPatch', () => {
  const fleet = { asset_no: 'TM514', site: 'NHC', vehicle_type: 'TR-MIXER', country: 'KSA' }
  it('fills empty site, vehicle type, layout and country', () => {
    expect(assetAutofillPatch({ site: '', vehicle_type: '' }, fleet)).toEqual({
      site: 'NHC', vehicle_type: 'TR-MIXER', _fleet_vehicle_type: 'TR-MIXER', layout_key: 'Tri-mixer', country: 'KSA',
    })
  })
  it('never overwrites a typed site', () => {
    expect(assetAutofillPatch({ site: 'DIRIYAH', vehicle_type: '' }, fleet).site).toBeUndefined()
  })
  it('saves the fleet type when the form type only came from the picker, keeping the layout', () => {
    const p = assetAutofillPatch({ site: 'X', vehicle_type: 'Tri-mixer', layout_key: 'Tri-mixer' }, fleet)
    expect(p.vehicle_type).toBe('TR-MIXER')
    expect(p.layout_key).toBeUndefined()
  })
  it('keeps a stored type that did not come from the picker', () => {
    expect(assetAutofillPatch({ site: 'X', vehicle_type: 'PUMPS' }, fleet).vehicle_type).toBeUndefined()
  })
  it('does nothing with no fleet row', () => {
    expect(assetAutofillPatch({ site: '' }, null)).toEqual({})
  })
})

describe('approvalStatusForSave', () => {
  it('a new not-Done inspection is not stamped done', () => {
    expect(approvalStatusForSave({ status: 'In Progress' })).toBeNull()
    expect(approvalStatusForSave({ status: 'Scheduled' })).toBeNull()
  })
  it('a Done inspection is done', () => {
    expect(approvalStatusForSave({ status: 'Done' })).toBe('done')
    expect(approvalStatusForSave({ id: 1, status: 'Done', approval_status: null })).toBe('done')
    expect(approvalStatusForSave({ id: 1, status: 'Done', approval_status: 'done' })).toBeUndefined()
  })
  it('never touches a decided or pending sign-off', () => {
    for (const a of ['approved', 'pending_approval', 'rejected']) {
      expect(approvalStatusForSave({ id: 1, status: 'In Progress', approval_status: a })).toBeUndefined()
      expect(approvalStatusForSave({ status: 'Done', approval_status: a })).toBeUndefined()
    }
  })
  it('an edit of a not-Done record leaves the stored value', () => {
    expect(approvalStatusForSave({ id: 1, status: 'In Progress', approval_status: 'done' })).toBeUndefined()
  })
})

describe('stripRequiredMark', () => {
  it('removes the trailing mark so the form shows one', () => {
    expect(stripRequiredMark('Title *')).toBe('Title')
    expect(stripRequiredMark('Site')).toBe('Site')
    expect(stripRequiredMark('العنوان *')).toBe('العنوان')
  })
})

describe('positionsRecordedValue', () => {
  it('uses the layout wheel count when the map renders', () => {
    const model = { renderable: true, slots: new Array(12).fill(0), readings: [] }
    expect(positionsRecordedValue({ recorded: 0, positions: 0 }, model)).toBe('0 of 12')
  })
  it('falls back to the summary without a map', () => {
    expect(positionsRecordedValue({ recorded: 2, positions: 4 }, { renderable: false })).toBe('2 of 4')
    expect(positionsRecordedValue({ recorded: null }, null)).toBeNull()
  })
})
