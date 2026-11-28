import { useCallback, useEffect, useMemo, useState } from 'react'
import { Mail, Send, Save, X, RefreshCw } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import {
  MAX_EXTERNAL, getEmailEventSettings, isDeliverableAddress, listOrgPeople, parseAddressList,
  sendTestEmail, setEmailEventSetting,
} from '../../lib/api/emailSettings'

const BASE_ROLES = ['Admin', 'Manager', 'Director', 'PMV Manager', 'Fleet Supervisor', 'Workshop Supervisor',
  'Maintenance Supervisor', 'Workshop Maintenance Area Manager', 'Inspector', 'Store Keeper']

/**
 * Admin "Email & alerts": who receives each email type in this organisation.
 * Used on Settings (all types) and on Accident Workflow -> Email Delivery
 * (eventPrefix="accident."). All writes go through set_email_event_setting,
 * which re-validates on the server.
 */
export default function EmailAlertsPanel({ eventPrefix = '', canEdit = true }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState(null)
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [testMsg, setTestMsg] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [settings, ppl] = await Promise.all([getEmailEventSettings(), listOrgPeople().catch(() => [])])
      setRows(settings.filter(r => r.event_key.startsWith(eventPrefix)))
      setPeople(ppl)
    } catch (err) {
      setError(toUserMessage(err, '') || 'load')
    } finally { setLoading(false) }
  }, [eventPrefix])

  useEffect(() => { load() }, [load])

  const roleOptions = useMemo(() => {
    const set = new Set(BASE_ROLES)
    for (const p of people) if (p.role) set.add(p.role)
    return Array.from(set).sort()
  }, [people])

  const onTest = async () => {
    setTestMsg(null)
    try {
      const ok = await sendTestEmail()
      setTestMsg({ ok, text: ok ? t('emailAlerts.testSent') : t('emailAlerts.testNoAddress') })
    } catch (err) {
      setTestMsg({ ok: false, text: toUserMessage(err, t('emailAlerts.testError')) })
    }
  }

  if (loading) return <div className="card" role="status">{t('emailAlerts.loading')}</div>
  if (error) {
    return (
      <div className="card" role="alert">
        <p className="text-sm text-[var(--text-primary)]">{error === 'load' ? t('emailAlerts.loadError') : error}</p>
        <button type="button" className="btn btn-secondary mt-3 inline-flex items-center gap-1.5" onClick={load}>
          <RefreshCw size={14} aria-hidden="true" /> {t('emailAlerts.retry')}
        </button>
      </div>
    )
  }

  return (
    <section className="card space-y-4" aria-labelledby="email-alerts-title">
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="min-w-0">
          <h3 id="email-alerts-title" className="font-semibold text-[var(--text-primary)] inline-flex items-center gap-2">
            <Mail size={16} aria-hidden="true" /> {t('emailAlerts.title')}
          </h3>
          <p className="text-sm text-[var(--text-muted)] mt-1 max-w-2xl">{t('emailAlerts.subtitle')}</p>
        </div>
        {canEdit && (
          <button type="button" onClick={onTest} className="btn btn-secondary inline-flex items-center gap-1.5 min-h-[44px]">
            <Send size={14} aria-hidden="true" /> {t('emailAlerts.testSend')}
          </button>
        )}
      </div>
      {testMsg && <p role="status" className={`text-sm ${testMsg.ok ? 'text-emerald-500' : 'text-amber-500'}`}>{testMsg.text}</p>}
      {!canEdit && <p className="text-sm text-[var(--text-muted)]">{t('emailAlerts.adminOnly')}</p>}
      <div className="space-y-3">
        {(rows || []).map(row => (
          <EventRow key={row.event_key} row={row} people={people} roleOptions={roleOptions} canEdit={canEdit}
            onSaved={next => setRows(rs => rs.map(r => (r.event_key === row.event_key ? { ...r, ...next, configured: true } : r)))} />
        ))}
      </div>
    </section>
  )
}

