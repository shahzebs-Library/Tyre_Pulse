/**
 * ConsoleSystemConfig.jsx - the global switches in system_config.
 *
 * Every control carries its enforcement badge from ENFORCEMENT_STATUS
 * (src/lib/api/systemConfig.js), the single source of truth for "does anything
 * actually read this setting". The badge is derived, never hand-written here,
 * so it cannot claim a control is enforced when it is only stored.
 *
 * Structure: header with Review and save; five tiles; an attention list; tabs
 * per group (?tab=system|ai|security|notifications|data|fx|stored). A search
 * looks across every group. Saving opens a review of exactly what will change
 * and only the changed keys are written.
 *
 * A key that has never been saved is shown at the default the app actually
 * applies (CONFIG_DEFAULTS) and labelled "Not set", instead of at an invented
 * off/blank value the app does not use.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Settings2, Save, AlertTriangle, CheckCircle, CheckCircle2, Shield, Zap, Bell, Database,
  RotateCcw, Coins, ListChecks, Search, History, Users,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { toUserMessage } from '../../lib/safeError'
import {
  ErrorState, Modal, Btn, Badge, StatTile, Note, Panel, PanelHeader, SearchInput, Select, Segmented,
  Toolbar, EmptyState, LoadingState, Code, Table, THead, Th, Tr, Td, ImpactBox,
} from '../components/ui'
import { useConsoleAuth } from '../ConsoleAuthContext'
import { ENFORCEMENT_STATUS, CONFIG_DEFAULTS } from '../../lib/api/systemConfig'
import FxRatesPanel from './config/FxRatesPanel'
import { PageHeader, useUrlTab, usePaged, Pager, AttentionList, ConsoleLink, TabPanel, Drawer, fmtRelative, fmtDateTime } from './shared/pageKit'
import ExportButtons from './shared/ExportButtons'
import { CONTROL_META, riskFor, rangeError, rangeHint, summarizeHistory, maskEmails } from './config/configMeta'
import { listConfigHistory, setConfigWithReason, namesFor } from '../../lib/api/consolePlatform'
import { sortRows, useTableSort } from '../../lib/consoleTable'

const CONFIG_GROUPS = [
  {
    key: 'system',
    label: 'System',
    icon: Settings2,
    configs: [
      { key: 'maintenance_mode',      type: 'bool',   label: 'Maintenance mode',         desc: 'When ON, regular users see the maintenance screen. Super-admins can still access the console.' },
      { key: 'registration_open',     type: 'bool',   label: 'Open registration',        desc: 'Allow new users to self-register from the web app and the Flutter app.' },
      { key: 'require_approval',      type: 'bool',   label: 'Require user approval',    desc: 'New users must be approved by an admin before they can log in.' },
      { key: 'app_version',           type: 'string', label: 'Current app version',      desc: 'Displayed in the app footer and used for update prompts.' },
      { key: 'max_upload_rows',       type: 'number', label: 'Max upload rows',          desc: 'Maximum number of rows allowed per Excel upload.' },
    ],
  },
  {
    key: 'ai',
    label: 'AI',
    icon: Zap,
    configs: [
      { key: 'ai_enabled',            type: 'bool',   label: 'AI features enabled',      desc: 'Master toggle for all AI-powered features across the platform.' },
      { key: 'ai_model',              type: 'string', label: 'Default AI model',         desc: 'The LLM model used for analysis. E.g. claude-3-5-sonnet-20241022' },
      { key: 'ai_monthly_budget_usd', type: 'number', label: 'Monthly AI budget (USD)',  desc: 'Alert when cumulative AI spend exceeds this amount.' },
      { key: 'ai_rate_limit_per_min', type: 'number', label: 'AI rate limit (requests a minute)',  desc: 'Maximum AI requests per minute per organisation.' },
      { key: 'ai_cache_ttl_hours',    type: 'number', label: 'AI answer cache (hours)',        desc: 'How long AI responses are cached before a fresh call is made.' },
    ],
  },
  {
    key: 'security',
    label: 'Security',
    icon: Shield,
    configs: [
      { key: 'session_timeout_hours', type: 'number', label: 'Session timeout (hours)',  desc: 'Automatically sign out inactive users after this many hours.' },
      { key: 'max_login_attempts',    type: 'number', label: 'Max login attempts',       desc: 'Lock account after this many failed login attempts.' },
      { key: 'password_min_length',   type: 'number', label: 'Minimum password length', desc: 'Enforce a minimum password length for all users.' },
      { key: 'two_factor_required',   type: 'bool',   label: 'Require 2FA for Admins',     desc: 'Require two-factor authentication for Admin role users.' },
      { key: 'audit_retention_days',  type: 'number', label: 'Audit log retention (days)',   desc: 'How long to keep audit log entries. 0 = keep forever.' },
    ],
  },
  {
    key: 'notifications',
    label: 'Notifications',
    icon: Bell,
    configs: [
      { key: 'email_notifications',   type: 'bool',   label: 'Email notifications',      desc: 'Enable transactional emails (approvals, alerts, resets).' },
      { key: 'alert_email',           type: 'string', label: 'System alert email',       desc: 'Where to send system alerts and error notifications.' },
      { key: 'digest_frequency',      type: 'string', label: 'Digest frequency',         desc: 'How often to send fleet digest emails. Options: daily, weekly, monthly.' },
      { key: 'push_notifications',    type: 'bool',   label: 'Push notifications',       desc: 'Enable push notifications to Flutter app users.' },
    ],
  },
  {
    key: 'data',
    label: 'Data',
    icon: Database,
    configs: [
      { key: 'data_retention_months', type: 'number', label: 'Data retention (months)', desc: 'Archive records older than this many months. 0 = keep forever.' },
      { key: 'backup_enabled',        type: 'bool',   label: 'Automated backups',       desc: 'Enable daily automated database backups.' },
      { key: 'export_enabled',        type: 'bool',   label: 'CSV and Excel export',        desc: 'Allow users to export data to CSV and Excel.' },
      { key: 'max_export_rows',       type: 'number', label: 'Max export rows',         desc: 'Maximum rows per export operation.' },
    ],
  },
]

const ALL_CONFIGS = CONFIG_GROUPS.flatMap((g) => g.configs.map((c) => ({ ...c, group: g.key, groupLabel: g.label })))
const PAGE_KEYS = new Set(ALL_CONFIGS.map((c) => c.key))
const TABS = [...CONFIG_GROUPS.map((g) => g.key), 'fx', 'stored']
const FILTER_OPTS = [
  { value: 'all', label: 'Every control' },
  { value: 'active', label: 'Enforced only' },
  { value: 'saved', label: 'Saved only (not enforced)' },
  { value: 'unset', label: 'Never set' },
  { value: 'changed', label: 'Unsaved changes' },
]

// Keys another console page owns, so the stored-keys list can say where to go.
const OWNER_PAGE = {
  report_palette: ['/console/appearance', 'Report Appearance'],
  company_logo: ['/console/appearance', 'Report Appearance'],
  report_diagram_bg: ['/console/appearance', 'Report Appearance'],
  nav_layout: ['/console/navigation', 'Navigation'],
  mobile_min_version: [null, 'Retired app (read-only)'],
  mobile_latest_version: [null, 'Retired app (read-only)'],
  flutter_min_version: ['/console/mobile-app?tab=gate', 'Mobile App (Flutter gate)'],
  flutter_latest_version: ['/console/mobile-app?tab=releases', 'Mobile App (Flutter release)'],
}

function enforcementOf(key) {
  const enf = ENFORCEMENT_STATUS[key]
  return { active: enf?.status === 'active', where: enf?.where || null, known: !!enf }
}

function defaultText(key, type) {
  if (!(key in CONFIG_DEFAULTS)) return 'no default (blank)'
  const d = CONFIG_DEFAULTS[key]
  if (type === 'bool') return d ? 'On' : 'Off'
  return String(d)
}

function displayValue(raw, type) {
  if (raw === undefined || raw === null) return 'Not set'
  if (type === 'bool') return raw === 'true' || raw === true ? 'On' : 'Off'
  return String(raw) === '' ? '(blank)' : String(raw)
}

function validate(cfg, raw) {
  if (cfg.type !== 'number' || raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return 'Must be a number.'
  if (n < 0) return 'Cannot be negative.'
  return rangeError(cfg.key, raw)
}

export default function ConsoleSystemConfig({ tabParam = 'tab' } = {}) {
  const { logAction } = useConsoleAuth()
  const [configs, setConfigs] = useState({})   // key -> value (string)
  const [original, setOriginal] = useState({}) // as read from the database
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [readAt, setReadAt] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [tab, setTab] = useUrlTab(TABS, 'system', tabParam)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [history, setHistory] = useState({ state: 'loading', rows: [], names: {} })
  const [histKey, setHistKey] = useState(null)
  const [stamps, setStamps] = useState({})
  const [stampNames, setStampNames] = useState({})

  // Recorded change history (system_config_history, super admin read). Loaded
  // on its own so a failed read only hides "last changed", never the settings.
  const loadHistory = useCallback(async () => {
    try {
      const rows = await listConfigHistory({ limit: 500 })
      const names = await namesFor(rows.map((r) => r.changed_by)).catch(() => ({}))
      setHistory({ state: 'ok', rows: rows || [], names })
    } catch {
      setHistory({ state: 'error', rows: [], names: {} })
    }
  }, [])
  useEffect(() => { loadHistory() }, [loadHistory])
  const histSummary = useMemo(() => summarizeHistory(history.rows), [history.rows])

  const load = useCallback(async () => {
    setLoading(true); setSaved(false); setLoadError(''); setSaveError('')
    try {
      const { data, error } = await supabase.from('system_config').select('key, value, updated_at, updated_by')
      // Critical here: an unread error would render every switch at its default,
      // which looks exactly like a deliberate configuration and invites someone
      // to "fix" settings that were never actually read.
      if (error) throw error
      const map = {}
      ;(data ?? []).forEach((row) => { map[row.key] = row.value })
      setConfigs(map)
      setOriginal(map)
      const st = {}
      ;(data ?? []).forEach((row) => { st[row.key] = { updated_at: row.updated_at || null, updated_by: row.updated_by || null } })
      setStamps(st)
      namesFor(Object.values(st).map((x) => x.updated_by)).then(setStampNames).catch(() => setStampNames({}))
      setReadAt(Date.now())
    } catch (e) {
      setLoadError(toUserMessage(e, 'Could not load the configuration.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const isSet = (key) => original[key] !== undefined && original[key] !== null
  function getVal(key, type) {
    const raw = configs[key]
    if (raw === undefined || raw === null) {
      // Show what the app actually uses for a never-saved key.
      const d = CONFIG_DEFAULTS[key]
      if (type === 'bool') return d === true
      if (type === 'number') return d === undefined ? '' : String(d)
      return d === undefined ? '' : String(d)
    }
    if (type === 'bool') return raw === 'true' || raw === true
    return raw
  }

  function setVal(key, type, val) {
    let stored = val
    if (type === 'bool') stored = val ? 'true' : 'false'
    setConfigs((prev) => ({ ...prev, [key]: stored }))
    setSaved(false)
  }
  function revertKey(key) {
    setConfigs((prev) => {
      const next = { ...prev }
      if (original[key] === undefined) delete next[key]
      else next[key] = original[key]
      return next
    })
  }

  const changes = useMemo(() => Object.keys(configs)
    .filter((k) => String(configs[k] ?? '') !== String(original[k] ?? '') || (original[k] === undefined && configs[k] !== undefined))
    .map((k) => {
      const cfg = ALL_CONFIGS.find((c) => c.key === k) || { key: k, type: 'string', label: k }
      return { key: k, cfg, from: original[k], to: configs[k], error: validate(cfg, configs[k]), risk: riskFor(k, original[k], configs[k]) }
    }), [configs, original])
  const dirty = changes.length > 0
  const changedKeys = useMemo(() => new Set(changes.map((c) => c.key)), [changes])
  const invalid = changes.filter((c) => c.error)
  const risky = changes.filter((c) => c.risk)
  const typedWord = risky.map((c) => c.risk.word).find(Boolean) || null
  const reasonNeeded = risky.length > 0
  const reasonOk = !reasonNeeded || reason.trim().length >= 3
  const typedOk = !typedWord || typed.trim() === typedWord

  // Turning maintenance mode ON locks every regular user out, so it asks first.
  const maintenanceOn = configs.maintenance_mode === 'true'
  const turningMaintenanceOn = maintenanceOn && original.maintenance_mode !== 'true'

  async function handleSave() {
    setSaving(true); setSaveError('')
    try {
      const now = new Date().toISOString()
      const rows = changes.map((c) => ({ key: c.key, value: String(c.to ?? ''), updated_at: now }))
      const why = reason.trim()
      if (why.length >= 3) {
        // With a reason every key goes through admin_set_config, so the
        // reason lands in the change history beside the old and new value.
        for (const r of rows) await setConfigWithReason(r.key, r.value, why)
      } else {
        const { error } = await supabase
          .from('system_config')
          .upsert(rows, { onConflict: 'key', ignoreDuplicates: false })
        // A failed save used to be silent: the button simply stopped spinning.
        if (error) throw error
      }
      try { await logAction('update_config', null, 'system', { keys: rows.map((r) => r.key), reason: why || null, risky: risky.map((c) => c.key) }) } catch { /* audit is best effort */ }
      loadHistory()
      setOriginal((o) => ({ ...o, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) }))
      setSaved(true); setReviewOpen(false)
    } catch (e) {
      setSaveError(toUserMessage(e, 'Could not save the configuration. Nothing was changed.'))
    } finally {
      setSaving(false)
    }
  }

  const stats = useMemo(() => {
    let active = 0; let savedOnly = 0; let unset = 0
    for (const c of ALL_CONFIGS) {
      if (enforcementOf(c.key).active) active += 1; else savedOnly += 1
      if (!isSet(c.key)) unset += 1
    }
    return { active, savedOnly, unset }
    // isSet reads `original`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original])

  const q = search.trim().toLowerCase()
  const matchFilter = useCallback((c) => {
    if (filter === 'active') return enforcementOf(c.key).active
    if (filter === 'saved') return !enforcementOf(c.key).active
    if (filter === 'unset') return original[c.key] === undefined || original[c.key] === null
    if (filter === 'changed') return changedKeys.has(c.key)
    return true
  }, [filter, original, changedKeys])
  const matchSearch = (c) => !q || [c.label, c.key, c.desc, c.groupLabel].some((t) => String(t).toLowerCase().includes(q))
  const crossGroup = !!q || filter !== 'all'
  const visibleConfigs = ALL_CONFIGS.filter((c) => (crossGroup || c.group === tab) && matchFilter(c) && matchSearch(c))

  // Keys stored in system_config that this page does not edit.
  const storedOther = useMemo(() => Object.keys(original).filter((k) => !PAGE_KEYS.has(k))
    .map((k) => ({ key: k, value: original[k], enf: enforcementOf(k) })), [original])
  const { sort: storedSort, onSort: onStoredSort } = useTableSort({ key: 'key', dir: 'asc' })
  const storedSorted = useMemo(() => sortRows(storedOther, storedSort), [storedOther, storedSort])
  const storedPaged = usePaged(storedSorted, 20, `${storedSort?.key}|${storedSort?.dir}`)

  const attention = []
  if (!loadError && readAt) {
    if (original.maintenance_mode === 'true') {
      attention.push({ key: 'maint', tone: 'danger', text: 'Maintenance mode is saved ON: regular users are locked out of the app right now.', actionLabel: 'Turn it off', onAction: () => { setVal('maintenance_mode', 'bool', false); setTab('system') } })
    }
    const misleading = ALL_CONFIGS.filter((c) => !enforcementOf(c.key).active && isSet(c.key)
      && String(original[c.key]) !== String(CONFIG_DEFAULTS[c.key] ?? ''))
    if (misleading.length) {
      attention.push({ key: 'saved', tone: 'warning', text: `${misleading.length} saved-only ${misleading.length === 1 ? 'setting has' : 'settings have'} a value that nothing in the platform reads: ${misleading.map((c) => c.label).join(', ')}.`, actionLabel: 'Show them', onAction: () => { setFilter('saved'); setSearch('') } })
    }
    if (stats.unset) {
      attention.push({ key: 'unset', tone: 'info', text: `${stats.unset} ${stats.unset === 1 ? 'control has' : 'controls have'} never been saved and run on the built-in default.`, actionLabel: 'Show them', onAction: () => { setFilter('unset'); setSearch('') } })
    }
    if (original.two_factor_required !== 'true') {
      attention.push({ key: '2fa', tone: 'info', text: 'Two-factor authentication is not required for Admin users.', actionLabel: 'Open Security', onAction: () => { setFilter('all'); setSearch(''); setTab('security') } })
    }
  }

  const openReview = () => { setSaveError(''); setReason(''); setTyped(''); setReviewOpen(true) }

  const exportRows = ALL_CONFIGS.map((c) => {
    const last = histSummary.latest[c.key]
    const enf = enforcementOf(c.key)
    return {
      group: c.groupLabel, setting: c.label, key: c.key,
      value: isSet(c.key) ? displayValue(original[c.key], c.type) : `Not set (default ${defaultText(c.key, c.type)})`,
      enforced: enf.active ? 'Enforced' : 'Saved only',
      range: rangeHint(c.key) || 'N/A',
      changed: last ? fmtDateTime(last.changed_at) : stamps[c.key]?.updated_at ? fmtDateTime(stamps[c.key].updated_at) : (isSet(c.key) ? 'Not stored' : 'Never saved'),
      by: last ? (history.names[last.changed_by] || (last.changed_by ? 'Unknown person' : 'System'))
        : stamps[c.key]?.updated_by ? (stampNames[stamps[c.key].updated_by] || 'Unknown person') : 'Not recorded before 30 Sep 2026',
    }
  })
  const tile = (n) => (loadError ? 'N/A' : loading && !readAt ? '...' : n)

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        icon={Settings2}
        title="System Configuration"
        purpose="Global platform settings and feature flags. Each control says whether the platform enforces it or only stores it."
        refreshedAt={readAt}
        onRefresh={load}
        refreshing={loading}
        meta={(
          <>
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" /> Active and enforced</span>
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-gray-500" aria-hidden="true" /> Saved only (stored, not yet enforced)</span>
          </>
        )}
        actions={(<>
          <ExportButtons rows={loadError ? [] : exportRows} title="System configuration" disabled={!!loadError} columns={[
            { key: 'group', header: 'Group' }, { key: 'setting', header: 'Setting' }, { key: 'key', header: 'Key' },
            { key: 'value', header: 'Value' }, { key: 'enforced', header: 'Enforcement' }, { key: 'range', header: 'Allowed range' },
            { key: 'changed', header: 'Last changed' }, { key: 'by', header: 'Changed by' },
          ]} />
          <Btn variant={saved && !dirty ? 'good' : 'primary'} icon={saved && !dirty ? CheckCircle : Save} onClick={openReview}
            busy={saving} disabled={!dirty || saving || !!loadError}>
            {saving ? 'Saving...' : saved && !dirty ? 'Saved' : dirty ? `Review ${changes.length} change${changes.length === 1 ? '' : 's'}` : 'Save Changes'}
          </Btn>
        </>)}
      />

      <ErrorState message={loadError} onRetry={load} />
      <ErrorState message={saveError} onRetry={openReview} />

      {dirty && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-950/30 border border-orange-700/40">
          <AlertTriangle size={13} className="text-orange-400 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-orange-300 flex-1 min-w-0">You have {changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'}. Review and save to apply globally.</p>
          <Btn size="xs" icon={RotateCcw} onClick={() => setConfigs(original)}>Discard all</Btn>
          <Btn size="xs" variant="primary" onClick={openReview}>Review</Btn>
        </div>
      )}

      {maintenanceOn && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-red-950/50 border border-red-700/50">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-red-300 font-semibold min-w-0 flex-1">Maintenance Mode is ACTIVE - regular users cannot access the app</p>
          <Btn size="xs" variant="danger" onClick={() => setVal('maintenance_mode', 'bool', false)}>Disable</Btn>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={CheckCircle2} label="Enforced" value={tile(stats.active)} tone="good" sub="Read and acted on"
          onClick={() => setFilter('active')} active={filter === 'active'} />
        <StatTile label="Saved only" value={tile(stats.savedOnly)} sub="Stored, not enforced" tone="muted"
          onClick={() => setFilter('saved')} active={filter === 'saved'} />
        <StatTile label="Never set" value={tile(stats.unset)} sub="Using the default"
          onClick={() => setFilter('unset')} active={filter === 'unset'} />
        <StatTile label="Unsaved changes" value={tile(changes.length)} tone={dirty ? 'warning' : 'default'} sub={dirty ? 'Review before saving' : 'Nothing pending'}
          onClick={() => setFilter('changed')} active={filter === 'changed'} />
        <StatTile icon={AlertTriangle} label="Maintenance" value={loadError ? 'N/A' : original.maintenance_mode === 'true' ? 'On' : 'Off'}
          tone={original.maintenance_mode === 'true' ? 'danger' : 'good'} sub={original.maintenance_mode === 'true' ? 'Users locked out' : 'App open to users'} />
        <StatTile icon={History} label="Changed in 30 days"
          value={history.state === 'ok' ? histSummary.changed30 : 'N/A'}
          sub={history.state === 'ok' ? `${histSummary.authors} ${histSummary.authors === 1 ? 'person' : 'people'} recorded` : history.state === 'error' ? 'History could not be read' : 'Reading history'} />
      </div>

      {!loadError && <AttentionList items={attention} clear={loading ? 'Checking...' : 'Nothing in the configuration needs attention.'} />}

      <nav aria-label="Configuration sections" className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Configuration sections" value={crossGroup ? '' : tab} onChange={(t) => { setSearch(''); setFilter('all'); setTab(t) }} options={[
          ...CONFIG_GROUPS.map((g) => {
            const Icon = g.icon
            const pending = g.configs.filter((c) => changedKeys.has(c.key)).length
            return { key: g.key, label: <><Icon size={13} aria-hidden="true" />{g.label}</>, count: pending || null, hint: pending ? `${pending} unsaved` : undefined }
          }),
          { key: 'fx', label: <><Coins size={13} aria-hidden="true" />Exchange rates</> },
          { key: 'stored', label: <><ListChecks size={13} aria-hidden="true" />Other stored keys</>, count: loadError ? null : storedOther.length },
        ]} />
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search every setting" className="w-full sm:w-56" ariaLabel="Search settings" />
          <Select ariaLabel="Show controls" value={filter} onChange={setFilter} options={FILTER_OPTS} className="w-44" />
        </Toolbar>
      </nav>

      {loading && !readAt ? (
        <Panel><LoadingState label="Loading configuration" rows={5} /></Panel>
      ) : loadError ? (
        <p className="text-xs text-gray-400 px-1">
          The settings are hidden until they can be read, so no switch is shown at a default it may not have.
        </p>
      ) : !crossGroup && tab === 'fx' ? (
        <TabPanel label="Exchange rates">
          {/* Exchange rates: the gate on any combined-country figure. */}
          <FxRatesPanel />
        </TabPanel>
      ) : !crossGroup && tab === 'stored' ? (
        <TabPanel label="Other stored keys">
          <Panel>
            <PanelHeader icon={ListChecks} title="Other stored keys"
              subtitle="Keys in system_config that this page does not edit. They are managed on their own pages or by the platform itself." />
            {storedOther.length === 0 ? (
              <EmptyState title="No other keys" reason="Every stored key is one of the controls on this page." />
            ) : (
              <>
                <Table>
                  <THead>
                    <Th sortKey="key" sort={storedSort} onSort={onStoredSort}>Key</Th>
                    <Th>Value</Th>
                    <Th>Enforcement</Th>
                    <Th>Managed in</Th>
                    <Th>Last written</Th>
                  </THead>
                  <tbody>
                    {storedPaged.rows.map((r) => {
                      const v = String(r.value ?? '')
                      const owner = OWNER_PAGE[r.key]
                      return (
                        <Tr key={r.key}>
                          <Td nowrap><Code>{r.key}</Code></Td>
                          <Td><span className="text-gray-400 break-all" title={v.length > 80 ? `${v.length} characters` : undefined}>{v.length > 80 ? `${v.slice(0, 80)}... (${v.length} characters)` : v || '(blank)'}</span></Td>
                          <Td>{r.enf.known ? <Badge tone={r.enf.active ? 'good' : 'quiet'} title={r.enf.where || undefined}>{r.enf.active ? 'Active and enforced' : 'Saved only'}</Badge> : <span className="text-gray-500">Not tracked</span>}</Td>
                          <Td>{owner ? (owner[0] ? <ConsoleLink plain to={owner[0]}>{owner[1]}</ConsoleLink> : <Badge tone="quiet" title="The Expo app is retired. This key is kept read-only for old installs.">{owner[1]}</Badge>) : <span className="text-gray-500">Platform</span>}</Td>
                          <Td nowrap className="text-gray-400">{stamps[r.key]?.updated_at ? fmtRelative(stamps[r.key].updated_at) : 'Not stored'}</Td>
                        </Tr>
                      )
                    })}
                  </tbody>
                </Table>
                <Pager paged={storedPaged} label="keys" />
              </>
            )}
          </Panel>
        </TabPanel>
      ) : (
        <TabPanel label={crossGroup ? 'Search results' : (CONFIG_GROUPS.find((g) => g.key === tab)?.label || 'Settings')}>
          {crossGroup && (
            <Note icon={Search}>
              Showing matches from every group. <button type="button" onClick={() => { setSearch(''); setFilter('all') }} className="underline text-orange-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">Back to the {CONFIG_GROUPS.find((g) => g.key === tab)?.label || 'group'} tab</button>
            </Note>
          )}
          {visibleConfigs.length === 0 ? (
            <Panel><EmptyState title="No setting matches" reason="Change the search or the filter to see more controls."
              action={<Btn onClick={() => { setSearch(''); setFilter('all') }}>Clear</Btn>} /></Panel>
          ) : (
            <Panel flush>
              <div className="divide-y divide-gray-800/60">
                {visibleConfigs.map((cfg) => (
                  <ConfigRow key={cfg.key} cfg={cfg} showGroup={crossGroup}
                    value={getVal(cfg.key, cfg.type)} set={isSet(cfg.key)} changed={changedKeys.has(cfg.key)}
                    original={original[cfg.key]} error={changedKeys.has(cfg.key) ? validate(cfg, configs[cfg.key]) : null}
                    onChange={(v) => setVal(cfg.key, cfg.type, v)} onRevert={() => revertKey(cfg.key)}
                    last={histSummary.latest[cfg.key]} historyState={history.state} names={history.names}
                    stamp={stamps[cfg.key]} stampNames={stampNames}
                    onHistory={() => setHistKey(cfg.key)} />
                ))}
              </div>
            </Panel>
          )}
        </TabPanel>
      )}

      <Modal open={reviewOpen} onClose={() => { if (!saving) setReviewOpen(false) }} width="max-w-xl"
        title={turningMaintenanceOn ? 'Turn on maintenance mode?' : 'Review changes'}
        subtitle={turningMaintenanceOn ? 'Regular users are locked out until it is turned off again.' : `${changes.length} ${changes.length === 1 ? 'setting' : 'settings'} will change for the whole platform.`}
        footer={(
          <>
            <Btn onClick={() => setReviewOpen(false)} disabled={saving}>Cancel</Btn>
            <Btn variant={turningMaintenanceOn || risky.some((c) => c.risk.tone === 'danger') ? 'danger' : 'primary'} icon={Save} onClick={handleSave} busy={saving}
              disabled={invalid.length > 0 || !dirty || !reasonOk || !typedOk}>
              {turningMaintenanceOn ? 'Save and lock users out' : 'Save changes'}
            </Btn>
          </>
        )}>
        <div className="space-y-3">
          {turningMaintenanceOn && (
            <p className="text-sm text-gray-300">
              Every signed-in user who is not a super admin or Admin will see the maintenance screen as soon as
              this is saved. The console stays available to you.
            </p>
          )}
          {invalid.length > 0 && (
            <Note icon={AlertTriangle} tone="danger">
              Fix {invalid.length === 1 ? 'this value' : 'these values'} before saving: {invalid.map((c) => `${c.cfg.label} (${c.error})`).join('; ')}
            </Note>
          )}
          <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
            {changes.map((c) => {
              const enf = enforcementOf(c.key)
              return (
                <li key={c.key} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-200 flex-1 min-w-[10rem]">{c.cfg.label}</span>
                  <span className="text-gray-500 line-through break-all">{displayValue(c.from, c.cfg.type)}</span>
                  <span className="text-gray-500" aria-hidden="true">to</span>
                  <span className="text-orange-300 font-semibold break-all">{displayValue(c.to, c.cfg.type)}</span>
                  <Badge tone={enf.active ? 'good' : 'quiet'}>{enf.active ? 'Takes effect' : 'Stored only'}</Badge>
                  {c.risk && <Badge tone={c.risk.tone}>Risky</Badge>}
                </li>
              )
            })}
          </ul>
          {risky.map((c) => (
            <ImpactBox key={`impact-${c.key}`} tone={c.risk.tone}
              what={`${c.cfg.label}: ${displayValue(c.from, c.cfg.type)} to ${displayValue(c.to, c.cfg.type)}.`}
              change={c.risk.why}
              who={CONTROL_META[c.key]?.who || 'Every organisation on the platform.'}
              undo={`Yes. Set it back to ${displayValue(c.from, c.cfg.type)}; the old value is kept in the change history.`} />
          ))}
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">
              Reason {reasonNeeded ? '(required for a risky change)' : '(optional, recorded in the change history)'}
            </span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" maxLength={500}
              aria-label="Reason for this change"
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
              placeholder="Why are you changing this?" />
          </label>
          {typedWord && (
            <label className="block">
              <span className="block text-[11px] font-semibold text-gray-400 mb-1">Type <span className="font-mono text-gray-200">{typedWord}</span> to confirm</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
                aria-label={`Type ${typedWord} to confirm`}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs font-mono text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" />
            </label>
          )}
        </div>
      </Modal>

      <HistoryDrawer histKey={histKey} onClose={() => setHistKey(null)} history={history}
        cfg={ALL_CONFIGS.find((c) => c.key === histKey)}
        onUse={(value) => {
          const cfg = ALL_CONFIGS.find((c) => c.key === histKey)
          if (cfg) setConfigs((prev) => ({ ...prev, [cfg.key]: value ?? '' }))
          setHistKey(null)
        }} />
    </div>
  )
}

