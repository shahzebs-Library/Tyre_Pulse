/**
 * workshopAssessmentAnalytics - pure helpers for the damage-assessment section
 * of the accident "Workshop assessment" tab
 * (src/components/accidents/WorkshopAssessmentPanel.jsx).
 *
 * Route recommendation, submit gating and estimate totals already live in
 * src/lib/assessmentGating.js; this module adds only the per-mark reading the
 * section header shows (how many marks, how severe, how many still have no
 * decided action or no photo) so the assessor sees what is left to do. No I/O.
 */
import { DAMAGE_LEVELS } from './accidentCaseVocab'

const LEVEL_KEYS = new Set(DAMAGE_LEVELS.map((l) => l.key))

/** Stored severities are minor/moderate/severe; early marks wrote 'major'. */
export function canonDamageLevel(v) {
  const k = String(v || '').trim().toLowerCase()
  if (!k) return ''
  if (k === 'major') return 'severe'
  return LEVEL_KEYS.has(k) ? k : 'minor'
}

const hasPhoto = (a) => Array.isArray(a?.photo_refs) && a.photo_refs.some((p) => String(p || '').trim())

/** Summary of the damage marks on an assessment. */
export function summarizeDamageMarks(areas = []) {
  const list = Array.isArray(areas) ? areas : []
  const bySeverity = { minor: 0, moderate: 0, severe: 0, unrated: 0 }
  let withoutAction = 0
  let withoutPhoto = 0
  for (const a of list) {
    const level = canonDamageLevel(a?.severity)
    bySeverity[level || 'unrated'] += 1
    if (!String(a?.action || '').trim()) withoutAction += 1
    if (!hasPhoto(a)) withoutPhoto += 1
  }
  return { total: list.length, bySeverity, withoutAction, withoutPhoto, decided: list.length - withoutAction }
}

/** One-line reading for the section header, or '' when there are no marks. */
export function damageSummaryLine(summary) {
  if (!summary?.total) return ''
  const parts = []
  if (summary.bySeverity.severe) parts.push(`${summary.bySeverity.severe} major`)
  if (summary.bySeverity.moderate) parts.push(`${summary.bySeverity.moderate} moderate`)
  if (summary.bySeverity.minor) parts.push(`${summary.bySeverity.minor} minor`)
  if (summary.bySeverity.unrated) parts.push(`${summary.bySeverity.unrated} unrated`)
  const todo = summary.withoutAction
    ? `${summary.withoutAction} still need an action`
    : 'every mark has an action'
  return `${parts.join(', ')}. ${todo}${summary.withoutPhoto ? `, ${summary.withoutPhoto} without a photo` : ''}.`
}
