import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Clock, Mail, Plus, Edit2, Trash2, Eye, EyeOff,
  FileText, BarChart2, Truck, ClipboardList, DollarSign,
  CheckCircle, XCircle, AlertCircle, AlertTriangle, ChevronDown, X, Save, Lock,
  Package, Building2, Download, Loader2, FileSpreadsheet, CalendarClock, ShieldCheck,
  LayoutTemplate, Send, History, RefreshCw, CalendarDays, ChevronRight, Play, PauseCircle, List, LayoutGrid,
  Users, Search,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { aiOps } from '../lib/api'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import SegmentedControl from '../components/ui/SegmentedControl'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import DialogModal from '../components/ui/Modal'
import {
  filterSchedules, shortReason, validateEmails, nextRunBucket, scheduleKpis,
  deliveryRows, scheduleExportRows, SCHEDULE_EXPORT_KEYS, SCHEDULE_EXPORT_HEADERS,
} from '../lib/scheduledReportsAnalytics'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { exportToPdf, exportToExcel, exportSheetsToExcel, reportFileName, reportDateLabel } from '../lib/exportUtils'
import {
  REPORT_TYPES, FREQUENCIES, PERIODS, OUTPUT_FORMATS,
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  computeNextRun, resolvePeriod, fetchReportRows,
  listSchedulableLayouts, isBuilderType, builderTemplateId, scheduleOrgId,
} from '../lib/api/scheduledReports'
import { getTemplate } from '../lib/api/accidentReportTemplates'
import { tyreManVehicleTypeSummary, tyreManVehicleTypeTable } from '../lib/inspectionCoverage'
import { Card, CardState, Kpi, Donut, KitTable, ViewAll, fmtInt } from '../components/commandCenter/kit'
import {
  moduleOf, MODULE_OPTIONS, scheduleLabel, scheduleStatus, STATUS_META, healthSegments, registryKpis,
  deliveryTrend, recentActivity, latestRunBySchedule, filterRegistry, recipientOptions,
} from '../lib/scheduledReportsView'
import './ScheduledReports.css'

// Delivery log window. Long enough that the whole previous calendar month is
// always inside it, so the month-on-month trend on the KPI tiles is honest.
const HISTORY_DAYS = 70

function KpiLabel({ title, sub }) {
  return <>{title}<small className="sr-kpi-sub">{sub}</small></>
}

const TREND_SERIES = [
  { key: 'sent', label: 'Successful', color: 'var(--cc-green)' },
  { key: 'failed', label: 'Failed', color: 'var(--cc-red)' },
  { key: 'expected', label: 'Expected', color: 'var(--cc-blue)', dashed: true },
]

/** Small SVG line chart for the 7-day delivery trend. */
function TrendChart({ points }) {
  const W = 420; const H = 150; const pad = 26
  // Even ceiling so the half-way gridline is a whole number (never 1 / 1 / 0).
  const peak = Math.max(0, ...points.flatMap((p) => TREND_SERIES.map((s) => Number(p[s.key]) || 0)))
  const max = Math.max(2, Math.ceil(peak / 2) * 2)
  const step = points.length > 1 ? (W - pad - 8) / (points.length - 1) : 0
  const x = (i) => pad + i * step
  const y = (v) => H - (v / max) * (H - 14)
  const label = points.map((p) => `${p.label}: ${p.sent} sent, ${p.failed} failed, ${p.expected} expected`).join('; ')
  return (
    <div className="sr-trend">
      <div className="sr-trend-legend">
        {TREND_SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}</span>)}
      </div>
      <div className="cc-chart">
        <svg viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label={`Deliveries per day. ${label}`} preserveAspectRatio="none">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={pad} y1={y(max * f)} x2={W} y2={y(max * f)} stroke="var(--cc-inner-border)" />
              <text x={pad - 5} y={y(max * f) + 3} textAnchor="end" className="cc-axis">{Math.round(max * f)}</text>
            </g>
          ))}
          {TREND_SERIES.map((s) => (
            <g key={s.key}>
              <polyline fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined}
                points={points.map((p, i) => `${x(i)},${y(p[s.key])}`).join(' ')} />
              {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p[s.key])} r="3" fill={s.color}><title>{`${p.label} ${s.label}: ${p[s.key]}`}</title></circle>)}
            </g>
          ))}
          {points.map((p, i) => <text key={p.date} x={x(i)} y={H + 15} textAnchor="middle" className="cc-axis">{p.label}</text>)}
        </svg>
      </div>
    </div>
  )
}

// ── Registry-derived lookups (labels come from the service; icons/colours here) ─

const REPORT_LABEL = Object.fromEntries(REPORT_TYPES.map(r => [r.value, r.label]))
const FREQ_LABEL   = Object.fromEntries(FREQUENCIES.map(f => [f.value, f.label]))
const PERIOD_LABEL = Object.fromEntries(PERIODS.map(p => [p.value, p.label]))

const ICON_CFG = {
  executive:  { Icon: FileText,      color: 'text-purple-400',  bg: 'bg-purple-400/10' },
  kpi:        { Icon: BarChart2,     color: 'text-blue-400',    bg: 'bg-blue-400/10'   },
  fleet:      { Icon: Truck,         color: 'text-green-400',   bg: 'bg-green-400/10'  },
  cost:       { Icon: DollarSign,    color: 'text-orange-400',  bg: 'bg-orange-400/10' },
  inspection: { Icon: ClipboardList, color: 'text-yellow-400',  bg: 'bg-yellow-400/10' },
  accidents:  { Icon: AlertTriangle, color: 'text-red-400',     bg: 'bg-red-400/10'    },
  claims:     { Icon: ShieldCheck,   color: 'text-indigo-400',  bg: 'bg-indigo-400/10' },
  stock:      { Icon: Package,       color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  vendor:     { Icon: Building2,     color: 'text-cyan-400',    bg: 'bg-cyan-400/10'   },
  builder:    { Icon: LayoutTemplate, color: 'text-pink-400',   bg: 'bg-pink-400/10'   },
}

const iconCfgFor = (type) => (isBuilderType(type) ? ICON_CFG.builder : (ICON_CFG[type] || ICON_CFG.executive))

const FREQ_DOT = { once: 'bg-orange-400', daily: 'bg-green-400', weekly: 'bg-blue-400', monthly: 'bg-purple-400' }

const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6]
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const BLANK_FORM = {
  name: '',
  report_type: 'executive',
  frequency: 'weekly',
  day_of_week: 1,
  day_of_month: 1,
  time_of_day: '07:00',
  run_at: '',
  start_date: '',
  period: 'last_30',
  period_from: '',
  period_to: '',
  output_formats: ['pdf'],
  recipients_raw: '',
  active: true,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** t() with an English fallback: the app's translate() returns the key verbatim
 *  when a namespace value is missing, so new UI stays professional without
 *  requiring locale-file edits (existing keys still localize normally). */
function useT() {
  const { t } = useLanguage()
  return useCallback((key, fallback, vars) => {
    const out = t(key, vars)
    if (out !== key) return out
    if (fallback == null) return key
    return vars ? fallback.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : fallback
  }, [t])
}

function formatNextRun(nextRunAt, td, now = Date.now()) {
  const nb = nextRunBucket(nextRunAt, now)
  if (!nb) return 'N/A'
  const d = nb.date
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (nb.bucket === 'due') return td('schedreports.time.due', 'Due now')
  if (nb.bucket === 'today') return td('schedreports.time.today', 'Today at {time}', { time })
  if (nb.bucket === 'tomorrow') return td('schedreports.time.tomorrow', 'Tomorrow at {time}', { time })
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} | ${time}`
}

function formatLastSent(ts, td) {
  if (!ts) return td('schedreports.lastSent.never', 'Never run')
  const d = new Date(ts)
  return td('schedreports.lastSent.label', 'Last run {date} at {time}', {
    date: d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  })
}

/** Short, absolute run timestamp for delivery rows: "14 Jul, 07:00". */
function formatRunStamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}




function coverageLabel(s, td) {
  if (s.period === 'custom') return `${s.period_from || '...'} to ${s.period_to || '...'}`
  return td(`schedreports.periods.${s.period}`, PERIOD_LABEL[s.period] || 'Last 30 days')
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FrequencyBadge({ frequency, td }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--surface-3)] text-xs font-medium text-[var(--text-secondary)]">
      <span className={`w-1.5 h-1.5 rounded-full ${FREQ_DOT[frequency] || 'bg-gray-400'}`} />
      {td(`schedreports.frequencies.${frequency}`, FREQ_LABEL[frequency] || frequency)}
    </span>
  )
}

function ReportTypeIcon({ type, size = 'md' }) {
  const { Icon, color, bg } = iconCfgFor(type)
  const sz = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'
  const ic = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  return (
    <div className={`${sz} rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
      <Icon className={`${ic} ${color}`} />
    </div>
  )
}

