import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, FileSpreadsheet, Presentation, CalendarClock, Palette, Loader2,
  CheckCircle2, AlertTriangle, X, RefreshCw, Download, Clock, Mail, ArrowRight,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { applyCountry } from '../lib/countryFilter'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import { formatDate } from '../lib/formatters'
import { exportToPptx, exportToExcel, exportToPdf, exportDailyExecutivePdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { REPORTS_TABS } from '../components/ui/SectionTabs'
import LoadingState from '../components/LoadingState'
import EmptyState from '../components/EmptyState'

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
  { id: 'pptx',  label: 'Executive PowerPoint', desc: '12-slide management deck — KPIs, risk, cost, recommendations.', icon: Presentation, tint: 'text-orange-400', bg: 'rgba(249,115,22,0.12)' },
  { id: 'daily', label: 'Daily Executive PDF',  desc: 'One-page-per-section landscape operations brief.',            icon: FileText,     tint: 'text-green-400',  bg: 'rgba(22,163,74,0.12)' },
  { id: 'excel', label: 'Tyre Records (Excel)', desc: 'Filterable workbook of tyre records with cost columns.',       icon: FileSpreadsheet, tint: 'text-emerald-400', bg: 'rgba(16,185,129,0.12)' },
  { id: 'pdf',   label: 'Tyre Records (PDF)',   desc: 'Print-ready landscape table (top 200 records).',               icon: FileText,     tint: 'text-red-400',    bg: 'rgba(239,68,68,0.12)' },
]

