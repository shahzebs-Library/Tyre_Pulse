// ─────────────────────────────────────────────────────────────────────────────
// anomalyEngine.js - Rule-based suspicious tyre record detection (no AI)
// Detects: short replacements, same-day bursts, rapid recurrence, cost spikes
// ─────────────────────────────────────────────────────────────────────────────

import { mean, stdDev, groupBy } from './analyticsEngine'

export const ANOMALY_TYPES = {
  SHORT_INTERVAL:    'SHORT_INTERVAL',     // Tyre replaced within N days of previous on same asset
  SAME_DAY_BURST:    'SAME_DAY_BURST',     // Multiple tyres on same asset same day
  RAPID_RECURRENCE:  'RAPID_RECURRENCE',   // Asset has high-risk records clustering in short window
  COST_SPIKE:        'COST_SPIKE',         // Cost_per_tyre > 3σ above fleet mean
  SERIAL_REUSE:      'SERIAL_REUSE',       // Same serial_no appears on different assets
  DUPLICATE_ENTRY:   'DUPLICATE_ENTRY',    // Same asset+serial+date (exact duplicate)
}

export const ANOMALY_SEVERITY = {
  HIGH:   'high',
  MEDIUM: 'medium',
  LOW:    'low',
}

const ANOMALY_CONFIG = {
  shortIntervalDays:    7,    // Flag if replaced < 7 days after previous on same asset
  warnIntervalDays:     30,   // Warn if replaced < 30 days after previous
  sameDayBurstThreshold: 3,   // Flag if ≥ 3 tyres on same asset on same date
  warnSameDayThreshold:  2,   // Warn if ≥ 2 tyres on same asset same date
  rapidRecurrenceWindow: 30,  // Days window for rapid recurrence check
  rapidRecurrenceCount:  3,   // Number of high-risk events in window to flag
  costSpikeZScore:       3,   // Z-score threshold for cost spike
  costWarnZScore:        2,   // Z-score threshold for cost warning
}

/**
 * Detect all anomalies in a set of tyre records.
 * Expects records sorted by issue_date ASC (or will sort internally).
 * @param {Array} records  - full array of tyre_record rows
 * @param {object} [config] - override defaults
 * @returns {Anomaly[]}
 */
