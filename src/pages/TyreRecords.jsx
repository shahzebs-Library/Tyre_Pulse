import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { ALL_CATEGORY_LABELS } from '../lib/tyreClassifier'
import {
  Search, ChevronLeft, ChevronRight, Eye, FileSpreadsheet,
  FileText, Plus, Edit2, Trash2, Save, X, Check, AlertTriangle
} from 'lucide-react'

const PAGE_SIZE = 25

const RISK_BADGE = {
  Critical: 'bg-red-900/50 text-red-300',
  High: 'bg-orange-900/50 text-orange-300',
  Medium: 'bg-yellow-900/50 text-yellow-300',
  Low: 'bg-green-900/50 text-green-300',
}

const EMPTY_FORM = (defaultCost = 1200, country = 'KSA') => ({
  sr: '', issue_date: '', description: '', brand: '', serial_no: '',
  qty: 1, job_card: '', mis_number: '', asset_no: '', site: '', country,
  remarks: '', cost_per_tyre: defaultCost, risk_level: '', category: '',
  km_at_fitment: '', km_at_removal: '',
})

const EMPTY_BULK = { site: '', brand: '', cost_per_tyre: '', risk_level: '', category: '' }

export default function TyreRecords() {
  const { profile } = useAuth()
  const { appSettings, activeCountry, activeCurrency } = useSettings()

  // ── data ────────────────────────────────────────────────────────────────────
  const [records, setRecords]         = useState([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(0)
  const [loading, setLoading]         = useState(true)
  const [sites, setSites]             = useState([])
  const [brands, setBrands]           = useState([])

  // ── filters ─────────────────────────────────────────────────────────────────
  const [search, setSearch]           = useState('')
  const [siteFilter, setSiteFilter]   = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [riskFilter, setRiskFilter]   = useState('')

  // ── selection ────────────────────────────────────────────────────────────────
  const [selected, setSelected]       = useState(new Set())

  // ── modals ───────────────────────────────────────────────────────────────────
  const [detailRecord, setDetailRecord]   = useState(null)
  const [editRecord, setEditRecord]       = useState(null)   // null = closed, {} = new, {...} = editing
  const [showBulkEdit, setShowBulkEdit]   = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [formError, setFormError]         = useState('')
  const [form, setForm]                   = useState(() => EMPTY_FORM())
  const [bulkForm, setBulkForm]           = useState(EMPTY_BULK)

  // ── load ────────────────────────────────────────────────────────────────────
  useEffect(() => { loadFilters() }, [])
  useEffect(() => { loadRecords() }, [page, search, siteFilter, brandFilter, riskFilter, activeCountry])

  async function loadFilters() {
    const [sRes, bRes] = await Promise.all([
      supabase.from('tyre_records').select('site').not('site', 'is', null),
      supabase.from('tyre_records').select('brand').not('brand', 'is', null),
    ])
    setSites([...new Set((sRes.data ?? []).map(r => r.site))].sort())
    setBrands([...new Set((bRes.data ?? []).map(r => r.brand))].sort())
  }

  const loadRecords = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('tyre_records')
      .select('*', { count: 'exact' })
      .order('issue_date', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (search) q = q.or(`asset_no.ilike.%${search}%,serial_no.ilike.%${search}%,mis_number.ilike.%${search}%,job_card.ilike.%${search}%`)
    if (siteFilter) q = q.eq('site', siteFilter)
    if (brandFilter) q = q.eq('brand', brandFilter)
    if (riskFilter) q = q.eq('risk_level', riskFilter)
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)

    const { data, count } = await q
    setRecords(data ?? [])
    setTotal(count ?? 0)
    setSelected(new Set())
    setLoading(false)
  }, [page, search, siteFilter, brandFilter, riskFilter, activeCountry])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // ── selection helpers ────────────────────────────────────────────────────────
  const allOnPageSelected = records.length > 0 && records.every(r => selected.has(r.id))

  function toggleSelectAll() {
    if (allOnPageSelected) {
      setSelected(s => { const n = new Set(s); records.forEach(r => n.delete(r.id)); return n })
    } else {
      setSelected(s => { const n = new Set(s); records.forEach(r => n.add(r.id)); return n })
    }
  }

  function toggleRow(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // ── add / edit ───────────────────────────────────────────────────────────────
  function openAdd() {
    setForm(EMPTY_FORM(appSettings.cost_per_tyre, activeCountry !== 'All' ? activeCountry : 'KSA'))
    setEditRecord({})
    setFormError('')
  }

  function openEdit(r) {
    setForm({
      sr: r.sr ?? '', issue_date: r.issue_date ?? '', description: r.description ?? '',
      brand: r.brand ?? '', serial_no: r.serial_no ?? '', qty: r.qty ?? 1,
      job_card: r.job_card ?? '', mis_number: r.mis_number ?? '', asset_no: r.asset_no ?? '',
      site: r.site ?? '', country: r.country ?? 'KSA', remarks: r.remarks ?? '',
      cost_per_tyre: r.cost_per_tyre ?? appSettings.cost_per_tyre,
      risk_level: r.risk_level ?? '', category: r.category ?? '',
      km_at_fitment: r.km_at_fitment ?? '', km_at_removal: r.km_at_removal ?? '',
    })
    setEditRecord(r)
    setFormError('')
  }

  async function saveRecord(e) {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const payload = {
      ...form,
      qty: +form.qty || 1,
      cost_per_tyre: +form.cost_per_tyre || appSettings.cost_per_tyre,
      km_at_fitment: form.km_at_fitment !== '' ? +form.km_at_fitment : null,
      km_at_removal: form.km_at_removal !== '' ? +form.km_at_removal : null,
      country: form.country || 'KSA',
      region: profile?.region ?? 'KSA',
      uploaded_by: profile?.id,
    }
    const { error } = editRecord?.id
      ? await supabase.from('tyre_records').update(payload).eq('id', editRecord.id)
      : await supabase.from('tyre_records').insert(payload)

    if (error) { setFormError(error.message); setSaving(false); return }
    setEditRecord(null)
    loadRecords()
    loadFilters()
    setSaving(false)
  }

  // ── bulk edit ────────────────────────────────────────────────────────────────
  async function saveBulkEdit(e) {
    e.preventDefault()
    setSaving(true)
    const patch = {}
    if (bulkForm.site)         patch.site         = bulkForm.site
    if (bulkForm.brand)        patch.brand        = bulkForm.brand
    if (bulkForm.cost_per_tyre) patch.cost_per_tyre = +bulkForm.cost_per_tyre
    if (bulkForm.risk_level)   patch.risk_level   = bulkForm.risk_level
    if (bulkForm.category)     patch.category     = bulkForm.category

    if (Object.keys(patch).length === 0) { setSaving(false); setShowBulkEdit(false); return }

    const ids = [...selected]
    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH)
      await supabase.from('tyre_records').update(patch).in('id', batch)
    }
    setShowBulkEdit(false)
    setBulkForm(EMPTY_BULK)
    setSelected(new Set())
    loadRecords()
    setSaving(false)
  }

  // ── delete ───────────────────────────────────────────────────────────────────
  async function deleteSelected() {
    setSaving(true)
    const ids = [...selected]
    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
      await supabase.from('tyre_records').delete().in('id', ids.slice(i, i + BATCH))
    }
    setShowDeleteConfirm(false)
    setSelected(new Set())
    loadRecords()
    loadFilters()
    setSaving(false)
  }

  // ── export ───────────────────────────────────────────────────────────────────
  const EXPORT_COLS = [
    { key: 'issue_date', header: 'Date', width: 22 },
    { key: 'asset_no', header: 'Asset No', width: 26 },
    { key: 'serial_no', header: 'Serial No', width: 30 },
    { key: 'brand', header: 'Brand', width: 24 },
    { key: 'site', header: 'Site', width: 28 },
    { key: 'mis_number', header: 'MIS No', width: 24 },
    { key: 'job_card', header: 'Job Card', width: 24 },
    { key: 'category', header: 'Category', width: 30 },
    { key: 'risk_level', header: 'Risk Level', width: 20 },
    { key: 'cost_per_tyre', header: `Cost (${activeCurrency})`, width: 20 },
    { key: 'remarks_cleaned', header: 'Remarks', width: 40 },
  ]

  async function fetchAll() {
    let q = supabase.from('tyre_records').select('*').order('issue_date', { ascending: false })
    if (search) q = q.or(`asset_no.ilike.%${search}%,serial_no.ilike.%${search}%,mis_number.ilike.%${search}%,job_card.ilike.%${search}%`)
    if (siteFilter) q = q.eq('site', siteFilter)
    if (brandFilter) q = q.eq('brand', brandFilter)
    if (riskFilter) q = q.eq('risk_level', riskFilter)
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    const { data } = await q
    return data ?? []
  }

  function F(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Tyre Records</h1>
          <p className="text-gray-400 text-sm mt-1">{total.toLocaleString()} total records</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={15} /> New Record
          </button>
          <button onClick={async () => exportToExcel(await fetchAll(), EXPORT_COLS.map(c => c.key), EXPORT_COLS.map(c => c.header), `TyrePulse_Records_${new Date().toISOString().slice(0,10)}`, 'Tyre Records')} className="btn-secondary flex items-center gap-2 text-sm">
            <FileSpreadsheet size={15} className="text-green-400" /> Excel
          </button>
          <button onClick={async () => exportToPdf(await fetchAll(), EXPORT_COLS, `Tyre Records — ${total.toLocaleString()} records`, `TyrePulse_Records_${new Date().toISOString().slice(0,10)}`)} className="btn-secondary flex items-center gap-2 text-sm">
            <FileText size={15} className="text-red-400" /> PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Search asset, serial, MIS, job card…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }} />
          </div>
          <select className="input w-auto min-w-36" value={siteFilter} onChange={e => { setSiteFilter(e.target.value); setPage(0) }}>
            <option value="">All Sites</option>
            {sites.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-auto min-w-36" value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setPage(0) }}>
            <option value="">All Brands</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="input w-auto min-w-36" value={riskFilter} onChange={e => { setRiskFilter(e.target.value); setPage(0) }}>
            <option value="">All Risk Levels</option>
            {['Critical', 'High', 'Medium', 'Low'].map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header w-10">
                  <input type="checkbox" className="rounded border-gray-600 bg-gray-700"
                    checked={allOnPageSelected} onChange={toggleSelectAll} />
                </th>
                {['Date', 'Asset No', 'Serial No', 'Brand', 'Site', 'MIS No', 'Job Card', 'Risk', 'Cost', 'CPK', ''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="text-center py-12 text-gray-500">Loading…</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-12 text-gray-500">No records found</td></tr>
              ) : records.map(r => (
                <tr key={r.id} className={`transition-colors ${selected.has(r.id) ? 'bg-blue-950/30' : 'hover:bg-gray-800/30'}`}>
                  <td className="table-cell">
                    <input type="checkbox" className="rounded border-gray-600 bg-gray-700"
                      checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
                  </td>
                  <td className="table-cell text-gray-400">{r.issue_date ?? '—'}</td>
                  <td className="table-cell font-medium text-white">{r.asset_no ?? '—'}</td>
                  <td className="table-cell">{r.serial_no ?? '—'}</td>
                  <td className="table-cell">{r.brand ?? '—'}</td>
                  <td className="table-cell">{r.site ?? '—'}</td>
                  <td className="table-cell">{r.mis_number ?? '—'}</td>
                  <td className="table-cell">{r.job_card ?? '—'}</td>
                  <td className="table-cell">
                    {r.risk_level ? <span className={`badge ${RISK_BADGE[r.risk_level] ?? 'bg-gray-800 text-gray-400'}`}>{r.risk_level}</span> : '—'}
                  </td>
                  <td className="table-cell">{activeCurrency} {(r.cost_per_tyre ?? appSettings.cost_per_tyre).toLocaleString()}</td>
                  <td className="table-cell text-gray-400 text-xs">
                    {r.km_at_fitment && r.km_at_removal && r.km_at_removal > r.km_at_fitment
                      ? ((r.cost_per_tyre ?? appSettings.cost_per_tyre) / (r.km_at_removal - r.km_at_fitment)).toFixed(3)
                      : <span className="text-gray-700">N/A</span>}
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setDetailRecord(r)} className="text-gray-400 hover:text-blue-400 transition-colors" title="View"><Eye size={15} /></button>
                      <button onClick={() => openEdit(r)} className="text-gray-400 hover:text-yellow-400 transition-colors" title="Edit"><Edit2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-sm text-gray-400">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="btn-secondary py-1.5 px-3 disabled:opacity-40"><ChevronLeft size={16} /></button>
              <span className="text-sm text-gray-400">Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-secondary py-1.5 px-3 disabled:opacity-40"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {/* ── Bulk action bar ─────────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-800 border border-gray-600 rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-white font-medium">{selected.size} selected</span>
          <div className="w-px h-5 bg-gray-600" />
          <button onClick={() => { setBulkForm(EMPTY_BULK); setShowBulkEdit(true) }}
            className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors">
            <Edit2 size={14} /> Bulk Edit
          </button>
          <button onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 transition-colors">
            <Trash2 size={14} /> Delete
          </button>
          <button onClick={() => setSelected(new Set())}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {/* ── Detail modal ────────────────────────────────────────────────────── */}
      {detailRecord && (
        <Modal title="Record Detail" onClose={() => setDetailRecord(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[['Asset No', detailRecord.asset_no], ['Serial No', detailRecord.serial_no],
              ['Brand', detailRecord.brand], ['Site', detailRecord.site],
              ['Issue Date', detailRecord.issue_date], ['MIS Number', detailRecord.mis_number],
              ['Job Card', detailRecord.job_card], ['Qty', detailRecord.qty],
              ['Risk Level', detailRecord.risk_level], ['Category', detailRecord.category],
              ['Cost', detailRecord.cost_per_tyre ? `${activeCurrency} ${detailRecord.cost_per_tyre}` : null],
              ['Description', detailRecord.description], ['Remarks', detailRecord.remarks],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className={k === 'Description' || k === 'Remarks' ? 'col-span-2' : ''}>
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-gray-200 font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {detailRecord.extra_fields && Object.keys(detailRecord.extra_fields).length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-800">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Additional Fields (from upload)</p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {Object.entries(detailRecord.extra_fields).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-gray-500 text-xs">{k}</dt>
                    <dd className="text-gray-300 mt-0.5">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="flex gap-2 mt-4 pt-4 border-t border-gray-800">
            <button onClick={() => { openEdit(detailRecord); setDetailRecord(null) }} className="btn-secondary flex items-center gap-2 text-sm">
              <Edit2 size={14} /> Edit
            </button>
          </div>
        </Modal>
      )}

      {/* ── Add / Edit modal ─────────────────────────────────────────────────── */}
      {editRecord !== null && (
        <Modal title={editRecord.id ? 'Edit Record' : 'New Tyre Record'} onClose={() => setEditRecord(null)} wide>
          {formError && <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">{formError}</div>}
          <form onSubmit={saveRecord} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Issue Date</label><input type="date" className="input" value={form.issue_date} onChange={F('issue_date')} /></div>
              <div><label className="label">SR / Ref No</label><input className="input" value={form.sr} onChange={F('sr')} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Site</label>
                <input className="input" list="site-list" value={form.site} onChange={F('site')} placeholder="Select or type…" />
                <datalist id="site-list">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">Brand</label>
                <input className="input" list="brand-list" value={form.brand} onChange={F('brand')} placeholder="Select or type…" />
                <datalist id="brand-list">{brands.map(b => <option key={b} value={b} />)}</datalist>
              </div>
            </div>
            <div><label className="label">Description</label><input className="input" value={form.description} onChange={F('description')} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Asset No</label><input className="input" value={form.asset_no} onChange={F('asset_no')} /></div>
              <div><label className="label">Serial No</label><input className="input" value={form.serial_no} onChange={F('serial_no')} /></div>
              <div><label className="label">Qty</label><input type="number" className="input" value={form.qty} onChange={F('qty')} min={1} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">MIS Number</label><input className="input" value={form.mis_number} onChange={F('mis_number')} /></div>
              <div><label className="label">Job Card</label><input className="input" value={form.job_card} onChange={F('job_card')} /></div>
            </div>
            <div><label className="label">Remarks</label><textarea className="input" rows={2} value={form.remarks} onChange={F('remarks')} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Country</label>
                <select className="input" value={form.country} onChange={F('country')}>
                  <option value="KSA">KSA</option>
                  <option value="UAE">UAE</option>
                  <option value="Egypt">Egypt</option>
                </select>
              </div>
              <div><label className="label">KM at Fitment</label><input type="number" className="input" value={form.km_at_fitment} onChange={F('km_at_fitment')} placeholder="Optional" min={0} /></div>
              <div><label className="label">KM at Removal</label><input type="number" className="input" value={form.km_at_removal} onChange={F('km_at_removal')} placeholder="Optional" min={0} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Cost</label><input type="number" className="input" value={form.cost_per_tyre} onChange={F('cost_per_tyre')} min={0} step={100} /></div>
              <div>
                <label className="label">Risk Level</label>
                <select className="input" value={form.risk_level} onChange={F('risk_level')}>
                  <option value="">— None —</option>
                  {['Critical', 'High', 'Medium', 'Low'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={form.category} onChange={F('category')}>
                  <option value="">— None —</option>
                  {ALL_CATEGORY_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <Save size={15} /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditRecord(null)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Bulk edit modal ──────────────────────────────────────────────────── */}
      {showBulkEdit && (
        <Modal title={`Bulk Edit — ${selected.size} records`} onClose={() => setShowBulkEdit(false)}>
          <p className="text-sm text-gray-400 mb-4">Leave a field blank to keep existing values unchanged.</p>
          <form onSubmit={saveBulkEdit} className="space-y-3">
            <div>
              <label className="label">Change Site</label>
              <input className="input" list="site-list-bulk" value={bulkForm.site} onChange={e => setBulkForm(f => ({ ...f, site: e.target.value }))} placeholder="Leave blank to keep existing" />
              <datalist id="site-list-bulk">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="label">Change Brand</label>
              <input className="input" list="brand-list-bulk" value={bulkForm.brand} onChange={e => setBulkForm(f => ({ ...f, brand: e.target.value }))} placeholder="Leave blank to keep existing" />
              <datalist id="brand-list-bulk">{brands.map(b => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Cost (SAR)</label><input type="number" className="input" value={bulkForm.cost_per_tyre} onChange={e => setBulkForm(f => ({ ...f, cost_per_tyre: e.target.value }))} placeholder="—" min={0} /></div>
              <div>
                <label className="label">Risk Level</label>
                <select className="input" value={bulkForm.risk_level} onChange={e => setBulkForm(f => ({ ...f, risk_level: e.target.value }))}>
                  <option value="">— Keep existing —</option>
                  {['Critical', 'High', 'Medium', 'Low'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={bulkForm.category} onChange={e => setBulkForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">— Keep existing —</option>
                  {ALL_CATEGORY_LABELS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                <Save size={15} /> {saving ? 'Updating…' : `Update ${selected.size} Records`}
              </button>
              <button type="button" onClick={() => setShowBulkEdit(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete confirmation ──────────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <Modal title="Delete Records" onClose={() => setShowDeleteConfirm(false)}>
          <div className="flex gap-3 mb-4">
            <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-medium">Delete {selected.size} record{selected.size !== 1 ? 's' : ''}?</p>
              <p className="text-gray-400 text-sm mt-1">This action is permanent and cannot be undone. The records will be removed from the database.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={deleteSelected} disabled={saving} className="btn-danger flex items-center gap-2 disabled:opacity-50">
              <Trash2 size={15} /> {saving ? 'Deleting…' : `Delete ${selected.size} Records`}
            </button>
            <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Shared modal shell ─────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-gray-900 border border-gray-700 rounded-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} p-6 my-4`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
