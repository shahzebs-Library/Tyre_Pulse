/**
 * CpkDriversPanel - "Why CPK changed (drivers)".
 *
 * Answers management's real question about cost per km / hour: not "what is it"
 * but "what MOVED it". For each country + unit it draws a WATERFALL from the prior
 * CPK to the current CPK, one labelled step per driver (up = bad / red, down =
 * good / green), and writes the whole thing in one honest sentence. When the prior
 * window measured too few assets to trust (the documented coverage trap), it says
 * so and withholds the strong claim instead of overstating a coverage artifact.
 *
 * A compact MANAGEMENT SUMMARY card sits on top: the current fleet CPK (km AND
 * hours, from get_fleet_cpk), the top movers, the worst asset types, and the
 * best-value tyre brand (from get_brand_size_cpk) - the four things a fleet
 * manager wants at a glance, plus a one-click PDF.
 *
 * All maths lives in the pure engine src/lib/cpkDrivers.js; this file only renders.
 */
import { useMemo } from 'react'
import {
  decomposeDrivers, waterfallSteps, topDrivers, managementSentence,
  bestValueBrandFromGroups, segmentExportRows, fmtCpk, fmtCpkDelta, unitNoun,
} from '../../lib/cpkDrivers'
import { groupBySize } from '../../lib/brandSizeCpk'
import { fleetTiles, sortByTypeWorstFirst, unitSuffix } from '../../lib/fleetCpkView'
import { exportToPdf } from '../../lib/exportUtils'
import {
  GitBranch, TrendingUp, TrendingDown, Minus, AlertTriangle, Award,
  Gauge, Clock, FileText, HelpCircle,
} from 'lucide-react'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** A coloured, signed CPK amount with a direction arrow (down = good, green). */
function DeltaBadge({ value, small }) {
  if (value == null || !Number.isFinite(Number(value))) {
    return <span className="text-gray-500 text-xs">N/A</span>
  }
  const v = Number(value)
  const up = v > 0
  const flat = v === 0
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  const cls = flat ? 'text-gray-400' : up ? 'text-red-400' : 'text-emerald-400'
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${cls} ${small ? 'text-xs' : 'text-sm'}`}>
      <Icon size={small ? 12 : 14} />
      {fmtCpkDelta(v)}
    </span>
  )
}

/** One waterfall for a single (country, unit) segment. */
function SegmentWaterfall({ dec }) {
  const wf = useMemo(() => waterfallSteps(dec), [dec])
  const unit = unitNoun(dec.unit)
  const cur = dec.currency || ''

  // scale bars to the largest single step so the shapes are readable
  const maxAbs = Math.max(1e-9, ...wf.steps.map((s) => Math.abs(num(s.amount))))

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {dec.unit === 'engine_hours' ? <Clock size={16} className="text-blue-400" /> : <Gauge size={16} className="text-blue-400" />}
          <h4 className="text-sm font-semibold text-gray-200">
            {dec.country || 'Fleet'} - cost per {unit}
          </h4>
          {!dec.comparable && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300">
              <AlertTriangle size={11} /> coverage limited
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>Prior <span className="text-gray-200 font-medium">{fmtCpk(dec.cpkPrev, cur, dec.unit)}</span></span>
          <span aria-hidden>to</span>
          <span>Now <span className="text-gray-200 font-medium">{fmtCpk(dec.cpkNow, cur, dec.unit)}</span></span>
          <DeltaBadge value={dec.delta} />
        </div>
      </div>

      {/* the sentence: the whole thing in plain English */}
      <p className={`text-xs leading-relaxed ${dec.comparable ? 'text-gray-400' : 'text-amber-300/90'}`}>
        {managementSentence(dec)}
      </p>

      {/* waterfall steps */}
      {wf.steps.length > 0 ? (
        <div className="space-y-1.5">
          {wf.steps.map((s) => {
            const up = num(s.amount) > 0
            const w = `${Math.max(4, (Math.abs(num(s.amount)) / maxAbs) * 100)}%`
            return (
              <div key={s.key} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
                <span className={`text-xs truncate ${s.isResidual ? 'text-gray-500 italic' : 'text-gray-300'}`} title={s.label}>
                  {s.label}
                </span>
                <div className="h-4 relative bg-gray-800/40 rounded">
                  <div
                    className={`h-4 rounded ${up ? 'bg-red-500/60' : 'bg-emerald-500/60'}`}
                    style={{ width: w }}
                  />
                </div>
                <DeltaBadge value={s.amount} small />
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-600">No measurable drivers for this period.</p>
      )}

      <div className="flex items-center gap-4 text-[11px] text-gray-600 pt-1 border-t border-gray-800/60">
        <span>Cost effect <span className="text-gray-400">{dec.costEffect == null ? 'N/A' : fmtCpkDelta(dec.costEffect)}</span></span>
        <span>Utilization effect <span className="text-gray-400">{dec.utilizationEffect == null ? 'N/A' : fmtCpkDelta(dec.utilizationEffect)}</span></span>
        <span className="ml-auto">{dec.matchedNow} assets measured now, {dec.matchedPrev} prior</span>
      </div>
    </div>
  )
}

export default function CpkDriversPanel({
  drivers,          // get_cpk_drivers payload
  fleetCpk,         // get_fleet_cpk result { fleet, byType, perVehicle }
  brandSizeRows,    // get_brand_size_cpk rows
  currency = 'SAR',
  loading = false,
}) {
  const dec = useMemo(() => decomposeDrivers(drivers), [drivers])

  const summaryTiles = useMemo(() => fleetTiles(fleetCpk?.fleet || []), [fleetCpk])
  const worstTypes = useMemo(
    () => sortByTypeWorstFirst(fleetCpk?.byType || []).filter((r) => r.cpk_total != null).slice(0, 3),
    [fleetCpk],
  )
  const bestBrand = useMemo(
    () => bestValueBrandFromGroups(groupBySize(brandSizeRows || [], { minTyres: 2 })),
    [brandSizeRows],
  )
  const topMovers = useMemo(() => {
    // pick the single most-telling comparable segment for the headline movers,
    // else fall back to whatever exists
    const segs = dec.segments || []
    const comparable = segs.find((s) => s.comparable) || segs[0]
    return comparable ? { seg: comparable, movers: topDrivers(comparable, 3) } : null
  }, [dec])

  function handlePdf() {
    const segs = dec.segments || []
    if (!segs.length) return
    const rows = []
    for (const s of segs) {
      for (const r of segmentExportRows(s)) {
        rows.push({ scope: `${s.country || 'Fleet'} ${unitNoun(s.unit)}`, ...r })
      }
    }
    if (!rows.length) return
    exportToPdf(
      rows,
      [
        { key: 'scope', header: 'Scope' },
        { key: 'item', header: 'Driver' },
        { key: 'cpk', header: 'CPK impact' },
        { key: 'money', header: 'Amount' },
      ],
      'Why CPK Changed - driver breakdown (cost per km / hour)',
      'TyrePulse_CPK_Drivers',
      'landscape',
    )
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-500">
        Loading CPK drivers...
      </div>
    )
  }

  const hasSegments = (dec.segments || []).length > 0
  const win = dec.windows

  return (
    <div className="space-y-4">
      {/* ── Management summary card ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-800 bg-gradient-to-br from-gray-900/70 to-gray-900/30 p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Award size={16} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-gray-200">Management summary</h3>
          </div>
          {hasSegments && (
            <button
              type="button"
              onClick={handlePdf}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border border-gray-700 text-gray-300 hover:border-gray-500"
            >
              <FileText size={13} /> PDF
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* current fleet CPK, km and hours */}
          <div className="rounded-md bg-gray-900/50 border border-gray-800 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Current fleet CPK</p>
            {summaryTiles.length ? (
              summaryTiles.map((t, i) => (
                <p key={i} className="text-sm text-gray-200">
                  {t.cpkTotal == null ? 'N/A' : `${t.currency} ${Number(t.cpkTotal).toFixed(4)}${unitSuffix(t.unit)}`}
                  <span className="text-[11px] text-gray-500 ml-1">
                    {unitNoun(t.unit)}{t.coveragePct != null ? ` | ${Number(t.coveragePct).toFixed(0)}% cov` : ''}
                  </span>
                </p>
              ))
            ) : (
              <p className="text-sm text-gray-500">N/A</p>
            )}
          </div>

          {/* top drivers */}
          <div className="rounded-md bg-gray-900/50 border border-gray-800 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Top drivers</p>
            {topMovers && topMovers.movers.length ? (
              topMovers.movers.map((m) => (
                <p key={m.key} className="text-xs text-gray-300 flex items-center justify-between gap-2">
                  <span className="truncate">{m.label}</span>
                  <DeltaBadge value={m.amount} small />
                </p>
              ))
            ) : (
              <p className="text-sm text-gray-500">N/A</p>
            )}
          </div>

          {/* worst asset types */}
          <div className="rounded-md bg-gray-900/50 border border-gray-800 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Worst asset types</p>
            {worstTypes.length ? (
              worstTypes.map((r, i) => (
                <p key={i} className="text-xs text-gray-300 flex items-center justify-between gap-2">
                  <span className="truncate" title={r.vehicle_type}>{r.vehicle_type}</span>
                  <span className="text-gray-400">{r.currency} {Number(r.cpk_total).toFixed(3)}{unitSuffix(r.unit)}</span>
                </p>
              ))
            ) : (
              <p className="text-sm text-gray-500">N/A</p>
            )}
          </div>

          {/* best-value brand */}
          <div className="rounded-md bg-gray-900/50 border border-gray-800 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Best-value brand</p>
            {bestBrand ? (
              <>
                <p className="text-sm text-emerald-300 font-medium truncate" title={bestBrand.brand}>{bestBrand.brand}</p>
                <p className="text-[11px] text-gray-500">
                  {bestBrand.size} | {bestBrand.currency} {Number(bestBrand.cpk).toFixed(3)}/km
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-500">Not yet measurable</p>
            )}
          </div>
        </div>

        {win && (
          <p className="text-[11px] text-gray-600">
            Current window {win.current?.from} to {win.current?.to}, compared with the prior window {win.previous?.from} to {win.previous?.to}.
          </p>
        )}
      </div>

      {/* ── Per-segment waterfalls ──────────────────────────────────────────── */}
      {hasSegments ? (
        <div className="space-y-3">
          {dec.segments.map((s, i) => (
            <SegmentWaterfall key={`${s.country}-${s.unit}-${i}`} dec={s} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6 text-sm text-gray-500 flex items-center gap-2">
          <HelpCircle size={16} className="text-gray-600" />
          No two comparable periods of tyre cost and distance yet, so there is no CPK change to explain.
        </div>
      )}

      {/* method note */}
      <p className="text-[11px] text-gray-600 leading-relaxed flex items-start gap-1.5">
        <GitBranch size={13} className="text-gray-700 mt-0.5 shrink-0" />
        <span>
          Method: fleet CPK is tyre cost divided by the distance or engine-hours it ran, per country and unit.
          The change splits exactly into a cost effect and a utilization effect; the cost effect is broken into
          price, brand or size mix, volume and equipment entering or leaving, with any unattributed remainder shown
          as "Other". Cost per tyre comes from tyre records; distance and hours from the fleet meter. Figures are
          per currency and never blended. A comparison is flagged coverage limited when the prior period measured
          too few assets to trust.
        </span>
      </p>
    </div>
  )
}
