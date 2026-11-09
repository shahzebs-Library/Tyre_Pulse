/**
 * ExpenseCostStatusPanel - how much of the expense total is ACTUAL, ESTIMATED,
 * CONFIRMED ZERO, MISSING or DISPUTED (migration 20261110090000, rule T17 for expense
 * lines). Shown BESIDE the existing totals: it never changes them.
 *
 * One card per country in that country's currency (never blended). A status row opens
 * the lines behind it (first 200). Used on the Expense Report and, compact, on Data
 * Reconciliation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCcw, FileSpreadsheet, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import Card, { CardHeader } from '../ui/Card'
import { getExpenseCostStatusSummary, listExpenseCostStatusLines } from '../../lib/api/expenseCostStatus'
import {
  COST_STATUS_ORDER, COST_STATUS_LABEL, COST_STATUS_HINT, DISPUTE_REASON_LABEL, expenseStatusExportRows,
} from '../../lib/expenseCostStatus'
import { exportToExcel, reportFileName, reportDateLabel } from '../../lib/exportUtils'
import { toUserMessage } from '../../lib/safeError'

const fmtInt = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : Math.round(Number(v)).toLocaleString('en-US'))
const fmtMoney = (cur, v) => (v == null || !Number.isFinite(Number(v))
  ? 'N/A'
  : `${cur || ''} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim())
const fmtPct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)

const TONE = {
  ACTUAL: 'var(--text-secondary)',
  ESTIMATED: '#b45309',
  CONFIRMED_ZERO: 'var(--text-secondary)',
  MISSING: '#b45309',
  DISPUTED: '#b91c1c',
}

function LinesDrawer({ country, from, to, status, currency }) {
  const [state, setState] = useState({ loading: true, rows: [], error: '' })
  useEffect(() => {
    let alive = true
    setState({ loading: true, rows: [], error: '' })
    listExpenseCostStatusLines({ country, from, to, status, limit: 200 })
      .then((rows) => { if (alive) setState({ loading: false, rows, error: '' }) })
      .catch((e) => { if (alive) setState({ loading: false, rows: [], error: toUserMessage(e, 'Could not load the lines.') }) })
    return () => { alive = false }
  }, [country, from, to, status])
  if (state.loading) return <div className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>Loading lines...</div>
  if (state.error) return <div className="text-xs p-2 text-red-600">{state.error}</div>
  if (!state.rows.length) return <div className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>No lines with this status in the period.</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th className="text-left p-1">Date</th><th className="text-left p-1">Issue</th><th className="text-left p-1">Job card</th>
            <th className="text-left p-1">Asset</th><th className="text-left p-1">Item</th><th className="text-right p-1">Qty</th>
            <th className="text-right p-1">ERP amount</th><th className="text-right p-1">Estimate</th><th className="text-right p-1">Counted</th>
            <th className="text-left p-1">Why</th><th className="text-left p-1">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r) => (
            <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
              <td className="p-1">{r.event_date || 'N/A'}</td>
              <td className="p-1">{r.issue_number || 'N/A'}</td>
              <td className="p-1">{r.work_order_no || 'N/A'}</td>
              <td className="p-1">{r.asset_code || 'N/A'}</td>
              <td className="p-1">{r.item_description || r.item_code || 'N/A'}</td>
              <td className="p-1 text-right">{fmtInt(r.qty)}</td>
              <td className="p-1 text-right">{fmtMoney(currency, r.erp_amount)}</td>
              <td className="p-1 text-right">{fmtMoney(currency, r.filled_cost)}</td>
              <td className="p-1 text-right">{fmtMoney(currency, r.line_cost)}</td>
              <td className="p-1">{r.dispute_reason ? DISPUTE_REASON_LABEL[r.dispute_reason] : r.is_credit ? 'Credit' : ''}</td>
              <td className="p-1">{r.loaded_at ? String(r.loaded_at).slice(0, 16).replace('T', ' ') : 'N/A'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.rows.length >= 200 && (
        <div className="text-xs p-1" style={{ color: 'var(--text-muted)' }}>Showing the first 200 lines.</div>
      )}
    </div>
  )
}

function CountryCard({ c, from, to, compact }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="card p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-semibold">{c.country} ({c.currency || 'N/A'})</h4>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Total {fmtMoney(c.currency, c.total)} over {fmtInt(c.lines)} lines. Actual share {fmtPct(c.solidShare)}.
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs" style={{ color: 'var(--text-muted)' }}>
            <th className="text-left p-1">Status</th>
            <th className="text-right p-1">Lines</th>
            <th className="text-right p-1">Amount</th>
            {!compact && <th className="text-right p-1">Of which tyres</th>}
          </tr>
        </thead>
        <tbody>
          {COST_STATUS_ORDER.map((s) => {
            const v = c.statuses[s]
            const clickable = v.lines > 0
            return [
              <tr key={s} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="p-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left disabled:cursor-default"
                    disabled={!clickable}
                    onClick={() => setOpen(open === s ? null : s)}
                    title={COST_STATUS_HINT[s]}
                    aria-expanded={open === s}
                  >
                    {clickable ? (open === s ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{ width: 14 }} />}
                    <span style={{ color: v.lines > 0 ? TONE[s] : 'var(--text-muted)', fontWeight: s === 'ACTUAL' ? 400 : 600 }}>
                      {COST_STATUS_LABEL[s]}
                    </span>
                  </button>
                </td>
                <td className="p-1 text-right">{fmtInt(v.lines)}</td>
                <td className="p-1 text-right">{fmtMoney(c.currency, v.amount)}</td>
                {!compact && <td className="p-1 text-right">{fmtMoney(c.currency, v.tyreAmount)}</td>}
              </tr>,
              open === s && (
                <tr key={`${s}-lines`}>
                  <td colSpan={compact ? 3 : 4} className="p-1">
                    <LinesDrawer country={c.country} from={from} to={to} status={s} currency={c.currency} />
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
      {c.statuses.DISPUTED.lines > 0 && (
        <div className="text-xs flex items-start gap-1" style={{ color: '#b91c1c' }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {fmtMoney(c.currency, c.copy.amount)} over {fmtInt(c.copy.lines)} lines arrived again in a later upload
            (the line number changed, so the import key did not catch it), and {fmtMoney(c.currency, c.revision.amount)} over
            {' '}{fmtInt(c.revision.lines)} lines were uploaded again with a different value. These are still inside the total
            above. Nothing is removed automatically: a person decides from the lines list.
          </span>
        </div>
      )}
      {!compact && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Credits (refunds and returns) {fmtMoney(c.currency, c.credit.amount)} over {fmtInt(c.credit.lines)} lines.
          Repair lines {fmtMoney(c.currency, c.repair.amount)} ({fmtInt(c.repair.lines)}), retread lines
          {' '}{fmtMoney(c.currency, c.retread.amount)} ({fmtInt(c.retread.lines)}).
          Lines with more than one unit: {fmtInt(c.multiQtyLines)}.
        </div>
      )}
    </div>
  )
}

/**
 * @param {{ country?:string|null, countries?:string[], from?:string, to?:string, compact?:boolean, autoLoad?:boolean, title?:string }} props
 * `country` = one country or null/'All' for every country the user may see; `countries`
 * optionally narrows the cards shown (a multi-country reporting scope).
 */
