import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { FileText, ChevronRight, Download, ArrowLeft, Printer, Mail } from 'lucide-react'
import { SkeletonTable } from '../components/ui/Skeleton'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { REPORTS_TABS } from '../components/ui/SectionTabs'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { applyCountry } from '../lib/countryFilter'
import { fetchAllPages } from '../lib/fetchAll'
import EmailReportModal from '../components/EmailReportModal'
import { formatDate } from '../lib/formatters'
import { listPmPrograms, listPmServiceRecords } from '../lib/api/pmPrograms'
import { toUserMessage } from '../lib/safeError'

const REPORT_TYPES = [
  { id: 'Vehicle History',       key: 'vehicleHistory',       desc: 'All tyre changes per vehicle, grouped by asset',  table: 'tyre_records' },
  { id: 'Cost Analysis',         key: 'costAnalysis',         desc: 'Spend grouped by site and brand',                  table: 'tyre_records (aggregated)' },
  { id: 'Risk Summary',          key: 'riskSummary',          desc: 'High and Critical risk records',                   table: 'tyre_records filtered' },
  { id: 'Inspection Report',     key: 'inspectionReport',     desc: 'All inspections with findings',                    table: 'inspections' },
  { id: 'Tyre Replacement Log',  key: 'tyreReplacementLog',   desc: 'Chronological replacement list',                   table: 'tyre_records ordered by date' },
  { id: 'Preventive Maintenance', key: 'preventiveMaintenance', desc: 'PM programs with due date, priority and status',   table: 'pm_programs' },
  { id: 'PM Service History',     key: 'pmServiceHistory',      desc: 'Completed PM services with parts and labour cost', table: 'pm_service_records' },
]

// Translate with a safe fallback: translate() returns the raw key path when a
// namespace entry is missing, so callers that add a report type without a
// matching locale entry still render a human label instead of "reports.x.y".
function tOr(t, key, fallback) {
  const s = t(key)
  return s === key ? (fallback ?? key) : s
}

// Human-readable recurring interval for a PM program (e.g. "3 months",
// "10000 km"). Prefers the calendar interval, then the meter interval; empty
// string when neither is defined (honest blank, no fabricated cadence).
function pmIntervalSummary(p) {
  const v = p?.interval_value
  if (v != null && v !== '' && p?.interval_type) return `${v} ${p.interval_type}`
  if (p?.meter_interval != null && p?.meter_interval !== '' && p?.meter_source && p.meter_source !== 'none') {
    const unit = p.meter_source === 'engine_hours' ? 'hours' : 'km'
    return `${p.meter_interval} ${unit}`
  }
  return ''
}

// Looks up the translation key for a REPORT_TYPES.id (used wherever the raw
// reportType string is shown as UI chrome, without altering the id itself).
function reportTypeKeyFor(id) {
  return REPORT_TYPES.find(rt => rt.id === id)?.key
}

const REPORT_COLUMNS = {
  'Vehicle History':      ['asset_no','site','country','count','total_cost','avg_cost','brands','last_date','high_risk_count'],
  'Cost Analysis':        ['site','brand','count','total_cost','avg_cost','country'],
  'Risk Summary':         ['issue_date','asset_no','brand','serial_no','site','risk_level','description'],
  'Inspection Report':    ['inspection_date','asset_no','inspection_type','site','findings','inspector','status'],
  'Tyre Replacement Log': ['issue_date','asset_no','brand','serial_no','qty','cost','site','country'],
  'Preventive Maintenance': ['name','asset_no','asset_category','interval_summary','next_due','next_due_meter','priority','status','assigned_to','site','estimated_cost'],
  'PM Service History':     ['service_date','asset_no','performed_by','workshop','site','outcome','parts_cost','labour_cost','total_cost','work_order_no','next_due','findings'],
}

