import { describe, expect, it } from 'vitest'
import { calculateTread, forecastTread, conditionRequiresAnalysis } from './aiTyreInspection'
describe('verified tread measurement', () => {
  it('calculates usable tread, not total depth percentage', () => {
    expect(calculateTread({ originalMm:16, measuredMm:8, minimumMm:2 })).toMatchObject({ status:'measured', remainingMm:6, remainingPercent:42.9 })
  })
  it('never invents a reading when absent', () => {
    expect(calculateTread({ originalMm:16, minimumMm:2 }).remainingMm).toBeNull()
  })
  it('rejects physically inconsistent readings', () => {
    expect(calculateTread({ originalMm:10, measuredMm:12, minimumMm:2 }).status).toBe('measurement_required')
  })
  it('does not forecast without history', () => {
    expect(forecastTread([{ odometerKm: 1000, measuredMm:8 }],2)).toBeNull()
  })
  it('requires distance and observed wear before forecasting', () => {
    expect(forecastTread([{odometerKm:1000,measuredMm:8},{odometerKm:11000,measuredMm:6}],2).estimatedKmToLimit).toBe(20000)
  })
  it('does not send good condition photos to automatic defect analysis', () => {
    expect(conditionRequiresAnalysis('Good')).toBe(false)
    expect(conditionRequiresAnalysis('Sidewall damaged')).toBe(true)
  })
})
