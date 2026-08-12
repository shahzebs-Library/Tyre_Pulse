/**
 * ReliabilityPanel - what the job card ledger says about the machines on the
 * disposal list, and what a board should do about it.
 *
 * The committee argues about machines from memory. The ledger already holds the
 * answer: how many hours each machine has been broken down, how often it fails,
 * how long it has stood untouched, and how little of that work was ever planned.
 * This panel puts those figures beside the disposal proposal.
 *
 * TWO FACTS TRAVEL WITH EVERY NUMBER HERE AND ARE NEVER FOLDED AWAY:
 *
 * 1. Parked hours. A handful of job cards run for months because the machine was
 *    STANDING, not because a mechanic was working on it - the longest single card
 *    in the live data covers over two years, and cards like it hold more than
 *    half of all recorded hours. The server keeps them out of the breakdown
 *    figure; this panel shows them as their own labelled fact. They are never
 *    added back in and never hidden.
 *
 * 2. Date coverage. Only about half the job cards carry a usable business date,
 *    and MTBF, failures a year, idle days and availability all rest on that half.
 *    The coverage share is printed beside those figures, for the fleet and per
 *    machine, so nobody quotes a rate without knowing what it rests on.
 *
 * Every figure comes from the pure `assetDisposalReliability` engine. Nothing is
 * recomputed here: a value the engine returns as null renders "Not measured",
 * never 0 and never a bare dash.
 */
import { useMemo, useState } from 'react'
import {
  Activity, Gauge, Clock, ShieldAlert, ParkingCircle, Wrench, Lightbulb,
  ArrowUpDown, Info, TrendingUp,
} from 'lucide-react'
import {
  RELIABILITY_METRICS, metricMeta, metricValue, metricBand, bandMeta,
  reliabilityRanking, fleetReliability, boardRecommendations, priorityMeta,
  shapeFleetBaseline,
  PRIORITIES,
} from '../../lib/assetDisposalReliability'

const NOT_MEASURED = 'Not measured'

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

const fmtNum = (v, digits = 0) => (isNum(v)
  ? Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })
  : NOT_MEASURED)

const fmtPct = (v) => (isNum(v) ? `${Number(v).toFixed(1)}%` : NOT_MEASURED)

const fmtMoney = (v, currency) => (isNum(v)
  ? `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency || ''}`.trim()
  : NOT_MEASURED)

const TONE_TEXT = {
  danger: 'text-red-300',
  warning: 'text-amber-300',
  good: 'text-emerald-300',
  info: 'text-sky-300',
  quiet: 'text-[var(--text-secondary)]',
}

const TONE_DOT = {
  danger: 'bg-red-400',
  warning: 'bg-amber-400',
  good: 'bg-emerald-400',
  info: 'bg-sky-400',
  quiet: 'bg-slate-400',
}

/** Label from the engine's own metric registry, so the table and the export
 *  cannot drift apart in what they call a figure. */
const label = (key, fallback) => metricMeta(key)?.label || fallback

/**
 * The table. Which metrics are shown and how they are formatted is presentation
 * and lives here; whether a value is good or bad is the engine's judgement and
 * comes from `metricBand`.
 */
const COLUMNS = [
  { key: 'breakdown_hours', kind: 'num', digits: 0 },
  { key: 'failures', kind: 'num', digits: 0 },
  { key: 'mtbf_days', kind: 'num', digits: 1 },
  { key: 'failures_per_year', kind: 'num', digits: 1 },
  { key: 'availability_pct', kind: 'pct' },
  { key: 'idle_days', kind: 'num', digits: 0 },
  { key: 'preventive_share_pct', kind: 'pct' },
  { key: 'spend', kind: 'money' },
  { key: 'cost_per_breakdown_hour', kind: 'money' },
  // Not banded: coverage is the BASIS of the figures to its left, not a
  // performance score, so a low share is a caveat and not a bad machine.
  { key: 'date_coverage_pct', kind: 'pct', band: false },
]

const cellText = (col, value, currency) => {
  if (col.kind === 'pct') return fmtPct(value)
  if (col.kind === 'money') return fmtMoney(value, currency)
  return fmtNum(value, col.digits || 0)
}

function Tile({ label: text, value, sub, tone = 'quiet', icon: Icon }) {
  return (
    <div className="card">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {Icon && <Icon size={13} />} {text}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${TONE_TEXT[tone] || 'text-[var(--text-primary)]'}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  )
}

