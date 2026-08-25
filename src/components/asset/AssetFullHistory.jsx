/**
 * AssetFullHistory - every record that ever touched one machine, on one
 * timeline.
 *
 * WHY THIS IS A COMPONENT AND NOT PART OF A PAGE
 * ----------------------------------------------
 * Two surfaces answer "what has happened to this asset": the Vehicle History
 * register and the Asset Detail page. It lived inside VehicleHistory.jsx first,
 * which meant Asset Detail could only reach it by importing from another PAGE -
 * a seam that pulls a whole route's module graph in behind it and quietly makes
 * one page depend on another. It sits here so both import the same component
 * and neither owns it.
 *
 * The analysis is NOT in this file. Everything measured lives in the pure
 * engine `src/lib/assetHistory.js`, and every read in `src/lib/api/assetHistory.js`.
 * This file renders what they return and nothing more, so a rule can never be
 * restated differently on two screens.
 *
 * WHAT IT REFUSES TO DO, and each of these is a decision the engine enforces:
 *   - It never blends currencies. Lifetime spend is per currency, and a single
 *     figure exists only when the scope carries exactly one.
 *   - It never renders 0 for something unmeasurable. An unknown cost per km, an
 *     unmeasurable downtime gap and an unrecorded meter all say so in words.
 *   - It keeps "not recorded", "could not be read" and "not in use anywhere"
 *     apart, because they support opposite conclusions.
 *   - It never gives an undated record a date so it can be sorted.
 */
import { useState, useEffect, useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  LineElement, PointElement, Filler, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  Activity, AlertTriangle, Boxes, ChevronDown, ChevronRight, CircleDot,
  ClipboardCheck, Coins, Download, Droplets, FileText, Gauge, Hammer, Info,
  Link2, Loader2, Milestone, Package, PauseCircle, RotateCcw, Search,
  ShieldAlert, Timer, Trash2, Wrench,
} from 'lucide-react'
import DateField from '../ui/DateField'
import { usePagedRows, TablePagination } from '../ui/TablePagination'
import { useSettings } from '../../contexts/SettingsContext'
import { loadAssetHistory } from '../../lib/api/assetHistory'
import {
  HISTORY_SOURCES, historySource, buildTimeline, groupTimelineByPeriod,
  filterTimeline, summarizeAssetHistory, assetLifecycleStages, meterHistory,
  downtimeEpisodes, documentChain, chainForCard, historyGaps, historyExportRows,
  HISTORY_EXPORT_COLUMNS, crossCountryMatches, formatHours, formatSpend,
  formatPerUnitValue, MEASURED_AT,
} from '../../lib/assetHistory'
import { colorAt, withAlpha } from '../../lib/reportColors'
import { toUserMessage } from '../../lib/safeError'

/**
 * SELF-REGISTERING ON PURPOSE. chart.js registration is global but it happens
 * at the module scope of whichever page imports it, so a component that relies
 * on its HOST having registered the right elements renders correctly on one
 * page and throws "line is not a registered element" on another. Registering
 * here makes this component correct wherever it is mounted; register() is
 * idempotent, so a host that already registered these is unaffected.
 *
 * `Filler` is the one that was actually wrong: the meter chart sets
 * `fill: true`, AssetDetail registers Filler and VehicleHistory does not, so
 * the SAME component drew a filled area on one page and a bare line on the
 * other. Registering it here settles that in one place.
 */
ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Filler, Tooltip, Legend)

/**
 * The lazy export-engine import, repeated per file. This one-liner is the
 * established convention across this codebase (Alerts, AssetManagement,
 * CorrectiveActions, Dashboard, StockManagement, TyrePassport, TyreRecords and
 * more each declare it), so it is matched rather than extracted: the PDF and
 * Excel engines are heavy and must not ride with the route chunk.
 */
const loadExportUtils = () => import('../../lib/exportUtils')

// ─────────────────────────────────────────────────────────────────────────────
// FULL ASSET HISTORY - every source that ever touched the machine, one timeline
//
// The four tabs above this cover tyre_records alone: one source out of sixteen.
// This section is the answer to "what has actually happened to this machine",
// and it is built to state what it does NOT know as plainly as what it does.
// Engine: src/lib/assetHistory.js. Reads: src/lib/api/assetHistory.js.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catalog icon name to component. Every one verified against the INSTALLED
 * lucide-react: `Route`, `CircleAlert` and `TriangleAlert` do NOT exist in this
 * version, and a dangling icon reference ships past a clean build and then
 * crashes the page at render.
 */