export default function ExpenseCostStatusPanel({ country = null, countries = null, from = null, to = null, compact = false, autoLoad = true, title = 'Cost status of the expense lines' }) {
  const [state, setState] = useState({ loading: autoLoad, data: null, error: '' })
  const [started, setStarted] = useState(autoLoad)
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const data = await getExpenseCostStatusSummary({ country, from, to })
      setState({ loading: false, data, error: '' })
    } catch (e) {
      setState({ loading: false, data: null, error: toUserMessage(e, 'Could not load the cost status.') })
    }
  }, [country, from, to])
  useEffect(() => { if (started) load() }, [load, started])

  const shown = useMemo(() => {
    const all = state.data?.countries || []
    if (!Array.isArray(countries) || countries.length === 0) return all
    const want = new Set(countries)
    return all.filter((c) => want.has(c.country))
  }, [state.data, countries])

  const exportExcel = () => {
    const rows = expenseStatusExportRows({ countries: shown })
    exportToExcel(
      rows,
      ['country', 'currency', 'status', 'lines', 'amount', 'tyre_lines', 'tyre_amount'],
      ['Country', 'Currency', 'Status', 'Lines', 'Amount', 'Tyre lines', 'Tyre amount'],
      reportFileName('Expense cost status', reportDateLabel()),
    )
  }

  return (
    <Card>
      <CardHeader
        title={title}
        level={3}
        description="Each line counted once in its own currency: actual from the ERP, estimated from the item-code median, confirmed zero (warranty), missing, or disputed (needs a person). The totals above are unchanged."
        actions={(
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => (started ? load() : setStarted(true))} disabled={state.loading}>
              <RefreshCcw size={14} /> {started ? 'Refresh' : 'Run check'}
            </button>
            {!compact && (
              <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={exportExcel} disabled={!shown.length}>
                <FileSpreadsheet size={14} /> Excel
              </button>
            )}
          </div>
        )}
      />
      <div className="space-y-3">
        {state.loading && <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Checking every expense line...</div>}
        {!state.loading && state.error && (
          <div className="text-sm text-red-600 flex items-center gap-2">
            {state.error}
            <button type="button" className="underline" onClick={load}>Retry</button>
          </div>
        )}
        {!state.loading && !state.error && state.data?.notProvisioned && (
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>The cost status check is not installed on this database yet.</div>
        )}
        {!started && (
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Press Run check to classify every expense line in the period. Over all dates this can take up to 15 seconds.</div>
        )}
        {started && !state.loading && !state.error && !state.data?.notProvisioned && shown.length === 0 && (
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No expense lines in this period.</div>
        )}
        <div className={compact ? 'grid gap-3 md:grid-cols-3' : 'space-y-3'}>
          {shown.map((c) => <CountryCard key={c.country} c={c} from={from} to={to} compact={compact} />)}
        </div>
      </div>
    </Card>
  )
}