function EventRow({ row, people, roleOptions, canEdit, onSaved }) {
  const { t } = useLanguage()
  const [enabled, setEnabled] = useState(!!row.enabled)
  const [roles, setRoles] = useState(row.recipient_roles || [])
  const [userIds, setUserIds] = useState(row.recipient_user_ids || [])
  const [externalText, setExternalText] = useState((row.external_addresses || []).join(', '))
  const [includeAssignee, setIncludeAssignee] = useState(row.include_assignee !== false)
  const [query, setQuery] = useState('')
  const [state, setState] = useState({ saving: false, msg: null })
  const id = `email-evt-${row.event_key.replace(/\W/g, '-')}`
  const evKey = row.event_key.replace(/\./g, '_')

  const external = parseAddressList(externalText)
  const bad = external.find(a => !isDeliverableAddress(a))
  const tooMany = external.length > MAX_EXTERNAL
  const byId = useMemo(() => new Map(people.map(p => [p.id, p])), [people])
  const matches = query.trim().length < 2 ? [] : people
    .filter(p => !userIds.includes(p.id) && `${p.full_name || ''} ${p.username || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 6)

  const save = async () => {
    if (bad || tooMany) return
    setState({ saving: true, msg: null })
    try {
      const saved = await setEmailEventSetting({ eventKey: row.event_key, enabled, roles, userIds, external, includeAssignee })
      onSaved(saved || {})
      setState({ saving: false, msg: { ok: true, text: t('emailAlerts.saved') } })
    } catch (err) {
      setState({ saving: false, msg: { ok: false, text: toUserMessage(err, t('emailAlerts.saveError')) } })
    }
  }

  const toggleRole = r => setRoles(cur => (cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r]))

  return (
    <fieldset className="rounded-lg border border-[var(--border-bright)] p-4" aria-labelledby={`${id}-label`} disabled={!canEdit}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <legend id={`${id}-label`} className="font-medium text-[var(--text-primary)]">{t(`emailAlerts.events.${evKey}.label`)}</legend>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{t(`emailAlerts.events.${evKey}.help`)}</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{row.optional ? t('emailAlerts.optional') : t('emailAlerts.mandatory')}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          {t('emailAlerts.enabled')}
        </label>
      </div>

      <div className="mt-3">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">{t('emailAlerts.roles')}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('emailAlerts.roles')}>
          {roleOptions.map(r => {
            const on = roles.includes(r)
            return (
              <button key={r} type="button" aria-pressed={on} onClick={() => toggleRole(r)}
                className={`px-2.5 py-1 rounded-full text-xs border min-h-[32px] ${on ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>
                {r}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={`${id}-people`} className="text-xs font-medium text-[var(--text-secondary)]">{t('emailAlerts.people')}</label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {userIds.length === 0 && <span className="text-xs text-[var(--text-muted)]">{t('emailAlerts.noPeople')}</span>}
          {userIds.map(uid => (
            <span key={uid} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--surface-2)] text-xs">
              {byId.get(uid)?.full_name || byId.get(uid)?.username || uid.slice(0, 8)}
              <button type="button" aria-label={t('emailAlerts.remove')} onClick={() => setUserIds(ids => ids.filter(x => x !== uid))}><X size={12} /></button>
            </span>
          ))}
        </div>
        <input id={`${id}-people`} type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t('emailAlerts.searchPeople')} className="input mt-1.5 w-full max-w-sm" autoComplete="off" />
        {matches.length > 0 && (
          <ul className="mt-1 max-w-sm rounded border border-[var(--input-border)] bg-[var(--surface-2)]">
            {matches.map(p => (
              <li key={p.id}>
                <button type="button" className="w-full text-start px-3 py-2 text-sm hover:bg-[var(--input-bg)]"
                  onClick={() => { setUserIds(ids => [...ids, p.id]); setQuery('') }}>
                  {p.full_name || p.username} <span className="text-[var(--text-muted)]">{p.role}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <label htmlFor={`${id}-ext`} className="text-xs font-medium text-[var(--text-secondary)]">{t('emailAlerts.external')}</label>
        <textarea id={`${id}-ext`} rows={2} value={externalText} onChange={e => setExternalText(e.target.value)}
          className="input mt-1.5 w-full" dir="ltr" aria-describedby={`${id}-ext-hint`} aria-invalid={!!(bad || tooMany)} />
        <p id={`${id}-ext-hint`} className="text-xs text-[var(--text-muted)] mt-1">{t('emailAlerts.externalHint')}</p>
        {tooMany && <p className="text-xs text-red-500 mt-1">{t('emailAlerts.tooMany')}</p>}
        {bad && <p className="text-xs text-red-500 mt-1">{t('emailAlerts.badAddress', { address: bad })}</p>}
      </div>

      {row.assignee_based && (
        <label className="mt-3 inline-flex items-center gap-2 text-sm min-h-[44px]">
          <input type="checkbox" checked={includeAssignee} onChange={e => setIncludeAssignee(e.target.checked)} />
          {t('emailAlerts.includeAssignee')}
        </label>
      )}

      {canEdit && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={save} disabled={state.saving || !!bad || tooMany}
            className="btn btn-primary inline-flex items-center gap-1.5 min-h-[44px]">
            <Save size={14} aria-hidden="true" /> {state.saving ? t('emailAlerts.saving') : t('emailAlerts.save')}
          </button>
          {state.msg && <span role="status" className={`text-sm ${state.msg.ok ? 'text-emerald-500' : 'text-red-500'}`}>{state.msg.text}</span>}
        </div>
      )}
    </fieldset>
  )
}