function HistoryDrawer({ histKey, cfg, history, onClose, onUse }) {
  const rows = histKey ? history.rows.filter((r) => r.key === histKey) : []
  return (
    <Drawer open={!!histKey} onClose={onClose} title={cfg ? `History: ${cfg.label}` : 'History'}
      subtitle="Recorded from 30 Sep 2026. Use a value to stage it for review; nothing is saved until you save.">
      {history.state === 'error' ? (
        <EmptyState icon={History} title="History could not be read" reason="Only a super admin can read the change history, or the read failed." />
      ) : history.state === 'loading' ? <LoadingState label="Reading history" rows={3} /> : rows.length === 0 ? (
        <EmptyState icon={History} title="No recorded change" reason="This setting has not changed since history recording started on 30 Sep 2026." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-gray-200 font-medium">{fmtDateTime(r.changed_at)}</span>
                <Badge tone="quiet">{r.action}</Badge>
                <span className="text-gray-500 inline-flex items-center gap-1"><Users size={11} aria-hidden="true" />{history.names[r.changed_by] || (r.changed_by ? 'Unknown person' : 'System or scheduled job')}</span>
              </div>
              <p className="mt-1 text-gray-400 break-all">
                <span className="line-through text-gray-500">{displayValue(r.old_value, cfg?.type)}</span> to <span className="text-orange-300">{displayValue(r.new_value, cfg?.type)}</span>
              </p>
              <p className="mt-0.5 text-gray-500">{r.reason ? `Reason: ${maskEmails(r.reason)}` : 'No reason recorded'}</p>
              {r.old_value != null && (
                <div className="mt-1.5"><Btn size="xs" icon={RotateCcw} onClick={() => onUse(r.old_value)}>Use the earlier value</Btn></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}

function ConfigRow({ cfg, value, set, changed, original, error, showGroup, onChange, onRevert, last, historyState, names = {}, onHistory, stamp, stampNames = {} }) {
  // The row's own updated_at is the real last write when history has no entry
  // (history starts 30 Sep 2026; updated_by was not stamped before that).
  const stampText = stamp?.updated_at
    ? `Last written ${fmtRelative(stamp.updated_at)}${stamp.updated_by ? ` by ${stampNames[stamp.updated_by] || 'unknown person'}` : ' (person not recorded before 30 Sep 2026)'}`
    : null
  const meta = CONTROL_META[cfg.key]
  const hint = rangeHint(cfg.key)
  const enf = enforcementOf(cfg.key)
  const labelId = `cfg-${cfg.key}`
  const inputCls = `w-full h-8 bg-gray-800/80 border rounded-lg px-3 text-xs text-gray-100 focus:outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500 ${error ? 'border-red-600' : 'border-gray-700'}`
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 ${changed ? 'bg-orange-950/15' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p id={labelId} className="text-xs font-semibold text-gray-200">{cfg.label}</p>
          {showGroup && <Badge tone="quiet">{cfg.groupLabel}</Badge>}
          <span
            title={enf.where || (enf.active ? 'Enforced' : 'Saved but not yet enforced')}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
              enf.active
                ? 'text-emerald-300 border-emerald-700/40 bg-emerald-900/20'
                : 'text-gray-400 border-gray-700/50 bg-gray-800/40'
            }`}>
            <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${enf.active ? 'bg-emerald-400' : 'bg-gray-500'}`} />
            {enf.active ? 'Active and enforced' : 'Saved only'}
          </span>
          {!set && !changed && <Badge tone="info" title="Never saved: the platform uses its built-in default">Not set, default {defaultText(cfg.key, cfg.type)}</Badge>}
          {changed && <Badge tone="warning">Changed from {displayValue(original, cfg.type)}</Badge>}
        </div>
        <p className="text-[11px] text-gray-500 mt-0.5">{cfg.desc}</p>
        {meta?.who && <p className="text-[11px] text-gray-400 mt-0.5">Who is affected: {meta.who}</p>}
        <p className="text-[10px] text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
          {hint && <span>Allowed: {hint}</span>}
          <span>
            {historyState === 'ok' && last
              ? `Last changed ${fmtRelative(last.changed_at)} by ${names[last.changed_by] || (last.changed_by ? 'unknown person' : 'system')}`
              : stampText || (set ? 'Last write time not stored for this key' : 'Never saved')}
          </span>
          {onHistory && historyState === 'ok' && (
            <button type="button" onClick={onHistory} aria-label={`History of ${cfg.label}`}
              className="underline text-orange-300 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500">History</button>
          )}
        </p>
        {enf.where && (
          <p className="text-[10px] text-gray-500 mt-0.5 break-words">Checked at: {enf.where}</p>
        )}
        {error && <p role="alert" className="text-[11px] text-red-300 mt-1">{error}</p>}
      </div>
      <div className="flex-shrink-0 w-full sm:w-56 flex items-center gap-2">
        {cfg.type === 'bool' ? (
          <button
            type="button" role="switch" aria-checked={value} aria-labelledby={labelId}
            onClick={() => onChange(!value)}
            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 w-12 h-6 rounded-full relative transition-all shrink-0 ${
              value ? 'bg-orange-500' : 'bg-gray-700'
            }`}>
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${value ? 'left-7' : 'left-1'}`} />
          </button>
        ) : (
          <input
            type={cfg.type === 'number' ? 'number' : 'text'}
            min={cfg.type === 'number' ? 0 : undefined}
            max={cfg.type === 'number' && meta?.max != null ? meta.max : undefined}
            aria-labelledby={labelId}
            aria-invalid={error ? true : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls}
          />
        )}
        {changed && (
          <button type="button" onClick={onRevert} title="Undo this change" aria-label={`Undo change to ${cfg.label}`}
            className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 shrink-0">
            <RotateCcw size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