const SOURCE_ICON = {
  Wrench, Boxes, CircleDot, Gauge, Timer, ClipboardCheck, ShieldAlert,
  PauseCircle, Droplets, Hammer, Trash2, Activity, Coins, Package,
}

const TONE_CLASS = {
  danger:  'text-red-400 border-red-700/40 bg-red-900/20',
  warning: 'text-orange-400 border-orange-700/40 bg-orange-900/20',
  good:    'text-green-400 border-green-700/40 bg-green-900/20',
  info:    'text-blue-400 border-blue-700/40 bg-blue-900/20',
  quiet:   'text-[var(--text-muted)] border-[var(--input-border)] bg-[var(--input-bg)]',
}

const SEVERITY_DOT = {
  critical: '#dc2626', high: '#ea580c', medium: '#ca8a04', low: '#16a34a', info: 'var(--text-dim)',
}

function SourceIcon({ sourceKey, size = 13 }) {
  const meta = historySource(sourceKey)
  const Cmp = meta ? SOURCE_ICON[meta.icon] : null
  return Cmp ? <Cmp size={size} /> : <Info size={size} />
}

/** A figure that is genuinely unknown renders its reason, never a 0. */
function Stat({ label, value, hint, tone = 'quiet' }) {
  return (
    <div className={`rounded-lg border p-3 ${TONE_CLASS[tone] || TONE_CLASS.quiet}`}>
      <p className="text-lg font-bold leading-tight">{value}</p>
      <p className="text-[11px] text-[var(--text-muted)] mt-1">{label}</p>
      {hint && <p className="text-[10px] text-[var(--text-dim)] mt-0.5">{hint}</p>}
    </div>
  )
}

/* ── The V376 collision warning ──────────────────────────────────────────── */