function FormatBadge({ fmt }) {
  const Icon = fmt === 'excel' ? FileSpreadsheet : FileText
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
      <Icon className="w-3 h-3" />{fmt}
    </span>
  )
}

/** Latest delivery outcome for one schedule, derived from summarizeJobs().bySchedule. */
function DeliveryStatusBadge({ health, td }) {
  const delivered = health && health.total > 0 && health.lastStatus === 'sent'
  const failed = health && health.total > 0 && health.lastStatus !== 'sent'
  const stamp = health?.lastRun ? formatRunStamp(health.lastRun) : ''

  if (delivered) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-400 min-w-0">
        <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">
          {stamp
            ? td('schedreports.delivery.deliveredAt', 'Delivered {when}', { when: stamp })
            : td('schedreports.delivery.delivered', 'Delivered')}
        </span>
      </div>
    )
  }
  if (failed) {
    const reason = shortReason(health.lastError)
    return (
      <div className="flex flex-col gap-0.5 min-w-0" title={health.lastError || undefined}>
        <div className="flex items-center gap-1.5 text-xs text-red-400 min-w-0">
          <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">
            {stamp
              ? td('schedreports.delivery.failedAt', 'Delivery failed {when}', { when: stamp })
              : td('schedreports.delivery.failed', 'Delivery failed')}
          </span>
        </div>
        {reason && (
          <span className="text-[11px] text-[var(--text-muted)] truncate pl-5">{reason}</span>
        )}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] min-w-0">
      <History className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate">{td('schedreports.delivery.never', 'Never sent')}</span>
    </div>
  )
}

