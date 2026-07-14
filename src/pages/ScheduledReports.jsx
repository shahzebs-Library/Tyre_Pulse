import { useState, useEffect, useCallback } from 'react'
import {
  Calendar, Clock, Mail, Plus, Edit2, Trash2, Eye, EyeOff,
  FileText, BarChart2, Truck, ClipboardList, DollarSign,
  CheckCircle, XCircle, AlertCircle, AlertTriangle, ChevronDown, X, Save, Lock,
  Package, Building2, Download, Loader2, FileSpreadsheet, CalendarClock, ShieldCheck,
  LayoutTemplate, Send,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import SegmentedControl from '../components/ui/SegmentedControl'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { exportToPdf, exportToExcel } from '../lib/exportUtils'
import {
  REPORT_TYPES, FREQUENCIES, PERIODS, OUTPUT_FORMATS,
  listSchedules, createSchedule, updateSchedule, deleteSchedule,
  computeNextRun, resolvePeriod, fetchReportRows,
  listSchedulableLayouts, isBuilderType, builderTemplateId,
} from '../lib/api/scheduledReports'
import { getTemplate } from '../lib/api/accidentReportTemplates'

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

function formatNextRun(nextRunAt, td) {
  if (!nextRunAt) return '—'
  const d = new Date(nextRunAt)
  if (Number.isNaN(d.getTime())) return '—'
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const diff = d - new Date()
  if (diff < 0) return td('schedreports.time.due', 'Due now')
  if (diff < 24 * 3600_000) return td('schedreports.time.today', 'Today at {time}', { time })
  if (diff < 48 * 3600_000) return td('schedreports.time.tomorrow', 'Tomorrow at {time}', { time })
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })} · ${time}`
}

function formatLastSent(ts, td) {
  if (!ts) return td('schedreports.lastSent.never', 'Never run')
  const d = new Date(ts)
  return td('schedreports.lastSent.label', 'Last run {date} at {time}', {
    date: d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  })
}

function validateEmails(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const invalid = lines.filter(e => !re.test(e))
  return { emails: lines, invalid }
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

function ScheduleCard({ schedule, onEdit, onDelete, onToggle, onGenerate, generating, onSendNow, sendingNow, td, typeLabelFor }) {
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
            onClick={() => onSendNow(schedule)}
            disabled={sending}
            title={td('schedreports.card.sendNow', 'Send now: email this report to its recipients immediately')}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-4 h-4 text-green-400 animate-spin" /> : <Send className="w-4 h-4 text-[var(--text-secondary)] hover:text-green-400" />}
          </button>
          <button
            onClick={() => onGenerate(schedule)}
            disabled={busy}
            title={td('schedreports.card.generate', 'Generate & download now')}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 text-orange-400 animate-spin" /> : <Download className="w-4 h-4 text-[var(--text-secondary)] hover:text-orange-400" />}
          </button>
          <button
            onClick={() => onToggle(schedule)}
            title={schedule.active ? td('schedreports.card.deactivate', 'Deactivate') : td('schedreports.card.activate', 'Activate')}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors"
          >
            {schedule.active ? <Eye className="w-4 h-4 text-green-400" /> : <EyeOff className="w-4 h-4 text-[var(--text-muted)]" />}
          </button>
          <button onClick={() => onEdit(schedule)} className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <Edit2 className="w-4 h-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" />
          </button>
          <button onClick={() => onDelete(schedule)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors">
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

function FieldLabel({ children, required }) {
  return (
    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
      {children}{required && <span className="text-orange-400 ml-1">*</span>}
    </label>
  )
}

const INPUT_CLASS = 'w-full bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30'

function SelectField({ value, onChange, children }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className={`${INPUT_CLASS} appearance-none pr-8`}>
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
    </div>
  )
}

function Modal({ title, onClose, onSave, saving, form, setForm, formError, setFormError, onGenerate, generating, record, wfLocked, onWfStateChange, td, layouts = [] }) {
  const toggleFormat = (fmt) => setForm(f => {
    const has = f.output_formats.includes(fmt)
    const next = has ? f.output_formats.filter(x => x !== fmt) : [...f.output_formats, fmt]
    return { ...f, output_formats: next }
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-bright)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors">
            <X className="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <FieldLabel required>{td('schedreports.modal.scheduleName', 'Schedule Name')}</FieldLabel>
            <input
              type="text"
              placeholder={td('schedreports.modal.namePlaceholder', 'e.g. Weekly Executive Summary')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={`${INPUT_CLASS} placeholder-gray-500`}
            />
          </div>

          {/* Report Type */}
          <div>
            <FieldLabel required>{td('schedreports.modal.reportType', 'Report Type')}</FieldLabel>
            <SelectField value={form.report_type} onChange={v => setForm(f => ({ ...f, report_type: v }))}>
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
                {td('schedreports.modal.builderHint', 'A saved Accident Report Builder layout — “Generate now” renders its exact block design over the covered period. Manage layouts in Accidents → Report Builder.')}
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
              <FieldLabel required>{td('schedreports.modal.runAt', 'Run on (date & time)')}</FieldLabel>
              <input
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
              <FieldLabel required>{td('schedreports.modal.dayOfWeek', 'Day of Week')}</FieldLabel>
              <SelectField value={form.day_of_week} onChange={v => setForm(f => ({ ...f, day_of_week: parseInt(v, 10) }))}>
                {DAYS_OF_WEEK.map(d => (
                  <option key={d} value={d}>{td(`schedreports.daysOfWeek.${d}`, DAY_LABELS[d])}</option>
                ))}
              </SelectField>
            </div>
          )}
          {form.frequency === 'monthly' && (
            <div>
              <FieldLabel required>{td('schedreports.modal.dayOfMonth', 'Day of Month')}</FieldLabel>
              <input
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
                <FieldLabel required>{td('schedreports.modal.timeOfDay', 'Time of Day')}</FieldLabel>
                <input type="time" value={form.time_of_day} onChange={e => setForm(f => ({ ...f, time_of_day: e.target.value }))} className={INPUT_CLASS} />
              </div>
              <div>
                <FieldLabel>{td('schedreports.modal.startDate', 'Start Date')}</FieldLabel>
                <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={INPUT_CLASS} />
              </div>
            </div>
          )}

          {/* Coverage period */}
          <div>
            <FieldLabel required>{td('schedreports.modal.period', 'Report Covers')}</FieldLabel>
            <SelectField value={form.period} onChange={v => setForm(f => ({ ...f, period: v }))}>
              {PERIODS.map(p => (
                <option key={p.value} value={p.value}>{td(`schedreports.periods.${p.value}`, p.label)}</option>
              ))}
            </SelectField>
            {form.period === 'custom' && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <FieldLabel required>{td('schedreports.modal.from', 'From')}</FieldLabel>
                  <input type="date" value={form.period_from} onChange={e => setForm(f => ({ ...f, period_from: e.target.value }))} className={INPUT_CLASS} />
                </div>
                <div>
                  <FieldLabel required>{td('schedreports.modal.to', 'To')}</FieldLabel>
                  <input type="date" value={form.period_to} onChange={e => setForm(f => ({ ...f, period_to: e.target.value }))} className={INPUT_CLASS} />
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
            <FieldLabel required>{td('schedreports.modal.recipients', 'Recipients')}</FieldLabel>
            <textarea
              rows={3}
              placeholder={'manager@company.com\nexecutive@company.com'}
              value={form.recipients_raw}
              onChange={e => { setForm(f => ({ ...f, recipients_raw: e.target.value })); setFormError('') }}
              className={`${INPUT_CLASS} placeholder-gray-500 resize-none font-mono`}
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">{td('schedreports.modal.recipientsHint', 'One email address per line — scheduled deliveries e-mail these recipients.')}</p>
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

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-bright)] flex items-center justify-between gap-3">
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
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-3)] hover:bg-gray-600 rounded-lg transition-colors">
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
      </div>
    </div>
  )
}

function DeleteConfirmModal({ schedule, onCancel, onConfirm, deleting, td }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-2xl w-full max-w-sm shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-[var(--text-primary)] font-semibold">{td('schedreports.delete.title', 'Delete Schedule')}</p>
            <p className="text-[var(--text-secondary)] text-sm">{td('schedreports.delete.subtitle', 'This action cannot be undone')}</p>
          </div>
        </div>
        <p className="text-[var(--text-secondary)] text-sm mb-6">
          {td('schedreports.delete.questionPrefix', 'Are you sure you want to delete "')}
          <span className="text-[var(--text-primary)] font-medium">{schedule?.name}</span>
          {td('schedreports.delete.questionSuffix', '"? Recipients will no longer receive this report.')}
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-3)] hover:bg-gray-600 rounded-lg transition-colors">
            {td('schedreports.delete.cancel', 'Cancel')}
          </button>
          <button
            onClick={onConfirm} disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deleting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {td('schedreports.delete.confirm', 'Delete')}
          </button>
        </div>
      </div>
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

  const [schedules, setSchedules] = useState([])
  const [layouts, setLayouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

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
  const [search, setSearch] = useState('')

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSchedules(await listSchedules())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])
  // Saved Report Builder layouts are schedulable like any built-in type.
  useEffect(() => { listSchedulableLayouts().then(setLayouts).catch(() => setLayouts([])) }, [])
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
      org_id: profile?.org_id ?? null,
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
      setFormError(e.message)
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
      setError(e.message)
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
      setError(e.message)
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
      const stamp = new Date().toISOString().slice(0, 10)
      const base = `${reportCompany.replace(/[^\w]+/g, '_')}_${dataset.title.replace(/[^\w]+/g, '_')}_${stamp}`
      const formats = cfg.output_formats?.length ? cfg.output_formats : ['pdf']

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
          filename: `${reportCompany.replace(/[^\w]+/g, '_')}_${(template.name || 'Custom_Report').replace(/[^\w]+/g, '_')}_${stamp}`,
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
          },
        )
      }
      if (formats.includes('excel')) {
        // Excel sheet names must avoid : \ / ? * [ ] and stay <= 31 chars.
        const sheetName = dataset.title.replace(/[:\\/?*[\]]/g, '-').slice(0, 28)
        await exportToExcel(
          rows, dataset.cols, dataset.headers, base, sheetName,
          {
            title: dataset.title, company: reportCompany, dateRange: label, currency: activeCurrency,
            meta: {
              'Report type': typeLabel,
              'Coverage period': label,
              Scope: activeCountry === 'All' ? td('schedreports.gen.allCountries', 'All countries') : activeCountry,
            },
          },
        )
      }

      setToast({
        type: rows.length ? 'ok' : 'warn',
        text: rows.length
          ? td('schedreports.toast.generated', 'Generated {type} · {n} records', { type: typeLabel, n: rows.length })
          : td('schedreports.toast.generatedEmpty', 'Generated {type} — no records in range (empty report)', { type: typeLabel }),
      })
    } catch (e) {
      setToast({ type: 'err', text: e.message || td('schedreports.toast.genFailed', 'Report generation failed') })
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
      setToast({
        type: 'ok',
        text: td('schedreports.toast.sentNow', 'Report emailed to {n} recipient(s)', { n: data?.recipients ?? (s.recipients ?? []).length }),
      })
    } catch (e) {
      setToast({ type: 'err', text: e.message || td('schedreports.toast.sendFailed', 'Send failed') })
    } finally {
      setSendingNow(null)
    }
  }

  // ── Filtered view ─────────────────────────────────────────────────────────
  const filtered = schedules.filter(s => {
    if (filterFreq !== 'all' && s.frequency !== filterFreq) return false
    if (filterActive === 'active' && !s.active) return false
    if (filterActive === 'inactive' && s.active) return false
    if (search && !(s.name || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const activeCount = schedules.filter(s => s.active).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg border ${
          toast.type === 'ok' ? 'bg-green-500/15 border-green-500/40 text-green-300'
            : toast.type === 'warn' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              : 'bg-red-500/15 border-red-500/40 text-red-300'}`}>
          {toast.type === 'ok' ? <CheckCircle className="w-4 h-4" /> : toast.type === 'warn' ? <AlertTriangle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="max-w-xs">{toast.text}</span>
          <button onClick={() => setToast(null)} className="ml-1 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">{td('schedreports.header.title', 'Scheduled Reports')}</h1>
          <p className="text-[var(--text-secondary)] text-sm mt-1">
            {loading
              ? td('schedreports.header.loading', 'Loading...')
              : (activeCount !== 1
                ? td('schedreports.header.summaryOther', '{count} active schedules · {total} total', { count: activeCount, total: schedules.length })
                : td('schedreports.header.summaryOne', '{count} active schedule · {total} total', { count: activeCount, total: schedules.length }))}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl shadow-lg shadow-orange-500/20 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />{td('schedreports.header.newSchedule', 'New Schedule')}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4 text-red-400" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder={td('schedreports.search.placeholder', 'Search schedules...')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
        />
        <div className="flex gap-2 flex-wrap">
          {['all', 'once', 'daily', 'weekly', 'monthly'].map(f => (
            <button
              key={f}
              onClick={() => setFilterFreq(f)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all capitalize ${
                filterFreq === f ? 'bg-orange-500 border-orange-500 text-white'
                  : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {f === 'all' ? td('schedreports.filters.allFrequencies', 'All Frequencies') : td(`schedreports.frequencies.${f}`, FREQ_LABEL[f] || f)}
            </button>
          ))}
          {[['all', td('schedreports.filters.allStatus', 'All Status')], ['active', td('schedreports.filters.active', 'Active')], ['inactive', td('schedreports.filters.inactive', 'Paused')]].map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setFilterActive(val)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                filterActive === val ? 'bg-orange-500 border-orange-500 text-white'
                  : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      {!loading && schedules.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {REPORT_TYPES.map(rt => {
            const count = schedules.filter(s => s.report_type === rt.value).length
            return (
              <div key={rt.value} className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-xl px-4 py-3 flex items-center gap-3">
                <ReportTypeIcon type={rt.value} size="sm" />
                <div className="min-w-0">
                  <p className="text-[var(--text-primary)] font-bold text-lg leading-none">{count}</p>
                  <p className="text-[var(--text-secondary)] text-xs mt-0.5 truncate">{td(`schedreports.reportTypes.${rt.value}`, rt.label)}</p>
                </div>
              </div>
            )
          })}
          {schedules.some(s => isBuilderType(s.report_type)) && (
            <div className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-xl px-4 py-3 flex items-center gap-3">
              <ReportTypeIcon type="builder:stat" size="sm" />
              <div className="min-w-0">
                <p className="text-[var(--text-primary)] font-bold text-lg leading-none">{schedules.filter(s => isBuilderType(s.report_type)).length}</p>
                <p className="text-[var(--text-secondary)] text-xs mt-0.5 truncate">{td('schedreports.reportTypes.builderGroup', 'Custom layouts')}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-xl p-5 animate-pulse space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--surface-3)]" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 bg-[var(--surface-3)] rounded w-3/4" />
                  <div className="h-3 bg-[var(--surface-3)] rounded w-1/2" />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="h-5 bg-[var(--surface-3)] rounded-full w-16" />
                <div className="h-5 bg-[var(--surface-3)] rounded w-28" />
              </div>
              <div className="pt-3 border-t border-[var(--border-bright)] flex justify-between">
                <div className="h-3 bg-[var(--surface-3)] rounded w-32" />
                <div className="h-3 bg-[var(--surface-3)] rounded w-12" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--border-bright)] flex items-center justify-center mb-4">
            <Calendar className="w-8 h-8 text-[var(--text-dim)]" />
          </div>
          {schedules.length === 0 ? (
            <>
              <p className="text-[var(--text-primary)] font-semibold text-lg">{td('schedreports.empty.noSchedulesTitle', 'No schedules yet')}</p>
              <p className="text-[var(--text-secondary)] text-sm mt-2 max-w-sm">
                {td('schedreports.empty.noSchedulesDesc', 'Set up automated fleet & tyre intelligence reports and have them generated and delivered on your schedule.')}
              </p>
              <button
                onClick={openCreate}
                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl transition-all"
              >
                <Plus className="w-4 h-4" />{td('schedreports.empty.createFirst', 'Create First Schedule')}
              </button>
            </>
          ) : (
            <>
              <p className="text-[var(--text-primary)] font-semibold">{td('schedreports.empty.noMatchTitle', 'No matching schedules')}</p>
              <p className="text-[var(--text-secondary)] text-sm mt-1">{td('schedreports.empty.noMatchDesc', 'Try adjusting your filters or search query.')}</p>
              <button
                onClick={() => { setFilterFreq('all'); setFilterActive('all'); setSearch('') }}
                className="mt-4 text-orange-400 text-sm hover:text-orange-300 transition-colors"
              >
                {td('schedreports.empty.clearFilters', 'Clear filters')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Schedule grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(s => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onToggle={handleToggle}
              onGenerate={handleGenerate}
              generating={generating}
              onSendNow={handleSendNow}
              sendingNow={sendingNow}
              td={td}
              typeLabelFor={typeLabelFor}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <Modal
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

      {/* Delete Confirm Modal */}
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
