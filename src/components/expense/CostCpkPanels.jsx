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
import {
  comparisonRows, cpkView, movers, evidenceBreakdown, PERIODS,
} from '../../lib/costCpk'
import { periodName } from '../../lib/defaultPeriod'

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
  if (!ch || ch.direction === 'unknown') {
    return <span className="text-[11px] text-[var(--text-dim)]">N/A</span>
  }
  if (ch.direction === 'new') {
    return <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">New</span>
  }
  if (ch.direction === 'stopped') {
    return <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400">Stopped</span>
  }
  if (ch.direction === 'flat') {
    return (
      <span className="text-[11px] text-[var(--text-dim)] inline-flex items-center gap-1">
        <Minus size={11} /> No change
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
            {p.label}
          </button>
        ))}
      </div>
      {windows?.current ? (
        <span className="text-[11px] text-[var(--text-dim)]">
          {windowName(windows.current, 'Selected period')}
          {windows.previous ? ` , compared with ${windowName(windows.previous, 'the period before')}` : ''}
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
  const { rows, previousIsLastYear, blended } = useMemo(() => comparisonRows(snap), [snap])
  // Real names, so the table still reads correctly once it has been exported or
  // forwarded and the picker is no longer on screen.
  const curName = windowName(snap?.windows?.current, 'Selected period')
  const prevName = windowName(snap?.windows?.previous, 'Period before')
  const lastYearName = windowName(snap?.windows?.last_year, 'Same period last year')
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
        <ArrowRight size={15} /> {curName} against {prevName}
      </h2>
      {blended ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            Pick a single country to see money here. Each country reports in its own currency,
            so a combined figure would add SAR, AED and EGP together and mean nothing.
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                <th className="py-2 pr-3 font-semibold">Spend</th>
                <th className="py-2 px-3 font-semibold text-right">{curName}</th>
                <th className="py-2 px-3 font-semibold text-right">{prevName}</th>
                <th className="py-2 px-3 font-semibold text-right">Change</th>
                {previousIsLastYear ? null : (
                  <>
                    <th className="py-2 px-3 font-semibold text-right">{lastYearName}</th>
                    <th className="py-2 pl-3 font-semibold text-right">Change</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`border-b border-[var(--hairline)]/60 ${
                  r.key === 'total' ? 'font-semibold' : ''}`}>
                  <td className="py-2 pr-3 text-[var(--text-primary)]">{r.label}</td>
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
              Over a twelve month range {prevName} and the same period last year are the same
              dates, so they are shown once. Choose a shorter period to compare both.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

/**
 * Cost per kilometre, with the coverage that makes it readable.
 *
 * The distance comes from the odometer readings recorded against tyre fitments
 * and removals, because odometer_logs is empty. That is a real but sparse
 * series, so the panel always states how much of the period's spend the measured
 * assets actually cover, and refuses to draw a comparison against a window that
 * is too thin to support one.
 */
export function CpkPanel({ snap, money }) {
  const v = useMemo(() => cpkView(snap), [snap])
  const cur = v.currency || ''
  const fmtCpk = (n) => (n == null ? 'N/A' : `${n.toFixed(3)} ${cur}/km`)
  const fmtPct = (n) => (n == null ? 'N/A' : `${(n * 100).toFixed(1)}%`)

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
        <Gauge size={15} /> Cost per kilometre
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">This period</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{fmtCpk(v.current.cpk)}</p>
          <p className="text-[11px] text-[var(--text-dim)] mt-1">
            {v.current.assetsMeasured} assets measured, {(v.current.km || 0).toLocaleString('en-US')} km
          </p>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">Previous period</p>
          <p className="text-2xl font-bold text-[var(--text-secondary)] leading-tight">{fmtCpk(v.previous.cpk)}</p>
          <div className="mt-1">
            {v.vsPrevious
              ? <DeltaPill ch={v.vsPrevious} />
              : <span className="text-[11px] text-[var(--text-dim)]">Not comparable</span>}
          </div>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">Same period last year</p>
          <p className="text-2xl font-bold text-[var(--text-secondary)] leading-tight">{fmtCpk(v.lastYear.cpk)}</p>
          <div className="mt-1">
            {v.vsLastYear
              ? <DeltaPill ch={v.vsLastYear} />
              : <span className="text-[11px] text-[var(--text-dim)]">Not comparable</span>}
          </div>
        </div>
        <div className="card">
          <p className="text-[11px] text-[var(--text-muted)]">Odometer coverage</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">{fmtPct(v.current.coverage)}</p>
          <p className="text-[11px] text-[var(--text-dim)] mt-1">
            of {money(v.current.spendTotal)} spend has measured distance
          </p>
        </div>
      </div>

      {v.withheldReason ? (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-300">
            {v.withheldReason} A cost per kilometre is only shown against a period where the
            measured assets cover at least {Math.round((v.minCoverage || 0.25) * 100)}% of the spend,
            so a change in coverage is never mistaken for a change in cost.
          </p>
        </div>
      ) : null}

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25">
        <Info size={13} className="text-sky-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-sky-300">
          Distance comes from the odometer recorded when a tyre is fitted and when it is removed,
          which is the only running-kilometre data the fleet currently captures. Logging daily
          meter readings raises the coverage above and makes this figure fleet-wide.
        </p>
      </div>
    </section>
  )
}

/** What actually moved, biggest swing first. This is the "why" for the change above. */
export function MoversPanel({ snap, money, dim, onDim }) {
  const rows = useMemo(() => movers(snap, dim, 12), [snap, dim])
  const DIMS = [
    ['by_asset', 'Asset'], ['by_site', 'Site'], ['by_item', 'Item'],
    ['by_cost_center', 'Cost centre'], ['by_asset_type', 'Asset type'],
  ]
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
          <TrendingUp size={15} /> What moved
        </h2>
        <div className="flex items-center gap-1 flex-wrap">
          {DIMS.map(([k, label]) => (
            <button key={k} onClick={() => onDim(k)}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-medium ${
                dim === k ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="card text-center py-6">
          <p className="text-sm text-[var(--text-muted)]">Nothing changed between the two periods.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 px-3 font-semibold text-right">Previous</th>
                <th className="py-2 px-3 font-semibold text-right">This period</th>
                <th className="py-2 px-3 font-semibold text-right">Difference</th>
                <th className="py-2 pl-3 font-semibold text-right">Change</th>
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
  const e = useMemo(() => evidenceBreakdown(snap), [snap])
  if (!e.rows.length) return null
  const weakPct = e.weakShare == null ? null : Math.round(e.weakShare * 100)
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
        <ShieldCheck size={15} /> How certain is this split
      </h2>
      <div className="card space-y-3">
        <div className="flex h-3 rounded-full overflow-hidden bg-[var(--surface-raised)]">
          {e.rows.map((r) => (
            <div key={r.key}
              title={`${r.label}: ${money(r.spend)}`}
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
                  <span className="text-[var(--text-primary)]">{r.label}</span>
                </td>
                <td className="py-1.5 px-3 text-right text-[var(--text-secondary)]">{money(r.spend)}</td>
                <td className="py-1.5 pl-3 text-right text-[var(--text-muted)] w-16">
                  {r.share == null ? 'N/A' : `${(r.share * 100).toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {weakPct != null && weakPct > 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">
            {weakPct}% of this spend was filed by the fallback rule, meaning nothing in the item
            code or description identified it. Confirming those items in Material Master moves
            them onto a decision rather than a guess.
          </p>
        ) : null}
      </div>
    </section>
  )
}
