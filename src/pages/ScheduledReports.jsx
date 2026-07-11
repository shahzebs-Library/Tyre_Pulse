import { useState, useEffect, useCallback } from 'react'
import {
  Calendar, Clock, Mail, Plus, Edit2, Trash2, Eye, EyeOff,
  FileText, BarChart2, Truck, ClipboardList, DollarSign,
  CheckCircle, XCircle, AlertCircle, ChevronDown, X, Save, Lock
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import SegmentedControl from '../components/ui/SegmentedControl'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeNextRun(frequency, dayOfWeek, dayOfMonth, timeOfDay) {
  const now = new Date()
  const [h, m] = (timeOfDay ?? '07:00').split(':').map(Number)
  let next = new Date(now)
  next.setSeconds(0, 0)
  next.setHours(h, m)

  if (frequency === 'daily') {
    if (next <= now) next.setDate(next.getDate() + 1)
  } else if (frequency === 'weekly') {
    const dow = dayOfWeek ?? 1
    const diff = (dow - next.getDay() + 7) % 7 || 7
    next.setDate(next.getDate() + diff)
  } else if (frequency === 'monthly') {
    next.setDate(dayOfMonth ?? 1)
    if (next <= now) { next.setMonth(next.getMonth() + 1); next.setDate(dayOfMonth ?? 1) }
  }
  return next.toISOString()
}

function formatNextRun(nextRunAt, t) {
  if (!nextRunAt) return '-'
  const d = new Date(nextRunAt)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const diff = d - new Date()
  if (diff < 24 * 3600_000) return t('schedreports.time.today', { time })
  if (diff < 48 * 3600_000) return t('schedreports.time.tomorrow', { time })
  return t('schedreports.time.dateAt', {
    day: t(`schedreports.daysOfWeek.${d.getDay()}`),
    date: d.getDate(),
    month: t(`schedreports.months.${d.getMonth()}`),
    time,
  })
}

function formatLastSent(ts, t) {
  if (!ts) return t('schedreports.lastSent.never')
  const d = new Date(ts)
  return t('schedreports.lastSent.label', {
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

// ── Config ────────────────────────────────────────────────────────────────────

const REPORT_TYPES = [
  { value: 'executive',  label: 'Executive Report',    Icon: FileText,      color: 'text-purple-400',  bg: 'bg-purple-400/10' },
  { value: 'kpi',        label: 'KPI Scorecard',       Icon: BarChart2,     color: 'text-blue-400',    bg: 'bg-blue-400/10'   },
  { value: 'fleet',      label: 'Fleet Analytics',     Icon: Truck,         color: 'text-green-400',   bg: 'bg-green-400/10'  },
  { value: 'inspection', label: 'Inspection Summary',  Icon: ClipboardList, color: 'text-yellow-400',  bg: 'bg-yellow-400/10' },
  { value: 'cost',       label: 'Cost Analysis',       Icon: DollarSign,    color: 'text-orange-400',  bg: 'bg-orange-400/10' },
]

const FREQUENCIES = [
  { value: 'daily',   label: 'Daily',   dot: 'bg-green-400'  },
  { value: 'weekly',  label: 'Weekly',  dot: 'bg-blue-400'   },
  { value: 'monthly', label: 'Monthly', dot: 'bg-purple-400' },
]

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday'    },
  { value: 1, label: 'Monday'    },
  { value: 2, label: 'Tuesday'   },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday'  },
  { value: 5, label: 'Friday'    },
  { value: 6, label: 'Saturday'  },
]

const TIME_OPTIONS = ['06:00', '07:00', '08:00', '09:00', '12:00', '18:00']

const BLANK_FORM = {
  name: '',
  report_type: 'executive',
  frequency: 'weekly',
  day_of_week: 1,
  day_of_month: 1,
  time_of_day: '07:00',
  recipients_raw: '',
  active: true,
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FrequencyBadge({ frequency }) {
  const { t } = useLanguage()
  const f = FREQUENCIES.find(x => x.value === frequency) ?? FREQUENCIES[0]
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--surface-3)] text-xs font-medium text-[var(--text-secondary)]">
      <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />
      {t(`schedreports.frequencies.${f.value}`)}
    </span>
  )
}

function ReportTypeIcon({ type, size = 'md' }) {
  const cfg = REPORT_TYPES.find(r => r.value === type) ?? REPORT_TYPES[0]
  const { Icon, color, bg } = cfg
  const sz = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'
  const ic = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  return (
    <div className={`${sz} rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
      <Icon className={`${ic} ${color}`} />
    </div>
  )
}

function ScheduleCard({ schedule, onEdit, onDelete, onToggle }) {
  const { t } = useLanguage()
  const rtCfg = REPORT_TYPES.find(r => r.value === schedule.report_type) ?? REPORT_TYPES[0]
  const recipientCount = (schedule.recipients ?? []).length

  return (
    <div className={`bg-[var(--surface-2)] border rounded-xl p-5 flex flex-col gap-4 transition-all duration-200 hover:border-[var(--border-bright)] ${schedule.active ? 'border-[var(--border-bright)]' : 'border-[var(--border-bright)] opacity-70'}`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ReportTypeIcon type={schedule.report_type} />
          <div className="min-w-0">
            <p className="text-[var(--text-primary)] font-semibold truncate">{schedule.name}</p>
            <p className={`text-xs mt-0.5 ${rtCfg.color}`}>{t(`schedreports.reportTypes.${rtCfg.value}`)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onToggle(schedule)}
            title={schedule.active ? t('schedreports.card.deactivate') : t('schedreports.card.activate')}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors"
          >
            {schedule.active
              ? <Eye className="w-4 h-4 text-green-400" />
              : <EyeOff className="w-4 h-4 text-[var(--text-muted)]" />}
          </button>
          <button
            onClick={() => onEdit(schedule)}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-3)] transition-colors"
          >
            <Edit2 className="w-4 h-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)]" />
          </button>
          <button
            onClick={() => onDelete(schedule)}
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-[var(--text-secondary)] hover:text-red-400" />
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <FrequencyBadge frequency={schedule.frequency} />
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <Clock className="w-3.5 h-3.5" />
          {formatNextRun(schedule.next_run_at, t)}
        </span>
        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
          <Mail className="w-3.5 h-3.5" />
          {recipientCount !== 1
            ? t('schedreports.card.recipientOther', { count: recipientCount })
            : t('schedreports.card.recipientOne', { count: recipientCount })}
        </span>
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-[var(--border-bright)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{formatLastSent(schedule.last_sent_at, t)}</span>
        {schedule.active
          ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3 h-3" />{t('schedreports.card.active')}</span>
          : <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]"><XCircle className="w-3 h-3" />{t('schedreports.card.inactive')}</span>}
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

function SelectField({ value, onChange, children, className = '' }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm appearance-none focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 pr-8 ${className}`}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
    </div>
  )
}

function Modal({ title, onClose, onSave, saving, form, setForm, emailError, setEmailError, record, wfLocked, onWfStateChange }) {
  const { t } = useLanguage()
  const handleRecipientsBlur = () => {
    const { invalid } = validateEmails(form.recipients_raw)
    setEmailError(invalid.length ? t('schedreports.errors.invalidEmails', { list: invalid.join(', ') }) : '')
  }

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
            <FieldLabel required>{t('schedreports.modal.scheduleName')}</FieldLabel>
            <input
              type="text"
              placeholder={t('schedreports.modal.namePlaceholder')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
            />
          </div>

          {/* Report Type */}
          <div>
            <FieldLabel required>{t('schedreports.modal.reportType')}</FieldLabel>
            <SelectField value={form.report_type} onChange={v => setForm(f => ({ ...f, report_type: v }))}>
              {REPORT_TYPES.map(r => (
                <option key={r.value} value={r.value}>{t(`schedreports.reportTypes.${r.value}`)}</option>
              ))}
            </SelectField>
          </div>

          {/* Frequency */}
          <div>
            <FieldLabel required>{t('schedreports.modal.frequency')}</FieldLabel>
            <SegmentedControl
              ariaLabel={t('schedreports.modal.frequency')}
              size="sm"
              value={form.frequency}
              onChange={(v) => setForm(f => ({ ...f, frequency: v }))}
              options={FREQUENCIES.map(fr => ({ value: fr.value, label: t(`schedreports.frequencies.${fr.value}`) }))}
            />
          </div>

          {/* Day of week (weekly only) */}
          {form.frequency === 'weekly' && (
            <div>
              <FieldLabel required>{t('schedreports.modal.dayOfWeek')}</FieldLabel>
              <SelectField
                value={form.day_of_week}
                onChange={v => setForm(f => ({ ...f, day_of_week: parseInt(v, 10) }))}
              >
                {DAYS_OF_WEEK.map(d => (
                  <option key={d.value} value={d.value}>{t(`schedreports.daysOfWeek.${d.value}`)}</option>
                ))}
              </SelectField>
            </div>
          )}

          {/* Day of month (monthly only) */}
          {form.frequency === 'monthly' && (
            <div>
              <FieldLabel required>{t('schedreports.modal.dayOfMonth')}</FieldLabel>
              <input
                type="number"
                min={1}
                max={31}
                value={form.day_of_month}
                onChange={e => {
                  const v = Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1))
                  setForm(f => ({ ...f, day_of_month: v }))
                }}
                className="w-full bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30"
              />
            </div>
          )}

          {/* Time of day */}
          <div>
            <FieldLabel required>{t('schedreports.modal.timeOfDay')}</FieldLabel>
            <SelectField value={form.time_of_day} onChange={v => setForm(f => ({ ...f, time_of_day: v }))}>
              {TIME_OPTIONS.map(opt => {
                const [h] = opt.split(':').map(Number)
                const period = h < 12 ? t('schedreports.time.am') : t('schedreports.time.pm')
                const label = `${h < 12 ? (h === 0 ? 12 : h) : (h === 12 ? 12 : h - 12)}:00 ${period}`
                return <option key={opt} value={opt}>{label} ({opt})</option>
              })}
            </SelectField>
          </div>

          {/* Recipients */}
          <div>
            <FieldLabel required>{t('schedreports.modal.recipients')}</FieldLabel>
            <textarea
              rows={4}
              placeholder={'manager@company.com\nexecutive@company.com'}
              value={form.recipients_raw}
              onChange={e => { setForm(f => ({ ...f, recipients_raw: e.target.value })); setEmailError('') }}
              onBlur={handleRecipientsBlur}
              className="w-full bg-[var(--surface-3)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-lg px-3 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/30 resize-none font-mono"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('schedreports.modal.recipientsHint')}</p>
            {emailError && (
              <p className="text-xs text-red-400 mt-1 flex items-start gap-1">
                <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />{emailError}
              </p>
            )}
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between bg-[var(--surface-3)] rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{t('schedreports.modal.activeSchedule')}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{t('schedreports.modal.activeScheduleDesc')}</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, active: !f.active }))}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.active ? 'bg-orange-500' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.active ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Approval & Workflow Engine — status, immutable trail, approver action, start picker.
              Executive/scheduled report publishing requires sign-off before it can be edited. */}
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
              <Lock className="w-3 h-3" /> Locked, in approval
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-bright)] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-3)] hover:bg-gray-600 rounded-lg transition-colors"
          >
            {t('schedreports.modal.cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={saving || wfLocked}
            title={wfLocked ? 'Locked, in approval' : undefined}
            className="px-5 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {wfLocked ? (
              <><Lock className="w-4 h-4" />{t('schedreports.modal.save')}</>
            ) : saving ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t('schedreports.modal.saving')}</>
            ) : (
              <><Save className="w-4 h-4" />{t('schedreports.modal.save')}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ schedule, onCancel, onConfirm, deleting }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-2xl w-full max-w-sm shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-[var(--text-primary)] font-semibold">{t('schedreports.delete.title')}</p>
            <p className="text-[var(--text-secondary)] text-sm">{t('schedreports.delete.subtitle')}</p>
          </div>
        </div>
        <p className="text-[var(--text-secondary)] text-sm mb-6">
          {t('schedreports.delete.questionPrefix')}<span className="text-[var(--text-primary)] font-medium">{schedule?.name}</span>{t('schedreports.delete.questionSuffix')}
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--surface-3)] hover:bg-gray-600 rounded-lg transition-colors">
            {t('schedreports.delete.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deleting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {t('schedreports.delete.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ScheduledReports() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(BLANK_FORM)
  const [emailError, setEmailError] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Approval-engine gate: locks the schedule's Save control while its publishing
  // workflow is active (pending/in_review/returned) or locked (approved).
  const [wfLocked, setWfLocked] = useState(false)

  const [filterFreq, setFilterFreq] = useState('all')
  const [filterActive, setFilterActive] = useState('all')
  const [search, setSearch] = useState('')

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('report_schedules')
        .select('*')
        .order('created_at', { ascending: false })
      if (err) throw err
      setSchedules(data ?? [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSchedules() }, [fetchSchedules])

  // Reset the approval lock whenever a different schedule (or none) is opened for
  // edit; EntityApprovalPanel re-reports the true state via onStateChange.
  useEffect(() => { setWfLocked(false) }, [editTarget?.id])

  // ── Modal helpers ───────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setEmailError('')
    setModalOpen(true)
  }

  const openEdit = (schedule) => {
    setEditTarget(schedule)
    setForm({
      name: schedule.name,
      report_type: schedule.report_type,
      frequency: schedule.frequency,
      day_of_week: schedule.day_of_week ?? 1,
      day_of_month: schedule.day_of_month ?? 1,
      time_of_day: schedule.time_of_day ?? '07:00',
      recipients_raw: (schedule.recipients ?? []).join('\n'),
      active: schedule.active ?? true,
    })
    setEmailError('')
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditTarget(null)
    setEmailError('')
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    // Block edits to a schedule whose publishing approval is active/locked.
    if (editTarget && wfLocked) return
    if (!form.name.trim()) { setEmailError(''); return }

    const { emails, invalid } = validateEmails(form.recipients_raw)
    if (invalid.length) {
      setEmailError(t('schedreports.errors.invalidEmails', { list: invalid.join(', ') }))
      return
    }
    if (emails.length === 0) {
      setEmailError(t('schedreports.errors.recipientRequired'))
      return
    }

    setSaving(true)
    try {
      const next_run_at = computeNextRun(
        form.frequency,
        form.frequency === 'weekly' ? form.day_of_week : null,
        form.frequency === 'monthly' ? form.day_of_month : null,
        form.time_of_day
      )

      const payload = {
        name: form.name.trim(),
        report_type: form.report_type,
        frequency: form.frequency,
        day_of_week: form.frequency === 'weekly' ? form.day_of_week : null,
        day_of_month: form.frequency === 'monthly' ? form.day_of_month : null,
        time_of_day: form.time_of_day,
        recipients: emails,
        active: form.active,
        next_run_at,
        org_id: profile?.org_id ?? null,
        updated_at: new Date().toISOString(),
      }

      if (editTarget) {
        const { error: err } = await supabase
          .from('report_schedules')
          .update(payload)
          .eq('id', editTarget.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase
          .from('report_schedules')
          .insert({ ...payload, created_by: profile?.id ?? null })
        if (err) throw err
      }

      closeModal()
      fetchSchedules()
    } catch (e) {
      setEmailError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle active ─────────────────────────────────────────────────────────

  const handleToggle = async (schedule) => {
    const next_run_at = !schedule.active
      ? computeNextRun(schedule.frequency, schedule.day_of_week, schedule.day_of_month, schedule.time_of_day)
      : null

    // optimistic
    setSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, active: !s.active, next_run_at } : s))

    const { error: err } = await supabase
      .from('report_schedules')
      .update({ active: !schedule.active, next_run_at, updated_at: new Date().toISOString() })
      .eq('id', schedule.id)

    if (err) {
      setSchedules(prev => prev.map(s => s.id === schedule.id ? schedule : s))
      setError(err.message)
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const { error: err } = await supabase
        .from('report_schedules')
        .delete()
        .eq('id', deleteTarget.id)
      if (err) throw err
      setSchedules(prev => prev.filter(s => s.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleting(false)
    }
  }

  // ── Filtered view ─────────────────────────────────────────────────────────

  const filtered = schedules.filter(s => {
    if (filterFreq !== 'all' && s.frequency !== filterFreq) return false
    if (filterActive === 'active' && !s.active) return false
    if (filterActive === 'inactive' && s.active) return false
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const activeCount = schedules.filter(s => s.active).length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">{t('schedreports.header.title')}</h1>
            <p className="text-[var(--text-secondary)] text-sm mt-1">
              {loading
                ? t('schedreports.header.loading')
                : (activeCount !== 1
                  ? t('schedreports.header.summaryOther', { count: activeCount, total: schedules.length })
                  : t('schedreports.header.summaryOne', { count: activeCount, total: schedules.length }))}
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl shadow-lg shadow-orange-500/20 transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            {t('schedreports.header.newSchedule')}
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
            placeholder={t('schedreports.search.placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-primary)] rounded-xl px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
          />
          <div className="flex gap-2 flex-wrap">
            {/* Frequency filter */}
            {['all', 'daily', 'weekly', 'monthly'].map(f => (
              <button
                key={f}
                onClick={() => setFilterFreq(f)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all capitalize ${
                  filterFreq === f
                    ? 'bg-orange-500 border-orange-500 text-white'
                    : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]'
                }`}
              >
                {f === 'all' ? t('schedreports.filters.allFrequencies') : t(`schedreports.frequencies.${f}`)}
              </button>
            ))}
            {/* Status filter */}
            {[['all', t('schedreports.filters.allStatus')], ['active', t('schedreports.filters.active')], ['inactive', t('schedreports.filters.inactive')]].map(([val, lbl]) => (
              <button
                key={val}
                onClick={() => setFilterActive(val)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                  filterActive === val
                    ? 'bg-orange-500 border-orange-500 text-white'
                    : 'bg-[var(--surface-2)] border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]'
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
                  <div>
                    <p className="text-[var(--text-primary)] font-bold text-lg leading-none">{count}</p>
                    <p className="text-[var(--text-secondary)] text-xs mt-0.5">{t(`schedreports.reportTypes.${rt.value}`)}</p>
                  </div>
                </div>
              )
            })}
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
                <p className="text-[var(--text-primary)] font-semibold text-lg">{t('schedreports.empty.noSchedulesTitle')}</p>
                <p className="text-[var(--text-secondary)] text-sm mt-2 max-w-sm">
                  {t('schedreports.empty.noSchedulesDesc')}
                </p>
                <button
                  onClick={openCreate}
                  className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 rounded-xl transition-all"
                >
                  <Plus className="w-4 h-4" />
                  {t('schedreports.empty.createFirst')}
                </button>
              </>
            ) : (
              <>
                <p className="text-[var(--text-primary)] font-semibold">{t('schedreports.empty.noMatchTitle')}</p>
                <p className="text-[var(--text-secondary)] text-sm mt-1">{t('schedreports.empty.noMatchDesc')}</p>
                <button
                  onClick={() => { setFilterFreq('all'); setFilterActive('all'); setSearch('') }}
                  className="mt-4 text-orange-400 text-sm hover:text-orange-300 transition-colors"
                >
                  {t('schedreports.empty.clearFilters')}
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
              />
            ))}
          </div>
        )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <Modal
          title={editTarget ? t('schedreports.modal.editTitle') : t('schedreports.modal.newTitle')}
          onClose={closeModal}
          onSave={handleSave}
          saving={saving}
          form={form}
          setForm={setForm}
          emailError={emailError}
          setEmailError={setEmailError}
          record={editTarget}
          wfLocked={wfLocked}
          onWfStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <DeleteConfirmModal
          schedule={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      )}
    </div>
  )
}
