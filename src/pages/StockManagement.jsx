import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { Plus, Save, X, History, FileText, Download } from 'lucide-react'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const STATUS_BADGE = {
  OK:       'bg-green-900/50 text-green-300 border-green-700/50',
  Low:      'bg-yellow-900/50 text-yellow-300 border-yellow-700/50',
  Critical: 'bg-red-900/50 text-red-300 border-red-700/50',
}

const EMPTY_FORM = {
  site: '', description: '', stock_qty: 0, min_level: 5, critical_level: 3, management_action: '',
}

const MOVEMENT_TYPES = ['In', 'Out', 'Adjustment', 'Initial', 'Reorder', 'Scrap']

export default function StockManagement() {
  const { profile } = useAuth()
  const { appSettings, activeCountry } = useSettings()
  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [historyFor, setHistoryFor] = useState(null)   // stock_record row
  const [movements, setMovements]   = useState([])
  const [loadingMov, setLoadingMov] = useState(false)
  const [adjForm, setAdjForm]       = useState(null)    // { qty_change, reason, movement_type }

  useEffect(() => { load() }, [activeCountry])

  async function load() {
    setLoading(true)
    let q = supabase.from('stock_records').select('*').order('site')
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data } = await q
    setRecords(data ?? [])
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
    if (editId) {
      const { error: err } = await supabase.from('stock_records').update(payload).eq('id', editId)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { data: ins, error: err } = await supabase.from('stock_records').insert(payload).select('id').single()
      if (err) { setError(err.message); setSaving(false); return }
      stockId = ins.id
    }

    // Log movement if qty changed (or initial insert)
    const qtyChange = editId ? newQty - prevQty : newQty
    if (qtyChange !== 0 || !editId) {
      await supabase.from('stock_movements').insert({
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
    }

    setShowForm(false)
    load()
    setSaving(false)
  }

  // Quick adjustment (change qty + log)
  async function saveAdjustment() {
    if (!adjForm || adjForm.qty_change === 0) return
    const rec      = historyFor
    const newQty   = rec.stock_qty + adjForm.qty_change
    const status   = deriveStatus({ ...rec, stock_qty: newQty })
    setSaving(true)

    await Promise.all([
      supabase.from('stock_records').update({
        stock_qty: newQty,
        stock_status: status,
        updated_by: profile?.id,
        updated_at: new Date().toISOString(),
      }).eq('id', rec.id),
      supabase.from('stock_movements').insert({
        stock_id:      rec.id,
        site:          rec.site,
        description:   rec.description || null,
        movement_type: adjForm.movement_type,
        qty_before:    rec.stock_qty,
        qty_change:    adjForm.qty_change,
        qty_after:     newQty,
        reason:        adjForm.reason || null,
        reference_no:  adjForm.reference_no || null,
        created_by:    profile?.id ?? null,
      }),
    ])

    setAdjForm(null)
    await load()
    // Refresh movements
    await openHistory({ ...rec, stock_qty: newQty })
    setSaving(false)
  }

  async function openHistory(rec) {
    setHistoryFor(rec)
    setLoadingMov(true)
    const { data } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('stock_id', rec.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setMovements(data || [])
    setLoadingMov(false)
  }

  // Reorder request PDF
  function generateReorderPdf(rec) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    doc.setFillColor(30, 30, 40)
    doc.rect(0, 0, 210, 297, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18)
    doc.text('REORDER REQUEST', 14, 20)
    doc.setFontSize(11)
    doc.setTextColor(160, 160, 180)
    doc.text(`${appSettings.company_name || 'TyrePulse'} — Stock Report`, 14, 28)
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, 14, 34)

    autoTable(doc, {
      startY: 42,
      head: [['Field', 'Value']],
      body: [
        ['Site',            rec.site],
        ['Description',     rec.description || '—'],
        ['Current Stock',   String(rec.stock_qty)],
        ['Critical Level',  String(rec.critical_level)],
        ['Min Level',       String(rec.min_level)],
        ['Reorder Qty',     String(Math.max(0, (rec.min_level || 5) * 3 - rec.stock_qty))],
        ['Status',          deriveStatus(rec)],
        ['Requested By',    profile?.full_name || profile?.username || '—'],
        ['Date',            new Date().toLocaleDateString('en-GB')],
      ],
      styles: { fillColor: [30, 40, 60], textColor: [220, 220, 240], fontSize: 11 },
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
    })

    doc.save(`reorder-${rec.site.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
  }

  // Exports
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
      r.site, r.description || '—', r.stock_qty, r.min_level, r.critical_level, deriveStatus(r),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Stock Management</h1>
          <p className="text-gray-400 text-sm mt-1">{records.length} sites tracked</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="btn-secondary text-xs flex items-center gap-1.5">
            <Download size={14} /> Excel
          </button>
          <button onClick={exportPdf} className="btn-secondary text-xs flex items-center gap-1.5">
            <FileText size={14} /> PDF
          </button>
          <button onClick={startAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={16} /> Add Stock
          </button>
        </div>
      </div>

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
                {['Site', 'Description', 'Stock', 'Min', 'Critical', 'Reorder Qty', 'Status', 'Action', ''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-500">Loading…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-500">No stock records yet</td></tr>
              ) : records.map(r => {
                const status = deriveStatus(r)
                return (
                  <tr key={r.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="table-cell font-medium text-white">{r.site}</td>
                    <td className="table-cell text-gray-300">{r.description ?? '—'}</td>
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
                    <td className="table-cell text-gray-400 text-xs max-w-xs truncate">{r.management_action ?? '—'}</td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-blue-400 text-xs transition-colors">Edit</button>
                        <button
                          onClick={() => { openHistory(r); setAdjForm({ qty_change: 0, reason: '', movement_type: 'Adjustment', reference_no: '' }) }}
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

      {/* Movement History Modal */}
      {historyFor && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setHistoryFor(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <div>
                <h2 className="text-lg font-semibold text-white">Movement History — {historyFor.site}</h2>
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
                    {saving ? 'Saving…' : 'Log Movement'}
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
                <div className="text-center py-8 text-gray-500">Loading…</div>
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
                            m.movement_type === 'In' || m.movement_type === 'Reorder' ? 'bg-green-900/30 text-green-400' :
                            m.movement_type === 'Out' || m.movement_type === 'Scrap' ? 'bg-red-900/30 text-red-400' :
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
                        <td className="table-cell py-2 text-gray-400">{m.reason || '—'}</td>
                        <td className="table-cell py-2 text-gray-500">{m.reference_no || '—'}</td>
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
                  <Save size={16} /> {saving ? 'Saving…' : 'Save'}
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
