/**
 * ConsoleAccessPolicies.jsx - console IP allowlist + SSO enforcement.
 *
 * Migration: supabase/migrations/20260924117000_access_policies.sql.
 *
 * 1. Console IP allowlist. When ON, a super admin whose network address is not
 *    inside an active range sees a "blocked by IP policy" screen instead of the
 *    console. OFF by default. The server refuses to turn it on unless YOUR
 *    current address is covered, and refuses to remove the range you are
 *    standing in while it is on. The console check itself FAILS OPEN on an RPC
 *    error so a bug can never lock the owner out.
 * 2. SSO required, per organisation. Reuses sso_connections.enforce_sso. When
 *    on, a non-super-admin whose email domain is enforced is signed straight
 *    back out after a password sign-in and told to use SSO. Super admins are
 *    always exempt (break-glass). Refused unless the domains are registered in
 *    Supabase Auth, otherwise nobody could sign in at all.
 *
 * Every change is written to console_sessions (server-stamped, with your IP).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ShieldCheck, Globe, KeyRound, Plus, Trash2, RefreshCw, Power, AlertTriangle,
  CheckCircle2, Lock, Unlock, Info, Network, Building2,
} from 'lucide-react'
import {
  Panel, PanelHeader, Note, StatTile, Badge, Btn, Code,
  Table, THead, Th, Tr, Td, LoadingState, EmptyState, ErrorState, Modal,
} from '../components/ui'
import {
  getAccessPolicies, addAllowlistEntry, setAllowlistEntryActive, deleteAllowlistEntry,
  setConsoleIpAllowlist, setSsoRequired,
} from '../../lib/api/accessPolicies'
import {
  validateAllowlistEntry, enableLockoutRisk, isCovered, rangeSize, ssoOrgStatus, ssoEnableBlocker,
} from '../../lib/accessPolicies'
import { toUserMessage } from '../../lib/safeError'

const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-600 focus:border-gray-700 focus:outline-none'

function fmtWhen(v) {
  if (!v) return 'N/A'
  return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400">{hint}</span>}
    </label>
  )
}

/* ── confirm-with-reason modal (every switch needs a reason for the audit) ── */
function ReasonModal({ open, title, subtitle, confirmLabel, variant = 'primary', onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setReason(''); setErr('') } }, [open])
  async function go() {
    if (reason.trim().length < 5) { setErr('Give a reason of at least 5 characters.'); return }
    setBusy(true); setErr('')
    try { await onConfirm(reason.trim()); onClose() }
    catch (e) { setErr(toUserMessage(e, 'The change was not saved.')) }
    finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} width="max-w-lg"
      footer={<>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant={variant} busy={busy} onClick={go}>{confirmLabel}</Btn>
      </>}>
      <div className="space-y-3">
        <Field label="Reason (kept in the audit trail)">
          <textarea className={`${inputCls} min-h-[70px]`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorState message={err} />
      </div>
    </Modal>
  )
}

