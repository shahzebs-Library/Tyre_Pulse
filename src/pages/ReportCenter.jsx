import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, FileSpreadsheet, Presentation, CalendarClock, Palette, Loader2,
  CheckCircle2, AlertTriangle, X, RefreshCw, Download, Mail, ArrowRight, Send, Percent, Users, Search,
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
import { exportToPptx, exportToExcel, exportToPdf, exportDailyExecutivePdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { REPORTS_TABS } from '../components/ui/SectionTabs'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import {
  summarizeDeliveryLog, filterDeliveryLog, deliveryStatus, recipientCount, DELIVERY_STATUS_LABEL,
} from '../lib/reportCenterAnalytics'
import { Illustration } from '../components/illustrations'
import { toUserMessage } from '../lib/safeError'

// Ceiling on the paged tyre export. Above the live tyre_records count (~11,132)
// so a normal export is complete; if it is ever hit the toast SAYS the file is
// partial rather than handing over a short spreadsheet that looks whole.
const TYRE_EXPORT_CAP = 40000

/**
 * ReportCenter — one place to generate the fleet's branded reports on demand and
 * review scheduled-delivery history. Every export carries the active tenant
 * branding (V68) via TenantContext, and honours the current country + date
 * filters. Complements the scheduling UI (/scheduled-reports) and the tenant
 * Branding editor (User Management → Branding).
 */

const pad = (n) => String(n).padStart(2, '0')
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

const REPORTS = [
  { id: 'pptx',  label: 'Executive PowerPoint', desc: '12-slide management deck: KPIs, risk, cost, recommendations.', icon: Presentation, tint: 'text-orange-400', bg: 'rgba(249,115,22,0.12)' },
  { id: 'daily', label: 'Daily Executive PDF',  desc: 'One-page-per-section landscape operations brief.',            icon: FileText,     tint: 'text-green-400',  bg: 'rgba(22,163,74,0.12)' },
  { id: 'excel', label: 'Tyre Records (Excel)', desc: 'Filterable workbook of tyre records with cost columns.',       icon: FileSpreadsheet, tint: 'text-emerald-400', bg: 'rgba(16,185,129,0.12)' },
  { id: 'pdf',   label: 'Tyre Records (PDF)',   desc: 'Print-ready landscape table (top 200 records).',               icon: FileText,     tint: 'text-red-400',    bg: 'rgba(239,68,68,0.12)' },
]

// Delivery status: colour plus an icon and a word, never colour alone.
const DELIVERY_META = {
  sent: { cls: 'bg-green-900/30 text-green-300 border-green-800/50', icon: CheckCircle2 },
  failed: { cls: 'bg-red-900/30 text-red-300 border-red-800/50', icon: AlertTriangle },
  pending: { cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50', icon: RefreshCw },
  unknown: { cls: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]', icon: Mail },
}

// The delivery log shows the most recent sends; the page says so.
const HISTORY_LIMIT = 200

export default function ReportCenter() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const { branding, orgName } = useTenant()

  const now = new Date()
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`)
  const [dateTo, setDateTo]     = useState(fmt(now))
  const [generating, setGenerating] = useState(null)  // report id currently building
  const [toast, setToast]       = useState(null)      // { text, type }

  const [history, setHistory]   = useState([])
  const [histLoading, setHistLoading] = useState(true)
  const [histError, setHistError] = useState(null)
  const [histStatus, setHistStatus] = useState('')
  const [histType, setHistType] = useState('')
  const [histSearch, setHistSearch] = useState('')

  const reportCompany = branding?.legal_name || branding?.display_name || appSettings.company_name || 'TyrePulse'

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
    { id: 'sent_at', header: 'Sent', accessorFn: (r) => r.sent_at || '', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{row.original.sent_at ? new Date(row.original.sent_at).toLocaleString() : 'N/A'}</span> },
    { id: 'schedule_name', header: 'Schedule', accessorFn: (r) => r.schedule_name || '', cell: ({ getValue }) => <span className="text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'report_type', header: 'Type', accessorFn: (r) => r.report_type || '', meta: { filterVariant: 'select' }, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'recipients', header: 'Recipients', accessorFn: (r) => recipientCount(r), meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : getValue()) },
    {
      id: 'status', header: 'Status', accessorFn: (r) => DELIVERY_STATUS_LABEL[deliveryStatus(r)],
      cell: ({ row }) => {
        const st = deliveryStatus(row.original)
        const meta = DELIVERY_META[st]
        const Icon = meta.icon
        return (
          <div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.cls}`}>
              <Icon size={11} aria-hidden="true" /> {row.original.status || DELIVERY_STATUS_LABEL[st]}
            </span>
            {row.original.error && (
              <span className="block text-[11px] text-red-300 truncate max-w-[260px] mt-0.5" title={toUserMessage(row.original.error, 'Delivery failed')}>
                {toUserMessage(row.original.error, 'Delivery failed')}
              </span>
            )}
          </div>
        )
      },
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

  return (
    <div className="space-y-6 animate-in">
      <SectionTabs tabs={REPORTS_TABS} />

      {/* Hero — decorative report cover art alongside the page title */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-dim)] bg-[var(--surface-1)]">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-4 sm:p-5">
          <PageHeader title={t('reportcenter.title')} subtitle={t('reportcenter.subtitle')} icon={FileText} />
          <Illustration
            name="report/cover-hero"
            title={t('reportcenter.title')}
            desc={reportCompany}
            size={320}
            decorative
            className="hidden md:block flex-shrink-0 w-[280px] lg:w-[320px]"
          />
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            role="status" aria-live="polite"
            className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg"
            style={{
              background: toast.type === 'ok' ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)',
              border: `1px solid ${toast.type === 'ok' ? 'rgba(22,163,74,0.4)' : 'rgba(239,68,68,0.4)'}`,
              color: toast.type === 'ok' ? '#16a34a' : '#dc2626', backdropFilter: 'blur(8px)',
            }}
            onAnimationComplete={() => { if (toast) setTimeout(() => setToast(null), 4000) }}>
            {toast.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span className="max-w-xs">{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss message" className="ml-1 min-w-[32px] min-h-[32px] inline-flex items-center justify-center opacity-70 hover:opacity-100"><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Branding banner */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          {safeImageSrc(branding?.logo_url)
            ? <img src={safeImageSrc(branding.logo_url)} alt={t('reportcenter.branding.logoAlt')} className="h-10 w-10 rounded object-contain bg-[var(--input-bg)]" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : <div className="h-10 w-10 rounded flex items-center justify-center" style={{ background: branding?.primary_color || '#16A34A' }}><Palette size={16} className="text-white/90" /></div>}
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{reportCompany}</p>
            <p className="text-xs text-[var(--text-muted)]">{t('reportcenter.branding.activeBranding')}{orgName ? `, ${orgName}` : ''}. {t('reportcenter.branding.reportsIdentity')}</p>
          </div>
        </div>
        <Link to="/console/appearance" className="btn-secondary text-xs gap-1.5 self-start sm:self-auto">
          <Palette size={13} /> {t('reportcenter.branding.editBranding')} <ArrowRight size={12} />
        </Link>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="rc-from" className="block text-xs text-[var(--text-muted)] mb-1">{t('reportcenter.filters.from')}</label>
          <input id="rc-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input text-sm min-h-[44px]" />
        </div>
        <div>
          <label htmlFor="rc-to" className="block text-xs text-[var(--text-muted)] mb-1">{t('reportcenter.filters.to')}</label>
          <input id="rc-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input text-sm min-h-[44px]" />
        </div>
        <div className="text-xs text-[var(--text-muted)] pb-2">
          {t('reportcenter.filters.scope')} <span className="text-[var(--text-secondary)] font-medium">{activeCountry === 'All' ? t('reportcenter.filters.allCountries') : activeCountry}</span>, {t('reportcenter.filters.currency')} <span className="text-[var(--text-secondary)] font-medium">{activeCurrency}</span>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {REPORTS.map(({ id, icon: Icon, tint, bg }) => (
          <div key={id} className="card flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg" style={{ background: bg }}><Icon size={18} className={tint} aria-hidden="true" /></div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t(`reportcenter.reports.${id}.label`)}</h3>
            </div>
            <p className="text-xs text-[var(--text-muted)] flex-1 leading-relaxed">{t(`reportcenter.reports.${id}.desc`)}</p>
            <button
              type="button"
              onClick={() => generate(id)}
              aria-busy={generating === id}
              disabled={!!generating}
              className="btn-primary text-xs gap-1.5 w-full justify-center min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating === id ? <><Loader2 size={13} className="animate-spin" /> {t('reportcenter.generate.building')}</> : <><Download size={13} /> {t('reportcenter.generate.generate')}</>}
            </button>
          </div>
        ))}
      </div>

      {/* Scheduling shortcut */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg" style={{ background: 'rgba(59,130,246,0.12)' }}><CalendarClock size={18} className="text-blue-400" /></div>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{t('reportcenter.automatedDelivery.title')}</p>
            <p className="text-xs text-[var(--text-muted)]">{t('reportcenter.automatedDelivery.desc')}</p>
          </div>
        </div>
        <Link to="/scheduled-reports" className="btn-secondary text-xs gap-1.5 self-start sm:self-auto">
          <CalendarClock size={13} /> {t('reportcenter.automatedDelivery.manageSchedules')} <ArrowRight size={12} />
        </Link>
      </div>

      {/* Delivery history */}
      <section className="space-y-3" aria-labelledby="rc-history-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Mail size={15} className="text-[var(--text-muted)]" aria-hidden="true" />
            <h2 id="rc-history-title" className="text-base font-semibold text-[var(--text-primary)]">{t('reportcenter.history.title')}</h2>
          </div>
          <button type="button" onClick={loadHistory} className="btn-secondary text-xs gap-1.5 min-h-[44px]"><RefreshCw size={12} /> {t('reportcenter.history.refresh')}</button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Sends logged', value: histLoading || histError ? 'N/A' : histSummary.total, hint: histLoading || histError ? null : `${histSummary.last7} in the last 7 days`, icon: Send, tone: 'text-[var(--text-primary)]' },
            { label: 'Delivery success', value: histLoading || histError || histSummary.successRate == null ? 'N/A' : `${histSummary.successRate}%`, hint: 'Sent of sent plus failed', icon: Percent, tone: 'text-green-400' },
            { label: 'Failed', value: histLoading || histError ? 'N/A' : histSummary.counts.failed, hint: histSummary.lastFailed ? `Last ${new Date(histSummary.lastFailed).toLocaleDateString()}` : null, icon: AlertTriangle, tone: 'text-red-400' },
            { label: 'Recipients reached', value: histLoading || histError || histSummary.recipients == null ? 'N/A' : histSummary.recipients, hint: histSummary.lastSent ? `Last send ${new Date(histSummary.lastSent).toLocaleDateString()}` : null, icon: Users, tone: 'text-[var(--text-primary)]' },
          ].map((k) => {
            const Icon = k.icon
            return (
              <div key={k.label} className="card">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                  <Icon size={16} className={k.tone} aria-hidden="true" />
                </div>
                <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>
                {k.hint && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.hint}</p>}
              </div>
            )
          })}
        </div>

        <div className="card flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" placeholder="Search schedule, type, recipient" aria-label="Search delivery history" value={histSearch} onChange={(e) => setHistSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={histStatus} onChange={(e) => setHistStatus(e.target.value)} aria-label="Delivery status">
            <option value="">All statuses</option>
            {Object.entries(DELIVERY_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v} ({histSummary.counts[k]})</option>)}
          </select>
          <select className="input min-h-[44px]" value={histType} onChange={(e) => setHistType(e.target.value)} aria-label="Report type">
            <option value="">All report types</option>
            {histSummary.byType.map((b) => <option key={b.key} value={b.key}>{b.key} ({b.total})</option>)}
          </select>
          {(histStatus || histType || histSearch) && (
            <button type="button" onClick={() => { setHistStatus(''); setHistType(''); setHistSearch('') }} className="btn-secondary text-xs gap-1.5 min-h-[44px]"><X size={12} /> Clear</button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{histFiltered.length} of {histSummary.total}</span>
        </div>

        {!histLoading && !histError && history.length >= HISTORY_LIMIT && (
          <p className="text-xs text-amber-300" role="status">Showing the {HISTORY_LIMIT} most recent sends. Older deliveries are not loaded, so these figures cover those sends only.</p>
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
    </div>
  )
}