function RankList({ title, note, items, format, onOpen }) {
  return (
    <div className="card">
      <h4 className="text-sm font-medium text-[var(--text-secondary)]">{title}</h4>
      {note && <p className="text-xs text-[var(--text-muted)] mt-0.5">{note}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Not enough machines carry this figure to rank them.
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {items.map((x) => (
            <li key={x.assetNo} className="flex items-baseline justify-between gap-3 text-sm">
              <button
                type="button"
                onClick={() => onOpen && onOpen(x.row)}
                className="text-[var(--text-primary)] hover:underline text-left"
              >
                {x.assetNo}
              </button>
              <span className={`tabular-nums ${TONE_TEXT[bandMeta(x.band).tone] || TONE_TEXT.quiet}`}>
                {format(x.value)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default function ReliabilityPanel({
  rows = [],
  reliability = null,
  baseline = null,
  currency = '',
  loading = false,
  onRetry,
  // The page computes these too, for the workbook export. Passing them in keeps
  // ONE derivation: two independent calls with the same inputs agree today and
  // drift the first time either side gains an argument.
  recommendations: recommendationsProp = null,
  onRecommendations,
  onOpenAsset,
}) {
  const [sort, setSort] = useState({ key: 'breakdown_hours', dir: 'desc' })

  // The fleet strip follows the rows ON SCREEN. Quoting register-wide totals
  // over a filtered table is how somebody ends up reading out a number that is
  // not in front of them.
  const fleet = useMemo(() => fleetReliability(rows), [rows])

  const money = fleet.mixedCurrency ? '' : (currency || fleet.currency || '')

  // The baseline is what lets the board view say both halves of the truth: that
  // this list costs well above the fleet average, AND that writing it off leaves
  // the bulk of the bill untouched. Absent, those two points simply do not
  // appear rather than appearing on a guess.
  const shapedBaseline = useMemo(() => shapeFleetBaseline(baseline), [baseline])

  const recommendations = useMemo(
    () => (Array.isArray(recommendationsProp) ? recommendationsProp : boardRecommendations(rows, fleet, {
      now: Date.now(),
      currency: money || 'SAR',
      fleetBaseline: shapedBaseline,
    })),
    [recommendationsProp, rows, fleet, money, shapedBaseline],
  )

  const sorted = useMemo(() => {
    const { key, dir } = sort
    const mul = dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (key === 'asset_no') {
        return mul * String(a?.asset_no || '').localeCompare(String(b?.asset_no || ''))
      }
      const av = metricValue(a, key)
      const bv = metricValue(b, key)
      // An unmeasured machine sorts last in BOTH directions. It is not the best
      // and it is not the worst; it is unknown, and pinning it to either end
      // would read as a ranking.
      if (av == null && bv == null) return String(a?.asset_no || '').localeCompare(String(b?.asset_no || ''))
      if (av == null) return 1
      if (bv == null) return -1
      return mul * (av - bv)
    })
  }, [rows, sort])

  const rankings = useMemo(() => ({
    availability: reliabilityRanking(rows, 'availability_pct', { limit: 5, worst: true }),
    failures: reliabilityRanking(rows, 'failures_per_year', { limit: 5, worst: true }),
    costHour: reliabilityRanking(rows, 'cost_per_breakdown_hour', { limit: 5, worst: true }),
    idle: reliabilityRanking(rows, 'idle_days', { limit: 5, worst: true }),
  }), [rows])

  if (loading) {
    return <div className="card text-[var(--text-muted)]">Reading the job card history for these machines...</div>
  }

  if (!reliability || reliability.ok === false) {
    const notProvisioned = reliability?.reason === 'not_provisioned'
    return (
      <div className="card border border-amber-800/50 space-y-2">
        <p className="text-amber-300 font-medium">
          {notProvisioned
            ? 'Breakdown history is not enabled on this database yet.'
            : 'The breakdown history could not be read.'}
        </p>
        <p className="text-sm text-[var(--text-muted)]">
          {notProvisioned
            ? 'These figures have not been created here. The disposal register itself is unaffected.'
            : 'No reliability figure is shown at all, because a screen of zeros here would read as a fleet that never breaks down.'}
        </p>
        {!notProvisioned && onRetry && (
          <button onClick={onRetry} className="btn-secondary text-sm">Retry</button>
        )}
      </div>
    )
  }

  if (!fleet.withHistory) {
    return (
      <div className="card text-[var(--text-muted)]">
        <p className="text-[var(--text-primary)] font-medium">No job card history matches this selection.</p>
        <p className="text-sm mt-1">
          The history was read successfully and none of these machines carries a job card in it. That is a gap in the
          records, not proof that the machines never failed.
        </p>
      </div>
    )
  }

  const coverage = fleet.date_coverage_pct

  return (
    <div className="space-y-4">
      {/* ── Fleet strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile
          label={label('breakdown_hours', 'Breakdown hours')}
          value={fmtNum(fleet.breakdown_hours)}
          tone={isNum(fleet.breakdown_hours) ? 'danger' : 'quiet'}
          icon={Clock}
          sub={isNum(fleet.parked_hours)
            ? `Parked time of ${fmtNum(fleet.parked_hours)} hours is counted separately, not here`
            : 'Parked time is counted separately'}
        />
        <Tile
          label="Parked, not repaired"
          value={isNum(fleet.parked_cards) ? `${fmtNum(fleet.parked_cards)} cards` : NOT_MEASURED}
          tone="warning"
          icon={ParkingCircle}
          sub={isNum(fleet.parkedThresholdHours)
            ? `${fmtNum(fleet.parked_hours)} hours. A card over ${fmtNum(fleet.parkedThresholdHours)} hours records a machine standing still`
            : `${fmtNum(fleet.parked_hours)} hours of standing time`}
        />
        <Tile
          label={label('failures', 'Failures')}
          value={fmtNum(fleet.failures)}
          tone={isNum(fleet.failures) ? 'warning' : 'quiet'}
          icon={ShieldAlert}
          sub={`${fmtNum(fleet.job_cards)} job cards on ${fmtNum(fleet.withHistory)} machines`}
        />
        <Tile
          label="Median MTBF"
          value={isNum(fleet.medians?.mtbf_days) ? `${fmtNum(fleet.medians.mtbf_days, 1)} days` : NOT_MEASURED}
          icon={Gauge}
          sub="Half the machines fail sooner than this"
        />
        <Tile
          label={`Under ${fleet.belowAvailabilityPct} percent available`}
          value={fmtNum(fleet.belowAvailability)}
          tone={fleet.belowAvailability > 0 ? 'danger' : 'quiet'}
          icon={Activity}
          sub={fleet.availabilityMeasured
            ? `Of ${fmtNum(fleet.availabilityMeasured)} machines with an availability figure`
            : 'No machine here carries an availability figure'}
        />
        <Tile
          label="Never planned-serviced"
          value={fmtNum(fleet.neverPreventive)}
          tone={fleet.neverPreventive > 0 ? 'warning' : 'quiet'}
          icon={Wrench}
          sub={isNum(fleet.preventive_share_pct)
            ? `Planned work is ${fmtPct(fleet.preventive_share_pct)} of every job card on this list`
            : 'Machines with job cards but no planned service'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card md:col-span-2 flex items-start gap-2">
          <Info size={15} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-secondary)]">
            {isNum(coverage)
              ? `MTBF, failures a year, idle days and availability rest on the ${fmtPct(coverage)} of job cards that carry a usable date. The rest still count towards breakdown hours and failures, but cannot be placed on a calendar.`
              : 'The share of job cards carrying a usable date is not measured for this selection, so the time based figures below carry no stated basis.'}
            {fleet.mixedCurrency && ' Spend is not totalled here because this selection carries more than one currency.'}
          </p>
        </div>
        <Tile
          label="Idle over a year"
          value={fmtNum(fleet.idleOverYear)}
          tone={fleet.idleOverYear > 0 ? 'warning' : 'quiet'}
          icon={TrendingUp}
          sub={fleet.idleMeasured
            ? `Of ${fmtNum(fleet.idleMeasured)} machines with a dated last job card`
            : 'No machine here has a dated last job card'}
        />
      </div>

      {/* ── What the board should decide ────────────────────────────────
          Rendered only when the engine has something to say. A panel that
          always prints something teaches a board to stop reading it. */}
      {recommendations.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Lightbulb size={15} />
            <span className="text-sm font-medium">What the board should decide</span>
          </div>
          {Object.values(PRIORITIES)
            .sort((a, b) => a.rank - b.rank)
            .map((p) => {
              const group = recommendations.filter((r) => priorityMeta(r.priority).key === p.key)
              if (!group.length) return null
              return (
                <div key={p.key} className="space-y-2">
                  <div className={`text-[11px] uppercase tracking-wide ${TONE_TEXT[p.tone] || TONE_TEXT.quiet}`}>
                    {p.label}
                  </div>
                  {group.map((r) => (
                    <div key={r.id} className="flex items-start gap-2">
                      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${TONE_DOT[p.tone] || TONE_DOT.quiet}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)]">{r.headline}</p>
                        {r.detail && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{r.detail}</p>}
                        {Array.isArray(r.evidence) && r.evidence.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {r.evidence.map((e, i) => (
                              <li key={i} className="text-xs text-[var(--text-muted)]">{e}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
        </div>
      )}

      {/* ── The lists a board scans first ───────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <RankList
          title="Least available"
          note="Share of dated days the machine was not sitting on an open job card"
          items={rankings.availability}
          format={fmtPct}
          onOpen={onOpenAsset}
        />
        <RankList
          title="Fails most often"
          note={label('failures_per_year', 'Failures per year')}
          items={rankings.failures}
          format={(v) => `${fmtNum(v, 1)} a year`}
          onOpen={onOpenAsset}
        />
        <RankList
          title="Costliest breakdown hour"
          note="Maintenance spend over real breakdown hours"
          items={rankings.costHour}
          format={(v) => fmtMoney(v, money)}
          onOpen={onOpenAsset}
        />
        <RankList
          title="Longest untouched"
          note={label('idle_days', 'Days since the last job card')}
          items={rankings.idle}
          format={(v) => `${fmtNum(v)} days`}
          onOpen={onOpenAsset}
        />
      </div>

      {/* ── Per machine ─────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-[var(--input-border)] flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Reliability by machine</span>
          <span className="text-xs text-[var(--text-muted)]">
            {fmtNum(fleet.withHistory)} of {fmtNum(fleet.assets)} carry job card history. A machine with none keeps its
            row, because no record is not the same as no failures.
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--input-bg)] text-[var(--text-muted)]">
              <tr>
                {[{ key: 'asset_no', head: 'Asset' }, ...COLUMNS.map((c) => ({ key: c.key, head: label(c.key, c.key) }))].map((c) => (
                  <th key={c.key} className="text-left font-medium px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSort((s) => ({
                        key: c.key,
                        dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc',
                      }))}
                      className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
                    >
                      {c.head}
                      <ArrowUpDown size={11} className={sort.key === c.key ? 'opacity-100' : 'opacity-30'} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r?.id || r?.asset_no || i}
                  onClick={() => onOpenAsset && onOpenAsset(r)}
                  className={`border-t border-[var(--input-border)] ${onOpenAsset ? 'cursor-pointer hover:bg-[var(--input-bg)]' : ''}`}
                >
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)] whitespace-nowrap">
                    {r?.asset_no || NOT_MEASURED}
                  </td>
                  {COLUMNS.map((col) => {
                    const v = metricValue(r, col.key)
                    // Banded against the machines actually on screen, so a
                    // filtered list is judged against its own peers.
                    const band = col.band === false ? 'unknown' : metricBand(col.key, v, rows)
                    const tone = band === 'unknown' ? null : bandMeta(band).tone
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 whitespace-nowrap tabular-nums ${tone ? TONE_TEXT[tone] : 'text-[var(--text-secondary)]'}`}
                      >
                        {cellText(col, v, money)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">
          Breakdown hours exclude cards that record a machine standing parked. Colour compares a machine with the others
          in this selection and needs at least three measured peers; a blank reads as not measured, which is not zero.
        </p>
      </div>

      {/* Plain English for a reader who did not build the figures. */}
      <details className="card">
        <summary className="text-sm font-medium text-[var(--text-secondary)] cursor-pointer">
          What these figures mean
        </summary>
        <dl className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {RELIABILITY_METRICS.map((m) => (
            <div key={m.key}>
              <dt className="text-sm text-[var(--text-primary)]">
                {m.label}
                {m.unit && m.unit !== 'count' ? <span className="text-[var(--text-muted)]"> ({m.unit})</span> : null}
              </dt>
              <dd className="text-xs text-[var(--text-muted)] mt-0.5">
                {m.explain}
                {m.timeBased ? ' Rests on the job cards that carry a usable date.' : ''}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}