const COLUMN_LABELS = {
  issue_date: 'Issue Date', asset_no: 'Asset No', brand: 'Brand', description: 'Description',
  serial_no: 'Serial No', site: 'Site', country: 'Country', cost: 'Cost', risk_level: 'Risk Level',
  remarks: 'Remarks', count: 'Count', total_cost: 'Total Cost', avg_cost: 'Avg Cost',
  inspection_date: 'Inspection Date', inspection_type: 'Inspection Type', findings: 'Findings',
  inspector: 'Inspector', status: 'Status', qty: 'Qty',
  brands: 'Brands Used', last_date: 'Last Date', high_risk_count: 'High Risk Count',
  // Preventive Maintenance program columns
  name: 'Program', asset_category: 'Asset Category', interval_summary: 'Interval',
  next_due: 'Next Due', next_due_meter: 'Next Due Meter', priority: 'Priority',
  assigned_to: 'Assigned To', estimated_cost: 'Estimated Cost',
  // PM Service History columns
  service_date: 'Service Date', performed_by: 'Performed By', workshop: 'Workshop',
  outcome: 'Outcome', parts_cost: 'Parts Cost', labour_cost: 'Labour Cost',
  work_order_no: 'Work Order No',
}

// Maps the same column keys to reports.json translation keys, used only for
// on-screen labels (table headers, column picker). Export builders (Excel/
// PDF/email) keep using COLUMN_LABELS as-is, per the i18n spec.
const COLUMN_I18N_KEYS = {
  issue_date: 'issueDate', asset_no: 'assetNo', brand: 'brand', description: 'description',
  serial_no: 'serialNo', site: 'site', country: 'country', cost: 'cost', risk_level: 'riskLevel',
  remarks: 'remarks', count: 'count', total_cost: 'totalCost', avg_cost: 'avgCost',
  inspection_date: 'inspectionDate', inspection_type: 'inspectionType', findings: 'findings',
  inspector: 'inspector', status: 'status', qty: 'qty',
  brands: 'brandsUsed', last_date: 'lastDate', high_risk_count: 'highRiskCount',
}

function columnLabel(t, col) {
  const key = COLUMN_I18N_KEYS[col]
  return key ? t(`reports.columns.${key}`) : (COLUMN_LABELS[col] ?? col)
}

const RISK_LEVELS = ['High', 'Critical']
const COUNTRIES   = ['Saudi Arabia', 'UAE', 'Bahrain', 'Kuwait', 'Oman', 'Qatar']
const PAGE_SIZE   = 100

// Persisted per-report column layout (which columns the user keeps visible).
// Shape: { [reportType]: string[] }. Survives across sessions, independent of
// whether a report has been run yet.
const LAYOUT_KEY = 'reports.layout.v1'

function readColumnLayout(type) {
  try {
    const all = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')
    const cols = all?.[type]
    return Array.isArray(cols) ? cols : null
  } catch { return null }
}

function writeColumnLayout(type, cols) {
  try {
    const all = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')
    all[type] = cols
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(all))
  } catch { /* storage unavailable: layout stays in-memory only */ }
}

// Date-shortcut labels double as internal state values compared in
// applyShortcut(); this map only supplies the translated button text.
const DATE_SHORTCUT_I18N_KEYS = {
  'This Month': 'thisMonth',
  'Last 3 Months': 'last3Months',
  'This Year': 'thisYear',
  'Custom': 'custom',
}

function applyShortcut(label, setDateFrom, setDateTo, setDateShortcut) {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const today = fmt(now)
  if (label === 'This Month') {
    setDateFrom(`${now.getFullYear()}-${pad(now.getMonth()+1)}-01`)
    setDateTo(today)
  } else if (label === 'Last 3 Months') {
    const d = new Date(now)
    d.setMonth(d.getMonth()-3)
    setDateFrom(fmt(d))
    setDateTo(today)
  } else if (label === 'This Year') {
    setDateFrom(`${now.getFullYear()}-01-01`)
    setDateTo(today)
  }
  setDateShortcut(label)
}

