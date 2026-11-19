/**
 * OrgInvitationsPanel - a company Admin invites people into their own company
 * and cancels links that should no longer work.
 *
 * ONE component, mounted in the two places an Admin already manages people:
 *   - Settings > Security (a company Admin; /console is super-admin only)
 *   - Console > Users > People > Invite user drawer (the super admin)
 * Both call the same server functions, which decide the company from the
 * caller's own session (org_invite_member uses app_current_org()), so neither
 * mount can invite into someone else's company.
 *
 * The invite link is shown ONCE, right after it is created: the database keeps
 * only a hash of the token, so it cannot be shown again. A lost link is
 * cancelled and a new one made.
 */
import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Link2, RefreshCw, UserPlus, XCircle } from 'lucide-react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import {
  INVITE_DAY_OPTIONS, buildInviteUrl, canRevoke, createInvitation,
  getMyOrgSignInCode, invitationStatus, listInvitations, revokeInvitation,
  setMyOrgSignInCode,
} from '../../lib/api/orgInvitations'
import { isValidCompanyCode } from '../../lib/signInIdentifier'
import { listAssignableRoles } from '../../lib/api/customRoles'
import { ACCESS_ROLES } from '../../lib/moduleCatalog'

const STATUS_TONE = {
  pending: 'var(--warning, #b45309)',
  accepted: 'var(--success, #15803d)',
  revoked: 'var(--text-secondary)',
  expired: 'var(--text-secondary)',
}

function formatDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function OrgInvitationsPanel({ canInvite = true }) {
  const { t } = useLanguage()
  const k = (key, vars) => t(`auth.invitations.${key}`, vars)

  const [roles, setRoles] = useState(ACCESS_ROLES)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('Reporter')
  const [days, setDays] = useState(7)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [lastLink, setLastLink] = useState('')
  const [copied, setCopied] = useState(false)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [rowError, setRowError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      setRows(await listInvitations())
    } catch (err) {
      setLoadError(toUserMessage(err, k('loadError')))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (canInvite) load() }, [canInvite, load])

  // Company sign-in code (TEN-9d). null = the server function is not there yet
  // or could not be read: the block is then simply not shown.
  const [codeInfo, setCodeInfo] = useState(null)
  const [codeDraft, setCodeDraft] = useState('')
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeMsg, setCodeMsg] = useState({ tone: '', text: '' })

  const loadCode = useCallback(async () => { setCodeInfo(await getMyOrgSignInCode()) }, [])
  useEffect(() => { if (canInvite) loadCode() }, [canInvite, loadCode])

  async function handleSaveCode(e) {
    e.preventDefault()
    const v = codeDraft.trim()
    if (!isValidCompanyCode(v)) { setCodeMsg({ tone: 'error', text: k('codeInvalid') }); return }
    setCodeBusy(true); setCodeMsg({ tone: '', text: '' })
    try {
      await setMyOrgSignInCode(v)
      setCodeDraft('')
      setCodeMsg({ tone: 'ok', text: k('codeSaved') })
      await loadCode()
    } catch (err) {
      setCodeMsg({ tone: 'error', text: toUserMessage(err, k('codeFailed')) })
    } finally {
      setCodeBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    listAssignableRoles().then((r) => { if (alive && Array.isArray(r) && r.length) setRoles(r) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const now = new Date()

  if (!canInvite) {
    return (
      <div className="card p-5">
        <p className="text-sm text-[var(--text-secondary)]">{k('notAllowed')}</p>
      </div>
    )
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreateError(''); setLastLink(''); setCopied(false); setCreating(true)
    try {
      const res = await createInvitation({ email: email.trim() || null, role, days })
      setLastLink(buildInviteUrl(res.invite_token))
      setEmail('')
      load()
    } catch (err) {
      setCreateError(toUserMessage(err, k('createFailed')))
    } finally {
      setCreating(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard?.writeText(lastLink)
      setCopied(true)
    } catch { /* the link stays visible to copy by hand */ }
  }

  async function handleRevoke(row) {
    if (typeof window !== 'undefined' && !window.confirm(k('revokeConfirm'))) return
    setRowError(''); setBusyId(row.id)
    try {
      const ok = await revokeInvitation(row.id)
      if (!ok) setRowError(k('revokeFailed'))
      await load()
    } catch (err) {
      setRowError(toUserMessage(err, k('revokeFailed')))
    } finally {
      setBusyId(null)
    }
  }

  const fieldStyle = 'w-full rounded-md border border-[var(--border-bright)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)]'

  return (
    <div className="card p-5 space-y-5" data-testid="org-invitations-panel">
      <div>
        <h2 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <UserPlus size={16} aria-hidden="true" /> {k('title')}
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{k('subtitle')}</p>
        <p className="text-xs text-[var(--text-secondary)] mt-1">{k('signInNote')}</p>
      </div>

      {codeInfo && (
        <div className="rounded-md border border-[var(--border-bright)] p-3 space-y-2" data-testid="org-code-block">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{k('codeTitle')}</h3>
          <p className="text-sm text-[var(--text-secondary)]" data-testid="org-code-current">
            {codeInfo.effectiveCode ? k('codeCurrent', { code: codeInfo.effectiveCode }) : k('codeNone')}
          </p>
          {codeInfo.canSet ? (
            <form onSubmit={handleSaveCode} className="flex flex-wrap items-end gap-2" noValidate>
              <label className="block text-sm flex-1 min-w-[10rem]">
                <span className="block mb-1 text-[var(--text-secondary)]">{k('codeLabel')}</span>
                <input dir="ltr" autoCapitalize="characters" spellCheck={false} maxLength={24} className={fieldStyle}
                  value={codeDraft} onChange={(e) => { setCodeDraft(e.target.value); setCodeMsg({ tone: '', text: '' }) }}
                  aria-describedby="org-code-help" />
                <span id="org-code-help" className="block mt-1 text-xs text-[var(--text-secondary)]">{k('codeHelp')}</span>
              </label>
              <button type="submit" disabled={codeBusy}
                className="btn-primary inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium min-h-[40px] disabled:opacity-60">
                {codeBusy ? k('codeSaving') : k('codeSave')}
              </button>
            </form>
          ) : codeInfo.reason ? (
            <p className="text-xs text-[var(--text-secondary)]" data-testid="org-code-reason">{k(`codeReason.${codeInfo.reason}`)}</p>
          ) : null}
          {codeMsg.text && (
            <p role={codeMsg.tone === 'error' ? 'alert' : 'status'}
              className={`text-sm ${codeMsg.tone === 'error' ? 'text-[var(--danger,#b91c1c)]' : 'text-[var(--success,#15803d)]'}`}>
              {codeMsg.text}
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] items-end" noValidate>
        <label className="block text-sm">
          <span className="block mb-1 text-[var(--text-secondary)]">{k('email')}</span>
          <input type="email" autoComplete="off" className={fieldStyle} value={email}
            onChange={(e) => setEmail(e.target.value)} aria-describedby="invite-email-help" />
          <span id="invite-email-help" className="block mt-1 text-xs text-[var(--text-secondary)]">{k('emailHelp')}</span>
        </label>
        <label className="block text-sm">
          <span className="block mb-1 text-[var(--text-secondary)]">{k('role')}</span>
          <select className={fieldStyle} value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="block mb-1 text-[var(--text-secondary)]">{k('days')}</span>
          <select className={fieldStyle} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {INVITE_DAY_OPTIONS.map((n) => <option key={n} value={n}>{k('daysValue', { n })}</option>)}
          </select>
        </label>
        <button type="submit" disabled={creating}
          className="btn-primary inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium min-h-[40px] disabled:opacity-60">
          <Link2 size={14} aria-hidden="true" /> {creating ? k('creating') : k('create')}
        </button>
      </form>

      {createError && <p role="alert" className="text-sm text-[var(--danger,#b91c1c)]">{createError}</p>}

      {lastLink && (
        <div className="rounded-md border border-[var(--border-bright)] p-3 space-y-2" data-testid="invite-link-ready">
          <p className="text-sm text-[var(--text-primary)]">{k('linkReady')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="flex-1 min-w-0 break-all text-xs bg-[var(--surface-raised,var(--surface))] rounded px-2 py-1">{lastLink}</code>
            <button type="button" onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm min-h-[40px]">
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? k('copied') : k('copy')}
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{k('listTitle')}</h3>
          <button type="button" onClick={load} aria-label={k('retry')}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] min-h-[32px]">
            <RefreshCw size={12} aria-hidden="true" />
          </button>
        </div>
        {rowError && <p role="alert" className="text-sm text-[var(--danger,#b91c1c)] mb-2">{rowError}</p>}
        {loading ? (
          <p className="text-sm text-[var(--text-secondary)]">...</p>
        ) : loadError ? (
          <div role="alert" className="flex items-center gap-3 text-sm">
            <span className="text-[var(--danger,#b91c1c)]">{loadError}</span>
            <button type="button" onClick={load} className="underline">{k('retry')}</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">{k('empty')}</p>
        ) : (
          <ul className="divide-y divide-[var(--border-bright)]" aria-label={k('listTitle')}>
            {rows.map((row) => {
              const status = invitationStatus(row, now)
              return (
                <li key={row.id} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="invite-row">
                  <span className="flex-1 min-w-[10rem] text-[var(--text-primary)] break-all" dir="ltr">{row.email || k('anyone')}</span>
                  <span className="text-[var(--text-secondary)]">{row.role}</span>
                  <span style={{ color: STATUS_TONE[status] }}>{k(`status.${status}`)}</span>
                  <span className="text-[var(--text-secondary)] tabular-nums">{k('colExpires')}: {formatDate(row.expires_at)}</span>
                  {canRevoke(row, now) && (
                    <button type="button" onClick={() => handleRevoke(row)} disabled={busyId === row.id}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border-bright)] px-2 py-1 text-xs min-h-[32px] disabled:opacity-60">
                      <XCircle size={12} aria-hidden="true" /> {k('revoke')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
