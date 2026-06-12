import { useEffect, useState, useCallback } from 'react'
import { Layers, RefreshCw, Save, CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useConsoleAuth } from '../ConsoleAuthContext'

const ROLES = ['Admin', 'Manager', 'Director', 'Inspector', 'Tyre Man', 'Reporter', 'Driver']

const MODULES = [
  { key: 'dashboard',           label: 'Dashboard',              group: 'Core' },
  { key: 'tyre_records',        label: 'Tyre Records',           group: 'Core' },
  { key: 'inspections',         label: 'Inspections',            group: 'Core' },
  { key: 'fleet_master',        label: 'Fleet Master',           group: 'Core' },
  { key: 'alerts',              label: 'Alerts',                 group: 'Core' },
  { key: 'stock',               label: 'Stock Management',       group: 'Operations' },
  { key: 'budgets',             label: 'Budgets',                group: 'Operations' },
  { key: 'work_orders',         label: 'Work Orders',            group: 'Operations' },
  { key: 'accidents',           label: 'Accidents',              group: 'Operations' },
  { key: 'corrective_actions',  label: 'Corrective Actions',     group: 'Operations' },
  { key: 'gate_pass',           label: 'Gate Pass',              group: 'Operations' },
  { key: 'maintenance_calendar',label: 'Maintenance Calendar',   group: 'Operations' },
  { key: 'daily_ops',           label: 'Daily Operations',       group: 'Operations' },
  { key: 'rca',                 label: 'RCA Records',            group: 'Operations' },
  { key: 'analytics',           label: 'Analytics',              group: 'Analytics' },
  { key: 'kpi_scorecard',       label: 'KPI Scorecard',          group: 'Analytics' },
  { key: 'brand_performance',   label: 'Brand Performance',      group: 'Analytics' },
  { key: 'site_comparison',     label: 'Site Comparison',        group: 'Analytics' },
  { key: 'fleet_analytics',     label: 'Fleet Analytics',        group: 'Analytics' },
  { key: 'country_comparison',  label: 'Country Comparison',     group: 'Analytics' },
  { key: 'ai_command_center',   label: 'AI Command Center',      group: 'AI' },
  { key: 'ai_analytics',        label: 'AI Analytics',           group: 'AI' },
  { key: 'root_cause_engine',   label: 'Root Cause Engine',      group: 'Intelligence' },
  { key: 'predictive_maintenance', label: 'Predictive Maintenance', group: 'Intelligence' },
  { key: 'vendor_intelligence', label: 'Vendor Intelligence',    group: 'Intelligence' },
  { key: 'position_intelligence', label: 'Position Intelligence', group: 'Intelligence' },
  { key: 'pressure_intelligence', label: 'Pressure Intelligence', group: 'Intelligence' },
  { key: 'fleet_intelligence',  label: 'Fleet Intelligence',     group: 'Intelligence' },
  { key: 'forecasting',         label: 'Forecasting Engine',     group: 'Intelligence' },
  { key: 'upload_data',         label: 'Upload Data',            group: 'Data' },
  { key: 'custom_data',         label: 'Custom Data Manager',    group: 'Data' },
  { key: 'data_cleaning',       label: 'Data Cleaning',          group: 'Data' },
  { key: 'audit_trail',         label: 'Audit Trail',            group: 'Data' },
  { key: 'user_management',     label: 'User Management',        group: 'Admin' },
  { key: 'erp_sync',            label: 'ERP Sync',               group: 'Admin' },
  { key: 'reports',             label: 'Reports',                group: 'Reports' },
  { key: 'executive_report',    label: 'Executive Report',       group: 'Reports' },
]

const GROUPS = ['Core', 'Operations', 'Analytics', 'AI', 'Intelligence', 'Data', 'Admin', 'Reports']

