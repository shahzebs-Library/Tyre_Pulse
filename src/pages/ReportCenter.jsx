/**
 * ReportCenter (route /report-center): generate the fleet's branded reports on
 * demand, see every report the app can produce, the saved layouts, the
 * schedules that deliver them and the delivery log. Rebuilt on the Command
 * Center kit to the owner's mockup.
 *
 * Sources, all real and read under RLS:
 *   - report_tyre_summary RPC + tyre_records + corrective_actions: the four
 *     page-rendered exports (executive deck, daily PDF, tyre Excel / PDF).
 *   - REPORT_TYPES datasets (fetchReportRows): every standard report type,
 *     generated on demand over the selected date range.
 *   - accident_report_templates: saved Report Builder layouts ("templates").
 *   - report_schedules: the Scheduling card (pause / resume in place).
 *   - report_send_log: delivery success, recent deliveries, delivery history.
 *   - audit_log_v2 EXPORT rows: "Generated (30d)". Downloads are recorded from
 *     5 Oct 2026 and the log is readable by Admin / Manager / Director only;
 *     any other reader sees N/A with the reason, never 0.
 *
 * Not stored anywhere, so shown as such: a default output format, delivery
 * method, language and timezone per tenant (the panel shows what each export
 * actually uses), template approval status and a "Customer" report category.
 * Pure shaping lives in src/lib/reportCenterView.js + reportCenterAnalytics.js.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FileText, FileSpreadsheet, Presentation, CalendarClock, Palette, Loader2,
  CheckCircle2, AlertTriangle, X, RefreshCw, Download, Mail, Search, ChevronRight,
  Layers, LayoutTemplate, BarChart3, Truck, Disc3, Wrench, ShieldCheck, ShieldAlert, DollarSign,
  Package, Briefcase, FilePlus2, CalendarPlus, Eye, List, LayoutGrid, Clock3,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { applyCountry } from '../lib/countryFilter'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatDate } from '../lib/formatters'
import { safeImageSrc } from '../lib/safeUrl'
import { exportToPptx, exportToExcel, exportToPdf, exportDailyExecutivePdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import SectionTabs, { REPORTS_TABS } from '../components/ui/SectionTabs'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, KitTable, ViewAll, fmtInt } from '../components/commandCenter/kit'
import {
  summarizeDeliveryLog, filterDeliveryLog, deliveryStatus, recipientCount, DELIVERY_STATUS_LABEL,
} from '../lib/reportCenterAnalytics'
import {
  ON_DEMAND, buildCatalog, categoryCounts, modeFor, lastDelivery, filterCatalog, deliverySuccess, upcomingSchedules,
} from '../lib/reportCenterView'
import {
  REPORT_TYPES, listSchedules, updateSchedule, computeNextRun, listSchedulableLayouts, fetchReportRows,
  isBuilderType, builderTemplateId,
} from '../lib/api/scheduledReports'
import { getTemplate } from '../lib/api/accidentReportTemplates'
import { scheduleLabel } from '../lib/scheduledReportsView'
import { PRESET_KEYS, PRESET_LABELS, activePaletteName } from '../lib/reportColors'
import { RECORDING_START } from '../lib/auditTrailView'
import { toUserMessage } from '../lib/safeError'
import './ReportCenter.css'

// Ceiling on the paged tyre export. Above the live tyre_records count (~11,132)
// so a normal export is complete; if it is ever hit the toast SAYS the file is
// partial rather than handing over a short spreadsheet that looks whole.
const TYRE_EXPORT_CAP = 40000

// fetchReportRows reads one page; the server caps a response at 1000 rows, so a
// result that size may be partial and the toast says so.
const DATASET_ROW_CAP = 1000

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return { date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }
}

const PAGE_ICON = { pptx: Presentation, daily: FileText, excel: FileSpreadsheet, pdf: FileText }
const CATEGORY_ICON = {
  'Fleet and Assets': Truck, 'Tyre Management': Disc3, Workshop: Wrench, Compliance: ShieldCheck,
  'Safety and Claims': ShieldAlert, Finance: DollarSign, 'Inventory and Procurement': Package,
  Executive: Briefcase, 'Custom reports': LayoutTemplate,
}
const CATEGORY_TONE = {
  'Fleet and Assets': 't-blue', 'Tyre Management': 't-purple', Workshop: 't-amber', Compliance: 't-green',
  'Safety and Claims': 't-red', Finance: 't-orange', 'Inventory and Procurement': 't-blue',
  Executive: 't-purple', 'Custom reports': 't-green',
}

// Delivery status: colour plus an icon and a word, never colour alone.
const DELIVERY_META = {
  sent: { tone: 'good', icon: CheckCircle2 },
  failed: { tone: 'bad', icon: AlertTriangle },
  pending: { tone: 'warn', icon: RefreshCw },
  unknown: { tone: 'muted', icon: Mail },
}

// The delivery log shows the most recent sends; the page says so.
const HISTORY_LIMIT = 200

function KpiLabel({ title, sub }) {
  return <>{title}<small className="rc-kpi-sub">{sub}</small></>
}

function DeliveryPill({ row }) {
  const st = deliveryStatus(row)
  const meta = DELIVERY_META[st]
  const Icon = meta.icon
  return <span className={`cc-pill ${meta.tone}`}><Icon size={11} aria-hidden="true" /> {DELIVERY_STATUS_LABEL[st]}</span>
}

export default function ReportCenter() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const { branding, orgName } = useTenant()
  const navigate = useNavigate()

  const now = new Date()
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`)
  const [dateTo, setDateTo]     = useState(fmt(now))
  const [generating, setGenerating] = useState(null)  // report id currently building
  const [toast, setToast]       = useState(null)      // { text, type }
  const [pickerOpen, setPickerOpen] = useState(false)

  const [history, setHistory]   = useState([])
  const [histLoading, setHistLoading] = useState(true)
  const [histError, setHistError] = useState(null)
  const [histStatus, setHistStatus] = useState('')
  const [histType, setHistType] = useState('')
  const [histSearch, setHistSearch] = useState('')

  // Catalogue, layouts, schedules, export count
  const [layouts, setLayouts] = useState({ loading: true, data: null, error: null })
  const [schedules, setSchedules] = useState({ loading: true, data: null, error: null })
  const [exports30, setExports30] = useState({ loading: true, count: null, error: null })
  const [togglingId, setTogglingId] = useState(null)
  const [catSearch, setCatSearch] = useState('')
  const [catCategory, setCatCategory] = useState('')
  const [catFormat, setCatFormat] = useState('')
  const [catMode, setCatMode] = useState('')
  const [catView, setCatView] = useState('list')

  const reportCompany = branding?.legal_name || branding?.display_name || appSettings.company_name || 'TyrePulse'

  const loadLayouts = useCallback(async () => {
    setLayouts((s) => ({ ...s, loading: true, error: null }))
    try { setLayouts({ loading: false, data: await listSchedulableLayouts(), error: null }) }
    catch (e) { setLayouts({ loading: false, data: null, error: toUserMessage(e, 'Could not load saved layouts.') }) }
  }, [])
  const loadSchedules = useCallback(async () => {
    setSchedules((s) => ({ ...s, loading: true, error: null }))
    try { setSchedules({ loading: false, data: await listSchedules(), error: null }) }
    catch (e) { setSchedules({ loading: false, data: null, error: toUserMessage(e, 'Could not load schedules.') }) }
  }, [])
  const loadExports = useCallback(async () => {
    setExports30({ loading: true, count: null, error: null })
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString()
      const { count, error } = await supabase.from('audit_log_v2').select('id', { count: 'exact', head: true })
        .eq('action', 'EXPORT').gte('created_at', since)
      if (error) throw error
      setExports30({ loading: false, count: count ?? 0, error: null })
    } catch (e) {
      setExports30({ loading: false, count: null, error: toUserMessage(e, 'The download log could not be read.') })
    }
  }, [])
  useEffect(() => { loadLayouts(); loadSchedules(); loadExports() }, [loadLayouts, loadSchedules, loadExports])


  // ── Delivery history (scheduled report sends) ──────────────────────────────
  const loadHistory = useCallback(async () => {
    setHistLoading(true); setHistError(null)
    try {
      const { data, error } = await supabase
        .from('report_send_log')
        .select('id,schedule_name,report_type,recipients,status,error,sent_at')
        .order('sent_at', { ascending: false })
        .order('id')
        .limit(HISTORY_LIMIT)
      if (error) throw error
      setHistory(data ?? [])
    } catch (e) {
      setHistError(toUserMessage(e, t('reportcenter.errors.historyLoadFailed')))
    } finally {
      setHistLoading(false)
    }
  }, [t])
  useEffect(() => { loadHistory() }, [loadHistory])

  const histNow = useMemo(() => Date.now(), [history]) // eslint-disable-line react-hooks/exhaustive-deps
  const histSummary = useMemo(() => summarizeDeliveryLog(history, histNow), [history, histNow])
  const histFiltered = useMemo(
    () => filterDeliveryLog(history, { status: histStatus, type: histType, search: histSearch }),
    [history, histStatus, histType, histSearch],
  )
  const histColumns = useMemo(() => [
    { id: 'sent_at', header: 'Sent', accessorFn: (r) => r.sent_at || '', cell: ({ row }) => <span className="rc-nowrap">{row.original.sent_at ? new Date(row.original.sent_at).toLocaleString() : 'N/A'}</span> },
    { id: 'schedule_name', header: 'Schedule', accessorFn: (r) => r.schedule_name || '', cell: ({ getValue }) => <span className="cc-strong">{getValue() || 'N/A'}</span> },
    { id: 'report_type', header: 'Type', accessorFn: (r) => r.report_type || '', meta: { filterVariant: 'select' }, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'recipients', header: 'Recipients', accessorFn: (r) => recipientCount(r), meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : getValue()) },
    {
      id: 'status', header: 'Status', accessorFn: (r) => DELIVERY_STATUS_LABEL[deliveryStatus(r)],
      cell: ({ row }) => (
        <div>
          <DeliveryPill row={row.original} />
          {row.original.error && (
            <span className="rc-err" title={toUserMessage(row.original.error, 'Delivery failed')}>
              {toUserMessage(row.original.error, 'Delivery failed')}
            </span>
          )}
        </div>
      ),
    },
  ], [])

  // ── Shared data fetch for the executive reports ────────────────────────────
  async function fetchExecData() {
    const [{ data: sum, error: sumErr }, actionRes] = await Promise.all([
      supabase.rpc('report_tyre_summary', { p_country: activeCountry, p_from: dateFrom || null, p_to: dateTo || null }),
      supabase.from('corrective_actions').select('title,priority,site,status').eq('status', 'Open').order('created_at', { ascending: false }).limit(20),
    ])
    if (sumErr) throw sumErr
    const s = sum || {}
    const actions = actionRes.data ?? []
    return { s, actions }
  }

  // PAGED. The old `.limit(5000)` returned 1000 rows - the server caps every
  // response at 1000 whatever a limit says - so the Excel export below shipped
  // a 1,000-row spreadsheet that looked like the complete range (KSA alone is
  // past 8,000 tyre rows). `id` is the paging tiebreak; issue_date repeats.
  // A landscape A4 page holds ~30 of these rows, so 200 is already ~7 pages.
  const PDF_ROW_CAP = 200

  async function fetchTyreRows() {
    const { data, error, truncated } = await fetchAllPages(
      (from, to) => applyCountry(
        supabase.from('tyre_records').select('id,issue_date,asset_no,brand,site,category,risk_level,cost_per_tyre'),
        activeCountry,
      ).gte('issue_date', dateFrom || '1900-01-01').lte('issue_date', dateTo || '2999-12-31')
        .order('issue_date', { ascending: false }).order('id').range(from, to),
      { max: TYRE_EXPORT_CAP },
    )
    if (error) throw error
    return { rows: data ?? [], truncated: !!truncated }
  }

  // ── On-demand generation ───────────────────────────────────────────────────
  async function generate(id) {
    if (generating) return
    setGenerating(id); setToast(null)
    const stamp = new Date().toISOString().slice(0, 10)
    let partialExport = false
    try {
      if (id === 'pptx' || id === 'daily') {
        const { s, actions } = await fetchExecData()
        const cur = activeCurrency
        const totalCost = Number(s.total_cost) || 0
        const highRisk  = Number(s.high_risk) || 0
        const critical  = Number(s.critical) || 0
        if (id === 'pptx') {
          const brands = s.top_brands || []
          await exportToPptx({
            totalVehicles: Number(s.distinct_assets) || 0,
            totalTyres: Number(s.total_records) || 0, totalCost, openActions: actions.length, highRisk,
            currency: cur,
            topSites: (s.top_sites || []).map(t => ({ site: t.site, count: t.count })),
            costBySite: (s.cost_by_site || []).map(t => ({ site: t.site, cost: t.cost })),
            categoryBreakdown: (s.category_breakdown || []).map(t => ({ category: t.category, count: t.count })),
            topBrands: brands.map(b => ({ brand: b.brand, count: b.count })),
            riskBreakdown: (s.risk_breakdown || []).map(r => ({ level: r.level, count: r.count })),
            monthlyTrend: (s.monthly_trend || []).map(m => ({ month: m.month, count: m.count })),
            recentActions: actions,
            insights: [
              `Fleet holds ${(s.total_records || 0).toLocaleString()} tyre records across ${(s.top_sites || []).length}+ sites, with ${highRisk} flagged high-risk or critical.`,
              brands[0] ? `${brands[0].brand} is the most-deployed brand (${brands[0].count} records).` : 'Brand distribution unavailable.',
              totalCost > 0 ? `Period tyre spend totals ${cur} ${Math.round(totalCost).toLocaleString()}.` : 'No tyre cost recorded for the period.',
            ],
            recommendations: [
              critical > 0 ? { priority: 'Critical', text: `Replace ${critical} critical tyres before next deployment.` } : null,
              highRisk - critical > 0 ? { priority: 'High', text: `Inspect ${highRisk - critical} high-risk tyres within 7 days.` } : null,
              { priority: 'Low', text: 'Maintain weekly pressure checks and monthly tread measurements fleet-wide.' },
            ].filter(Boolean),
            period: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
            generatedBy: profile?.full_name || profile?.username || 'Fleet Manager',
            company: reportCompany, branding,
          }, `${reportCompany.replace(/\s+/g, '_')}_Executive_${stamp}`)
        } else {
          const criticalTyres = Number(s.critical) || 0
          const totalTyres = Number(s.total_records) || 0
          const goodTyres = Number(s.low) || 0
          await exportDailyExecutivePdf({
            date: formatDate(now, activeCountry, { day: '2-digit', month: 'long', year: 'numeric' }),
            company: reportCompany, reportPeriod: 'Daily', currency: activeCurrency,
            generatedBy: profile?.full_name || profile?.username || 'Fleet Manager',
            site: activeCountry !== 'All' ? activeCountry : 'All Sites',
            totalVehicles: Number(s.distinct_assets) || 0,
            totalTyres, criticalTyres, warningTyres: Number(s.high) || 0, goodTyres,
            pressureCompliance: totalTyres > 0 ? Math.round((goodTyres / totalTyres) * 100) : 0,
            monthlySpend: totalCost, ytdSpend: totalCost,
            criticalAlerts: [], openActions: actions.map(a => ({ title: a.title, priority: a.priority, site: a.site, assignee: 'Unassigned' })),
            topDefects: [], siteBreakdown: (s.site_breakdown || []),
            insights: [
              `Fleet recorded ${totalTyres.toLocaleString()} tyre records with ${criticalTyres} critical cases.`,
              actions.length > 0 ? `${actions.length} corrective actions pending.` : 'No open corrective actions.',
            ],
            recommendations: [
              criticalTyres > 0 ? { priority: 'Critical', text: `${criticalTyres} tyres critical, schedule immediate replacement.` } : null,
              { priority: 'Low', text: 'Maintain weekly pressure checks and monthly tread measurements.' },
            ].filter(Boolean),
            branding,
          }, `${reportCompany.replace(/\s+/g, '_')}_Daily_${stamp}`)
        }
      } else if (id === 'excel') {
        const { rows, truncated } = await fetchTyreRows()
        partialExport = truncated
        if (!rows.length) throw new Error(t('reportcenter.errors.noRecordsInRange'))
        await exportToExcel(
          rows.map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre || 0 })),
          ['issue_date', 'asset_no', 'brand', 'site', 'category', 'risk_level', 'cost_per_tyre'],
          ['Date', 'Asset No', 'Brand', 'Site', 'Category', 'Risk Level', `Cost (${activeCurrency})`],
          `${reportCompany.replace(/\s+/g, '_')}_Tyres_${stamp}`, 'Tyre Records', { company: reportCompany })
      } else if (id === 'pdf') {
        const { rows, truncated } = await fetchTyreRows()
        // The PDF body is bounded at PDF_ROW_CAP because the whole document is
        // built in memory. That cap, not only the 40,000-row fetch cap, has to
        // count as a partial export: an 8,000-row report used to say "Report
        // generated and downloaded" and deliver 200 rows.
        const pdfCapped = rows.length > PDF_ROW_CAP
        partialExport = truncated || pdfCapped
        if (!rows.length) throw new Error(t('reportcenter.errors.noRecordsInRange'))
        await exportToPdf(
          rows.slice(0, PDF_ROW_CAP).map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre || 0 })),
          [{ key: 'issue_date', header: 'Date', width: 24 }, { key: 'asset_no', header: 'Asset No', width: 28 }, { key: 'brand', header: 'Brand', width: 24 }, { key: 'site', header: 'Site', width: 30 }, { key: 'category', header: 'Category', width: 32 }, { key: 'risk_level', header: 'Risk', width: 20 }, { key: 'cost_per_tyre', header: `Cost (${activeCurrency})`, width: 24 }],
          `${reportCompany}: Tyre Records, ${formatDate(now, activeCountry)}`,
          `${reportCompany.replace(/\s+/g, '_')}_Tyres_${stamp}`, 'landscape', reportCompany,
          pdfCapped
            ? { subtitleNote: `of ${rows.length.toLocaleString()} matching records, narrow the date range for the rest` }
            : {})
      }
      setToast({
        text: partialExport
          ? t('reportcenter.toast.successTruncated')
          : t('reportcenter.toast.success'),
        type: partialExport ? 'err' : 'ok',
      })
    } catch (e) {
      console.error(`[ReportCenter] ${id} failed:`, e)
      setToast({ text: t('reportcenter.toast.errorPrefix', { message: toUserMessage(e, t('reportcenter.toast.unexpectedError')) }), type: 'err' })
    } finally {
      setGenerating(null)
    }
  }


  // ── Catalogue report generation (standard types + saved layouts) ──────────
  async function generateEntry(entry, format) {
    if (generating) return
    const key = `${entry.id}:${format}`
    setGenerating(key); setToast(null)
    try {
      const { rows, dataset } = await fetchReportRows(entry.reportType, { from: dateFrom || null, to: dateTo || null, country: activeCountry })
      const range = `${dateFrom || 'start'} to ${dateTo || 'today'}`
      const base = reportFileName(reportCompany, entry.name, reportDateLabel())
      if (format === 'PDF' && isBuilderType(entry.reportType)) {
        const template = await getTemplate(builderTemplateId(entry.reportType))
        const { renderAccidentReportPdf } = await import('../lib/accidentReportPdf')
        await renderAccidentReportPdf({ config: template.config, records: rows, company: reportCompany, currency: activeCurrency, subtitle: range, filename: base })
      } else if (format === 'PDF') {
        await exportToPdf(rows, dataset.cols.map((k, i) => ({ key: k, header: dataset.headers[i] })), `${dataset.title} | ${range}`, base, 'landscape', reportCompany,
          { currency: activeCurrency, branding, dateRange: range, emptyHint: 'No records in the selected date range. Widen the range or clear the country filter.' })
      } else {
        const sheet = dataset.title.replace(/[:\\/?*[\]]/g, '-').slice(0, 28)
        await exportToExcel(rows, dataset.cols, dataset.headers, base, sheet, { title: dataset.title, company: reportCompany, dateRange: range, currency: activeCurrency })
      }
      const capped = rows.length >= DATASET_ROW_CAP
      setToast({
        type: capped ? 'err' : 'ok',
        text: capped
          ? `${entry.name}: ${fmtInt(rows.length)} records exported. The range may hold more; narrow the date range for a complete file.`
          : rows.length ? `${entry.name}: ${fmtInt(rows.length)} records exported.` : `${entry.name}: no records in this range (empty report).`,
      })
    } catch (e) {
      setToast({ type: 'err', text: toUserMessage(e, 'Report generation failed.') })
    } finally {
      setGenerating(null)
    }
  }

  async function toggleSchedule(s) {
    setTogglingId(s.id)
    const next_run_at = !s.active ? computeNextRun(s) : s.next_run_at
    try {
      await updateSchedule(s.id, { active: !s.active, next_run_at })
      setSchedules((st) => ({ ...st, data: (st.data || []).map((x) => (x.id === s.id ? { ...x, active: !s.active, next_run_at } : x)) }))
    } catch (e) {
      setToast({ type: 'err', text: toUserMessage(e, 'Could not update the schedule.') })
    } finally {
      setTogglingId(null)
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const catalog = useMemo(() => buildCatalog(REPORT_TYPES, layouts.data || []), [layouts.data])
  const scheduleRows = useMemo(() => schedules.data || [], [schedules.data])
  const cats = useMemo(() => categoryCounts(catalog), [catalog])
  const shown = useMemo(() => filterCatalog(catalog, { search: catSearch, category: catCategory, format: catFormat, mode: catMode }, scheduleRows),
    [catalog, catSearch, catCategory, catFormat, catMode, scheduleRows])
  const success = useMemo(() => deliverySuccess(history, histNow, 30), [history, histNow])
  const activeSchedules = scheduleRows.filter((s) => s.active).length
  const paletteKey = activePaletteName()
  const paletteLabel = PRESET_LABELS[paletteKey] || (paletteKey ? 'Custom colours' : PRESET_LABELS.vivid)
  const logo = safeImageSrc(branding?.logo_url)
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return null } })()
  const catalogLoading = layouts.loading && !layouts.data

  const kpis = [
    { icon: LayoutTemplate, tone: 't-green', value: layouts.loading ? null : layouts.data?.length, display: layouts.error ? 'N/A' : undefined,
      label: <KpiLabel title="Templates" sub={layouts.error ? 'Saved layouts could not be read' : 'Saved Report Builder layouts'} /> },
    { icon: BarChart3, tone: 't-blue', value: exports30.loading ? null : exports30.count, display: exports30.error ? 'N/A' : undefined,
      title: exports30.error || `Excel, PDF and PowerPoint downloads recorded since ${RECORDING_START}`,
      label: <KpiLabel title="Generated (30d)" sub={exports30.error ? 'Download log not readable for your role' : `Downloads, recorded from ${RECORDING_START}`} /> },
    { icon: CalendarClock, tone: 't-purple', value: schedules.loading ? null : activeSchedules, display: schedules.error ? 'N/A' : undefined, to: '/scheduled-reports',
      label: <KpiLabel title="Scheduled" sub={schedules.error ? 'Schedules could not be read' : `Active of ${fmtInt(scheduleRows.length)} schedules`} /> },
    { icon: Layers, tone: 't-amber', value: PRESET_KEYS.length, label: <KpiLabel title="Report themes" sub={`Active: ${paletteLabel}`} /> },
    { icon: Mail, tone: 't-green', value: histLoading ? null : success.pct, display: histError ? 'N/A' : success.pct == null ? 'N/A' : `${success.pct}%`,
      label: <KpiLabel title="Delivery success" sub={histError ? 'Delivery log could not be read' : success.pct == null ? 'No deliveries in the last 30 days' : `Last 30 days, ${fmtInt(success.sent)} sent, ${fmtInt(success.failed)} failed${history.length >= HISTORY_LIMIT ? ' (latest 200 sends)' : ''}`} /> },
  ]

  const busyFor = (entry, f) => generating === `${entry.id}:${f}` || (entry.kind === 'page' && generating === entry.id)
  const runEntry = (entry, f) => (entry.kind === 'page' ? generate(entry.id) : generateEntry(entry, f))

  const catalogColumns = [
    {
      key: 'name', header: 'Report name', sortValue: (r) => r.name,
      cell: (r) => {
        const Icon = r.kind === 'page' ? PAGE_ICON[r.id] : CATEGORY_ICON[r.category] || FileText
        return <span className="rc-name"><span className={`rc-name-icon ${CATEGORY_TONE[r.category] || 't-blue'}`}><Icon size={14} aria-hidden="true" /></span><span className="rc-name-copy"><b title={r.name}>{r.name}</b><small title={r.desc}>{r.desc}</small></span></span>
      },
    },
    { key: 'category', header: 'Category' },
    { key: 'formats', header: 'Formats', sortable: false, cell: (r) => r.formats.join(', ') },
    { key: 'mode', header: 'Mode', sortValue: (r) => modeFor(r, scheduleRows), cell: (r) => { const m = modeFor(r, scheduleRows); return <span className={`cc-pill ${m === 'Scheduled' ? 'info' : 'muted'}`}>{m}</span> } },
    {
      key: 'last', header: 'Last delivered', sortValue: (r) => lastDelivery(r, history)?.sent_at || '',
      cell: (r) => {
        const d = lastDelivery(r, history)
        if (!d) return <span className="cc-na">{r.kind === 'page' ? 'Not scheduled' : 'No delivery logged'}</span>
        const s = stamp(d.sent_at)
        return <span className="rc-two"><b>{s?.date}</b><small>{deliveryStatus(d) === 'sent' ? 'Sent' : 'Failed'} {s?.time}</small></span>
      },
    },
    {
      key: 'actions', header: 'Generate', sortable: false,
      cell: (r) => (
        <span className="rc-gen" onClick={(e) => e.stopPropagation()} role="presentation">
          {r.formats.map((f) => (
            <button key={f} type="button" className="rc-gen-btn" disabled={Boolean(generating)} onClick={() => runEntry(r, f)} aria-label={`Generate ${r.name} as ${f}`}>
              {busyFor(r, f) ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />} {f}
            </button>
          ))}
        </span>
      ),
    },
  ]

  return (
    <div className="cc rc-page">
      <SectionTabs tabs={REPORTS_TABS} />

      {toast && (
        <div role="status" aria-live="polite" className={`rc-toast ${toast.type}`}>
          {toast.type === 'ok' ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss message" className="rc-toast-x"><X size={13} /></button>
        </div>
      )}

      <header className="rc-head">
        <div className="rc-head-main">
          <span className="rc-head-icon" aria-hidden="true"><FileText size={26} /></span>
          <div className="rc-head-copy">
            <nav aria-label="Breadcrumb" className="rc-crumb">Analytics and Reports <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">{t('reportcenter.title')}</span></nav>
            <h1>{t('reportcenter.title')}</h1>
            <p>Generate branded fleet reports on demand and manage templates, branding and scheduled deliveries.</p>
          </div>
        </div>
        <div className="rc-head-actions">
          <label className="rc-date"><span>{t('reportcenter.filters.from')}</span><input type="date" className="cc-select" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label className="rc-date"><span>{t('reportcenter.filters.to')}</span><input type="date" className="cc-select" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></label>
          <button type="button" className="cc-btn-primary rc-primary" onClick={() => setPickerOpen(true)}><FilePlus2 size={16} aria-hidden="true" /> Generate report</button>
        </div>
      </header>
      <p className="rc-scope">
        {t('reportcenter.filters.scope')} <b>{activeCountry === 'All' ? t('reportcenter.filters.allCountries') : activeCountry}</b>, {t('reportcenter.filters.currency')} <b>{activeCurrency}</b>. Every report below uses this date range and scope.
      </p>

      <div className="cc-kpis rc-kpis">
        {kpis.map((k, i) => <Kpi key={i} {...k} loading={k.value == null && k.display == null} />)}
      </div>

      <div className="rc-top">
        <Card title="Report categories" sub="Every report the app can generate">
          <CardState state={{ loading: catalogLoading, data: catalog, error: null }}>
            <ul className="rc-cats">
              {cats.map((c) => {
                const Icon = CATEGORY_ICON[c.category] || FileText
                const on = catCategory === c.category
                return (
                  <li key={c.category}>
                    <button type="button" aria-pressed={on} onClick={() => setCatCategory(on ? '' : c.category)} disabled={!c.count}>
                      <span className={`rc-cat-icon ${CATEGORY_TONE[c.category]}`}><Icon size={16} aria-hidden="true" /></span>
                      <span className="rc-cat-label">{c.category}</span>
                      <span className="cc-count">{c.count}</span>
                      <ChevronRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
            {layouts.error && <p className="rc-note" role="alert">{layouts.error} <button type="button" className="cc-link cc-link-btn" onClick={loadLayouts}>Retry</button></p>}
          </CardState>
        </Card>

        <Card title="Available reports" sub={`${fmtInt(shown.length)} of ${fmtInt(catalog.length)} reports`}>
          <div className="cc-filters rc-filters">
            <label className="cc-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search reports" placeholder="Search reports" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} /></label>
            <select className="cc-select" aria-label="Category" value={catCategory} onChange={(e) => setCatCategory(e.target.value)}>
              <option value="">All categories</option>
              {cats.filter((c) => c.count).map((c) => <option key={c.category} value={c.category}>{c.category}</option>)}
            </select>
            <select className="cc-select" aria-label="Format" value={catFormat} onChange={(e) => setCatFormat(e.target.value)}>
              <option value="">All formats</option>
              {['PDF', 'Excel', 'PPTX'].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className="cc-select" aria-label="Mode" value={catMode} onChange={(e) => setCatMode(e.target.value)}>
              <option value="">All modes</option>
              <option value="On demand">On demand</option>
              <option value="Scheduled">Scheduled</option>
            </select>
            <div className="rc-viewtoggle" role="group" aria-label="View">
              <button type="button" aria-pressed={catView === 'list'} onClick={() => setCatView('list')} aria-label="List view" title="List view"><List size={15} /></button>
              <button type="button" aria-pressed={catView === 'grid'} onClick={() => setCatView('grid')} aria-label="Card view" title="Card view"><LayoutGrid size={15} /></button>
            </div>
          </div>
          {catView === 'grid' ? (
            shown.length === 0 ? <div className="cc-empty">No report matches these filters.</div> : (
              <div className="rc-cards">
                {shown.map((r) => (
                  <div key={r.id} className="rc-rcard">
                    <b>{r.name}</b>
                    <small>{r.category} | {modeFor(r, scheduleRows)}</small>
                    <p>{r.desc}</p>
                    <span className="rc-gen">
                      {r.formats.map((f) => (
                        <button key={f} type="button" className="rc-gen-btn" disabled={Boolean(generating)} onClick={() => runEntry(r, f)}>
                          {busyFor(r, f) ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Download size={12} aria-hidden="true" />} {f}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <KitTable columns={catalogColumns} rows={shown} loading={catalogLoading} getRowId={(r) => r.id} empty="No report matches these filters." scroll />
          )}
        </Card>

        <Card title="Branding and delivery" sub="What every export carries">
          <div className="rc-brand">
            <div className="rc-brand-mark">
              {logo
                ? <img src={logo} alt={t('reportcenter.branding.logoAlt')} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                : <span className="rc-brand-swatch" style={{ background: branding?.primary_color || 'var(--cc-green-strong)' }}><Palette size={18} aria-hidden="true" /></span>}
              <div><b>{reportCompany}</b><small>{logo ? 'Tenant logo on every report' : 'No tenant logo set'}{orgName ? `, ${orgName}` : ''}</small></div>
            </div>
            <dl className="rc-kv">
              <div><dt>Report theme</dt><dd>{paletteLabel}</dd></div>
              <div><dt>Header</dt><dd>{reportCompany}</dd></div>
              <div><dt>Footer</dt><dd className="cc-na">Not configurable</dd></div>
              <div><dt>Default format</dt><dd className="cc-na" title="Each report and schedule picks its own formats">Chosen per report</dd></div>
              <div><dt>Delivery method</dt><dd title="Schedules email their recipients; on-demand reports download">Email (schedules), download (on demand)</dd></div>
              <div><dt>Language</dt><dd>English</dd></div>
              <div><dt>Timezone</dt><dd>{tz || 'Not recorded'}</dd></div>
              <div><dt>Currency</dt><dd>{activeCurrency}</dd></div>
            </dl>
            <div className="rc-brand-actions">
              <button type="button" className="cc-btn-ghost" onClick={() => generate('daily')} disabled={Boolean(generating)}>
                {generating === 'daily' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />} Preview report
              </button>
              <Link to="/console/appearance" className="cc-btn-primary"><Palette size={14} aria-hidden="true" /> {t('reportcenter.branding.editBranding')}</Link>
            </div>
          </div>
        </Card>
      </div>

      <div className="rc-bottom">
        <Card title="Recent deliveries" sub="Scheduled reports emailed" action={<ViewAll label="View all" onClick={() => document.getElementById('rc-history-title')?.scrollIntoView({ behavior: 'smooth' })} />}>
          <CardState state={{ loading: histLoading, data: histLoading ? null : history, error: histError, retry: loadHistory }}
            empty={!histLoading && !histError && !history.length ? 'No report has been delivered yet. Schedules log every send here.' : null}>
            <div className="cc-list">
              {history.slice(0, 5).map((r) => {
                const s = stamp(r.sent_at)
                return (
                  <div key={r.id} className="cc-row">
                    <span className="cc-row-icon rc-row-icon" aria-hidden="true"><Mail size={15} /></span>
                    <div className="cc-row-main">
                      <div className="cc-row-title" title={r.schedule_name || ''}>{r.schedule_name || 'Unnamed schedule'}</div>
                      <div className="cc-row-meta">{s ? `${s.date} ${s.time}` : 'Time not recorded'}{recipientCount(r) != null ? `, ${recipientCount(r)} recipients` : ''}</div>
                    </div>
                    <DeliveryPill row={r} />
                  </div>
                )
              })}
            </div>
          </CardState>
        </Card>

        <Card title="Report templates" sub="Saved Report Builder layouts" action={<ViewAll to="/accidents" label="Open builder" />}>
          <CardState state={{ ...layouts, retry: loadLayouts }}
            empty={layouts.data && !layouts.data.length ? 'No saved layouts yet. Build one in Accidents, Report Builder tab.' : null}>
            <div className="cc-list">
              {(layouts.data || []).slice(0, 5).map((l) => {
                const s = stamp(l.updated_at)
                const scheduled = scheduleRows.some((x) => x.active && x.report_type === l.value)
                return (
                  <div key={l.value} className="cc-row">
                    <span className="cc-row-icon rc-row-icon" aria-hidden="true"><LayoutTemplate size={15} /></span>
                    <div className="cc-row-main">
                      <div className="cc-row-title" title={l.label}>{l.label}</div>
                      <div className="cc-row-meta">Custom reports{s ? `, updated ${s.date}` : ''}</div>
                    </div>
                    <span className={`cc-pill ${scheduled ? 'info' : 'muted'}`}>{scheduled ? 'Scheduled' : 'Saved'}</span>
                  </div>
                )
              })}
            </div>
          </CardState>
          <Link to="/accidents" className="rc-create"><FilePlus2 size={14} aria-hidden="true" /> Create new template</Link>
        </Card>

        <Card title="Scheduling" sub="Pause or resume a schedule here" action={<ViewAll to="/scheduled-reports" />}>
          <CardState state={{ ...schedules, retry: loadSchedules }}
            empty={schedules.data && !schedules.data.length ? 'No schedules yet.' : null}>
            <div className="cc-list">
              {upcomingSchedules(scheduleRows, 5).map((s) => {
                const l = scheduleLabel(s)
                return (
                  <div key={s.id} className="cc-row">
                    <span className="cc-row-icon rc-row-icon" aria-hidden="true"><Clock3 size={15} /></span>
                    <div className="cc-row-main">
                      <div className="cc-row-title" title={s.name}>{s.name || 'Unnamed schedule'}</div>
                      <div className="cc-row-meta">{l.line1} {l.line2}</div>
                    </div>
                    <button type="button" role="switch" aria-checked={!!s.active} aria-label={`${s.active ? 'Pause' : 'Resume'} ${s.name || 'schedule'}`}
                      className={`rc-switch ${s.active ? 'on' : ''}`} disabled={togglingId === s.id} onClick={() => toggleSchedule(s)}>
                      <span />
                    </button>
                  </div>
                )
              })}
            </div>
          </CardState>
          <button type="button" className="rc-create" onClick={() => navigate('/scheduled-reports', { state: { presetReportType: 'executive' } })}><CalendarPlus size={14} aria-hidden="true" /> Create new schedule</button>
        </Card>
      </div>

      <section className="cc-card" aria-labelledby="rc-history-title">
        <div className="cc-card-head">
          <div>
            <h2 id="rc-history-title" className="cc-card-title">{t('reportcenter.history.title')}</h2>
            <p className="cc-card-sub">{histLoading || histError ? 'Every scheduled send, newest first' : `${fmtInt(histSummary.total)} sends logged, ${fmtInt(histSummary.last7)} in the last 7 days${histSummary.recipients != null ? `, ${fmtInt(histSummary.recipients)} recipients reached` : ''}`}</p>
          </div>
          <button type="button" className="cc-icon-btn" onClick={loadHistory} aria-label={t('reportcenter.history.refresh')} title={t('reportcenter.history.refresh')}><RefreshCw size={14} className={histLoading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="cc-filters rc-filters">
          <label className="cc-search"><Search size={15} aria-hidden="true" /><input type="search" placeholder="Search schedule, type, recipient" aria-label="Search delivery history" value={histSearch} onChange={(e) => setHistSearch(e.target.value)} /></label>
          <select className="cc-select" value={histStatus} onChange={(e) => setHistStatus(e.target.value)} aria-label="Delivery status">
            <option value="">All statuses</option>
            {Object.entries(DELIVERY_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v} ({histSummary.counts[k]})</option>)}
          </select>
          <select className="cc-select" value={histType} onChange={(e) => setHistType(e.target.value)} aria-label="Report type">
            <option value="">All report types</option>
            {histSummary.byType.map((b) => <option key={b.key} value={b.key}>{b.key} ({b.total})</option>)}
          </select>
          {(histStatus || histType || histSearch) && (
            <button type="button" onClick={() => { setHistStatus(''); setHistType(''); setHistSearch('') }} className="cc-btn-ghost"><X size={12} aria-hidden="true" /> Clear</button>
          )}
          <span className="rc-count" aria-live="polite">{histFiltered.length} of {histSummary.total}</span>
        </div>
        {!histLoading && !histError && history.length >= HISTORY_LIMIT && (
          <p className="rc-note" role="status">Showing the {HISTORY_LIMIT} most recent sends. Older deliveries are not loaded, so these figures cover those sends only.</p>
        )}
        <EnterpriseTable
          columns={histColumns}
          data={histFiltered}
          getRowId={(r) => String(r.id)}
          loading={histLoading}
          error={histError}
          onRetry={loadHistory}
          enableGlobalFilter={false}
          exportFileName={`${reportCompany} Report Deliveries ${fmt(now)}`}
          emptyMessage={history.length === 0 ? t('reportcenter.history.emptyDesc') : 'No deliveries match these filters.'}
        />
      </section>

      <Modal open={pickerOpen} onClose={() => { if (!generating) setPickerOpen(false) }} size="lg" title="Generate report"
        subtitle={`${dateFrom || 'Start'} to ${dateTo || 'today'}, ${activeCountry === 'All' ? 'all countries' : activeCountry}`}>
        <div className="rc-picker">
          {ON_DEMAND.map((r) => {
            const Icon = PAGE_ICON[r.id]
            return (
              <div key={r.id} className="rc-rcard">
                <span className={`rc-name-icon ${CATEGORY_TONE[r.category]}`}><Icon size={16} aria-hidden="true" /></span>
                <b>{t(`reportcenter.reports.${r.id}.label`)}</b>
                <p>{t(`reportcenter.reports.${r.id}.desc`)}</p>
                <button type="button" className="cc-btn-primary" onClick={() => generate(r.id)} aria-busy={generating === r.id} disabled={!!generating}>
                  {generating === r.id ? <><Loader2 size={13} className="animate-spin" aria-hidden="true" /> {t('reportcenter.generate.building')}</> : <><Download size={13} aria-hidden="true" /> {t('reportcenter.generate.generate')}</>}
                </button>
              </div>
            )
          })}
        </div>
        <p className="rc-note">Every other report type and saved layout is in Available reports, with its own PDF and Excel buttons.</p>
      </Modal>
    </div>
  )
}
