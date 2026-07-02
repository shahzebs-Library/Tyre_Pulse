import { useEffect, useState, useCallback } from 'react'
import {
  Settings2, Save, RefreshCw, AlertTriangle, CheckCircle,
  Shield, Zap, Bell, Database, Globe, Lock, Mail, Clock,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'

const CONFIG_GROUPS = [
  {
    label: 'System',
    icon: Settings2,
    color: 'orange',
    configs: [
      { key: 'maintenance_mode',      type: 'bool',   label: 'Maintenance Mode',         desc: 'When ON, regular users see the maintenance screen. Super-admins can still access the console.' },
      { key: 'registration_open',     type: 'bool',   label: 'Open Registration',        desc: 'Allow new users to self-register from the mobile app.' },
      { key: 'require_approval',      type: 'bool',   label: 'Require User Approval',    desc: 'New users must be approved by an admin before they can log in.' },
      { key: 'app_version',           type: 'string', label: 'Current App Version',      desc: 'Displayed in the app footer and used for update prompts.' },
      { key: 'max_upload_rows',       type: 'number', label: 'Max Upload Rows',          desc: 'Maximum number of rows allowed per Excel upload.' },
    ],
  },
  {
    label: 'AI',
    icon: Zap,
    color: 'yellow',
    configs: [
      { key: 'ai_enabled',            type: 'bool',   label: 'AI Features Enabled',      desc: 'Master toggle for all AI-powered features across the platform.' },
      { key: 'ai_model',              type: 'string', label: 'Default AI Model',         desc: 'The LLM model used for analysis. E.g. claude-3-5-sonnet-20241022' },
      { key: 'ai_monthly_budget_usd', type: 'number', label: 'Monthly AI Budget (USD)',  desc: 'Alert when cumulative AI spend exceeds this amount.' },
      { key: 'ai_rate_limit_per_min', type: 'number', label: 'AI Rate Limit (req/min)',  desc: 'Maximum AI requests per minute per organisation.' },
      { key: 'ai_cache_ttl_hours',    type: 'number', label: 'Cache TTL (hours)',        desc: 'How long AI responses are cached before a fresh call is made.' },
    ],
  },
  {
    label: 'Security',
    icon: Shield,
    color: 'red',
    configs: [
      { key: 'session_timeout_hours', type: 'number', label: 'Session Timeout (hours)',  desc: 'Automatically sign out inactive users after this many hours.' },
      { key: 'max_login_attempts',    type: 'number', label: 'Max Login Attempts',       desc: 'Lock account after this many failed login attempts.' },
      { key: 'password_min_length',   type: 'number', label: 'Minimum Password Length', desc: 'Enforce a minimum password length for all users.' },
      { key: 'two_factor_required',   type: 'bool',   label: 'Require 2FA (Admins)',     desc: 'Require two-factor authentication for Admin role users.' },
      { key: 'audit_retention_days',  type: 'number', label: 'Audit Retention (days)',   desc: 'How long to keep audit log entries. 0 = keep forever.' },
    ],
  },
  {
    label: 'Notifications',
    icon: Bell,
    color: 'blue',
    configs: [
      { key: 'email_notifications',   type: 'bool',   label: 'Email Notifications',      desc: 'Enable transactional emails (approvals, alerts, resets).' },
      { key: 'alert_email',           type: 'string', label: 'System Alert Email',       desc: 'Where to send system alerts and error notifications.' },
      { key: 'digest_frequency',      type: 'string', label: 'Digest Frequency',         desc: 'How often to send fleet digest emails. Options: daily, weekly, monthly.' },
      { key: 'push_notifications',    type: 'bool',   label: 'Push Notifications',       desc: 'Enable push notifications to mobile app users.' },
    ],
  },
  {
    label: 'Data',
    icon: Database,
    color: 'green',
    configs: [
      { key: 'data_retention_months', type: 'number', label: 'Data Retention (months)', desc: 'Archive records older than this many months. 0 = keep forever.' },
      { key: 'backup_enabled',        type: 'bool',   label: 'Automated Backups',       desc: 'Enable daily automated database backups.' },
      { key: 'export_enabled',        type: 'bool',   label: 'CSV/Excel Export',        desc: 'Allow users to export data to CSV and Excel.' },
      { key: 'max_export_rows',       type: 'number', label: 'Max Export Rows',         desc: 'Maximum rows per export operation.' },
    ],
  },
]

const COLOR = {
  orange: { icon: 'text-orange-400', border: 'border-orange-800/30', bg: 'bg-orange-900/10' },
  yellow: { icon: 'text-yellow-400', border: 'border-yellow-800/30', bg: 'bg-yellow-900/10' },
  red:    { icon: 'text-red-400',    border: 'border-red-800/30',    bg: 'bg-red-900/10' },
  blue:   { icon: 'text-blue-400',   border: 'border-blue-800/30',   bg: 'bg-blue-900/10' },
  green:  { icon: 'text-green-400',  border: 'border-green-800/30',  bg: 'bg-green-900/10' },
}

export default function ConsoleSystemConfig() {
  const { logAction } = useConsoleAuth()
  const [configs, setConfigs] = useState({})   // key -> value (string)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty]     = useState(false)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setDirty(false); setSaved(false)
    const { data } = await supabase.from('system_config').select('key, value')
    const map = {}
    ;(data ?? []).forEach(row => { map[row.key] = row.value })
    setConfigs(map)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function getVal(key, type) {
    const raw = configs[key]
    if (raw === undefined || raw === null) {
      if (type === 'bool')   return false
      if (type === 'number') return ''
      return ''
    }
    if (type === 'bool')   return raw === 'true' || raw === true
    if (type === 'number') return raw
    return raw
  }

  function setVal(key, type, val) {
    let stored = val
    if (type === 'bool') stored = val ? 'true' : 'false'
    setConfigs(prev => ({ ...prev, [key]: stored }))
    setDirty(true); setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    const rows = Object.entries(configs).map(([key, value]) => ({
      key, value: String(value ?? ''), updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase
      .from('system_config')
      .upsert(rows, { onConflict: 'key', ignoreDuplicates: false })
    if (!error) {
      await logAction('update_config', null, 'system', { keys: Object.keys(configs).length })
      setSaved(true); setDirty(false)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">System Configuration</h1>
          <p className="text-sm text-gray-500 mt-0.5">Global platform settings and feature flags</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 disabled:opacity-50 transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handleSave} disabled={!dirty || saving}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-all ${
              saved ? 'bg-green-700' : ''
            }`}
            style={!saved ? { background: 'linear-gradient(135deg,#ea580c,#f97316)' } : {}}>
            {saving ? <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Saving...</>
              : saved ? <><CheckCircle size={13} /> Saved</>
              : <><Save size={13} /> Save Changes</>
            }
          </button>
        </div>
      </div>

      {dirty && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-950/30 border border-orange-700/40">
          <AlertTriangle size={13} className="text-orange-400 flex-shrink-0" />
          <p className="text-xs text-orange-300">You have unsaved changes. Click Save Changes to apply globally.</p>
        </div>
      )}

      {/* Maintenance mode prominent toggle */}
      {(configs.maintenance_mode === 'true') && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-950/50 border border-red-700/50">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300 font-semibold">Maintenance Mode is ACTIVE - regular users cannot access the app</p>
          <button onClick={() => setVal('maintenance_mode', 'bool', false)}
            className="ml-auto text-xs text-red-300 underline hover:text-red-200">Disable</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {CONFIG_GROUPS.map(group => {
            const c = COLOR[group.color]
            const Icon = group.icon
            return (
              <div key={group.label} className={`rounded-xl border ${c.border} ${c.bg} overflow-hidden`}>
                <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800/40">
                  <Icon size={15} className={c.icon} />
                  <h3 className="text-sm font-semibold text-white">{group.label}</h3>
                </div>
                <div className="divide-y divide-gray-800/40">
                  {group.configs.map(cfg => (
                    <div key={cfg.key} className="flex items-center gap-4 px-5 py-3.5 hover:bg-black/10 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-200">{cfg.label}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">{cfg.desc}</p>
                      </div>
                      <div className="flex-shrink-0 w-48">
                        {cfg.type === 'bool' ? (
                          <button
                            onClick={() => setVal(cfg.key, 'bool', !getVal(cfg.key, 'bool'))}
                            className={`w-12 h-6 rounded-full relative transition-all ${
                              getVal(cfg.key, 'bool') ? 'bg-orange-500' : 'bg-gray-700'
                            }`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
                              getVal(cfg.key, 'bool') ? 'left-7' : 'left-1'
                            }`} />
                          </button>
                        ) : cfg.type === 'number' ? (
                          <input
                            type="number"
                            value={getVal(cfg.key, 'number')}
                            onChange={e => setVal(cfg.key, 'number', e.target.value)}
                            className="w-full h-8 bg-gray-800/80 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500"
                          />
                        ) : (
                          <input
                            type="text"
                            value={getVal(cfg.key, 'string')}
                            onChange={e => setVal(cfg.key, 'string', e.target.value)}
                            className="w-full h-8 bg-gray-800/80 border border-gray-700 rounded-lg px-3 text-xs text-white focus:outline-none focus:border-orange-500"
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