export default function ConsolePermissions() {
  const { logAction, activeOrg } = useConsoleAuth()
  const [perms, setPerms]   = useState({})   // { role_module: bool }
  const [orgs, setOrgs]     = useState([])
  const [selOrg, setSelOrg] = useState(activeOrg?.id ?? '__global__')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dirty, setDirty]       = useState(false)
  const [saved, setSaved]       = useState(false)
  const [selGroup, setSelGroup] = useState('All')

  useEffect(() => {
    supabase.from('organisations').select('id, name').order('name')
      .then(({ data }) => setOrgs(data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setDirty(false); setSaved(false)
    const orgFilter = selOrg === '__global__' ? null : selOrg
    const q = supabase.from('module_permissions').select('*')
    const { data } = orgFilter
      ? await q.eq('organisation_id', orgFilter)
      : await q.is('organisation_id', null)

    // Build map: role__module -> enabled
    const map = {}
    // Default: all enabled for Admin, limited for others (start from DB rows)
    ;(data ?? []).forEach(row => {
      map[`${row.role}__${row.module}`] = row.enabled
    })

    // For any missing combos, set sensible defaults
    ROLES.forEach(role => {
      MODULES.forEach(m => {
        const k = `${role}__${m.key}`
        if (!(k in map)) {
          // Default permissions
          if (role === 'Admin') map[k] = true
          else if (role === 'Manager' || role === 'Director') {
            map[k] = !['user_management', 'erp_sync', 'data_cleaning', 'audit_trail'].includes(m.key)
          } else if (role === 'Inspector') {
            map[k] = ['dashboard', 'inspections', 'tyre_records', 'alerts', 'fleet_master', 'gate_pass', 'daily_ops'].includes(m.key)
          } else if (role === 'Tyre Man') {
            map[k] = ['dashboard', 'inspections', 'tyre_records', 'alerts', 'stock', 'work_orders', 'gate_pass'].includes(m.key)
          } else if (role === 'Reporter') {
            map[k] = ['dashboard', 'analytics', 'kpi_scorecard', 'reports', 'executive_report', 'tyre_records'].includes(m.key)
          } else if (role === 'Driver') {
            map[k] = ['dashboard', 'inspections', 'alerts'].includes(m.key)
          } else {
            map[k] = false
          }
        }
      })
    })
    setPerms(map)
    setLoading(false)
  }, [selOrg])

  useEffect(() => { load() }, [load])

  function toggle(role, moduleKey) {
    const k = `${role}__${moduleKey}`
    setPerms(prev => ({ ...prev, [k]: !prev[k] }))
    setDirty(true); setSaved(false)
  }

  function setAllForRole(role, value) {
    const update = {}
    MODULES.forEach(m => { update[`${role}__${m.key}`] = value })
    setPerms(prev => ({ ...prev, ...update }))
    setDirty(true); setSaved(false)
  }

  function setAllForModule(moduleKey, value) {
    const update = {}
    ROLES.forEach(r => { update[`${r}__${moduleKey}`] = value })
    setPerms(prev => ({ ...prev, ...update }))
    setDirty(true); setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    const orgId = selOrg === '__global__' ? null : selOrg
    const rows = []
    ROLES.forEach(role => {
      MODULES.forEach(m => {
        rows.push({
          organisation_id: orgId,
          role,
          module: m.key,
          enabled: perms[`${role}__${m.key}`] ?? false,
        })
      })
    })

    // Upsert all rows
    const { error } = await supabase
      .from('module_permissions')
      .upsert(rows, { onConflict: 'organisation_id,role,module', ignoreDuplicates: false })

    if (!error) {
      await logAction('update_permissions', orgId, 'permissions', { org: selOrg, modules: rows.length })
      setSaved(true); setDirty(false)
    }
    setSaving(false)
  }

  const displayedModules = selGroup === 'All'
    ? MODULES
    : MODULES.filter(m => m.group === selGroup)

  return (
    <div className="space-y-5 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Module Permissions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Control which roles can access which modules</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs border border-gray-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handleSave} disabled={!dirty || saving}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 ${
              saved ? 'bg-green-700 text-white' : 'text-white'
            }`}
            style={!saved ? { background: 'linear-gradient(135deg,#ea580c,#f97316)' } : {}}>
            {saving ? <><div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              : saved ? <><CheckCircle size={13} /> Saved</>
              : <><Save size={13} /> Save Changes</>
            }
          </button>
        </div>
      </div>

      {dirty && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-950/30 border border-orange-700/40">
          <AlertTriangle size={13} className="text-orange-400 flex-shrink-0" />
          <p className="text-xs text-orange-300">You have unsaved permission changes. Click Save Changes to apply.</p>
        </div>
      )}

      {/* Org + Group selectors */}
      <div className="flex flex-wrap gap-3 items-center">
        <div>
          <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">Organisation</label>
          <select value={selOrg} onChange={e => setSelOrg(e.target.value)}
            className="h-9 bg-gray-800 border border-gray-700 rounded-lg px-3 text-xs text-gray-300 focus:outline-none focus:border-orange-500">
            <option value="__global__">Global Defaults</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-600 uppercase tracking-wider block mb-1">Module Group</label>
          <div className="flex gap-1 flex-wrap">
            {['All', ...GROUPS].map(g => (
              <button key={g} onClick={() => setSelGroup(g)}
                className={`h-9 px-3 rounded-lg text-xs transition-colors border ${
                  selGroup === g
                    ? 'bg-orange-900/40 text-orange-300 border-orange-700/40'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                }`}>{g}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-x-auto">
          <table className="text-xs min-w-max w-full">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <th className="text-left px-4 py-3 text-gray-500 font-semibold uppercase tracking-wider sticky left-0 bg-gray-900/90 z-10 min-w-48">
                  Module
                </th>
                {ROLES.map(role => (
                  <th key={role} className="px-3 py-3 text-center min-w-28">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-gray-300 font-semibold">{role}</span>
                      <div className="flex gap-1">
                        <button onClick={() => setAllForRole(role, true)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-400 hover:bg-green-900/60 transition-colors border border-green-700/30">
                          All
                        </button>
                        <button onClick={() => setAllForRole(role, false)}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 transition-colors border border-red-700/30">
                          None
                        </button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.filter(g => selGroup === 'All' || g === selGroup).map(group => {
                const groupModules = displayedModules.filter(m => m.group === group)
                if (groupModules.length === 0) return null
                return (
                  <>
                    <tr key={`grp-${group}`} className="border-b border-gray-800/40 bg-gray-900/30">
                      <td colSpan={ROLES.length + 1} className="px-4 py-1.5">
                        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">{group}</span>
                      </td>
                    </tr>
                    {groupModules.map(m => (
                      <tr key={m.key} className="border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors">
                        <td className="px-4 py-2.5 sticky left-0 bg-gray-950 z-10">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setAllForModule(m.key, !ROLES.every(r => perms[`${r}__${m.key}`]))}
                              className="text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 hover:text-gray-300 border border-gray-700 transition-colors whitespace-nowrap">
                              Toggle all
                            </button>
                            <span className="text-gray-300">{m.label}</span>
                          </div>
                        </td>
                        {ROLES.map(role => {
                          const enabled = perms[`${role}__${m.key}`] ?? false
                          return (
                            <td key={role} className="px-3 py-2.5 text-center">
                              <button onClick={() => toggle(role, m.key)}
                                className={`w-8 h-5 rounded-full transition-all relative ${
                                  enabled ? 'bg-orange-500' : 'bg-gray-700'
                                }`}>
                                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                                  enabled ? 'left-3.5' : 'left-0.5'
                                }`} />
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
