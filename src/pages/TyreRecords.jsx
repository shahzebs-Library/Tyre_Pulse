import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useVirtualizer } from '@tanstack/react-virtual'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { applyCountry } from '../lib/countryFilter'
import { ALL_CATEGORY_LABELS } from '../lib/tyreClassifier'
import { formatCurrencyCompact } from '../lib/formatters'
import { useInvalidate } from '../hooks/useSupabaseQuery'
import { useBulkSelect } from '../hooks/useBulkSelect'
import BulkActionBar from '../components/BulkActionBar'
import {
  Search, ChevronLeft, ChevronRight, Eye, FileSpreadsheet,
  FileText, Plus, Edit2, Trash2, Save, X, Check, AlertTriangle,
  CircleDot, Loader2, Download,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import FilterBar from '../components/ui/FilterBar'
import { cn } from '../lib/cn'

const PAGE_SIZE = 25

// WCAG AA–compliant on light (white/off-white) backgrounds
const RISK_STYLE = {
  Critical: 'bg-red-100 text-red-700 border-red-200',
  High:     'bg-orange-100 text-orange-700 border-orange-200',
  Medium:   'bg-amber-100 text-amber-700 border-amber-200',
  Low:      'bg-green-100 text-green-700 border-green-200',
}

const EMPTY_FORM = (defaultCost = 1200, country = 'KSA') => ({
  sr: '', issue_date: '', description: '', brand: '', serial_no: '',
  qty: 1, job_card: '', mis_number: '', asset_no: '', site: '', country,
  remarks: '', cost_per_tyre: defaultCost, risk_level: '', category: '',
  km_at_fitment: '', km_at_removal: '',
})

const EMPTY_BULK = { site: '', brand: '', cost_per_tyre: '', risk_level: '', category: '' }

// Column definitions for the virtual grid — widths must sum to 100% or use fixed px
const COL_WIDTHS = [40, 96, 110, 130, 96, 100, 100, 100, 88, 88, 72, 80]

export default function TyreRecords() {
  const { profile } = useAuth()
  const { activeCountry, activeCurrency } = useSettings()
  const invalidate = useInvalidate()

  const [records, setRecords]         = useState([])
  const [total, setTotal]             = useState(0)
  const [page, setPage]               = useState(0)
  const [loading, setLoading]         = useState(true)
  const [sites, setSites]             = useState([])
  const [brands, setBrands]           = useState([])

  const [search, setSearch]           = useState('')
  const [siteFilter, setSiteFilter]   = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [riskFilter, setRiskFilter]   = useState('')

  const [detailRecord, setDetailRecord]   = useState(null)
  const [editRecord, setEditRecord]       = useState(null)
  const [showBulkEdit, setShowBulkEdit]   = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [saving, setSaving]               = useState(false)
  const [formError, setFormError]         = useState('')
  const [form, setForm]                   = useState(() => EMPTY_FORM())
  const [bulkForm, setBulkForm]           = useState(EMPTY_BULK)

  // Bulk selection — driven by the current page's records
  const {
    selected,
    selectedRows,
    toggle,
    toggleAll,
    clear,
    isSelected,
    isAllSelected,
    isSomeSelected,
    count: bulkCount,
  } = useBulkSelect(records, 'id')

  // Virtual scroll ref for the tbody scroll container
  const parentRef = useRef(null)

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
    q = applyCountry(q, activeCountry)

    const { data, count } = await q
    setRecords(data ?? [])
    setTotal(count ?? 0)
    clear()
    setLoading(false)
  }, [page, search, siteFilter, brandFilter, riskFilter, activeCountry])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Virtualizer for the current page's records
  const rowVirtualizer = useVirtualizer({
    count: loading ? 8 : records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  })

  function openAdd() {
    // Cost is left blank so the user enters the ACTUAL cost — no settings default
    // is written into a record.
    setForm(EMPTY_FORM('', activeCountry !== 'All' ? activeCountry : 'KSA'))
    setEditRecord({})
    setFormError('')
  }

  function openEdit(r) {
    setForm({
      sr: r.sr ?? '', issue_date: r.issue_date ?? '', description: r.description ?? '',
      brand: r.brand ?? '', serial_no: r.serial_no ?? '', qty: r.qty ?? 1,
      job_card: r.job_card ?? '', mis_number: r.mis_number ?? '', asset_no: r.asset_no ?? '',
      site: r.site ?? '', country: r.country ?? 'KSA', remarks: r.remarks ?? '',
      cost_per_tyre: r.cost_per_tyre ?? '',
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
      // Store the actual entered cost, or null when left blank — never a default.
      cost_per_tyre: form.cost_per_tyre !== '' && form.cost_per_tyre != null ? +form.cost_per_tyre : null,
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

  async function saveBulkEdit(e) {
    e.preventDefault()
    setSaving(true)
    const patch = {}
    if (bulkForm.site)          patch.site          = bulkForm.site
    if (bulkForm.brand)         patch.brand         = bulkForm.brand
    if (bulkForm.cost_per_tyre) patch.cost_per_tyre = +bulkForm.cost_per_tyre
    if (bulkForm.risk_level)    patch.risk_level    = bulkForm.risk_level
    if (bulkForm.category)      patch.category      = bulkForm.category

    if (Object.keys(patch).length === 0) { setSaving(false); setShowBulkEdit(false); return }

    const ids = [...selected]
    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
      await supabase.from('tyre_records').update(patch).in('id', ids.slice(i, i + BATCH))
    }
    setShowBulkEdit(false)
    setBulkForm(EMPTY_BULK)
    clear()
    loadRecords()
    setSaving(false)
  }

  async function deleteSelected() {
    setSaving(true)
    const ids = [...selected]
    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
      await supabase.from('tyre_records').delete().in('id', ids.slice(i, i + BATCH))
    }
    setShowDeleteConfirm(false)
    clear()
    loadRecords()
    loadFilters()
    setSaving(false)
  }

  async function handleBulkExport(rows) {
    const headers = ['Issue Date', 'Asset No', 'Serial No', 'Brand', 'Site', 'MIS No', 'Job Card', 'Risk Level', 'Cost', 'Category', 'Remarks']
    const csv = [
      headers.join(','),
      ...rows.map(r => [
        r.issue_date ?? '',
        r.asset_no ?? '',
        r.serial_no ?? '',
        r.brand ?? '',
        r.site ?? '',
        r.mis_number ?? '',
        r.job_card ?? '',
        r.risk_level ?? '',
        r.cost_per_tyre ?? '',
        r.category ?? '',
        r.remarks ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tyres_export_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    clear()
  }

  async function handleBulkScrap(rows) {
    if (!window.confirm(`Mark ${rows.length} tyre record${rows.length !== 1 ? 's' : ''} as Scrapped? This cannot be undone.`)) return
    const ids = rows.map(r => r.id)
    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
      await supabase.from('tyre_records').update({ status: 'Scrapped' }).in('id', ids.slice(i, i + BATCH))
    }
    invalidate(['tyres'])
    loadRecords()
    clear()
  }

  const EXPORT_COLS = [
    { key: 'issue_date',    header: 'Date',                  width: 22 },
    { key: 'asset_no',      header: 'Asset No',              width: 26 },
    { key: 'serial_no',     header: 'Serial No',             width: 30 },
    { key: 'brand',         header: 'Brand',                 width: 24 },
    { key: 'site',          header: 'Site',                  width: 28 },
    { key: 'mis_number',    header: 'MIS No',                width: 24 },
    { key: 'job_card',      header: 'Job Card',              width: 24 },
    { key: 'category',      header: 'Category',              width: 30 },
    { key: 'risk_level',    header: 'Risk Level',            width: 20 },
    { key: 'cost_per_tyre', header: `Cost (${activeCurrency})`, width: 20 },
    { key: 'remarks_cleaned', header: 'Remarks',             width: 40 },
  ]

  async function fetchAll() {
    let q = supabase.from('tyre_records').select('*').order('issue_date', { ascending: false })
    if (search)      q = q.or(`asset_no.ilike.%${search}%,serial_no.ilike.%${search}%,mis_number.ilike.%${search}%,job_card.ilike.%${search}%`)
    if (siteFilter)  q = q.eq('site', siteFilter)
    if (brandFilter) q = q.eq('brand', brandFilter)
    if (riskFilter)  q = q.eq('risk_level', riskFilter)
    q = applyCountry(q, activeCountry)
    const { data } = await q
    return data ?? []
  }

  function F(field) { return e => setForm(f => ({ ...f, [field]: e.target.value })) }

  // Shared column header style — mirrors the virtual row grid
  const headerGridStyle = {
    display: 'grid',
    gridTemplateColumns: COL_WIDTHS.map(w => `${w}px`).join(' '),
    alignItems: 'center',
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tyre Records"
        subtitle={`${total.toLocaleString()} total records`}
        icon={CircleDot}
        actions={
          <div className="flex gap-2">
            <button
              onClick={async () => exportToExcel(await fetchAll(), EXPORT_COLS.map(c => c.key), EXPORT_COLS.map(c => c.header), `TyrePulse_Records_${new Date().toISOString().slice(0,10)}`, 'Tyre Records')}
              className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5"
            >
              <FileSpreadsheet size={14} className="text-green-400" /> Excel
            </button>
            <button
              onClick={async () => exportToPdf(await fetchAll(), EXPORT_COLS, `Tyre Records · ${total.toLocaleString()} records`, `TyrePulse_Records_${new Date().toISOString().slice(0,10)}`)}
              className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5"
            >
              <FileText size={14} className="text-red-400" /> PDF
            </button>
            <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm px-4">
              <Plus size={15} /> New Record
            </button>
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearch={v => { setSearch(v); setPage(0) }}
        placeholder="Search asset, serial, MIS, job card…"
        selects={[
          { value: siteFilter,  onChange: v => { setSiteFilter(v); setPage(0) },  placeholder: 'All Sites',       options: sites.map(s  => ({ value: s, label: s })) },
          { value: brandFilter, onChange: v => { setBrandFilter(v); setPage(0) }, placeholder: 'All Brands',      options: brands.map(b => ({ value: b, label: b })) },
          { value: riskFilter,  onChange: v => { setRiskFilter(v); setPage(0) },  placeholder: 'All Risk Levels', options: ['Critical','High','Medium','Low'].map(r => ({ value: r, label: r })) },
        ]}
      />

      {/* Table */}
      <div className="rounded-2xl border border-[var(--border-dim)] overflow-hidden">
        <div className="overflow-x-auto">
          {/* Sticky header row */}
          <div className="bg-surface-2 border-b border-[var(--border-dim)] px-0" style={{ minWidth: `${COL_WIDTHS.reduce((a, b) => a + b, 0)}px` }}>
            <div style={headerGridStyle} className="px-0">
              {/* Checkbox header */}
              <div className="px-4 py-3 flex items-center">
                <div
                  onClick={toggleAll}
                  className={cn(
                    'w-4 h-4 rounded border transition-all flex items-center justify-center cursor-pointer',
                    isAllSelected ? 'bg-brand border-brand' : 'border-[var(--border-dim)] hover:border-brand/40'
                  )}
                  ref={el => { if (el) el.dataset.indeterminate = isSomeSelected ? 'true' : 'false' }}
                >
                  {isAllSelected && <Check size={10} className="text-white" />}
                  {isSomeSelected && !isAllSelected && <div className="w-2 h-0.5 bg-orange-400 rounded-full" />}
                </div>
              </div>
              {['Date','Asset No','Serial No','Brand','Site','MIS No','Job Card','Risk','Cost','CPK',''].map(h => (
                <div key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wider whitespace-nowrap">{h}</div>
              ))}
            </div>
          </div>

          {/* Virtualised body */}
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ height: '520px', minWidth: `${COL_WIDTHS.reduce((a, b) => a + b, 0)}px` }}
          >
            {loading ? (
              // Skeleton rows — not virtualised (only 8 items, short-lived)
              <div>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={`sk-${i}`}
                    className="border-b border-[var(--border-subtle)]"
                    style={{ ...headerGridStyle, height: 52 }}
                  >
                    <div className="px-4"><div className="w-4 h-4 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-20 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-24 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-28 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-16 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-20 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-18 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-18 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-5 w-16 rounded-full bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-16 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="h-3 w-12 rounded bg-gray-800/40 animate-pulse" /></div>
                    <div className="px-4"><div className="flex gap-2"><div className="w-7 h-7 rounded-lg bg-gray-800/40 animate-pulse" /><div className="w-7 h-7 rounded-lg bg-gray-800/40 animate-pulse" /></div></div>
                  </div>
                ))}
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center gap-3 text-muted py-16">
                <CircleDot className="w-8 h-8 opacity-20" />
                <span className="text-sm">No records found</span>
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map(virtualRow => {
                  const r = records[virtualRow.index]
                  const rowSelected = isSelected(r.id)
                  const cpk = r.cost_per_tyre != null && r.km_at_fitment && r.km_at_removal && r.km_at_removal > r.km_at_fitment
                    ? (Number(r.cost_per_tyre) / (r.km_at_removal - r.km_at_fitment)).toFixed(3)
                    : null

                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        height: `${virtualRow.size}px`,
                        ...headerGridStyle,
                      }}
                      className={cn(
                        'border-b border-[var(--border-subtle)] transition-colors cursor-default',
                        rowSelected ? 'bg-[rgba(22,163,74,0.06)]' : 'bg-surface-0 hover:bg-surface-1'
                      )}
                    >
                      {/* Checkbox */}
                      <div className="px-4" onClick={() => toggle(r.id)}>
                        <div className={cn(
                          'w-4 h-4 rounded border transition-all flex items-center justify-center cursor-pointer',
                          rowSelected ? 'bg-brand border-brand' : 'border-[var(--border-dim)] hover:border-brand/40'
                        )}>
                          {rowSelected && <Check size={10} className="text-white" />}
                        </div>
                      </div>

                      {/* Date */}
                      <div className="px-4 text-muted text-xs tabular-nums truncate">{r.issue_date ?? '—'}</div>

                      {/* Asset No */}
                      <div className="px-4 font-semibold text-white text-sm truncate">{r.asset_no ?? '—'}</div>

                      {/* Serial No */}
                      <div className="px-4 text-gray-400 text-xs font-mono truncate">{r.serial_no ?? '—'}</div>

                      {/* Brand */}
                      <div className="px-4 text-gray-300 text-sm truncate">{r.brand ?? '—'}</div>

                      {/* Site */}
                      <div className="px-4 text-gray-400 text-sm truncate">{r.site ?? '—'}</div>

                      {/* MIS No */}
                      <div className="px-4 text-gray-400 text-xs truncate">{r.mis_number ?? '—'}</div>

                      {/* Job Card */}
                      <div className="px-4 text-gray-400 text-xs truncate">{r.job_card ?? '—'}</div>

                      {/* Risk */}
                      <div className="px-4">
                        {r.risk_level
                          ? <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium border', RISK_STYLE[r.risk_level] ?? 'bg-surface-3 text-muted border-[var(--border-dim)]')}>{r.risk_level}</span>
                          : <span className="text-muted">—</span>}
                      </div>

                      {/* Cost */}
                      <div className="px-4 text-gray-300 text-xs tabular-nums">
                        {r.cost_per_tyre != null ? formatCurrencyCompact(r.cost_per_tyre, activeCurrency) : <span className="text-muted">—</span>}
                      </div>

                      {/* CPK */}
                      <div className="px-4 text-xs tabular-nums">
                        {cpk
                          ? <span className="text-brand-bright">{cpk}</span>
                          : <span className="text-muted">N/A</span>}
                      </div>

                      {/* Actions */}
                      <div className="px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setDetailRecord(r)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-brand-bright hover:bg-[rgba(22,163,74,0.10)] transition-all"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => openEdit(r)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-yellow-400 hover:bg-yellow-500/10 transition-all"
                          >
                            <Edit2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 bg-surface-1 border-t border-[var(--border-dim)]">
            <p className="text-xs text-muted">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()} records
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-white hover:bg-surface-3 disabled:opacity-30 transition-all"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-muted px-2">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-white hover:bg-surface-3 disabled:opacity-30 transition-all"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      <BulkActionBar
        count={bulkCount}
        onClear={clear}
        entityLabel="record"
        actions={[
          {
            label: 'Bulk Edit',
            icon: Edit2,
            onClick: () => { setBulkForm(EMPTY_BULK); setShowBulkEdit(true) },
          },
          {
            label: 'Export Selected',
            icon: Download,
            onClick: () => handleBulkExport(selectedRows),
          },
          {
            label: 'Mark as Scrapped',
            icon: Trash2,
            variant: 'danger',
            onClick: () => handleBulkScrap(selectedRows),
          },
          {
            label: 'Delete',
            icon: Trash2,
            variant: 'danger',
            onClick: () => setShowDeleteConfirm(true),
          },
        ]}
      />

      {/* Detail modal */}
      {detailRecord && (
        <Modal title="Record Detail" onClose={() => setDetailRecord(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Asset No', detailRecord.asset_no], ['Serial No', detailRecord.serial_no],
              ['Brand', detailRecord.brand], ['Site', detailRecord.site],
              ['Issue Date', detailRecord.issue_date], ['MIS Number', detailRecord.mis_number],
              ['Job Card', detailRecord.job_card], ['Qty', detailRecord.qty],
              ['Risk Level', detailRecord.risk_level], ['Category', detailRecord.category],
              ['Cost', detailRecord.cost_per_tyre ? formatCurrencyCompact(detailRecord.cost_per_tyre, activeCurrency) : null],
              ['Description', detailRecord.description], ['Remarks', detailRecord.remarks],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className={k === 'Description' || k === 'Remarks' ? 'col-span-2' : ''}>
                <dt className="text-muted text-xs mb-0.5">{k}</dt>
                <dd className="text-white font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {detailRecord.extra_fields && Object.keys(detailRecord.extra_fields).length > 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--border-dim)]">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Additional Fields</p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {Object.entries(detailRecord.extra_fields).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted text-xs">{k}</dt>
                    <dd className="text-gray-300 mt-0.5">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--border-dim)]">
            <button onClick={() => { openEdit(detailRecord); setDetailRecord(null) }} className="btn-secondary flex items-center gap-2 text-sm">
              <Edit2 size={14} /> Edit Record
            </button>
          </div>
        </Modal>
      )}

      {/* Add / Edit modal */}
      {editRecord !== null && (
        <Modal title={editRecord.id ? 'Edit Record' : 'New Tyre Record'} onClose={() => setEditRecord(null)} wide>
          {formError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/25 text-red-300 rounded-xl px-4 py-2.5 mb-4 text-sm">
              <AlertTriangle size={14} className="shrink-0" /> {formError}
            </div>
          )}
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
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : 'Save Record'}
              </button>
              <button type="button" onClick={() => setEditRecord(null)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Bulk edit modal */}
      {showBulkEdit && (
        <Modal title={`Bulk Edit · ${bulkCount} records`} onClose={() => setShowBulkEdit(false)}>
          <p className="text-sm text-muted mb-4">Leave blank to keep existing values unchanged.</p>
          <form onSubmit={saveBulkEdit} className="space-y-3">
            <div>
              <label className="label">Change Site</label>
              <input className="input" list="site-list-bulk" value={bulkForm.site} onChange={e => setBulkForm(f => ({ ...f, site: e.target.value }))} placeholder="Leave blank to keep" />
              <datalist id="site-list-bulk">{sites.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="label">Change Brand</label>
              <input className="input" list="brand-list-bulk" value={bulkForm.brand} onChange={e => setBulkForm(f => ({ ...f, brand: e.target.value }))} placeholder="Leave blank to keep" />
              <datalist id="brand-list-bulk">{brands.map(b => <option key={b} value={b} />)}</datalist>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Cost</label><input type="number" className="input" value={bulkForm.cost_per_tyre} onChange={e => setBulkForm(f => ({ ...f, cost_per_tyre: e.target.value }))} placeholder="—" min={0} /></div>
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
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Updating…' : `Update ${bulkCount} Records`}
              </button>
              <button type="button" onClick={() => setShowBulkEdit(false)} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <Modal title="Confirm Delete" onClose={() => setShowDeleteConfirm(false)}>
          <div className="flex gap-3 mb-5 p-4 rounded-xl bg-red-500/8 border border-red-500/20">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-white font-semibold">Delete {bulkCount} record{bulkCount !== 1 ? 's' : ''}?</p>
              <p className="text-muted text-sm mt-1">This action is permanent and cannot be undone.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={deleteSelected} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {saving ? 'Deleting…' : `Delete ${bulkCount} Records`}
            </button>
            <button onClick={() => setShowDeleteConfirm(false)} className="btn-secondary">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'bg-surface-1 border border-[var(--border-dim)] rounded-2xl w-full p-6 my-4 shadow-float',
          wide ? 'max-w-2xl' : 'max-w-lg'
        )}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-white hover:bg-surface-3 transition-all"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}
