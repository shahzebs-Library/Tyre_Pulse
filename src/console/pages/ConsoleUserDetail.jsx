/**
 * ConsoleUserDetail - one person on one page (/console/users/:id).
 *
 * Replaces the Users edit modal, the per-person parts of Sessions & Devices and
 * Support Sessions, and the Access Control effective-access tab. Tabs:
 * Overview, Problems (new: health score, problem timeline, sources, repeat
 * assets, fix actions), Access, Activity, Devices, Audit.
 *
 * Reads: profiles (RLS), admin_user_health (DEFINER), admin_get_effective_access,
 * admin_list_access_audit. Writes reuse audited writers: admin_mobile_user_action
 * (lock / unlock), admin-revoke-sessions, admin_clear_push_token,
 * admin_bulk_set_role, start_support_session, admin_send_person_reminder.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  UserCog, KeyRound, LogOut, Fingerprint, LifeBuoy, Lock, Unlock, LayoutGrid, HeartPulse, Activity, Smartphone,
  ScrollText, ChevronRight, MessageSquare, Users, Info, BellOff, Undo2, Bug, ClipboardList, Bell, Send, ArrowUpRight,
  ShieldCheck, Pencil,
} from 'lucide-react'
import {
  Btn, Panel, PanelHeader, Note, LoadingState, ErrorState, EmptyState, ImpactBox, ConfirmImpactDialog, Modal, Select,
  SearchInput, Segmented,
} from '../components/ui'
import { BarsChart } from '../components/ui/charts'
import { useUrlTab } from './shared/pageKit'
import { useConsoleAuth } from '../ConsoleAuthContext'
import {
  getPlatformProfile, getUserHealth, listOrgsFull, getMobileMinVersion, setPersonLocked, sendPersonReminder, listPlatformProfiles,
} from '../../lib/api/consolePlatform'
import { getEffectiveAccess, listAccessAudit, bulkSetRole } from '../../lib/api/adminAccess'
import { revokeUserSessions } from '../../lib/api/sessionRevocation'
import { clearPushToken } from '../../lib/api/consoleSessions'
import { startSupportSession } from '../../lib/api/supportSessions'
import { listCustomRoles } from '../../lib/api/customRoles'
import { ACCESS_ROLES } from '../../lib/moduleCatalog'
import { MOBILE_MODULES, mobileModuleDefaultAllows } from '../../lib/mobileModules'
import {
  shortName, initials, fmtRiyadh, riyadhDay, countryLabel, sitesLabel, healthScore, healthLabel, problemTimeline,
  isBelowMinimum,
} from '../../lib/consolePlatform'
import { toUserMessage } from '../../lib/safeError'
import { Facts, Pill, PageTabs, DecisionTag } from './platform/PlatformKit'

const TABS = ['overview', 'problems', 'access', 'activity', 'devices', 'audit']

function useAsync(fn, deps) {
  const [st, setSt] = useState({ loading: true })
  const run = useCallback(async () => {
    setSt((s) => ({ ...s, loading: true }))
    try { setSt({ loading: false, data: await fn() }) } catch (err) { setSt({ loading: false, error: toUserMessage(err, 'Could not load this part.') }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...st, reload: run }
}

function HealthRing({ score }) {
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const tone = score == null ? '#6b7280' : score >= 85 ? '#10b981' : score >= 65 ? '#f59e0b' : '#f97316'
  const r = 26; const c = 2 * Math.PI * r
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`Health ${score ?? 'not measured'}`}>
      <circle cx="34" cy="34" r={r} fill="none" stroke="currentColor" className="text-gray-800" strokeWidth="7" />
      <circle cx="34" cy="34" r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 34 34)" />
      <text x="34" y="39" textAnchor="middle" className="fill-current text-gray-100" fontSize="16" fontWeight="700">{score ?? 'N/A'}</text>
    </svg>
  )
}

const KIND_ICON = { returned: Undo2, notice: Bell, error: Bug, report: MessageSquare, record: ClipboardList, signin: LogOut, device: Smartphone, admin: UserCog, created: Users }

function TimelineList({ items = [], empty = 'Nothing recorded.' }) {
  if (!items.length) return <p className="text-xs text-gray-500 p-4">{empty}</p>
  return (
    <ul className="divide-y divide-gray-800">
      {items.map((it, i) => {
        const Icon = KIND_ICON[it.kind] || Activity
        return (
          <li key={`${it.kind}-${it.at}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 p-1.5 rounded-lg bg-gray-800/70 text-gray-400"><Icon size={13} aria-hidden="true" /></span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-200">{it.title}</p>
              {it.body && <p className="text-[11px] text-gray-500">{it.body}</p>}
            </div>
            <span className="text-[11px] font-mono text-gray-500 whitespace-nowrap">{fmtRiyadh(it.at)}</span>
          </li>
        )
      })}
    </ul>
  )
}

export default function ConsoleUserDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { logAction, admin } = useConsoleAuth()
  const [tab, setTab] = useUrlTab(TABS, 'overview')
  const profileQ = useAsync(() => getPlatformProfile(id), [id])
  const healthQ = useAsync(() => getUserHealth(id), [id])
  const accessQ = useAsync(() => getEffectiveAccess(id), [id])
  const auditQ = useAsync(() => listAccessAudit({ limit: 200, target: id }), [id])
  const orgsQ = useAsync(() => listOrgsFull(), [])
  const minQ = useAsync(() => getMobileMinVersion(), [])
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [role, setRole] = useState('')
  const [roles, setRoles] = useState(ACCESS_ROLES)
  const [support, setSupport] = useState({ reason: '', ref: '', minutes: 30 })
  const [reminder, setReminder] = useState({ title: '', body: '', reason: '', copyTo: '' })
  const [supervisors, setSupervisors] = useState([])
  const [range, setRange] = useState('30')
  const [actFilter, setActFilter] = useState('all')
  const [probFilter, setProbFilter] = useState('all')
  const [accessSearch, setAccessSearch] = useState('')

  useEffect(() => {
    listCustomRoles().then((r) => setRoles([...new Set([...ACCESS_ROLES, ...(r || []).map((x) => x.name).filter(Boolean)])])).catch(() => {})
  }, [])

  const p = profileQ.data
  const h = healthQ.data
  const minVersion = minQ.data?.min || null
  const org = (orgsQ.data || []).find((o) => o.id === (p?.organisation_id || p?.org_id))
  const first = (p?.full_name || '').trim().split(/\s+/)[0] || 'USER'
  const name = shortName(p?.full_name)
  const health = useMemo(() => healthScore(h, { minVersion }), [h, minVersion])
  const problems = useMemo(() => problemTimeline(h), [h])
  const devices = (h?.devices || []).filter((d) => !d.revoked)
  const mfaOn = !!h?.mfa?.verified
  const personalRules = (accessQ.data?.modules || []).filter((m) => m.override).length
  const webAreas = (accessQ.data?.modules || []).filter((m) => m.final).length
  const phoneScreens = p ? MOBILE_MODULES.filter((m) => mobileModuleDefaultAllows(m.key, p.role)) : []

  useEffect(() => {
    if (dialog !== 'reminder' || supervisors.length) return
    listPlatformProfiles().then((all) => {
      const orgId = p?.organisation_id || p?.org_id
      setSupervisors((all || []).filter((x) => x.id !== id && (x.organisation_id || x.org_id) === orgId && /supervisor|manager|director/i.test(x.role || '')))
    }).catch(() => setSupervisors([]))
  }, [dialog, supervisors.length, p, id])

  const daily = useMemo(() => {
    const days = Number(range)
    const map = Object.fromEntries((h?.records?.daily_90d || []).map((d) => [d.day, d.n]))
    const out = []
    const today = Date.now()
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = riyadhDay(today - i * 86400000)
      out.push({ label: key.slice(5), value: map[key] || 0 })
    }
    return out
  }, [h, range])
  const busiest = daily.reduce((m, d) => (d.value > (m?.value || 0) ? d : m), null)

  const activity = useMemo(() => {
    const out = []
    if (h?.records?.last_at) out.push({ kind: 'record', group: 'records', at: h.records.last_at, title: 'Wrote an inspection', body: 'Latest record under this name.' })
    for (const r of h?.returned?.recent || []) out.push({ kind: 'returned', group: 'records', at: r.at, title: `Inspection sent back${r.asset_no ? `: ${r.asset_no}` : ''}` })
    if (h?.auth?.last_sign_in_at) out.push({ kind: 'signin', group: 'signins', at: h.auth.last_sign_in_at, title: 'Signed in', body: devices[0] ? `${devices[0].platform || 'Phone'} ${devices[0].device_id || ''}, app ${devices[0].app_version || 'unknown'}` : 'Web' })
    for (const d of h?.devices || []) out.push({ kind: 'device', group: 'signins', at: d.created_at, title: 'Registered a phone', body: `${d.platform || 'Phone'} ${d.device_id || ''}, now on ${d.app_version || 'unknown'}${d.revoked ? ' (revoked)' : ''}` })
    for (const a of auditQ.data || []) out.push({ kind: 'admin', group: 'admin', at: a.at, title: String(a.action || 'Admin change').replace(/_/g, ' '), body: `${a.actor_email ? `By ${a.actor_email.split('@')[0]}` : 'Admin action'}, ${a.reason ? `reason: ${a.reason}` : 'no reason written'}` })
    if (h?.auth?.created_at) out.push({ kind: 'created', group: 'admin', at: h.auth.created_at, title: 'Account created' })
    return out.filter((x) => x.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [h, auditQ.data, devices])

  async function act(fn, success) {
    setBusy(true); setErr('')
    try {
      await fn()
      setNotice(success); setDialog(null)
      profileQ.reload(); healthQ.reload(); auditQ.reload()
    } catch (e) {
      setErr(toUserMessage(e, 'The change could not be applied. Nothing was changed.'))
    } finally { setBusy(false) }
  }

  if (profileQ.loading) return <LoadingState label="Loading person" rows={8} />
  if (profileQ.error) return <ErrorState message={profileQ.error} onRetry={profileQ.reload} />
  if (!p) return <EmptyState icon={Users} title="Person not found" reason="No profile with this id, or you cannot see it." action={<Btn onClick={() => navigate('/console/users')}>Back to Users</Btn>} />

  const locked = !!p.locked
  const deductionsSum = health.deductions.reduce((a, d) => a + d.points, 0)

  const problemsPanel = (
    <Panel flush>
      <div className="px-4 py-3 border-b border-gray-800"><h3 className="text-sm font-semibold text-gray-200">Problems and health <span className="text-[11px] font-normal text-gray-500">From real records, last 30 days</span></h3></div>
      {healthQ.error ? <div className="p-4"><ErrorState message={healthQ.error} onRetry={healthQ.reload} /></div> : healthQ.loading ? <div className="p-4"><LoadingState rows={3} /></div> : (
        <>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
            <HealthRing score={health.score} />
            <div>
              <p className="text-sm font-semibold text-gray-200">{healthLabel(health.score)}</p>
              <p className="text-[11px] text-gray-500">100 minus the deductions below ({deductionsSum}). Weights are a draft for the owner to set; items marked N/A are not counted and are listed so nobody reads them as fine.</p>
              <div className="mt-1"><DecisionTag label="Weights: owner decision" /></div>
            </div>
          </div>
          <ul className="divide-y divide-gray-800">
            {health.deductions.map((d) => (
              <li key={d.key} className="px-4 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-gray-200">{d.label}</p><p className="text-[11px] text-gray-500">{d.detail}</p></div>
                <span className={`text-xs font-semibold tabular-nums ${d.points < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{d.points}</span>
              </li>
            ))}
            {health.na.map((d) => (
              <li key={d.key} className="px-4 py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-gray-200">{d.label}</p><p className="text-[11px] text-gray-500">N/A. {d.detail}</p></div>
                <span className="text-xs text-gray-500">N/A</span>
              </li>
            ))}
            <li className="px-4 py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-gray-200">Problems {first} reported</p><p className="text-[11px] text-gray-500">{h?.issues ? `${h.issues.total} reported, ${h.issues.open} still open (Report a problem).` : 'N/A'}</p></div>
              <span className="text-xs text-gray-400 tabular-nums">{h?.issues?.open ?? 'N/A'}</span>
            </li>
          </ul>
          <div className="px-4 py-3 border-t border-gray-800 flex flex-wrap items-center gap-2">
            <Btn size="xs" icon={MessageSquare} onClick={() => { setReminder({ title: 'Please open your returned work', body: 'Some of your inspections were sent back for correction. Open the app, check the returned list and resubmit.', reason: '', copyTo: '' }); setDialog('reminder') }}>Message {first}</Btn>
            <Btn size="xs" icon={Users} onClick={() => { setReminder({ title: `${name} has returned work to fix`, body: `${name} has inspections returned for correction that are still open. Please follow up.`, reason: '', copyTo: '__supervisor' }); setDialog('reminder') }}>Tell a supervisor</Btn>
            <div className="flex-1" />
            {tab !== 'problems' && <button type="button" onClick={() => setTab('problems')} className="text-[11px] font-semibold text-orange-400 hover:text-orange-300 inline-flex items-center gap-1">Problems tab <ArrowUpRight size={11} /></button>}
          </div>
        </>
      )}
    </Panel>
  )

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-gray-500">
        <Link to="/console/users" className="hover:text-gray-300">Users</Link><ChevronRight size={12} />
        <Link to={`/console/users?role=${encodeURIComponent(p.role || '')}`} className="hover:text-gray-300">{p.role || 'No role'}</Link><ChevronRight size={12} />
        <span className="text-gray-300 font-medium">{name}</span>
      </nav>

      <Panel>
        <div className="flex flex-wrap items-start gap-4">
          <span className="h-14 w-14 rounded-xl bg-orange-950/40 text-orange-300 grid place-items-center text-lg font-bold">{initials(p.full_name)}</span>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-100">{name}</h1>
              <Pill tone={locked ? 'danger' : 'good'}>{locked ? 'Locked' : 'Active'}</Pill>
              <Pill tone={p.approved === false ? 'warning' : 'good'}>{p.approved === false ? 'Waiting for approval' : 'Approved'}</Pill>
              <Pill tone={mfaOn ? 'good' : 'muted'}>{h ? (mfaOn ? '2FA on' : '2FA off') : '2FA N/A'}</Pill>
              <span className="text-[11px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-300">{p.role || 'No role'}{p.is_super_admin ? ' (super)' : ''}</span>
            </div>
            <p className="text-xs text-gray-400">{h?.auth?.email_masked || 'Email hidden'}{p.username ? `, username ${p.username[0]}***` : ''}, {countryLabel(p)}, {sitesLabel(p)}, {org?.name || 'No organization'}, member since {fmtRiyadh(p.created_at, { time: false, year: true }) || 'N/A'}</p>
            <p className="text-[11px] text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
              <span>Last sign-in {h ? (fmtRiyadh(h.auth?.last_sign_in_at) || 'never') : 'N/A'}</span>
              <span>{devices.length} {devices.length === 1 ? 'phone' : 'phones'}{devices[0]?.app_version ? `, app ${devices[0].app_version}` : ''}</span>
              <span>{h ? h.records?.last_30d : 'N/A'} inspections in 30 days</span>
              <span>{accessQ.data ? personalRules : 'N/A'} personal access rules</span>
              <span className={health.score != null && health.score < 65 ? 'text-orange-300 font-semibold' : ''}>Health {health.score ?? 'N/A'}, {healthLabel(health.score).toLowerCase()}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <Btn icon={UserCog} onClick={() => { setRole(p.role || ''); setDialog('role') }}>Change role</Btn>
          <Btn icon={KeyRound} onClick={() => navigate(`/console/access?tab=people&user=${p.id}`)}>Edit access</Btn>
          <Btn icon={LogOut} onClick={() => setDialog('signout')}>Sign out everywhere</Btn>
          <Btn icon={Fingerprint} disabled title={mfaOn ? 'Resetting 2FA from the console is not built yet' : 'Not enrolled, nothing to reset'}>Reset 2FA</Btn>
          <Btn icon={LifeBuoy} onClick={() => setDialog('support')}>Support session</Btn>
          {locked
            ? <Btn icon={Unlock} onClick={() => setDialog('unlock')}>Unlock account</Btn>
            : <Btn icon={Lock} variant="danger" onClick={() => setDialog('lock')} disabled={p.id === admin?.id} title={p.id === admin?.id ? 'You cannot lock your own account' : undefined}>Lock account</Btn>}
        </div>
      </Panel>

      <div className="flex items-start gap-2 text-[11px] text-gray-400 border border-dashed border-gray-800 rounded-lg px-3 py-2">
        <Info size={13} className="mt-0.5 text-gray-500" /><p><span className="font-semibold text-gray-300">Moved here from: </span>Users (edit modal), Sessions and Devices, Support Sessions, Access Control effective access tab. The full editor (profile, country, sites, web access, passwords) stays on Users, Edit and grants.</p>
      </div>

      {notice && <Note tone="accent" icon={Info}>{notice}</Note>}

      <PageTabs value={tab} onChange={setTab} label="Person sections" tabs={[
        { key: 'overview', label: 'Overview', icon: LayoutGrid },
        { key: 'problems', label: 'Problems', icon: HeartPulse, count: h ? problems.length : null, countTone: problems.length ? 'danger' : undefined },
        { key: 'access', label: 'Access', icon: KeyRound },
        { key: 'activity', label: 'Activity', icon: Activity },
        { key: 'devices', label: 'Devices', icon: Smartphone, count: h ? devices.length : null },
        { key: 'audit', label: 'Audit', icon: ScrollText },
      ]} />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.3fr_1fr] gap-4 items-start">
          <div className="space-y-4">
            {problemsPanel}
            <Panel>
              <PanelHeader title="Profile" actions={<Btn size="xs" icon={Pencil} onClick={() => navigate('/console/users?tab=manage')}>Edit</Btn>} />
              <Facts rows={[
                ['Full name', name, '(shown in full to admins on the editor)'],
                ['Role', p.role],
                ['Organization', org?.name],
                ['Country', countryLabel(p)],
                ['Sites', sitesLabel(p)],
                ['Approved', p.approved === false ? 'No' : 'Yes'],
                ['Created', fmtRiyadh(p.created_at, { year: true })],
                ['Phone number', p.phone ? `${String(p.phone).slice(0, 3)}***` : null],
                ['Employee number', p.employee_id],
              ]} />
            </Panel>
            <Panel>
              <PanelHeader title="Sign-in and security" />
              <Facts rows={[
                ['2FA', h ? (mfaOn ? 'On' : `Off. ${p.is_super_admin || p.role === 'Admin' ? 'Required for admins.' : 'Not required for this role.'}`) : 'N/A'],
                ['Last sign-in', h ? (fmtRiyadh(h.auth?.last_sign_in_at, { year: true }) || 'Never') : 'N/A', h?.auth?.last_sign_in_at ? 'Riyadh' : ''],
                ['Failed sign-ins', 'Not recorded per person yet'],
                ['Sessions', devices.length ? `Phone session (last seen ${fmtRiyadh(devices[0].last_seen_at) || 'N/A'})` : 'No phone session'],
                ['Locked', locked ? 'Yes' : 'No'],
                ['Deletion request', h?.deletion_request ? `${h.deletion_request.status}, ${fmtRiyadh(h.deletion_request.requested_at, { year: true })}` : 'None'],
              ]} />
            </Panel>
          </div>
          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Records written" subtitle="Inspections per day" actions={<Segmented role="group" ariaLabel="Chart range" value={range} onChange={setRange} options={[{ key: '7', label: '7D' }, { key: '30', label: '30D' }, { key: '90', label: '90D' }]} />} />
              {healthQ.error ? <ErrorState message={healthQ.error} onRetry={healthQ.reload} /> : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
                    <div><p className="text-[11px] text-gray-500">All time</p><p className="text-lg font-semibold text-gray-100">{h?.records?.all_time ?? 'N/A'}</p></div>
                    <div><p className="text-[11px] text-gray-500">Last 30 days</p><p className="text-lg font-semibold text-gray-100">{h?.records?.last_30d ?? 'N/A'}</p>{h?.records?.role_rank && <p className="text-[11px] text-gray-500">{h.records.role_rank.rank} of {h.records.role_rank.of} {p.role}</p>}</div>
                    <div><p className="text-[11px] text-gray-500">Busiest day</p><p className="text-lg font-semibold text-gray-100">{busiest?.value || 0}</p><p className="text-[11px] text-gray-500">{busiest?.value ? busiest.label : 'N/A'}</p></div>
                    <div><p className="text-[11px] text-gray-500">Last record</p><p className="text-sm font-semibold text-gray-100">{fmtRiyadh(h?.records?.last_at) || 'None'}</p></div>
                  </div>
                  <BarsChart horizontal={false} height={200} bars={daily} summary={`Inspections per day over the last ${range} days`} emptyText="No inspections in this period." />
                  <p className="text-[11px] text-gray-500 mt-2">Counts inspections written under this name (inspections.created_by), in Riyadh days.</p>
                </>
              )}
            </Panel>
            <Panel flush>
              <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-200 flex-1">Activity timeline</h3>
                <Segmented role="group" ariaLabel="Timeline filter" value={actFilter} onChange={setActFilter} options={[{ key: 'all', label: 'All' }, { key: 'records', label: 'Records' }, { key: 'signins', label: 'Sign-ins' }, { key: 'admin', label: 'Admin changes' }]} />
              </div>
              <TimelineList items={activity.filter((a) => actFilter === 'all' || a.group === actFilter).slice(0, 10)} />
              <div className="px-4 py-2 border-t border-gray-800"><button type="button" onClick={() => setTab('activity')} className="text-[11px] font-semibold text-orange-400">Full timeline</button></div>
            </Panel>
          </div>
          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Effective access" subtitle={`${p.role || 'No role'} role, ${personalRules ? `${personalRules} personal rules` : 'no exceptions'}`} />
              <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                <div><p className="text-[11px] text-gray-500">Web areas</p><p className="text-lg font-semibold text-gray-100">{accessQ.data ? webAreas : 'N/A'}</p></div>
                <div><p className="text-[11px] text-gray-500">Phone screens</p><p className="text-lg font-semibold text-gray-100">{phoneScreens.length}</p><p className="text-[11px] text-gray-500">of {MOBILE_MODULES.length}</p></div>
                <div><p className="text-[11px] text-gray-500">Data</p><p className="text-sm font-semibold text-gray-100">{countryLabel(p)}</p><p className="text-[11px] text-gray-500">{sitesLabel(p)}</p></div>
              </div>
              <ul className="flex flex-wrap gap-1.5">{phoneScreens.map((m) => <li key={m.key} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-300">{m.label}</li>)}</ul>
              <p className="text-[11px] text-gray-500 mt-2">Phone screens shown from the role default; personal phone rules are on the Access tab.</p>
            </Panel>
            <Panel>
              <PanelHeader title={`Devices (${devices.length})`} />
              {!devices.length ? <p className="text-xs text-gray-500">No phone registered.</p> : devices.map((d) => (
                <div key={d.id} className="text-xs border-b border-gray-800 last:border-0 py-2">
                  <p className="font-semibold text-gray-200">{d.platform || 'Phone'} {d.device_id || ''}</p>
                  <p className="text-[11px] text-gray-500">App {d.app_version || 'unknown'} {minVersion ? (isBelowMinimum(d.app_version, minVersion) ? '(below the minimum)' : '(meets the minimum)') : ''}, registered {fmtRiyadh(d.created_at, { time: false })}, last seen {fmtRiyadh(d.last_seen_at) || 'N/A'}</p>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 mt-3">
                <Btn size="xs" onClick={() => setDialog('signout')}>Sign out all sessions</Btn>
                <Btn size="xs" icon={BellOff} onClick={() => setDialog('push')} disabled={!devices.some((d) => d.has_push)}>Clear push token</Btn>
              </div>
            </Panel>
            <Panel tone="danger">
              <PanelHeader title="Danger zone" tone="danger" />
              <ul className="divide-y divide-gray-800 text-xs">
                <li className="py-2 flex items-center gap-2"><div className="flex-1"><p className="font-semibold text-gray-200">{locked ? 'Unlock account' : 'Lock account'}</p><p className="text-[11px] text-gray-500">{locked ? 'Sign-in works again with everything as it was.' : 'Stops sign-in on web and phone at once.'}</p></div>
                  {locked ? <Btn size="xs" onClick={() => setDialog('unlock')}>Unlock</Btn> : <Btn size="xs" variant="danger" onClick={() => setDialog('lock')} disabled={p.id === admin?.id}>Lock</Btn>}</li>
                <li className="py-2 flex items-center gap-2"><div className="flex-1"><p className="font-semibold text-gray-200">Sign out everywhere</p><p className="text-[11px] text-gray-500">Ends every session. {first} can sign in again.</p></div><Btn size="xs" onClick={() => setDialog('signout')}>Sign out</Btn></li>
                <li className="py-2 flex items-center gap-2"><div className="flex-1"><p className="font-semibold text-gray-200">Move to another organization</p><p className="text-[11px] text-gray-500">Keeps the records written; done in the full editor with its own confirmation.</p></div><Btn size="xs" onClick={() => navigate('/console/users?tab=manage')}>Open editor</Btn></li>
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'problems' && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr_0.9fr] gap-4 items-start">
          {problemsPanel}
          <div className="space-y-4">
            <Panel flush>
              <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-200 flex-1">Problem timeline <span className="text-[11px] font-normal text-gray-500">Newest first, Riyadh time</span></h3>
                <Segmented role="group" ariaLabel="Problem filter" value={probFilter} onChange={setProbFilter} options={[{ key: 'all', label: 'All' }, { key: 'returned', label: 'Returned' }, { key: 'notice', label: 'Notices' }, { key: 'error', label: 'Errors' }, { key: 'report', label: 'Reported' }]} />
              </div>
              {healthQ.error ? <div className="p-4"><ErrorState message={healthQ.error} onRetry={healthQ.reload} /></div>
                : <TimelineList items={problems.filter((x) => probFilter === 'all' || x.kind === probFilter)} empty="No problems recorded for this person." />}
            </Panel>
            <Panel flush>
              <div className="px-4 py-3 border-b border-gray-800"><h3 className="text-sm font-semibold text-gray-200">Where the problems come from</h3></div>
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead className="text-[11px] text-gray-500"><tr><th className="text-left px-4 py-2">Signal</th><th className="text-left px-2 py-2">Value</th><th className="text-left px-2 py-2">Where it comes from</th></tr></thead>
                <tbody className="divide-y divide-gray-800 text-gray-300">
                  <tr><td className="px-4 py-2">Returned work</td><td className="px-2">{h ? `${h.returned.all_time} (${h.returned.last_30d} in 30 days)` : 'N/A'}</td><td className="px-2 text-gray-500">Inspections, approval status</td></tr>
                  <tr><td className="px-4 py-2">Notices not opened</td><td className="px-2">{h ? `${h.notices.returned_unread} of ${h.notices.returned_total}` : 'N/A'}</td><td className="px-2 text-gray-500">Notifications, read flag</td></tr>
                  <tr><td className="px-4 py-2">Web app errors</td><td className="px-2">{h ? h.errors.web_30d : 'N/A'}</td><td className="px-2 text-gray-500">System logs, user id</td></tr>
                  <tr><td className="px-4 py-2">Problems reported</td><td className="px-2">{h ? `${h.issues.total} (${h.issues.open} open)` : 'N/A'}</td><td className="px-2 text-gray-500">Report a problem (user_issues)</td></tr>
                  <tr><td className="px-4 py-2">Phone crashes</td><td className="px-2">N/A</td><td className="px-2 text-gray-500">Crash tool; the phone app sends no person id yet</td></tr>
                  <tr><td className="px-4 py-2">Stuck offline work</td><td className="px-2">N/A</td><td className="px-2 text-gray-500">The queue lives only on the phone</td></tr>
                </tbody>
              </table></div>
              <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800 flex items-center gap-1"><ShieldCheck size={11} /> Only a person id is sent to crash tools, never a name or email.</p>
            </Panel>
          </div>
          <div className="space-y-4">
            <Panel flush>
              <div className="px-4 py-3 border-b border-gray-800"><h3 className="text-sm font-semibold text-gray-200">Repeat assets <span className="text-[11px] font-normal text-gray-500">{h ? `${h.returned.repeat_assets.length} assets returned at least once` : ''}</span></h3></div>
              {!h ? <p className="p-4 text-xs text-gray-500">N/A</p> : h.returned.repeat_assets.length === 0 ? <p className="p-4 text-xs text-gray-500">No asset was returned.</p> : (
                <ul className="divide-y divide-gray-800">{h.returned.repeat_assets.slice(0, 8).map((a) => (
                  <li key={a.asset_no} className="px-4 py-2 flex items-center text-xs"><div className="flex-1"><p className="font-semibold text-gray-200">{a.asset_no}</p><p className="text-[11px] text-gray-500">Returned {a.n} {a.n === 1 ? 'time' : 'times'}</p></div><span className="tabular-nums text-gray-300">{a.n}</span></li>
                ))}</ul>
              )}
            </Panel>
            <Panel>
              <PanelHeader title="Fix it" />
              <ImpactBox what={h ? `${first} has ${h.notices.returned_unread} return ${h.notices.returned_unread === 1 ? 'notice' : 'notices'} never opened.` : 'Signals not loaded.'}
                change="A message goes to their phone and web bell listing what to fix."
                who={`${name} only. A supervisor gets a copy if you pick one.`}
                undo="A message cannot be unsent; it is logged with your name and the reason." />
              <div className="flex flex-wrap gap-2 mt-3">
                <Btn variant="primary" icon={Send} onClick={() => { setReminder({ title: 'Please open your returned work', body: `You have inspections returned for correction${h?.returned?.repeat_assets?.length ? ` (${h.returned.repeat_assets.slice(0, 4).map((a) => a.asset_no).join(', ')})` : ''}. Open the app, fix them and resubmit.`, reason: '', copyTo: '' }); setDialog('reminder') }}>Send reminder</Btn>
                <Btn onClick={() => setDialog('support')}>Start support session</Btn>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'access' && (
        <Panel>
          <PanelHeader title="Effective access, line by line" subtitle="What this person can open on the web, and why" actions={<Link to={`/console/access?tab=people&user=${p.id}`} className="text-xs text-orange-400 inline-flex items-center gap-1">Edit in Access Control <ArrowUpRight size={11} /></Link>} />
          {accessQ.loading ? <LoadingState rows={5} /> : accessQ.error ? <ErrorState message={accessQ.error} onRetry={accessQ.reload} /> : (
            <>
              <SearchInput value={accessSearch} onChange={setAccessSearch} placeholder="Search areas" className="w-full sm:w-72 mb-3" />
              <div className="overflow-x-auto"><table className="w-full text-xs">
                <thead className="text-[11px] text-gray-500"><tr><th className="text-left px-2 py-1">Area</th><th className="text-left px-2 py-1">Can open</th><th className="text-left px-2 py-1">Why</th></tr></thead>
                <tbody className="divide-y divide-gray-800">
                  {(accessQ.data?.modules || []).filter((m) => !accessSearch || m.key.includes(accessSearch.toLowerCase())).map((m) => (
                    <tr key={m.key}><td className="px-2 py-1.5 text-gray-200 font-mono">{m.key}</td><td className="px-2"><Pill tone={m.final ? 'good' : 'muted'}>{m.final ? 'Yes' : 'No'}</Pill></td><td className="px-2 text-gray-500">{m.reason}{m.override ? ` (personal ${m.override})` : ''}</td></tr>
                  ))}
                </tbody>
              </table></div>
              <h4 className="text-xs font-semibold text-gray-300 mt-4 mb-2">Phone screens ({phoneScreens.length} of {MOBILE_MODULES.length}, role default)</h4>
              <ul className="flex flex-wrap gap-1.5">{MOBILE_MODULES.map((m) => <li key={m.key}><Pill tone={mobileModuleDefaultAllows(m.key, p.role) ? 'good' : 'muted'}>{m.label}</Pill></li>)}</ul>
            </>
          )}
        </Panel>
      )}

      {tab === 'activity' && (
        <Panel flush>
          <div className="px-4 py-3 border-b border-gray-800 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-200 flex-1">Full timeline</h3>
            <Segmented role="group" ariaLabel="Timeline filter" value={actFilter} onChange={setActFilter} options={[{ key: 'all', label: 'All' }, { key: 'records', label: 'Records' }, { key: 'signins', label: 'Sign-ins' }, { key: 'admin', label: 'Admin changes' }]} />
          </div>
          <TimelineList items={activity.filter((a) => actFilter === 'all' || a.group === actFilter)} />
          <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-800">Individual records beyond the latest and the send-backs are counted on Overview; open Inspections filtered by this person to see each one.</p>
        </Panel>
      )}

      {tab === 'devices' && (
        <Panel>
          <PanelHeader title="Phones" subtitle="Every phone this person registered, including revoked ones" />
          {!h ? (healthQ.error ? <ErrorState message={healthQ.error} onRetry={healthQ.reload} /> : <LoadingState rows={3} />) : (h.devices || []).length === 0 ? <EmptyState icon={Smartphone} title="No phones" reason="This person has never registered a phone." /> : (
            <table className="w-full text-xs"><thead className="text-[11px] text-gray-500"><tr><th className="text-left px-2 py-1">Phone</th><th className="text-left px-2 py-1">App</th><th className="text-left px-2 py-1">Registered</th><th className="text-left px-2 py-1">Last seen</th><th className="text-left px-2 py-1">Alerts</th><th className="text-left px-2 py-1">State</th></tr></thead>
              <tbody className="divide-y divide-gray-800">{h.devices.map((d) => (
                <tr key={d.id}><td className="px-2 py-1.5 text-gray-200">{d.platform || 'Phone'} {d.device_id || ''}</td><td className="px-2">{d.app_version || 'unknown'}</td><td className="px-2">{fmtRiyadh(d.created_at, { year: true })}</td><td className="px-2">{fmtRiyadh(d.last_seen_at) || 'N/A'}</td><td className="px-2">{d.has_push ? 'Yes' : 'No'}</td><td className="px-2"><Pill tone={d.revoked ? 'muted' : 'good'}>{d.revoked ? 'Revoked' : 'Active'}</Pill></td></tr>
              ))}</tbody></table>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <Btn size="xs" onClick={() => setDialog('signout')}>Sign out everywhere</Btn>
            <Btn size="xs" icon={BellOff} onClick={() => setDialog('push')} disabled={!devices.some((d) => d.has_push)}>Clear push token</Btn>
          </div>
        </Panel>
      )}

      {tab === 'audit' && (
        <Panel>
          <PanelHeader title="Access audit" subtitle="Every recorded change to this person's role, approval, lock, country, sites and grants" />
          {auditQ.loading ? <LoadingState rows={4} /> : auditQ.error ? <ErrorState message={auditQ.error} onRetry={auditQ.reload} /> : (auditQ.data || []).length === 0 ? <EmptyState title="No changes recorded" reason="No admin has changed this person's access since auditing started." /> : (
            <table className="w-full text-xs"><thead className="text-[11px] text-gray-500"><tr><th className="text-left px-2 py-1">When (Riyadh)</th><th className="text-left px-2 py-1">Change</th><th className="text-left px-2 py-1">By</th><th className="text-left px-2 py-1">Reason</th></tr></thead>
              <tbody className="divide-y divide-gray-800">{auditQ.data.map((a) => (
                <tr key={a.id}><td className="px-2 py-1.5 whitespace-nowrap">{fmtRiyadh(a.at, { year: true })}</td><td className="px-2 text-gray-200">{String(a.action || '').replace(/_/g, ' ')}{a.entity ? ` (${a.entity})` : ''}</td><td className="px-2">{a.actor_email ? `${a.actor_email[0]}***@${a.actor_email.split('@')[1] || ''}` : 'System'}</td><td className="px-2 text-gray-500">{a.reason || 'Not recorded'}</td></tr>
              ))}</tbody></table>
          )}
        </Panel>
      )}

      <ConfirmImpactDialog open={dialog === 'lock'} title={`Lock ${name}`} danger confirmLabel="Lock account" busy={busy} error={err}
        requireReason typedWord={`LOCK ${first.toUpperCase()}`}
        onCancel={() => { setDialog(null); setErr('') }}
        onConfirm={({ reason }) => act(async () => { await setPersonLocked(p.id, true, reason); await logAction?.('lock_user', p.id, 'user', { reason }) }, `${name} is locked.`)}
        impact={{ tone: 'danger', what: `${name} will not be able to sign in on web or phone.`,
          stats: [{ label: 'Inspections kept', value: h?.records?.all_time ?? null }, { label: 'Phones', value: devices.length }, { label: 'Open send-backs', value: h?.returned?.last_30d ?? null }],
          change: 'Sign-in stops at once. Role, sites and every record stay as they are.', who: `${name} only.`, undo: 'Yes. Unlock restores access with everything as it was.' }} />
      <ConfirmImpactDialog open={dialog === 'unlock'} title={`Unlock ${name}`} confirmLabel="Unlock" busy={busy} error={err} requireReason
        onCancel={() => { setDialog(null); setErr('') }}
        onConfirm={({ reason }) => act(async () => { await setPersonLocked(p.id, false, reason); await logAction?.('unlock_user', p.id, 'user', { reason }) }, `${name} can sign in again.`)}
        impact={{ what: `${name} can sign in again.`, change: 'Access returns exactly as it was before the lock.', who: `${name} only.`, undo: 'Yes. Lock again.' }} />
      <ConfirmImpactDialog open={dialog === 'signout'} title={`Sign ${name} out everywhere`} confirmLabel="Sign out everywhere" busy={busy} error={err} requireReason
        onCancel={() => { setDialog(null); setErr('') }}
        onConfirm={({ reason }) => act(async () => { const r = await revokeUserSessions(p.id, { reason }); if (!r.ok) throw new Error(r.error) }, `${name} was signed out everywhere.`)}
        impact={{ what: 'Every web and phone session ends.', change: 'They are asked to sign in again. An access token already issued can stay valid for up to an hour.', who: `${name}, ${devices.length} ${devices.length === 1 ? 'phone' : 'phones'}.`, undo: 'No. They simply sign in again.' }} />
      <ConfirmImpactDialog open={dialog === 'push'} title="Clear push token" confirmLabel="Clear push token" busy={busy} error={err} requireReason
        onCancel={() => { setDialog(null); setErr('') }}
        onConfirm={({ reason }) => act(async () => { await clearPushToken(p.id); await logAction?.('clear_push_token', p.id, 'user', { reason }) }, 'Push token cleared.')}
        impact={{ what: 'Phone alerts to this person stop.', change: 'The stored push token is removed. In-app notifications still arrive.', who: `${name} only.`, undo: 'Yes. The phone registers a new token the next time the app opens.' }} />
      <ConfirmImpactDialog open={dialog === 'role'} title={`Change role for ${name}`} confirmLabel="Change role" busy={busy} error={err} requireReason
        onCancel={() => { setDialog(null); setErr('') }}
        onConfirm={() => { if (!role || role === p.role) { setErr('Pick a different role.'); return } act(() => bulkSetRole([p.id], role), `${name} is now ${role}.`) }}
        impact={{ what: `Role changes from ${p.role || 'none'} to ${role || '(pick one)'}.`, change: 'What they can open follows the new role from their next page load.', who: `${name} only.`, undo: 'Yes. Set the old role again; the audit log keeps it.' }}>
        <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">New role</span>
          <Select value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: r }))} ariaLabel="New role" /></label>
      </ConfirmImpactDialog>

      <Modal open={dialog === 'support'} title="Start a read-only support session" subtitle={`See ${org?.name || 'this organization'}'s data as support, for a set time`} onClose={() => { if (!busy) { setDialog(null); setErr('') } }} width="max-w-lg"
        footer={<><Btn onClick={() => setDialog(null)} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" busy={busy} disabled={support.reason.trim().length < 3 || !org}
            onClick={() => act(async () => { await startSupportSession(org.id, `${support.reason.trim()}${support.ref ? ` (ref ${support.ref.trim()})` : ''} [person: ${p.id}]`, Number(support.minutes) || 30, 'read_only') }, 'Support session started. Both super admins are told and it is audited.')}>Start session</Btn></>}>
        <div className="space-y-3">
          <ImpactBox what="Read only, time boxed, audited."
            change="A support session is recorded for this organization with your reason. Seeing the app exactly as this person is not built yet; the session records the permission."
            who={`${org?.name || 'No organization'}. ${name} is not told.`} undo="It ends by itself when the time box runs out, or end it from Support sessions." />
          <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason</span>
            <input value={support.reason} onChange={(e) => setSupport((s) => ({ ...s, reason: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" placeholder="Why do you need to look?" /></label>
          <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Reference (ticket or report number, optional)</span>
            <input value={support.ref} onChange={(e) => setSupport((s) => ({ ...s, ref: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" /></label>
          <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Time box</span>
            <Select value={String(support.minutes)} onChange={(v) => setSupport((s) => ({ ...s, minutes: Number(v) }))} ariaLabel="Time box" options={[{ value: '15', label: '15 minutes' }, { value: '30', label: '30 minutes' }, { value: '60', label: '60 minutes' }]} /></label>
          {err && <p role="alert" className="text-xs text-red-300">{err}</p>}
        </div>
      </Modal>

      <Modal open={dialog === 'reminder'} title={reminder.copyTo === '__supervisor' ? 'Tell a supervisor' : `Message ${first}`} onClose={() => { if (!busy) { setDialog(null); setErr('') } }} width="max-w-lg"
        footer={<><Btn onClick={() => setDialog(null)} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" icon={Send} busy={busy} disabled={reminder.reason.trim().length < 3 || reminder.title.trim().length < 3 || reminder.body.trim().length < 3 || (reminder.copyTo === '__supervisor')}
            onClick={() => act(async () => {
              const toSup = supervisors.find((s) => s.id === reminder.copyTo)
              await sendPersonReminder(p.id, { title: reminder.title, body: reminder.body, reason: reminder.reason, copyTo: toSup ? toSup.id : null })
            }, 'Message sent. It is in the audit log with your reason.')}>Send</Btn></>}>
        <div className="space-y-3">
          <ImpactBox what="One message in the app bell (web and phone)." change="Nothing else changes." who={`${name}${reminder.copyTo && reminder.copyTo !== '__supervisor' ? ' and the supervisor you picked' : ''}.`} undo="No. A message cannot be unsent; it is logged with your name." />
          <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Copy to a supervisor (optional)</span>
            <Select value={reminder.copyTo === '__supervisor' ? '' : reminder.copyTo} onChange={(v) => setReminder((r) => ({ ...r, copyTo: v }))} placeholder={supervisors.length ? 'No copy' : 'No supervisor in this organization'} ariaLabel="Supervisor"
              options={supervisors.map((s) => ({ value: s.id, label: `${shortName(s.full_name)} (${s.role})` }))} /></label>
          <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Title</span>
            <input value={reminder.title} onChange={(e) => setReminder((r) => ({ ...r, title: e.target.value }))} maxLength={120} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" /></label>
          <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Message</span>
            <textarea value={reminder.body} onChange={(e) => setReminder((r) => ({ ...r, body: e.target.value }))} rows={4} maxLength={1000} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" /></label>
          <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Reason (goes to the audit log)</span>
            <input value={reminder.reason} onChange={(e) => setReminder((r) => ({ ...r, reason: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200" /></label>
          {reminder.copyTo === '__supervisor' && <p className="text-[11px] text-amber-300">Pick the supervisor above.</p>}
          {err && <p role="alert" className="text-xs text-red-300">{err}</p>}
        </div>
      </Modal>
    </div>
  )
}
