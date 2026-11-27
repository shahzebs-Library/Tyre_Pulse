/**
 * The Expenses and CPK panels: the comparison strip, cost per kilometre, what
 * moved, and how much of the split is actually known.
 *
 * Presentation only. Every number here comes from src/lib/costCpk.js, which is
 * where the rules live - most importantly that a figure the data cannot support
 * is shown as N/A or withheld with a reason, never rendered as a confident zero.
 */
import { useMemo } from 'react'
import {
  TrendingUp, TrendingDown, Minus, Gauge, ArrowRight, ShieldCheck, AlertTriangle, Info,
} from 'lucide-react'
import { CPK_METRIC, metricDef } from '../../lib/cpkMetrics'
import {
  comparisonRows, cpkView, movers, evidenceBreakdown, PERIODS,
} from '../../lib/costCpk'
import { periodName } from '../../lib/defaultPeriod'
import { useLanguage } from '../../contexts/LanguageContext'

const EVIDENCE_KEYS = new Set([
  'reviewed-master', 'code-range', 'description-tyre', 'brand-and-size',
  'description-lubricant', 'accessory', 'job-card', 'default', 'unknown',
])

/**
 * Name the window rather than calling it "this period".
 *
 * A column headed "This period" tells a reader nothing they can check, and a
 * report forwarded a week later is then unreadable - nobody can tell which
 * months it covers. Every column now carries its own name: "2026 to date",
 * "August 2026", "2025".
 */
function windowName(w, fallback) {
  if (!w?.from && !w?.to) return fallback
  return periodName(w.from, w.to) || fallback
}