function ScheduleCard({ schedule, health, onEdit, onDelete, onToggle, onGenerate, generating, onSendNow, sendingNow, td, typeLabelFor }) {
  const typeLabel = typeLabelFor(schedule.report_type)
  const cfg = iconCfgFor(schedule.report_type)
  const recipientCount = (schedule.recipients ?? []).length
  const formats = schedule.output_formats?.length ? schedule.output_formats : ['pdf']
  const busy = generating === schedule.id
  const sending = sendingNow === schedule.id

  return (
    <div className={`bg-[var(--surface-2)] border rounded-xl p-5 flex flex-col gap-4 transition-all duration-200 hover:border-[var(--border-bright)] border-[var(--border-bright)] ${schedule.active ? '' : 'opacity-70'}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ReportTypeIcon type={schedule.report_type} />
          <div className="min-w-0">
            <p className="text-[var(--text-primary)] font-semibold truncate">{schedule.name}</p>
            <p className={`text-xs mt-0.5 ${cfg.color}`}>{typeLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => onSendNow(schedule)}
            disabled={sending}
            title={td('schedreports.card.sendNow', 'Send now: email this report to its recipients immediately')}
            aria-label={`${td('schedreports.card.sendNowShort', 'Send now')}: ${schedule.name || ''}`}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 p-1.5 hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 text-green-400 animate-spin" /> : <Send className="w-4 h-4 text-[var(--text-secondary)] hover:text-green-400" />}
          </button>
          <button
            type="button"
            onClick={() => onGenerate(schedule)}
            disabled={busy}
            title={td('schedreports.card.generate', 'Generate & download now')}
            aria-label={`${td('schedreports.card.generate', 'Generate & download now')}: ${schedule.name || ''}`}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 p-1.5 hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 text-orange-400 animate-spin" /> : <Download className="w-4 h-4 text-[var(--text-secondary)] hover:text-orange-400" />}
          </button>
          <button
            type="button"
            onClick={() => onToggle(schedule)}
            title={schedule.active ? td('schedreports.card.deactivate', 'Deactivate') : td('schedreports.card.activate', 'Activate')}
            aria-label={`${schedule.active ? td('schedreports.card.deactivate', 'Deactivate') : td('schedreports.card.activate', 'Activate')}: ${schedule.name || ''}`}
            aria-pressed={!!schedule.active}
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 p-1.5 hover:bg-[var(--surface-3)] transition-colors"
          >
            {schedule.active ? <Eye className="w-4 h-4 text-green-400" /> : <EyeOff className="w-4 h-4 text-[var(--text-muted)]" />}
          </button>
          <button type="button" onClick={() => onEdit(schedule)} aria-label={`${td('schedreports.card.edit', 'Edit')}: ${schedule.name || ''}`} title={td('schedreports.card.edit', 'Edit')} className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 p-1.5 hover:bg-[var(--surface-3)] transition-colors">
            <Edit2 className="w-4 h-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" />
          </button>
          <button type="button" onClick={() => onDelete(schedule)} aria-label={`${td('schedreports.card.delete', 'Delete')}: ${schedule.name || ''}`} title={td('schedreports.card.delete', 'Delete')} className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500 p-1.5 hover:bg-red-500/10 transition-colors">
            <Trash2 className="w-4 h-4 text-[var(--text-secondary)] hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <FrequencyBadge frequency={schedule.frequency} td={td} />
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <Clock className="w-3.5 h-3.5" />{formatNextRun(schedule.next_run_at, td)}
        </span>
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <Mail className="w-3.5 h-3.5" />
          {recipientCount !== 1
            ? td('schedreports.card.recipientOther', '{count} recipients', { count: recipientCount })
            : td('schedreports.card.recipientOne', '{count} recipient', { count: recipientCount })}
        </span>
      </div>

      {/* Coverage + formats */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" />
          {td('schedreports.card.covers', 'Covers')} {coverageLabel(schedule, td)}
        </span>
        <span className="flex items-center gap-1">{formats.map(f => <FormatBadge key={f} fmt={f} />)}</span>
      </div>

      {/* Delivery status (latest report_send_log outcome for this schedule) */}
      <div className="flex items-center gap-2 min-w-0">
        <DeliveryStatusBadge health={health} td={td} />
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-[var(--border-bright)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{formatLastSent(schedule.last_sent_at, td)}</span>
        {schedule.active
          ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" />{td('schedreports.card.active', 'Active')}</span>
          : <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]"><XCircle className="w-3 h-3" />{td('schedreports.card.inactive', 'Paused')}</span>}
      </div>
    </div>
  )
}

function FieldLabel({ children, required, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
      {children}{required && <span className="text-orange-400 ml-1">*</span>}
    </label>
  )
}

const INPUT_CLASS = 'w-full bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30'

function SelectField({ value, onChange, children, id }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className={`${INPUT_CLASS} appearance-none pr-8`}>
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
    </div>
  )
}

function ScheduleModal({ title, onClose, onSave, saving, form, setForm, formError, setFormError, onGenerate, generating, record, wfLocked, onWfStateChange, td, layouts = [] }) {
  const toggleFormat = (fmt) => setForm(f => {
    const has = f.output_formats.includes(fmt)
    const next = has ? f.output_formats.filter(x => x !== fmt) : [...f.output_formats, fmt]
    return { ...f, output_formats: next }
  })

  return (
    <DialogModal
      open
      onClose={saving ? undefined : onClose}
      title={title}
      size="md"
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => onGenerate(form)}
            disabled={generating === 'form'}
            title={td('schedreports.modal.generateHint', 'Generate this report now and download it')}
            className="px-4 py-2 text-sm font-medium text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {generating === 'form' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {td('schedreports.modal.generateNow', 'Generate now')}
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-3)] hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50">
              {td('schedreports.modal.cancel', 'Cancel')}
            </button>
            <button
              onClick={onSave}
              disabled={saving || wfLocked}
              title={wfLocked ? td('schedreports.modal.locked', 'Locked, in approval') : undefined}
              className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {wfLocked ? <><Lock className="w-4 h-4" />{td('schedreports.modal.save', 'Save Schedule')}</>
                : saving ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{td('schedreports.modal.saving', 'Saving...')}</>
                : <><Save className="w-4 h-4" />{td('schedreports.modal.save', 'Save Schedule')}</>}
            </button>
          </div>
        </div>
      )}
    >
        <div className="space-y-5">
          {/* Name */}
          <div>
            <FieldLabel htmlFor="sr-name" required>{td('schedreports.modal.scheduleName', 'Schedule Name')}</FieldLabel>
            <input id="sr-name"
              type="text"
              placeholder={td('schedreports.modal.namePlaceholder', 'e.g. Weekly Executive Summary')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={`${INPUT_CLASS} placeholder-gray-500`}
            />
          </div>

          {/* Report Type */}
          <div>
            <FieldLabel htmlFor="sr-type" required>{td('schedreports.modal.reportType', 'Report Type')}</FieldLabel>
            <SelectField id="sr-type" value={form.report_type} onChange={v => setForm(f => ({ ...f, report_type: v }))}>
              <optgroup label={td('schedreports.modal.standardReports', 'Standard reports')}>
                {REPORT_TYPES.map(r => (
                  <option key={r.value} value={r.value}>{td(`schedreports.reportTypes.${r.value}`, r.label)}</option>
                ))}
              </optgroup>
              {layouts.length > 0 && (
                <optgroup label={td('schedreports.modal.customLayouts', 'Custom layouts (Report Builder)')}>
                  {layouts.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </optgroup>
              )}
            </SelectField>
            {isBuilderType(form.report_type) && (
              <p className="text-xs text-[var(--text-muted)] mt-1.5 flex items-start gap-1.5">
                <LayoutTemplate className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-pink-400" />
                {td('schedreports.modal.builderHint', 'A saved Accident Report Builder layout - "Generate now" renders its exact block design over the covered period. Manage layouts in Accidents > Report Builder.')}
              </p>
            )}
          </div>

          {/* Frequency */}
          <div>
            <FieldLabel required>{td('schedreports.modal.frequency', 'Frequency')}</FieldLabel>
            <SegmentedControl
              ariaLabel={td('schedreports.modal.frequency', 'Frequency')}
              size="sm"
              value={form.frequency}
              onChange={(v) => setForm(f => ({ ...f, frequency: v }))}
              options={FREQUENCIES.map(fr => ({ value: fr.value, label: td(`schedreports.frequencies.${fr.value}`, fr.label) }))}
            />
          </div>

          {/* One-off: exact date + time */}
          {form.frequency === 'once' && (
            <div>
              <FieldLabel htmlFor="sr-run-at" required>{td('schedreports.modal.runAt', 'Run on (date & time)')}</FieldLabel>
              <input id="sr-run-at"
                type="datetime-local"
                value={form.run_at}
                onChange={e => setForm(f => ({ ...f, run_at: e.target.value }))}
                className={INPUT_CLASS}
              />
            </div>
          )}

          {/* Recurring: day selectors */}
          {form.frequency === 'weekly' && (
            <div>
              <FieldLabel htmlFor="sr-dow" required>{td('schedreports.modal.dayOfWeek', 'Day of Week')}</FieldLabel>
              <SelectField id="sr-dow" value={form.day_of_week} onChange={v => setForm(f => ({ ...f, day_of_week: parseInt(v, 10) }))}>
                {DAYS_OF_WEEK.map(d => (
                  <option key={d} value={d}>{td(`schedreports.daysOfWeek.${d}`, DAY_LABELS[d])}</option>
                ))}
              </SelectField>
            </div>
          )}
          {form.frequency === 'monthly' && (
            <div>
              <FieldLabel htmlFor="sr-dom" required>{td('schedreports.modal.dayOfMonth', 'Day of Month')}</FieldLabel>
              <input id="sr-dom"
                type="number" min={1} max={28} value={form.day_of_month}
                onChange={e => setForm(f => ({ ...f, day_of_month: Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 1)) }))}
                className={INPUT_CLASS}
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">{td('schedreports.modal.dayOfMonthHint', 'Capped at 28 so every month has this day.')}</p>
            </div>
          )}

          {/* Recurring: time + optional start date */}
          {form.frequency !== 'once' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="sr-time" required>{td('schedreports.modal.timeOfDay', 'Time of Day')}</FieldLabel>
                <input id="sr-time" type="time" value={form.time_of_day} onChange={e => setForm(f => ({ ...f, time_of_day: e.target.value }))} className={INPUT_CLASS} />
              </div>
              <div>
                <FieldLabel htmlFor="sr-start">{td('schedreports.modal.startDate', 'Start Date')}</FieldLabel>
                <input id="sr-start" type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={INPUT_CLASS} />
              </div>
            </div>
          )}

          {/* Coverage period */}
          <div>
            <FieldLabel htmlFor="sr-period" required>{td('schedreports.modal.period', 'Report Covers')}</FieldLabel>
            <SelectField id="sr-period" value={form.period} onChange={v => setForm(f => ({ ...f, period: v }))}>
              {PERIODS.map(p => (
                <option key={p.value} value={p.value}>{td(`schedreports.periods.${p.value}`, p.label)}</option>
              ))}
            </SelectField>
            {form.period === 'custom' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <FieldLabel htmlFor="sr-from" required>{td('schedreports.modal.from', 'From')}</FieldLabel>
                  <input id="sr-from" type="date" value={form.period_from} onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))} className={INPUT_CLASS} />
                </div>
                <div>
                  <FieldLabel htmlFor="sr-to" required>{td('schedreports.modal.to', 'To')}</FieldLabel>
                  <input id="sr-to" type="date" value={form.period_to} onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))} className={INPUT_CLASS} />
                </div>
              </div>
            )}
          </div>

          {/* Output formats */}
          <div>
            <FieldLabel required>{td('schedreports.modal.outputFormats', 'Output Format')}</FieldLabel>
            <div className="flex gap-2">
              {OUTPUT_FORMATS.map(o => {
                const active = form.output_formats.includes(o.value)
                const Icon = o.value === 'excel' ? FileSpreadsheet : FileText
                return (
                  <button
                    key={o.value} type="button" onClick={() => toggleFormat(o.value)}
                    className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      active ? 'bg-orange-500/15 border-orange-500 text-orange-300' : 'bg-[var(--surface-3)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />{o.label}
                    {active && <CheckCircle className="w-3.5 h-3.5" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Recipients */}
          <div>
            <FieldLabel htmlFor="sr-recipients" required>{td('schedreports.modal.recipients', 'Recipients')}</FieldLabel>
            <textarea id="sr-recipients"
              rows={3}
              placeholder={'manager@company.com\nexecutive@company.com'}
              value={form.recipients_raw}
              onChange={e => { setForm(f => ({ ...f, recipients_raw: e.target.value })); setFormError('') }}
              className={`${INPUT_CLASS} placeholder-gray-500 resize-none font-mono`}
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">{td('schedreports.modal.recipientsHint', 'One email address per line - scheduled deliveries e-mail these recipients.')}</p>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between bg-[var(--surface-3)] rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{td('schedreports.modal.activeSchedule', 'Active Schedule')}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{td('schedreports.modal.activeScheduleDesc', 'Reports are delivered automatically when enabled')}</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, active: !f.active }))}
              role="switch"
              aria-checked={!!form.active}
              aria-label={td('schedreports.modal.activeSchedule', 'Active Schedule')}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.active ? 'bg-orange-500' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.active ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {formError && (
            <p className="text-xs text-red-400 flex items-start gap-1">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />{formError}
            </p>
          )}

          {/* Approval & Workflow Engine — publishing sign-off before edits lock. */}
          {record?.id && (
            <EntityApprovalPanel
              entityType="report_publish"
              entityId={record.id}
              entityLabel={record.name || record.report_type || record.id}
              context={{
                report_type: record.report_type,
                frequency: record.frequency,
                recipients: record.recipients,
                status: record.active ? 'active' : 'inactive',
                site: record.site,
              }}
              onStateChange={onWfStateChange}
              title="Report Publishing Approval"
            />
          )}
          {wfLocked && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Lock className="w-3 h-3" /> {td('schedreports.modal.locked', 'Locked, in approval')}
            </div>
          )}
        </div>
    </DialogModal>
  )
}

function DeleteConfirmModal({ schedule, onCancel, onConfirm, deleting, td }) {
  return (
    <DialogModal
      open
      onClose={deleting ? undefined : onCancel}
      size="sm"
      title={td('schedreports.delete.title', 'Delete Schedule')}
      subtitle={td('schedreports.delete.subtitle', 'This action cannot be undone')}
      footer={(
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={deleting} className="px-4 min-h-[44px] disabled:opacity-50 text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-3)] hover:bg-[var(--surface-2)] rounded-lg transition-colors">
            {td('schedreports.delete.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm} disabled={deleting}
            className="px-4 min-h-[44px] text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
            {td('schedreports.delete.confirm', 'Delete')}
          </button>
        </div>
      )}
    >
      <p className="text-[var(--text-secondary)] text-sm">
        {td('schedreports.delete.questionPrefix', 'Are you sure you want to delete "')}
        <span className="text-[var(--text-primary)] font-medium">{schedule?.name}</span>
        {td('schedreports.delete.questionSuffix', '"? Recipients will no longer receive this report.')}
      </p>
    </DialogModal>
  )
}

function DeliveryStatusPill({ status, td }) {
  const ok = status === 'sent'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
      ok ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
      {ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
      {ok ? td('schedreports.delivery.sent', 'Sent') : td('schedreports.delivery.failedShort', 'Failed')}
    </span>
  )
}

/** Expandable delivery-history panel: recent report_send_log runs in a sortable register. */
function DeliveryHistory({ runs, summary, loading, error, open, onToggle, onRefresh, td }) {
  const rows = useMemo(() => deliveryRows(runs), [runs])
  const columns = useMemo(() => [
    { id: 'schedule', header: td('schedreports.history.colSchedule', 'Schedule'), accessorFn: (r) => r.schedule, size: 220,
      cell: ({ getValue }) => <span className="text-[var(--text-primary)] block max-w-[16rem] truncate" title={getValue()}>{getValue()}</span> },
    { id: 'sent_at', header: td('schedreports.history.colWhen', 'When'), accessorFn: (r) => r.sent_at, size: 140,
      meta: { exportValue: (r) => r.sent_at || 'N/A' },
      cell: ({ row }) => <span className="text-[var(--text-secondary)] whitespace-nowrap tabular-nums">{formatRunStamp(row.original.sent_at) || 'N/A'}</span> },
    { id: 'status', header: td('schedreports.history.colStatus', 'Status'), accessorFn: (r) => r.status, size: 110, meta: { filterVariant: 'select' },
      cell: ({ row }) => <DeliveryStatusPill status={row.original.raw.status} td={td} /> },
    { id: 'recipients', header: td('schedreports.history.colRecipients', 'Recipients'), accessorFn: (r) => r.recipients, size: 110, meta: { align: 'right' },
      cell: ({ getValue }) => <span className="text-[var(--text-secondary)] tabular-nums">{getValue()}</span> },
    { id: 'reason', header: td('schedreports.history.colReason', 'Reason'), accessorFn: (r) => r.reason, size: 280,
      cell: ({ row }) => (row.original.raw.status === 'sent'
        ? <span className="text-[var(--text-dim)] text-xs">N/A</span>
        : <span className="text-[var(--text-muted)] text-xs block max-w-[20rem] truncate" title={row.original.raw.error || undefined}>{row.original.reason}</span>) },
  ], [td])

  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-3 min-w-0 flex-1 text-left min-h-[44px] rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
        >
          <div className="w-10 h-10 rounded-xl bg-[var(--surface-3)] flex items-center justify-center flex-shrink-0">
            <History className="w-5 h-5 text-[var(--text-secondary)]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[var(--text-primary)] font-semibold flex items-center gap-2">
              {td('schedreports.history.title', 'Delivery history')}
              <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </p>
            <p className="text-[var(--text-secondary)] text-xs mt-0.5">
              {summary && summary.total > 0
                ? td('schedreports.history.summary', '{total} runs | {sent} sent | {failed} failed (last 70 days)', {
                  total: summary.total, sent: summary.sent, failed: summary.failed,
                })
                : td('schedreports.history.subtitle', 'Recent scheduled report deliveries (last 70 days)')}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title={td('schedreports.history.refresh', 'Refresh delivery history')}
          aria-label={td('schedreports.history.refresh', 'Refresh delivery history')}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50 flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
        >
          <RefreshCw className={`w-4 h-4 text-[var(--text-secondary)] ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--border-bright)] p-4">
          {!loading && !error && rows.length === 0 ? (
            <div className="px-5 py-10 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-xl bg-[var(--surface-3)] flex items-center justify-center mb-3">
                <History className="w-6 h-6 text-[var(--text-dim)]" aria-hidden="true" />
              </div>
              <p className="text-[var(--text-primary)] font-medium text-sm">{td('schedreports.history.emptyTitle', 'No deliveries yet')}</p>
              <p className="text-[var(--text-secondary)] text-xs mt-1 max-w-sm">
                {td('schedreports.history.emptyDesc', 'Once a scheduled report runs or you use Send now, each delivery attempt appears here.')}
              </p>
            </div>
          ) : (
            <EnterpriseTable
              columns={columns}
              data={rows}
              getRowId={(r) => String(r.id)}
              loading={loading}
              error={error || null}
              onRetry={onRefresh}
              searchPlaceholder={td('schedreports.history.search', 'Search deliveries...')}
              emptyMessage={td('schedreports.history.emptyTitle', 'No deliveries yet')}
              initialPageSize={25}
              viewKey="scheduled-reports-deliveries"
              exportFileName={reportFileName('Report Delivery History', reportDateLabel())}
              reportMeta={{ title: 'Scheduled Report Delivery History' }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ScheduledReports() {
  const { profile } = useAuth()
  const td = useT()
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const { branding, orgName } = useTenant()

  const reportCompany = branding?.legal_name || branding?.display_name || appSettings?.company_name || orgName || 'TyrePulse'

  const location = useLocation()
  const navigate = useNavigate()
  const [presetApplied, setPresetApplied] = useState(false)
  const [schedules, setSchedules] = useState([])
  const [layouts, setLayouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  // Delivery history (report_send_log) — read-only, reuses the aiOps job reader.
  const [jobRuns, setJobRuns] = useState([])
  const [jobSummary, setJobSummary] = useState(null)
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(null) // schedule id | 'form' | null
  const [sendingNow, setSendingNow] = useState(null) // schedule id | null

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [wfLocked, setWfLocked] = useState(false)

  const [filterFreq, setFilterFreq] = useState('all')
  const [filterActive, setFilterActive] = useState('all')
  const [filterModule, setFilterModule] = useState('')
  const [filterFormat, setFilterFormat] = useState('')
  const [filterRecipient, setFilterRecipient] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('list')

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSchedules(await listSchedules())
    } catch (e) {
      setError(toUserMessage(e, 'Could not load scheduled reports.'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Delivery history / last-status: one read of report_send_log via aiOps.
  const fetchJobRuns = useCallback(async () => {
    setJobsLoading(true)
    setJobsError(null)
    try {
      const rows = await aiOps.listJobRuns({ days: HISTORY_DAYS, limit: 1000 })
      setJobRuns(rows)
      setJobSummary(aiOps.summarizeJobs(rows))
    } catch (e) {
      setJobsError(toUserMessage(e))
    } finally {
      setJobsLoading(false)
    }
  }, [])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])
  useEffect(() => { fetchJobRuns() }, [fetchJobRuns])
  // Saved Report Builder layouts are schedulable like any built-in type.
  useEffect(() => { listSchedulableLayouts().then(setLayouts).catch(() => setLayouts([])) }, [])

  // Match each schedule to its delivery health by schedule id.
  const healthById = useMemo(() => {
    const m = new Map()
    for (const h of jobSummary?.bySchedule ?? []) {
      if (h.schedule_id) m.set(h.schedule_id, h)
    }
    return m
  }, [jobSummary])
  useEffect(() => { setWfLocked(false) }, [editTarget?.id])

  // Human label for any report type, including builder:<template-id> schedules.
  const typeLabelFor = useCallback((type) => {
    if (isBuilderType(type)) {
      const l = layouts.find(x => x.value === type)
      return l ? l.label : td('schedreports.reportTypes.builder', 'Custom layout')
    }
    return td(`schedreports.reportTypes.${type}`, REPORT_LABEL[type] || type)
  }, [layouts, td])
  useEffect(() => { if (!toast) return undefined; const id = setTimeout(() => setToast(null), 4500); return () => clearTimeout(id) }, [toast])

  // ── Modal helpers ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditTarget(null); setForm(BLANK_FORM); setFormError(''); setModalOpen(true)
  }

  const openEdit = (s) => {
    setEditTarget(s)
    setForm({
      name: s.name || '',
      report_type: s.report_type || 'executive',
      frequency: s.frequency || 'weekly',
      day_of_week: s.day_of_week ?? 1,
      day_of_month: s.day_of_month ?? 1,
      time_of_day: s.time_of_day ?? '07:00',
      run_at: s.run_at ? new Date(s.run_at).toISOString().slice(0, 16) : '',
      start_date: s.start_date ?? '',
      period: s.period ?? 'last_30',
      period_from: s.period_from ?? '',
      period_to: s.period_to ?? '',
      output_formats: s.output_formats?.length ? s.output_formats : ['pdf'],
      recipients_raw: (s.recipients ?? []).join('\n'),
      active: s.active ?? true,
    })
    setFormError(''); setModalOpen(true)
  }

  const closeModal = () => { setModalOpen(false); setEditTarget(null); setFormError('') }

  // Deep-link entry (e.g. Accidents -> Analytics -> "Auto-email"): open the
  // create modal pre-selected on the passed report type so the user only sets
  // cadence + recipients. For builder layouts, wait until the layout list has
  // loaded so the option resolves. The preset is consumed once (history state
  // cleared) so a refresh does not reopen the modal.
  useEffect(() => {
    const preset = location.state?.presetReportType
    if (!preset || presetApplied) return
    if (isBuilderType(preset) && layouts.length === 0) return
    setEditTarget(null)
    setForm({ ...BLANK_FORM, report_type: preset, name: location.state?.presetName || '' })
    setFormError('')
    setModalOpen(true)
    setPresetApplied(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location, layouts, presetApplied, navigate])

  // ── Validation ───────────────────────────────────────────────────────────────
  function validateForm(f) {
    if (!f.name.trim()) return td('schedreports.errors.nameRequired', 'Give the schedule a name.')
    if (f.frequency === 'once' && !f.run_at) return td('schedreports.errors.runAtRequired', 'Pick the exact date & time to run.')
    if (f.period === 'custom') {
      if (!f.period_from || !f.period_to) return td('schedreports.errors.customRangeRequired', 'Set both From and To dates for a custom coverage window.')
      if (f.period_from > f.period_to) return td('schedreports.errors.rangeOrder', 'The From date must be on or before the To date.')
    }
    if (!f.output_formats.length) return td('schedreports.errors.formatRequired', 'Choose at least one output format.')
    const { emails, invalid } = validateEmails(f.recipients_raw)
    if (invalid.length) return td('schedreports.errors.invalidEmails', 'Invalid email(s): {list}', { list: invalid.join(', ') })
    if (!emails.length) return td('schedreports.errors.recipientRequired', 'At least one recipient is required.')
    return null
  }

  function buildPayload(f) {
    const { emails } = validateEmails(f.recipients_raw)
    return {
      name: f.name.trim(),
      report_type: f.report_type,
      frequency: f.frequency,
      day_of_week: f.frequency === 'weekly' ? f.day_of_week : null,
      day_of_month: f.frequency === 'monthly' ? f.day_of_month : null,
      time_of_day: f.frequency === 'once' ? (f.run_at.slice(11, 16) || '07:00') : f.time_of_day,
      run_at: f.frequency === 'once' && f.run_at ? new Date(f.run_at).toISOString() : null,
      start_date: f.frequency !== 'once' && f.start_date ? f.start_date : null,
      period: f.period,
      period_from: f.period === 'custom' ? (f.period_from || null) : null,
      period_to: f.period === 'custom' ? (f.period_to || null) : null,
      output_formats: f.output_formats,
      recipients: emails,
      active: f.active,
      next_run_at: computeNextRun(f),
      // Never write a null org: an edit must not wipe the stored tenant, and a
      // null-org schedule's digest reads across every organisation.
      ...(scheduleOrgId(profile) ? { org_id: scheduleOrgId(profile) } : {}),
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (editTarget && wfLocked) return
    const err = validateForm(form)
    if (err) { setFormError(err); return }
    setSaving(true)
    try {
      const payload = buildPayload(form)
      if (editTarget) {
        await updateSchedule(editTarget.id, payload)
      } else {
        await createSchedule({ ...payload, created_by: profile?.id ?? null })
      }
      closeModal()
      fetchSchedules()
      setToast({ type: 'ok', text: td('schedreports.toast.saved', 'Schedule saved') })
    } catch (e) {
      setFormError(toUserMessage(e, 'Could not save the schedule.'))
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle active ─────────────────────────────────────────────────────────
  const handleToggle = async (s) => {
    const next_run_at = !s.active ? computeNextRun(s) : s.next_run_at
    setSchedules(prev => prev.map(x => x.id === s.id ? { ...x, active: !x.active, next_run_at } : x))
    try {
      await updateSchedule(s.id, { active: !s.active, next_run_at })
    } catch (e) {
      setSchedules(prev => prev.map(x => x.id === s.id ? s : x))
      setError(toUserMessage(e, 'Could not update the schedule.'))
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSchedule(deleteTarget.id)
      setSchedules(prev => prev.filter(s => s.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      setError(toUserMessage(e, 'Could not delete the schedule.'))
    } finally {
      setDeleting(false)
    }
  }

  // ── On-demand generation (live data → branded PDF / Excel) ──────────────────
  const handleGenerate = async (cfg) => {
    const isForm = !cfg.id
    const busyKey = isForm ? 'form' : cfg.id
    setGenerating(busyKey)
    setToast(null)
    try {
      const { from, to, label } = resolvePeriod(cfg.period, cfg.period_from, cfg.period_to)
      const { rows, dataset } = await fetchReportRows(cfg.report_type, { from, to, country: activeCountry })
      const typeLabel = typeLabelFor(cfg.report_type)
      const base = reportFileName(reportCompany, dataset.title, reportDateLabel())
      const formats = cfg.output_formats?.length ? cfg.output_formats : ['pdf']

      // Inspection Summary carries one more thing than a plain record list:
      // how many inspections each tyre man completed, on which vehicle type,
      // over the coverage window (most usefully "Yesterday" for a same-day
      // "what got done" run) - see src/lib/inspectionCoverage.js.
      const inspectionTable = cfg.report_type === 'inspection'
        ? tyreManVehicleTypeTable(tyreManVehicleTypeSummary(rows))
        : null

      if (formats.includes('pdf') && isBuilderType(cfg.report_type)) {
        // Saved Report Builder layout: render the template's exact block design
        // (header/KPIs/charts/insights/tables) over the covered accident rows.
        const template = await getTemplate(builderTemplateId(cfg.report_type))
        const { renderAccidentReportPdf } = await import('../lib/accidentReportPdf')
        await renderAccidentReportPdf({
          config: template.config,
          records: rows,
          company: reportCompany,
          currency: activeCurrency,
          subtitle: label,
          filename: reportFileName(reportCompany, template.name || 'Custom Report', reportDateLabel()),
        })
      } else if (formats.includes('pdf')) {
        await exportToPdf(
          rows,
          dataset.cols.map((k, i) => ({ key: k, header: dataset.headers[i] })),
          `${dataset.title} | ${label}`,
          base, 'landscape', reportCompany,
          {
            currency: activeCurrency, branding, dateRange: label,
            emptyHint: td('schedreports.gen.emptyHint', 'No records in the selected coverage window. Widen the period or clear the country filter.'),
            ...(inspectionTable ? {
              extraTable: {
                title: td('schedreports.gen.inspectionTableTitle', 'Completed inspections by tyre man and vehicle type'),
                columns: inspectionTable.columns.map((k, i) => ({ key: k, header: inspectionTable.headers[i] })),
                rows: inspectionTable.rows,
              },
            } : {}),
          },
        )
      }
      if (formats.includes('excel')) {
        // Excel sheet names must avoid : \ / ? * [ ] and stay <= 31 chars.
        const sheetName = dataset.title.replace(/[:\\/?*[\]]/g, '-').slice(0, 28)
        const excelMeta = {
          title: dataset.title, company: reportCompany, dateRange: label, currency: activeCurrency,
          meta: {
            'Report type': typeLabel,
            'Coverage period': label,
            Scope: activeCountry === 'All' ? td('schedreports.gen.allCountries', 'All countries') : activeCountry,
          },
        }
        if (inspectionTable) {
          // Two tabs: the tyre man / vehicle type completion pivot first (the
          // "how many done" answer), then the raw record list behind it.
          await exportSheetsToExcel(
            [
              {
                name: 'Tyre Man Summary',
                rows: inspectionTable.rows,
                columns: inspectionTable.columns,
                headers: inspectionTable.headers,
                note: 'Completed inspections grouped by tyre man and vehicle type.',
              },
              {
                name: sheetName,
                rows, columns: dataset.cols, headers: dataset.headers,
                note: 'Every inspection record in the coverage window.',
              },
            ],
            base, excelMeta,
          )
        } else {
          await exportToExcel(rows, dataset.cols, dataset.headers, base, sheetName, excelMeta)
        }
      }

      setToast({
        type: rows.length ? 'ok' : 'warn',
        text: rows.length
          ? td('schedreports.toast.generated', 'Generated {type} | {n} records', { type: typeLabel, n: rows.length })
          : td('schedreports.toast.generatedEmpty', 'Generated {type} - no records in range (empty report)', { type: typeLabel }),
      })
    } catch (e) {
      setToast({ type: 'err', text: toUserMessage(e, td('schedreports.toast.genFailed', 'Report generation failed')) })
    } finally {
      setGenerating(null)
    }
  }

  // ── Send now (email the report to its recipients immediately) ─────────────
  const handleSendNow = async (s) => {
    setSendingNow(s.id)
    setToast(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('send-scheduled-reports', {
        body: { schedule_id: s.id },
      })
      if (fnError) {
        // FunctionsHttpError carries the response; surface the server's reason.
        let msg = fnError.message
        try { const body = await fnError.context?.json?.(); if (body?.error) msg = body.error } catch { /* keep generic */ }
        throw new Error(msg || 'Send failed')
      }
      if (data?.error) throw new Error(data.error)
      const stamp = new Date().toISOString()
      setSchedules(prev => prev.map(x => (x.id === s.id ? { ...x, last_sent_at: stamp } : x)))
      fetchJobRuns() // the edge fn logs this delivery to report_send_log
      setToast({
        type: 'ok',
        text: td('schedreports.toast.sentNow', 'Report emailed to {n} recipient(s)', { n: data?.recipients ?? (s.recipients ?? []).length }),
      })
    } catch (e) {
      setToast({ type: 'err', text: toUserMessage(e, td('schedreports.toast.sendFailed', 'Send failed')) })
    } finally {
      setSendingNow(null)
    }
  }

  // ── Filtered view ─────────────────────────────────────────────────────────
  const now = useMemo(() => Date.now(), [schedules, jobRuns]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = useMemo(() => {
    const base = filterSchedules(schedules, { search, frequency: filterFreq, status: 'all', typeLabelFor })
    return filterRegistry(base, { module: filterModule, format: filterFormat, recipient: filterRecipient, status: filterActive === 'all' ? '' : filterActive }, { runs: jobRuns, now })
  }, [schedules, search, filterFreq, filterActive, filterModule, filterFormat, filterRecipient, typeLabelFor, jobRuns, now])
  const kpis = useMemo(() => scheduleKpis(schedules, jobRuns), [schedules, jobRuns])
  const reg = useMemo(() => registryKpis(schedules, jobRuns, { now, windowStart: now - HISTORY_DAYS * 86400000 }), [schedules, jobRuns, now])
  const health = useMemo(() => healthSegments(schedules, jobRuns, now), [schedules, jobRuns, now])
  const trend = useMemo(() => deliveryTrend(jobRuns, schedules, now, 7), [jobRuns, schedules, now])
  const activity = useMemo(() => recentActivity(jobRuns, 5), [jobRuns])
  const latestRun = useMemo(() => latestRunBySchedule(jobRuns), [jobRuns])
  const recipientsList = useMemo(() => recipientOptions(schedules), [schedules])
  const anyFilter = search || filterFreq !== 'all' || filterActive !== 'all' || filterModule || filterFormat || filterRecipient
  const resetFilters = () => { setSearch(''); setFilterFreq('all'); setFilterActive('all'); setFilterModule(''); setFilterFormat(''); setFilterRecipient('') }

  const exportSchedules = async (kind) => {
    const rows = scheduleExportRows(filtered, { typeLabelFor, health: healthById })
    const name = reportFileName('Scheduled Reports', reportDateLabel())
    try {
      if (kind === 'pdf') {
        await exportToPdf(rows, SCHEDULE_EXPORT_KEYS.map((k, i) => ({ key: k, header: SCHEDULE_EXPORT_HEADERS[i] })), 'Scheduled Reports', name, 'landscape', reportCompany)
      } else {
        await exportToExcel(rows, SCHEDULE_EXPORT_KEYS, SCHEDULE_EXPORT_HEADERS, name, 'Schedules')
      }
    } catch (e) {
      setToast({ type: 'err', text: toUserMessage(e, 'Export failed. Please try again.') })
    }
  }

  const deliveriesBlocked = Boolean(jobsError)
  const kpiTiles = [
    { icon: FileText, tone: 't-blue', value: loading ? null : reg.total, label: <KpiLabel title="Total schedules" sub={schedules.some((s) => isBuilderType(s.report_type)) ? 'Includes custom layouts' : 'Automated report schedules'} /> },
    { icon: CheckCircle, tone: 't-green', value: loading ? null : reg.active, label: <KpiLabel title="Active schedules" sub={reg.activePct == null ? 'No schedules yet' : `${reg.activePct}% of schedules running`} />, onClick: () => setFilterActive('active') },
    { icon: Send, tone: 't-purple', display: deliveriesBlocked ? 'N/A' : undefined, value: jobsLoading ? null : reg.deliveries, trend: reg.deliveriesTrend, label: <KpiLabel title="Deliveries (this month)" sub={deliveriesBlocked ? 'Delivery log could not be read' : reg.successPct == null ? 'No deliveries this month' : `${reg.successPct}% successful`} />, title: reg.deliveriesTrend == null ? 'Change vs last month is shown only when last month had deliveries' : 'Change vs last month' },
    { icon: AlertCircle, tone: 't-red', display: deliveriesBlocked ? 'N/A' : undefined, value: jobsLoading ? null : reg.failed, trend: reg.failedTrend, goodWhenUp: false, danger: reg.failed > 0, label: <KpiLabel title="Failed runs (this month)" sub={kpis.failingSchedules ? `${kpis.failingSchedules} schedule${kpis.failingSchedules === 1 ? '' : 's'} need attention` : 'No schedule failing now'} />, onClick: () => setFilterActive('failing') },
    { icon: Users, tone: 't-amber', value: loading ? null : reg.recipients, label: <KpiLabel title="Recipients" sub="Unique addresses on active schedules" /> },
  ]

  const columns = [
    {
      key: 'name', header: 'Report name', sortValue: (s) => s.name || '',
      cell: (s) => {
        const { Icon } = iconCfgFor(s.report_type)
        return (
          <span className="sr-name">
            <span className={`sr-name-icon ${isBuilderType(s.report_type) ? 'is-custom' : ''}`}><Icon size={15} aria-hidden="true" /></span>
            <span className="sr-name-copy"><b title={s.name}>{s.name || 'Unnamed schedule'}</b><small>{typeLabelFor(s.report_type)}</small></span>
          </span>
        )
      },
    },
    { key: 'module', header: 'Module', sortValue: (s) => moduleOf(s.report_type), cell: (s) => moduleOf(s.report_type) },
    {
      key: 'schedule', header: 'Schedule', sortValue: (s) => s.frequency || '',
      cell: (s) => { const l = scheduleLabel(s); return <span className="sr-two"><b>{l.line1}</b><small>{l.line2}</small></span> },
    },
    {
      key: 'recipients', header: 'Recipients', numeric: true, sortValue: (s) => (s.recipients || []).length,
      cell: (s) => { const r = s.recipients || []; return <span title={r.join(', ')}>{fmtInt(r.length)}</span> },
    },
    {
      key: 'format', header: 'Format', sortable: false,
      cell: (s) => <span className="sr-formats">{(s.output_formats?.length ? s.output_formats : ['pdf']).map((f) => <span key={f} className={`sr-fmt ${f}`}>{f === 'excel' ? 'XLS' : f.toUpperCase()}</span>)}</span>,
    },
    {
      key: 'status', header: 'Status', sortValue: (s) => scheduleStatus(s, latestRun.get(s.id), now),
      cell: (s) => { const m = STATUS_META[scheduleStatus(s, latestRun.get(s.id), now)]; return <span className={`cc-pill ${m.tone}`}>{m.label}</span> },
    },
    {
      key: 'last', header: 'Last run', sortValue: (s) => latestRun.get(s.id)?.sent_at || s.last_sent_at || '',
      cell: (s) => {
        const r = latestRun.get(s.id)
        if (!r) return s.last_sent_at ? <span className="sr-two"><b>{formatRunStamp(s.last_sent_at)}</b><small>Not in the last {HISTORY_DAYS} days log</small></span> : <span className="cc-na">Never run</span>
        const ok = r.status === 'sent'
        return (
          <span className="sr-two" title={ok ? undefined : (r.error || undefined)}>
            <b>{formatRunStamp(r.sent_at)}</b>
            <small className={ok ? 'sr-ok' : 'sr-bad'}>{ok ? <CheckCircle size={11} aria-hidden="true" /> : <XCircle size={11} aria-hidden="true" />} {ok ? 'Success' : 'Failed'}</small>
          </span>
        )
      },
    },
    {
      key: 'next', header: 'Next run', sortValue: (s) => (s.active ? s.next_run_at || '' : ''),
      cell: (s) => (s.active && s.next_run_at ? <span className="sr-nowrap">{formatNextRun(s.next_run_at, td, now)}</span> : <span className="cc-na">{s.active ? 'Not scheduled' : 'Paused'}</span>),
    },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (s) => (
        <span className="sr-actions" onClick={(e) => e.stopPropagation()} role="presentation">
          <button type="button" className="sr-run" onClick={() => handleSendNow(s)} disabled={sendingNow === s.id} title="Email this report to its recipients now">
            {sendingNow === s.id ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />} Run now
          </button>
          <button type="button" className="cc-icon-btn" onClick={() => handleGenerate(s)} disabled={generating === s.id} aria-label={`Generate and download: ${s.name || ''}`} title="Generate and download now">
            {generating === s.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
          <button type="button" className="cc-icon-btn" onClick={() => handleToggle(s)} aria-pressed={!!s.active} aria-label={`${s.active ? 'Pause' : 'Activate'}: ${s.name || ''}`} title={s.active ? 'Pause' : 'Activate'}>
            {s.active ? <PauseCircle size={14} /> : <Play size={14} />}
          </button>
          <button type="button" className="cc-icon-btn" onClick={() => openEdit(s)} aria-label={`Edit: ${s.name || ''}`} title="Edit"><Edit2 size={14} /></button>
          <button type="button" className="cc-icon-btn sr-danger" onClick={() => setDeleteTarget(s)} aria-label={`Delete: ${s.name || ''}`} title="Delete"><Trash2 size={14} /></button>
        </span>
      ),
    },
  ]

  const nowDate = new Date(now)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cc sr-page">
      {toast && (
        <div role={toast.type === 'ok' ? 'status' : 'alert'} aria-live="polite" className={`sr-toast ${toast.type}`}>
          {toast.type === 'ok' ? <CheckCircle size={16} aria-hidden="true" /> : toast.type === 'warn' ? <AlertTriangle size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
          <span>{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss message" className="sr-toast-x"><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      <header className="sr-head">
        <div className="sr-head-main">
          <span className="sr-head-icon" aria-hidden="true"><CalendarDays size={26} /></span>
          <div className="sr-head-copy">
            <nav aria-label="Breadcrumb" className="sr-crumb">Analytics and Reports <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">{td('schedreports.header.title', 'Scheduled Reports')}</span></nav>
            <h1>{td('schedreports.header.title', 'Scheduled Reports')}</h1>
            <p>Automate and manage scheduled reports with flexible coverage, formats and delivery.</p>
          </div>
        </div>
        <div className="sr-head-actions">
          <div className="sr-today" aria-label="Today">
            <CalendarDays size={18} aria-hidden="true" />
            <span><b>{nowDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</b><small>{nowDate.toLocaleDateString('en-GB', { weekday: 'short' })} {nowDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></span>
          </div>
          <button type="button" className="cc-btn-ghost" onClick={() => exportSchedules('excel')} disabled={loading || filtered.length === 0}><FileSpreadsheet size={15} aria-hidden="true" /> Excel</button>
          <button type="button" className="cc-icon-btn" onClick={() => exportSchedules('pdf')} disabled={loading || filtered.length === 0} aria-label="Export schedules to PDF" title="Export to PDF"><FileText size={14} /></button>
          <button type="button" className="cc-btn-primary sr-new" onClick={openCreate}><Plus size={16} aria-hidden="true" /> {td('schedreports.header.newSchedule', 'New Schedule')}</button>
        </div>
      </header>

      {error && (
        <div role="alert" className="cc-card sr-banner">
          <AlertCircle size={18} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="cc-btn-ghost" onClick={fetchSchedules}><RefreshCw size={14} aria-hidden="true" /> Retry</button>
          <button type="button" className="cc-icon-btn" onClick={() => setError(null)} aria-label="Dismiss error"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis sr-kpis">
        {kpiTiles.map((k, i) => <Kpi key={i} {...k} loading={k.value == null && k.display == null} />)}
      </div>

      <div className="cc-card sr-filterbar">
        <div className="cc-filters sr-filters">
          <label className="cc-search">
            <Search size={15} aria-hidden="true" />
            <input type="search" aria-label="Search scheduled reports" placeholder="Search scheduled reports, types, recipients" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="cc-select" aria-label="Module" value={filterModule} onChange={(e) => setFilterModule(e.target.value)}>
            <option value="">All modules</option>
            {MODULE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className="cc-select" aria-label="Frequency" value={filterFreq} onChange={(e) => setFilterFreq(e.target.value)}>
            <option value="all">All schedules</option>
            {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{td(`schedreports.frequencies.${f.value}`, f.label)}</option>)}
          </select>
          <select className="cc-select" aria-label="Format" value={filterFormat} onChange={(e) => setFilterFormat(e.target.value)}>
            <option value="">All formats</option>
            {OUTPUT_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select className="cc-select" aria-label="Recipient" value={filterRecipient} onChange={(e) => setFilterRecipient(e.target.value)}>
            <option value="">All recipients</option>
            {recipientsList.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="cc-select" aria-label="Status" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
            <option value="all">All status</option>
            {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <button type="button" className="cc-btn-ghost" onClick={resetFilters} disabled={!anyFilter}>Reset</button>
          <div className="sr-viewtoggle" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label="List view" title="List view"><List size={15} /></button>
            <button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} aria-label="Card view" title="Card view"><LayoutGrid size={15} /></button>
          </div>
        </div>
      </div>

      <Card title={<>Schedule registry <span className="sr-count">({fmtInt(filtered.length)}{filtered.length !== schedules.length ? ` of ${fmtInt(schedules.length)}` : ''})</span></>}
        action={<button type="button" className="cc-icon-btn" onClick={() => { fetchSchedules(); fetchJobRuns() }} aria-label="Refresh" title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>}>
        {!loading && !error && schedules.length === 0 ? (
          <div className="cc-empty">
            <div>
              <b>{td('schedreports.empty.noSchedulesTitle', 'No schedules yet')}</b>
              <p className="sr-muted">{td('schedreports.empty.noSchedulesDesc', 'Set up automated fleet and tyre reports and have them generated and delivered on your schedule.')}</p>
              <button type="button" className="cc-btn-primary" onClick={openCreate}><Plus size={15} aria-hidden="true" /> {td('schedreports.empty.createFirst', 'Create first schedule')}</button>
            </div>
          </div>
        ) : view === 'grid' && !loading ? (
          filtered.length === 0 ? (
            <div className="cc-empty"><div>No schedule matches these filters.<br /><button type="button" className="cc-btn-ghost" onClick={resetFilters}>Clear filters</button></div></div>
          ) : (
            <div className="sr-cards">
              {filtered.map((s) => (
                <ScheduleCard key={s.id} schedule={s} health={healthById.get(s.id)} onEdit={openEdit} onDelete={setDeleteTarget}
                  onToggle={handleToggle} onGenerate={handleGenerate} generating={generating} onSendNow={handleSendNow} sendingNow={sendingNow} td={td} typeLabelFor={typeLabelFor} />
              ))}
            </div>
          )
        ) : (
          <KitTable
            columns={columns}
            rows={filtered}
            loading={loading}
            error={error || null}
            onRetry={fetchSchedules}
            getRowId={(s) => String(s.id)}
            onRowClick={(s) => openEdit(s)}
            empty={anyFilter ? 'No schedule matches these filters.' : 'No schedules yet.'}
          />
        )}
      </Card>

      <div className="sr-bottom">
        <Card title="Schedule health" sub="Status of every schedule right now">
          <CardState state={{ loading, data: loading ? null : schedules, error: null }} empty={!loading && schedules.length === 0 ? 'No schedules yet.' : null}>
            <Donut segments={health} total={schedules.length} centerLabel="Total schedules"
              onSelect={(seg) => setFilterActive(seg.key)} />
          </CardState>
        </Card>

        <Card title="Delivery trend" sub="Last 7 days. Expected comes from current schedule settings.">
          <CardState state={{ loading: jobsLoading, data: jobsLoading ? null : jobRuns, error: jobsError, retry: fetchJobRuns }}>
            <TrendChart points={trend} />
          </CardState>
        </Card>

        <Card title="Recent activity" action={<ViewAll label="View all" onClick={() => setHistoryOpen(true)} />}>
          <CardState state={{ loading: jobsLoading, data: jobsLoading ? null : jobRuns, error: jobsError, retry: fetchJobRuns }}
            empty={!jobsLoading && !jobsError && activity.length === 0 ? `No deliveries in the last ${HISTORY_DAYS} days. Use Run now to send one.` : null}>
            <div className="cc-list">
              {activity.map((a) => (
                <div key={a.id} className="cc-row">
                  <span className={`cc-row-icon sr-act ${a.kind}`} aria-hidden="true">{a.kind === 'sent' ? <CheckCircle size={16} /> : <XCircle size={16} />}</span>
                  <div className="cc-row-main">
                    <div className="cc-row-title" title={a.name}>{a.name} <span className="sr-muted">{a.verb}</span></div>
                    <div className="cc-row-meta" title={a.detail}>{a.detail}</div>
                  </div>
                  <span className="cc-row-time">{formatRunStamp(a.at)}</span>
                </div>
              ))}
            </div>
          </CardState>
        </Card>
      </div>

      <DeliveryHistory
        runs={jobRuns}
        summary={jobSummary}
        loading={jobsLoading}
        error={jobsError}
        open={historyOpen}
        onToggle={() => setHistoryOpen((o) => !o)}
        onRefresh={fetchJobRuns}
        td={td}
      />

      {modalOpen && (
        <ScheduleModal
          title={editTarget ? td('schedreports.modal.editTitle', 'Edit Schedule') : td('schedreports.modal.newTitle', 'New Schedule')}
          onClose={closeModal}
          onSave={handleSave}
          saving={saving}
          form={form}
          setForm={setForm}
          formError={formError}
          setFormError={setFormError}
          onGenerate={handleGenerate}
          generating={generating}
          record={editTarget}
          wfLocked={wfLocked}
          onWfStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
          td={td}
          layouts={layouts}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          schedule={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
          td={td}
        />
      )}
    </div>
  )
}