/* ── IP allowlist panel ───────────────────────────────────────────────────── */
function IpAllowlistPanel({ ip, onChanged }) {
  const [label, setLabel] = useState('')
  const [cidr, setCidr] = useState('')
  const [addErr, setAddErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [rowErr, setRowErr] = useState('')
  const [toggle, setToggle] = useState(null) // 'on' | 'off'
  const [adding, setAdding] = useState(false)

  const check = useMemo(() => (cidr.trim() ? validateAllowlistEntry({ label: label || 'x', cidr }) : null), [label, cidr])
  const lockoutRisk = enableLockoutRisk(ip.callerIp, ip.entries)
  const activeCount = ip.entries.filter((e) => e.active).length

  async function add() {
    setAddErr('')
    const v = validateAllowlistEntry({ label, cidr })
    if (!v.ok) { setAddErr(v.error); return }
    setAdding(true)
    try { await addAllowlistEntry(label.trim(), v.cidr); setLabel(''); setCidr(''); onChanged() }
    catch (e) { setAddErr(toUserMessage(e, 'The range was not added.')) }
    finally { setAdding(false) }
  }

  async function rowAction(id, fn) {
    setBusyId(id); setRowErr('')
    try { await fn(); onChanged() }
    catch (e) { setRowErr(toUserMessage(e, 'The change was not saved.')) }
    finally { setBusyId(null) }
  }

  function wouldStrand(entry, nextActive) {
    if (!ip.enabled) return false
    const after = ip.entries
      .filter((e) => (nextActive === null ? e.id !== entry.id : true))
      .map((e) => (e.id === entry.id && nextActive !== null ? { ...e, active: nextActive } : e))
    return !isCovered(ip.callerIp, after)
  }

  return (
    <Panel tone={ip.enabled ? 'accent' : undefined}>
      <PanelHeader icon={Network} title="Console IP allowlist"
        subtitle="When on, the console only opens from the network ranges listed below."
        actions={ip.enabled
          ? <Btn variant="danger" icon={Power} onClick={() => setToggle('off')}>Turn off</Btn>
          : <Btn variant="primary" icon={Power} disabled={!!lockoutRisk} title={lockoutRisk || undefined} onClick={() => setToggle('on')}>Turn on</Btn>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile label="Status" value={ip.enabled ? 'On' : 'Off'} tone={ip.enabled ? 'warning' : 'default'}
          icon={ip.enabled ? Lock : Unlock} sub={ip.enabled ? 'Enforced on console sign-in' : 'Console open from anywhere'} />
        <StatTile label="Your address" value={ip.callerIp || 'Unknown'} icon={Globe}
          sub={ip.callerIp ? (ip.callerCovered ? 'Covered by an active range' : 'Not covered') : 'Could not be read from this request'} />
        <StatTile label="Active ranges" value={activeCount} icon={CheckCircle2} sub={`${ip.entries.length} listed in total`} />
        <StatTile label="Lockout check" value={lockoutRisk ? 'Not safe' : 'Safe'} tone={lockoutRisk ? 'warning' : 'good'}
          icon={lockoutRisk ? AlertTriangle : ShieldCheck} sub={lockoutRisk ? 'Add your own range first' : 'You would stay in'} />
      </div>

      {!ip.enabled && lockoutRisk && (
        <div className="mb-3"><Note icon={Info} tone="warning">{lockoutRisk} Turning it on is refused by the server until then.</Note></div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end mb-2">
        <Field label="Label"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Head office" /></Field>
        <Field label="IP or CIDR range" hint={check?.ok
          ? `Stored as ${check.cidr} (${rangeSize(check.cidr)})`
          : 'IPv4 or IPv6, for example 203.0.113.0/24 or 2001:db8::/32'}>
          <input className={inputCls} value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="203.0.113.0/24" />
        </Field>
        <div className="flex gap-2 pb-[18px]">
          {ip.callerIp && !ip.callerCovered && (
            <Btn onClick={() => { setCidr(ip.callerIp); if (!label) setLabel('My current address') }}>Use my address</Btn>
          )}
          <Btn variant="primary" icon={Plus} busy={adding} onClick={add}>Add</Btn>
        </div>
      </div>
      <ErrorState message={addErr} />
      <ErrorState message={rowErr} />

      <div className="mt-3">
        {ip.entries.length === 0 ? (
          <EmptyState icon={Network} title="No ranges listed yet"
            reason="Add the office or VPN ranges you administer from. The allowlist cannot be turned on until your own address is covered." />
        ) : (
          <Table>
            <THead>
              <Th>Label</Th><Th>Range</Th><Th>Size</Th><Th>Status</Th><Th>Added</Th><Th align="right">Actions</Th>
            </THead>
            <tbody>
              {ip.entries.map((e) => {
                const strandOff = wouldStrand(e, false)
                const strandDel = wouldStrand(e, null)
                return (
                  <Tr key={e.id}>
                    <Td>
                      <span className="text-gray-200">{e.label}</span>
                      {e.covers_caller && <span className="ml-2"><Badge tone="good">Your address</Badge></span>}
                    </Td>
                    <Td><Code>{e.cidr}</Code></Td>
                    <Td nowrap>{rangeSize(e.cidr)}</Td>
                    <Td>{e.active ? <Badge tone="good">Active</Badge> : <Badge tone="quiet">Paused</Badge>}</Td>
                    <Td nowrap>{fmtWhen(e.created_at)}{e.created_by_name ? ` by ${e.created_by_name}` : ''}</Td>
                    <Td align="right">
                      <div className="inline-flex gap-1.5">
                        <Btn size="xs" busy={busyId === e.id}
                          disabled={e.active && strandOff}
                          title={e.active && strandOff ? 'This would lock you out while the allowlist is on' : undefined}
                          onClick={() => rowAction(e.id, () => setAllowlistEntryActive(e.id, !e.active))}>
                          {e.active ? 'Pause' : 'Activate'}
                        </Btn>
                        <Btn size="xs" variant="quiet" icon={Trash2} disabled={strandDel} busy={busyId === e.id}
                          title={strandDel ? 'This would lock you out while the allowlist is on' : `Delete ${e.cidr}`}
                          onClick={() => {
                            if (typeof window !== 'undefined' && window.confirm && !window.confirm(`Delete the allowlist entry ${e.label ? `${e.label} (${e.cidr})` : e.cidr}? This cannot be undone.`)) return
                            rowAction(e.id, () => deleteAllowlistEntry(e.id))
                          }}>Delete</Btn>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </div>

      <div className="mt-3">
        <Note icon={Info}>
          Locked out? From the Supabase SQL editor run, in one execution:
          {' '}<Code>{"select set_config('app.access_policy_rpc','on',true); update public.system_config set value='false' where key='console_ip_allowlist_enabled';"}</Code>
        </Note>
      </div>

      <ReasonModal open={toggle === 'on'} onClose={() => setToggle(null)} title="Turn on the console IP allowlist"
        subtitle="Super admins outside the listed ranges will see a blocked screen instead of the console."
        confirmLabel="Turn on" onConfirm={async (r) => { await setConsoleIpAllowlist(true, r); onChanged() }} />
      <ReasonModal open={toggle === 'off'} onClose={() => setToggle(null)} title="Turn off the console IP allowlist"
        subtitle="The console will open from any network again." variant="danger"
        confirmLabel="Turn off" onConfirm={async (r) => { await setConsoleIpAllowlist(false, r); onChanged() }} />
    </Panel>
  )
}

/* ── SSO panel ────────────────────────────────────────────────────────────── */
function SsoPanel({ sso, onChanged }) {
  const [target, setTarget] = useState(null) // { org, required }
  return (
    <Panel>
      <PanelHeader icon={KeyRound} title="Require single sign-on"
        subtitle="Per organisation. When on, password sign-in is refused for users whose email domain is enforced. Super admins are always exempt." />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <StatTile label="IdPs registered in Supabase Auth" value={sso.registeredProviders} icon={ShieldCheck}
          tone={sso.registeredProviders ? 'default' : 'warning'}
          sub={sso.registeredProviders ? `${sso.registeredDomains.length} domain(s)` : 'None yet: SSO cannot be required'} />
        <StatTile label="Organisations requiring SSO" value={sso.orgs.filter((o) => o.required).length} icon={Lock}
          sub={`of ${sso.orgs.length}`} />
        <StatTile label="Users affected" value={sso.orgs.reduce((n, o) => n + (Number(o.affected_users) || 0), 0)} icon={Building2}
          sub="Non-super-admins on an enforced domain" />
      </div>

      {sso.orgs.length === 0 ? (
        <EmptyState icon={Building2} title="No organisations" reason="There are no organisations to configure." />
      ) : (
        <Table>
          <THead>
            <Th>Organisation</Th><Th>Connections</Th><Th>Domains</Th><Th>Status</Th><Th align="right">Action</Th>
          </THead>
          <tbody>
            {sso.orgs.map((o) => {
              const st = ssoOrgStatus(o)
              const blocker = o.required ? null : ssoEnableBlocker(o, sso.registeredDomains)
              return (
                <Tr key={o.id}>
                  <Td><span className="text-gray-200">{o.name}</span></Td>
                  <Td nowrap>{o.active_connections} active of {o.connections}</Td>
                  <Td>
                    {(o.active_domains || []).length === 0 ? <span className="text-gray-400">None</span> : (
                      <div className="flex flex-wrap gap-1">
                        {o.active_domains.map((d) => <Code key={d}>{d}</Code>)}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {o.required && <span className="ml-2 text-[11px] text-gray-500">{o.affected_users} user(s)</span>}
                  </Td>
                  <Td align="right">
                    {o.required
                      ? <Btn size="xs" variant="danger" onClick={() => setTarget({ org: o, required: false })}>Allow passwords</Btn>
                      : <Btn size="xs" variant="primary" disabled={!!blocker} title={blocker || undefined}
                          onClick={() => setTarget({ org: o, required: true })}>Require SSO</Btn>}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <div className="mt-3 space-y-2">
        <Note icon={AlertTriangle} tone="warning">
          This is enforced by the app and a database check, not by Supabase Auth itself. Known gaps: a client that
          calls Supabase sign-in directly still gets a session; the mobile apps do not run the check yet; and
          nothing here registers an identity provider (that is done in Supabase Auth, via the Management API).
        </Note>
        <Note icon={Info}>
          Connections and their domains are managed in Console, Security (SSO configuration). A domain must also be
          registered with Supabase Auth before SSO can be required for it, otherwise nobody on it could sign in.
        </Note>
      </div>

      <ReasonModal open={!!target} onClose={() => setTarget(null)}
        title={target?.required ? `Require SSO for ${target?.org?.name}` : `Allow password sign-in for ${target?.org?.name}`}
        subtitle={target?.required
          ? 'Users on the enforced domains will be signed out after a password sign-in and asked to use SSO.'
          : 'Users will be able to sign in with a password again.'}
        variant={target?.required ? 'primary' : 'danger'}
        confirmLabel={target?.required ? 'Require SSO' : 'Allow passwords'}
        onConfirm={async (r) => { await setSsoRequired(target.org.id, target.required, r); onChanged() }} />
    </Panel>
  )
}

export default function ConsoleAccessPolicies() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await getAccessPolicies()) }
    catch (e) { setError(toUserMessage(e, 'Access policies could not be loaded.')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5 max-w-7xl">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
            <ShieldCheck size={20} className="text-orange-400" /> Access Policies
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Limit where the console can be opened from, and require single sign-on for an organisation. Every change is audited with your address.
          </p>
        </div>
        <Btn icon={RefreshCw} busy={loading} onClick={load}>Refresh</Btn>
      </header>

      <ErrorState message={error} onRetry={load} />
      {loading && !data ? <LoadingState label="Loading access policies" /> : null}
      {data && (
        <>
          <IpAllowlistPanel ip={data.ip} onChanged={load} />
          <Note icon={Info}>
            The IP allowlist guards the console screens. It does not change database permissions: a super admin's
            sign-in token still works against the API from any address. If the check itself fails, the console lets
            you in rather than lock you out.
          </Note>
          <SsoPanel sso={data.sso} onChanged={load} />
        </>
      )}
    </div>
  )
}
