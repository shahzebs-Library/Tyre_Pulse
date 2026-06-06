import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { Save, User, Settings2, Bell, Database, Info } from 'lucide-react'

const ROLE_BADGE = {
  Admin:   'bg-purple-900/50 text-purple-300 border border-purple-700/50',
  Manager: 'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  Viewer:  'bg-gray-800 text-gray-300 border border-gray-700',
}

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']
const CURRENCIES   = ['SAR', 'AED', 'EGP', 'USD']

function getInitials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function Settings() {
  const { profile, user } = useAuth()
  const { appSettings: globalSettings, refreshSettings, setActiveCountry, activeCountry } = useSettings()

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

  // Alert thresholds — stored in localStorage (could be Supabase profiles later)
  const [highRiskPct, setHighRiskPct]      = useState(() => Number(localStorage.getItem('thresh_highRisk') ?? 25))
  const [critCostThresh, setCritCostThresh] = useState(() => Number(localStorage.getItem('thresh_critCost') ?? 50000))
  const [lowTreadMm, setLowTreadMm]        = useState(() => Number(localStorage.getItem('thresh_lowTread') ?? 2))

  useEffect(() => { loadSettings(); loadUploadHistory() }, [])
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

  function saveThresholds(e) {
    e.preventDefault()
    localStorage.setItem('thresh_highRisk', highRiskPct)
    localStorage.setItem('thresh_critCost', critCostThresh)
    localStorage.setItem('thresh_lowTread', lowTreadMm)
    setAppMsg('Thresholds saved')
    setTimeout(() => setAppMsg(''), 3000)
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
          <p className="text-xs text-gray-500">These values control when risk alerts are triggered. Stored locally on this device.</p>

          <form onSubmit={saveThresholds} className="space-y-3">
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
            <button type="submit" className="btn-primary flex items-center gap-2 text-sm">
              <Save size={14} /> Save Thresholds
            </button>
          </form>
        </div>
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
