/**
 * System Settings > All settings: every platform-wide setting in one list with
 * its value, when it last changed and who changed it (recorded from 30 Sep 2026
 * by the system_config history trigger). Every save goes through
 * admin_set_config, which needs a reason and keeps the old and new value so a
 * change can be restored. Secrets are never shown: connected services only say
 * Set or Not set.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Settings, History, Clock, UserCheck, ShieldAlert, KeyRound, Archive, Download, Pencil, ArrowUpRight, RotateCcw, Info,
} from 'lucide-react'
import {
  Btn, Panel, PanelHeader, Note, StatTile, SearchInput, LoadingState, ErrorState, EmptyState, ConfirmImpactDialog, Select,
} from '../../../components/ui'
import { Drawer } from '../../shared/pageKit'
import {
  SETTING_GROUPS, uncataloguedKeys, displaySettingValue, settingsKpis, fmtRiyadh,
} from '../../../../lib/consolePlatform'
import {
  listConfigRows, listConfigHistory, listConsoleConfigSaves, setConfigWithReason, namesFor, countVehicleDesigns, getSentryStatusSafe,
} from '../../../../lib/api/consolePlatform'
import { ENFORCEMENT_STATUS, CONFIG_DEFAULTS, parseConfigValue } from '../../../../lib/api/systemConfig'
import { defaultsDiff, defaultLabel } from '../../../../lib/consoleDataGaps'
import { exportConsoleRows } from '../../../../lib/consoleTable'
import { toUserMessage } from '../../../../lib/safeError'
import { Pill, DecisionTag, MovedHere, fmtNum } from '../PlatformKit'

const DAY = 86400000
const unq = (v) => (v == null ? '' : String(v).replace(/^"(.*)"$/, '$1'))
const isOn = (v) => unq(v) === 'true'

function valueLabel(item, raw) {
  if (item.type === 'toggle') return raw == null ? 'Not set' : isOn(raw) ? 'On' : 'Off'
  const v = displaySettingValue(item, raw)
  if (v == null) return 'Not set'
  return item.unit ? `${v} ${item.unit}` : v
}

/** Typed word needed when the change stops work for many people. */
function dangerWord(item, next) {
  if (item.key === 'maintenance_mode' && isOn(next)) return 'MAINTENANCE'
  if (item.key === 'export_enabled' && !isOn(next)) return 'EXPORTS OFF'
  return null
}

function impactFor(item, cur, next) {
  const from = valueLabel(item, cur); const to = valueLabel(item, next)
  const base = { what: `${item.label} is ${from}.`, change: `It becomes ${to}. ${item.help}.`, undo: `Yes. Set it back to ${from}; the old value is kept in the history.` }
  if (item.key === 'maintenance_mode' && isOn(next)) return { ...base, tone: 'danger', who: 'Every non-admin account on web and phone is blocked at once.' }
  if (item.key === 'export_enabled' && !isOn(next)) return { ...base, tone: 'danger', who: 'Every Excel and PDF download stops working for everyone.' }
  if (item.key === 'registration_open' && !isOn(next)) return { ...base, tone: 'warning', who: 'New people can no longer sign up. Existing accounts are not affected.' }
  if ((item.key === 'auth_google_enabled' || item.key === 'auth_microsoft_enabled') && isOn(next)) return { ...base, tone: 'warning', who: 'Everyone on the web sign-in and console sign-in pages sees the button. It fails until the provider is set up in Supabase Auth.' }
  if (item.key === 'qr_login_enabled' && isOn(next)) return { ...base, tone: 'warning', who: 'Everyone on the web sign-in page sees the QR code. It only works for phones running a Flutter build with Scan to sign in.' }
  if (item.key === 'session_timeout_hours') return { ...base, tone: 'warning', who: 'Web app users only. Phones and the console (10-minute idle) are not changed.' }
  return { ...base, who: 'Every organization on the platform.' }
}

const INTEGRATIONS = [
  { key: 'sentry', label: 'Sentry (crash reports)', name: 'sentry_auth_token', where: 'Replace on Error Center', to: '/console/crash-reports' },
  { key: 'resend', label: 'Email sender (Resend)', name: 'RESEND_API_KEY', where: 'Server secret; set in the database project settings' },
  { key: 'firebase', label: 'Firebase (phone push)', name: 'FIREBASE_SERVICE_ACCOUNT', where: 'Server secret; set in the database project settings' },
  { key: 'stripe', label: 'Stripe (billing)', name: 'STRIPE_SECRET_KEY', where: 'Server secret; billing is not live', to: '/console/billing' },
  { key: 'posthog', label: 'PostHog (usage analytics)', name: 'VITE_POSTHOG_KEY', where: 'Web build setting in the hosting dashboard', env: 'VITE_POSTHOG_KEY' },
  { key: 'vercel', label: 'Vercel (deploy list)', name: 'VERCEL_TOKEN', where: 'Not connected; deploys are read on Developer' },
  { key: 'turnstile', label: 'Turnstile (sign-in check)', name: 'VITE_TURNSTILE_SITE_KEY', where: 'Web build setting. Keep off until phones send a token', env: 'VITE_TURNSTILE_SITE_KEY' },
]

