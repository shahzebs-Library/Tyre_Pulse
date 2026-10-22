/**
 * Deterministic tread calculations. AI observations are deliberately excluded
 * from authoritative measurements. All depths in millimetres.
 */
export function calculateTread({ originalMm, measuredMm, minimumMm }) {
  const values = [originalMm, measuredMm, minimumMm].map(v => v === '' || v == null ? NaN : Number(v))
  const [original, measured, minimum] = values
  if (!values.every(Number.isFinite) || minimum < 0 || measured < 0 || original <= minimum || measured > original) {
    return { status: 'measurement_required', remainingMm: null, remainingPercent: null }
  }
  const remainingMm = Math.max(0, measured - minimum)
  return {
    status: measured <= minimum ? 'at_or_below_limit' : 'measured',
    remainingMm: Math.round(remainingMm * 100) / 100,
    remainingPercent: Math.round((remainingMm / (original - minimum)) * 1000) / 10,
    consumedMm: Math.round((original - measured) * 100) / 100,
  }
}
export function forecastTread(readings, minimumMm) {
  const min = Number(minimumMm)
  if (!Number.isFinite(min) || min < 0) return null
  const sorted = (readings || []).filter(r => Number.isFinite(Number(r.odometerKm)) && Number.isFinite(Number(r.measuredMm)))
    .map(r => ({ km: Number(r.odometerKm), mm: Number(r.measuredMm) }))
    .sort((a,b) => a.km - b.km)
  if (sorted.length < 2) return null
  const first = sorted[0], last = sorted[sorted.length-1]
  const distance = last.km - first.km, used = first.mm - last.mm
  if (distance < 1000 || used <= 0 || last.mm <= min) return null
  const mmPer1000Km = used * 1000 / distance
  return { mmPer1000Km: Math.round(mmPer1000Km * 1000)/1000,
    estimatedKmToLimit: Math.floor((last.mm-min) / used * distance),
    disclaimer: 'Trend estimate only. Not a serviceability or safety decision.' }
}
export function conditionRequiresAnalysis(value) {
  const s = String(value || '').toLowerCase()
  return /(worn|wear|damag|cut|crack|bulg|punct|flat|separat|cord|burst)/.test(s)
}
