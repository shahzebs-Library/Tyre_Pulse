import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { Save, User, Settings2, Bell, Database, Info, Target } from 'lucide-react'

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

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function Settings() {
  const { profile, user } = useAuth()
  const { appSettings: globalSettings, refreshSettings, setActiveCountry, activeCountry } = useSettings()
  const isAdmin = profile?.role === 'Admin'
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

  // Alert thresholds — 3 legacy localStorage fields
  const [highRiskPct, setHighRiskPct]      = useState(() => Number(localStorage.getItem('thresh_highRisk') ?? 25))
  const [critCostThresh, setCritCostThresh] = useState(() => Number(localStorage.getItem('thresh_critCost') ?? 50000))
  const [lowTreadMm, setLowTreadMm]        = useState(() => Number(localStorage.getItem('thresh_lowTread') ?? 2))

  // Alert thresholds — 5 new fields persisted to app_settings
  const [alertThresholds, setAlertThresholds] = useState(ALERT_THRESHOLD_DEFAULTS)
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [threshMsg, setThreshMsg] = useState('')

  // KPI Targets
  const [kpiTargets, setKpiTargets]         = useState(KPI_DEFAULTS)
  const [draftKpiTargets, setDraftKpiTargets] = useState(KPI_DEFAULTS)
  const [editingKpi, setEditingKpi]         = useState(false)
  const [savingKpi, setSavingKpi]           = useState(false)
  const [kpiMsg, setKpiMsg]                 = useState('')

  useEffect(() => { loadSettings(); loadUploadHistory(); loadKpiTargets(); loadAlertThresholds() }, [])
  useEffect(() => { setAppSettings(s => ({ ...s, ...globalSettings })) }, [globalSettings])
  useEffect(() => {
    if (profile) setProfileForm({ full_name: profile.full_name ?? '', username: profile.username ?? '' })
  }, [profile])

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('key, value')
    if (data) {
      const map = {}
      data.forEach(({ key, value }) => { map[key] = typeof value === 'string' ? JSON.parse(value) : value })
      setAppSettings(s => ({ ...s, ...map }))
    }
  }

  async function loadUploadHistory() {
    const { data } = await supabase
      .from('upload_history')
      .select('id, file_names, records_added, records_skipped, uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(3)
    setUploadHistory(data ?? [])
  }

  async function loadKpiTargets() {
    const { data } = await supabase
      .from('kpi_targets')
      .select('*')
      .eq('year', currentYear)
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
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'alert_thresholds')
      .single()
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
      supabase.from('settings').upsert({ key: 'cost_per_tyre', value: String(appSettings.cost_per_tyre), updated_by: profile?.id }, { onConflict: 'key' }),
      supabase.from('settings').upsert({ key: 'company_name', value: JSON.stringify(appSettings.company_name), updated_by: profile?.id }, { onConflict: 'key' }),
      supabase.from('settings').upsert({ key: 'currency', value: JSON.stringify(appSettings.currency), updated_by: profile?.id }, { onConflict: 'key' }),
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
    const { error } = await supabase.from('profiles').update(profileForm).eq('id', user?.id)
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
    const { error } = await supabase.from('app_settings').upsert(
      { key: 'alert_thresholds', value: JSON.stringify(alertThresholds), updated_by: profile?.id },
      { onConflict: 'key' }
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

    const { error } = await supabase
      .from('kpi_targets')
      .upsert(upserts, { onConflict: 'metric,year,month,site' })

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

  const initials = getInitials(profileForm.full_name || profile?.full_name)
  const role     = profile?.role ?? 'Viewer'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your profile, preferences and alert thresholds</p>
      </div>

      {/* 3-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Column 1 — Profile */}
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
                <Save size={14} /> {savingProfile ? 'Saving…' : 'Save Profile'}
              </button>
              {profileMsg && (
                <span className={`text-sm ${profileMsg.toLowerCase().includes('error') ? 'text-red-400' : 'text-green-400'}`}>
                  {profileMsg}
                </span>
              )}
            </div>
          </form>
        </div>

        {/* Column 2 — App Preferences */}
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
                <Save size={14} /> {savingApp ? 'Saving…' : 'Save App Settings'}
              </button>
              {appMsg && <span className="text-green-400 text-sm">{appMsg}</span>}
            </div>
          </form>
        </div>

        {/* Column 3 — Alert Thresholds */}
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
                  <Save size={14} /> {savingThresholds ? 'Saving…' : 'Save Thresholds'}
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
            <Target size={16} /> KPI Targets — {currentYear}
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
                <Save size={14} /> {savingKpi ? 'Saving…' : 'Save KPI Targets'}
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

      {/* About */}
      <div className="card">
        <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-3"><Info size={16} /> About</h2>
        <div className="space-y-1 text-sm text-gray-400">
          <p><span className="text-gray-500">Version:</span> <span className="text-white font-medium">v2.5.0</span></p>
          <p><span className="text-gray-500">Support:</span> Report an issue via the help menu</p>
        </div>
      </div>
    </div>
  )
}
