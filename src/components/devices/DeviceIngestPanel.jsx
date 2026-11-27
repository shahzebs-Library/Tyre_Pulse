/**
 * DeviceIngestPanel - the "Keys & data feed" side of Devices & Integrations.
 * Admin / super admin only (the page is RoleRoute Admin and every RPC behind
 * this panel refuses anyone else server-side).
 *
 * Tabs: keys (mint shown once / revoke / last seen / counts), unmatched
 * readings (one-click match to an asset), send test payload (dry run, writes
 * nothing), alert settings (TPMS thresholds), browser hardware (thermal
 * printer + USB scanner support check).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, Plus, Ban, Copy, Check, Loader2, AlertTriangle, Search, FlaskConical, Settings2, Inbox, Printer, ScanLine } from 'lucide-react'
import Modal from '../ui/Modal'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import {
  loadIngestState, createIngestKey, revokeIngestKey, resolveUnmatched, dismissUnmatched, saveIngestSettings,
  testPayload, curlExample, ingestEndpoint, validateKeyForm, MESSAGE_TYPES, VENDORS, SAMPLE_PAYLOADS,
} from '../../lib/api/deviceIngest'
import { getAssetMatches } from '../../lib/api/assets'
import { printerSupport } from '../../lib/webDevicePrint'

const TABS = ['ingest', 'unmatched', 'test', 'settings', 'hardware']
const STATUS_TONE = { accepted: 'text-emerald-500', duplicate: 'text-[var(--text-muted)]', quarantined: 'text-amber-500', rejected: 'text-red-500' }

function fmt(ts, never) {
  if (!ts) return never
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? never : d.toLocaleString()
}

export default function DeviceIngestPanel({ devices = [] }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState('ingest')
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try { setState(await loadIngestState()) } catch (err) { setError(toUserMessage(err, t('devices.errors.generic'))) } finally { setBusy(false) }
  }, [t])
  useEffect(() => { load() }, [load])

  if (!state && !error) {
    return <div className="card flex items-center gap-2 text-[var(--text-muted)]" role="status"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{t('devices.loading')}</div>
  }
  if (error && !state) {
    return (
      <div className="card flex items-start gap-3" role="alert">
        <AlertTriangle size={18} className="text-red-500 mt-0.5" aria-hidden="true" />
        <div className="flex-1"><p className="text-[var(--text-primary)]">{error}</p></div>
        <button type="button" className="btn-secondary min-h-[44px]" onClick={load}>{t('devices.retry')}</button>
      </div>
    )
  }
  if (state.missing) {
    return <div className="card border border-amber-500/40 flex items-start gap-3" role="status"><AlertTriangle size={18} className="text-amber-500 mt-0.5" aria-hidden="true" /><p className="text-[var(--text-primary)]">{t('devices.notSetUp')}</p></div>
  }

  const ov = state.overview || {}
  const bs = ov.by_status || {}
  const total = Object.values(bs).reduce((a, b) => a + Number(b || 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[['messages24h', total], ['accepted', bs.accepted || 0], ['rejected', bs.rejected || 0], ['quarantined', ov.unmatched_open || 0],
          ['lastMessage', fmt(ov.last_message_at, t('devices.kpi.never'))]].map(([k, val]) => (
          <div key={k} className="card"><p className="text-xs text-[var(--text-muted)]">{t(`devices.kpi.${k}`)}</p><p className="text-lg font-semibold text-[var(--text-primary)] tabular-nums break-words">{val}</p></div>
        ))}
      </div>

      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-[44px] px-3 rounded-lg text-sm border ${tab === k ? 'border-emerald-500 text-[var(--text-primary)] bg-emerald-500/10' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
            {t(`devices.tabs.${k}`)}{k === 'unmatched' && state.unmatched.length ? ` (${state.unmatched.length})` : ''}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}

      {tab === 'ingest' && <KeysTab state={state} devices={devices} onChanged={load} busy={busy} />}
      {tab === 'unmatched' && <UnmatchedTab rows={state.unmatched} onChanged={load} />}
      {tab === 'test' && <TestTab />}
      {tab === 'settings' && <SettingsTab initial={ov.settings} onSaved={load} />}
      {tab === 'hardware' && <HardwareTab />}
    </div>
  )
}

function KeysTab({ state, devices, onChanged }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [minted, setMinted] = useState(null)
  const [actionError, setActionError] = useState('')
  const revoke = async (k) => {
    if (!window.confirm(t('devices.keys.revokeConfirm'))) return
    setActionError('')
    try { await revokeIngestKey(k.id); await onChanged() } catch (err) { setActionError(toUserMessage(err, t('devices.errors.generic'))) }
  }
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"><KeyRound size={16} aria-hidden="true" />{t('devices.keys.heading')}</h3>
        <button type="button" className="btn-primary min-h-[44px] inline-flex items-center gap-1.5 text-sm" onClick={() => setOpen(true)}><Plus size={14} aria-hidden="true" />{t('devices.keys.create')}</button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{t('devices.keys.endpoint')}: <code className="font-mono break-all">{ingestEndpoint()}</code></p>
      {actionError && <p role="alert" className="text-sm text-red-500">{actionError}</p>}
      {!state.keys.length ? <p className="text-sm text-[var(--text-muted)]">{t('devices.keys.none')}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="py-2 pe-3">{t('devices.keys.name')}</th><th className="pe-3">Prefix</th><th className="pe-3">{t('devices.keys.types')}</th>
              <th className="pe-3">{t('devices.kpi.messages24h')}</th><th className="pe-3">{t('devices.keys.lastUsed')}</th><th className="pe-3" /><th />
            </tr></thead>
            <tbody>
              {state.keys.map((k) => (
                <tr key={k.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pe-3 text-[var(--text-primary)]">{k.name}<div className="text-xs text-[var(--text-muted)]">{t(`devices.vendors.${k.vendor}`)}{k.device_id ? ` - ${k.device_id}` : ''}{k.asset_no ? ` (${k.asset_no})` : ''}</div></td>
                  <td className="pe-3 font-mono text-xs">{k.key_prefix}</td>
                  <td className="pe-3 text-xs">{(k.data_types || []).map((d) => t(`devices.types.${d}`)).join(', ')}</td>
                  <td className="pe-3 tabular-nums">{k.messages_24h}{Number(k.rejected_24h) ? <span className="text-red-500"> / {k.rejected_24h}</span> : null}{Number(k.quarantined_24h) ? <span className="text-amber-500"> / {k.quarantined_24h}</span> : null}</td>
                  <td className="pe-3 text-xs">{fmt(k.last_used_at, t('devices.kpi.never'))}</td>
                  <td className="pe-3 text-xs">{k.active ? <span className="text-emerald-500">{t('devices.keys.active')}</span> : <span className="text-[var(--text-muted)]">{t('devices.keys.revoked')}</span>}</td>
                  <td>{k.active && <button type="button" className="btn-secondary min-h-[44px] text-xs inline-flex items-center gap-1" onClick={() => revoke(k)}><Ban size={12} aria-hidden="true" />{t('devices.keys.revoke')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateKeyModal open={open} devices={devices} onClose={() => setOpen(false)} onMinted={(m) => { setOpen(false); setMinted(m); onChanged() }} />
      <MintedModal minted={minted} onClose={() => setMinted(null)} />
    </div>
  )
}

function CreateKeyModal({ open, devices, onClose, onMinted }) {
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [vendor, setVendor] = useState('generic')
  const [deviceRowId, setDeviceRowId] = useState('')
  const [types, setTypes] = useState(['gps', 'odometer', 'engine_hours'])
  const [rate, setRate] = useState(600)
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (d) => setTypes((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))
  const submit = async () => {
    const v = validateKeyForm({ name, dataTypes: types, rate: Number(rate) })
    if (v) { setError(t(`devices.errors.${v}`)); return }
    setBusy(true); setError('')
    try {
      const res = await createIngestKey({ name, dataTypes: types, deviceRowId: deviceRowId || null, rate: Number(rate),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, vendor })
      onMinted({ ...res, vendor })
      setName('')
    } catch (err) { setError(toUserMessage(err, t('devices.errors.generic'))) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose() }} title={t('devices.keys.create')} size="md"
      footer={<button type="button" className="btn-primary min-h-[44px]" disabled={busy} onClick={submit}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null} {t('devices.keys.save')}</button>}>
      <div className="space-y-3">
        <label className="block text-sm">{t('devices.keys.name')}
          <input className="input w-full mt-1" value={name} maxLength={120} placeholder={t('devices.keys.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">{t('devices.keys.vendor')}
          <select className="input w-full mt-1" value={vendor} onChange={(e) => setVendor(e.target.value)}>
            {VENDORS.map((v) => <option key={v} value={v}>{t(`devices.vendors.${v}`)}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t('devices.keys.device')}
          <select className="input w-full mt-1" value={deviceRowId} onChange={(e) => setDeviceRowId(e.target.value)}>
            <option value="">{t('devices.keys.anyDevice')}</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.device_id}{d.asset_no ? ` (${d.asset_no})` : ''}</option>)}
          </select>
        </label>
        <fieldset className="text-sm"><legend>{t('devices.keys.types')}</legend>
          <div className="grid grid-cols-2 gap-1 mt-1">
            {MESSAGE_TYPES.map((d) => (
              <label key={d} className="inline-flex items-center gap-2 min-h-[36px]"><input type="checkbox" checked={types.includes(d)} onChange={() => toggle(d)} />{t(`devices.types.${d}`)}</label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">{t('devices.keys.rate')}<input type="number" min={1} max={6000} className="input w-full mt-1" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <label className="block text-sm">{t('devices.keys.expires')}<input type="date" className="input w-full mt-1" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
        </div>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
  )
}

function MintedModal({ minted, onClose }) {
  const { t } = useLanguage()
  const [copied, setCopied] = useState('')
  if (!minted) return null
  const copy = async (what, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(what) } catch { setCopied('') }
  }
  const example = curlExample(minted.key, minted.vendor)
  return (
    <Modal open onClose={onClose} title={t('devices.keys.create')} size="lg"
      footer={<button type="button" className="btn-primary min-h-[44px]" onClick={onClose}>{t('devices.keys.close')}</button>}>
      <div className="space-y-3">
        <p className="text-sm text-amber-500 inline-flex items-start gap-2"><AlertTriangle size={16} aria-hidden="true" />{t('devices.keys.shownOnce')}</p>
        <div className="flex items-center gap-2">
          <code className="font-mono text-xs break-all flex-1 p-2 rounded bg-[var(--surface-raised)]">{minted.key}</code>
          <button type="button" className="btn-secondary min-h-[44px]" onClick={() => copy('key', minted.key)}>{copied === 'key' ? <Check size={14} aria-label={t('devices.keys.copied')} /> : <Copy size={14} aria-label={t('devices.keys.copy')} />}</button>
        </div>
        <p className="text-xs text-[var(--text-muted)]">{t('devices.keys.example')}</p>
        <pre className="text-xs font-mono whitespace-pre-wrap break-all p-2 rounded bg-[var(--surface-raised)]" dir="ltr">{example}</pre>
        <button type="button" className="btn-secondary min-h-[44px] text-xs" onClick={() => copy('curl', example)}>{copied === 'curl' ? t('devices.keys.copied') : t('devices.keys.copy')}</button>
      </div>
    </Modal>
  )
}

function UnmatchedTab({ rows, onChanged }) {
  const { t } = useLanguage()
  if (!rows.length) return <div className="card flex items-center gap-2 text-[var(--text-muted)]"><Inbox size={16} aria-hidden="true" />{t('devices.unmatched.none')}</div>
  return <div className="space-y-3">{rows.map((r) => <UnmatchedRow key={r.id} row={r} onChanged={onChanged} />)}</div>
}

function UnmatchedRow({ row, onChanged }) {
  const { t } = useLanguage()
  const [code, setCode] = useState(row.identifiers?.asset_no || '')
  const [matches, setMatches] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const ids = Object.entries(row.identifiers || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')
  const find = async () => {
    setBusy(true); setMsg('')
    try { const m = await getAssetMatches(code); setMatches(m.rows); if (!m.rows.length) setMsg(t('devices.unmatched.noMatch')) }
    catch (err) { setMsg(toUserMessage(err, t('devices.errors.generic'))) } finally { setBusy(false) }
  }
  const pick = async (vehicle) => {
    setBusy(true); setMsg('')
    try { await resolveUnmatched(row.id, vehicle.id); setMsg(t('devices.unmatched.matched')); await onChanged() }
    catch (err) { setMsg(toUserMessage(err, t('devices.errors.generic'))) } finally { setBusy(false) }
  }
  const dismiss = async () => {
    setBusy(true)
    try { await dismissUnmatched(row.id); await onChanged() } catch (err) { setMsg(toUserMessage(err, t('devices.errors.generic'))) } finally { setBusy(false) }
  }
  return (
    <div className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--text-primary)]">{t(`devices.types.${row.msg_type}`)} - <span className="text-amber-500">{t(`devices.unmatched.reason.${row.reason}`)}</span></p>
        <p className="text-xs text-[var(--text-muted)]">{fmt(row.created_at, '')}</p>
      </div>
      <p className="text-xs text-[var(--text-muted)] break-all">{t('devices.unmatched.identifiers')}: {ids || 'N/A'}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input min-h-[44px]" aria-label={t('devices.unmatched.find')} placeholder={t('devices.unmatched.find')} value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="button" className="btn-secondary min-h-[44px] inline-flex items-center gap-1" disabled={busy || !code.trim()} onClick={find}><Search size={14} aria-hidden="true" />{t('devices.unmatched.search')}</button>
        <button type="button" className="btn-secondary min-h-[44px]" disabled={busy} onClick={dismiss}>{t('devices.unmatched.dismiss')}</button>
      </div>
      {matches && matches.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {matches.map((v) => (
            <button key={v.id} type="button" className="btn-primary min-h-[44px] text-xs" disabled={busy} onClick={() => pick(v)}>
              {t('devices.unmatched.pick')} {v.asset_no} ({v.country || 'N/A'}{v.site ? `, ${v.site}` : ''})
            </button>
          ))}
        </div>
      )}
      {msg && <p className="text-xs text-[var(--text-muted)]" role="status">{msg}</p>}
    </div>
  )
}

function TestTab() {
  const { t } = useLanguage()
  const [vendor, setVendor] = useState('generic')
  const [text, setText] = useState(() => JSON.stringify(SAMPLE_PAYLOADS.generic, null, 2))
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true); setError(''); setRes(null)
    try {
      const out = await testPayload(text, vendor)
      if (out.error) setError(t(`devices.errors.${out.error}`)); else setRes(out)
    } catch (err) { setError(toUserMessage(err, t('devices.errors.generic'))) } finally { setBusy(false) }
  }
  return (
    <div className="card space-y-3">
      <p className="text-sm text-[var(--text-muted)] inline-flex items-center gap-2"><FlaskConical size={16} aria-hidden="true" />{t('devices.test.intro')}</p>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="input min-h-[44px]" aria-label={t('devices.keys.vendor')} value={vendor} onChange={(e) => setVendor(e.target.value)}>
          {VENDORS.map((v) => <option key={v} value={v}>{t(`devices.vendors.${v}`)}</option>)}
        </select>
        <button type="button" className="btn-secondary min-h-[44px]" onClick={() => setText(JSON.stringify(SAMPLE_PAYLOADS[vendor], null, 2))}>{t('devices.test.loadSample')}</button>
        <button type="button" className="btn-primary min-h-[44px]" disabled={busy} onClick={run}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null} {t('devices.test.run')}</button>
      </div>
      <textarea dir="ltr" className="input w-full font-mono text-xs min-h-[220px]" aria-label="JSON" value={text} onChange={(e) => setText(e.target.value)} />
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {res && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="py-1 pe-3">#</th><th className="pe-3">Type</th><th className="pe-3">{t('devices.test.result')}</th><th className="pe-3">{t('devices.test.asset')}</th><th>{t('devices.test.table')}</th></tr></thead>
          <tbody>{res.rows.map((r) => (
            <tr key={`${r.index}-${r.type}`} className="border-t border-[var(--border)]">
              <td className="py-1 pe-3">{r.index + 1}</td><td className="pe-3">{r.type ? t(`devices.types.${r.type}`) : 'N/A'}</td>
              <td className={`pe-3 ${STATUS_TONE[r.status] || ''}`}>{t(`devices.status.${r.status}`)}{r.error ? ` (${r.error})` : ''}</td>
              <td className="pe-3">{r.asset_no || 'N/A'}</td><td className="font-mono text-xs">{r.target_table || 'N/A'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

const SETTING_FIELDS = [
  ['tpms_low_pct', 'lowPct', 15], ['tpms_critical_pct', 'criticalPct', 25], ['tpms_high_pct', 'highPct', 15],
  ['tpms_low_psi', 'lowPsi', ''], ['tpms_high_psi', 'highPsi', ''], ['tpms_high_temp_c', 'highTemp', 85], ['alert_repeat_hours', 'repeat', 6],
  ['max_reading_age_days', 'maxAgeDays', 30],
]

function SettingsTab({ initial, onSaved }) {
  const { t } = useLanguage()
  const start = useMemo(() => Object.fromEntries(SETTING_FIELDS.map(([k, , d]) => [k, initial?.[k] ?? d])), [initial])
  const [form, setForm] = useState(start)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const save = async () => {
    setBusy(true); setMsg('')
    try {
      const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : Number(v)]))
      await saveIngestSettings(payload); setMsg(t('devices.settings.saved')); await onSaved()
    } catch (err) { setMsg(toUserMessage(err, t('devices.errors.generic'))) } finally { setBusy(false) }
  }
  return (
    <div className="card space-y-3">
      <p className="text-sm text-[var(--text-muted)] inline-flex items-start gap-2"><Settings2 size={16} aria-hidden="true" />{t('devices.settings.intro')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {SETTING_FIELDS.map(([k, label]) => (
          <label key={k} className="block text-sm">{t(`devices.settings.${label}`)}
            <input type="number" className="input w-full mt-1" value={form[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
          </label>
        ))}
      </div>
      <button type="button" className="btn-primary min-h-[44px]" disabled={busy} onClick={save}>{t('devices.settings.save')}</button>
      {msg && <p className="text-sm text-[var(--text-muted)]" role="status">{msg}</p>}
    </div>
  )
}

function HardwareTab() {
  const { t } = useLanguage()
  const sup = printerSupport()
  const pill = (ok) => <span className={ok ? 'text-emerald-500' : 'text-[var(--text-muted)]'}>{ok ? t('devices.hardware.supported') : t('devices.hardware.unsupported')}</span>
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="card space-y-2">
        <h3 className="font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"><Printer size={16} aria-hidden="true" />{t('devices.hardware.printer')}</h3>
        <p className="text-sm text-[var(--text-muted)]">{t('devices.hardware.printerHelp')}</p>
        <p className="text-xs">WebUSB: {pill(sup.usb)} | Web Serial: {pill(sup.serial)}</p>
        <Link to="/qr-labels" className="btn-secondary min-h-[44px] inline-flex items-center">{t('devices.hardware.openLabels')}</Link>
      </div>
      <div className="card space-y-2">
        <h3 className="font-semibold text-[var(--text-primary)] inline-flex items-center gap-2"><ScanLine size={16} aria-hidden="true" />{t('devices.hardware.scanner')}</h3>
        <p className="text-sm text-[var(--text-muted)]">{t('devices.hardware.scannerHelp')}</p>
      </div>
    </div>
  )
}
