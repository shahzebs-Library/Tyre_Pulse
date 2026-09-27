import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as settingsApi from '../lib/api/settings'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
import UpdateHistory from '../components/ReleaseNotes'
import AppearancePanel from '../components/settings/AppearancePanel'
import MySignaturePanel from '../components/settings/MySignaturePanel'
import FeatureFlagsPanel from '../components/settings/FeatureFlagsPanel'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { Save, User, Settings2, Bell, BellRing, Database, Info, Target, Clock, Mail, Phone, Calendar, Trash2, Plus, Play, Lock, Shield, ShieldCheck, ShieldOff, AlertTriangle, Sparkles, Moon, Search } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { sendReportEmail } from '../lib/emailService'
import TwoFactorSetup from '../components/TwoFactorSetup'
import Modal from '../components/ui/Modal'
import * as notifPrefsApi from '../lib/api/notificationPreferences'
import * as accountDeletionApi from '../lib/api/accountDeletion'
import { DEFAULT_PREFS, DIGEST_FREQUENCIES, PRIORITY_ORDER, summarisePrefs } from '../lib/notificationPrefs'
import { toUserMessage } from '../lib/safeError'
import { compareValues } from '../lib/consoleTable'
import { reportFileName } from '../lib/exportUtils'
import {
  SETTINGS_TABS, resolveSettingsTab, scheduleLabel, scheduleRows, summarizeSchedules,
  filterSchedules, thresholdRows, settingsOverview, DOW_TO_NUM,
} from '../lib/settingsAnalytics'
import {
  getRecoveryContacts,
  RECOVERY_SMS_ENABLED,
  recoveryDestinationIsValid,
  removeRecoveryContact,
  requestRecoveryContactVerification,
  verifyRecoveryContact,
} from '../lib/accountRecovery'

const ROLE_BADGE = {
  Admin:   'bg-purple-900/50 text-purple-300 border border-purple-700/50',
  Manager: 'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  Viewer:  'bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-bright)]',
}

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']
const CURRENCIES   = ['SAR', 'AED', 'EGP', 'USD']

const KPI_FIELDS = [
  { key: 'max_monthly_cost',       label: 'Max Monthly Cost',       type: 'number', step: 1000, min: 0 },
  { key: 'max_high_risk_pct',      label: 'Max High Risk %',        type: 'number', step: 1,    min: 0, max: 100 },
  { key: 'target_records_per_month', label: 'Min Records / Month',  type: 'number', step: 1,    min: 0 },
  { key: 'max_overdue_actions',    label: 'Max Overdue Actions',     type: 'number', step: 1,    min: 0 },
  { key: 'max_avg_cost_per_tyre',  label: 'Max Avg Cost / Tyre',    type: 'number', step: 100,  min: 0 },
]

const KPI_DEFAULTS = {
  max_monthly_cost: '',
  max_high_risk_pct: '',
  target_records_per_month: '',
  max_overdue_actions: '',
  max_avg_cost_per_tyre: '',
}

const ALERT_THRESHOLD_DEFAULTS = {
  stock_critical_pct:  10,
  budget_warning_pct:  80,
  budget_critical_pct: 100,
  days_overdue_alert:  7,
  high_risk_tyre_pct:  25,
}

const ALERT_THRESHOLD_FIELDS = [
  { key: 'stock_critical_pct',  label: 'Stock Critical % of Min Level', step: 1, min: 0, max: 100 },
  { key: 'budget_warning_pct',  label: 'Budget Warning Threshold %',    step: 1, min: 0, max: 100 },
  { key: 'budget_critical_pct', label: 'Budget Critical Threshold %',   step: 1, min: 0, max: 200 },
  { key: 'days_overdue_alert',  label: 'Days Overdue Before Alert',      step: 1, min: 0 },
  { key: 'high_risk_tyre_pct',  label: 'High Risk Tyre % Alert',         step: 1, min: 0, max: 100 },
]

const REPORT_NAMES = [
  'Fleet Summary',
  'KPI Report',
  'Vendor Intelligence',
  'Executive Report',
  'Forecasting',
  'Work Orders Summary',
]

const SCHEDULE_FREQUENCIES = ['Daily', 'Weekly', 'Monthly']

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const DAYS_OF_MONTH = Array.from({ length: 28 }, (_, i) => i + 1)

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = String(i).padStart(2, '0')
  return `${h}:00`
})

const EMPTY_SCHEDULE = {
  id: null,
  reportName: REPORT_NAMES[0],
  frequency: 'Daily',
  dayOfWeek: 'Monday',
  dayOfMonth: 1,
  time: '06:00',
  recipients: '',
  active: true,
}

const NUM_TO_DOW = Object.fromEntries(Object.entries(DOW_TO_NUM).map(([key, value]) => [value, key]))
const NAME_TO_TYPE = {
  'Fleet Summary': 'fleet', 'KPI Report': 'kpi', 'Vendor Intelligence': 'cost',
  'Executive Report': 'executive', 'Forecasting': 'kpi', 'Work Orders Summary': 'cost',
}