function CrossCountryWarning({ matches, assetNo }) {
  if (!matches.length) return null
  return (
    <div className="rounded-lg border border-orange-700/40 bg-orange-900/15 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle size={15} className="text-orange-400 shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="text-orange-300 font-semibold">
            The code {assetNo} also exists in {matches.map(m => m.country).join(' and ')}.
          </p>
          <p className="text-[var(--text-muted)] mt-1">
            Asset numbers run as a per country sequence, so the same code in another country is
            usually a DIFFERENT machine. This timeline covers only the machine registered in the
            country selected above. Nothing below is mixed in from the rows listed here.
          </p>
          <div className="mt-2 space-y-1">
            {matches.map(m => (
              <p key={m.country} className="text-[var(--text-dim)]">
                {m.country}: {[m.make, m.model, m.vehicle_type, m.site].filter(Boolean).join(' | ') || 'no details recorded'}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Lifetime summary ────────────────────────────────────────────────────── */

function HistorySummary({ summary, meters }) {
  const km = summary.km
  const hours = summary.hours
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Stat
        label="Recorded events"
        value={summary.totalEvents.toLocaleString('en-US')}
        hint={summary.undatedEvents > 0 ? `${summary.undatedEvents} carry no date` : null}
        tone="info"
      />
      <Stat
        label="Lifetime spend"
        value={formatSpend(summary)}
        hint={summary.mixedCurrency ? 'More than one currency, never added' : 'From the classified expense grid'}
        tone="warning"
      />
      <Stat label="Job cards" value={summary.jobCards.toLocaleString('en-US')} />
      <Stat
        label="Tyres fitted"
        value={summary.tyresFitted.toLocaleString('en-US')}
        hint={summary.avgTyreLifeKm !== null
          ? `Average life ${summary.avgTyreLifeKm.toLocaleString('en-US')} km`
          : 'Average life not measurable'}
      />
      <Stat
        label="Distance recorded"
        value={km !== null ? `${Math.round(km).toLocaleString('en-US')} km` : 'Not measurable'}
        hint={meters?.km?.resets ? `${meters.km.resets} meter reset(s) excluded` : null}
      />
      <Stat
        label="Engine hours recorded"
        value={hours !== null ? `${Math.round(hours).toLocaleString('en-US')} h` : 'Not measurable'}
        hint={meters?.hours?.resets ? `${meters.hours.resets} meter reset(s) excluded` : null}
      />
      <Stat
        label="Cost per km"
        value={formatPerUnitValue(summary.costPerKm)}
        hint={summary.costPerKm ? null : 'Needs both spend and a measurable distance'}
      />
      <Stat
        label="Cost per engine hour"
        value={formatPerUnitValue(summary.costPerHour)}
        hint={summary.costPerHour ? null : 'Needs both spend and measurable hours'}
      />
      <Stat label="Inspections" value={summary.inspections.toLocaleString('en-US')} />
      <Stat
        label="Accidents"
        value={summary.accidents.toLocaleString('en-US')}
        tone={summary.accidents > 0 ? 'danger' : 'quiet'}
      />
      <Stat
        label="Days in service"
        value={summary.daysInService !== null ? summary.daysInService.toLocaleString('en-US') : 'Not recorded'}
        hint={summary.daysInService === null ? 'The register carries no start date' : null}
      />
      <Stat
        label="Record spans"
        value={summary.spanDays !== null ? `${summary.spanDays.toLocaleString('en-US')} days` : 'Not measurable'}
        hint={summary.firstEventAt ? `First ${String(summary.firstEventAt).slice(0, 10)}` : null}
      />
    </div>
  )
}

/* ── Downtime, split by cause ────────────────────────────────────────────── */

function DowntimePanel({ downtime }) {
  const tot = downtime.totals
  const rows = [
    { key: 'scheduling', label: 'Waiting for the workshop', hours: tot.scheduling,
      why: 'Production Out to Workshop In. The asset is down and nobody has started: a scheduling gap.' },
    { key: 'workshop', label: 'In the workshop', hours: tot.workshop,
      why: 'Workshop In to Workshop Out. The workshop own time.' },
    { key: 'release', label: 'Waiting for release', hours: tot.release,
      why: 'Workshop Out to Production In. Repaired but not handed back: a release gap.' },
  ]
  const measurable = rows.filter(r => r.hours !== null)
  const max = measurable.length ? Math.max(...measurable.map(r => r.hours)) : 0

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-secondary">Where the downtime went</p>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
          One blended downtime number hides which of the three gaps is costing availability, and only
          one of them is the workshop. A gap that cannot be measured reads as Not measurable, never as
          zero hours, because a zero would flatter every average it lands in.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.key} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-secondary">{r.label}</span>
              <span
                className={`text-sm font-bold ${r.hours === null ? 'text-[var(--text-dim)]' : ''}`}
                style={r.hours === null ? undefined : { color: colorAt(i) }}
              >
                {formatHours(r.hours)}
              </span>
            </div>
            {r.hours !== null && max > 0 && (
              <div className="h-1.5 rounded-full bg-[var(--input-border)] overflow-hidden mt-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(2, (r.hours / max) * 100)}%`, background: colorAt(i) }}
                />
              </div>
            )}
            <p className="text-[10px] text-[var(--text-dim)] mt-1.5">{r.why}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total availability loss" value={formatHours(tot.total)} tone="warning" />
        <Stat
          label="Breakdown days"
          value={downtime.breakdownDays !== null ? downtime.breakdownDays.toLocaleString('en-US') : 'Not recorded'}
          hint="Counted separately, never added to the job card hours"
          tone={downtime.openBreakdowns > 0 ? 'danger' : 'quiet'}
        />
        <Stat
          label="Open breakdowns"
          value={downtime.openBreakdowns}
          tone={downtime.openBreakdowns > 0 ? 'danger' : 'quiet'}
        />
        <Stat
          label="Cards that can be measured"
          value={`${downtime.measurableCards} of ${downtime.measurableCards + downtime.unmeasurableCards}`}
          hint={downtime.unmeasurableCards > 0
            ? `${downtime.unmeasurableCards} carry no usable timestamps`
            : null}
        />
      </div>

      {downtime.episodes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                <th className="pb-2 pr-3">Job card</th>
                <th className="pb-2 pr-3">Out of production</th>
                <th className="pb-2 pr-3">Stage</th>
                <th className="pb-2 pr-3 text-right">Waiting</th>
                <th className="pb-2 pr-3 text-right">Workshop</th>
                <th className="pb-2 pr-3 text-right">Release</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {downtime.episodes.slice(0, 40).map(e => (
                <tr key={e.id} className="border-b border-[var(--input-border)]">
                  <td className="py-1.5 pr-3 font-mono text-blue-400">{e.ref || 'N/A'}</td>
                  <td className="py-1.5 pr-3 text-[var(--text-muted)]">{e.at ? String(e.at).slice(0, 10) : 'N/A'}</td>
                  <td className="py-1.5 pr-3 text-[var(--text-muted)]">
                    {e.stage}{e.running ? ' (running)' : ''}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-secondary">{formatHours(e.scheduling)}</td>
                  <td className="py-1.5 pr-3 text-right text-secondary">{formatHours(e.workshop)}</td>
                  <td className="py-1.5 pr-3 text-right text-secondary">{formatHours(e.release)}</td>
                  <td className="py-1.5 text-right text-secondary">{formatHours(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {downtime.episodes.length > 40 && (
            <p className="text-[10px] text-[var(--text-dim)] mt-2">
              Showing the 40 most recent of {downtime.episodes.length} job cards.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Meters, reset aware ─────────────────────────────────────────────────── */

function MeterPanel({ meters }) {
  const series = [
    { key: 'km', label: 'Odometer', unit: 'km', data: meters.km },
    { key: 'hours', label: 'Hour meter', unit: 'h', data: meters.hours },
  ].filter(s => s.data.readings > 0)

  if (!series.length) {
    return (
      <p className="text-xs text-[var(--text-muted)] py-6 text-center">
        No meter readings recorded for this asset, so distance and engine hours are unknown rather
        than zero.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {series.map((s, si) => {
        const pts = s.data.points
        const chart = {
          labels: pts.map(p => (p.at ? String(p.at).slice(0, 10) : 'no date')),
          datasets: [{
            label: `${s.label} (${s.unit})`,
            data: pts.map(p => p.value),
            borderColor: colorAt(si),
            backgroundColor: withAlpha(colorAt(si), 0.15),
            pointBackgroundColor: pts.map(p => (p.reset ? '#dc2626' : colorAt(si))),
            pointRadius: pts.map(p => (p.reset ? 5 : 3)),
            tension: 0.25,
            fill: true,
          }],
        }
        return (
          <div key={s.key}>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <p className="text-sm font-semibold text-secondary">{s.label}</p>
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
                <span>{s.data.readings} readings</span>
                <span>
                  Distance:{' '}
                  {s.data.distance !== null
                    ? `${Math.round(s.data.distance).toLocaleString('en-US')} ${s.unit}`
                    : 'Not measurable'}
                </span>
                {s.data.resets > 0 && (
                  <span className="flex items-center gap-1 text-red-400">
                    <RotateCcw size={11} /> {s.data.resets} reset{s.data.resets > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            <div style={{ height: 180 }}>
              <Line
                data={chart}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af', font: { size: 9 }, maxTicksLimit: 8 } },
                    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                  },
                }}
              />
            </div>
            {s.data.resets > 0 && (
              <p className="text-[10px] text-[var(--text-dim)] mt-1.5">
                A reading below the previous one means the meter was replaced or rolled back. It is not
                distance travelled, so it is marked in red and left OUT of the distance figure. The
                figure above sums only the rises, which is why it is a segmented total rather than
                last minus first.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── The document chain: RFR to job card to store issue to parts line ────── */

function JobCardChain({ entry, currency }) {
  if (!entry) return null
  const cur = entry.currency && entry.currency !== 'MIXED' ? entry.currency : null
  return (
    <div className="mt-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1 text-[var(--text-muted)]">
          <Link2 size={11} /> Document chain
        </span>
        {entry.rfrNo && (
          <span className="px-1.5 py-0.5 rounded bg-blue-900/30 border border-blue-700/40 text-blue-300">
            RFR {entry.rfrNo}
          </span>
        )}
        <ChevronRight size={11} className="text-[var(--text-dim)]" />
        <span className="px-1.5 py-0.5 rounded bg-[var(--input-bg)] border border-[var(--input-border)] text-secondary font-mono">
          {entry.workOrderNo}
        </span>
        {entry.mrNo && <span className="text-[var(--text-dim)]">MR {entry.mrNo}</span>}
        {entry.scoNo && <span className="text-[var(--text-dim)]">SCO {entry.scoNo}</span>}
      </div>

      {entry.issueList.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">
          No store issue is linked to this card, so what was consumed against it is not recorded.
        </p>
      ) : (
        <div className="space-y-2">
          {entry.issueList.map(issue => (
            <div key={issue.issueNumber || 'none'} className="rounded border border-[var(--input-border)] p-2">
              <p className="text-[11px] text-[var(--text-muted)] mb-1">
                Store issue {issue.issueNumber || '(no slip number)'} - {issue.lines.length} line
                {issue.lines.length > 1 ? 's' : ''}
              </p>
              <table className="w-full text-[11px]">
                <tbody>
                  {issue.lines.map(l => (
                    <tr key={l.id} className="border-t border-[var(--input-border)]">
                      <td className="py-1 pr-2 text-secondary">{l.item_description || l.item_code || 'Item'}</td>
                      <td className="py-1 pr-2 text-[var(--text-muted)] text-right w-16">
                        {l.qty != null ? l.qty : 'N/A'}
                      </td>
                      <td className="py-1 text-secondary text-right w-28">
                        {l.line_cost != null
                          ? `${l.currency || cur || currency || ''} ${Number(l.line_cost).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                          : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <div className="flex justify-between text-xs pt-1 border-t border-[var(--input-border)]">
            <span className="text-[var(--text-muted)]">Issued against this card</span>
            <span className="font-semibold text-secondary">
              {entry.lineTotal === null
                ? 'Not recorded'
                : entry.currency === 'MIXED'
                  ? 'More than one currency, not added'
                  : `${cur || currency || ''} ${Math.round(entry.lineTotal).toLocaleString('en-US')}`}
            </span>
          </div>
        </div>
      )}

      {entry.items.length > 0 && (
        <div>
          <p className="text-[11px] text-[var(--text-muted)] mb-1">Tasks recorded on the card</p>
          <ul className="space-y-0.5">
            {entry.items.slice(0, 25).map(it => (
              <li key={it.id} className="text-[11px] text-secondary">
                {[it.task, it.action, it.detail].filter(Boolean).join(' - ') || 'Task with no description'}
              </li>
            ))}
          </ul>
          {entry.items.length > 25 && (
            <p className="text-[10px] text-[var(--text-dim)] mt-1">
              Showing 25 of {entry.items.length} task lines.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── One timeline row ────────────────────────────────────────────────────── */

function TimelineRow({ event, chain, currency }) {
  const [open, setOpen] = useState(false)
  const meta = historySource(event.source)
  const expandable = event.source === 'job_card' && Boolean(chain)
  const entry = expandable ? chainForCard(chain, event.ref) : null

  return (
    <div className="border-b border-[var(--input-border)] last:border-0 py-2.5">
      <div
        className={`flex items-start gap-3 ${expandable ? 'cursor-pointer' : ''}`}
        onClick={expandable ? () => setOpen(o => !o) : undefined}
      >
        <span
          className="mt-1 w-2 h-2 rounded-full shrink-0"
          style={{ background: SEVERITY_DOT[event.severity] || SEVERITY_DOT.info }}
        />
        <div className="w-24 shrink-0">
          <p className="text-[11px] text-[var(--text-muted)] font-mono">
            {event.undated ? 'No date' : event.day}
          </p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[var(--text-muted)]"><SourceIcon sourceKey={event.source} /></span>
            <span className="text-sm text-secondary">{event.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-dim)]">
              {meta?.label || event.source}
            </span>
            {expandable && (
              <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} chain
              </span>
            )}
          </div>
          {event.detail && (
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{event.detail}</p>
          )}
        </div>
        <div className="w-32 shrink-0 text-right">
          {event.value != null && (
            <p className="text-xs text-secondary whitespace-nowrap">
              {event.currency ? `${event.currency} ` : ''}
              {Number(event.value).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
          )}
        </div>
      </div>
      {open && entry && <JobCardChain entry={entry} currency={currency} />}
      {open && !entry && (
        <p className="text-[11px] text-[var(--text-muted)] mt-2 ml-9">
          No store issue or task line is linked to this card number.
        </p>
      )}
    </div>
  )
}

/* ── The honest read-out ─────────────────────────────────────────────────── */

const GAP_TONE = {
  unreadable: 'danger',
  not_recorded: 'warning',
  not_in_use: 'quiet',
  not_provisioned: 'quiet',
  not_loaded: 'quiet',
}

const GAP_HEADING = {
  unreadable: 'Could not be read, so this is unknown',
  not_recorded: 'Nothing recorded for this asset',
  not_in_use: 'Not in use anywhere in the system yet',
  not_provisioned: 'Not set up in this system',
  not_loaded: 'Not included in this view',
}

function GapsPanel({ gaps }) {
  const order = ['unreadable', 'not_recorded', 'not_in_use', 'not_provisioned', 'not_loaded']
  const grouped = order
    .map(kind => ({ kind, items: gaps.gaps.filter(g => g.kind === kind) }))
    .filter(g => g.items.length)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-secondary">What we do not have</p>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
          {gaps.covered} of {gaps.total} record types carry something for this asset. The groups below
          are deliberately kept apart, because they support opposite conclusions: a table that holds no
          rows ANYWHERE says nothing about this machine, while a table full of other assets that has
          nothing for this one is a real gap in its record. A read that failed is neither.
          Row counts measured {MEASURED_AT}.
        </p>
      </div>

      {gaps.registerGaps.length > 0 && (
        <div className="rounded-lg border border-orange-700/40 bg-orange-900/15 p-3">
          <p className="text-xs font-semibold text-orange-300 mb-1">Fleet register</p>
          <ul className="space-y-0.5">
            {gaps.registerGaps.map((g, i) => (
              <li key={i} className="text-[11px] text-[var(--text-muted)]">{g}</li>
            ))}
          </ul>
        </div>
      )}

      {grouped.map(({ kind, items }) => (
        <div key={kind}>
          <p className="text-xs font-medium text-[var(--text-muted)] mb-1.5">{GAP_HEADING[kind]}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {items.map(g => (
              <div
                key={g.key}
                className={`rounded border p-2 text-[11px] ${TONE_CLASS[GAP_TONE[kind]] || TONE_CLASS.quiet}`}
              >
                <span className="font-medium">{g.label}</span>
                <p className="text-[var(--text-muted)] mt-0.5">{g.message}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      {grouped.length === 0 && (
        <p className="text-xs text-green-400">Every record type carries something for this asset.</p>
      )}
    </div>
  )
}

/* ── Lifecycle ───────────────────────────────────────────────────────────── */

function LifecyclePanel({ lifecycle }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-secondary">Lifecycle</p>
      <div className="space-y-2">
        {lifecycle.stages.map(s => (
          <div
            key={s.key}
            className={`flex items-start gap-3 rounded-lg border p-2.5 ${
              s.known ? TONE_CLASS[s.tone || 'info'] : TONE_CLASS.quiet
            }`}
          >
            <Milestone size={13} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium">{s.label}</span>
                {s.at && (
                  <span className="text-[11px] font-mono text-[var(--text-muted)]">
                    {String(s.at).slice(0, 10)}
                  </span>
                )}
                {!s.known && <span className="text-[10px] text-[var(--text-dim)]">not known</span>}
              </div>
              {s.detail && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{s.detail}</p>}
            </div>
          </div>
        ))}
      </div>
      {lifecycle.silentDays !== null && lifecycle.silentDays > 60 && (
        <p className="text-[11px] text-orange-400">
          Nothing has been recorded against this asset for{' '}
          {lifecycle.silentDays.toLocaleString('en-US')} days.
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AssetFullHistory - the container
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_VIEWS = [
  { key: 'timeline', label: 'Timeline' },
  { key: 'downtime', label: 'Downtime' },
  { key: 'meters', label: 'Meters' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'gaps', label: 'What we do not have' },
]

export function AssetFullHistory({ assetNo, country }) {
  const { activeCurrency } = useSettings()
  const [loading, setLoading]  = useState(true)
  const [error, setError]      = useState(null)
  const [payload, setPayload]  = useState(null)
  const [reloadKey, setReload] = useState(0)

  const [view, setView]            = useState('timeline')
  const [grain, setGrain]          = useState('month')
  const [pickedSources, setPicked] = useState([])   // empty = every source
  const [search, setSearch]        = useState('')
  const [from, setFrom]            = useState('')
  const [to, setTo]                = useState('')

  // `now` is captured ONCE per load so every derived figure on screen refers to
  // the same instant. Reading the clock inside each memo would let the downtime
  // total and the lifecycle age disagree by however long the render took.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const res = await loadAssetHistory(assetNo, { country })
        if (cancelled) return
        setNow(Date.now())
        setPayload(res)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err, 'Could not load the history for this asset.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [assetNo, country, reloadKey])

  const timeline = useMemo(
    () => (payload ? buildTimeline(payload.sources, { now, country }) : null),
    [payload, now, country],
  )

  const meters = useMemo(() => {
    if (!payload) return null
    const odo = payload.sources.odometer?.ok ? payload.sources.odometer.rows : []
    const hrs = payload.sources.engine_hours?.ok ? payload.sources.engine_hours.rows : []
    return meterHistory(odo, hrs)
  }, [payload])

  const downtime = useMemo(() => {
    if (!payload) return null
    const cards = payload.sources.job_card?.ok ? payload.sources.job_card.rows : []
    const bds = payload.sources.breakdown?.ok ? payload.sources.breakdown.rows : []
    return downtimeEpisodes(cards, bds, { now })
  }, [payload, now])

  const chain = useMemo(() => {
    if (!payload) return null
    return documentChain(
      payload.sources.job_card?.ok ? payload.sources.job_card.rows : [],
      payload.sources.parts_line?.ok ? payload.sources.parts_line.rows : [],
      payload.sources.line_item?.ok ? payload.sources.line_item.rows : [],
    )
  }, [payload])

  const summary = useMemo(
    () => (timeline
      ? summarizeAssetHistory(timeline, payload?.fleet, { now, meters, downtime, country })
      : null),
    [timeline, payload, now, meters, downtime, country],
  )

  const lifecycle = useMemo(
    () => (timeline ? assetLifecycleStages(payload?.fleet, timeline, { now }) : null),
    [timeline, payload, now],
  )

  const gaps = useMemo(
    () => (timeline ? historyGaps(timeline, payload?.fleet) : null),
    [timeline, payload],
  )

  const crossCountry = useMemo(
    () => (payload ? crossCountryMatches(payload.fleetRows, country, assetNo) : []),
    [payload, country, assetNo],
  )

  const filtered = useMemo(
    () => (timeline
      ? filterTimeline(timeline.events, { sources: pickedSources, search, from, to })
      : []),
    [timeline, pickedSources, search, from, to],
  )

  // Paged rather than virtualised: the shared pager is what every other long
  // table on this page already uses, and it keeps a busy asset from freezing
  // the browser without adding a dependency.
  const pager = usePagedRows(filtered)
  const grouped = useMemo(() => groupTimelineByPeriod(pager.pageRows, grain), [pager.pageRows, grain])

  async function handleExport(kind) {
    const rows = historyExportRows(filtered)
    const cols = HISTORY_EXPORT_COLUMNS.map(c => c.key)
    const headers = HISTORY_EXPORT_COLUMNS.map(c => c.header)
    const name = `Asset History ${assetNo} ${new Date(now).toISOString().slice(0, 10)}`
    const utils = await loadExportUtils()
    if (kind === 'excel') {
      await utils.exportToExcel(rows, cols, headers, name)
    } else {
      await utils.exportToPdf(
        rows,
        HISTORY_EXPORT_COLUMNS.map(c => ({ key: c.key, header: c.header })),
        `Asset History ${assetNo}${country && country !== 'All' ? ` (${country})` : ''}`,
        name,
        'landscape',
      )
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
        <Loader2 size={18} className="animate-spin mr-2" />
        <span className="text-sm">Reading every record for {assetNo}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card border border-red-500/30 flex items-center gap-3">
        <AlertTriangle size={18} className="text-red-400 shrink-0" />
        <p className="text-sm text-red-300 flex-1">{error}</p>
        <button onClick={() => setReload(k => k + 1)} className="btn-secondary text-xs px-3 py-1.5">
          Retry
        </button>
      </div>
    )
  }

  if (!timeline) return null

  const activeSources = HISTORY_SOURCES.filter(s => (timeline.counts[s.key] || 0) > 0)

  return (
    <div className="space-y-5">
      {crossCountry.length > 0 && <CrossCountryWarning matches={crossCountry} assetNo={assetNo} />}

      {(!country || country === 'All') && (
        <p className="text-[11px] text-[var(--text-muted)] rounded border border-[var(--input-border)] bg-[var(--input-bg)] p-2">
          No country is selected, so this timeline is not scoped to one machine. Where the same asset
          code exists in more than one country these are usually different machines. Pick a country
          above to see one machine.
        </p>
      )}

      {timeline.unreadable.length > 0 && (
        <div className="rounded-lg border border-red-700/40 bg-red-900/15 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-[var(--text-muted)]">
              <span className="text-red-300 font-medium">
                {timeline.unreadable.length} record type
                {timeline.unreadable.length > 1 ? 's' : ''} could not be read
              </span>
              {': '}
              {timeline.unreadable.map(k => historySource(k)?.label || k).join(', ')}. Those sections
              are unknown rather than empty, and every total below excludes them.
            </p>
          </div>
        </div>
      )}

      {payload.truncated.length > 0 && (
        <p className="text-[11px] text-orange-400">
          This asset carries more rows than the page reads for{' '}
          {payload.truncated.map(k => historySource(k)?.label || k).join(', ')}, so those sections are
          a partial view. Narrow the date range to see the rest.
        </p>
      )}

      <HistorySummary summary={summary} meters={meters} />

      {/* View switch */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--input-border)]">
        {HISTORY_VIEWS.map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              view === v.key
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {v.label}
            {v.key === 'gaps' && gaps.unreadableCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-red-600 text-white rounded-full px-1.5 py-0.5">
                {gaps.unreadableCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === 'timeline' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                className="input pl-9 text-sm"
                placeholder="Search this asset history"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <DateField className="text-sm w-36" value={from} onChange={setFrom} placeholder="From" ariaLabel="From date" />
            <DateField className="text-sm w-36" value={to} onChange={setTo} placeholder="To" ariaLabel="To date" min={from || undefined} />
            <select className="input w-32 text-sm" value={grain} onChange={e => setGrain(e.target.value)}>
              <option value="day">By day</option>
              <option value="month">By month</option>
              <option value="year">By year</option>
            </select>
            <div className="flex gap-1">
              <button onClick={() => handleExport('excel')} className="btn-secondary text-xs flex items-center gap-1.5">
                <Download size={12} /> Excel
              </button>
              <button onClick={() => handleExport('pdf')} className="btn-secondary text-xs flex items-center gap-1.5">
                <FileText size={12} className="text-red-400" /> PDF
              </button>
            </div>
          </div>

          {/* Source chips: only sources that actually carry rows for this asset */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setPicked([])}
              className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                pickedSources.length === 0
                  ? 'bg-blue-900/40 border-blue-700/50 text-blue-300'
                  : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              All ({timeline.events.length})
            </button>
            {activeSources.map(s => {
              const on = pickedSources.includes(s.key)
              return (
                <button
                  key={s.key}
                  onClick={() => setPicked(p => (on ? p.filter(k => k !== s.key) : [...p, s.key]))}
                  className={`text-[11px] px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
                    on
                      ? 'bg-blue-900/40 border-blue-700/50 text-blue-300'
                      : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <SourceIcon sourceKey={s.key} size={11} />
                  {s.label} ({timeline.counts[s.key]})
                </button>
              )
            })}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-10 text-center">
              {timeline.events.length === 0
                ? 'Nothing has been recorded against this asset in any of the record types read.'
                : 'No event matches these filters. The asset does have other records.'}
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--input-border)]">
                {grouped.map(bucket => (
                  <div key={bucket.key || 'undated'}>
                    <div className="px-3 py-1.5 bg-[var(--input-bg)] border-b border-[var(--input-border)]">
                      <p className="text-[11px] font-medium text-[var(--text-muted)]">
                        {bucket.label}
                        <span className="text-[var(--text-dim)] ml-2">{bucket.events.length}</span>
                      </p>
                    </div>
                    <div className="px-3">
                      {bucket.events.map(e => (
                        <TimelineRow key={e.id} event={e} chain={chain} currency={activeCurrency} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <TablePagination {...pager} />
              {timeline.undatedCount > 0 && (
                <p className="text-[10px] text-[var(--text-dim)]">
                  {timeline.undatedCount} record{timeline.undatedCount > 1 ? 's' : ''} carry no date and
                  are listed at the end rather than being given a date they do not have.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {view === 'downtime' && <DowntimePanel downtime={downtime} />}
      {view === 'meters' && <MeterPanel meters={meters} />}
      {view === 'lifecycle' && <LifecyclePanel lifecycle={lifecycle} />}
      {view === 'gaps' && <GapsPanel gaps={gaps} />}
    </div>
  )
}

export default AssetFullHistory