function envSet(name) {
  try { return !!(import.meta.env && import.meta.env[name]) } catch { return false }
}

export default function SettingsAll({ onTab }) {
  const [state, setState] = useState({ loading: true })
  const [search, setSearch] = useState('')
  const [facet, setFacet] = useState('all')
  const [edit, setEdit] = useState(null) // { item, next }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [histKey, setHistKey] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const settle = async (p) => { try { return { ok: true, data: await p } } catch (e) { return { ok: false, error: toUserMessage(e, 'Could not load this part.') } } }
    const [rows, hist, saves, designs, sentry] = await Promise.all([
      settle(listConfigRows()), settle(listConfigHistory({ limit: 500 })), settle(listConsoleConfigSaves({ limit: 50 })),
      settle(countVehicleDesigns()), settle(getSentryStatusSafe()),
    ])
    const ids = [...(rows.ok ? rows.data : []).map((r) => r.updated_by), ...(hist.ok ? hist.data : []).map((h) => h.changed_by)]
    const names = await namesFor(ids)
    setState({
      loading: false, rows: rows.ok ? rows.data || [] : [], rowsError: rows.ok ? null : rows.error,
      history: hist.ok ? hist.data || [] : null, historyError: hist.ok ? null : hist.error,
      saves: saves.ok ? saves.data || [] : null, designs: designs.ok ? designs.data : null,
      sentry: sentry.ok ? sentry.data : null, names,
    })
  }, [])
  useEffect(() => { load() }, [load])

  const { loading, rows = [], rowsError, history, saves, designs, sentry, names = {} } = state
  const byKey = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r])), [rows])
  const defDiff = useMemo(() => defaultsDiff(rows, CONFIG_DEFAULTS, parseConfigValue), [rows])
  const changedDefault = useMemo(() => new Set(defDiff?.changedKeys || []), [defDiff])
  const now = Date.now()
  const kpis = useMemo(() => settingsKpis(rows, { now }), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const histByKey = useMemo(() => {
    const m = {}
    for (const h of history || []) (m[h.key] ||= []).push(h)
    return m
  }, [history])

  const groups = useMemo(() => {
    const other = uncataloguedKeys(rows).map((k) => ({ key: k, label: k, help: byKey[k]?.description || 'Stored setting with no description', type: 'text' }))
    return [...SETTING_GROUPS, ...(other.length ? [{ key: 'other', label: 'Other stored keys', items: other }] : [])]
  }, [rows, byKey])

  const matchFacet = (item) => {
    const r = byKey[item.key]
    switch (facet) {
      case 'review': return !!item.review
      case 'stale': return !!item.stale
      case 'changed': return !!(r?.updated_at && now - Date.parse(r.updated_at) <= 30 * DAY)
      case 'notenforced': return !!item.notEnforced || ENFORCEMENT_STATUS[item.key]?.status === 'saved'
      default: return true
    }
  }
  const q = search.trim().toLowerCase()
  const visible = groups.map((g) => ({
    ...g, items: g.items.filter((i) => matchFacet(i) && (!q || `${i.label} ${i.key} ${i.help}`.toLowerCase().includes(q))),
  })).filter((g) => g.items.length)
  const allItems = groups.flatMap((g) => g.items)
  const facetCount = (f) => allItems.filter((i) => { switch (f) {
    case 'review': return !!i.review
    case 'stale': return !!i.stale
    case 'changed': { const r = byKey[i.key]; return !!(r?.updated_at && now - Date.parse(r.updated_at) <= 30 * DAY) }
    case 'notenforced': return !!i.notEnforced || ENFORCEMENT_STATUS[i.key]?.status === 'saved'
    default: return true
  } }).length

  function openEdit(item) {
    const cur = byKey[item.key]?.value
    setErr('')
    setEdit({ item, next: item.type === 'toggle' ? (isOn(cur) ? 'false' : 'true') : unq(cur) })
  }

  async function save({ reason }) {
    const { item, next } = edit
    if (item.type === 'number' && next !== '' && !Number.isFinite(Number(next))) { setErr('Enter a number.'); return }
    setBusy(true); setErr('')
    try {
      await setConfigWithReason(item.key, next, reason)
      setEdit(null)
      setFlash(`${item.label} saved. Who, when, the old value and your reason are in the change history.`)
      load()
    } catch (e) { setErr(toUserMessage(e, 'Could not save the setting. Nothing was changed.')) }
    setBusy(false)
  }

  async function exportSettings() {
    await exportConsoleRows({
      rows: allItems, title: 'System settings', columns: [
        { key: 'label', header: 'Setting' },
        { key: 'key', header: 'Key' },
        { key: 'value', header: 'Value', value: (i) => (i.type === 'link' ? '' : valueLabel(i, byKey[i.key]?.value)) },
        { key: 'enforced', header: 'Enforced', value: (i) => (i.notEnforced || ENFORCEMENT_STATUS[i.key]?.status === 'saved' ? 'Saved only' : '') },
        { key: 'changed', header: 'Last changed (Riyadh)', value: (i) => fmtRiyadh(byKey[i.key]?.updated_at, { year: true }) },
        { key: 'by', header: 'Changed by', value: (i) => names[byKey[i.key]?.updated_by] || 'Not recorded' },
      ],
    })
  }

  if (loading && !rows.length) return <LoadingState label="Loading settings" rows={8} />
  if (rowsError) return <ErrorState message={rowsError} onRetry={load} />

  const histItem = histKey ? allItems.find((i) => i.key === histKey) || { key: histKey, label: histKey, help: '' } : null
  const histRows = histKey ? histByKey[histKey] || [] : []
  const cur = edit ? byKey[edit.item.key]?.value : null
  const word = edit ? dangerWord(edit.item, edit.next) : null
  const changed = edit ? unq(cur) !== String(edit.next) : false
  const oldSaves = (saves || []).filter((s) => Date.parse(s.created_at) < Date.parse('2026-09-30T00:00:00Z'))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Btn icon={History} onClick={() => onTab('history')}>Change history</Btn>
        <Btn icon={Download} onClick={exportSettings}>Export settings</Btn>
      </div>
      <MovedHere from={['System Config', 'Navigation', 'Report Colors', 'Vehicle Designer']}>Every feature of those pages still has a home on this screen, on its own tab.</MovedHere>
      {flash && <Note tone="accent">{flash}</Note>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={Settings} label="Settings" value={fmtNum(rows.length)} sub={`in ${SETTING_GROUPS.length} groups, plus ${INTEGRATIONS.length} connected services`} />
        <StatTile icon={Clock} label="Changed in 30 days" value={fmtNum(kpis.changed30)} sub={kpis.lastChange ? `last: ${fmtRiyadh(kpis.lastChange, { time: false })}` : 'None'} onClick={() => setFacet('changed')} active={facet === 'changed'} />
        <StatTile icon={UserCheck} label="Who changed it" value={`${kpis.authors} of ${rows.length}`} sub="have a recorded author (recording started 30 Sep)" />
        <StatTile icon={ShieldAlert} label="Needs review" value={fmtNum(facetCount('review'))} sub="maintenance, IP allowlist, dual control" onClick={() => setFacet('review')} active={facet === 'review'} />
        <StatTile icon={KeyRound} label="Secrets" value={`${INTEGRATIONS.filter((i) => i.key === 'sentry' ? sentry?.configured : i.env ? envSet(i.env) : false).length} confirmed set`} sub="values never shown" />
        <StatTile icon={Archive} label="Stale keys" value={fmtNum(facetCount('stale'))} sub="old sign-up key, version label" onClick={() => setFacet('stale')} active={facet === 'stale'} />
      </div>

      <Note icon={Info}>Change history is only partly recorded. Each setting kept the date of its last change, and the console logged {oldSaves.length} earlier saves without the key, old value or reason. From 30 Sep 2026 every save records who, when, key, old value, new value and reason, and can be restored.</Note>

      <div className="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-4">
        <aside className="space-y-3">
          <SearchInput value={search} onChange={setSearch} placeholder={`Search ${rows.length} settings`} />
          <nav aria-label="Setting filters" className="space-y-1">
            {[['all', 'All'], ['review', 'Needs review'], ['stale', 'Stale'], ['changed', 'Changed in 30 days'], ['notenforced', 'Not enforced']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFacet(k)} aria-pressed={facet === k}
                className={`w-full flex justify-between px-2.5 py-1.5 rounded-lg text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${facet === k ? 'bg-orange-950/20 text-orange-300' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'}`}>
                <span>{label}</span><span className="text-gray-500 tabular-nums">{facetCount(k)}</span>
              </button>
            ))}
          </nav>
          <div className="border-t border-gray-800 pt-2 space-y-1">
            {groups.map((g) => <a key={g.key} href={`#set-${g.key}`} className="block px-2.5 py-1 text-[11px] text-gray-500 hover:text-gray-300">{g.label} <span className="text-gray-600">{g.items.length}</span></a>)}
          </div>
          <p className="text-[11px] text-gray-500">{defDiff ? `Changed from the app default: ${fmtNum(defDiff.changed)} of ${fmtNum(defDiff.withDefault)} settings that have one. The others have no built-in default, so there is nothing to compare.` : 'Changed from default: N/A (settings could not be read).'}</p>
        </aside>

        <div className="space-y-4 min-w-0">
          {visible.length === 0 && <EmptyState title="No setting matches" reason="Try another search or filter." />}
          {visible.map((g) => (
            <Panel key={g.key}>
              <div id={`set-${g.key}`} />
              <PanelHeader title={g.label} subtitle={`${g.items.length} settings`} />
              <ul className="divide-y divide-gray-800/70">
                {g.items.map((item) => {
                  const r = byKey[item.key]
                  const saved = item.notEnforced || ENFORCEMENT_STATUS[item.key]?.status === 'saved'
                  const hcount = histByKey[item.key]?.length || 0
                  return (
                    <li key={item.key} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-200 flex flex-wrap items-center gap-1.5">
                          {item.label}
                          {item.review && <Pill tone="warning">Review</Pill>}
                          {item.stale && <Pill tone="muted">Stale</Pill>}
                          {saved && <Pill tone="info" title={ENFORCEMENT_STATUS[item.key]?.where}>Not enforced</Pill>}
                          {item.decision && <DecisionTag />}
                          {changedDefault.has(item.key) && <Pill tone="accent" title={`App default: ${defaultLabel(CONFIG_DEFAULTS[item.key])}`}>Changed from default</Pill>}
                        </p>
                        <p className="text-[11px] text-gray-500">{item.help}{item.key === '__vehicle_designs' ? `. ${designs == null ? 'N/A' : designs} designs saved` : ''}</p>
                        <p className="text-[11px] text-gray-600 font-mono">{item.key.startsWith('__') ? 'vehicle_diagram_configs' : item.key}</p>
                      </div>
                      <div className="md:w-44 text-xs text-gray-200 break-words">{item.type === 'link' ? <span className="text-gray-500">Own screen</span> : valueLabel(item, r?.value)}</div>
                      <div className="md:w-40 text-[11px] text-gray-500">
                        {r?.updated_at ? fmtRiyadh(r.updated_at, { time: false }) : 'Never'}
                        <span className="block">by: {names[r?.updated_by] || 'Not recorded'}</span>
                      </div>
                      <div className="flex gap-1.5 md:w-44 md:justify-end">
                        {item.type === 'link' ? (
                          item.to ? <Link to={item.to} className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300">Open <ArrowUpRight size={11} aria-hidden="true" /></Link>
                            : <Btn size="xs" onClick={() => onTab(item.tab)}>Open</Btn>
                        ) : item.managed ? (
                          <Link to={item.managed} className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300">Change on its screen <ArrowUpRight size={11} aria-hidden="true" /></Link>
                        ) : (
                          <Btn size="xs" icon={Pencil} onClick={() => openEdit(item)}>{item.type === 'toggle' ? (isOn(r?.value) ? 'Turn off' : 'Turn on') : 'Edit'}</Btn>
                        )}
                        {item.type !== 'link' && <Btn size="xs" variant="quiet" icon={History} onClick={() => setHistKey(item.key)} ariaLabel={`History of ${item.label}`}>{hcount || ''}</Btn>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Panel>
          ))}

          <Panel>
            <PanelHeader title="Connected services" subtitle="Write-only. Values are never shown or read back." />
            <ul className="divide-y divide-gray-800/70">
              {INTEGRATIONS.map((i) => {
                const set = i.key === 'sentry' ? (sentry ? !!sentry.configured : null) : i.env ? envSet(i.env) : null
                return (
                  <li key={i.key} className="px-4 py-3 flex flex-col md:flex-row md:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-200">{i.label}</p>
                      <p className="text-[11px] text-gray-500">{i.where}</p>
                      <p className="text-[11px] text-gray-600 font-mono">{i.name}</p>
                    </div>
                    <div className="md:w-44">{set == null ? <Pill tone="muted">Not verified from here</Pill> : set ? <Pill tone="good">Set</Pill> : <Pill tone="warning">Not set</Pill>}</div>
                    <div className="md:w-44 md:text-right">{i.to ? <Link to={i.to} className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300">{i.key === 'sentry' ? 'Replace' : 'Open'} <ArrowUpRight size={11} aria-hidden="true" /></Link> : <span className="text-[11px] text-gray-500">Changed outside the console</span>}</div>
                  </li>
                )
              })}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Danger zone" subtitle="Settings that stop work for many people. Each asks for a typed confirmation and a reason." tone="danger" />
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                ['maintenance_mode', 'Turn on maintenance mode', 'Blocks every non-admin account on web and phone at once.', 'true'],
                ['export_enabled', 'Turn off exports', 'Every Excel and PDF download button stops working for everyone.', 'false'],
                ['registration_open', 'Close registration', 'New people can no longer sign up.', 'false'],
              ].map(([key, title, body, target]) => {
                const item = allItems.find((i) => i.key === key)
                const already = unq(byKey[key]?.value) === target
                return (
                  <div key={key} className="rounded-lg border border-red-900/40 p-3 flex flex-col gap-2">
                    <p className="text-xs font-semibold text-gray-200">{title}</p>
                    <p className="text-[11px] text-gray-400">{body}</p>
                    <Btn size="xs" variant="danger" disabled={already || !item} onClick={() => { setErr(''); setEdit({ item, next: target }) }}>{already ? 'Already set' : title.split(' ').slice(0, 2).join(' ')}</Btn>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      </div>

      <ConfirmImpactDialog open={!!edit} title={edit ? `Change ${edit.item.label}?` : ''}
        impact={edit ? impactFor(edit.item, cur, edit.next) : null}
        requireReason typedWord={word || undefined} danger={!!word} readyExtra={changed}
        confirmLabel="Save change" busy={busy} error={err}
        onCancel={() => { if (!busy) setEdit(null) }} onConfirm={save}>
        {edit && edit.item.type !== 'toggle' && (
          <label className="block">
            <span className="block text-[11px] font-semibold text-gray-400 mb-1">New value{edit.item.unit ? ` (${edit.item.unit})` : ''}</span>
            {edit.item.type === 'select' ? (
              <Select value={edit.next} onChange={(v) => setEdit((e) => ({ ...e, next: v }))} ariaLabel="New value" options={(edit.item.options || []).map((o) => ({ value: o, label: o }))} />
            ) : (
              <input value={edit.next} onChange={(e) => setEdit((x) => ({ ...x, next: e.target.value }))} inputMode={edit.item.type === 'number' ? 'numeric' : undefined}
                className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" />
            )}
          </label>
        )}
        {edit && <p className="text-[11px] text-gray-500">Current: {valueLabel(edit.item, cur)}{byKey[edit.item.key]?.updated_at ? `, since ${fmtRiyadh(byKey[edit.item.key].updated_at, { year: true })}` : ''}. Saved with who, when, old value and new value, so it can be restored from the history.</p>}
      </ConfirmImpactDialog>

      <Drawer open={!!histItem} onClose={() => setHistKey(null)} title={histItem?.label || ''} subtitle={histItem ? `${histItem.key}, currently ${valueLabel(histItem, byKey[histItem.key]?.value)}` : ''}>
        {histItem && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">{histItem.help}</p>
            {state.historyError && <ErrorState message={state.historyError} onRetry={load} />}
            {histRows.length === 0 ? (
              <Note icon={Info}>No change of this setting has been recorded since history started on 30 Sep 2026. Last change before that: {byKey[histItem.key]?.updated_at ? fmtRiyadh(byKey[histItem.key].updated_at, { year: true }) : 'never'}, date only. Earlier values were not stored, so they cannot be restored.</Note>
            ) : (
              <ul className="space-y-2">
                {histRows.map((h) => (
                  <li key={h.id} className="rounded-lg border border-gray-800 p-3 text-xs">
                    <p className="text-gray-200">{fmtRiyadh(h.changed_at, { year: true })}: {valueLabel(histItem, h.old_value)} to {valueLabel(histItem, h.new_value)}</p>
                    <p className="text-gray-500">By {names[h.changed_by] || 'Not recorded'}. Reason: {h.reason || 'Not recorded'}</p>
                    {histItem.type !== 'link' && !histItem.managed && h.old_value != null && unq(h.old_value) !== unq(byKey[histItem.key]?.value) && (
                      <div className="mt-2"><Btn size="xs" icon={RotateCcw} onClick={() => { setHistKey(null); setErr(''); setEdit({ item: histItem, next: unq(h.old_value) }) }}>Restore {valueLabel(histItem, h.old_value)}</Btn></div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