// Per-user notification channels (§11 Notification engine — preferences slice).
// Each maps to a `channel_<key>` boolean column on notification_preferences.
const NOTIFICATION_CHANNELS = [
  { key: 'in_app',   label: 'In-App',   hint: 'Bell + realtime alerts inside TyrePulse' },
  { key: 'email',    label: 'Email',    hint: 'Delivered to your account email' },
  { key: 'push',     label: 'Push',     hint: 'Mobile / browser push notifications' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Business WhatsApp messages' },
  { key: 'sms',      label: 'SMS',      hint: 'Text message to your phone' },
  { key: 'slack',    label: 'Slack',    hint: 'Direct message in Slack' },
  { key: 'teams',    label: 'Teams',    hint: 'Microsoft Teams message' },
]

const PRIORITY_LABELS = {
  low: 'Low: everything',
  normal: 'Normal and above',
  high: 'High and above',
  critical: 'Critical only',
}

const DIGEST_LABELS = {
  none: 'Real-time (no digest)',
  daily: 'Daily digest',
  weekly: 'Weekly digest',
}

const TAB_ICONS = {
  general: User,
  notifications: BellRing,
  alerts: Target,
  reports: Clock,
  security: Shield,
  about: Info,
}

/** Null-last, number/date/text aware sort for every EnterpriseTable column. */
const valueSort = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

function fmtDateTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function KpiTile({ label, value, sub, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card !p-4 text-left min-h-[44px] hover:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <span className="block text-2xl font-bold tabular-nums text-[var(--text-primary)] mt-1">{value}</span>
      {sub && <span className="block text-xs text-[var(--text-muted)] mt-0.5">{sub}</span>}
    </button>
  )
}

/** Five configuration facts; any figure that could not be read shows N/A. */
function SettingsKpiStrip({ overview: o, onJump }) {
  const na = v => (v == null ? 'N/A' : v)
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3" aria-label="Settings summary">
      <KpiTile
        label="Active schedules"
        value={o.schedulesActive == null ? 'N/A' : `${o.schedulesActive} of ${o.schedulesTotal}`}
        sub={o.nextDelivery ? `Next ${fmtDateTime(o.nextDelivery)}` : o.schedulesActive == null ? 'Could not be read' : 'Nothing queued'}
        onClick={() => onJump('reports')}
      />
      <KpiTile
        label="KPI targets set"
        value={o.kpiTargetsSet == null ? 'N/A' : `${o.kpiTargetsSet} of ${o.kpiTargetsTotal}`}
        sub={`Targets for ${new Date().getFullYear()}`}
        onClick={() => onJump('alerts')}
      />
      <KpiTile
        label="Notification channels"
        value={na(o.channelsOn)}
        sub={o.channelsOn == null ? 'Could not be read' : 'Switched on for you'}
        onClick={() => onJump('notifications')}
      />
      <KpiTile
        label="Two-factor"
        value={o.mfaEnabled == null ? 'N/A' : o.mfaEnabled ? 'On' : 'Off'}
        sub={o.mfaEnabled === false ? 'Recommended: turn it on' : 'Sign-in protection'}
        onClick={() => onJump('security')}
      />
      <KpiTile
        label="Last data upload"
        value={o.lastUpload ? new Date(o.lastUpload).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}
        sub={!o.uploadsKnown ? 'Could not be read' : o.lastUpload ? 'Most recent file' : 'No uploads recorded'}
        onClick={() => onJump('reports')}
      />
    </div>
  )
}

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function Settings() {
  const { t } = useLanguage()
  const { profile, user, mfaEnabled, setMfaEnabled } = useAuth()
  const { appSettings: globalSettings, refreshSettings, setActiveCountry, activeCountry } = useSettings()
  const isAdmin    = profile?.role === 'Admin'
  const isTyreMan  = profile?.role === 'Tyre Man'
  const currentYear = new Date().getFullYear()

  const [appSettings, setAppSettings] = useState({ cost_per_tyre: '', company_name: '', currency: '' })
  const [profileForm, setProfileForm]  = useState({ full_name: '', username: '' })
  const [appLoadFailed, setAppLoadFailed] = useState(true)
  const [savingApp, setSavingApp]      = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [appMsg, setAppMsg]            = useState('')
  const [profileMsg, setProfileMsg]    = useState('')
  const [uploadHistory, setUploadHistory] = useState([])
  const [uploadsLoading, setUploadsLoading] = useState(true)
  const [uploadsError, setUploadsError] = useState('')
  const [kpiLoadError, setKpiLoadError] = useState('')
  const [kpiLoaded, setKpiLoaded] = useState(false)
  const [thresholdsLoadError, setThresholdsLoadError] = useState('')

  // The active section is URL-borne (?tab=) so a link can open it directly.
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = resolveSettingsTab(searchParams.get('tab'))
  const setTab = useCallback((id) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id === SETTINGS_TABS[0].id) next.delete('tab'); else next.set('tab', id)
      return next
    }, { replace: true })
  }, [setSearchParams])

  // Local preferences stored in localStorage
  const [dateFormat, setDateFormatState] = useState(() => localStorage.getItem('dateFormat') ?? 'DD/MM/YYYY')
  const [prefCurrency, setPrefCurrency] = useState(() => localStorage.getItem('prefCurrency') ?? 'SAR')
  const [prefCountry, setPrefCountry]  = useState(() => activeCountry)

  // Alert thresholds - 3 legacy localStorage fields
  const [highRiskPct, setHighRiskPct]      = useState(() => Number(localStorage.getItem('thresh_highRisk') ?? 25))
  const [critCostThresh, setCritCostThresh] = useState(() => Number(localStorage.getItem('thresh_critCost') ?? 50000))
  const [lowTreadMm, setLowTreadMm]        = useState(() => Number(localStorage.getItem('thresh_lowTread') ?? 2))

  // Alert thresholds - 5 new fields persisted to app_settings
  const [alertThresholds, setAlertThresholds] = useState(ALERT_THRESHOLD_DEFAULTS)
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [threshMsg, setThreshMsg] = useState('')

  // KPI Targets
  const [kpiTargets, setKpiTargets]         = useState(KPI_DEFAULTS)
  const [draftKpiTargets, setDraftKpiTargets] = useState(KPI_DEFAULTS)
  const [editingKpi, setEditingKpi]         = useState(false)
  const [savingKpi, setSavingKpi]           = useState(false)
  const [kpiMsg, setKpiMsg]                 = useState('')

  // Scheduled Reports - persisted in report_schedules (same table the
  // Scheduled Reports page and the pg_cron delivery function use), so
  // schedules made here actually send and are visible to the whole team.
  const [schedules, setSchedules] = useState([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [scheduleLoadError, setScheduleLoadError] = useState('')
  const [scheduleQuery, setScheduleQuery] = useState('')
  const [scheduleStatus, setScheduleStatus] = useState('all')
  const [scheduleFrequency, setScheduleFrequency] = useState('all')
  const [scheduleError, setScheduleError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSchedule, setNewSchedule] = useState({ ...EMPTY_SCHEDULE })
  const [sendingTest, setSendingTest] = useState(null) // schedule id
  const [testMsg, setTestMsg] = useState({}) // { [id]: string }
  const [confirmDeleteSchedule, setConfirmDeleteSchedule] = useState(null)
  const [deletingSchedule, setDeletingSchedule] = useState(false)

  // Notification preferences (per-user; §11 Notification engine slice).
  // Extends existing notification infrastructure — a preferences store only.
  const [notifPrefs, setNotifPrefs]     = useState(DEFAULT_PREFS)
  const [loadingNotif, setLoadingNotif] = useState(true)
  const [savingNotif, setSavingNotif]   = useState(false)
  const [notifMsg, setNotifMsg]         = useState('')
  const [notifError, setNotifError]     = useState('')

  // Password change (TyreMan)
  const [pwNew, setPwNew]         = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [savingPw, setSavingPw]   = useState(false)
  const [pwMsg, setPwMsg]         = useState('')

  // 2FA management
  const [showMfaSetup, setShowMfaSetup]         = useState(false)
  const [removingMfa, setRemovingMfa]           = useState(false)
  const [mfaMsg, setMfaMsg]                     = useState('')
  const [confirmRemoveMfa, setConfirmRemoveMfa] = useState(false)

  useEffect(() => { setAppSettings(s => ({ ...s, ...globalSettings })) }, [globalSettings])
  useEffect(() => {
    if (profile) setProfileForm({ full_name: profile.full_name ?? '', username: profile.username ?? '' })
  }, [profile])

  async function loadSettings() {
    setAppLoadFailed(true)
    try {
      const { data, error } = await settingsApi.listSettings()
      if (error) throw error
      const map = {}
      for (const { key, value } of data ?? []) {
        if (typeof value === 'string') {
          try { map[key] = JSON.parse(value) } catch { map[key] = value }
        } else map[key] = value
      }
      setAppSettings({ cost_per_tyre: '', company_name: '', currency: '', ...map })
      setAppLoadFailed(false)
      setAppMsg(data?.length ? '' : 'Organisation settings have not been configured. Enter verified values before saving.')
    } catch (error) {
      setAppMsg(toUserMessage(error, 'Could not load settings. Retry before saving.'))
    }
  }

  async function loadUploadHistory() {
    setUploadsLoading(true)
    setUploadsError('')
    try {
      const { data, error } = await settingsApi.listUploadHistory()
      if (error) throw error
      setUploadHistory(data ?? [])
    } catch (err) {
      setUploadsError(toUserMessage(err, 'Could not load the upload history.'))
    } finally {
      setUploadsLoading(false)
    }
  }

  const loadKpiTargets = useCallback(async () => {
    setKpiLoadError('')
    let data
    try {
      const res = await settingsApi.listKpiTargetsByYear(currentYear)
      if (res?.error) throw res.error
      data = res?.data
      setKpiLoaded(true)
    } catch (err) {
      setKpiLoaded(false)
      setKpiLoadError(toUserMessage(err, 'Could not load the KPI targets.'))
      return
    }
    if (data && data.length > 0) {
      const mapped = { ...KPI_DEFAULTS }
      data.forEach(row => {
        if (mapped.hasOwnProperty(row.metric)) {
          mapped[row.metric] = row.target_value ?? ''
        }
      })
      setKpiTargets(mapped)
      setDraftKpiTargets(mapped)
    }
  }, [currentYear])

  async function loadAlertThresholds() {
    setThresholdsLoadError('')
    let data
    try {
      const res = await settingsApi.getAlertThresholds()
      if (res?.error) throw res.error
      data = res?.data
    } catch (err) {
      setThresholdsLoadError(toUserMessage(err, 'Could not load the saved alert thresholds.'))
      return
    }
    if (data?.value) {
      try {
        const parsed = JSON.parse(data.value)
        setAlertThresholds(prev => ({ ...ALERT_THRESHOLD_DEFAULTS, ...prev, ...parsed }))
      } catch {
        // keep defaults
      }
    }
  }

  async function loadNotifPrefs() {
    setLoadingNotif(true)
    setNotifError('')
    try {
      const prefs = await notifPrefsApi.getMyPreferences()
      setNotifPrefs({ ...DEFAULT_PREFS, ...prefs })
    } catch (err) {
      setNotifError(toUserMessage(err, 'Could not load your notification preferences.'))
    } finally {
      setLoadingNotif(false)
    }
  }

  function toggleNotifChannel(key) {
    const col = `channel_${key}`
    setNotifPrefs(p => ({ ...p, [col]: !p[col] }))
  }

  async function saveNotifPrefs(e) {
    e.preventDefault()
    setSavingNotif(true)
    setNotifMsg('')
    setNotifError('')
    try {
      const saved = await notifPrefsApi.upsertMyPreferences({
        channel_in_app:   notifPrefs.channel_in_app,
        channel_email:    notifPrefs.channel_email,
        channel_push:     notifPrefs.channel_push,
        channel_whatsapp: notifPrefs.channel_whatsapp,
        channel_sms:      notifPrefs.channel_sms,
        channel_slack:    notifPrefs.channel_slack,
        channel_teams:    notifPrefs.channel_teams,
        quiet_start:      notifPrefs.quiet_start || null,
        quiet_end:        notifPrefs.quiet_end || null,
        digest_frequency: notifPrefs.digest_frequency,
        min_priority:     notifPrefs.min_priority,
      })
      setNotifPrefs({ ...DEFAULT_PREFS, ...saved })
      setNotifMsg('Notification preferences saved')
    } catch (err) {
      setNotifError(toUserMessage(err, 'Could not save your notification preferences.'))
    } finally {
      setSavingNotif(false)
      setTimeout(() => setNotifMsg(''), 3000)
    }
  }

  async function saveAppSettings(e) {
    e.preventDefault()
    if (appLoadFailed) return
    if (!appSettings.company_name.trim() || !['SAR', 'AED', 'EGP', 'USD'].includes(appSettings.currency) || appSettings.cost_per_tyre === '' || !Number.isFinite(Number(appSettings.cost_per_tyre)) || Number(appSettings.cost_per_tyre) < 0) {
      setAppMsg('Enter a company name, currency and valid tyre cost before saving.')
      return
    }
    setSavingApp(true)
    setAppMsg('')
    try {
      const result = await settingsApi.saveAppSettings([
        { key: 'cost_per_tyre', value: String(appSettings.cost_per_tyre) },
        { key: 'company_name', value: JSON.stringify(appSettings.company_name) },
        { key: 'currency', value: JSON.stringify(appSettings.currency) },
      ])
      if (result.error) throw result.error
      await refreshSettings()
      setAppMsg('Settings saved')
    } catch (error) {
      setAppMsg(toUserMessage(error, 'Could not save settings. Reload before retrying.'))
    } finally {
      setSavingApp(false)
    }
  }

  async function saveProfile(e) {
    e.preventDefault()
    setSavingProfile(true)
    setProfileMsg('')
    const { error } = await settingsApi.updateProfile(user?.id, profileForm)
    setProfileMsg(error ? toUserMessage(error, 'Could not update profile.') : 'Profile updated')
    setSavingProfile(false)
    setTimeout(() => setProfileMsg(''), 3000)
  }

  function saveDateFormat(val) {
    setDateFormatState(val)
    localStorage.setItem('dateFormat', val)
  }

  function savePrefCurrency(val) {
    setPrefCurrency(val)
    localStorage.setItem('prefCurrency', val)
  }

  function savePrefCountry(val) {
    setPrefCountry(val)
    setActiveCountry(val)
  }

  async function saveThresholds(e) {
    e.preventDefault()
    setSavingThresholds(true)
    setThreshMsg('')

    // Save legacy fields to localStorage (backwards compat)
    localStorage.setItem('thresh_highRisk', highRiskPct)
    localStorage.setItem('thresh_critCost', critCostThresh)
    localStorage.setItem('thresh_lowTread', lowTreadMm)

    // Save new fields to app_settings
    const { error } = await settingsApi.upsertAppSetting(
      { key: 'alert_thresholds', value: JSON.stringify(alertThresholds), updated_by: profile?.id }
    )

    setThreshMsg(error ? toUserMessage(error, 'Save failed. Please try again.') : 'Thresholds saved')
    setSavingThresholds(false)
    setTimeout(() => setThreshMsg(''), 3000)
  }

  async function saveKpiTargets(e) {
    e.preventDefault()
    setSavingKpi(true)
    setKpiMsg('')

    const upserts = KPI_FIELDS.map(f => ({
      metric: f.key,
      target_value: draftKpiTargets[f.key] === '' ? null : Number(draftKpiTargets[f.key]),
      year: currentYear,
      month: null,
      site: null,
      region: 'Global',
      created_by: profile?.id,
    }))

    const { error } = await settingsApi.upsertKpiTargets(upserts)

    if (error) {
      setKpiMsg(toUserMessage(error, 'Save failed. Please try again.'))
    } else {
      setKpiTargets(draftKpiTargets)
      setEditingKpi(false)
      setKpiMsg('KPI targets saved')
    }
    setSavingKpi(false)
    setTimeout(() => setKpiMsg(''), 3000)
  }

  function cancelKpiEdit() {
    setDraftKpiTargets(kpiTargets)
    setEditingKpi(false)
    setKpiMsg('')
  }

  // report_schedules row ⇄ this section's UI shape
  const rowToUi = useCallback((r) => ({
    id: r.id,
    reportName: r.name,
    frequency: (r.frequency || 'daily').replace(/^./, (c) => c.toUpperCase()),
    dayOfWeek: NUM_TO_DOW[r.day_of_week ?? 1] ?? 'Monday',
    dayOfMonth: r.day_of_month ?? 1,
    time: r.time_of_day || '06:00',
    recipients: (r.recipients || []).join(', '),
    active: r.active !== false,
  }), [])

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true)
    setScheduleLoadError('')
    try {
      const { data, error } = await settingsApi.listReportSchedules()
      if (error) throw error
      setSchedules((data || []).map(rowToUi))
    } catch (err) {
      setScheduleLoadError(toUserMessage(err, 'Could not load schedules. Please try again.'))
    } finally {
      setSchedulesLoading(false)
    }
  }, [rowToUi])

  useEffect(() => {
    loadSettings()
    loadUploadHistory()
    loadKpiTargets()
    loadAlertThresholds()
    loadSchedules()
    loadNotifPrefs()
  }, [loadKpiTargets, loadSchedules])

  async function addSchedule() {
    if (!newSchedule.recipients.trim()) return
    setScheduleError('')
    const { error } = await settingsApi.insertReportSchedule({
      name: newSchedule.reportName,
      report_type: NAME_TO_TYPE[newSchedule.reportName] || 'executive',
      frequency: newSchedule.frequency.toLowerCase(),
      day_of_week: DOW_TO_NUM[newSchedule.dayOfWeek] ?? 1,
      day_of_month: newSchedule.dayOfMonth || 1,
      time_of_day: newSchedule.time,
      recipients: newSchedule.recipients.split(',').map((e) => e.trim()).filter(Boolean),
      active: newSchedule.active !== false,
      created_by: profile?.id ?? null,
    })
    if (error) { setScheduleError(toUserMessage(error, 'Could not save the schedule.')); return }
    setNewSchedule({ ...EMPTY_SCHEDULE })
    setShowAddForm(false)
    await loadSchedules()
  }

  async function deleteSchedule(id) {
    setScheduleError('')
    const { data, error } = await settingsApi.deleteReportSchedule(id)
    if (error || (data?.length ?? 0) === 0) {
      setScheduleError(toUserMessage(error, 'The schedule could not be deleted. Check your permissions.'))
      return
    }
    setTestMsg(prev => { const n = { ...prev }; delete n[id]; return n })
    await loadSchedules()
  }

  async function toggleScheduleActive(id) {
    const target = schedules.find(s => s.id === id)
    if (!target) return
    setScheduleError('')
    const { error } = await settingsApi.updateReportSchedule(id, { active: !target.active, next_run_at: null }) // delivery fn recomputes
    if (error) { setScheduleError(toUserMessage(error, 'Could not update the schedule.')); return }
    await loadSchedules()
  }

  async function handleTestSend(schedule) {
    setSendingTest(schedule.id)
    setTestMsg(prev => ({ ...prev, [schedule.id]: '' }))
    try {
      const recipients = schedule.recipients.split(',').map(e => e.trim()).filter(Boolean)
      if (recipients.length === 0) throw new Error('No valid recipients')
      await sendReportEmail({
        to: recipients,
        subject: `[Test] TyrePulse ${schedule.reportName}: ${scheduleLabel(schedule)}`,
        bodyHtml: `<p style="font-family:Arial,sans-serif;color:#1e293b;">
          <strong>Test Delivery</strong><br><br>
          This is a test send for your scheduled report:<br><br>
          <strong>Report:</strong> ${schedule.reportName}<br>
          <strong>Schedule:</strong> ${scheduleLabel(schedule)}<br>
          <strong>Delivery:</strong> Email digest<br><br>
          Automated delivery runs every 15 minutes via the send-scheduled-reports function.
        </p>`,
      })
      setTestMsg(prev => ({ ...prev, [schedule.id]: 'Test sent successfully' }))
    } catch (err) {
      setTestMsg(prev => ({ ...prev, [schedule.id]: toUserMessage(err, 'Failed. Please try again.') }))
    } finally {
      setSendingTest(null)
      setTimeout(() => setTestMsg(prev => { const n = { ...prev }; delete n[schedule.id]; return n }), 4000)
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault()
    if (pwNew.length < 6)           { setPwMsg('Minimum 6 characters required'); return }
    if (pwNew !== pwConfirm)        { setPwMsg('Passwords do not match'); return }
    setSavingPw(true)
    setPwMsg('')
    const { error } = await settingsApi.updatePassword(pwNew)
    if (error) {
      setPwMsg(toUserMessage(error, 'Something went wrong. Please try again.'))
    } else {
      setPwMsg('Password updated successfully')
      setPwNew('')
      setPwConfirm('')
    }
    setSavingPw(false)
    setTimeout(() => setPwMsg(''), 4000)
  }

  async function handleRemoveMfa() {
    setRemovingMfa(true)
    setMfaMsg('')
    try {
      const { data: factors } = await settingsApi.listMfaFactors()
      const factor = factors?.totp?.[0]
      if (!factor) throw new Error('No active TOTP factor found')
      const { error } = await settingsApi.unenrollMfaFactor(factor.id)
      if (error) throw error
      setMfaEnabled(false)
      setMfaMsg('Two-factor authentication removed')
    } catch (err) {
      setMfaMsg(toUserMessage(err, 'Failed. Please try again.'))
    } finally {
      setRemovingMfa(false)
      setConfirmRemoveMfa(false)
      setTimeout(() => setMfaMsg(''), 5000)
    }
  }

  const initials = getInitials(profileForm.full_name || profile?.full_name)
  const role     = profile?.role ?? 'Viewer'

  // ── Derived views (pure engine: src/lib/settingsAnalytics.js) ──────────────
  const scheduleRowsAll = useMemo(() => scheduleRows(schedules, new Date()), [schedules])
  const scheduleSummary = useMemo(() => summarizeSchedules(scheduleRowsAll), [scheduleRowsAll])
  const visibleSchedules = useMemo(
    () => filterSchedules(scheduleRowsAll, { q: scheduleQuery, status: scheduleStatus, frequency: scheduleFrequency }),
    [scheduleRowsAll, scheduleQuery, scheduleStatus, scheduleFrequency],
  )
  const readOnlyThresholds = useMemo(
    () => thresholdRows({ highRiskPct, critCostThresh, lowTreadMm }, alertThresholds, ALERT_THRESHOLD_FIELDS),
    [highRiskPct, critCostThresh, lowTreadMm, alertThresholds],
  )
  const overview = useMemo(() => settingsOverview({
    schedules: schedulesLoading || scheduleLoadError ? null : scheduleRowsAll,
    kpiTargets: kpiLoaded && !kpiLoadError ? kpiTargets : null,
    kpiFields: KPI_FIELDS,
    channelCount: loadingNotif || notifError ? null : summarisePrefs(notifPrefs).channelCount,
    mfaEnabled: typeof mfaEnabled === 'boolean' ? mfaEnabled : null,
    uploads: uploadsLoading || uploadsError ? null : uploadHistory,
  }), [schedulesLoading, scheduleLoadError, scheduleRowsAll, kpiLoaded, kpiLoadError, kpiTargets,
    loadingNotif, notifError, notifPrefs, mfaEnabled, uploadsLoading, uploadsError, uploadHistory])

  const scheduleColumns = [
    {
      id: 'report', header: 'Report', accessorKey: 'reportName', sortingFn: valueSort,
      cell: ({ getValue }) => <span className="text-[var(--text-primary)] font-medium">{getValue()}</span>,
    },
    { id: 'cadence', header: 'Schedule', accessorKey: 'label', sortingFn: valueSort },
    {
      id: 'next', header: 'Next delivery (Riyadh)', accessorFn: r => r.nextRun || undefined, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ getValue }) => (getValue() ? fmtDateTime(getValue()) : <span className="text-[var(--text-muted)]">Paused</span>),
      meta: { exportValue: r => (r.nextRun ? fmtDateTime(r.nextRun) : 'Paused') },
    },
    {
      id: 'recipients', header: 'Recipients', accessorFn: r => r.recipients || undefined, sortingFn: valueSort, sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="block max-w-xs">
          <span className="block text-xs text-[var(--text-secondary)] truncate" title={row.original.recipients || ''}>
            {row.original.recipients || <span className="italic text-[var(--text-muted)]">No recipients</span>}
          </span>
          {row.original.invalidRecipients.length > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
              <AlertTriangle size={11} className="text-amber-400" aria-hidden="true" /> {row.original.invalidRecipients.length} invalid address(es)
            </span>
          )}
        </span>
      ),
      meta: { exportValue: r => r.recipients || 'None' },
    },
    {
      id: 'status', header: 'Status', accessorKey: 'status', sortingFn: valueSort,
      cell: ({ row }) => {
        const sc = row.original
        return (
          <button
            type="button"
            onClick={() => toggleScheduleActive(sc.id)}
            role="switch"
            aria-checked={sc.active}
            className="inline-flex items-center gap-2 min-h-[44px] rounded-lg px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${sc.active ? 'bg-green-600' : 'bg-[var(--text-dim)]'}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${sc.active ? 'translate-x-4' : 'translate-x-1'}`} />
            </span>
            <span className="sr-only">{sc.reportName} schedule, </span>
            <span className="text-xs text-[var(--text-secondary)]">{sc.active ? 'Active' : 'Paused'}</span>
          </button>
        )
      },
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => {
        const sc = row.original
        return (
          <div className="flex items-center justify-end gap-2">
            {testMsg[sc.id] && (
              <span role="status" className={`text-xs ${testMsg[sc.id] === 'Test sent successfully' ? 'text-green-400' : 'text-red-400'}`}>
                {testMsg[sc.id]}
              </span>
            )}
            <button
              type="button"
              onClick={() => handleTestSend(sc)}
              disabled={sendingTest === sc.id}
              className="btn-secondary inline-flex items-center gap-1 text-xs min-h-[44px] px-3 disabled:opacity-40"
            >
              <Play size={12} aria-hidden="true" /> {sendingTest === sc.id ? 'Sending...' : 'Test Send'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteSchedule(sc)}
              aria-label={`Delete ${sc.reportName} schedule`}
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )
      },
    },
  ]

  // ── TyreMan: simplified profile-only view ──────────────────────────────────
  if (isTyreMan) {
    return (
      <>
      <div className="space-y-5">
        <PageHeader
          title="Profile & Settings"
          subtitle="Manage your account and password"
          icon={Settings2}
        />

        <UpdateHistory />

        {/* Profile */}
        {/* The content sits in CardBody rather than directly on the Card: Card is
            flex-col with align-items:stretch, so a bare control as a direct child
            would silently span the full width. CardBody is an ordinary block, so
            everything inside lays out exactly as it did under .card. */}
        <Card>
          <CardHeader level={2} title="Profile" icon={User} />
          <CardBody className="space-y-4">
          <div className="flex items-center gap-4 py-2">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-[var(--text-primary)] flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-[var(--text-primary)] font-medium text-sm truncate">{profileForm.full_name || profile?.username || 'No name set'}</p>
              <p className="text-[var(--text-secondary)] text-xs mt-0.5 truncate">{user?.email}</p>
              <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-teal-900/40 text-teal-300 border border-teal-700/30">
                Tyre Man
              </span>
            </div>
          </div>
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="label">Display Name</label>
              <input
                aria-label="Display Name"
                className="input"
                value={profileForm.full_name}
                onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your full name"
              />
            </div>
            <div>
              <label className="label">Username</label>
              <input
                aria-label="Username"
                className="input"
                value={profileForm.username}
                onChange={e => setProfileForm(f => ({ ...f, username: e.target.value }))}
                placeholder="username"
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={savingProfile}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm">
                <Save size={14} /> {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
              {profileMsg && (
                <span className={`text-sm ${profileMsg.toLowerCase().includes('error') ? 'text-red-400' : 'text-green-400'}`}>
                  {profileMsg}
                </span>
              )}
            </div>
          </form>
          </CardBody>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader level={2} title="Change Password" icon={Lock} iconTone="good" />
          <CardBody className="space-y-4">
          <form onSubmit={handlePasswordChange} className="space-y-3">
            <div>
              <label className="label">New Password</label>
              <input
                aria-label="New Password"
                type="password"
                className="input"
                value={pwNew}
                onChange={e => setPwNew(e.target.value)}
                placeholder="Min 6 characters"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <input
                aria-label="Confirm Password"
                type="password"
                className="input"
                value={pwConfirm}
                onChange={e => setPwConfirm(e.target.value)}
                placeholder="Repeat new password"
                autoComplete="new-password"
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={savingPw || !pwNew || !pwConfirm}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm"
              >
                <Save size={14} /> {savingPw ? 'Updating...' : 'Update Password'}
              </button>
              {pwMsg && (
                <span className={`text-sm ${
                  pwMsg.includes('success') ? 'text-green-400' : 'text-red-400'
                }`}>
                  {pwMsg}
                </span>
              )}
            </div>
          </form>
          </CardBody>
        </Card>

        {/* 2FA */}
        <RecoveryContactsCard />

        {/* 2FA */}
        <TwoFactorCard
          mfaEnabled={mfaEnabled}
          onEnable={() => setShowMfaSetup(true)}
          confirmRemoveMfa={confirmRemoveMfa}
          setConfirmRemoveMfa={setConfirmRemoveMfa}
          onRemove={handleRemoveMfa}
          removing={removingMfa}
          msg={mfaMsg}
        />

        {/* About */}
        <Card>
          <CardHeader level={2} title="About" icon={Info} />
          <CardBody className="space-y-1 text-sm text-[var(--text-secondary)]">
            <p><span className="text-[var(--text-muted)]">App:</span> <span className="text-[var(--text-primary)] font-medium">TyrePulse</span></p>
            <p><span className="text-[var(--text-muted)]">Version:</span> <span className="text-[var(--text-primary)] font-medium">v2.5.0</span></p>
            <p><span className="text-[var(--text-muted)]">Support:</span> Contact your tyre planning engineer</p>
          </CardBody>
        </Card>

        {/* Delete My Account (in-app deletion request) */}
        <AccountDeletionCard userEmail={user?.email} />
      </div>
      <TwoFactorSetup
        open={showMfaSetup}
        onClose={() => setShowMfaSetup(false)}
        onSuccess={() => { setMfaEnabled(true); setShowMfaSetup(false) }}
      />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Manage your profile, preferences, alerts, scheduled reports and account security"
        icon={Settings2}
      />

      <SettingsKpiStrip overview={overview} onJump={setTab} />

      <div role="tablist" aria-label="Settings sections" className="flex items-center gap-1 border-b border-[var(--border-bright)] overflow-x-auto">
        {SETTINGS_TABS.map(tb => {
          const on = tab === tb.id
          const Icon = TAB_ICONS[tb.id]
          return (
            <button
              key={tb.id}
              type="button"
              role="tab"
              id={`settings-tab-${tb.id}`}
              aria-selected={on}
              aria-controls={`settings-panel-${tb.id}`}
              onClick={() => setTab(tb.id)}
              className={`inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${on ? 'border-[var(--accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              {Icon && <Icon size={15} aria-hidden="true" />} {tb.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} className="space-y-6">
      {tab === 'general' && (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Column 1 - Profile */}
        <Card>
          <CardHeader level={2} title="Profile" icon={User} />
          <CardBody className="space-y-4">

          {/* Avatar */}
          <div className="flex flex-col items-center gap-3 py-2">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-[var(--text-primary)] select-none"
              style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
            >
              {initials}
            </div>
            <div className="text-center">
              <p className="text-[var(--text-primary)] font-medium">{profileForm.full_name || 'No name set'}</p>
              <p className="text-[var(--text-secondary)] text-xs mt-0.5">{user?.email}</p>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="label">Display Name</label>
              <input
                aria-label="Display Name"
                className="input"
                value={profileForm.full_name}
                onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your full name"
              />
            </div>
            <div>
              <label className="label">Username</label>
              <input
                aria-label="Username"
                className="input"
                value={profileForm.username}
                onChange={e => setProfileForm(f => ({ ...f, username: e.target.value }))}
                placeholder="username"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input aria-label="Email" className="input opacity-50 cursor-not-allowed" value={user?.email ?? ''} disabled />
            </div>
            <div className="flex items-center gap-3">
              <div>
                <label className="label mb-1">Role</label>
                <span className={`badge text-xs px-2 py-1 ${ROLE_BADGE[role] ?? ROLE_BADGE.Viewer}`}>{role}</span>
              </div>
              {profile?.country?.length > 0 && (
                <div>
                  <label className="label mb-1">Country</label>
                  <span className="text-xs px-2 py-1 rounded bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-bright)]">
                    {Array.isArray(profile.country) ? profile.country.join(', ') : profile.country}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={savingProfile} className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm">
                <Save size={14} /> {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
              {profileMsg && (
                <span className={`text-sm ${profileMsg.toLowerCase().includes('error') ? 'text-red-400' : 'text-green-400'}`}>
                  {profileMsg}
                </span>
              )}
            </div>
          </form>
          </CardBody>
        </Card>

        {/* Column 2 - Appearance (personal theme/accent/density/motion) */}
        <AppearancePanel />

        {/* The saved approval signature. It sits with the profile because it is
            a fact about the person, not about any one checklist or inspection. */}
        <MySignaturePanel />

        {/* Feature Flags (org-wide, admin only — same gate as other admin sections) */}
        {isAdmin && <FeatureFlagsPanel />}

        {/* Shareable report / TV links now live on their own full page under
            "Reports & Executive" > "Report Sharing" (/report-sharing). */}

        {/* App Preferences */}
        <Card>
          <CardHeader level={2} title="App Preferences" icon={Settings2} />
          <CardBody className="space-y-4">

          {/* Language */}
          <div>
            <label className="label">{t('common.language')}</label>
            <LanguageSwitcher variant="segment" className="mt-1" />
          </div>

          {/* Guided tour */}
          <div>
            <label className="label">{t('onboarding.guidedTour')}</label>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('tp:onboarding:replay'))}
              className="btn-secondary w-full mt-1 justify-center"
            >
              <Sparkles size={15} /> {t('onboarding.replay')}
            </button>
          </div>

          <form onSubmit={saveAppSettings} className="space-y-3">
            <div>
              <label className="label">Company Name</label>
              <input
                aria-label="Company Name"
                className="input"
                value={appSettings.company_name}
                onChange={e => setAppSettings(s => ({ ...s, company_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Default Currency</label>
              <select
                aria-label="Default Currency"
                className="input"
                value={appSettings.currency}
                onChange={e => setAppSettings(s => ({ ...s, currency: e.target.value }))}
              >
                <option value="" disabled>Select currency</option>
                <option value="SAR">SAR (Saudi Riyal)</option>
                <option value="AED">AED (UAE Dirham)</option>
                <option value="EGP">EGP (Egyptian Pound)</option>
                <option value="USD">USD (US Dollar)</option>
              </select>
            </div>
            <div>
              <label className="label">Active Country</label>
              <select
                aria-label="Active Country"
                className="input"
                value={prefCountry}
                onChange={e => savePrefCountry(e.target.value)}
              >
                <option value="All">All Countries</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date Format</label>
              <select
                aria-label="Date Format"
                className="input"
                value={dateFormat}
                onChange={e => saveDateFormat(e.target.value)}
              >
                {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Default Cost per Tyre</label>
              <input
                aria-label="Default Cost per Tyre"
                type="number"
                className="input"
                value={appSettings.cost_per_tyre}
                onChange={e => setAppSettings(s => ({ ...s, cost_per_tyre: +e.target.value }))}
                min={0}
                step={100}
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              {appLoadFailed && <button type="button" className="btn-secondary text-sm" onClick={loadSettings}>Retry loading settings</button>}
              <button type="submit" disabled={savingApp || appLoadFailed} className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm">
                <Save size={14} /> {savingApp ? 'Saving...' : 'Save App Settings'}
              </button>
              {appMsg && <span role="status" className={`text-sm ${appMsg === 'Settings saved' ? 'text-green-400' : 'text-red-400'}`}>{appMsg}</span>}
            </div>
          </form>
          </CardBody>
        </Card>

      </div>
      )}

      {tab === 'notifications' && (
      <>
      {/* Notification Preferences (per-user; §11 Notification engine slice) */}
      <Card>
        {/* ONE element in `actions`, which is what that slot is for - it is
            flex-shrink-0 and cannot wrap, so a multi-button row would push the
            card wider on a phone. */}
        <CardHeader
          level={2}
          title="Notifications"
          icon={BellRing}
          iconTone="good"
          description="Choose how and when TyrePulse notifies you. These are personal preferences and apply only to your account."
          actions={!loadingNotif ? (
            <span className="text-xs text-[var(--text-muted)]">
              {summarisePrefs(notifPrefs).channelCount} channel{summarisePrefs(notifPrefs).channelCount === 1 ? '' : 's'} on
            </span>
          ) : null}
        />
        <CardBody className="space-y-4">
        {notifError && (
          <p role="alert" className="text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-700/50 rounded-lg p-2.5 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[10rem]">{notifError}</span>
            <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={loadNotifPrefs}>Retry</button>
          </p>
        )}

        {loadingNotif ? (
          <div className="flex items-center gap-3 py-8 justify-center text-[var(--text-muted)] text-sm">
            <span className="w-4 h-4 border-2 border-[var(--border-bright)] border-t-emerald-400 rounded-full animate-spin inline-block" />
            Loading your preferences…
          </div>
        ) : (
          <form onSubmit={saveNotifPrefs} className="space-y-5">
            {/* Channels */}
            <div>
              <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Bell size={12} /> Delivery Channels
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {NOTIFICATION_CHANNELS.map(ch => {
                  const on = notifPrefs[`channel_${ch.key}`] === true
                  return (
                    <button
                      type="button"
                      key={ch.key}
                      onClick={() => toggleNotifChannel(ch.key)}
                      className={`flex items-center justify-between gap-3 min-h-[44px] rounded-xl border px-3.5 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        on
                          ? 'bg-emerald-500/10 border-emerald-600/50'
                          : 'bg-[var(--surface-2)] border-[var(--border-bright)] hover:border-[var(--border-bright)]'
                      }`}
                      aria-pressed={on}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--text-primary)]">{ch.label}{on ? <span className="sr-only"> (on)</span> : null}</span>
                        <span className="block text-xs text-[var(--text-muted)] truncate">{ch.hint}</span>
                      </span>
                      <span
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-600' : 'bg-[var(--text-dim)]'}`}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-1'}`} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Quiet hours + cadence + priority */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="label flex items-center gap-1.5"><Moon size={12} /> Quiet Hours Start</label>
                <input
                  aria-label="Quiet Hours Start"
                  type="time"
                  className="input"
                  value={(notifPrefs.quiet_start || '').slice(0, 5)}
                  onChange={e => setNotifPrefs(p => ({ ...p, quiet_start: e.target.value || null }))}
                />
              </div>
              <div>
                <label className="label flex items-center gap-1.5"><Moon size={12} /> Quiet Hours End</label>
                <input
                  aria-label="Quiet Hours End"
                  type="time"
                  className="input"
                  value={(notifPrefs.quiet_end || '').slice(0, 5)}
                  onChange={e => setNotifPrefs(p => ({ ...p, quiet_end: e.target.value || null }))}
                />
              </div>
              <div>
                <label className="label">Digest Frequency</label>
                <select
                  aria-label="Digest Frequency"
                  className="input"
                  value={notifPrefs.digest_frequency || 'none'}
                  onChange={e => setNotifPrefs(p => ({ ...p, digest_frequency: e.target.value }))}
                >
                  {DIGEST_FREQUENCIES.map(f => <option key={f} value={f}>{DIGEST_LABELS[f] || f}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Minimum Priority</label>
                <select
                  aria-label="Minimum Priority"
                  className="input"
                  value={notifPrefs.min_priority || 'low'}
                  onChange={e => setNotifPrefs(p => ({ ...p, min_priority: e.target.value }))}
                >
                  {PRIORITY_ORDER.map(pr => <option key={pr} value={pr}>{PRIORITY_LABELS[pr] || pr}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] -mt-1">
              Quiet hours suppress non-critical alerts within the window (wrap-around across midnight supported). Set both to the same value to disable.
            </p>

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={savingNotif} className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm">
                <Save size={14} /> {savingNotif ? 'Saving...' : 'Save Notification Preferences'}
              </button>
              {notifMsg && <span className="text-green-400 text-sm">{notifMsg}</span>}
            </div>
          </form>
        )}
        </CardBody>
      </Card>

      </>
      )}

      {tab === 'alerts' && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
        {/* Column 3 - Alert Thresholds */}
        <Card>
          <CardHeader
            level={2}
            title="Alert Thresholds"
            icon={Bell}
            description="Controls when risk alerts are triggered. Legacy fields stored locally; extended thresholds synced to database."
          />
          <CardBody className="space-y-4">
          {/* The admin gate is unchanged: admins edit, everyone else reads. */}
          {isAdmin ? (
            <form onSubmit={saveThresholds} className="space-y-3">
              {thresholdsLoadError && (
                <p role="alert" className="text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-700/50 rounded-lg p-2.5 flex flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-[10rem]">{thresholdsLoadError} Saving now would overwrite the stored values with the defaults shown.</span>
                  <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={loadAlertThresholds}>Retry</button>
                </p>
              )}
              <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide">Legacy Thresholds</p>
              <div>
                <label className="label">High Risk Threshold (%)</label>
                <input
                  aria-label="High Risk Threshold (%)"
                  type="number"
                  className="input"
                  value={highRiskPct}
                  onChange={e => setHighRiskPct(Number(e.target.value))}
                  min={0}
                  max={100}
                  step={1}
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Flag tyres with risk score above this %</p>
              </div>
              <div>
                <label className="label">Critical Cost Threshold</label>
                <input
                  aria-label="Critical Cost Threshold"
                  type="number"
                  className="input"
                  value={critCostThresh}
                  onChange={e => setCritCostThresh(Number(e.target.value))}
                  min={0}
                  step={1000}
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Alert when total repair cost exceeds this value</p>
              </div>
              <div>
                <label className="label">Low Tread Depth (mm)</label>
                <input
                  aria-label="Low Tread Depth (mm)"
                  type="number"
                  className="input"
                  value={lowTreadMm}
                  onChange={e => setLowTreadMm(Number(e.target.value))}
                  min={0}
                  max={20}
                  step={0.5}
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Warn when tread depth falls below this value</p>
              </div>

              <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide pt-2">Extended Thresholds</p>
              {ALERT_THRESHOLD_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
                    aria-label={f.label}
                    type="number"
                    className="input"
                    value={alertThresholds[f.key]}
                    onChange={e => setAlertThresholds(prev => ({ ...prev, [f.key]: Number(e.target.value) }))}
                    min={f.min ?? 0}
                    max={f.max}
                    step={f.step}
                  />
                </div>
              ))}

              <div className="flex items-center gap-3 pt-1">
                <button type="submit" disabled={savingThresholds} className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm">
                  <Save size={14} /> {savingThresholds ? 'Saving...' : 'Save Thresholds'}
                </button>
                {threshMsg && (
                  <span role="status" className={`text-sm ${threshMsg === 'Thresholds saved' ? 'text-green-400' : 'text-red-400'}`}>
                    {threshMsg}
                  </span>
                )}
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              {thresholdsLoadError && (
                <p role="alert" className="text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-700/50 rounded-lg p-2.5 flex flex-wrap items-center gap-2">
                  <span className="flex-1 min-w-[10rem]">{thresholdsLoadError}</span>
                  <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={loadAlertThresholds}>Retry</button>
                </p>
              )}
              {['Legacy', 'Extended'].map(group => (
                <div key={group}>
                  <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-wide pt-2">{group} Thresholds</p>
                  <dl className="divide-y divide-[var(--border-dim)] text-sm">
                    {readOnlyThresholds.filter(r => r.group === group).map(r => (
                      <div key={r.key} className="flex items-center justify-between gap-3 py-1.5">
                        <dt className="text-[var(--text-secondary)]">{r.label}</dt>
                        <dd className="text-[var(--text-primary)] tabular-nums text-right">
                          {group === 'Extended' && thresholdsLoadError ? 'N/A' : r.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
          </CardBody>
        </Card>
        </div>
        <div className="lg:col-span-2">
      {/* KPI Targets Editor */}
      <Card>
        <CardHeader
          level={2}
          title={`KPI Targets - ${currentYear}`}
          icon={Target}
          actions={isAdmin && !editingKpi ? (
            <button
              type="button"
              onClick={() => { setDraftKpiTargets(kpiTargets); setEditingKpi(true) }}
              disabled={Boolean(kpiLoadError)}
              className="btn-secondary text-sm min-h-[44px] disabled:opacity-50"
            >
              Edit Targets
            </button>
          ) : null}
        />
        <CardBody>
        {kpiLoadError && (
          <p role="alert" className="text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-700/50 rounded-lg p-2.5 mb-3 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[10rem]">{kpiLoadError}</span>
            <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={loadKpiTargets}>Retry</button>
          </p>
        )}
        {isAdmin && editingKpi ? (
          <form onSubmit={saveKpiTargets} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {KPI_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
                    aria-label={f.label}
                    type={f.type}
                    className="input"
                    value={draftKpiTargets[f.key]}
                    onChange={e => setDraftKpiTargets(prev => ({ ...prev, [f.key]: e.target.value }))}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    placeholder="No target set"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={savingKpi} className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm">
                <Save size={14} /> {savingKpi ? 'Saving...' : 'Save KPI Targets'}
              </button>
              <button type="button" onClick={cancelKpiEdit} className="btn-secondary text-sm">
                Cancel
              </button>
              {kpiMsg && (
                <span role="status" className={`text-sm ${kpiMsg === 'KPI targets saved' ? 'text-green-400' : 'text-red-400'}`}>
                  {kpiMsg}
                </span>
              )}
            </div>
          </form>
        ) : (
          <div>
            {kpiMsg && !editingKpi && (
              <p className="text-green-400 text-sm mb-3">{kpiMsg}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {KPI_FIELDS.map(f => {
                const val = kpiTargets[f.key]
                return (
                  <div key={f.key} className="bg-[var(--surface-2)] rounded-lg px-4 py-3 flex items-center justify-between">
                    <span className="text-[var(--text-secondary)] text-sm">{f.label}</span>
                    <span className="text-[var(--text-primary)] font-medium text-sm">
                      {kpiLoadError ? (
                        <span className="text-[var(--text-muted)] text-xs">N/A</span>
                      ) : val === '' || val === null || val === undefined ? (
                        <span className="text-[var(--text-muted)] text-xs italic">Not set</span>
                      ) : (
                        Number(val).toLocaleString()
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        </CardBody>
      </Card>

        </div>
      </div>
      )}

      {tab === 'reports' && (
      <>
      {/* Scheduled Reports */}
      <Card>
        <CardHeader
          level={2}
          title="Scheduled Reports"
          icon={Clock}
          actions={(
            <button
              type="button"
              onClick={() => { setShowAddForm(v => !v); setNewSchedule({ ...EMPTY_SCHEDULE }) }}
              aria-expanded={showAddForm}
              className="btn-primary text-sm flex items-center gap-2 min-h-[44px]"
            >
              <Plus size={14} aria-hidden="true" /> Add Schedule
            </button>
          )}
        />
        <CardBody>
        {scheduleError && (
          <p role="alert" className="text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-700/50 rounded-lg p-2.5 mb-4">{scheduleError}</p>
        )}

        {/* Info panel */}
        <div className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-700/40 rounded-lg px-4 py-3 mb-5">
          <ShieldCheck size={16} className="text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            <strong>Automated delivery is active.</strong> A scheduled job checks every 15 minutes and
            emails each active schedule to its recipients at the set time (Riyadh timezone). Use
            <strong> Test Send</strong> to receive one right now and confirm the address. If a report
            doesn&apos;t arrive, check the recipient address here and your spam folder.
          </p>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-xl p-4 mb-5 space-y-4">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">New Schedule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="label">Report Name</label>
                <select aria-label="Report Name" className="input" value={newSchedule.reportName}
                  onChange={e => setNewSchedule(s => ({ ...s, reportName: e.target.value }))}>
                  {REPORT_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Frequency</label>
                <select aria-label="Frequency" className="input" value={newSchedule.frequency}
                  onChange={e => setNewSchedule(s => ({ ...s, frequency: e.target.value }))}>
                  {SCHEDULE_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              {newSchedule.frequency === 'Weekly' && (
                <div>
                  <label className="label">Day of Week</label>
                  <select aria-label="Day of Week" className="input" value={newSchedule.dayOfWeek}
                    onChange={e => setNewSchedule(s => ({ ...s, dayOfWeek: e.target.value }))}>
                    {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              {newSchedule.frequency === 'Monthly' && (
                <div>
                  <label className="label">Day of Month</label>
                  <select aria-label="Day of Month" className="input" value={newSchedule.dayOfMonth}
                    onChange={e => setNewSchedule(s => ({ ...s, dayOfMonth: Number(e.target.value) }))}>
                    {DAYS_OF_MONTH.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Time</label>
                <select aria-label="Time" className="input" value={newSchedule.time}
                  onChange={e => setNewSchedule(s => ({ ...s, time: e.target.value }))}>
                  {HOUR_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Delivery</label>
                <div className="input flex items-center text-[var(--text-secondary)] text-sm cursor-default select-none">Email digest</div>
              </div>
              <div className={newSchedule.frequency === 'Daily' ? 'sm:col-span-2 lg:col-span-1' : ''}>
                <label className="label flex items-center gap-1"><Mail size={12} /> Recipients</label>
                <input
                  aria-label="Recipients"
                  className="input"
                  placeholder="email1@co.com, email2@co.com"
                  value={newSchedule.recipients}
                  onChange={e => setNewSchedule(s => ({ ...s, recipients: e.target.value }))}
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">Comma-separated email addresses</p>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={addSchedule}
                disabled={!newSchedule.recipients.trim()}
                className="btn-primary text-sm flex items-center gap-2 min-h-[44px] disabled:opacity-40"
              >
                <Plus size={14} /> Save Schedule
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="btn-secondary text-sm min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Schedules register */}
        {scheduleLoadError ? (
          <div role="alert" className="text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-700/50 rounded-lg p-3 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[10rem]">{scheduleLoadError}</span>
            <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={loadSchedules}>Retry</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <label className="relative block flex-1 min-w-[12rem]">
                <span className="sr-only">Search schedules by report, recipient or cadence</span>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" aria-hidden="true" />
                <input
                  type="search"
                  className="input pl-9 min-h-[44px]"
                  placeholder="Search schedules by report, recipient or cadence"
                  value={scheduleQuery}
                  onChange={e => setScheduleQuery(e.target.value)}
                />
              </label>
              <select aria-label="Filter schedules by status" className="input min-h-[44px] w-auto" value={scheduleStatus} onChange={e => setScheduleStatus(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
              <select aria-label="Filter schedules by frequency" className="input min-h-[44px] w-auto" value={scheduleFrequency} onChange={e => setScheduleFrequency(e.target.value)}>
                <option value="all">All frequencies</option>
                {SCHEDULE_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            {scheduleSummary.withInvalidRecipients > 0 && (
              <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-amber-400" aria-hidden="true" />
                {scheduleSummary.withInvalidRecipients} schedule(s) include an address that does not look like an email and will not be delivered to.
              </p>
            )}
            <EnterpriseTable
              columns={scheduleColumns}
              data={visibleSchedules}
              getRowId={r => String(r.id)}
              loading={schedulesLoading}
              enableGlobalFilter={false}
              enableColumnFilters={false}
              initialPageSize={25}
              exportFileName={reportFileName('Scheduled reports')}
              reportMeta={{ title: 'Scheduled reports' }}
              emptyMessage={scheduleRowsAll.length === 0 ? 'No scheduled reports configured. Use Add Schedule to create one.' : 'No schedule matches these filters.'}
            />
          </div>
        )}
        </CardBody>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader level={2} title="Data Management" icon={Database} />
        <CardBody>
        <p className="text-xs text-[var(--text-muted)] mb-3">Last 3 data uploads</p>
        {uploadsLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading upload history">
            {[0, 1, 2].map(i => <div key={i} className="h-12 rounded-lg bg-[var(--surface-2)] animate-pulse" />)}
          </div>
        ) : uploadsError ? (
          <p role="alert" className="text-sm text-[var(--text-primary)] bg-red-500/10 border border-red-700/50 rounded-lg p-2.5 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-[10rem]">{uploadsError}</span>
            <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={loadUploadHistory}>Retry</button>
          </p>
        ) : uploadHistory.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No uploads recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {uploadHistory.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-[var(--surface-2)] rounded-lg px-3 py-2 text-sm">
                <div>
                  <p className="text-[var(--text-primary)] text-sm">{(u.file_names ?? []).join(', ') || 'Unknown file'}</p>
                  <p className="text-xs text-[var(--text-muted)]">{u.uploaded_at ? new Date(u.uploaded_at).toLocaleString() : 'Date not recorded'}</p>
                </div>
                <div className="text-right">
                  <span className="text-[var(--text-primary)] text-xs tabular-nums">{u.records_added == null ? 'N/A' : `${Number(u.records_added).toLocaleString()} added`}</span>
                  {u.records_skipped > 0 && <span className="text-[var(--text-secondary)] text-xs ml-2 tabular-nums">{Number(u.records_skipped).toLocaleString()} skipped</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <Link to="/audit" className="btn-secondary text-sm inline-flex items-center gap-2 min-h-[44px]">
            View Full History
          </Link>
        </div>
        </CardBody>
      </Card>

      </>
      )}

      {tab === 'security' && (
      <>
      <RecoveryContactsCard />

      {/* Two-Factor Authentication */}
      <TwoFactorCard
        mfaEnabled={mfaEnabled}
        onEnable={() => setShowMfaSetup(true)}
        confirmRemoveMfa={confirmRemoveMfa}
        setConfirmRemoveMfa={setConfirmRemoveMfa}
        onRemove={handleRemoveMfa}
        removing={removingMfa}
        msg={mfaMsg}
      />

      {/* Delete My Account (in-app deletion request) */}
      <AccountDeletionCard userEmail={user?.email} />

      </>
      )}

      {tab === 'about' && (
      <>
      <UpdateHistory />
      {/* About */}
      <Card>
        <CardHeader level={2} title="About" icon={Info} />
        <CardBody className="space-y-1 text-sm text-[var(--text-secondary)]">
          <p><span className="text-[var(--text-muted)]">Version:</span> <span className="text-[var(--text-primary)] font-medium">v2.5.0</span></p>
          <p><span className="text-[var(--text-muted)]">Support:</span> Report an issue via the help menu</p>
        </CardBody>
      </Card>

      </>
      )}
      </div>

      <TwoFactorSetup
        open={showMfaSetup}
        onClose={() => setShowMfaSetup(false)}
        onSuccess={() => { setMfaEnabled(true); setShowMfaSetup(false) }}
      />

      <Modal
        open={Boolean(confirmDeleteSchedule)}
        onClose={() => { if (!deletingSchedule) setConfirmDeleteSchedule(null) }}
        title="Delete scheduled report"
        size="sm"
      >
        <p className="text-sm text-[var(--text-secondary)]">
          Delete the <span className="text-[var(--text-primary)] font-medium">{confirmDeleteSchedule?.reportName}</span> schedule
          ({confirmDeleteSchedule ? scheduleLabel(confirmDeleteSchedule) : ''})? Its recipients stop receiving it.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2 mt-4">
          <button type="button" className="btn-secondary text-sm min-h-[44px]" disabled={deletingSchedule} onClick={() => setConfirmDeleteSchedule(null)}>Cancel</button>
          <button
            type="button"
            disabled={deletingSchedule}
            onClick={async () => {
              setDeletingSchedule(true)
              try { await deleteSchedule(confirmDeleteSchedule.id) } finally {
                setDeletingSchedule(false)
                setConfirmDeleteSchedule(null)
              }
            }}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-60"
          >
            <Trash2 size={14} aria-hidden="true" /> {deletingSchedule ? 'Deleting...' : 'Delete schedule'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

/* ── Shared 2FA card ──────────────────────────────────────────────────────── */
function maskRecoveryContact(channel, value) {
  if (!value) return 'Not configured'
  if (channel === 'email') {
    const [local, domain] = value.split('@')
    return `${local?.slice(0, 2) || '*'}***@${domain || '***'}`
  }
  return `${value.slice(0, Math.min(4, value.length))}••••${value.slice(-3)}`
}

function RecoveryContactsCard() {
  const [contacts, setContacts] = useState({})
  const [drafts, setDrafts] = useState({ email: '', sms: '' })
  const [challenges, setChallenges] = useState({})
  const [codes, setCodes] = useState({ email: '', sms: '' })
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => {
    getRecoveryContacts().then(setContacts).catch(() => setContacts({}))
  }, [])
  useEffect(refresh, [refresh])

  async function requestCode(channel) {
    setMessage('')
    if (!recoveryDestinationIsValid(channel, drafts[channel])) {
      setMessage(channel === 'email' ? 'Enter a valid email address.' : 'Use international format, for example +966501234567.')
      return
    }
    setBusy(channel)
    try {
      const result = await requestRecoveryContactVerification({ channel, destination: drafts[channel] })
      setChallenges(previous => ({ ...previous, [channel]: result.challengeId }))
      setMessage(`A 6-digit code was sent by ${channel === 'email' ? 'email' : 'SMS'}. It expires in 10 minutes.`)
    } catch (error) {
      setMessage(toUserMessage(error, 'Could not send the verification code.'))
    } finally { setBusy('') }
  }

  async function verifyCode(channel) {
    setBusy(channel); setMessage('')
    try {
      await verifyRecoveryContact({ channel, destination: drafts[channel], challengeId: challenges[channel], code: codes[channel] })
      setChallenges(previous => ({ ...previous, [channel]: '' }))
      setCodes(previous => ({ ...previous, [channel]: '' }))
      setDrafts(previous => ({ ...previous, [channel]: '' }))
      setMessage(`${channel === 'email' ? 'Email' : 'Mobile number'} verified and ready for password recovery.`)
      refresh()
    } catch (error) {
      setMessage(toUserMessage(error, 'The code is invalid or expired.'))
    } finally { setBusy('') }
  }

  async function remove(channel) {
    setBusy(channel); setMessage('')
    try {
      await removeRecoveryContact(channel)
      setMessage(`${channel === 'email' ? 'Email' : 'Mobile number'} removed from password recovery.`)
      refresh()
    } catch (error) {
      setMessage(toUserMessage(error, 'Could not remove the recovery contact.'))
    } finally { setBusy('') }
  }

  return (
    <Card>
      <CardHeader
        level={2}
        title="Password recovery"
        icon={Lock}
        iconTone="good"
        description="Verify at least one contact before you need it. Your login email may be a non-routable system address, so only contacts verified here can recover your account."
      />
      <CardBody className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { channel: 'email', Icon: Mail, label: 'Recovery email', value: contacts.recovery_email, verified: contacts.recovery_email_verified_at, placeholder: 'you@company.com', type: 'email' },
          ...(RECOVERY_SMS_ENABLED ? [{ channel: 'sms', Icon: Phone, label: 'Recovery mobile', value: contacts.recovery_phone, verified: contacts.recovery_phone_verified_at, placeholder: '+966501234567', type: 'tel' }] : []),
        ].map(({ channel, Icon, label, value, verified, placeholder, type }) => (
          <div key={channel} className="rounded-xl border border-[var(--border-dim)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><Icon size={15}/>{label}</span>
              <span className={`text-xs ${verified ? 'text-green-400' : 'text-[var(--text-muted)]'}`}>{verified ? 'Verified' : 'Not verified'}</span>
            </div>
            {verified ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--text-secondary)]">{maskRecoveryContact(channel, value)}</p>
                <button type="button" disabled={busy === channel} onClick={() => remove(channel)} className="btn-secondary text-xs text-red-400">Remove</button>
              </div>
            ) : challenges[channel] ? (
              <div className="space-y-2">
                <label className="label" htmlFor={`settings-recovery-code-${channel}`}>6-digit code</label>
                <input id={`settings-recovery-code-${channel}`} className="input" inputMode="numeric" autoComplete="one-time-code"
                  value={codes[channel]} maxLength={6} pattern="[0-9]{6}"
                  onChange={event => setCodes(previous => ({ ...previous, [channel]: event.target.value.replace(/\D/g, '').slice(0, 6) }))}/>
                <div className="flex gap-2">
                  <button type="button" disabled={busy === channel || codes[channel].length !== 6} onClick={() => verifyCode(channel)} className="btn-primary text-xs">Verify</button>
                  <button type="button" onClick={() => setChallenges(previous => ({ ...previous, [channel]: '' }))} className="btn-secondary text-xs">Change</button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="label" htmlFor={`settings-recovery-${channel}`}>{label}</label>
                <input id={`settings-recovery-${channel}`} className="input" type={type} inputMode={type === 'tel' ? 'tel' : 'email'}
                  autoComplete={type === 'tel' ? 'tel' : 'email'} placeholder={placeholder} value={drafts[channel]}
                  onChange={event => setDrafts(previous => ({ ...previous, [channel]: event.target.value }))}/>
                <button type="button" disabled={busy === channel || !drafts[channel]} onClick={() => requestCode(channel)} className="btn-primary text-xs">
                  {busy === channel ? 'Sending…' : 'Send verification code'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {message && <p role="status" className={`text-sm ${/could not|invalid|failed|enter|use international/i.test(message) ? 'text-red-400' : 'text-green-400'}`}>{message}</p>}
      <p className="text-xs text-amber-300 flex gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5"/>{RECOVERY_SMS_ENABLED ? 'Keep two methods when possible. Mobile numbers can be recycled; enable two-factor authentication as an additional protection.' : 'Email recovery is available. SMS recovery will appear after the messaging service is provisioned; enable two-factor authentication as additional protection.'}</p>
      </CardBody>
    </Card>
  )
}

function TwoFactorCard({ mfaEnabled, onEnable, confirmRemoveMfa, setConfirmRemoveMfa, onRemove, removing, msg }) {
  return (
    <Card>
      {/* The enabled/disabled pill is a single status element, so it belongs in
          the non-wrapping `actions` slot. */}
      <CardHeader
        level={2}
        title="Two-Factor Authentication"
        icon={Shield}
        iconTone="warn"
        description="Two-factor authentication adds an extra layer of security. After entering your password, you will be asked for a code from your authenticator app."
        actions={mfaEnabled ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-900/40 text-green-400 border border-green-700/40 font-semibold">
            <ShieldCheck size={12} /> Enabled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-bright)] font-semibold">
            <ShieldOff size={12} /> Disabled
          </span>
        )}
      />
      <CardBody className="space-y-4">
      {mfaEnabled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 px-4 py-3 bg-green-950/30 border border-green-800/30 rounded-xl">
            <ShieldCheck size={16} className="text-green-400 shrink-0" />
            <p className="text-green-300 text-sm">Your account is protected with TOTP two-factor authentication.</p>
          </div>

          {!confirmRemoveMfa ? (
            <button
              type="button"
              onClick={() => setConfirmRemoveMfa(true)}
              className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl bg-red-950/30 border border-red-800/40 text-red-400 hover:bg-red-950/50 transition-colors font-medium"
            >
              <ShieldOff size={14} /> Remove 2FA
            </button>
          ) : (
            <div className="bg-red-950/20 border border-red-800/40 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-300 text-sm font-semibold">Remove two-factor authentication?</p>
                  <p className="text-red-400/70 text-xs mt-1 leading-relaxed">
                    This will remove the extra security layer from your account. You can re-enable it at any time.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmRemoveMfa(false)}
                  className="flex-1 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={removing}
                  className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-red-900/50 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {removing
                    ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Removing...</>
                    : 'Yes, Remove 2FA'
                  }
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 px-4 py-3 bg-orange-950/20 border border-orange-800/25 rounded-xl">
            <Shield size={16} className="text-orange-400/70 shrink-0" />
            <p className="text-orange-300/80 text-xs leading-relaxed">
              We recommend enabling 2FA for all accounts. It takes less than a minute to set up.
            </p>
          </div>
          <button
            type="button"
            onClick={onEnable}
            className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-400 text-white transition-colors font-semibold"
          >
            <Shield size={14} /> Enable Two-Factor Authentication
          </button>
        </div>
      )}

      {msg && (
        <p className={`text-sm ${msg.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{msg}</p>
      )}
      </CardBody>
    </Card>
  )
}

/* ── Account deletion card (in-app "Request account deletion") ─────────────────
 * Google Play / privacy require an in-app account & data deletion REQUEST path.
 * Submitting here only RECORDS a request for admin action — it never deletes
 * auth/user/business data client-side. Copy mirrors /data-deletion. */
function AccountDeletionCard({ userEmail }) {
  const [confirm, setConfirm]   = useState('')
  const [reason, setReason]     = useState('')
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [error, setError]       = useState('')
  const [requests, setRequests] = useState([])
  const [loaded, setLoaded]     = useState(false)

  useEffect(() => {
    let alive = true
    accountDeletionApi.listMyDeletionRequests()
      .then(rows => { if (alive) setRequests(rows) })
      .catch(() => { /* non-fatal: page still renders the request form */ })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  const armed = confirm.trim().toUpperCase() === 'DELETE'
  const hasOpen = requests.some(r => r.status === 'pending' || r.status === 'processing')

  async function submit(e) {
    e.preventDefault()
    if (!armed || saving) return
    setSaving(true); setMsg(''); setError('')
    try {
      const res = await accountDeletionApi.requestAccountDeletion(reason)
      if (!res.ok) {
        setError(res.message || accountDeletionApi.NOT_AVAILABLE_MESSAGE)
        return
      }
      setConfirm(''); setReason('')
      setMsg('Deletion request submitted. Our team will verify and process it.')
      setRequests(prev => [res.request, ...prev])
    } catch (err) {
      setError(toUserMessage(err, 'Could not submit your request. Please try again.'))
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(''), 6000)
    }
  }

  return (
    // tone="crit" is the red edge this card used to get from
    // `border border-red-900/40` - a border utility on a Card is dead, because
    // Card sets its border inline.
    <Card tone="crit">
      <CardHeader level={2} title="Delete My Account" icon={Trash2} iconTone="crit" />
      <CardBody className="space-y-4">
      <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
        Request permanent deletion of your account and the personal data associated with it. This
        submits a request for our team to verify and action; it does not delete anything immediately.
      </p>

      <div className="text-xs text-[var(--text-secondary)] leading-relaxed space-y-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg p-3">
        <p className="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <Info size={12} /> What happens
        </p>
        <ul className="list-disc pl-4 space-y-1">
          <li>Your profile and login (name, username, Employee ID, phone, device push token) are removed.</li>
          <li>Your captured location tags, photos, and diagnostic/crash records linked to your account are removed.</li>
          <li>
            Operational fleet records you created (inspections, accidents, work orders, meter logs) may be
            retained by your organisation as business/audit records, de-identified from your profile.
          </li>
          <li>Verified requests are completed within 30 days.</li>
        </ul>
        <p className="text-[var(--text-muted)]">
          Full details:{' '}
          <Link to="/data-deletion" className="text-red-400 hover:underline font-medium">Account &amp; Data Deletion policy</Link>
        </p>
      </div>

      {hasOpen && loaded && (
        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2.5">
          <Clock size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-300 leading-relaxed">
            You already have a deletion request in progress. Our team will contact you at
            {' '}<strong>{userEmail || 'your account email'}</strong> once it is processed.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5">{error}</p>
      )}
      {msg && (
        <div className="flex items-start gap-2 bg-green-950/30 border border-green-800/40 rounded-lg px-3 py-2.5">
          <ShieldCheck size={14} className="text-green-400 mt-0.5 shrink-0" />
          <p className="text-sm text-green-300">{msg}</p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Reason (optional)</label>
          <textarea
            aria-label="Reason for account deletion"
            className="input min-h-[68px] resize-y"
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={2000}
            placeholder="Tell us why you are leaving (optional)"
          />
        </div>
        <div>
          <label className="label flex items-center gap-1.5 text-red-300">
            <AlertTriangle size={12} /> Type DELETE to confirm
          </label>
          <input
            aria-label="Type DELETE to confirm account deletion"
            className="input"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={!armed || saving}
            className="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-red-900/40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
          >
            {saving
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Submitting...</>
              : <><Trash2 size={14} /> Request Account Deletion</>
            }
          </button>
          <span className="text-xs text-[var(--text-muted)]">This records a request; it does not delete data instantly.</span>
        </div>
      </form>
      </CardBody>
    </Card>
  )
}
