import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { stock } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { Plus, Save, X, History, FileText, Download, ArrowLeftRight, Package, Upload, Lock } from 'lucide-react'
import Skeleton from '../components/ui/Skeleton'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import { exportToExcel, exportToPdf, resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'
import { formatDate } from '../lib/formatters'
import { useLanguage } from '../contexts/LanguageContext'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const STATUS_BADGE = {
  OK:       'bg-green-900/50 text-green-300 border-green-700/50',
  Low:      'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
  Critical: 'bg-red-900/50 text-red-300 border-red-700/50',
}

const EMPTY_FORM = {
  site: '', description: '', stock_qty: 0, min_level: 5, critical_level: 3, management_action: '',
}

// Canonical ledger movement types (the server RPC derives +/- direction from these).
const MOVEMENT_TYPES = ['receipt', 'return', 'transfer_in', 'adjustment_up', 'issue', 'transfer_out', 'scrap', 'adjustment_down']
const ADD_TYPES = new Set(['receipt', 'return', 'transfer_in', 'adjustment_up', 'in', 'reorder', 'initial'])

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
function offsetDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function StockManagement() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { appSettings, activeCountry } = useSettings()
  const { branding } = useTenant()
  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [historyFor, setHistoryFor] = useState(null)
  const [movements, setMovements]   = useState([])
  const [loadingMov, setLoadingMov] = useState(false)
  const [adjForm, setAdjForm]       = useState(null)
  // Approval-engine gate: locks the ledger-post (issuance/adjustment) control for
  // the open record while its workflow is active (pending/in_review/returned) or
  // locked (approved). Reset whenever a different record's history is opened.
  const [wfLocked, setWfLocked]     = useState(false)
  // Approval-engine gate for a Tyre Return ledger post (movement_type === 'return')
  // in the history/adjust modal. Independent of the general stock_issue lock so a
  // return-specific workflow can block only the return post it authorises.
  const [returnWfLocked, setReturnWfLocked] = useState(false)

  // Velocity state
  const [velocityMap, setVelocityMap] = useState({})

  // Timeline tab state
  const [activeTab, setActiveTab]       = useState('stock')
  const [tlFrom, setTlFrom]             = useState(offsetDate(-6))
  const [tlTo, setTlTo]                 = useState(todayStr())
  const [tlRecords, setTlRecords]       = useState([])
  const [tlLoading, setTlLoading]       = useState(false)

  // Transfer tab state
  const [transferForm, setTransferForm] = useState({ fromSite: '', toSite: '', qty: 1, notes: '' })
  const [transferring, setTransferring] = useState(false)
  const [transferMsg, setTransferMsg]   = useState('')
  const [transferError, setTransferError] = useState('')
  // Approval-engine gate for the inter-site transfer post. Locks the "Transfer
  // stock" control while the tyre_transfer workflow is active/locked.
  const [transferWfLocked, setTransferWfLocked] = useState(false)

  useEffect(() => { load() }, [activeCountry])

  // Reset the approval lock whenever a different record (or none) is opened in the
  // history modal; EntityApprovalPanel re-reports the true state via onStateChange.
  useEffect(() => { setWfLocked(false); setReturnWfLocked(false) }, [historyFor?.id])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const stockRecords = await stock.listStockRecords({ country: activeCountry }) ?? []
      setRecords(stockRecords)

      // Load velocity data from tyre_records (last 3 months)
      const threeMonthsAgo = new Date()
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
      const velData = await stock.listTyreIssuesSince(threeMonthsAgo.toISOString().slice(0, 10))

      // Group by site and sum qty
      const siteQtyMap = {}
      ;(velData ?? []).forEach(row => {
        const site = row.site
        if (!site) return
        if (!siteQtyMap[site]) siteQtyMap[site] = 0
        siteQtyMap[site] += (row.qty ?? 1)
      })

      // Build velocityMap keyed by stock record id
      const vMap = {}
      stockRecords.forEach(r => {
        const totalQty = siteQtyMap[r.site] ?? 0
        const avgPerMonth = +(totalQty / 3).toFixed(2)
        const daysRemaining = avgPerMonth > 0
          ? Math.round((r.stock_qty / avgPerMonth) * 30)
          : null
        vMap[r.id] = { avgPerMonth, daysRemaining }
      })
      setVelocityMap(vMap)
    } catch (err) {
      // A thrown fetch previously left the spinner stuck forever with no message.
      setError(err?.message || t('stock.errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }

  function deriveStatus(r) {
    if (r.stock_qty <= r.critical_level) return 'Critical'
    if (r.stock_qty <= r.min_level) return 'Low'
    return 'OK'
  }

  function startAdd() { setForm(EMPTY_FORM); setEditId(null); setShowForm(true); setError('') }
  function startEdit(r) {
    setForm({
      site: r.site, description: r.description ?? '',
      stock_qty: r.stock_qty, min_level: r.min_level, critical_level: r.critical_level,
      management_action: r.management_action ?? '',
    })
    setEditId(r.id)
    setShowForm(true)
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const prevRecord = editId ? records.find(r => r.id === editId) : null
    const prevQty    = prevRecord?.stock_qty ?? 0
    const newQty     = +form.stock_qty
    const status     = deriveStatus(form)

    const payload = {
      ...form,
      stock_qty: newQty,
      stock_status: status,
      updated_by: profile?.id,
      updated_at: new Date().toISOString(),
    }

    let stockId = editId
    try {
      if (editId) {
        await stock.updateStockRecord(editId, payload)
      } else {
        const ins = await stock.insertStockRecord(payload)
        stockId = ins.id
      }
    } catch (err) { setError(err.message); setSaving(false); return }

    const qtyChange = editId ? newQty - prevQty : newQty
    if (qtyChange !== 0 || !editId) {
      // Best-effort audit movement - original ignored insert errors here.
      try {
        await stock.insertStockMovement({
          stock_id:      stockId,
          site:          form.site,
          description:   form.description || null,
          movement_type: editId ? (qtyChange > 0 ? 'In' : 'Out') : 'Initial',
          qty_before:    editId ? prevQty : 0,
          qty_change:    qtyChange,
          qty_after:     newQty,
          reason:        editId ? 'Manual edit' : 'Initial stock entry',
          created_by:    profile?.id ?? null,
        })
      } catch { /* audit is best-effort; do not block the save */ }
    }

    setShowForm(false)
    load()
    setSaving(false)
  }

  async function saveAdjustment() {
    // Block the ledger post while the record's approval workflow is active/locked.
    // A Tyre Return post is additionally gated by its own return-authorization lock.
    if (wfLocked) return
    if (adjForm?.movement_type === 'return' && returnWfLocked) return
    if (!adjForm || !adjForm.qty_change) return
    const rec = historyFor
    setSaving(true); setError('')
    // Atomic, guarded, audited ledger post. The server computes qty_before/after
    // and blocks a negative balance - no client-side stock math.
    let data
    try {
      data = await stock.postStockMovement({
        stockId:   rec.id,
        type:      adjForm.movement_type,
        qty:       adjForm.qty_change,
        reason:    adjForm.reason,
        reference: adjForm.reference_no,
      })
    } catch (aErr) { setError(aErr.message); setSaving(false); return }
    const newQty = data?.qty_after ?? rec.stock_qty
    setAdjForm(null)
    await load()
    await openHistory({ ...rec, stock_qty: newQty })
    setSaving(false)
  }

  async function openHistory(rec) {
    setHistoryFor(rec)
    setLoadingMov(true)
    let data = []
    try { data = await stock.listStockMovements(rec.id, 50) } catch { data = [] }
    setMovements(data || [])
    setLoadingMov(false)
  }

  // ── Inter-site Transfer ─────────────────────────────────────────────────────
  async function submitTransfer(e) {
    e.preventDefault()
    setTransferError('')
    setTransferMsg('')

    // Block the transfer post while its approval workflow is active/locked.
    if (transferWfLocked) { setTransferError('Transfer is locked pending approval.'); return }

    const { fromSite, toSite, qty, notes } = transferForm
    const transferQty = +qty

    if (!fromSite || !toSite) { setTransferError(t('stock.transfer.errors.selectBoth')); return }
    if (fromSite === toSite)  { setTransferError(t('stock.transfer.errors.sameSite')); return }
    if (transferQty < 1)      { setTransferError(t('stock.transfer.errors.minQty')); return }

    const fromRecord = records.find(r => r.site === fromSite)
    const toRecord   = records.find(r => r.site === toSite)

    if (!fromRecord) { setTransferError(t('stock.transfer.errors.noRecordForSite', { site: fromSite })); return }
    if (!toRecord)   { setTransferError(t('stock.transfer.errors.noRecordForSite', { site: toSite })); return }
    if (transferQty > fromRecord.stock_qty) {
      setTransferError(t('stock.transfer.errors.insufficientStock', { site: fromSite, qty: fromRecord.stock_qty }))
      return
    }

    setTransferring(true)

    const reasonOut = `Transfer to ${toSite}${notes ? ': ' + notes : ''}`
    const reasonIn  = `Transfer from ${fromSite}${notes ? ': ' + notes : ''}`

    // Two atomic ledger legs. Each RPC row-locks its stock row and negative-guards.
    try {
      await stock.postStockMovement({ stockId: fromRecord.id, type: 'transfer_out', qty: transferQty, reason: reasonOut, reference: notes })
    } catch (outErr) { setTransferError(outErr.message); setTransferring(false); return }
    try {
      await stock.postStockMovement({ stockId: toRecord.id, type: 'transfer_in', qty: transferQty, reason: reasonIn, reference: notes })
    } catch (inErr) {
      setTransferError(t('stock.transfer.errors.inboundFailed', { message: inErr.message }))
      setTransferring(false); await load(); return
    }

    setTransferMsg(t('stock.transfer.successMsg', { qty: transferQty, fromSite, toSite }))
    setTransferForm({ fromSite: '', toSite: '', qty: 1, notes: '' })
    setTransferring(false)
    await load()
  }

  // ── Timeline data load ──────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'timeline') loadTimeline()
  }, [activeTab, tlFrom, tlTo, activeCountry])

  async function loadTimeline() {
    setTlLoading(true)
    let data = []
    try { data = await stock.listTyreIssuesInRange({ from: tlFrom, to: tlTo, country: activeCountry }) } catch { data = [] }
    setTlRecords(data ?? [])
    setTlLoading(false)
  }

  // Group timeline records by date
  const tlByDate = useMemo(() => {
    const map = {}
    ;(tlRecords ?? []).forEach(r => {
      const d = r.issue_date?.slice(0, 10)
      if (!d) return
      if (!map[d]) map[d] = { in: 0, out: 0 }
      const qty = r.qty ?? 1
      if (qty < 0) map[d].in += -qty
      else map[d].out += qty
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [tlRecords])

  // Yesterday comparison
  const todayKey     = todayStr()
  const yesterdayKey = offsetDate(-1)
  const todayIssues     = tlByDate.find(([d]) => d === todayKey)?.[1]?.out ?? 0
  const yesterdayIssues = tlByDate.find(([d]) => d === yesterdayKey)?.[1]?.out ?? 0
  const changePct = yesterdayIssues > 0
    ? (((todayIssues - yesterdayIssues) / yesterdayIssues) * 100).toFixed(1)
    : null

  // Bar chart data
  const tlChartData = useMemo(() => ({
    labels: tlByDate.map(([d]) => d),
    datasets: [{
      label: t('stock.timeline.netChangeLabel'),
      data: tlByDate.map(([, v]) => v.in - v.out),
      backgroundColor: tlByDate.map(([, v]) => {
        const net = v.in - v.out
        return net > 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'
      }),
      borderRadius: 4,
    }],
  }), [tlByDate, t])

  // Reorder request PDF
  async function generateReorderPdf(rec) {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
    pdfHeader(doc, 'Reorder Request', `${rec.site} · Stock Report`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      head: [['Field', 'Value']],
      body: [
        ['Site',            rec.site],
        ['Description',     rec.description || '-'],
        ['Current Stock',   String(rec.stock_qty)],
        ['Critical Level',  String(rec.critical_level)],
        ['Min Level',       String(rec.min_level)],
        ['Reorder Qty',     String(Math.max(0, (rec.min_level || 5) * 3 - rec.stock_qty))],
        ['Status',          deriveStatus(rec)],
        ['Requested By',    profile?.full_name || profile?.username || '-'],
        ['Date',            formatDate(new Date())],
      ],
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(`reorder-${rec.site.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
  }

  function exportExcel() {
    const rows = records.map(r => ({
      Site:              r.site,
      Description:       r.description || '',
      'Stock Qty':       r.stock_qty,
      'Min Level':       r.min_level,
      'Critical Level':  r.critical_level,
      'Reorder Qty':     r.reorder_qty || 0,
      Status:            deriveStatus(r),
      Action:            r.management_action || '',
    }))
    exportToExcel(rows, Object.keys(rows[0] || {}), Object.keys(rows[0] || {}), 'stock-records', 'Stock')
  }

  function exportPdf() {
    const rows = records.map(r => [
      r.site, r.description || '-', r.stock_qty, r.min_level, r.critical_level, deriveStatus(r),
    ])
    exportToPdf(rows, ['Site', 'Description', 'Stock', 'Min', 'Critical', 'Status'],
      'Stock Management', 'stock-records')
  }

  const counts = useMemo(() => {
    const c = { OK: 0, Low: 0, Critical: 0 }
    records.forEach(r => { const s = deriveStatus(r); c[s] = (c[s] || 0) + 1 })
    return c
  }, [records])

  const sites = useMemo(() => [...new Set(records.map(r => r.site).filter(Boolean))].sort(), [records])

  // Tabs: show Transfer only if >= 2 sites
  const tabs = useMemo(() => {
    const base = [['stock', t('stock.tabs.stock')], ['timeline', t('stock.tabs.timeline')]]
    if (sites.length >= 2) return [['stock', t('stock.tabs.stock')], ['transfer', t('stock.tabs.transfer')], ['timeline', t('stock.tabs.timeline')]]
    return base
  }, [sites, t])

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('stock.title')}
        subtitle={t('stock.subtitle', { count: records.length })}
        icon={Package}
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => navigate('/data-intake?module=stock')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={15} /> {t('stock.actions.import')}
          </button>
          <button onClick={exportExcel} className="btn-secondary text-xs flex items-center gap-1.5">
            <Download size={14} /> {t('stock.actions.excel')}
          </button>
          <button onClick={exportPdf} className="btn-secondary text-xs flex items-center gap-1.5">
            <FileText size={14} /> {t('stock.actions.pdf')}
          </button>
          <button onClick={startAdd} className="btn-secondary flex items-center gap-2 text-sm">
            <Plus size={16} /> {t('stock.actions.addStock')}
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)] -mt-1">
        {t('stock.intakeNote.prefix')}{' '}
        <button
          type="button"
          onClick={() => navigate('/data-intake?module=stock')}
          className="text-green-400 hover:text-green-300 underline underline-offset-2"
        >
          {t('stock.intakeNote.linkText')}
        </button>{' '}
        {t('stock.intakeNote.suffix')}
      </p>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(([val, label]) => (
          <button
            key={val}
            onClick={() => setActiveTab(val)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === val ? 'bg-blue-600 text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── STOCK LEVELS TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'stock' && (
        <>
          {/* Status summary */}
          <div className="flex gap-3">
            {Object.entries(counts).map(([s, cnt]) => (
              <span key={s} className={`text-xs px-3 py-1.5 rounded-full border font-medium ${STATUS_BADGE[s]}`}>
                {cnt} {t(`stock.statuses.${s}`)}
              </span>
            ))}
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      t('stock.table.columns.site'), t('stock.table.columns.description'), t('stock.table.columns.stock'),
                      t('stock.table.columns.min'), t('stock.table.columns.critical'), t('stock.table.columns.reorderQty'),
                      t('stock.table.columns.status'), t('stock.table.columns.velocity'), t('stock.table.columns.daysLeft'),
                      t('stock.table.columns.action'), '',
                    ].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}><td colSpan={11} className="px-3.5 py-3"><Skeleton className="h-4 w-full" /></td></tr>
                    ))
                  ) : records.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-12 text-[var(--text-muted)]">{t('stock.table.emptyTitle')}</td></tr>
                  ) : records.map(r => {
                    const status = deriveStatus(r)
                    const vel    = velocityMap[r.id]
                    const avg    = vel?.avgPerMonth ?? 0
                    const days   = vel?.daysRemaining ?? null

                    const reorderSuggestion = vel && days !== null && days < 30
                      ? Math.max(0, (r.reorder_qty && r.reorder_qty > 0)
                          ? r.reorder_qty
                          : (r.min_level * 2) - r.stock_qty)
                      : null

                    const daysColor = days === null
                      ? 'text-[var(--text-muted)]'
                      : days > 30 ? 'text-green-400 font-semibold'
                      : days >= 10 ? 'text-yellow-400 font-semibold'
                      : 'text-red-400 font-bold'

                    return (
                      <tr key={r.id} className="hover:bg-[var(--input-bg)]/30 transition-colors">
                        <td className="table-cell font-medium text-[var(--text-primary)]">{r.site}</td>
                        <td className="table-cell text-[var(--text-secondary)]">{r.description ?? '-'}</td>
                        <td className="table-cell">
                          <span className={
                            status === 'Critical' ? 'text-red-400 font-bold' :
                            status === 'Low' ? 'text-yellow-400 font-semibold' : 'text-green-400 font-semibold'
                          }>{r.stock_qty}</span>
                        </td>
                        <td className="table-cell text-[var(--text-muted)]">{r.min_level}</td>
                        <td className="table-cell text-[var(--text-muted)]">{r.critical_level}</td>
                        <td className="table-cell text-[var(--text-muted)]">{r.reorder_qty ?? 0}</td>
                        <td className="table-cell">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[status]}`}>{t(`stock.statuses.${status}`)}</span>
                        </td>
                        <td className="table-cell">
                          <span className={avg > 0 ? 'text-[var(--text-secondary)] text-xs' : 'text-[var(--text-dim)] text-xs'}>
                            {avg > 0 ? `${avg}/mo` : '-'}
                          </span>
                        </td>
                        <td className="table-cell">
                          <span className={`text-xs ${daysColor}`}>
                            {days === null ? '∞' : `${days}d`}
                          </span>
                        </td>
                        <td className="table-cell text-[var(--text-muted)] text-xs max-w-xs">
                          <div className="flex flex-col gap-1">
                            {r.management_action ? (
                              <span className="truncate">{r.management_action}</span>
                            ) : <span className="text-[var(--text-dim)]">-</span>}
                            {reorderSuggestion !== null && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-300 border border-amber-700/50 whitespace-nowrap">
                                {t('stock.table.reorderBadge', { qty: reorderSuggestion })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => startEdit(r)} className="text-[var(--text-muted)] hover:text-blue-400 text-xs transition-colors">{t('stock.table.edit')}</button>
                            <button
                              onClick={() => { openHistory(r); setAdjForm({ qty_change: 0, reason: '', movement_type: 'adjustment_up', reference_no: '' }) }}
                              className="text-[var(--text-muted)] hover:text-purple-400 text-xs transition-colors"
                              title={t('stock.table.movementHistoryTooltip')}
                            >
                              <History size={14} />
                            </button>
                            {status === 'Critical' && (
                              <button
                                onClick={() => generateReorderPdf(r)}
                                title={t('stock.table.generateReorderPdfTooltip')}
                                className="text-[var(--text-muted)] hover:text-orange-400 text-xs transition-colors"
                              >
                                <FileText size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── TRANSFER TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'transfer' && (
        <div className="max-w-lg">
          <div className="card space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <ArrowLeftRight size={18} className="text-blue-400" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('stock.transfer.heading')}</h2>
            </div>
            <p className="text-[var(--text-muted)] text-sm -mt-3">{t('stock.transfer.subtitle')}</p>

            {transferMsg && (
              <div className="bg-green-900/30 border border-green-700 text-green-300 rounded-lg px-4 py-3 text-sm">
                {transferMsg}
              </div>
            )}
            {transferError && (
              <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
                {transferError}
              </div>
            )}

            <form onSubmit={submitTransfer} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('stock.transfer.fromSite')}</label>
                  <select
                    className="input"
                    value={transferForm.fromSite}
                    onChange={e => {
                      const fromSite = e.target.value
                      setTransferError('')
                      setTransferMsg('')
                      // Auto-fill description from first matching record
                      const matchRec = records.find(r => r.site === fromSite)
                      setTransferForm(f => ({
                        ...f,
                        fromSite,
                        toSite: f.toSite === fromSite ? '' : f.toSite,
                        qty: 1,
                      }))
                    }}
                    required
                  >
                    <option value="">{t('stock.transfer.selectOption')}</option>
                    {sites.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.fromSite && (() => {
                    const rec = records.find(r => r.site === transferForm.fromSite)
                    return rec ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('stock.transfer.availablePrefix')} <span className="text-[var(--text-secondary)] font-medium">{rec.stock_qty}</span> {t('stock.transfer.unitsSuffix')}</p>
                    ) : null
                  })()}
                </div>
                <div>
                  <label className="label">{t('stock.transfer.toSite')}</label>
                  <select
                    className="input"
                    value={transferForm.toSite}
                    onChange={e => {
                      setTransferError('')
                      setTransferMsg('')
                      setTransferForm(f => ({ ...f, toSite: e.target.value }))
                    }}
                    required
                  >
                    <option value="">{t('stock.transfer.selectOption')}</option>
                    {sites.filter(s => s !== transferForm.fromSite).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.toSite && (() => {
                    const rec = records.find(r => r.site === transferForm.toSite)
                    return rec ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('stock.transfer.currentPrefix')} <span className="text-[var(--text-secondary)] font-medium">{rec.stock_qty}</span> {t('stock.transfer.unitsSuffix')}</p>
                    ) : null
                  })()}
                </div>
              </div>

              <div>
                <label className="label">{t('stock.transfer.quantity')}</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={records.find(r => r.site === transferForm.fromSite)?.stock_qty ?? undefined}
                  value={transferForm.qty}
                  onChange={e => {
                    setTransferError('')
                    setTransferForm(f => ({ ...f, qty: +e.target.value }))
                  }}
                  required
                />
              </div>

              <div>
                <label className="label">{t('stock.transfer.notes')}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={t('stock.transfer.notesPlaceholder')}
                  value={transferForm.notes}
                  onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* Transfer preview */}
              {transferForm.fromSite && transferForm.toSite && transferForm.qty > 0 && (
                <div className="bg-[var(--input-bg)]/50 border border-[var(--input-border)] rounded-lg p-3 text-xs text-[var(--text-muted)] space-y-1">
                  <p className="text-[var(--text-secondary)] font-medium text-xs mb-2">{t('stock.transfer.previewTitle')}</p>
                  {(() => {
                    const from = records.find(r => r.site === transferForm.fromSite)
                    const to   = records.find(r => r.site === transferForm.toSite)
                    const qty  = +transferForm.qty
                    return (
                      <>
                        <div className="flex justify-between">
                          <span>{transferForm.fromSite}</span>
                          <span>
                            <span className="text-[var(--text-muted)]">{from?.stock_qty ?? '?'}</span>
                            <span className="text-[var(--text-dim)] mx-1">→</span>
                            <span className={from && from.stock_qty - qty < from.critical_level ? 'text-red-400' : 'text-green-400'}>
                              {from ? from.stock_qty - qty : '?'}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{transferForm.toSite}</span>
                          <span>
                            <span className="text-[var(--text-muted)]">{to?.stock_qty ?? '?'}</span>
                            <span className="text-[var(--text-dim)] mx-1">→</span>
                            <span className="text-green-400">{to ? to.stock_qty + qty : '?'}</span>
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Inter-site Transfer Approval — gates the "Transfer stock" post below.
                  Mounted only once a valid source stock record + transfer context
                  exists. The second workflow step conditions on context.qty
                  (auto-skips when qty < 10), so qty MUST be numeric. */}
              {(() => {
                const fromRecord = records.find(r => r.site === transferForm.fromSite)
                if (!fromRecord || !transferForm.toSite || +transferForm.qty < 1) return null
                return (
                  <div className="space-y-2">
                    <EntityApprovalPanel
                      entityType="tyre_transfer"
                      entityId={fromRecord.id}
                      entityLabel={`${transferForm.fromSite} → ${transferForm.toSite}`}
                      context={{
                        qty: Number(transferForm.qty) || 0,
                        from_site: transferForm.fromSite,
                        to_site: transferForm.toSite,
                        country: activeCountry,
                        description: fromRecord.description || transferForm.notes || null,
                      }}
                      title="Inter-site Transfer Approval"
                      onStateChange={({ isActive, isLocked }) => setTransferWfLocked(!!(isActive || isLocked))}
                    />
                    {transferWfLocked && (
                      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Lock size={12} /> Locked, in approval
                      </div>
                    )}
                  </div>
                )
              })()}

              <button
                type="submit"
                disabled={transferring || transferWfLocked || !transferForm.fromSite || !transferForm.toSite || transferForm.qty < 1}
                title={transferWfLocked ? 'Locked, in approval' : undefined}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {transferWfLocked ? <Lock size={16} /> : <ArrowLeftRight size={16} />}
                {transferring ? t('stock.transfer.transferring') : t('stock.transfer.transferStock')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── TIMELINE TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          {/* Comparison stat */}
          <div className="card flex flex-wrap items-center gap-4">
            <div className="text-sm text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-primary)]">{t('stock.timeline.today')}</span> {todayIssues} {t('stock.timeline.issues')}
            </div>
            <span className="text-[var(--text-dim)]">·</span>
            <div className="text-sm text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-primary)]">{t('stock.timeline.yesterday')}</span> {yesterdayIssues} {t('stock.timeline.issues')}
            </div>
            <span className="text-[var(--text-dim)]">·</span>
            <div className="text-sm">
              <span className="text-[var(--text-muted)]">{t('stock.timeline.change')}</span>
              {changePct === null ? (
                <span className="text-[var(--text-muted)]">{t('stock.timeline.na')}</span>
              ) : (
                <span className={+changePct > 0 ? 'text-red-400 font-medium' : +changePct < 0 ? 'text-green-400 font-medium' : 'text-[var(--text-muted)]'}>
                  {+changePct > 0 ? '+' : ''}{changePct}%
                </span>
              )}
            </div>
          </div>

          {/* Date range picker */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="label text-xs whitespace-nowrap">{t('stock.timeline.from')}</label>
              <input type="date" className="input w-40 text-sm" value={tlFrom} onChange={e => setTlFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="label text-xs whitespace-nowrap">{t('stock.timeline.to')}</label>
              <input type="date" className="input w-40 text-sm" value={tlTo} onChange={e => setTlTo(e.target.value)} />
            </div>
            {/* Quick chips */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: t('stock.timeline.chips.today'),       from: todayStr(),    to: todayStr() },
                { label: t('stock.timeline.chips.yesterday'),   from: offsetDate(-1), to: offsetDate(-1) },
                { label: t('stock.timeline.chips.last7Days'), from: offsetDate(-6), to: todayStr() },
                { label: t('stock.timeline.chips.last30Days'),from: offsetDate(-29), to: todayStr() },
                { label: t('stock.timeline.chips.thisMonth'),  from: firstOfMonth(), to: todayStr() },
              ].map(({ label, from, to }) => (
                <button
                  key={label}
                  onClick={() => { setTlFrom(from); setTlTo(to) }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    tlFrom === from && tlTo === to
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Bar chart */}
          {tlByDate.length > 0 && (
            <div className="card">
              <p className="text-sm text-[var(--text-muted)] mb-3">{t('stock.timeline.chartTitle')}</p>
              <div style={{ height: 220 }}>
                <Bar
                  data={tlChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' }, beginAtZero: true },
                    },
                  }}
                />
              </div>
            </div>
          )}

          {/* Daily table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {[
                      t('stock.timeline.columns.date'), t('stock.timeline.columns.itemsIn'),
                      t('stock.timeline.columns.itemsOut'), t('stock.timeline.columns.netChange'),
                    ].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tlLoading ? (
                    <tr><td colSpan={4} className="text-center py-12 text-[var(--text-muted)]">{t('stock.timeline.loading')}</td></tr>
                  ) : tlByDate.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-12 text-[var(--text-muted)]">{t('stock.timeline.emptyPeriod')}</td></tr>
                  ) : tlByDate.map(([date, vals]) => {
                    const net = vals.in - vals.out
                    return (
                      <tr key={date} className="hover:bg-[var(--input-bg)]/30 transition-colors">
                        <td className="table-cell font-medium text-[var(--text-primary)]">{date}</td>
                        <td className="table-cell text-green-400">{vals.in}</td>
                        <td className="table-cell text-red-400">{vals.out}</td>
                        <td className="table-cell">
                          <span className={`font-semibold ${net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                            {net > 0 ? '+' : ''}{net}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Movement History Modal */}
      {historyFor && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setHistoryFor(null)}>
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--input-border)]">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('stock.historyModal.title', { site: historyFor.site })}</h2>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">{t('stock.historyModal.subtitle', { description: historyFor.description || '', qty: historyFor.stock_qty })}</p>
              </div>
              <button onClick={() => setHistoryFor(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>

            {/* Approval & Workflow Engine — status, immutable trail, approver action, start picker.
                Gates the ledger-post (stock issuance/adjustment) control below via onStateChange. */}
            <div className="p-4 border-b border-[var(--input-border)]">
              <EntityApprovalPanel
                entityType="stock_issue"
                entityId={historyFor.id}
                entityLabel={historyFor.description || historyFor.site || historyFor.id}
                context={{
                  quantity: historyFor.stock_qty,
                  value: historyFor.reorder_qty ?? historyFor.min_level,
                  movement_type: adjForm?.movement_type,
                  site: historyFor.site,
                }}
                onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
                title="Stock Issuance Approval"
              />
              {wfLocked && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-2">
                  <Lock size={12} /> Locked, in approval
                </div>
              )}

              {/* Tyre Return Authorization — shown only when the pending movement is a
                  return. Gates the return ledger-post via returnWfLocked, keyed on the
                  same stock record so it is independent of the stock_issue panel. */}
              {adjForm?.movement_type === 'return' && (
                <div className="mt-3">
                  <EntityApprovalPanel
                    entityType="tyre_return"
                    entityId={historyFor.id}
                    entityLabel={historyFor.description || historyFor.site || historyFor.id}
                    context={{
                      qty: Number(adjForm?.qty_change) || 0,
                      site: historyFor.site,
                      country: activeCountry,
                      description: historyFor.description || null,
                    }}
                    onStateChange={({ isActive, isLocked }) => setReturnWfLocked(!!(isActive || isLocked))}
                    title="Tyre Return Authorization"
                  />
                  {returnWfLocked && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-2">
                      <Lock size={12} /> Return locked, in approval
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick adjustment form */}
            {adjForm && (
              <div className="p-4 border-b border-[var(--input-border)] bg-[var(--input-bg)]/30">
                <p className="text-xs text-[var(--text-muted)] mb-3">{t('stock.historyModal.logMovement')}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.type')}</label>
                    <select className="input text-xs py-1.5"
                      value={adjForm.movement_type}
                      onChange={e => setAdjForm(f => ({ ...f, movement_type: e.target.value }))}>
                      {MOVEMENT_TYPES.map(mt => <option key={mt} value={mt}>{t(`stock.movementTypes.${mt}`)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.qtyChange')}</label>
                    <input type="number" className="input text-xs py-1.5"
                      value={adjForm.qty_change}
                      onChange={e => setAdjForm(f => ({ ...f, qty_change: +e.target.value }))}
                      placeholder={t('stock.historyModal.qtyChangePlaceholder')} />
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.reason')}</label>
                    <input className="input text-xs py-1.5" value={adjForm.reason}
                      onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder={t('stock.historyModal.reasonPlaceholder')} />
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.refNo')}</label>
                    <input className="input text-xs py-1.5" value={adjForm.reference_no}
                      onChange={e => setAdjForm(f => ({ ...f, reference_no: e.target.value }))}
                      placeholder={t('stock.historyModal.refNoPlaceholder')} />
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveAdjustment}
                    disabled={saving || adjForm.qty_change === 0 || wfLocked || (adjForm.movement_type === 'return' && returnWfLocked)}
                    title={wfLocked || (adjForm.movement_type === 'return' && returnWfLocked) ? 'Locked, in approval' : undefined}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {(wfLocked || (adjForm.movement_type === 'return' && returnWfLocked)) && <Lock size={12} />}
                    {saving ? t('stock.historyModal.saving') : t('stock.historyModal.logMovementBtn')}
                  </button>
                  <span className="text-xs text-[var(--text-muted)] self-center">
                    {t('stock.historyModal.newQty', { qty: historyFor.stock_qty + (adjForm.qty_change || 0) })}
                  </span>
                </div>
              </div>
            )}

            {/* History table */}
            <div className="overflow-y-auto flex-1">
              {loadingMov ? (
                <div className="text-center py-8 text-[var(--text-muted)]">{t('stock.historyModal.loading')}</div>
              ) : movements.length === 0 ? (
                <div className="text-center py-8 text-[var(--text-muted)]">{t('stock.historyModal.emptyHistory')}</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--surface-1)]">
                    <tr className="text-[var(--text-muted)] border-b border-[var(--input-border)]">
                      <th className="table-header py-2">{t('stock.historyModal.columns.date')}</th>
                      <th className="table-header py-2">{t('stock.historyModal.columns.type')}</th>
                      <th className="table-header py-2">{t('stock.historyModal.columns.before')}</th>
                      <th className="table-header py-2">{t('stock.historyModal.columns.change')}</th>
                      <th className="table-header py-2">{t('stock.historyModal.columns.after')}</th>
                      <th className="table-header py-2">{t('stock.historyModal.columns.reason')}</th>
                      <th className="table-header py-2">{t('stock.historyModal.columns.ref')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(m => (
                      <tr key={m.id} className="border-b border-[var(--input-border)]/50">
                        <td className="table-cell py-2 text-[var(--text-muted)]">{formatDate(m.created_at)}</td>
                        <td className="table-cell py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${
                            ADD_TYPES.has(String(m.movement_type).toLowerCase()) ? 'bg-green-900/30 text-green-400' :
                            String(m.movement_type).toLowerCase() !== 'adjustment' ? 'bg-red-900/30 text-red-400' :
                            'bg-[var(--input-bg)] text-[var(--text-muted)]'
                          }`}>
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="table-cell py-2 text-[var(--text-muted)] text-center">{m.qty_before}</td>
                        <td className="table-cell py-2 text-center font-medium">
                          <span className={m.qty_change > 0 ? 'text-green-400' : 'text-red-400'}>
                            {m.qty_change > 0 ? '+' : ''}{m.qty_change}
                          </span>
                        </td>
                        <td className="table-cell py-2 text-[var(--text-primary)] text-center font-semibold">{m.qty_after}</td>
                        <td className="table-cell py-2 text-[var(--text-muted)]">{m.reason || '-'}</td>
                        <td className="table-cell py-2 text-[var(--text-muted)]">{m.reference_no || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{editId ? t('stock.form.editTitle') : t('stock.form.addTitle')}</h2>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
            <form onSubmit={save} className="space-y-3">
              <div>
                <label className="label">{t('stock.form.site')}</label>
                <input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} required list="stock-sites" />
                <datalist id="stock-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">{t('stock.form.description')}</label>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={t('stock.form.descriptionPlaceholder')} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="label">{t('stock.form.stockQty')}</label><input type="number" className="input" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: +e.target.value }))} min={0} /></div>
                <div><label className="label">{t('stock.form.minLevel')}</label><input type="number" className="input" value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} min={0} /></div>
                <div><label className="label">{t('stock.form.criticalLevel')}</label><input type="number" className="input" value={form.critical_level} onChange={e => setForm(f => ({ ...f, critical_level: +e.target.value }))} min={0} /></div>
              </div>
              <div>
                <label className="label">{t('stock.form.managementAction')}</label>
                <input className="input" value={form.management_action} onChange={e => setForm(f => ({ ...f, management_action: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? t('stock.form.saving') : t('stock.form.save')}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">{t('stock.form.cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
