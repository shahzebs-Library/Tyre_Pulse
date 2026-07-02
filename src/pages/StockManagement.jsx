import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { stock } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { Plus, Save, X, History, FileText, Download, ArrowLeftRight, Package, Upload } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
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
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { appSettings, activeCountry } = useSettings()
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

  useEffect(() => { load() }, [activeCountry])

  async function load() {
    setLoading(true)
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

    setLoading(false)
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

    const { fromSite, toSite, qty, notes } = transferForm
    const transferQty = +qty

    if (!fromSite || !toSite) { setTransferError('Select both From and To sites.'); return }
    if (fromSite === toSite)  { setTransferError('From and To sites must be different.'); return }
    if (transferQty < 1)      { setTransferError('Quantity must be at least 1.'); return }

    const fromRecord = records.find(r => r.site === fromSite)
    const toRecord   = records.find(r => r.site === toSite)

    if (!fromRecord) { setTransferError(`No stock record found for site: ${fromSite}`); return }
    if (!toRecord)   { setTransferError(`No stock record found for site: ${toSite}`); return }
    if (transferQty > fromRecord.stock_qty) {
      setTransferError(`Insufficient stock at ${fromSite}. Available: ${fromRecord.stock_qty}`)
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
      setTransferError('Outbound posted but inbound failed: ' + inErr.message)
      setTransferring(false); await load(); return
    }

    setTransferMsg(`Successfully transferred ${transferQty} units from ${fromSite} to ${toSite}.`)
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
      map[d].out += qty
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
      label: 'Net Change (out)',
      data: tlByDate.map(([, v]) => v.out - v.in),
      backgroundColor: tlByDate.map(([, v]) => {
        const net = v.out - v.in
        return net > 0 ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)'
      }),
      borderRadius: 4,
    }],
  }), [tlByDate])

  // Reorder request PDF
  async function generateReorderPdf(rec) {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    doc.setFillColor(30, 30, 40)
    doc.rect(0, 0, 210, 297, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.text('REORDER REQUEST', 14, 20)
    doc.setFontSize(11)
    doc.setTextColor(160, 160, 180)
    doc.text(`${appSettings.company_name || 'TyrePulse'} · Stock Report`, 14, 28)
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 14, 34)

    autoTable(doc, {
      startY: 42,
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
        ['Date',            new Date().toLocaleDateString('en-GB')],
      ],
      styles: { fillColor: [30, 40, 60], textColor: [220, 220, 240], fontSize: 11 },
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
    })

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
    const base = [['stock', 'Stock Levels'], ['timeline', 'Timeline']]
    if (sites.length >= 2) return [['stock', 'Stock Levels'], ['transfer', 'Transfer'], ['timeline', 'Timeline']]
    return base
  }, [sites])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Management"
        subtitle={`${records.length} sites tracked`}
        icon={Package}
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => navigate('/data-intake?module=stock')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={15} /> Import via Data Intake Center
          </button>
          <button onClick={exportExcel} className="btn-secondary text-xs flex items-center gap-1.5">
            <Download size={14} /> Excel
          </button>
          <button onClick={exportPdf} className="btn-secondary text-xs flex items-center gap-1.5">
            <FileText size={14} /> PDF
          </button>
          <button onClick={startAdd} className="btn-secondary flex items-center gap-2 text-sm">
            <Plus size={16} /> Add Stock
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 -mt-1">
        New: use the controlled{' '}
        <button
          type="button"
          onClick={() => navigate('/data-intake?module=stock')}
          className="text-green-400 hover:text-green-300 underline underline-offset-2"
        >
          Data Intake Center
        </button>{' '}
        for validated, audited, multi-country imports with duplicate detection and rollback.
      </p>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(([val, label]) => (
          <button
            key={val}
            onClick={() => setActiveTab(val)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === val ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
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
                {cnt} {s}
              </span>
            ))}
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {['Site', 'Description', 'Stock', 'Min', 'Critical', 'Reorder Qty', 'Status', 'Velocity', 'Days Left', 'Action', ''].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={11} className="text-center py-12 text-gray-500">Loading...</td></tr>
                  ) : records.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-12 text-gray-500">No stock records yet</td></tr>
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
                      ? 'text-gray-500'
                      : days > 30 ? 'text-green-400 font-semibold'
                      : days >= 10 ? 'text-yellow-400 font-semibold'
                      : 'text-red-400 font-bold'

                    return (
                      <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="table-cell font-medium text-white">{r.site}</td>
                        <td className="table-cell text-gray-300">{r.description ?? '-'}</td>
                        <td className="table-cell">
                          <span className={
                            status === 'Critical' ? 'text-red-400 font-bold' :
                            status === 'Low' ? 'text-yellow-400 font-semibold' : 'text-green-400 font-semibold'
                          }>{r.stock_qty}</span>
                        </td>
                        <td className="table-cell text-gray-400">{r.min_level}</td>
                        <td className="table-cell text-gray-400">{r.critical_level}</td>
                        <td className="table-cell text-gray-400">{r.reorder_qty ?? 0}</td>
                        <td className="table-cell">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[status]}`}>{status}</span>
                        </td>
                        <td className="table-cell">
                          <span className={avg > 0 ? 'text-gray-300 text-xs' : 'text-gray-600 text-xs'}>
                            {avg > 0 ? `${avg}/mo` : '-'}
                          </span>
                        </td>
                        <td className="table-cell">
                          <span className={`text-xs ${daysColor}`}>
                            {days === null ? '∞' : `${days}d`}
                          </span>
                        </td>
                        <td className="table-cell text-gray-400 text-xs max-w-xs">
                          <div className="flex flex-col gap-1">
                            {r.management_action ? (
                              <span className="truncate">{r.management_action}</span>
                            ) : <span className="text-gray-600">-</span>}
                            {reorderSuggestion !== null && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-900/40 text-amber-300 border border-amber-700/50 whitespace-nowrap">
                                Reorder: {reorderSuggestion}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="table-cell">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-blue-400 text-xs transition-colors">Edit</button>
                            <button
                              onClick={() => { openHistory(r); setAdjForm({ qty_change: 0, reason: '', movement_type: 'adjustment_up', reference_no: '' }) }}
                              className="text-gray-400 hover:text-purple-400 text-xs transition-colors"
                              title="Movement history"
                            >
                              <History size={14} />
                            </button>
                            {status === 'Critical' && (
                              <button
                                onClick={() => generateReorderPdf(r)}
                                title="Generate reorder PDF"
                                className="text-gray-400 hover:text-orange-400 text-xs transition-colors"
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
              <h2 className="text-base font-semibold text-white">Inter-Site Stock Transfer</h2>
            </div>
            <p className="text-gray-400 text-sm -mt-3">Move stock between sites. Both movement records and stock quantities will be updated.</p>

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
                  <label className="label">From Site *</label>
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
                    <option value="">- Select -</option>
                    {sites.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.fromSite && (() => {
                    const rec = records.find(r => r.site === transferForm.fromSite)
                    return rec ? (
                      <p className="text-xs text-gray-500 mt-1">Available: <span className="text-gray-300 font-medium">{rec.stock_qty}</span> units</p>
                    ) : null
                  })()}
                </div>
                <div>
                  <label className="label">To Site *</label>
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
                    <option value="">- Select -</option>
                    {sites.filter(s => s !== transferForm.fromSite).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.toSite && (() => {
                    const rec = records.find(r => r.site === transferForm.toSite)
                    return rec ? (
                      <p className="text-xs text-gray-500 mt-1">Current: <span className="text-gray-300 font-medium">{rec.stock_qty}</span> units</p>
                    ) : null
                  })()}
                </div>
              </div>

              <div>
                <label className="label">Quantity *</label>
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
                <label className="label">Notes</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Optional transfer reason or reference"
                  value={transferForm.notes}
                  onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* Transfer preview */}
              {transferForm.fromSite && transferForm.toSite && transferForm.qty > 0 && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-xs text-gray-400 space-y-1">
                  <p className="text-gray-300 font-medium text-xs mb-2">Transfer Preview</p>
                  {(() => {
                    const from = records.find(r => r.site === transferForm.fromSite)
                    const to   = records.find(r => r.site === transferForm.toSite)
                    const qty  = +transferForm.qty
                    return (
                      <>
                        <div className="flex justify-between">
                          <span>{transferForm.fromSite}</span>
                          <span>
                            <span className="text-gray-500">{from?.stock_qty ?? '?'}</span>
                            <span className="text-gray-600 mx-1">→</span>
                            <span className={from && from.stock_qty - qty < from.critical_level ? 'text-red-400' : 'text-green-400'}>
                              {from ? from.stock_qty - qty : '?'}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{transferForm.toSite}</span>
                          <span>
                            <span className="text-gray-500">{to?.stock_qty ?? '?'}</span>
                            <span className="text-gray-600 mx-1">→</span>
                            <span className="text-green-400">{to ? to.stock_qty + qty : '?'}</span>
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              <button
                type="submit"
                disabled={transferring || !transferForm.fromSite || !transferForm.toSite || transferForm.qty < 1}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ArrowLeftRight size={16} />
                {transferring ? 'Transferring...' : 'Transfer Stock'}
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
            <div className="text-sm text-gray-400">
              <span className="font-medium text-white">Today:</span> {todayIssues} issues
            </div>
            <span className="text-gray-600">·</span>
            <div className="text-sm text-gray-400">
              <span className="font-medium text-white">Yesterday:</span> {yesterdayIssues} issues
            </div>
            <span className="text-gray-600">·</span>
            <div className="text-sm">
              <span className="text-gray-400">Change: </span>
              {changePct === null ? (
                <span className="text-gray-500">N/A</span>
              ) : (
                <span className={+changePct > 0 ? 'text-red-400 font-medium' : +changePct < 0 ? 'text-green-400 font-medium' : 'text-gray-400'}>
                  {+changePct > 0 ? '+' : ''}{changePct}%
                </span>
              )}
            </div>
          </div>

          {/* Date range picker */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="label text-xs whitespace-nowrap">From</label>
              <input type="date" className="input w-40 text-sm" value={tlFrom} onChange={e => setTlFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="label text-xs whitespace-nowrap">To</label>
              <input type="date" className="input w-40 text-sm" value={tlTo} onChange={e => setTlTo(e.target.value)} />
            </div>
            {/* Quick chips */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Today',       from: todayStr(),    to: todayStr() },
                { label: 'Yesterday',   from: offsetDate(-1), to: offsetDate(-1) },
                { label: 'Last 7 days', from: offsetDate(-6), to: todayStr() },
                { label: 'Last 30 days',from: offsetDate(-29), to: todayStr() },
                { label: 'This Month',  from: firstOfMonth(), to: todayStr() },
              ].map(({ label, from, to }) => (
                <button
                  key={label}
                  onClick={() => { setTlFrom(from); setTlTo(to) }}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    tlFrom === from && tlTo === to
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
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
              <p className="text-sm text-gray-400 mb-3">Daily Issues (Net)</p>
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
                    {['Date', 'Items In', 'Items Out', 'Net Change'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tlLoading ? (
                    <tr><td colSpan={4} className="text-center py-12 text-gray-500">Loading...</td></tr>
                  ) : tlByDate.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-12 text-gray-500">No records in this period</td></tr>
                  ) : tlByDate.map(([date, vals]) => {
                    const net = vals.in - vals.out
                    return (
                      <tr key={date} className="hover:bg-gray-800/30 transition-colors">
                        <td className="table-cell font-medium text-white">{date}</td>
                        <td className="table-cell text-green-400">{vals.in}</td>
                        <td className="table-cell text-red-400">{vals.out}</td>
                        <td className="table-cell">
                          <span className={`font-semibold ${net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-gray-400'}`}>
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
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-white">Movement History · {historyFor.site}</h2>
                <p className="text-gray-400 text-xs mt-0.5">{historyFor.description || ''} · Current: {historyFor.stock_qty}</p>
              </div>
              <button onClick={() => setHistoryFor(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>

            {/* Quick adjustment form */}
            {adjForm && (
              <div className="p-4 border-b border-gray-800 bg-gray-800/30">
                <p className="text-xs text-gray-400 mb-3">Log Stock Movement</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="label text-xs">Type</label>
                    <select className="input text-xs py-1.5"
                      value={adjForm.movement_type}
                      onChange={e => setAdjForm(f => ({ ...f, movement_type: e.target.value }))}>
                      {MOVEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Qty Change</label>
                    <input type="number" className="input text-xs py-1.5"
                      value={adjForm.qty_change}
                      onChange={e => setAdjForm(f => ({ ...f, qty_change: +e.target.value }))}
                      placeholder="e.g. -4 or +10" />
                  </div>
                  <div>
                    <label className="label text-xs">Reason</label>
                    <input className="input text-xs py-1.5" value={adjForm.reason}
                      onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder="Why?" />
                  </div>
                  <div>
                    <label className="label text-xs">Ref. No</label>
                    <input className="input text-xs py-1.5" value={adjForm.reference_no}
                      onChange={e => setAdjForm(f => ({ ...f, reference_no: e.target.value }))}
                      placeholder="PO / Job Card" />
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveAdjustment}
                    disabled={saving || adjForm.qty_change === 0}
                    className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Log Movement'}
                  </button>
                  <span className="text-xs text-gray-500 self-center">
                    New qty: {historyFor.stock_qty + (adjForm.qty_change || 0)}
                  </span>
                </div>
              </div>
            )}

            {/* History table */}
            <div className="overflow-y-auto flex-1">
              {loadingMov ? (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              ) : movements.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No movement history yet</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="text-gray-400 border-b border-gray-800">
                      <th className="table-header py-2">Date</th>
                      <th className="table-header py-2">Type</th>
                      <th className="table-header py-2">Before</th>
                      <th className="table-header py-2">Change</th>
                      <th className="table-header py-2">After</th>
                      <th className="table-header py-2">Reason</th>
                      <th className="table-header py-2">Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(m => (
                      <tr key={m.id} className="border-b border-gray-800/50">
                        <td className="table-cell py-2 text-gray-400">{new Date(m.created_at).toLocaleDateString()}</td>
                        <td className="table-cell py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${
                            ADD_TYPES.has(String(m.movement_type).toLowerCase()) ? 'bg-green-900/30 text-green-400' :
                            String(m.movement_type).toLowerCase() !== 'adjustment' ? 'bg-red-900/30 text-red-400' :
                            'bg-gray-800 text-gray-400'
                          }`}>
                            {m.movement_type}
                          </span>
                        </td>
                        <td className="table-cell py-2 text-gray-400 text-center">{m.qty_before}</td>
                        <td className="table-cell py-2 text-center font-medium">
                          <span className={m.qty_change > 0 ? 'text-green-400' : 'text-red-400'}>
                            {m.qty_change > 0 ? '+' : ''}{m.qty_change}
                          </span>
                        </td>
                        <td className="table-cell py-2 text-white text-center font-semibold">{m.qty_after}</td>
                        <td className="table-cell py-2 text-gray-400">{m.reason || '-'}</td>
                        <td className="table-cell py-2 text-gray-500">{m.reference_no || '-'}</td>
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
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">{editId ? 'Edit' : 'Add'} Stock Record</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
            <form onSubmit={save} className="space-y-3">
              <div>
                <label className="label">Site *</label>
                <input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} required list="stock-sites" />
                <datalist id="stock-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">Description</label>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. 12.00R24 Bridgestone" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="label">Stock Qty</label><input type="number" className="input" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: +e.target.value }))} min={0} /></div>
                <div><label className="label">Min Level</label><input type="number" className="input" value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} min={0} /></div>
                <div><label className="label">Critical Level</label><input type="number" className="input" value={form.critical_level} onChange={e => setForm(f => ({ ...f, critical_level: +e.target.value }))} min={0} /></div>
              </div>
              <div>
                <label className="label">Management Action</label>
                <input className="input" value={form.management_action} onChange={e => setForm(f => ({ ...f, management_action: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
