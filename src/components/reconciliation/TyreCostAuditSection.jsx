import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Receipt, Play, Save, Check, X, Undo2, Download, RefreshCw, AlertTriangle, Info, Eye } from 'lucide-react'
import {
  runCostAudit, listCostFindings, listAllCostFindings, decideFindings, applyFindings, undoBatch,
  NOT_INSTALLED_MESSAGE, PAGE_SIZE,
} from '../../lib/api/tyreCostAudit'
import { AUDIT_CLASSES, COST_PENDING_LABEL } from '../../lib/tyreCostAudit'
import {
  scanKpis, savedKpis, breakdown, moneyText, costCell, reasonsOf, classLabel, classAction,
  canDecide, canApply, APPROVABLE_CLASSES, STATUSES, PRICE_SOURCE_NOTE,
  exportRows, EXPORT_KEYS, EXPORT_HEADERS,
} from '../../lib/tyreCostAuditView'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel, reportFileName } from '../../lib/exportUtils'
import { useAuth } from '../../contexts/AuthContext'
import EnterpriseTable from '../ui/EnterpriseTable'
import Modal from '../ui/Modal'
import SideDrawer from '../ui/SideDrawer'

const COUNTRIES = ['KSA', 'UAE', 'Egypt']
const today = () => new Date().toISOString().slice(0, 10)
const DEFAULTS = { country: '', from: '2025-01-01', to: today(), site: '', brand: '', size: '', itemCode: '', cls: '', status: '', search: '' }
const fmt = (v) => (v == null ? 'N/A' : Number(v).toLocaleString('en-US'))
const BTN = 'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-xs font-medium border border-[var(--border-dim)] bg-[var(--surface-2)] text-[var(--text-primary)] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'
const INPUT = 'min-h-[40px] px-2 rounded-lg text-sm bg-[var(--surface-2)] border border-[var(--border-dim)] text-[var(--text-primary)]'

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] p-3 min-w-0">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="text-base font-semibold text-[var(--text-primary)] tabular-nums break-words">{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-secondary)]">{sub}</div>}
    </div>
  )
}

/**
 * Tyre Cost Audit. Finds tyres with a missing, zero or estimated cost and
 * proposes a price ONLY from a real ERP store-issue line of the same item code
 * in the same month. A person approves; an Admin applies; every apply is one
 * undoable batch. Unknown cost always reads "Cost Pending Verification".
 */