export function detectAnomalies(records, config = {}) {
  const cfg = { ...ANOMALY_CONFIG, ...config }
  const anomalies = []
  const seen = new Set()  // deduplicate same anomaly id

  if (!records || records.length === 0) return []

  // Sort by date ascending for interval checks
  const sorted = [...records].sort((a, b) => {
    const da = a.issue_date ? new Date(a.issue_date) : 0
    const db = b.issue_date ? new Date(b.issue_date) : 0
    return da - db
  })

  // ── Fleet-wide cost stats ────────────────────────────────────────────────
  const costs = records.map(r => r.cost_per_tyre).filter(v => v > 0)
  const costMean = mean(costs)
  const costSd   = stdDev(costs)

  // ── Group by asset ───────────────────────────────────────────────────────
  const byAsset = groupBy(
    sorted.filter(r => r.asset_no && r.issue_date),
    r => r.asset_no
  )

  // ── Group by serial ──────────────────────────────────────────────────────
  const bySerial = groupBy(
    sorted.filter(r => r.serial_no),
    r => r.serial_no
  )

  // ────────────────────────────────────────────────────────────────────────
  // 1. SHORT INTERVAL - same asset replaced < threshold days after previous
  // ────────────────────────────────────────────────────────────────────────
  Object.entries(byAsset).forEach(([assetNo, recs]) => {
    for (let i = 1; i < recs.length; i++) {
      const prev = recs[i - 1]
      const curr = recs[i]
      if (!prev.issue_date || !curr.issue_date) continue

      const prevDate = new Date(prev.issue_date)
      const currDate = new Date(curr.issue_date)
      const daysDiff = Math.round((currDate - prevDate) / (1000 * 86400))

      if (daysDiff < 0) continue  // bad dates

      let severity = null
      if (daysDiff < cfg.shortIntervalDays) severity = ANOMALY_SEVERITY.HIGH
      else if (daysDiff < cfg.warnIntervalDays) severity = ANOMALY_SEVERITY.MEDIUM

      if (severity) {
        const id = `SI::${assetNo}::${curr.id}`
        if (!seen.has(id)) {
          seen.add(id)
          anomalies.push({
            id,
            type:     ANOMALY_TYPES.SHORT_INTERVAL,
            severity,
            asset_no: assetNo,
            site:     curr.site || prev.site,
            record_ids: [prev.id, curr.id],
            records:    [prev, curr],
            message:  `Asset ${assetNo}: tyre replaced only ${daysDiff} day${daysDiff !== 1 ? 's' : ''} after previous replacement`,
            detail:   `Previous: ${prev.issue_date} (${prev.brand || 'unknown brand'}) → Current: ${curr.issue_date} (${curr.brand || 'unknown brand'})`,
            daysDiff,
            prev_date: prev.issue_date,
            curr_date: curr.issue_date,
          })
        }
      }
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // 2. SAME-DAY BURST - multiple tyres on same asset same date
  // ────────────────────────────────────────────────────────────────────────
  Object.entries(byAsset).forEach(([assetNo, recs]) => {
    const byDate = groupBy(recs, r => r.issue_date)
    Object.entries(byDate).forEach(([date, dayRecs]) => {
      const totalQty = dayRecs.reduce((s, r) => s + (r.qty || 1), 0)
      if (dayRecs.length < cfg.warnSameDayThreshold && totalQty < cfg.warnSameDayThreshold) return

      const severity = (dayRecs.length >= cfg.sameDayBurstThreshold || totalQty >= cfg.sameDayBurstThreshold)
        ? ANOMALY_SEVERITY.HIGH : ANOMALY_SEVERITY.MEDIUM

      const id = `SDB::${assetNo}::${date}`
      if (!seen.has(id)) {
        seen.add(id)
        anomalies.push({
          id,
          type:       ANOMALY_TYPES.SAME_DAY_BURST,
          severity,
          asset_no:   assetNo,
          site:       dayRecs[0].site,
          record_ids: dayRecs.map(r => r.id),
          records:    dayRecs,
          message:    `Asset ${assetNo}: ${dayRecs.length} tyre record${dayRecs.length !== 1 ? 's' : ''} (${totalQty} total qty) on ${date}`,
          detail:     `Records: ${dayRecs.map(r => r.brand || 'Unknown').join(', ')}`,
          count:      dayRecs.length,
          totalQty,
          date,
        })
      }
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // 3. RAPID RECURRENCE - ≥N high-risk events on same asset within window
  // ────────────────────────────────────────────────────────────────────────
  Object.entries(byAsset).forEach(([assetNo, recs]) => {
    const highRiskRecs = recs.filter(r => r.risk_level === 'High' && r.issue_date)
    if (highRiskRecs.length < cfg.rapidRecurrenceCount) return

    for (let i = cfg.rapidRecurrenceCount - 1; i < highRiskRecs.length; i++) {
      const window = highRiskRecs.slice(i - cfg.rapidRecurrenceCount + 1, i + 1)
      const first  = new Date(window[0].issue_date)
      const last   = new Date(window[window.length - 1].issue_date)
      const days   = Math.round((last - first) / (1000 * 86400))

      if (days <= cfg.rapidRecurrenceWindow) {
        const id = `RR::${assetNo}::${window[0].id}`
        if (!seen.has(id)) {
          seen.add(id)
          anomalies.push({
            id,
            type:       ANOMALY_TYPES.RAPID_RECURRENCE,
            severity:   ANOMALY_SEVERITY.HIGH,
            asset_no:   assetNo,
            site:       window[0].site,
            record_ids: window.map(r => r.id),
            records:    window,
            message:    `Asset ${assetNo}: ${cfg.rapidRecurrenceCount} high-risk failures within ${days} days`,
            detail:     `From ${window[0].issue_date} to ${window[window.length - 1].issue_date}`,
            count:      window.length,
            days,
          })
        }
        break  // one anomaly per asset cluster
      }
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // 4. COST SPIKE - cost_per_tyre is outlier (Z-score)
  // ────────────────────────────────────────────────────────────────────────
  if (costSd > 0) {
    records.forEach(r => {
      if (!r.cost_per_tyre || r.cost_per_tyre <= 0) return
      const z = (r.cost_per_tyre - costMean) / costSd
      if (Math.abs(z) < cfg.costWarnZScore) return

      const severity = Math.abs(z) >= cfg.costSpikeZScore ? ANOMALY_SEVERITY.HIGH : ANOMALY_SEVERITY.MEDIUM
      const id = `CS::${r.id}`
      if (!seen.has(id)) {
        seen.add(id)
        anomalies.push({
          id,
          type:       ANOMALY_TYPES.COST_SPIKE,
          severity,
          asset_no:   r.asset_no,
          site:       r.site,
          record_ids: [r.id],
          records:    [r],
          message:    `Unusual cost: SAR ${r.cost_per_tyre.toLocaleString()} for ${r.brand || 'unknown brand'} (fleet avg SAR ${Math.round(costMean).toLocaleString()})`,
          detail:     `Z-score: ${z.toFixed(2)} - Asset ${r.asset_no || '?'} on ${r.issue_date || '?'}`,
          cost:       r.cost_per_tyre,
          zScore:     z,
          fleetAvg:   Math.round(costMean),
        })
      }
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // 5. SERIAL REUSE - same serial_no on multiple different assets
  // ────────────────────────────────────────────────────────────────────────
  Object.entries(bySerial).forEach(([serial, recs]) => {
    if (!serial || serial === 'null' || serial === '') return
    const assets = [...new Set(recs.map(r => r.asset_no).filter(Boolean))]
    if (assets.length < 2) return

    const id = `SR::${serial}`
    if (!seen.has(id)) {
      seen.add(id)
      anomalies.push({
        id,
        type:       ANOMALY_TYPES.SERIAL_REUSE,
        severity:   ANOMALY_SEVERITY.HIGH,
        asset_no:   assets.join(', '),
        site:       recs[0].site,
        record_ids: recs.map(r => r.id),
        records:    recs,
        message:    `Serial ${serial} appears on ${assets.length} different assets: ${assets.join(', ')}`,
        detail:     `${recs.length} total records. Possible data entry error or tyre transfer without proper logging.`,
        serial,
        assets,
      })
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // 6. EXACT DUPLICATE - same asset + serial + date combination
  // ────────────────────────────────────────────────────────────────────────
  const dupMap = {}
  records.forEach(r => {
    if (!r.asset_no || !r.serial_no || !r.issue_date) return
    const key = `${r.asset_no}::${r.serial_no}::${r.issue_date}`
    if (!dupMap[key]) dupMap[key] = []
    dupMap[key].push(r)
  })

  Object.entries(dupMap).forEach(([key, recs]) => {
    if (recs.length < 2) return
    const id = `DUP::${key}`
    if (!seen.has(id)) {
      seen.add(id)
      anomalies.push({
        id,
        type:       ANOMALY_TYPES.DUPLICATE_ENTRY,
        severity:   ANOMALY_SEVERITY.HIGH,
        asset_no:   recs[0].asset_no,
        site:       recs[0].site,
        record_ids: recs.map(r => r.id),
        records:    recs,
        message:    `Exact duplicate: Asset ${recs[0].asset_no} serial ${recs[0].serial_no} on ${recs[0].issue_date} (${recs.length} entries)`,
        detail:     `IDs: ${recs.map(r => r.id.slice(0, 8)).join(', ')}`,
        count:      recs.length,
      })
    }
  })

  // Sort: high first, then by type
  const ORDER = { high: 0, medium: 1, low: 2 }
  return anomalies.sort((a, b) => (ORDER[a.severity] ?? 3) - (ORDER[b.severity] ?? 3))
}

/**
 * Summarise anomaly counts by type and severity
 */
export function summariseAnomalies(anomalies) {
  const bySeverity = { high: 0, medium: 0, low: 0 }
  const byType = {}
  anomalies.forEach(a => {
    bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1
    byType[a.type] = (byType[a.type] || 0) + 1
  })
  return { bySeverity, byType, total: anomalies.length }
}

export const ANOMALY_TYPE_LABELS = {
  [ANOMALY_TYPES.SHORT_INTERVAL]:   'Short Interval',
  [ANOMALY_TYPES.SAME_DAY_BURST]:   'Same-Day Burst',
  [ANOMALY_TYPES.RAPID_RECURRENCE]: 'Rapid Recurrence',
  [ANOMALY_TYPES.COST_SPIKE]:       'Cost Spike',
  [ANOMALY_TYPES.SERIAL_REUSE]:     'Serial Reuse',
  [ANOMALY_TYPES.DUPLICATE_ENTRY]:  'Exact Duplicate',
}

export const ANOMALY_TYPE_DESC = {
  [ANOMALY_TYPES.SHORT_INTERVAL]:   'Tyre replaced less than 7 days after previous on same asset',
  [ANOMALY_TYPES.SAME_DAY_BURST]:   'Multiple tyres replaced on same asset on same date',
  [ANOMALY_TYPES.RAPID_RECURRENCE]: '3+ high-risk failures on same asset within 30 days',
  [ANOMALY_TYPES.COST_SPIKE]:       'Tyre cost is a statistical outlier vs fleet average',
  [ANOMALY_TYPES.SERIAL_REUSE]:     'Same serial number recorded on multiple different assets',
  [ANOMALY_TYPES.DUPLICATE_ENTRY]:  'Identical asset + serial + date combination recorded more than once',
}
