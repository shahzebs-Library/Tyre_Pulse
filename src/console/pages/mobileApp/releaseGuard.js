/**
 * Pure checks for Mobile App Control that sit beside src/lib/mobileOps.js
 * (which owns gateRisk and the version compare). Two questions:
 *
 *   latestRisk  - is it safe to RECORD this as the newest released build?
 *                 Recording a version BELOW the forced-update minimum would
 *                 leave the gate demanding a build that, on record, does not
 *                 exist; the same stranding the gate interlock refuses from the
 *                 other side. So that is refused too.
 *   gateImpact  - how many registered phones a proposed minimum would put
 *                 behind the update wall, from the install base by version.
 */
import { parseVersion, compareVersions } from '../../../lib/mobileOps'

export function latestRisk(proposedLatest, currentMin, currentLatest) {
  const v = String(proposedLatest ?? '').trim()
  if (!v) return { level: 'blocked', reason: 'Enter the version number that is live on Google Play.' }
  if (!parseVersion(v)) return { level: 'blocked', reason: `"${v}" is not a version number (expected something like 0.1.1).` }
  const min = String(currentMin ?? '').trim()
  if (min && parseVersion(min) && compareVersions(min, v) > 0) {
    return {
      level: 'blocked',
      reason: `The forced-update minimum is ${min}. Recording ${v} as the newest release would leave the gate demanding a build that does not exist. Lower the minimum first.`,
    }
  }
  if (currentLatest && parseVersion(currentLatest) && compareVersions(v, currentLatest) < 0) {
    return { level: 'warn', reason: `${v} is older than the ${currentLatest} already on record. Only save this if the record was wrong.` }
  }
  return { level: 'clear', reason: `${v} will be recorded as the newest build on Google Play.` }
}

/**
 * Split the install base against a proposed minimum. `byVersion` rows are
 * { app_version, devices }. A device whose version we do not know is counted
 * as unknown, never as safe: the phone knows its own version even if we do not.
 */
export function gateImpact(proposedMin, byVersion = []) {
  const min = String(proposedMin ?? '').trim()
  let behind = 0; let ok = 0; let unknown = 0
  for (const r of byVersion || []) {
    const n = Number(r.devices) || 0
    if (!parseVersion(r.app_version)) { unknown += n; continue }
    if (min && parseVersion(min) && compareVersions(r.app_version, min) < 0) behind += n
    else ok += n
  }
  return { behind, ok, unknown, total: behind + ok + unknown, gated: !!(min && parseVersion(min)) }
}

/** Devices not on the newest release, from the same install-base rows. */
export function behindLatest(latest, byVersion = []) {
  if (!parseVersion(latest)) return null
  return (byVersion || []).reduce((a, r) => a + (parseVersion(r.app_version) && compareVersions(r.app_version, latest) < 0 ? (Number(r.devices) || 0) : 0), 0)
}
