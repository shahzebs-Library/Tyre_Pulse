/**
 * SanyDelayPenalty (route /sany-delay-penalty) - the standalone KSA repair-delay
 * penalty ledger (V464).
 *
 * Rule: a vehicle sent to a SANY workshop whose repair exceeded 5 days is charged
 * 43 SAR per hour of total repair downtime; the company then DEDUCTS that from the
 * SANY invoice. This is a SEPARATE figure - it never feeds Cost per M3 (which uses
 * the SANY invoice gross). Workflow: pull job-card candidates (repairs over N days),
 * tick the ones sent to SANY, save them as penalty rows (hours x 43), then mark each
 * as deducted against a SANY invoice. All money is SAR (KSA), never blended.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Timer, Search, Plus, Trash2, FileSpreadsheet, FileText, RefreshCcw, Info, AlertCircle,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import {
  listDelayPenalties, getDelayCandidates, createDelayPenalties, createDelayPenalty,
  updateDelayPenalty, deleteDelayPenalty, penaltyFromCandidate, summarizeDelayPenalties,
  DEFAULT_RATE_PER_HOUR, DEFAULT_MIN_DAYS,
} from '../lib/api/sanyDelayPenalty'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const STATUSES = ['draft', 'deducted', 'waived']
const fmtSar = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 'N/A' : `SAR ${Math.round(Number(v)).toLocaleString()}`)
const fmtHrs = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} h`)
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '-')
const monthStart = (ym) => (ym ? `${ym}-01` : null)
const monthEnd = (ym) => {
  if (!ym) return null
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export default function SanyDelayPenalty() {
  const { activeCountry } = useSettings()
  const [country, setCountry] = useState(activeCountry && activeCountry !== 'All' ? activeCountry : 'KSA')
  const [fromM, setFromM] = useState('')
  const [toM, setToM] = useState('')
  const [minDays, setMinDays] = useState(DEFAULT_MIN_DAYS)

  const [ledger, setLedger] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [candidates, setCandidates] = useState(null) // null = not searched yet
  const [candLoading, setCandLoading] = useState(false)
  const [selected, setSelected] = useState({}) // work_order_no|asset -> candidate

  const loadLedger = useCallback(() => {
    let cancelled = false
    setLoading(true); setError('')
    listDelayPenalties({ country, from: monthStart(fromM), to: monthEnd(toM) })
      .then((rows) => { if (!cancelled) setLedger(rows) })
      .catch((e) => { if (!cancelled) setError(toUserMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [country, fromM, toM])

  useEffect(() => loadLedger(), [loadLedger])

  const summary = useMemo(() => summarizeDelayPenalties(ledger), [ledger])

  async function findCandidates() {
    setCandLoading(true); setError(''); setNotice(''); setSelected({})
    try {
      const res = await getDelayCandidates({ country, from: monthStart(fromM), to: monthEnd(toM), minDays })
      setCandidates(res.ok ? res.candidates : [])
      if (!res.ok) setError('Could not load job-card candidates (the repair-downtime source may be empty for this window).')
    } catch (e) {
      setError(toUserMessage(e)); setCandidates([])
    } finally {
      setCandLoading(false)
    }
  }

  const candKey = (c) => `${c.work_order_no || ''}|${c.asset_no || ''}|${c.production_out_at || ''}`

  function toggle(c) {
    const k = candKey(c)
    setSelected((prev) => {
      const next = { ...prev }
      if (next[k]) delete next[k]; else next[k] = c
      return next
    })
  }
  function toggleAll() {
    if (!candidates?.length) return
    const allSel = candidates.every((c) => selected[candKey(c)])
    setSelected(allSel ? {} : Object.fromEntries(candidates.map((c) => [candKey(c), c])))
  }

  async function addSelected() {
    const rows = Object.values(selected).map((c) => penaltyFromCandidate(c, { rate: DEFAULT_RATE_PER_HOUR, country }))
    if (!rows.length) return
    setNotice(''); setError('')
    const res = await createDelayPenalties(rows)
    if (res.error) setError(res.error)
    else setNotice(`Added ${res.inserted} penalty row(s)${res.failed ? `, ${res.failed} failed` : ''}.`)
    setSelected({}); setCandidates(null); loadLedger()
  }

  async function setStatus(id, status) {
    const res = await updateDelayPenalty(id, { status })
    if (res.error) setError(res.error); else loadLedger()
  }
  async function setInvoice(id, sany_invoice_no) {
    const res = await updateDelayPenalty(id, { sany_invoice_no })
    if (res.error) setError(res.error)
  }
  async function remove(id) {
    const res = await deleteDelayPenalty(id)
    if (res.error) setError(res.error); else loadLedger()
  }

  // Manual add
  const [manual, setManual] = useState(null)
  async function saveManual() {
    if (!manual) return
    const hours = Number(manual.downtime_hours)
    const rate = Number(manual.rate_per_hour || DEFAULT_RATE_PER_HOUR)
    if (!Number.isFinite(hours) || hours <= 0) { setError('Downtime hours must be a number greater than 0.'); return }
    if (!Number.isFinite(rate) || rate <= 0) { setError('Rate per hour must be a number greater than 0.'); return }
    const res = await createDelayPenalty({ ...manual, country, currency: 'SAR', status: 'draft', source: 'manual', downtime_hours: hours, rate_per_hour: rate })
    if (res.ok) { setManual(null); loadLedger() } else setError(res.error)
  }

  function exportLedger(kind) {
    if (!ledger.length) return
    const rows = ledger.map((r) => ({
      asset_no: r.asset_no ?? '', site: r.site ?? '', work_order_no: r.work_order_no ?? '',
      period_date: fmtDate(r.period_date), downtime_hours: Number(r.downtime_hours) || 0,
      rate_per_hour: Number(r.rate_per_hour) || DEFAULT_RATE_PER_HOUR,
      penalty_amount: Math.round(Number(r.penalty_amount) || 0),
      status: r.status ?? '', sany_invoice_no: r.sany_invoice_no ?? '',
    }))
    const keys = ['asset_no', 'site', 'work_order_no', 'period_date', 'downtime_hours', 'rate_per_hour', 'penalty_amount', 'status', 'sany_invoice_no']
    const headers = ['Asset', 'Site', 'Job Card', 'Month', 'Downtime (h)', 'Rate/h (SAR)', 'Penalty (SAR)', 'Status', 'SANY Invoice']
    const fname = reportFileName('TyrePulse', 'SANY delay penalty', country)
    if (kind === 'excel') exportToExcel(rows, keys, headers, fname, 'SANY Delay Penalty')
    else exportToPdf(rows, keys.map((k, i) => ({ key: k, header: headers[i] })), `SANY Delay Penalty (${country})`, fname, 'landscape')
  }

  const selectedCount = Object.keys(selected).length
  const selectedTotal = Object.values(selected).reduce((s, c) => s + (Number(c.downtime_hours) || 0) * DEFAULT_RATE_PER_HOUR, 0)

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="SANY Delay Penalty (KSA)"
        subtitle="43 SAR per hour of repair downtime for vehicles at a SANY workshop over 5 days - deducted from the SANY invoice"
        actions={
          <button type="button" onClick={loadLedger} className="inline-flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm">
            <RefreshCcw size={14} /> Refresh
          </button>
        }
      />

      <p className="mb-4 flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <Info size={14} className="mt-0.5 shrink-0" />
        This penalty is a SEPARATE figure that you deduct from the SANY invoice. It is NOT added to Cost per M3 (that uses the SANY invoice gross). Rate is fixed at {DEFAULT_RATE_PER_HOUR} SAR/hour of total repair downtime.
      </p>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-lg border border-[var(--border-subtle)] p-0.5">
          {COUNTRIES.map((c) => (
            <button key={c} type="button" onClick={() => setCountry(c)}
              className={`px-3 py-1.5 text-sm rounded-md ${country === c ? 'bg-[var(--accent)] text-white' : ''}`}
              style={country === c ? undefined : { color: 'var(--text-secondary)' }}>{c}</button>
          ))}
        </div>
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>From
          <input type="month" value={fromM} onChange={(e) => setFromM(e.target.value)} className="ml-2 rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>To
          <input type="month" value={toM} onChange={(e) => setToM(e.target.value)} className="ml-2 rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
        </label>
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Over (days)
          <input type="number" min="1" value={minDays} onChange={(e) => setMinDays(Number(e.target.value) || DEFAULT_MIN_DAYS)} className="ml-2 w-16 rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
        </label>
      </div>

      {error && <div className="mb-3 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400"><AlertCircle size={14} /> {error}</div>}
      {notice && <div className="mb-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</div>}

      {/* KPI strip */}
      <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Penalty to deduct" value={fmtSar(summary.toDeduct)} hint="sum of draft + deducted rows (waived excluded)" />
        <Kpi label="Total downtime" value={fmtHrs(summary.hours)} />
        <Kpi label="Rows" value={summary.count} />
        <Kpi label="Already deducted" value={fmtSar(summary.byStatus.deducted)} />
      </div>

      {/* Candidates */}
      <section className="mb-6 rounded-xl border border-[var(--border-subtle)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Search size={18} /> Job-card candidates (repairs over {minDays} days)</h3>
          <button type="button" onClick={findCandidates} className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
            <Search size={14} /> {candLoading ? 'Searching...' : 'Find candidates'}
          </button>
        </div>
        <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Repairs whose downtime (Production Out to Production In) exceeded {minDays} days. Tick the ones sent to a SANY workshop, then add them - penalty = downtime hours x {DEFAULT_RATE_PER_HOUR} SAR.
        </p>

        {candidates == null ? (
          <div className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Press "Find candidates" to list repairs over {minDays} days.</div>
        ) : candidates.length === 0 ? (
          <div className="py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>No repairs over {minDays} days found for {country} in this window.</div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>{candidates.length} candidate(s){candidates.length >= 500 ? ' (showing first 500 - narrow the window)' : ''}</span>
              {selectedCount > 0 && (
                <button type="button" onClick={addSelected} className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-white">
                  <Plus size={14} /> Add {selectedCount} as penalty ({fmtSar(selectedTotal)})
                </button>
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                    <th className="p-2"><input type="checkbox" checked={candidates.length > 0 && candidates.every((c) => selected[candKey(c)])} onChange={toggleAll} /></th>
                    <th className="p-2">Asset</th><th className="p-2">Site</th><th className="p-2">Job Card</th>
                    <th className="p-2">Out</th><th className="p-2">In</th>
                    <th className="p-2 text-right">Downtime</th><th className="p-2 text-right">Penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.slice(0, 200).map((c) => {
                    const k = candKey(c)
                    return (
                      <tr key={k} className="border-t border-[var(--border-subtle)]">
                        <td className="p-2"><input type="checkbox" checked={!!selected[k]} onChange={() => toggle(c)} /></td>
                        <td className="p-2">{c.asset_no || '-'}</td>
                        <td className="p-2">{c.site || '-'}</td>
                        <td className="p-2">{c.work_order_no || '-'}</td>
                        <td className="p-2">{fmtDate(c.production_out_at)}</td>
                        <td className="p-2">{fmtDate(c.production_in_at)}</td>
                        <td className="p-2 text-right tabular-nums">{fmtHrs(c.downtime_hours)}</td>
                        <td className="p-2 text-right tabular-nums">{fmtSar((Number(c.downtime_hours) || 0) * DEFAULT_RATE_PER_HOUR)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {candidates.length > 200 && <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>Showing first 200 rows; use Select all to add every candidate, or narrow the window.</p>}
          </>
        )}
      </section>

      {/* Ledger */}
      <section className="rounded-xl border border-[var(--border-subtle)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold"><Timer size={18} /> Penalty ledger</h3>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setManual(manual ? null : { downtime_hours: '', rate_per_hour: DEFAULT_RATE_PER_HOUR })} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><Plus size={12} /> Manual add</button>
            <button type="button" onClick={() => exportLedger('excel')} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><FileSpreadsheet size={12} /> Excel</button>
            <button type="button" onClick={() => exportLedger('pdf')} className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs"><FileText size={12} /> PDF</button>
          </div>
        </div>

        {manual && (
          <div className="mb-3 grid grid-cols-2 md:grid-cols-6 gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
            <input placeholder="Asset" onChange={(e) => setManual({ ...manual, asset_no: e.target.value })} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
            <input placeholder="Site" onChange={(e) => setManual({ ...manual, site: e.target.value })} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
            <input placeholder="Job Card" onChange={(e) => setManual({ ...manual, work_order_no: e.target.value })} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
            <input type="month" onChange={(e) => setManual({ ...manual, period_date: monthStart(e.target.value) })} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
            <input type="number" placeholder="Downtime h" value={manual.downtime_hours} onChange={(e) => setManual({ ...manual, downtime_hours: e.target.value })} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-sm" />
            <button type="button" onClick={saveManual} className="rounded-md bg-[var(--accent)] px-3 py-1 text-sm text-white">Save ({fmtSar((Number(manual.downtime_hours) || 0) * (manual.rate_per_hour || DEFAULT_RATE_PER_HOUR))})</button>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>Loading...</div>
        ) : ledger.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>No penalty rows yet. Find job-card candidates above and add the ones sent to SANY.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                  <th className="p-2">Asset</th><th className="p-2">Site</th><th className="p-2">Job Card</th><th className="p-2">Month</th>
                  <th className="p-2 text-right">Downtime</th><th className="p-2 text-right">Penalty</th>
                  <th className="p-2">Status</th><th className="p-2">SANY Invoice</th><th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--border-subtle)]">
                    <td className="p-2">{r.asset_no || '-'}</td>
                    <td className="p-2">{r.site || '-'}</td>
                    <td className="p-2">{r.work_order_no || '-'}</td>
                    <td className="p-2">{fmtDate(r.period_date)}</td>
                    <td className="p-2 text-right tabular-nums">{fmtHrs(r.downtime_hours)}</td>
                    <td className="p-2 text-right tabular-nums font-semibold">{fmtSar(r.penalty_amount)}</td>
                    <td className="p-2">
                      <select value={r.status || 'draft'} onChange={(e) => setStatus(r.id, e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-transparent px-1.5 py-0.5 text-xs">
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <input defaultValue={r.sany_invoice_no || ''} placeholder="-" onBlur={(e) => setInvoice(r.id, e.target.value)} className="w-28 rounded-md border border-[var(--border-subtle)] bg-transparent px-1.5 py-0.5 text-xs" />
                    </td>
                    <td className="p-2"><button type="button" onClick={() => remove(r.id)} className="text-red-400"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Kpi({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] p-3" title={hint || undefined}>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
