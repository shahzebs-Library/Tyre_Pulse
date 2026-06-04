import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Save, User, Settings2 } from 'lucide-react'

export default function Settings() {
  const { profile, user } = useAuth()
  const [appSettings, setAppSettings] = useState({ cost_per_tyre: 1200, company_name: '', currency: 'SAR' })
  const [profileForm, setProfileForm] = useState({ full_name: '', username: '' })
  const [savingApp, setSavingApp] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [appMsg, setAppMsg] = useState('')
  const [profileMsg, setProfileMsg] = useState('')
  const [uploadHistory, setUploadHistory] = useState([])

  useEffect(() => {
    loadSettings()
    loadUploadHistory()
  }, [])

  useEffect(() => {
    if (profile) {
      setProfileForm({ full_name: profile.full_name ?? '', username: profile.username ?? '' })
    }
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
      .limit(10)
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your profile and application settings</p>
      </div>

      {/* Profile */}
      <div className="card">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2"><User size={16} /> Profile</h2>
        <form onSubmit={saveProfile} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Full Name</label><input className="input" value={profileForm.full_name} onChange={e => setProfileForm(f => ({ ...f, full_name: e.target.value }))} /></div>
            <div><label className="label">Username</label><input className="input" value={profileForm.username} onChange={e => setProfileForm(f => ({ ...f, username: e.target.value }))} /></div>
          </div>
          <div><label className="label">Email</label><input className="input opacity-50 cursor-not-allowed" value={user?.email ?? ''} disabled /></div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingProfile} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              <Save size={16} /> {savingProfile ? 'Saving…' : 'Save Profile'}
            </button>
            {profileMsg && <span className={`text-sm ${profileMsg.includes('error') || profileMsg.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>{profileMsg}</span>}
          </div>
        </form>
      </div>

      {/* App Settings */}
      <div className="card">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2"><Settings2 size={16} /> Application Settings</h2>
        <form onSubmit={saveAppSettings} className="space-y-3">
          <div><label className="label">Company Name</label><input className="input" value={appSettings.company_name} onChange={e => setAppSettings(s => ({ ...s, company_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Default Cost per Tyre (SAR)</label>
              <input type="number" className="input" value={appSettings.cost_per_tyre} onChange={e => setAppSettings(s => ({ ...s, cost_per_tyre: +e.target.value }))} min={0} step={100} />
            </div>
            <div>
              <label className="label">Currency</label>
              <select className="input" value={appSettings.currency} onChange={e => setAppSettings(s => ({ ...s, currency: e.target.value }))}>
                <option value="SAR">SAR — Saudi Riyal</option>
                <option value="USD">USD — US Dollar</option>
                <option value="AED">AED — UAE Dirham</option>
                <option value="EUR">EUR — Euro</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={savingApp} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              <Save size={16} /> {savingApp ? 'Saving…' : 'Save Settings'}
            </button>
            {appMsg && <span className="text-green-400 text-sm">{appMsg}</span>}
          </div>
        </form>
      </div>

      {/* Upload History */}
      <div className="card">
        <h2 className="text-base font-semibold text-white mb-4">Recent Upload History</h2>
        {uploadHistory.length === 0 ? (
          <p className="text-gray-500 text-sm">No uploads yet</p>
        ) : (
          <div className="space-y-2">
            {uploadHistory.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-gray-800/50 rounded-lg px-3 py-2 text-sm">
                <div>
                  <p className="text-white">{(u.file_names ?? []).join(', ') || 'Unknown file'}</p>
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
      </div>
    </div>
  )
}