const pctText = (v) => (v == null ? 'N/A' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`)

/** Green for down, red for up: on a COST page, falling is the good direction. */
function DeltaPill({ ch, invert = false }) {
  const { t } = useLanguage()
  if (!ch || ch.direction === 'unknown') {
    return <span className="text-[11px] text-[var(--text-dim)]">{t('expense.common.na')}</span>
  }
  if (ch.direction === 'new') {
    return <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">{t('expense.cpk.new')}</span>
  }
  if (ch.direction === 'stopped') {
    return <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">{t('expense.cpk.stopped')}</span>
  }
  if (ch.direction === 'flat') {
    return (
      <span className="text-[11px] text-[var(--text-dim)] inline-flex items-center gap-1">
        <Minus size={11} /> {t('expense.cpk.noChange')}
      </span>
    )
  }
  const rising = ch.direction === 'up'
  const good = invert ? rising : !rising
  const Icon = rising ? TrendingUp : TrendingDown
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${
      good ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
      <Icon size={11} /> {pctText(ch.pct)}
    </span>
  )
}

/** Period picker. The window it produces is computed in costCpk.periodWindow. */
export function PeriodBar({ value, onChange, windows }) {
  const { t } = useLanguage()
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 flex-wrap">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => onChange(p.key)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
              value === p.key
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t(`expense.period.${p.key}`)}
          </button>
        ))}
      </div>
      {windows?.current ? (
        <span className="text-[11px] text-[var(--text-dim)]">
          {windowName(windows.current, t('expense.cpk.selectedPeriod'))}
          {windows.previous ? ` , ${t('expense.cpk.comparedWith', { name: windowName(windows.previous, t('expense.cpk.thePeriodBefore')) })}` : ''}
        </span>
      ) : null}
    </div>
  )
}

/**
 * This period against the previous one and against the same period a year ago.
 * When the range is twelve months those two are the same dates, so the duplicate
 * column is dropped rather than drawn twice.
 */
export function ComparisonStrip({ snap, money }) {
  const { t } = useLanguage()
  const { rows, previousIsLastYear, blended } = useMemo(() => comparisonRows(snap), [snap])
  // Real names, so the table still reads correctly once it has been exported or
  // forwarded and the picker is no longer on screen.
  const curName = windowName(snap?.windows?.current, t('expense.cpk.selectedPeriod'))
  const prevName = windowName(snap?.windows?.previous, t('expense.cpk.periodBefore'))
  const lastYearName = windowName(snap?.windows?.last_year, t('expense.cpk.sameLastYear'))
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
        <ArrowRight size={15} /> {t('expense.cpk.against', { cur: curName, prev: prevName })}
      </h2>
      {blended ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            {t('expense.cpk.pickCountry')}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                <th className="py-2 pr-3 font-semibold">{t('expense.cpk.spend')}</th>
                <th className="py-2 px-3 font-semibold text-right">{curName}</th>
                <th className="py-2 px-3 font-semibold text-right">{prevName}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('expense.cpk.change')}</th>
                {previousIsLastYear ? null : (
                  <>
                    <th className="py-2 px-3 font-semibold text-right">{lastYearName}</th>
                    <th className="py-2 pl-3 font-semibold text-right">{t('expense.cpk.change')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`border-b border-[var(--hairline)]/60 ${
                  r.key === 'total' ? 'font-semibold' : ''}`}>
                  <td className="py-2 pr-3 text-[var(--text-primary)]">{t(`expense.cpk.bucket.${r.key}`)}</td>
                  <td className="py-2 px-3 text-right text-[var(--text-primary)]">{money(r.current)}</td>
                  <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{money(r.previous)}</td>
                  <td className="py-2 px-3 text-right"><DeltaPill ch={r.vsPrevious} /></td>
                  {previousIsLastYear ? null : (
                    <>
                      <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{money(r.lastYear)}</td>
                      <td className="py-2 pl-3 text-right"><DeltaPill ch={r.vsLastYear} /></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {previousIsLastYear ? (
            <p className="text-[11px] text-[var(--text-dim)] mt-2">
              {t('expense.cpk.shownOnce', { prev: prevName })}
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

/**
 * Operating cost per VEHICLE km (parts and materials), with the coverage that
 * makes it readable. Named from the one glossary (src/lib/cpkMetrics.js): this
 * is tyres + spares + oil over the km the vehicles drove. It is not the Tyre CPK
 * (price of a tyre over that tyre's own km), which lives on CPK Intelligence.
 *
 * The distance comes from the odometer readings recorded against tyre fitments
 * and removals, because odometer_logs is empty. That is a real but sparse
 * series, so the panel always states how much of the period's spend the measured
 * assets actually cover, and refuses to draw a comparison against a window that
 * is too thin to support one.
 */
export function CpkPanel({ snap, money }) {
  const { t } = useLanguage()
  const v = useMemo(() => cpkView(snap), [snap])
  const cur = v.currency || ''
  const fmtCpk = (n) => (n == null ? t('expense.common.na') : t('expense.cpk.perVehicleKm', { value: n.toFixed(3), cur }))
  const M = metricDef(CPK_METRIC.OPERATING_COST_PER_VEHICLE_KM)
  const fmtPct = (n) => (n == null ? t('expense.common.na') : `${(n * 100).toFixed(1)}%`)
  const withheld = v.withheldReason
    ? t(v.current.comparable ? 'expense.cpk.withheldEarlier' : 'expense.cpk.withheldCurrent')
    : null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
        <Gauge size={15} /> {M.name}
      </h2>
      <p className="text-xs text-[var(--text-muted)]">{M.definition}</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">{t('expense.cpk.thisPeriod')}</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{fmtCpk(v.current.cpk)}</p>
          <p className="text-[11px] text-[var(--text-dim)] mt-1">
            {t('expense.cpk.assetsMeasured', { n: v.current.assetsMeasured, km: (v.current.km || 0).toLocaleString('en-US') })}
          </p>
          <p className="text-[11px] text-[var(--text-dim)] mt-1">
            {t('expense.cpk.split', { tyre: fmtCpk(v.current.cpkTyre), maint: fmtCpk(v.current.cpkMaintenance) })}
          </p>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">{t('expense.cpk.previousPeriod')}</p>
          <p className="text-2xl font-bold text-[var(--text-secondary)] leading-tight">{fmtCpk(v.previous.cpk)}</p>
          <div className="mt-1">
            {v.vsPrevious
              ? <DeltaPill ch={v.vsPrevious} />
              : <span className="text-[11px] text-[var(--text-dim)]">{t('expense.cpk.notComparable')}</span>}
          </div>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">{t('expense.cpk.sameLastYear')}</p>
          <p className="text-2xl font-bold text-[var(--text-secondary)] leading-tight">{fmtCpk(v.lastYear.cpk)}</p>
          <div className="mt-1">
            {v.vsLastYear
              ? <DeltaPill ch={v.vsLastYear} />
              : <span className="text-[11px] text-[var(--text-dim)]">{t('expense.cpk.notComparable')}</span>}
          </div>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">{t('expense.cpk.odometerCoverage')}</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{fmtPct(v.current.coverage)}</p>
          <p className="text-[11px] text-[var(--text-dim)] mt-1">
            {t('expense.cpk.coverageOf', { spend: money(v.current.spendTotal) })}
          </p>
        </div>
      </div>

      {v.withheldReason ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            {withheld} {t('expense.cpk.withheldRule', { pct: Math.round((v.minCoverage || 0.25) * 100) })}
          </p>
        </div>
      ) : null}

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300">
          {t('expense.cpk.distanceNote')}
        </p>
      </div>
    </section>
  )
}

/** What actually moved, biggest swing first. This is the "why" for the change above. */
export function MoversPanel({ snap, money, dim, onDim }) {
  const { t } = useLanguage()
  const rows = useMemo(() => movers(snap, dim, 12), [snap, dim])
  const DIMS = ['by_asset', 'by_site', 'by_item', 'by_cost_center', 'by_asset_type']
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
          <TrendingUp size={15} /> {t('expense.cpk.whatMoved')}
        </h2>
        <div className="flex items-center gap-1 flex-wrap">
          {DIMS.map((k) => (
            <button key={k} onClick={() => onDim(k)}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-medium ${
                dim === k ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
              {t(`expense.cpk.dim.${k}`)}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="card text-center py-6">
          <p className="text-sm text-[var(--text-muted)]">{t('expense.cpk.nothingChanged')}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                <th className="py-2 pr-3 font-semibold">{t('expense.cpk.name')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('expense.cpk.previous')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('expense.cpk.thisPeriod')}</th>
                <th className="py-2 px-3 font-semibold text-right">{t('expense.cpk.difference')}</th>
                <th className="py-2 pl-3 font-semibold text-right">{t('expense.cpk.change')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-[var(--hairline)]/60">
                  <td className="py-2 pr-3 text-[var(--text-primary)]">{r.label}</td>
                  <td className="py-2 px-3 text-right text-[var(--text-secondary)]">{money(r.previous)}</td>
                  <td className="py-2 px-3 text-right text-[var(--text-primary)]">{money(r.current)}</td>
                  <td className={`py-2 px-3 text-right font-medium ${
                    r.delta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {r.delta > 0 ? '+' : ''}{money(r.delta)}
                  </td>
                  <td className="py-2 pl-3 text-right"><DeltaPill ch={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * How much of the split is actually known.
 *
 * Every expense line records what decided its bucket. A large share sitting on
 * the fallback means the tyre / spare / oil split is a guess for that money, and
 * the fix is to confirm those item codes in Material Master. Publishing this
 * beside the figures is what stops them being read as more certain than they are.
 */
export function EvidencePanel({ snap, money }) {
  const { t } = useLanguage()
  const evLabel = (r) => (EVIDENCE_KEYS.has(r.key) ? t(`expense.cpk.evidence.${r.key}`) : r.label)
  const e = useMemo(() => evidenceBreakdown(snap), [snap])
  if (!e.rows.length) return null
  const weakPct = e.weakShare == null ? null : Math.round(e.weakShare * 100)
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
        <ShieldCheck size={15} /> {t('expense.cpk.howCertain')}
      </h2>
      <div className="card space-y-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-[var(--surface-raised)]">
          {e.rows.map((r) => (
            <div key={r.key}
              title={`${evLabel(r)}: ${money(r.spend)}`}
              style={{ width: `${(r.share || 0) * 100}%` }}
              className={r.weak ? 'bg-amber-500/70' : 'bg-emerald-500/70'} />
          ))}
        </div>
        <table className="w-full text-sm">
          <tbody>
            {e.rows.map((r) => (
              <tr key={r.key} className="border-b border-[var(--hairline)]/60 last:border-0">
                <td className="py-1.5 pr-3">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
                    r.weak ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <span className="text-[var(--text-primary)]">{evLabel(r)}</span>
                </td>
                <td className="py-1.5 px-3 text-right text-[var(--text-secondary)]">{money(r.spend)}</td>
                <td className="py-1.5 pl-3 text-right text-[var(--text-muted)] w-16">
                  {r.share == null ? t('expense.common.na') : `${(r.share * 100).toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {weakPct != null && weakPct > 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            {t('expense.cpk.weakNote', { pct: weakPct })}
          </p>
        ) : null}
      </div>
    </section>
  )
}
