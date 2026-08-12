/**
 * AssetHistoryDrawer - one machine's history, opened from either table on the
 * disposal page.
 *
 * The register answers "what did the committee propose". This drawer answers
 * "what has this machine actually done to us": the hours it has been broken
 * down, how often it fails, how long it has stood untouched, what it has cost by
 * year, and how much of the work on it was ever planned.
 *
 * The two standing honesty rules of this module hold here too. Parked hours are
 * shown as their OWN fact and are never presented as breakdown hours. The share
 * of job cards carrying a usable date is printed beside every time based figure,
 * because those figures rest on it.
 *
 * All values and all judgements come from the pure `assetDisposalReliability`
 * engine, read through `metricValue` because merged rows keep the history NESTED
 * under `reliability` (the committee and the ledger both have a `spend` and a
 * `job_cards`, and a flattened row would silently answer with the wrong one).
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { ExternalLink, ParkingCircle, Info } from 'lucide-react'
import Modal from '../ui/Modal'
import { colorAt, withAlpha } from '../../lib/reportColors'
import {
  metricValue, metricBand, bandMeta, metricMeta, spendByYear, spendTrend,
} from '../../lib/assetDisposalReliability'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const NOT_MEASURED = 'Not measured'

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

const fmtNum = (v, digits = 0) => (isNum(v)
  ? Number(v).toLocaleString(undefined, { maximumFractionDigits: digits })
  : NOT_MEASURED)

const fmtPct = (v) => (isNum(v) ? `${Number(v).toFixed(1)}%` : NOT_MEASURED)

const fmtMoney = (v, currency) => (isNum(v)
  ? `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${currency || ''}`.trim()
  : NOT_MEASURED)

const fmtDate = (v) => {
  if (!v) return NOT_MEASURED
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString()
}

const TONE_TEXT = {
  danger: 'text-red-300',
  warning: 'text-amber-300',
  good: 'text-emerald-300',
  info: 'text-sky-300',
  quiet: 'text-[var(--text-primary)]',
}

const raw = (row, key) => (row?.reliability && key in row.reliability ? row.reliability[key] : row?.[key])

function Field({ label, value, tone, note }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className={`text-sm mt-0.5 tabular-nums ${tone ? TONE_TEXT[tone] : 'text-[var(--text-primary)]'}`}>{value}</div>
      {note && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{note}</div>}
    </div>
  )
}

export default function AssetHistoryDrawer({ row, rows = [], currency = '', onClose }) {
  const years = useMemo(() => spendByYear(row), [row])
  const trend = useMemo(() => spendTrend(row), [row])

  const spendChart = useMemo(() => ({
    labels: years.map((y) => String(y.year)),
    datasets: [{
      label: `Spend ${currency}`.trim(),
      data: years.map((y) => y.spend),
      backgroundColor: years.map((_, i) => withAlpha(colorAt(i), 0.75)),
      borderColor: years.map((_, i) => colorAt(i)),
      borderWidth: 1,
    }],
  }), [years, currency])

  const spendOpts = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: 'var(--text-secondary)' }, grid: { display: false } },
      y: { ticks: { color: 'var(--text-secondary)' }, grid: { color: 'var(--panel-2)' } },
    },
  }), [])

  if (!row) return null

  const val = (k) => metricValue(row, k)
  const tone = (k) => {
    const band = metricBand(k, val(k), rows)
    return band === 'unknown' ? null : bandMeta(band).tone
  }
  const label = (k, fallback) => metricMeta(k)?.label || fallback

  const coverage = val('date_coverage_pct')
  const coverageNote = isNum(coverage) ? `From ${fmtPct(coverage)} dated job cards` : 'Date coverage not measured'

  const parkedHours = val('parked_hours')
  const parkedCards = val('parked_cards')
  const hasParked = (parkedCards ?? 0) > 0 || (parkedHours ?? 0) > 0

  const work = [
    { key: 'emergency', label: 'Emergency', value: val('emergency_cards') },
    { key: 'repair', label: 'Repair', value: val('repair_cards') },
    { key: 'preventive', label: 'Planned service', value: val('preventive_cards') },
  ]
  const workTotal = work.reduce((s, w) => s + (w.value ?? 0), 0)
  const anyWork = work.some((w) => w.value != null)

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={`${row.asset_no || 'Asset'} history`}
      subtitle="What the job card ledger records about this machine, beside what the disposal committee wrote down."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--text-secondary)]">
            {row.asset_type || 'Type not recorded'}{row.site ? ` at ${row.site}` : ''}
          </span>
          <Link
            to={`/assets/${encodeURIComponent(row.asset_no || '')}`}
            className="ml-auto text-sm text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Open asset <ExternalLink size={13} />
          </Link>
        </div>

        {/* Reliability */}
        <section>
          <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Reliability</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field
              label={label('breakdown_hours', 'Breakdown hours')}
              value={fmtNum(val('breakdown_hours'))}
              tone={tone('breakdown_hours')}
              note="Parked time excluded"
            />
            <Field
              label={label('failures', 'Failures')}
              value={fmtNum(val('failures'))}
              tone={tone('failures')}
              note={isNum(raw(row, 'dated_failures')) ? `${fmtNum(raw(row, 'dated_failures'))} carry a date` : null}
            />
            <Field
              label={label('mtbf_days', 'Mean days between failures')}
              value={isNum(val('mtbf_days')) ? `${fmtNum(val('mtbf_days'), 1)} days` : NOT_MEASURED}
              tone={tone('mtbf_days')}
              note={coverageNote}
            />
            <Field
              label={label('failures_per_year', 'Failures per year')}
              value={fmtNum(val('failures_per_year'), 1)}
              tone={tone('failures_per_year')}
              note={coverageNote}
            />
            <Field
              label={label('availability_pct', 'Availability')}
              value={fmtPct(val('availability_pct'))}
              tone={tone('availability_pct')}
              note={coverageNote}
            />
            <Field
              label={label('idle_days', 'Days since last job card')}
              value={fmtNum(val('idle_days'))}
              tone={tone('idle_days')}
              note={coverageNote}
            />
            <Field
              label={label('preventive_share_pct', 'Planned work share')}
              value={fmtPct(val('preventive_share_pct'))}
              tone={tone('preventive_share_pct')}
            />
            <Field
              label="Longest single card"
              value={isNum(raw(row, 'longest_card_hours')) ? `${fmtNum(raw(row, 'longest_card_hours'))} hours` : NOT_MEASURED}
            />
            <Field
              label={label('job_cards', 'Job cards')}
              value={fmtNum(val('job_cards'))}
              note={isNum(val('dated_cards')) ? `${fmtNum(val('dated_cards'))} carry a usable date` : null}
            />
            <Field label="First job card" value={fmtDate(raw(row, 'first_seen'))} />
            <Field label="Last job card" value={fmtDate(raw(row, 'last_seen'))} />
            <Field label="Observed days" value={fmtNum(val('observed_days'))} />
          </div>
        </section>

        {/* Parked - stated on its own, never merged into breakdown hours */}
        {hasParked && (
          <section className="rounded-lg border border-amber-800/50 bg-amber-500/5 px-3 py-2">
            <div className="flex items-start gap-2">
              <ParkingCircle size={15} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-amber-300">
                  {fmtNum(parkedCards)} job cards on this machine cover {fmtNum(parkedHours)} hours of standing time.
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  A card that runs for months records a machine parked, not a mechanic working on it. Those hours are
                  kept out of the breakdown figure above and are shown here on their own.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Cost */}
        <section>
          <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Cost</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Maintenance spend" value={fmtMoney(val('spend'), currency)} tone={tone('spend')} />
            <Field
              label={label('cost_per_breakdown_hour', 'Cost per breakdown hour')}
              value={fmtMoney(val('cost_per_breakdown_hour'), currency)}
              tone={tone('cost_per_breakdown_hour')}
            />
            <Field
              label={label('cost_per_failure', 'Cost per failure')}
              value={fmtMoney(val('cost_per_failure'), currency)}
              tone={tone('cost_per_failure')}
            />
            <Field
              label="Estimated value"
              value={row.estimated_value == null ? 'Not valued' : fmtMoney(row.estimated_value, currency)}
            />
          </div>
          <div className="h-56 mt-3">
            {years.length > 0 ? (
              <Bar data={spendChart} options={spendOpts} />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No spend is recorded against this machine by year, so there is nothing to chart. That is a gap in the
                ledger, not a machine that cost nothing.
              </p>
            )}
          </div>
          {trend && (
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {trend.latestYear} cost {fmtMoney(trend.latestSpend, currency)} against {fmtMoney(trend.priorSpend, currency)}
              {' '}in {trend.priorYear}
              {trend.changePct != null ? `, a change of ${trend.changePct.toFixed(1)}%` : ''}.
              The year in progress is left out of that comparison, because part of a year against a whole one would show
              a fall on every machine.
            </p>
          )}
        </section>

        {/* Work type split */}
        <section>
          <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">What the work was</h4>
          {!anyWork ? (
            <p className="text-sm text-[var(--text-muted)]">The job cards on this machine do not record a work type.</p>
          ) : (
            <div className="space-y-2">
              {work.map((w, i) => {
                const share = w.value != null && workTotal > 0 ? (w.value / workTotal) * 100 : null
                return (
                  <div key={w.key} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-sm text-[var(--text-secondary)]">{w.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      {share != null && (
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(100, share)}%`, background: colorAt(i) }}
                        />
                      )}
                    </div>
                    <span className="w-36 shrink-0 text-right text-sm tabular-nums text-[var(--text-secondary)]">
                      {w.value == null ? NOT_MEASURED : `${fmtNum(w.value)}${share != null ? ` (${share.toFixed(0)}%)` : ''}`}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* The committee's own record */}
        <section>
          <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Disposal record</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Disposition" value={row.disposition || 'Not recorded'} />
            <Field label="Condition" value={row.condition || 'Not recorded'} />
            <Field label="Region" value={row.region || 'Not recorded'} />
            <Field label="Site" value={row.site || 'Not recorded'} />
            <Field label="Brand" value={row.brand || 'Not recorded'} />
            <Field label="Model year" value={row.model_year ?? 'Not recorded'} />
            <Field label="Fleet register" value={row.fleet_status || 'Not in the register'} />
            <Field
              label="Sale proceeds"
              value={row.sale_proceeds == null ? 'Not recorded' : fmtMoney(row.sale_proceeds, currency)}
            />
          </div>
          {row.remarks && (
            <p className="mt-3 text-sm text-[var(--text-secondary)] whitespace-pre-line border-l-2 border-[var(--input-border)] pl-3">
              {row.remarks}
            </p>
          )}
        </section>

        <p className="text-xs text-[var(--text-muted)] flex items-start gap-2">
          <Info size={13} className="mt-0.5 shrink-0" />
          {isNum(coverage)
            ? `MTBF, failures a year, idle days and availability for this machine rest on the ${fmtPct(coverage)} of its job cards that carry a usable date. Colour compares this machine with the others in the current selection.`
            : 'The share of job cards on this machine carrying a usable date is not measured, so the time based figures carry no stated basis.'}
        </p>
      </div>
    </Modal>
  )
}
