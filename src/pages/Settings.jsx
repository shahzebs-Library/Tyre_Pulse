import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as settingsApi from '../lib/api/settings'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../contexts/LanguageContext'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { Save, User, Settings2, Bell, Database, Info, Target, Clock, Mail, Calendar, Trash2, Plus, Play, Lock, Shield, ShieldCheck, ShieldOff, AlertTriangle, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import { sendReportEmail } from '../lib/emailService'
import TwoFactorSetup from '../components/TwoFactorSetup'

const ROLE_BADGE = {
  Admin:   'bg-purple-900/50 text-purple-300 border border-purple-700/50',
  Manager: 'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  Viewer:  'bg-gray-800 text-gray-300 border border-gray-700',
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

function getScheduleLabel(schedule) {
  if (schedule.frequency === 'Daily') return `Daily at ${schedule.time}`
  if (schedule.frequency === 'Weekly') return `Weekly · ${schedule.dayOfWeek} at ${schedule.time}`
  return `Monthly · Day ${schedule.dayOfMonth} at ${schedule.time}`
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

  const [appSettings, setAppSettings] = useState({ cost_per_tyre: 1200, company_name: '', currency: 'SAR' })
  const [profileForm, setProfileForm]  = useState({ full_name: '', username: '' })
  const [savingApp, setSavingApp]      = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [appMsg, setAppMsg]            = useState('')
  const [profileMsg, setProfileMsg]    = useState('')
  const [uploadHistory, setUploadHistory] = useState([])

  // Local preferences stored in localStorage
  const [theme, setThemeState]         = useState(() => localStorage.getItem('theme') ?? 'dark')
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
  const [scheduleError, setScheduleError] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSchedule, setNewSchedule] = useState({ ...EMPTY_SCHEDULE })
  const [sendingTest, setSendingTest] = useState(null) // schedule id
  const [testMsg, setTestMsg] = useState({}) // { [id]: string }

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

  useEffect(() => { loadSettings(); loadUploadHistory(); loadKpiTargets(); loadAlertThresholds(); loadSchedules() }, [])
  useEffect(() => { setAppSettings(s => ({ ...s, ...globalSettings })) }, [globalSettings])
  useEffect(() => {
    if (profile) setProfileForm({ full_name: profile.full_name ?? '', username: profile.username ?? '' })
  }, [profile])

  async function loadSettings() {
    const { data } = await settingsApi.listSettings()
    if (data) {
      const map = {}
      data.forEach(({ key, value }) => { map[key] = typeof value === 'string' ? JSON.parse(value) : value })
      setAppSettings(s => ({ ...s, ...map }))
    }
  }

  async function loadUploadHistory() {
    const { data } = await settingsApi.listUploadHistory()
    setUploadHistory(data ?? [])
  }

  async function loadKpiTargets() {
    const { data } = await settingsApi.listKpiTargetsByYear(currentYear)
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
  }

  async function loadAlertThresholds() {
    const { data } = await settingsApi.getAlertThresholds()
    if (data?.value) {
      try {
        const parsed = JSON.parse(data.value)
        setAlertThresholds(prev => ({ ...ALERT_THRESHOLD_DEFAULTS, ...prev, ...parsed }))
      } catch {
        // keep defaults
      }
    }
  }

  async function saveAppSettings(e) {
    e.preventDefault()
    setSavingApp(true)
    setAppMsg('')
    await Promise.all([
      settingsApi.upsertSetting({ key: 'cost_per_tyre', value: String(appSettings.cost_per_tyre), updated_by: profile?.id }),
      settingsApi.upsertSetting({ key: 'company_name', value: JSON.stringify(appSettings.company_name), updated_by: profile?.id }),
      settingsApi.upsertSetting({ key: 'currency', value: JSON.stringify(appSettings.currency), updated_by: profile?.id }),
    ])
    await refreshSettings()
    setAppMsg('Settings saved')
    setSavingApp(false)
    setTimeout(() => setAppMsg(''), 3000)
  }

  async function saveProfile(e) {
    e.preventDefault()
    setSavingProfile(true)
    setProfileMsg('')
    const { error } = await settingsApi.updateProfile(user?.id, profileForm)
    setProfileMsg(error ? error.message : 'Profile updated')
    setSavingProfile(false)
    setTimeout(() => setProfileMsg(''), 3000)
  }

  function applyTheme(val) {
    setThemeState(val)
    localStorage.setItem('theme', val)
    if (val === 'dark') {
      document.documentElement.classList.add('dark')
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
    }
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

    setThreshMsg(error ? 'Save failed: ' + error.message : 'Thresholds saved')
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
      setKpiMsg('Save failed: ' + error.message)
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
  const DOW_TO_NUM = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
  const NUM_TO_DOW = Object.fromEntries(Object.entries(DOW_TO_NUM).map(([k, v]) => [v, k]))
  const NAME_TO_TYPE = {
    'Fleet Summary': 'fleet', 'KPI Report': 'kpi', 'Vendor Intelligence': 'cost',
    'Executive Report': 'executive', 'Forecasting': 'kpi', 'Work Orders Summary': 'cost',
  }
  const rowToUi = (r) => ({
    id: r.id,
    reportName: r.name,
    frequency: (r.frequency || 'daily').replace(/^./, (c) => c.toUpperCase()),
    dayOfWeek: NUM_TO_DOW[r.day_of_week ?? 1] ?? 'Monday',
    dayOfMonth: r.day_of_month ?? 1,
    time: r.time_of_day || '06:00',
    recipients: (r.recipients || []).join(', '),
    active: r.active !== false,
  })

  async function loadSchedules() {
    const { data, error } = await settingsApi.listReportSchedules()
    if (error) { setScheduleError(error.message); return }
    setSchedules((data || []).map(rowToUi))
  }

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
    if (error) { setScheduleError(`Could not save the schedule: ${error.message}`); return }
    setNewSchedule({ ...EMPTY_SCHEDULE })
    setShowAddForm(false)
    await loadSchedules()
  }

  async function deleteSchedule(id) {
    setScheduleError('')
    const { data, error } = await settingsApi.deleteReportSchedule(id)
    if (error || (data?.length ?? 0) === 0) {
      setScheduleError(error?.message || 'The schedule could not be deleted - check your permissions.')
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
    if (error) { setScheduleError(`Could not update the schedule: ${error.message}`); return }
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
        subject: `[Test] TyrePulse ${schedule.reportName} - ${getScheduleLabel(schedule)}`,
        bodyHtml: `<p style="font-family:Arial,sans-serif;color:#1e293b;">
          <strong>Test Delivery</strong><br><br>
          This is a test send for your scheduled report:<br><br>
          <strong>Report:</strong> ${schedule.reportName}<br>
          <strong>Schedule:</strong> ${getScheduleLabel(schedule)}<br>
          <strong>Delivery:</strong> Email digest<br><br>
          Automated delivery runs every 15 minutes via the send-scheduled-reports function.
        </p>`,
      })
      setTestMsg(prev => ({ ...prev, [schedule.id]: 'Test sent successfully' }))
    } catch (err) {
      setTestMsg(prev => ({ ...prev, [schedule.id]: `Failed: ${err.message}` }))
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
      setPwMsg(error.message)
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
      setMfaMsg('Failed: ' + (err.message ?? 'Unknown error'))
    } finally {
      setRemovingMfa(false)
      setConfirmRemoveMfa(false)
      setTimeout(() => setMfaMsg(''), 5000)
    }
  }

  const initials = getInitials(profileForm.full_name || profile?.full_name)
  const role     = profile?.role ?? 'Viewer'

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

        {/* Profile */}
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2"><User size={16} /> Profile</h2>
          <div className="flex items-center gap-4 py-2">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
            >
              {initials}
            </div>
            <div className="min-w-0">
              <p className="text-white font-medium text-sm truncate">{profileForm.full_name || profile?.username || 'No name set'}</p>
              <p className="text-gray-400 text-xs mt-0.5 truncate">{user?.email}</p>
              <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-teal-900/40 text-teal-300 border border-teal-700/30">
                Tyre Man
              </span>
            </div>
          </div>
          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="label">Display Name</label>
              <input
                className="input"
                value={profileForm.full_name}
                onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your full name"
              />
            </div>
            <div>
              <label className="label">Username</label>
              <input
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
        </div>

        {/* Change Password */}
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Lock size={16} className="text-green-400" /> Change Password
          </h2>
          <form onSubmit={handlePasswordChange} className="space-y-3">
            <div>
              <label className="label">New Password</label>
              <input
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
        </div>

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
        <div className="card">
          <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-3"><Info size={16} /> About</h2>
          <div className="space-y-1 text-sm text-gray-400">
            <p><span className="text-gray-500">App:</span> <span className="text-white font-medium">TyrePulse</span></p>
            <p><span className="text-gray-500">Version:</span> <span className="text-white font-medium">v2.5.0</span></p>
            <p><span className="text-gray-500">Support:</span> Contact your tyre planning engineer</p>
          </div>
        </div>
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
        subtitle="Manage your profile, preferences and alert thresholds"
        icon={Settings2}
      />

      {/* 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Column 1 - Profile */}
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2"><User size={16} /> Profile</h2>

          {/* Avatar */}
          <div className="flex flex-col items-center gap-3 py-2">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white select-none"
              style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
            >
              {initials}
            </div>
            <div className="text-center">
              <p className="text-white font-medium">{profileForm.full_name || 'No name set'}</p>
              <p className="text-gray-400 text-xs mt-0.5">{user?.email}</p>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-3">
            <div>
              <label className="label">Display Name</label>
              <input
                className="input"
                value={profileForm.full_name}
                onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Your full name"
              />
            </div>
            <div>
              <label className="label">Username</label>
              <input
                className="input"
                value={profileForm.username}
                onChange={e => setProfileForm(f => ({ ...f, username: e.target.value }))}
                placeholder="username"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input opacity-50 cursor-not-allowed" value={user?.email ?? ''} disabled />
            </div>
            <div className="flex items-center gap-3">
              <div>
                <label className="label mb-1">Role</label>
                <span className={`badge text-xs px-2 py-1 ${ROLE_BADGE[role] ?? ROLE_BADGE.Viewer}`}>{role}</span>
              </div>
              {profile?.country?.length > 0 && (
                <div>
                  <label className="label mb-1">Country</label>
                  <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">
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
        </div>

        {/* Column 2 - App Preferences */}
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2"><Settings2 size={16} /> App Preferences</h2>

          {/* Theme toggle */}
          <div>
            <label className="label">Theme</label>
            <div className="flex gap-2 mt-1">
              {['dark', 'light'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => applyTheme(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${
                    theme === t
                      ? 'bg-green-700 text-white border-green-600'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
                  }`}
                >
                  {t === 'dark' ? '🌙 Dark' : '☀ Light'}
                </button>
              ))}
            </div>
          </div>

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
                className="input"
                value={appSettings.company_name}
                onChange={e => setAppSettings(s => ({ ...s, company_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Default Currency</label>
              <select
                className="input"
                value={appSettings.currency}
                onChange={e => setAppSettings(s => ({ ...s, currency: e.target.value }))}
              >
                <option value="SAR">SAR · Saudi Riyal</option>
                <option value="AED">AED · UAE Dirham</option>
                <option value="EGP">EGP · Egyptian Pound</option>
                <option value="USD">USD · US Dollar</option>
              </select>
            </div>
            <div>
              <label className="label">Active Country</label>
              <select
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
                type="number"
                className="input"
                value={appSettings.cost_per_tyre}
                onChange={e => setAppSettings(s => ({ ...s, cost_per_tyre: +e.target.value }))}
                min={0}
                step={100}
              />
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={savingApp} className="btn-primary flex items-center gap-2 disabled:opacity-50 text-sm">
                <Save size={14} /> {savingApp ? 'Saving...' : 'Save App Settings'}
              </button>
              {appMsg && <span className="text-green-400 text-sm">{appMsg}</span>}
            </div>
          </form>
        </div>

        {/* Column 3 - Alert Thresholds */}
        <div className="card space-y-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2"><Bell size={16} /> Alert Thresholds</h2>
          <p className="text-xs text-gray-500">
            Controls when risk alerts are triggered. Legacy fields stored locally; extended thresholds synced to database.
          </p>

          {isAdmin ? (
            <form onSubmit={saveThresholds} className="space-y-3">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Legacy Thresholds</p>
              <div>
                <label className="label">High Risk Threshold (%)</label>
                <input
                  type="number"
                  className="input"
                  value={highRiskPct}
                  onChange={e => setHighRiskPct(Number(e.target.value))}
                  min={0}
                  max={100}
                  step={1}
                />
                <p className="text-xs text-gray-500 mt-1">Flag tyres with risk score above this %</p>
              </div>
              <div>
                <label className="label">Critical Cost Threshold</label>
                <input
                  type="number"
                  className="input"
                  value={critCostThresh}
                  onChange={e => setCritCostThresh(Number(e.target.value))}
                  min={0}
                  step={1000}
                />
                <p className="text-xs text-gray-500 mt-1">Alert when total repair cost exceeds this value</p>
              </div>
              <div>
                <label className="label">Low Tread Depth (mm)</label>
                <input
                  type="number"
                  className="input"
                  value={lowTreadMm}
                  onChange={e => setLowTreadMm(Number(e.target.value))}
                  min={0}
                  max={20}
                  step={0.5}
                />
                <p className="text-xs text-gray-500 mt-1">Warn when tread depth falls below this value</p>
              </div>

              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide pt-2">Extended Thresholds</p>
              {ALERT_THRESHOLD_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
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
                  <span className={`text-sm ${threshMsg.includes('failed') ? 'text-red-400' : 'text-green-400'}`}>
                    {threshMsg}
                  </span>
                )}
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Legacy Thresholds</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-800">
                  <tr>
                    <td className="py-1.5 text-gray-400">High Risk Threshold</td>
                    <td className="py-1.5 text-white text-right">{highRiskPct}%</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-400">Critical Cost Threshold</td>
                    <td className="py-1.5 text-white text-right">{critCostThresh.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-400">Low Tread Depth</td>
                    <td className="py-1.5 text-white text-right">{lowTreadMm} mm</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide pt-2">Extended Thresholds</p>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-800">
                  {ALERT_THRESHOLD_FIELDS.map(f => (
                    <tr key={f.key}>
                      <td className="py-1.5 text-gray-400">{f.label}</td>
                      <td className="py-1.5 text-white text-right">{alertThresholds[f.key]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* KPI Targets Editor */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Target size={16} /> KPI Targets - {currentYear}
          </h2>
          {isAdmin && !editingKpi && (
            <button
              type="button"
              onClick={() => { setDraftKpiTargets(kpiTargets); setEditingKpi(true) }}
              className="btn-secondary text-sm"
            >
              Edit Targets
            </button>
          )}
        </div>

        {isAdmin && editingKpi ? (
          <form onSubmit={saveKpiTargets} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {KPI_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
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
                <span className={`text-sm ${kpiMsg.includes('failed') ? 'text-red-400' : 'text-green-400'}`}>
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
                  <div key={f.key} className="bg-gray-800/50 rounded-lg px-4 py-3 flex items-center justify-between">
                    <span className="text-gray-400 text-sm">{f.label}</span>
                    <span className="text-white font-medium text-sm">
                      {val === '' || val === null || val === undefined ? (
                        <span className="text-gray-600 text-xs italic">Not set</span>
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
      </div>

      {/* Data Management */}
      <div className="card">
        <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-4"><Database size={16} /> Data Management</h2>
        <p className="text-xs text-gray-500 mb-3">Last 3 data uploads</p>
        {uploadHistory.length === 0 ? (
          <p className="text-gray-500 text-sm">No uploads yet</p>
        ) : (
          <div className="space-y-2">
            {uploadHistory.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2 text-sm">
                <div>
                  <p className="text-white text-sm">{(u.file_names ?? []).join(', ') || 'Unknown file'}</p>
                  <p className="text-xs text-gray-500">{new Date(u.uploaded_at).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <span className="text-green-400 text-xs">+{u.records_added}</span>
                  {u.records_skipped > 0 && <span className="text-yellow-400 text-xs ml-2">skip {u.records_skipped}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <Link to="/audit" className="btn-secondary text-sm inline-flex items-center gap-2">
            View Full History
          </Link>
        </div>
      </div>

      {/* Scheduled Reports */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Clock size={16} /> Scheduled Reports
          </h2>
          <button
            type="button"
            onClick={() => { setShowAddForm(v => !v); setNewSchedule({ ...EMPTY_SCHEDULE }) }}
            className="btn-primary text-sm flex items-center gap-2"
          >
            <Plus size={14} /> Add Schedule
          </button>
        </div>

        {scheduleError && (
          <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{scheduleError}</p>
        )}

        {/* Info panel */}
        <div className="flex items-start gap-3 bg-blue-950/40 border border-blue-800/40 rounded-lg px-4 py-3 mb-5">
          <Calendar size={16} className="text-blue-400 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-300 leading-relaxed">
            Schedules are stored locally. To enable automated delivery, connect a cron service or
            Supabase Edge Function with <code className="font-mono bg-blue-900/40 px-1 rounded">pg_cron</code>.
            Use <strong>Test Send</strong> to verify recipients immediately.
          </p>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 mb-5 space-y-4">
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">New Schedule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="label">Report Name</label>
                <select className="input" value={newSchedule.reportName}
                  onChange={e => setNewSchedule(s => ({ ...s, reportName: e.target.value }))}>
                  {REPORT_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Frequency</label>
                <select className="input" value={newSchedule.frequency}
                  onChange={e => setNewSchedule(s => ({ ...s, frequency: e.target.value }))}>
                  {SCHEDULE_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              {newSchedule.frequency === 'Weekly' && (
                <div>
                  <label className="label">Day of Week</label>
                  <select className="input" value={newSchedule.dayOfWeek}
                    onChange={e => setNewSchedule(s => ({ ...s, dayOfWeek: e.target.value }))}>
                    {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              {newSchedule.frequency === 'Monthly' && (
                <div>
                  <label className="label">Day of Month</label>
                  <select className="input" value={newSchedule.dayOfMonth}
                    onChange={e => setNewSchedule(s => ({ ...s, dayOfMonth: Number(e.target.value) }))}>
                    {DAYS_OF_MONTH.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="label">Time</label>
                <select className="input" value={newSchedule.time}
                  onChange={e => setNewSchedule(s => ({ ...s, time: e.target.value }))}>
                  {HOUR_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Delivery</label>
                <div className="input flex items-center text-gray-400 text-sm cursor-default select-none">Email digest</div>
              </div>
              <div className={newSchedule.frequency === 'Daily' ? 'sm:col-span-2 lg:col-span-1' : ''}>
                <label className="label flex items-center gap-1"><Mail size={12} /> Recipients</label>
                <input
                  className="input"
                  placeholder="email1@co.com, email2@co.com"
                  value={newSchedule.recipients}
                  onChange={e => setNewSchedule(s => ({ ...s, recipients: e.target.value }))}
                />
                <p className="text-xs text-gray-500 mt-1">Comma-separated email addresses</p>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={addSchedule}
                disabled={!newSchedule.recipients.trim()}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-40"
              >
                <Plus size={14} /> Save Schedule
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Schedules table */}
        {schedules.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-gray-700 rounded-xl">
            <Clock size={28} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No scheduled reports configured</p>
            <p className="text-gray-600 text-xs mt-1">Click Add Schedule to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/60">
                  <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Report</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Schedule</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Format</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Recipients</th>
                  <th className="text-center py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Status</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium text-xs uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {schedules.map(schedule => (
                  <tr key={schedule.id} className="hover:bg-gray-800/30 transition-colors group">
                    <td className="py-3 px-3">
                      <span className="text-white font-medium">{schedule.reportName}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-gray-300">{getScheduleLabel(schedule)}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 border border-gray-700">
                        Email digest
                      </span>
                    </td>
                    <td className="py-3 px-3 max-w-xs">
                      <span className="text-gray-400 text-xs truncate block">
                        {schedule.recipients || <span className="italic text-gray-600">No recipients</span>}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggleScheduleActive(schedule.id)}
                        title={schedule.active ? 'Pause schedule' : 'Activate schedule'}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          schedule.active ? 'bg-green-600' : 'bg-gray-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            schedule.active ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <span className={`block text-xs mt-0.5 ${schedule.active ? 'text-green-400' : 'text-gray-500'}`}>
                        {schedule.active ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {testMsg[schedule.id] && (
                          <span className={`text-xs ${testMsg[schedule.id].startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                            {testMsg[schedule.id]}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleTestSend(schedule)}
                          disabled={sendingTest === schedule.id}
                          title="Send test email now"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-900/40 text-blue-400 border border-blue-800/50 hover:bg-blue-800/50 transition-colors disabled:opacity-40"
                        >
                          <Play size={11} /> {sendingTest === schedule.id ? 'Sending...' : 'Test Send'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSchedule(schedule.id)}
                          title="Delete schedule"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-900/30 text-red-400 border border-red-800/40 hover:bg-red-900/50 transition-colors"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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

      {/* About */}
      <div className="card">
        <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-3"><Info size={16} /> About</h2>
        <div className="space-y-1 text-sm text-gray-400">
          <p><span className="text-gray-500">Version:</span> <span className="text-white font-medium">v2.5.0</span></p>
          <p><span className="text-gray-500">Support:</span> Report an issue via the help menu</p>
        </div>
      </div>

      <TwoFactorSetup
        open={showMfaSetup}
        onClose={() => setShowMfaSetup(false)}
        onSuccess={() => { setMfaEnabled(true); setShowMfaSetup(false) }}
      />
    </div>
  )
}

/* ── Shared 2FA card ──────────────────────────────────────────────────────── */
function TwoFactorCard({ mfaEnabled, onEnable, confirmRemoveMfa, setConfirmRemoveMfa, onRemove, removing, msg }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Shield size={16} className="text-orange-400" /> Two-Factor Authentication
        </h2>
        {mfaEnabled ? (
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-900/40 text-green-400 border border-green-700/40 font-semibold">
            <ShieldCheck size={12} /> Enabled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-500 border border-gray-700 font-semibold">
            <ShieldOff size={12} /> Disabled
          </span>
        )}
      </div>

      <p className="text-gray-400 text-xs leading-relaxed">
        Two-factor authentication adds an extra layer of security. After entering your password, you will be asked for a code from your authenticator app.
      </p>

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
                  className="flex-1 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm font-medium transition-colors"
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
    </div>
  )
}