export default function Reports() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [step, setStep]               = useState('type')
  const [reportType, setReportType]   = useState('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [dateShortcut, setDateShortcut] = useState('This Month')
  const [filterSite, setFilterSite]   = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [filterAsset, setFilterAsset] = useState('')
  const [filterBrand, setFilterBrand] = useState('')
  const [filterRiskLevels, setFilterRiskLevels] = useState([...RISK_LEVELS])
  const [filterInspType, setFilterInspType] = useState('')
  const [selectedCols, setSelectedCols] = useState([])
  const [allRows, setAllRows]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [siteSuggestions, setSiteSuggestions] = useState([])
  const [previewPage, setPreviewPage] = useState(1)
  const [configRestored, setConfigRestored] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  const previewRows = allRows.slice((previewPage - 1) * PAGE_SIZE, previewPage * PAGE_SIZE)
  const totalPages  = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE))

  useEffect(() => {
    applyShortcut('This Month', setDateFrom, setDateTo, setDateShortcut)
  }, [])

  useEffect(() => {
    async function loadSites() {
      const { data } = await supabase.from('tyre_records').select('site').not('site','is',null).limit(200)
      if (data) {
        const unique = [...new Set(data.map(r => r.site).filter(Boolean))].sort()
        setSiteSuggestions(unique)
      }
    }
    loadSites()
  }, [])

  // Reset preview page when data changes
  useEffect(() => {
    setPreviewPage(1)
  }, [allRows])

  function selectType(type) {
    setReportType(type)
    setConfigRestored(false)
    setError(null)

    const defaults = REPORT_COLUMNS[type] ?? []
    // Column layout is the user's saved "Customize" choice; prefer it, keeping
    // only columns that still exist for this report type.
    const savedLayout = readColumnLayout(type)
    let cols = Array.isArray(savedLayout)
      ? defaults.filter(c => savedLayout.includes(c))
      : defaults

    const saved = localStorage.getItem('report_config_' + type)
    if (saved) {
      try {
        const cfg = JSON.parse(saved)
        if (cfg.dateFrom)         setDateFrom(cfg.dateFrom)
        if (cfg.dateTo)           setDateTo(cfg.dateTo)
        if (cfg.dateShortcut)     setDateShortcut(cfg.dateShortcut)
        if (cfg.filterSite !== undefined)    setFilterSite(cfg.filterSite)
        if (cfg.filterCountry !== undefined) setFilterCountry(cfg.filterCountry)
        if (cfg.filterAsset !== undefined)   setFilterAsset(cfg.filterAsset)
        if (cfg.filterBrand !== undefined)   setFilterBrand(cfg.filterBrand)
        if (Array.isArray(cfg.filterRiskLevels)) setFilterRiskLevels(cfg.filterRiskLevels)
        if (cfg.filterInspType !== undefined) setFilterInspType(cfg.filterInspType)
        // Layout wins over the run-config copy so the Customize choice is stable.
        if (!savedLayout && Array.isArray(cfg.selectedCols)) cols = cfg.selectedCols
        setConfigRestored(true)
      } catch { /* corrupt config: fall back to computed cols */ }
    }

    setSelectedCols(cols.length ? cols : defaults)
    setStep('config')
  }

  function clearSavedConfig() {
    localStorage.removeItem('report_config_' + reportType)
    setConfigRestored(false)
  }

  function persistCols(cols) {
    setSelectedCols(cols)
    if (reportType) writeColumnLayout(reportType, cols)
  }

  function toggleCol(col) {
    const all = REPORT_COLUMNS[reportType] ?? []
    const next = selectedCols.includes(col)
      ? selectedCols.filter(c => c !== col)
      : all.filter(c => selectedCols.includes(c) || c === col) // keep canonical order
    persistCols(next)
  }

  function showAllCols()  { persistCols([...(REPORT_COLUMNS[reportType] ?? [])]) }
  function hideAllCols()  { persistCols([]) }
  function resetCols()    { persistCols([...(REPORT_COLUMNS[reportType] ?? [])]) }

  function toggleRiskLevel(level) {
    setFilterRiskLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    )
  }

  const runQuery = useCallback(async () => {
    // Persist config to localStorage
    localStorage.setItem(
      'report_config_' + reportType,
      JSON.stringify({ dateFrom, dateTo, dateShortcut, filterSite, filterCountry, filterAsset, filterBrand, filterRiskLevels, filterInspType, selectedCols })
    )

    setLoading(true)
    setError(null)
    try {
      let rows = []

      if (reportType === 'Preventive Maintenance') {
        // PM programs are read through the service so a not-yet-migrated table
        // degrades to [] (honest empty state) instead of throwing. The due-date
        // (next_due) is filtered by the wizard date range, mirroring how the
        // other report types scope on their own primary date column.
        const plans = await listPmPrograms({ country: filterCountry || activeCountry, limit: 100000 })
        rows = plans
          .filter(p => !filterSite || String(p.site ?? '').toLowerCase().includes(filterSite.toLowerCase()))
          .filter(p => !dateFrom   || (p.next_due && p.next_due >= dateFrom))
          .filter(p => !dateTo     || (p.next_due && p.next_due <= dateTo))
          .map(p => ({ ...p, interval_summary: pmIntervalSummary(p) }))
      } else if (reportType === 'PM Service History') {
        const records = await listPmServiceRecords({ country: filterCountry || activeCountry, limit: 100000 })
        rows = records
          .filter(r => !filterSite || String(r.site ?? '').toLowerCase().includes(filterSite.toLowerCase()))
          .filter(r => !dateFrom   || (r.service_date && r.service_date >= dateFrom))
          .filter(r => !dateTo     || (r.service_date && r.service_date <= dateTo))
      } else if (reportType === 'Inspection Report') {
        const buildInsp = () => {
          let q = supabase.from('inspections').select('*')
          // scheduled_date is always populated; inspection_date can be null, so
          // filtering/sorting on it would silently drop those inspections.
          if (dateFrom)       q = q.gte('scheduled_date', dateFrom)
          if (dateTo)         q = q.lte('scheduled_date', dateTo)
          if (filterSite)     q = q.ilike('site', `%${filterSite}%`)
          if (filterCountry)  q = q.eq('country', filterCountry)
          if (filterInspType) q = q.eq('inspection_type', filterInspType)
          if (!filterCountry) q = applyCountry(q, activeCountry)
          return q.order('scheduled_date', { ascending: false })
        }
        const { data } = await fetchAllPages((from, to) => buildInsp().range(from, to), { max: 100000 })
        rows = data ?? []
      } else {
        const buildTyre = () => {
          let q = supabase.from('tyre_records').select(
            'issue_date,asset_no,brand,description,serial_no,site,country,cost_per_tyre,qty,risk_level,remarks'
          )
          if (dateFrom)      q = q.gte('issue_date', dateFrom)
          if (dateTo)        q = q.lte('issue_date', dateTo)
          if (filterSite)    q = q.ilike('site', `%${filterSite}%`)
          if (filterCountry) q = q.eq('country', filterCountry)
          if (!filterCountry) q = applyCountry(q, activeCountry)
          if (reportType === 'Vehicle History' && filterAsset)
            q = q.ilike('asset_no', `%${filterAsset}%`)
          if ((reportType === 'Cost Analysis' || reportType === 'Tyre Replacement Log') && filterBrand)
            q = q.ilike('brand', `%${filterBrand}%`)
          if (reportType === 'Risk Summary')
            q = q.in('risk_level', filterRiskLevels.length ? filterRiskLevels : RISK_LEVELS)
          return q.order('issue_date', { ascending: false })
        }
        const { data } = await fetchAllPages((from, to) => buildTyre().range(from, to), { max: 100000 })
        const raw = data ?? []

        if (reportType === 'Vehicle History') {
          const grouped = {}
          raw.forEach(r => {
            const key = r.asset_no ?? 'Unknown'
            if (!grouped[key]) grouped[key] = {
              asset_no: key,
              site: r.site ?? '',
              country: r.country ?? '',
              count: 0,
              total_cost: 0,
              brands: new Set(),
              last_date: '',
              risk_levels: [],
            }
            grouped[key].count += 1
            grouped[key].total_cost += (r.cost_per_tyre ?? 0) * (r.qty ?? 1)
            if (r.brand) grouped[key].brands.add(r.brand)
            if (!grouped[key].last_date || r.issue_date > grouped[key].last_date)
              grouped[key].last_date = r.issue_date
            if (r.risk_level) grouped[key].risk_levels.push(r.risk_level)
          })
          rows = Object.values(grouped).map(g => ({
            asset_no:        g.asset_no,
            site:            g.site,
            country:         g.country,
            count:           g.count,
            total_cost:      Math.round(g.total_cost),
            avg_cost:        g.count > 0 ? Math.round(g.total_cost / g.count) : 0,
            brands:          [...g.brands].join(', '),
            last_date:       g.last_date,
            high_risk_count: g.risk_levels.filter(r => r === 'High' || r === 'Critical').length,
          })).sort((a, b) => b.total_cost - a.total_cost)
        } else if (reportType === 'Cost Analysis') {
          const grouped = {}
          raw.forEach(r => {
            const key = `${r.site ?? ''}|${r.brand ?? ''}`
            if (!grouped[key]) grouped[key] = { site: r.site ?? '', brand: r.brand ?? '', country: r.country ?? '', count: 0, total_cost: 0 }
            grouped[key].count += 1
            grouped[key].total_cost += (r.cost_per_tyre ?? 0) * (r.qty ?? 1)
          })
          rows = Object.values(grouped).map(g => ({
            ...g,
            avg_cost:   g.count > 0 ? Math.round(g.total_cost / g.count) : 0,
            total_cost: Math.round(g.total_cost),
          })).sort((a, b) => b.total_cost - a.total_cost)
        } else {
          rows = raw.map(r => ({
            ...r,
            cost: (r.cost_per_tyre ?? 0) * (r.qty ?? 1),
          }))
        }
      }

      setAllRows(rows)
    } catch (e) {
      setAllRows([])
      setError(toUserMessage(e, 'Could not load this report. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [reportType, dateFrom, dateTo, filterSite, filterCountry, filterAsset, filterBrand,
      filterRiskLevels, filterInspType, activeCountry, selectedCols, dateShortcut])

  function handleExcel() {
    const activeCols = (REPORT_COLUMNS[reportType] ?? []).filter(c => selectedCols.includes(c))
    const headers = activeCols.map(c => COLUMN_LABELS[c] ?? c)
    exportToExcel(
      allRows, activeCols, headers,
      `TyrePulse_${reportType.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}`
    )
  }

  function handlePdf() {
    const activeCols = (REPORT_COLUMNS[reportType] ?? []).filter(c => selectedCols.includes(c))
    const columns = activeCols.map(c => ({ key: c, header: COLUMN_LABELS[c] ?? c }))
    exportToPdf(
      allRows,
      columns,
      `TyrePulse · ${reportType}`,
      `TyrePulse_${reportType.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}`,
      'landscape',
      '',
      { currency: activeCurrency },
    )
  }

  function handlePrint() {
    const printContent = document.querySelector('#report-preview-table')
    if (!printContent) { window.print(); return }
    const win = window.open('', '_blank')
    win.document.write(
      `<html><head><title>TyrePulse Report · ${reportType}</title>` +
      `<style>body{font-family:sans-serif;margin:16px}h2{margin-bottom:12px;font-size:14px}` +
      `table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;font-size:12px}` +
      `th{background:#f0f0f0;font-weight:600;text-align:left}</style></head>` +
      `<body><h2>TyrePulse · ${reportType} · ${formatDate(new Date())}</h2>` +
      `${printContent.outerHTML}</body></html>`
    )
    win.document.close()
    win.print()
  }

  const displayCols = (REPORT_COLUMNS[reportType] ?? []).filter(c => selectedCols.includes(c))

  const rangeStart = allRows.length === 0 ? 0 : (previewPage - 1) * PAGE_SIZE + 1
  const rangeEnd   = Math.min(previewPage * PAGE_SIZE, allRows.length)

  return (
    <div className="space-y-6">
      <SectionTabs tabs={REPORTS_TABS} />
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        icon={FileText}
      />

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {['type', 'config', 'preview'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={14} className="text-muted" />}
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.06 }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                step === s
                  ? 'bg-brand-subtle text-brand-bright border-[rgba(22,163,74,0.25)]'
                  : ['type','config','preview'].indexOf(step) > i
                    ? 'text-muted border-[var(--border-dim)]'
                    : 'text-dim border-transparent'
              }`}
            >
              {i + 1}. {t(`reports.steps.${s}`)}
            </motion.span>
          </div>
        ))}
      </div>

      {/* Step 1: Report type selector */}
      {step === 'type' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {REPORT_TYPES.map(rt => (
            <button
              key={rt.id}
              onClick={() => selectType(rt.id)}
              className="card text-left hover:border-green-600/40 transition-all group"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.2)' }}>
                  <FileText size={16} className="text-green-400" />
                </div>
                <div>
                  <p className="text-[var(--text-primary)] font-semibold group-hover:text-green-400 transition-colors">{tOr(t, `reports.reportTypes.${rt.key}.label`, rt.id)}</p>
                  <p className="text-gray-400 text-sm mt-0.5">{tOr(t, `reports.reportTypes.${rt.key}.desc`, rt.desc)}</p>
                  <p className="text-gray-600 text-xs mt-1">{t('reports.source', { table: rt.table })}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Filters + Column picker */}
      {step === 'config' && (
        <div className="space-y-5">
          {/* Saved config banner */}
          {configRestored && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-lg text-sm"
              style={{ background: 'rgba(22,163,74,0.10)', border: '1px solid rgba(22,163,74,0.25)' }}>
              <span className="text-green-400 font-medium">{t('reports.config.savedRestored')}</span>
              <button
                onClick={clearSavedConfig}
                className="ml-auto text-xs text-gray-400 hover:text-white underline underline-offset-2 transition-colors"
              >
                {t('reports.config.clearSaved')}
              </button>
            </div>
          )}

          <div className="card space-y-4">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('reports.config.filtersTitle', { reportType: reportTypeKeyFor(reportType) ? tOr(t, `reports.reportTypes.${reportTypeKeyFor(reportType)}.label`, reportType) : reportType })}
            </h2>

            {/* Date shortcut chips */}
            <div>
              <label className="label">{t('reports.config.dateRange')}</label>
              <div className="flex gap-2 flex-wrap mb-2">
                {['This Month', 'Last 3 Months', 'This Year', 'Custom'].map(lbl => (
                  <button
                    key={lbl}
                    onClick={() => lbl !== 'Custom' ? applyShortcut(lbl, setDateFrom, setDateTo, setDateShortcut) : setDateShortcut('Custom')}
                    className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                      dateShortcut === lbl
                        ? 'border-green-600 text-green-400'
                        : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                    }`}
                    style={dateShortcut === lbl ? { backgroundColor: 'rgba(22,163,74,0.08)' } : {}}
                  >
                    {t(`reports.dateShortcuts.${DATE_SHORTCUT_I18N_KEYS[lbl]}`)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" className="input w-36 text-sm" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDateShortcut('Custom') }} />
                <span className="text-gray-600">{t('reports.config.to')}</span>
                <input type="date" className="input w-36 text-sm" value={dateTo} onChange={e => { setDateTo(e.target.value); setDateShortcut('Custom') }} />
              </div>
            </div>

            {/* Common filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">{t('reports.config.site')}</label>
                <input
                  list="site-list"
                  className="input w-full"
                  placeholder={t('reports.config.siteFilterPlaceholder')}
                  value={filterSite}
                  onChange={e => setFilterSite(e.target.value)}
                />
                <datalist id="site-list">
                  {siteSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="label">{t('reports.config.country')}</label>
                <select className="input w-full" value={filterCountry} onChange={e => setFilterCountry(e.target.value)}>
                  <option value="">{t('reports.config.allCountries')}</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {/* Type-specific filters */}
            {reportType === 'Vehicle History' && (
              <div>
                <label className="label">{t('reports.config.assetNumber')}</label>
                <input className="input w-full" placeholder={t('reports.config.assetNoPlaceholder')} value={filterAsset} onChange={e => setFilterAsset(e.target.value)} />
              </div>
            )}

            {(reportType === 'Cost Analysis' || reportType === 'Tyre Replacement Log') && (
              <div>
                <label className="label">{t('reports.config.brand')}</label>
                <input className="input w-full" placeholder={t('reports.config.brandFilterPlaceholder')} value={filterBrand} onChange={e => setFilterBrand(e.target.value)} />
              </div>
            )}

            {reportType === 'Risk Summary' && (
              <div>
                <label className="label">{t('reports.config.riskLevel')}</label>
                <div className="flex gap-3 flex-wrap">
                  {RISK_LEVELS.map(level => (
                    <label key={level} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterRiskLevels.includes(level)}
                        onChange={() => toggleRiskLevel(level)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-300">{level}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {reportType === 'Inspection Report' && (
              <div>
                <label className="label">{t('reports.config.inspectionType')}</label>
                <select className="input w-full" value={filterInspType} onChange={e => setFilterInspType(e.target.value)}>
                  <option value="">{t('reports.config.allTypes')}</option>
                  <option value="Routine">Routine</option>
                  <option value="Safety">Safety</option>
                  <option value="Pre-trip">Pre-trip</option>
                  <option value="Post-trip">Post-trip</option>
                </select>
              </div>
            )}
          </div>

          {/* Column picker (Customize) */}
          <div className="card space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('reports.config.columnsTitle')}</h2>
              <span className="text-xs text-gray-500">
                {selectedCols.length} / {(REPORT_COLUMNS[reportType] ?? []).length}
              </span>
              <div className="ml-auto flex items-center gap-3 text-xs">
                <button onClick={showAllCols} className="text-gray-400 hover:text-white underline underline-offset-2 transition-colors">All</button>
                <button onClick={hideAllCols} className="text-gray-400 hover:text-white underline underline-offset-2 transition-colors">None</button>
                <button onClick={resetCols} className="text-gray-400 hover:text-white underline underline-offset-2 transition-colors">Reset</button>
              </div>
            </div>
            <p className="text-xs text-gray-500">Your column choice is saved for this report and applied to the table, Excel and PDF.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(REPORT_COLUMNS[reportType] ?? []).map(col => (
                <label key={col} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCols.includes(col)}
                    onChange={() => toggleCol(col)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-300">{columnLabel(t, col)}</span>
                </label>
              ))}
            </div>
            {selectedCols.length === 0 && (
              <p className="text-xs text-amber-400/90">Select at least one column to show data in the report.</p>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep('type')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft size={14} /> {t('reports.config.back')}
            </button>
            <button
              onClick={() => { runQuery(); setStep('preview') }}
              disabled={selectedCols.length === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('reports.config.runReport')} <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview + Export */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => setStep('config')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft size={14} /> {t('reports.preview.backToFilters')}
            </button>
            <button onClick={handleExcel} disabled={allRows.length === 0} className="btn-secondary flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Download size={14} className="text-green-400" /> {t('reports.preview.exportExcel')}
            </button>
            <button onClick={handlePdf} disabled={allRows.length === 0} className="btn-secondary flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Download size={14} className="text-red-400" /> {t('reports.preview.exportPdf')}
            </button>
            <button onClick={handlePrint} disabled={allRows.length === 0} className="btn-secondary flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
              <Printer size={14} className="text-blue-400" /> {t('reports.preview.print')}
            </button>
            <button
              onClick={() => setEmailModalOpen(true)}
              disabled={allRows.length === 0}
              className="btn-secondary flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Mail size={16} />{t('reports.preview.emailReport')}
            </button>
          </div>

          {loading ? (
            <SkeletonTable rows={8} cols={6} />
          ) : error ? (
            <div className="card text-center py-12 space-y-3">
              <p className="text-red-300 text-sm">{error}</p>
              <button onClick={runQuery} className="btn-secondary text-sm">{t('reports.config.runReport')}</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm text-gray-400">
                  {t('reports.preview.totalRecords', { count: allRows.length.toLocaleString() })}
                </span>
                {allRows.length > PAGE_SIZE && (
                  <span className="text-xs text-gray-500">
                    {t('reports.preview.showingRange', { from: rangeStart, to: rangeEnd, total: allRows.length.toLocaleString() })}
                  </span>
                )}
              </div>

              {previewRows.length === 0 ? (
                <div className="card text-center py-12 text-gray-500">
                  {t('reports.preview.noRecordsForFilters')}
                </div>
              ) : (
                <>
                  <div className="card overflow-x-auto">
                    <table id="report-preview-table" className="w-full text-sm">
                      <thead>
                        <tr>
                          {displayCols.map(col => (
                            <th key={col} className="table-header text-left whitespace-nowrap">
                              {columnLabel(t, col)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                            {displayCols.map(col => (
                              <td key={col} className="table-cell whitespace-nowrap max-w-48 truncate">
                                {col === 'risk_level' && row[col] ? (
                                  <span className={`badge text-xs ${
                                    row[col] === 'Critical' ? 'bg-red-900/50 text-red-300' :
                                    row[col] === 'High' ? 'bg-orange-900/50 text-orange-300' :
                                    row[col] === 'Medium' ? 'bg-yellow-900/50 text-yellow-300' :
                                    'bg-green-900/50 text-green-300'
                                  }`}>{row[col]}</span>
                                ) : (
                                  row[col] ?? '-'
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination controls */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <span className="text-xs text-gray-500">
                        {t('reports.preview.showingRange', { from: rangeStart, to: rangeEnd, total: allRows.length.toLocaleString() })}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                          disabled={previewPage === 1}
                          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t('reports.preview.prev')}
                        </button>
                        <span className="text-sm text-gray-400 px-1">
                          {t('reports.preview.pageOf', { page: previewPage, total: totalPages })}
                        </span>
                        <button
                          onClick={() => setPreviewPage(p => Math.min(totalPages, p + 1))}
                          disabled={previewPage === totalPages}
                          className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t('reports.preview.next')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle={reportType ? `${reportType} Report` : 'Custom Report'}
        pdfColumns={displayCols.map(c => COLUMN_LABELS[c] ?? c)}
        pdfRows={allRows.slice(0, 5000).map(row => displayCols.map(c => row[c] ?? ''))}
        kpiSummary={{
          'Report Type':    reportType || '-',
          'Total Records':  allRows.length.toLocaleString(),
          'Date From':      dateFrom || '-',
          'Date To':        dateTo || '-',
          'Site Filter':    filterSite || 'All',
          'Country Filter': filterCountry || 'All',
        }}
        period={dateShortcut || (dateFrom && dateTo ? `${dateFrom} - ${dateTo}` : 'All Time')}
      />
    </div>
  )
}