const STATUS_TINT = {
  sent: 'text-green-400', success: 'text-green-400',
  failed: 'text-red-400', error: 'text-red-400',
  pending: 'text-amber-400', queued: 'text-amber-400',
}

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

  const reportCompany = branding?.legal_name || branding?.display_name || appSettings.company_name || 'TyrePulse'

  // ── Delivery history (scheduled report sends) ──────────────────────────────
  const loadHistory = useCallback(async () => {
    setHistLoading(true); setHistError(null)
    try {
      const { data, error } = await supabase
        .from('report_send_log')
        .select('id,schedule_name,report_type,recipients,status,error,sent_at')
        .order('sent_at', { ascending: false })
        .limit(50)
      if (error) throw error
      setHistory(data ?? [])
    } catch (e) {
      setHistError(e.message || t('reportcenter.errors.historyLoadFailed'))
    } finally {
      setHistLoading(false)
    }
  }, [t])
  useEffect(() => { loadHistory() }, [loadHistory])

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

  async function fetchTyreRows() {
    const { data, error } = await applyCountry(
      supabase.from('tyre_records').select('issue_date,asset_no,brand,site,category,risk_level,cost_per_tyre'),
      activeCountry,
    ).gte('issue_date', dateFrom || '1900-01-01').lte('issue_date', dateTo || '2999-12-31')
      .order('issue_date', { ascending: false }).limit(5000)
    if (error) throw error
    return data ?? []
  }

  // ── On-demand generation ───────────────────────────────────────────────────
  async function generate(id) {
    if (generating) return
    setGenerating(id); setToast(null)
    const stamp = new Date().toISOString().slice(0, 10)
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
              criticalTyres > 0 ? { priority: 'Critical', text: `${criticalTyres} tyres critical — schedule immediate replacement.` } : null,
              { priority: 'Low', text: 'Maintain weekly pressure checks and monthly tread measurements.' },
            ].filter(Boolean),
            branding,
          }, `${reportCompany.replace(/\s+/g, '_')}_Daily_${stamp}`)
        }
      } else if (id === 'excel') {
        const rows = await fetchTyreRows()
        if (!rows.length) throw new Error(t('reportcenter.errors.noRecordsInRange'))
        await exportToExcel(
          rows.map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre || 0 })),
          ['issue_date', 'asset_no', 'brand', 'site', 'category', 'risk_level', 'cost_per_tyre'],
          ['Date', 'Asset No', 'Brand', 'Site', 'Category', 'Risk Level', `Cost (${activeCurrency})`],
          `${reportCompany.replace(/\s+/g, '_')}_Tyres_${stamp}`, 'Tyre Records', { company: reportCompany })
      } else if (id === 'pdf') {
        const rows = await fetchTyreRows()
        if (!rows.length) throw new Error(t('reportcenter.errors.noRecordsInRange'))
        await exportToPdf(
          rows.slice(0, 200).map(t => ({ ...t, cost_per_tyre: t.cost_per_tyre || 0 })),
          [{ key: 'issue_date', header: 'Date', width: 24 }, { key: 'asset_no', header: 'Asset No', width: 28 }, { key: 'brand', header: 'Brand', width: 24 }, { key: 'site', header: 'Site', width: 30 }, { key: 'category', header: 'Category', width: 32 }, { key: 'risk_level', header: 'Risk', width: 20 }, { key: 'cost_per_tyre', header: `Cost (${activeCurrency})`, width: 24 }],
          `${reportCompany} — Tyre Records · ${formatDate(now, activeCountry)}`,
          `${reportCompany.replace(/\s+/g, '_')}_Tyres_${stamp}`, 'landscape', reportCompany)
      }
      setToast({ text: t('reportcenter.toast.success'), type: 'ok' })
    } catch (e) {
      console.error(`[ReportCenter] ${id} failed:`, e)
      setToast({ text: t('reportcenter.toast.errorPrefix', { message: e?.message || t('reportcenter.toast.unexpectedError') }), type: 'err' })
    } finally {
      setGenerating(null)
    }
  }

  return (
    <div className="space-y-6 animate-in">
      <SectionTabs tabs={REPORTS_TABS} />
      <PageHeader title={t('reportcenter.title')} subtitle={t('reportcenter.subtitle')} icon={FileText} />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
            className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg"
            style={{
              background: toast.type === 'ok' ? 'rgba(22,163,74,0.15)' : 'rgba(239,68,68,0.15)',
              border: `1px solid ${toast.type === 'ok' ? 'rgba(22,163,74,0.4)' : 'rgba(239,68,68,0.4)'}`,
              color: toast.type === 'ok' ? '#4ade80' : '#f87171', backdropFilter: 'blur(8px)',
            }}
            onAnimationComplete={() => { if (toast) setTimeout(() => setToast(null), 4000) }}>
            {toast.type === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span className="max-w-xs">{toast.text}</span>
            <button onClick={() => setToast(null)} className="ml-1 opacity-70 hover:opacity-100"><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Branding banner */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          {branding?.logo_url
            ? <img src={branding.logo_url} alt={t('reportcenter.branding.logoAlt')} className="h-10 w-10 rounded object-contain bg-white/5" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : <div className="h-10 w-10 rounded flex items-center justify-center" style={{ background: branding?.primary_color || '#16A34A' }}><Palette size={16} className="text-white/90" /></div>}
          <div>
            <p className="text-sm font-semibold text-gray-100">{reportCompany}</p>
            <p className="text-xs text-gray-500">{t('reportcenter.branding.activeBranding')}{orgName ? ` · ${orgName}` : ''} · {t('reportcenter.branding.reportsIdentity')}</p>
          </div>
        </div>
        <Link to="/users" className="btn-secondary text-xs gap-1.5 self-start sm:self-auto">
          <Palette size={13} /> {t('reportcenter.branding.editBranding')} <ArrowRight size={12} />
        </Link>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('reportcenter.filters.from')}</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">{t('reportcenter.filters.to')}</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input text-sm" />
        </div>
        <div className="text-xs text-gray-500 pb-2">
          {t('reportcenter.filters.scope')} <span className="text-gray-300 font-medium">{activeCountry === 'All' ? t('reportcenter.filters.allCountries') : activeCountry}</span> · {t('reportcenter.filters.currency')} <span className="text-gray-300 font-medium">{activeCurrency}</span>
        </div>
      </div>

      {/* Report cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {REPORTS.map(({ id, icon: Icon, tint, bg }) => (
          <div key={id} className="card flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg" style={{ background: bg }}><Icon size={18} className={tint} /></div>
              <h3 className="text-sm font-semibold text-gray-100">{t(`reportcenter.reports.${id}.label`)}</h3>
            </div>
            <p className="text-xs text-gray-500 flex-1 leading-relaxed">{t(`reportcenter.reports.${id}.desc`)}</p>
            <button
              onClick={() => generate(id)}
              disabled={!!generating}
              className="btn-primary text-xs gap-1.5 w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
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
            <p className="text-sm font-semibold text-gray-100">{t('reportcenter.automatedDelivery.title')}</p>
            <p className="text-xs text-gray-500">{t('reportcenter.automatedDelivery.desc')}</p>
          </div>
        </div>
        <Link to="/scheduled-reports" className="btn-secondary text-xs gap-1.5 self-start sm:self-auto">
          <CalendarClock size={13} /> {t('reportcenter.automatedDelivery.manageSchedules')} <ArrowRight size={12} />
        </Link>
      </div>

      {/* Delivery history */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail size={15} className="text-gray-400" />
            <h2 className="text-base font-semibold text-white">{t('reportcenter.history.title')}</h2>
          </div>
          <button onClick={loadHistory} className="btn-secondary text-xs gap-1.5"><RefreshCw size={12} /> {t('reportcenter.history.refresh')}</button>
        </div>
        {histLoading ? (
          <LoadingState message={t('reportcenter.history.loading')} />
        ) : histError ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertTriangle size={28} className="text-red-400" />
            <p className="text-sm text-red-300">{histError}</p>
            <button onClick={loadHistory} className="btn-secondary text-xs gap-1.5 mt-1"><RefreshCw size={12} /> {t('reportcenter.history.retry')}</button>
          </div>
        ) : history.length === 0 ? (
          <EmptyState icon={Clock} title={t('reportcenter.history.emptyTitle')} description={t('reportcenter.history.emptyDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['sent', 'schedule', 'type', 'recipients', 'status'].map(h => <th key={h} className="table-header text-left">{t(`reportcenter.history.columns.${h}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id}>
                    <td className="table-cell text-gray-400 text-xs whitespace-nowrap">{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td>
                    <td className="table-cell text-gray-200 text-sm">{r.schedule_name || '—'}</td>
                    <td className="table-cell text-gray-400 text-xs">{r.report_type || '—'}</td>
                    <td className="table-cell text-gray-400 text-xs">{Array.isArray(r.recipients) ? t('reportcenter.history.recipientsCount', { count: r.recipients.length }) : '—'}</td>
                    <td className="table-cell">
                      <span className={`text-xs font-medium ${STATUS_TINT[String(r.status || '').toLowerCase()] || 'text-gray-400'}`}>
                        {r.status || t('reportcenter.history.statusUnknown')}
                      </span>
                      {r.error && <span className="block text-[10px] text-red-400/80 truncate max-w-[220px]" title={r.error}>{r.error}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