export default function TyreCostAuditSection() {
  const { profile, isSuperAdmin } = useAuth() || {}
  const user = { role: profile?.role, isSuperAdmin }
  const mayDecide = canDecide(user)
  const mayApply = canApply(user)

  const [f, setF] = useState(DEFAULTS)
  const [installed, setInstalled] = useState(true)
  const [page, setPage] = useState(0)
  const [list, setList] = useState({ rows: [], total: 0 })
  const [totals, setTotals] = useState({ rows: [], truncated: false })
  const [scan, setScan] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [dim, setDim] = useState('month')
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [confirmApply, setConfirmApply] = useState(false)
  const [lastBatch, setLastBatch] = useState(null)
  const [detail, setDetail] = useState(null)

  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setPage(0) }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [l, t] = await Promise.all([
        listCostFindings({ ...f, page }),
        listAllCostFindings(f, { light: true }),
      ])
      if (l.installed === false || t.installed === false) { setInstalled(false); return }
      setInstalled(true)
      setList({ rows: l.rows, total: l.total })
      setTotals({ rows: t.rows, truncated: t.truncated })
      setSelected(new Set())
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [f, page])

  useEffect(() => { load() }, [load])

  const runScan = async (dryRun) => {
    setBusy(dryRun ? 'dry' : 'save')
    setNotice(null)
    try {
      const res = await runCostAudit({ country: f.country, from: f.from, to: f.to, dryRun })
      if (res.installed === false) { setInstalled(false); return }
      setScan(res.data)
      if (!dryRun) {
        setNotice({ tone: 'ok', text: `Findings saved. ${fmt(res.data?.new_findings ?? 0)} new.` })
        await load()
      }
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const selectedRows = useMemo(() => list.rows.filter((r) => selected.has(r.id)), [list.rows, selected])
  const approvable = selectedRows.filter((r) => r.status === 'proposed' && APPROVABLE_CLASSES.includes(r.class))
  const rejectable = selectedRows.filter((r) => r.status === 'proposed')
  const appliable = selectedRows.filter((r) => r.status === 'approved')

  const decide = async (decision, note) => {
    const rows = decision === 'approved' ? approvable : rejectable
    setBusy(decision)
    setNotice(null)
    try {
      const res = await decideFindings(rows.map((r) => r.id), decision, note)
      setNotice({ tone: 'ok', text: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${fmt(res.decided ?? 0)}${res.skipped ? `, skipped ${fmt(res.skipped)}` : ''}.` })
      setRejecting(false)
      setRejectNote('')
      await load()
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const apply = async () => {
    setBusy('apply')
    setNotice(null)
    try {
      const res = await applyFindings(appliable.map((r) => r.id))
      setLastBatch(res.batch || null)
      setConfirmApply(false)
      setNotice({ tone: 'ok', text: `Applied ${fmt(res.applied ?? 0)} corrections. Undo batch ${res.batch || 'N/A'}.` })
      await load()
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const undo = async () => {
    setBusy('undo')
    try {
      await undoBatch(lastBatch)
      setNotice({ tone: 'ok', text: `Batch ${lastBatch} undone.` })
      setLastBatch(null)
      await load()
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const doExport = async () => {
    setBusy('export')
    try {
      const { rows, truncated } = await listAllCostFindings(f)
      await exportToExcel(exportRows(rows), EXPORT_KEYS, EXPORT_HEADERS, reportFileName('Tyre cost audit findings'), 'Findings')
      if (truncated) setNotice({ tone: 'info', text: 'Export capped at 20,000 findings. Narrow the filters for the rest.' })
    } catch (e) {
      setNotice({ tone: 'bad', text: toUserMessage(e) })
    } finally {
      setBusy('')
    }
  }

  const k = useMemo(() => scanKpis(scan), [scan])
  const saved = useMemo(() => savedKpis(totals.rows), [totals.rows])
  const groups = useMemo(() => breakdown(totals.rows, dim), [totals.rows, dim])
  const sites = useMemo(() => [...new Set(totals.rows.map((r) => r.site).filter(Boolean))].sort(), [totals.rows])

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allOnPage = list.rows.length > 0 && list.rows.every((r) => selected.has(r.id))

  const columns = useMemo(() => [
    {
      id: 'sel', size: 44, enableSorting: false,
      header: () => <input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
        onChange={() => setSelected(allOnPage ? new Set() : new Set(list.rows.map((r) => r.id)))} />,
      cell: ({ row }) => <input type="checkbox" aria-label={`Select ${row.original.serial_no || row.original.id}`}
        checked={selected.has(row.original.id)} onChange={() => toggle(row.original.id)} />,
    },
    { id: 'tyre', header: 'Tyre', accessorFn: (r) => `${r.serial_no || 'No serial'} / ${r.asset_no || 'N/A'}`, size: 170 },
    { id: 'month', header: 'Month', accessorFn: (r) => r.month || 'N/A', size: 80 },
    { id: 'orig', header: 'Original', accessorFn: (r) => costCell(r.original_cost, r.currency), size: 150 },
    { id: 'prop', header: 'Proposed', accessorFn: (r) => (r.proposed_cost == null ? (r.class === 'priced_estimate_not_verified' ? COST_PENDING_LABEL : 'None') : costCell(r.proposed_cost, r.currency)), size: 150 },
    { id: 'src', header: 'Source line', accessorFn: (r) => [r.item_code, r.source_line_id ? `#${String(r.source_line_id).slice(0, 8)}` : ''].filter(Boolean).join(' ') || 'N/A', size: 150 },
    { id: 'conf', header: 'Confidence', accessorFn: (r) => r.confidence || 'N/A', size: 90 },
    { id: 'class', header: 'Finding', accessorFn: (r) => classLabel(r.class), size: 220 },
    { id: 'reasons', header: 'Reasons', accessorFn: (r) => reasonsOf(r).join('; ') || classAction(r.class), size: 220 },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status || 'N/A', size: 90 },
    {
      id: 'ev', header: '', size: 60, enableSorting: false,
      cell: ({ row }) => <button type="button" className={BTN} aria-label={`Evidence for ${row.original.serial_no || row.original.id}`} onClick={() => setDetail(row.original)}><Eye size={14} /></button>,
    },
  ], [allOnPage, list.rows, selected])

  if (!installed) {
    return (
      <section className="card p-5" aria-label="Tyre Cost Audit">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Receipt size={16} /> Tyre Cost Audit</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{NOT_INSTALLED_MESSAGE}. Nothing can be checked or corrected until it is.</p>
      </section>
    )
  }

  return (
    <section className="card p-0 overflow-hidden" aria-label="Tyre Cost Audit">
      <div className="px-5 py-4 border-b border-[var(--border-dim)] space-y-1">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Receipt size={16} /> Tyre Cost Audit</h2>
        <p className="text-xs text-[var(--text-secondary)]">Missing, zero and estimated tyre costs. A price is proposed only from a real line with the same item code in the same month. Warranty is never repriced.</p>
        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5"><Info size={13} className="mt-0.5 shrink-0" />{PRICE_SOURCE_NOTE}</p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">From
            <input type="date" className={INPUT} value={f.from} max={f.to || undefined} onChange={(e) => set('from', e.target.value)} aria-label="Audit from date" /></label>
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">To
            <input type="date" className={INPUT} value={f.to} min={f.from || undefined} onChange={(e) => set('to', e.target.value)} aria-label="Audit to date" /></label>
          <select className={INPUT} aria-label="Country" value={f.country} onChange={(e) => set('country', e.target.value)}>
            <option value="">All countries</option>{COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={INPUT} aria-label="Site" value={f.site} onChange={(e) => set('site', e.target.value)}>
            <option value="">All sites</option>{sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className={INPUT} aria-label="Brand" placeholder="Brand" value={f.brand} onChange={(e) => set('brand', e.target.value)} />
          <input className={INPUT} aria-label="Size" placeholder="Size" value={f.size} onChange={(e) => set('size', e.target.value)} />
          <input className={INPUT} aria-label="Tyre code" placeholder="Tyre code" value={f.itemCode} onChange={(e) => set('itemCode', e.target.value)} />
          <select className={INPUT} aria-label="Finding" value={f.cls} onChange={(e) => set('cls', e.target.value)}>
            <option value="">All findings</option>{Object.entries(AUDIT_CLASSES).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
          </select>
          <select className={INPUT} aria-label="Status" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">All statuses</option>{STATUSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <input className={INPUT} aria-label="Search serial, asset or job card" placeholder="Serial, asset, job card" value={f.search} onChange={(e) => set('search', e.target.value)} />
          <button type="button" className={BTN} onClick={() => { setF(DEFAULTS); setPage(0) }}>Clear</button>
        </div>

        <div className="flex flex-wrap gap-2">
          {mayDecide && <button type="button" className={BTN} disabled={!!busy} onClick={() => runScan(true)}><Play size={14} />{busy === 'dry' ? 'Running...' : 'Run dry-run audit'}</button>}
          {mayDecide && <button type="button" className={BTN} disabled={!!busy} onClick={() => runScan(false)}><Save size={14} />{busy === 'save' ? 'Saving...' : 'Save findings'}</button>}
          <button type="button" className={BTN} disabled={!!busy} onClick={load}><RefreshCw size={14} />Refresh</button>
          <button type="button" className={BTN} disabled={!!busy || !list.total} onClick={doExport}><Download size={14} />Excel</button>
          {lastBatch && mayApply && <button type="button" className={BTN} disabled={!!busy} onClick={undo}><Undo2 size={14} />Undo batch {String(lastBatch).slice(0, 8)}</button>}
        </div>

        {notice && (
          <div role={notice.tone === 'bad' ? 'alert' : 'status'} className={`text-sm rounded-lg border px-3 py-2 ${notice.tone === 'bad' ? 'border-red-700/60 text-red-300' : 'border-[var(--border-dim)] text-[var(--text-secondary)]'}`}>{notice.text}</div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Tyres checked" value={k ? fmt(k.checked) : 'N/A'} sub={k ? 'last audit run' : 'run an audit'} />
          <Tile label="Zero or missing cost (not warranty)" value={k ? fmt(k.missingNonWarranty) : 'N/A'} />
          <Tile label="Warranty excluded" value={k ? fmt(k.warrantyExcluded) : 'N/A'} />
          <Tile label="Exact verified matches" value={k ? fmt(k.exactMatches) : 'N/A'} />
          <Tile label="Unresolved" value={k ? fmt(k.unresolved) : 'N/A'} sub={COST_PENDING_LABEL} />
          <Tile label="Conflicts" value={k ? fmt(k.conflicts) : 'N/A'} />
          <Tile label="Proposed amount" value={moneyText(k ? k.proposedByCurrency : saved.proposedByCurrency)} sub={k ? 'last audit run' : 'saved, open'} />
          <Tile label="Approved amount" value={moneyText(saved.approvedByCurrency)} sub="saved, awaiting apply" />
        </div>

        {k && k.byCountry.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="text-left text-[var(--text-muted)] pb-1">{scan?.dry_run ? 'Dry run (nothing saved)' : 'Saved run'} by country</caption>
              <thead><tr className="text-[var(--text-muted)]"><th className="text-left p-1">Country</th><th className="text-right p-1">Checked</th><th className="text-right p-1">Recoverable</th><th className="text-right p-1">Estimates</th><th className="text-right p-1">Proposed</th></tr></thead>
              <tbody>{k.byCountry.map((c) => (
                <tr key={c.country} className="border-t border-[var(--border-dim)]">
                  <td className="p-1">{c.country}</td><td className="p-1 text-right">{fmt(c.checked)}</td>
                  <td className="p-1 text-right">{fmt((c.byClass.exact_match || 0) + (c.byClass.same_month_item_match || 0))}</td>
                  <td className="p-1 text-right">{fmt(c.byClass.priced_estimate_not_verified || 0)}</td>
                  <td className="p-1 text-right">{c.proposed == null ? 'N/A' : `${c.currency || ''} ${fmt(c.proposed)}`}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}

        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-[var(--text-muted)]">Saved findings by</span>
            {[['month', 'Month'], ['site', 'Site'], ['item_code', 'Tyre code']].map(([key, label]) => (
              <button key={key} type="button" aria-pressed={dim === key} className={`${BTN} ${dim === key ? 'ring-1 ring-[var(--accent)]' : ''}`} onClick={() => setDim(key)}>{label}</button>
            ))}
          </div>
          {groups.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No saved findings in this scope yet. Run an audit and save it.</p>
          ) : (
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead><tr className="text-[var(--text-muted)]"><th className="text-left p-1">{dim === 'item_code' ? 'Tyre code' : dim === 'site' ? 'Site' : 'Month'}</th><th className="text-right p-1">Findings</th><th className="text-right p-1">With a proposal</th><th className="text-right p-1">Proposed</th></tr></thead>
                <tbody>{groups.slice(0, 50).map((g) => (
                  <tr key={g.key} className="border-t border-[var(--border-dim)]"><td className="p-1">{g.key}</td><td className="p-1 text-right">{fmt(g.findings)}</td><td className="p-1 text-right">{fmt(g.proposed)}</td><td className="p-1 text-right">{moneyText(g.proposedByCurrency)}</td></tr>
                ))}</tbody>
              </table>
              {totals.truncated && <p className="text-[11px] text-[var(--text-muted)] mt-1">Totals cover the first 20,000 findings only.</p>}
            </div>
          )}
        </div>

        {mayDecide && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-dim)] p-2">
            <span className="text-xs text-[var(--text-secondary)]">{selected.size} selected</span>
            <button type="button" className={BTN} disabled={!!busy || !approvable.length} onClick={() => decide('approved')}><Check size={14} />Approve ({approvable.length})</button>
            <button type="button" className={BTN} disabled={!!busy || !rejectable.length} onClick={() => setRejecting(true)}><X size={14} />Reject ({rejectable.length})</button>
            {mayApply && <button type="button" className={BTN} disabled={!!busy || !appliable.length} onClick={() => setConfirmApply(true)}>Apply approved ({appliable.length})</button>}
          </div>
        )}

        {error ? (
          <div role="alert" className="flex items-center gap-2 text-sm text-red-300"><AlertTriangle size={15} />{error}<button type="button" className={BTN} onClick={load}>Retry</button></div>
        ) : (
          <EnterpriseTable columns={columns} data={list.rows} getRowId={(r) => r.id} loading={loading}
            enableGlobalFilter={false} enableKeyboard={false}
            emptyMessage="No findings match these filters. Run an audit and save it to create findings."
            manualPagination pageIndex={page} pageCount={Math.max(1, Math.ceil(list.total / PAGE_SIZE))}
            totalRows={list.total} pageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE]}
            onPageChange={(i) => setPage(Math.max(0, i))}
            exportFileName={reportFileName('Tyre cost audit page')} reportMeta={{ title: 'Tyre cost audit' }} />
        )}
      </div>

      {rejecting && (
        <Modal open size="sm" title="Reject findings" onClose={busy ? undefined : () => setRejecting(false)}
          footer={<div className="flex justify-end gap-2 w-full">
            <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setRejecting(false)} disabled={!!busy}>Cancel</button>
            <button type="button" className="btn-danger min-h-[44px]" disabled={!!busy || !rejectNote.trim()} onClick={() => decide('rejected', rejectNote)}>Reject {rejectable.length}</button>
          </div>}>
          <label className="text-sm text-[var(--text-secondary)] flex flex-col gap-1">Reason (required)
            <textarea className={INPUT} rows={3} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} aria-label="Rejection reason" />
          </label>
        </Modal>
      )}

      {confirmApply && (
        <Modal open size="sm" title="Apply approved corrections" onClose={busy ? undefined : () => setConfirmApply(false)}
          footer={<div className="flex justify-end gap-2 w-full">
            <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setConfirmApply(false)} disabled={!!busy}>Cancel</button>
            <button type="button" className="btn-primary min-h-[44px]" disabled={!!busy} onClick={apply}>{busy === 'apply' ? 'Applying...' : `Apply ${appliable.length}`}</button>
          </div>}>
          <div className="text-sm text-[var(--text-secondary)] space-y-2">
            <p>This writes {appliable.length} approved tyre cost{appliable.length === 1 ? '' : 's'} to the tyre register. Estimates are reverted to {COST_PENDING_LABEL}. Kilometres are not touched.</p>
            <p>It is undoable: the result gives a batch id, and Undo restores every row exactly as it was.</p>
          </div>
        </Modal>
      )}

      <SideDrawer open={!!detail} onClose={() => setDetail(null)} title="Finding evidence" subtitle={detail ? `${detail.serial_no || 'No serial'} / ${detail.asset_no || 'N/A'}` : ''}>
        {detail && (
          <dl className="text-sm grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5">
            {[
              ['Finding', classLabel(detail.class)], ['Next step', classAction(detail.class) || 'N/A'],
              ['Country / site', `${detail.country || 'N/A'} / ${detail.site || 'N/A'}`], ['Job card', detail.job_card || 'N/A'],
              ['Month', detail.month || 'N/A'], ['Brand / size', `${detail.tyre?.brand || 'N/A'} / ${detail.tyre?.size || 'N/A'}`],
              ['Original cost', costCell(detail.original_cost, detail.currency)],
              ['Proposed cost', detail.proposed_cost == null ? 'None' : costCell(detail.proposed_cost, detail.currency)],
              ['Item code', detail.item_code || 'N/A'], ['Source line', detail.source_line_id || 'N/A'],
              ['Confidence', detail.confidence || 'N/A'], ['Status', detail.status || 'N/A'],
              ['Decision note', detail.decision_note || 'N/A'], ['Applied batch', detail.applied_batch || 'N/A'],
            ].map(([dt, dd]) => (<Fragment key={dt}><dt className="text-[var(--text-muted)]">{dt}</dt><dd className="text-[var(--text-primary)] break-all">{dd}</dd></Fragment>))}
            <dt className="text-[var(--text-muted)]">Reasons</dt>
            <dd><ul className="list-disc pl-4">{(reasonsOf(detail).length ? reasonsOf(detail) : [classAction(detail.class) || 'N/A']).map((r) => <li key={r}>{r}</li>)}</ul></dd>
          </dl>
        )}
      </SideDrawer>
    </section>
  )
}
