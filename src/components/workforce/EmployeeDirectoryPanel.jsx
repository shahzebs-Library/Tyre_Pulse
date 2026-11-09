import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, Network, Download, RefreshCw, AlertTriangle, ShieldAlert, Award, History,
  Plus, Wrench, ClipboardList, Pencil, Save, UserX,
} from 'lucide-react'
import EnterpriseTable from '../ui/EnterpriseTable'
import SideDrawer from '../ui/SideDrawer'
import { workforceErrorText } from '../../lib/workforceErrorText'
import { exportToExcel } from '../../lib/exportUtils'
import { SKILL_CATALOGUE } from '../../lib/technicianScorecard'
import { listSkills } from '../../lib/api/technicianScorecard'
import { NOT_INSTALLED, OPERATIONAL_TABLES } from '../../lib/api/workforceAssignments'
import {
  EMPLOYMENT_STATUSES, listEmployeeRecords, saveEmployeeRecord, listEmployeeHistory, historyDiff,
  listCertifications, addCertification, certificateState, listTaskTypes, saveTaskType, reportingTree,
} from '../../lib/api/workforceEmployees'
import { useLanguage } from '../../contexts/LanguageContext'

/**
 * Employee and team management for the Workforce module.
 *
 * Two different facts live side by side here and must never be confused:
 *   - the ACCOUNT (profiles): who can sign in and what they may open (role = access, not a job);
 *   - the EMPLOYEE RECORD (workforce_employees): designation, reporting line, sites, availability.
 * An account with no employee record is flagged as such, never given an invented designation.
 *
 * Visibility follows RLS: managers see everyone; anyone else sees their own record and the people
 * who report to them, so a missing record for somebody else is "not visible", not "missing".
 */

export const NOT_RECORDED = 'Not recorded'
const STATUS_KEY = { active: 'workforce.directory.statusActive', temporarily_unavailable: 'workforce.directory.statusTemporarilyUnavailable', inactive: 'workforce.directory.statusInactive' }
const CERT_KEY = { valid: 'workforce.directory.certValid', expiring: 'workforce.directory.certExpiring', expired: 'workforce.directory.certExpired', not_yet_valid: 'workforce.directory.certNotYetValid' }
const statusLabelOf = (t, s) => (STATUS_KEY[s] ? t(STATUS_KEY[s]) : s)
const CERT_TONE = {
  valid: 'bg-green-500/15 text-green-600',
  expiring: 'bg-amber-500/15 text-amber-600',
  expired: 'bg-red-500/15 text-red-600',
  not_yet_valid: 'bg-slate-500/15 text-[var(--text-muted)]',
}
const FIELD_KEYS = new Set(['employee_code', 'designation', 'department', 'team', 'supervisor_id', 'sites', 'employment_status', 'unavailable_until', 'shift_start', 'shift_end', 'responsibilities', 'escalation_contact'])
const fieldLabelOf = (t, f) => (FIELD_KEYS.has(f) ? t(`workforce.directory.field.${f}`) : f)
const SKILL_NAME = new Map(SKILL_CATALOGUE.map(s => [s.skill_id, s.name]))

/** Local calendar day (YYYY-MM-DD). toISOString() would roll the day back east of UTC. */
export function localDay (d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const accountName = p => p?.full_name || p?.username || null
const timeShort = t => (t ? String(t).slice(0, 5) : null)

/** Pure: certificate counts per state for one person. */
export function certSummary (certs, today) {
  const out = { valid: 0, expiring: 0, expired: 0, not_yet_valid: 0, total: 0 }
  for (const c of certs || []) { out[certificateState(c, today)] += 1; out.total += 1 }
  return out
}

/**
 * Pure: join the account directory with employee records, certificates and skills.
 * `visibleAll` false (non-manager) keeps only rows the viewer can actually see a record for, plus self.
 */
export function buildDirectoryRows ({ profiles = [], records = [], certs = [], skills = null, today, visibleAll = true, currentUserId = null }) {
  const recById = new Map(records.map(r => [r.profile_id, r]))
  const profById = new Map(profiles.map(p => [p.id, p]))
  const certsBy = new Map()
  for (const c of certs) { if (!certsBy.has(c.profile_id)) certsBy.set(c.profile_id, []); certsBy.get(c.profile_id).push(c) }
  const skillsBy = new Map()
  for (const s of skills || []) { if (!skillsBy.has(s.user_id)) skillsBy.set(s.user_id, new Set()); skillsBy.get(s.user_id).add(s.skill_id) }
  const nameOf = id => accountName(profById.get(id)) || (id ? 'Account not in active directory' : null)

  const ids = new Set(profiles.map(p => p.id))
  for (const r of records) ids.add(r.profile_id)
  const rows = []
  for (const id of ids) {
    const p = profById.get(id)
    const r = recById.get(id) || null
    if (!visibleAll && !r && id !== currentUserId) continue
    const cs = certSummary(certsBy.get(id), today)
    rows.push({
      id,
      name: accountName(p) || 'Account not in active directory',
      account_active: !!p,
      account_role: p?.role || null,
      employee_id: r?.employee_code || p?.employee_id || null,
      has_record: !!r,
      designation: r?.designation || null,
      department: r?.department || null,
      team: r?.team || null,
      supervisor_id: r?.supervisor_id || null,
      supervisor_name: r?.supervisor_id ? nameOf(r.supervisor_id) : null,
      sites: r?.sites?.length ? r.sites : (p?.site ? [p.site] : []),
      sites_from_record: !!r?.sites?.length,
      employment_status: r?.employment_status || null,
      unavailable_until: r?.unavailable_until || null,
      shift: r && (r.shift_start || r.shift_end) ? `${timeShort(r.shift_start) || '?'} to ${timeShort(r.shift_end) || '?'}` : null,
      cert: cs,
      skill_count: skills ? (skillsBy.get(id)?.size || 0) : null,
      record: r,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/** Pure: apply the directory filters. */
export function filterDirectory (rows, f = {}) {
  const term = String(f.search || '').trim().toLocaleLowerCase()
  return rows.filter(r => {
    if (f.department && f.department !== 'all' && r.department !== f.department) return false
    if (f.team && f.team !== 'all' && r.team !== f.team) return false
    if (f.status && f.status !== 'all') {
      if (f.status === 'no_record') { if (r.has_record) return false } else if (r.employment_status !== f.status) return false
    }
    if (f.site && f.site !== 'all' && !r.sites.includes(f.site) && !r.sites.includes('ALL')) return false
    if (f.flag === 'missing' && r.has_record) return false
    if (f.flag === 'expired' && !r.cert.expired) return false
    if (f.flag === 'expiring' && !r.cert.expiring) return false
    if (!term) return true
    return [r.name, r.employee_id, r.designation, r.department, r.team, r.supervisor_name, r.account_role, ...r.sites]
      .some(v => String(v || '').toLocaleLowerCase().includes(term))
  })
}

/**
 * Pure: team hierarchy. Roots are people who supervise others but report to nobody we can see.
 * Every walk carries a visited set so a corrupted reporting line can never recurse forever;
 * people stuck in a loop are returned in `loops`.
 */
export function buildHierarchy (records) {
  const bySup = new Map()
  const recIds = new Set(records.map(r => r.profile_id))
  for (const r of records) {
    if (!r.supervisor_id) continue
    if (!bySup.has(r.supervisor_id)) bySup.set(r.supervisor_id, [])
    bySup.get(r.supervisor_id).push(r.profile_id)
  }
  const supOf = new Map(records.map(r => [r.profile_id, r.supervisor_id || null]))
  const roots = []
  for (const sup of bySup.keys()) {
    const parent = supOf.get(sup)
    if (!recIds.has(sup) || !parent) roots.push(sup)
  }
  const reached = new Set()
  const walk = (id, seen) => {
    reached.add(id)
    const kids = (bySup.get(id) || []).map(child => {
      if (seen.has(child)) return { id: child, loop: true, children: [] }
      return walk(child, new Set([...seen, child]))
    })
    return { id, loop: false, children: kids, direct: (bySup.get(id) || []).length, indirect: Math.max(0, reportingTree(records, id).length - (bySup.get(id) || []).length) }
  }
  const tree = roots.map(id => walk(id, new Set([id])))
  const loops = records.filter(r => r.supervisor_id && !reached.has(r.profile_id)).map(r => r.profile_id)
  const unassigned = records.filter(r => !r.supervisor_id && !bySup.has(r.profile_id)).map(r => r.profile_id)
  return { tree, loops, unassigned }
}

const blankForm = (profileId, rec) => ({
  profile_id: profileId,
  employee_code: rec?.employee_code || '',
  designation: rec?.designation || '',
  department: rec?.department || '',
  team: rec?.team || '',
  supervisor_id: rec?.supervisor_id || '',
  sites: rec?.sites ? [...rec.sites] : [],
  employment_status: rec?.employment_status || 'active',
  unavailable_until: rec?.unavailable_until || '',
  shift_start: timeShort(rec?.shift_start) || '',
  shift_end: timeShort(rec?.shift_end) || '',
  responsibilities: rec?.responsibilities || '',
  escalation_contact: rec?.escalation_contact || '',
})

function Badge ({ className = '', children }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}

function Labeled ({ id, label, children, hint }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-[var(--text-muted)]">{label}</label>
      {children}
      {hint && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  )
}

function CertCell ({ cert }) {
  const { t } = useLanguage()
  if (!cert.total) return <span className="text-xs text-[var(--text-muted)]">{t('workforce.directory.notRecorded')}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {cert.expired > 0 && <Badge className={CERT_TONE.expired}>{t('workforce.directory.badgeExpired', { count: cert.expired })}</Badge>}
      {cert.expiring > 0 && <Badge className={CERT_TONE.expiring}>{t('workforce.directory.badgeExpiring', { count: cert.expiring })}</Badge>}
      {cert.valid > 0 && <Badge className={CERT_TONE.valid}>{t('workforce.directory.badgeValid', { count: cert.valid })}</Badge>}
      {cert.not_yet_valid > 0 && <Badge className={CERT_TONE.not_yet_valid}>{t('workforce.directory.badgeNotYetValid', { count: cert.not_yet_valid })}</Badge>}
    </span>
  )
}

function HierarchyNode ({ node, nameOf, depth = 0 }) {
  const { t } = useLanguage()
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm" style={{ paddingInlineStart: depth * 16 }}>
        <span className="font-medium">{nameOf(node.id)}</span>
        {node.loop
          ? <Badge className={CERT_TONE.expired}>{t('workforce.directory.reportingLoop')}</Badge>
          : node.direct > 0 && <span className="text-xs text-[var(--text-muted)]">{t('workforce.directory.directIndirect', { direct: node.direct, indirect: node.indirect })}</span>}
      </div>
      {node.children?.length > 0 && (
        <ul className="space-y-1">{node.children.map(c => <HierarchyNode key={c.id} node={c} nameOf={nameOf} depth={depth + 1} />)}</ul>
      )}
    </li>
  )
}

export default function EmployeeDirectoryPanel ({ profiles = [], isManager = false, currentUserId = null }) {
  const { t } = useLanguage()
  const NR = t('workforce.directory.notRecorded')
  const NA = t('workforce.directory.notAvailable')
  const [records, setRecords] = useState([])
  const [certs, setCerts] = useState([])
  const [skills, setSkills] = useState(null)
  const [skillsError, setSkillsError] = useState(null)
  const [certError, setCertError] = useState(null)
  const [taskTypes, setTaskTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notInstalled, setNotInstalled] = useState(false)
  const [view, setView] = useState('directory')
  const [filters, setFilters] = useState({ search: '', department: 'all', team: 'all', status: 'all', site: 'all', flag: 'all' })
  const [openId, setOpenId] = useState(null)
  const [notice, setNotice] = useState(null)
  const today = localDay()

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotInstalled(false); setCertError(null); setSkillsError(null)
    try {
      const [recs, tts] = await Promise.all([listEmployeeRecords(), listTaskTypes()])
      setRecords(recs || []); setTaskTypes(tts || [])
      // Certificates and skills are supporting facts; a failed read is stated, not shown as "none".
      const [c, s] = await Promise.allSettled([listCertifications(), listSkills()])
      if (c.status === 'fulfilled') setCerts(c.value || [])
      else { setCerts([]); setCertError(workforceErrorText(c.reason, t, t('workforce.directory.certsReadFailed'))) }
      if (s.status === 'fulfilled') setSkills(s.value || [])
      else { setSkills(null); setSkillsError(workforceErrorText(s.reason, t, t('workforce.directory.skillsReadFailed'))) }
    } catch (e) {
      if (e?.message === NOT_INSTALLED) setNotInstalled(true)
      else setError(workforceErrorText(e, t, t('workforce.directory.loadFailed')))
    } finally { setLoading(false) }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t only labels fallback messages
  }, [])

  useEffect(() => { load() }, [load])

  const profById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])
  const nameOf = useCallback(id => accountName(profById.get(id)) || t('workforce.directory.accountNotInDirectory'), [profById, t])

  const rows = useMemo(() => buildDirectoryRows({
    profiles, records, certs, skills, today, visibleAll: isManager, currentUserId,
  }), [profiles, records, certs, skills, today, isManager, currentUserId])
  const filtered = useMemo(() => filterDirectory(rows, filters), [rows, filters])

  const options = useMemo(() => {
    const uniq = key => [...new Set(rows.map(r => r[key]).filter(Boolean))].sort()
    return { departments: uniq('department'), teams: uniq('team'), sites: [...new Set(rows.flatMap(r => r.sites))].filter(Boolean).sort() }
  }, [rows])
  const stats = useMemo(() => ({
    total: rows.length,
    missing: rows.filter(r => !r.has_record).length,
    unavailable: rows.filter(r => r.employment_status === 'temporarily_unavailable').length,
    expired: rows.filter(r => r.cert.expired > 0).length,
    expiring: rows.filter(r => r.cert.expiring > 0).length,
  }), [rows])
  const hierarchy = useMemo(() => buildHierarchy(records), [records])

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const openRow = rows.find(r => r.id === openId) || null

  const exportDirectory = async () => {
    const out = filtered.map(r => ({
      name: r.name,
      employee_id: r.employee_id || NR,
      designation: r.has_record ? r.designation : t('workforce.directory.noEmployeeRecord'),
      department: r.department || NR,
      team: r.team || NR,
      supervisor: r.supervisor_name || NR,
      sites: r.sites.join(', ') || NR,
      status: r.has_record ? statusLabelOf(t, r.employment_status) : t('workforce.directory.noEmployeeRecord'),
      unavailable_until: r.unavailable_until || '',
      shift: r.shift || NR,
      certs_valid: r.cert.valid, certs_expiring: r.cert.expiring, certs_expired: r.cert.expired,
      skills: r.skill_count == null ? NA : r.skill_count,
      account_role: r.account_role || NR,
    }))
    try {
      await exportToExcel(out,
        ['name', 'employee_id', 'designation', 'department', 'team', 'supervisor', 'sites', 'status', 'unavailable_until', 'shift', 'certs_valid', 'certs_expiring', 'certs_expired', 'skills', 'account_role'],
        ['hName', 'hEmployeeId', 'hDesignation', 'hDepartment', 'hTeam', 'hSupervisor', 'hSites', 'hEmploymentStatus', 'hUnavailableUntil', 'hShift', 'hCertsValid', 'hCertsExpiring', 'hCertsExpired', 'hSkills', 'hAccountRole'].map(k => t(`workforce.directory.${k}`)),
        t('workforce.directory.exportTitle'), t('workforce.directory.exportSheet'), { title: t('workforce.directory.exportTitle') })
    } catch (e) { setError(workforceErrorText(e, t, t('workforce.directory.exportFailed'))) }
  }

  const columns = useMemo(() => [
    {
      id: 'name', header: t('workforce.directory.colEmployee'), accessorFn: r => r.name, size: 220,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="text-xs text-[var(--text-muted)]">{row.original.employee_id ? t('workforce.directory.idValue', { id: row.original.employee_id }) : t('workforce.directory.idNotRecorded')}</div>
          {!row.original.account_active && <div className="text-xs text-amber-600">{t('workforce.directory.accountNotActive')}</div>}
        </div>
      ),
    },
    {
      id: 'designation', header: t('workforce.directory.colDesignation'), accessorFn: r => r.designation || '', size: 190,
      cell: ({ row }) => row.original.has_record
        ? row.original.designation
        : <Badge className={CERT_TONE.expiring}><UserX size={12} className="me-1" />{t('workforce.directory.noEmployeeRecord')}</Badge>,
    },
    { id: 'department', header: t('workforce.directory.colDepartmentTeam'), accessorFn: r => [r.department, r.team].filter(Boolean).join(' / '), size: 180, cell: ({ getValue }) => getValue() || <span className="text-xs text-[var(--text-muted)]">{NR}</span> },
    { id: 'supervisor', header: t('workforce.directory.colSupervisor'), accessorFn: r => r.supervisor_name || '', size: 160, cell: ({ getValue }) => getValue() || <span className="text-xs text-[var(--text-muted)]">{NR}</span> },
    {
      id: 'sites', header: t('workforce.directory.colSites'), accessorFn: r => r.sites.join(', '), size: 150,
      cell: ({ row }) => row.original.sites.length
        ? <span title={row.original.sites_from_record ? t('workforce.directory.sitesFromRecord') : t('workforce.directory.sitesFromAccount')}>{row.original.sites.join(', ')}</span>
        : <span className="text-xs text-[var(--text-muted)]">{NR}</span>,
    },
    {
      id: 'status', header: t('workforce.directory.colStatus'), accessorFn: r => r.employment_status || '', size: 170,
      cell: ({ row }) => {
        const r = row.original
        if (!r.has_record) return <span className="text-xs text-[var(--text-muted)]">{NR}</span>
        return (
          <div>
            <div>{statusLabelOf(t, r.employment_status)}</div>
            {r.employment_status === 'temporarily_unavailable' && <div className="text-xs text-[var(--text-muted)]">{r.unavailable_until ? t('workforce.directory.until', { date: r.unavailable_until }) : t('workforce.directory.returnDateNotRecorded')}</div>}
          </div>
        )
      },
    },
    { id: 'shift', header: t('workforce.directory.colShift'), accessorFn: r => r.shift || '', size: 120, cell: ({ getValue }) => getValue() || <span className="text-xs text-[var(--text-muted)]">{NR}</span> },
    { id: 'certs', header: t('workforce.directory.colCertificates'), accessorFn: r => r.cert.expired * 1000 + r.cert.expiring, size: 170, cell: ({ row }) => certError ? <span className="text-xs text-[var(--text-muted)]">{NA}</span> : <CertCell cert={row.original.cert} /> },
    { id: 'skills', header: t('workforce.directory.colSkills'), accessorFn: r => r.skill_count ?? -1, size: 90, cell: ({ row }) => row.original.skill_count == null ? <span className="text-xs text-[var(--text-muted)]">{NA}</span> : row.original.skill_count },
    {
      id: 'actions', header: '', size: 90, enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" className="btn-secondary" onClick={e => { e.stopPropagation(); setOpenId(row.original.id) }}
          aria-label={t('workforce.directory.rowActionLabel', { action: isManager ? t('workforce.directory.edit') : t('workforce.directory.view'), name: row.original.name })}>
          {isManager ? (row.original.has_record ? t('workforce.directory.edit') : t('workforce.directory.create')) : t('workforce.directory.view')}
        </button>
      ),
    },
  ], [isManager, certError, t, NR, NA])

  if (notInstalled) {
    return (
      <div className="card space-y-2" role="status">
        <h2 className="font-semibold flex items-center gap-2"><Users size={18} />{t('workforce.directory.heading')}</h2>
        <p className="text-sm">{t('workforce.directory.notInstalled', { message: NOT_INSTALLED })}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold flex items-center gap-2"><Users size={18} />{t('workforce.directory.heading')}</h2>
          <div className="ms-auto flex flex-wrap gap-2">
            <button type="button" className={view === 'directory' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('directory')}>{t('workforce.directory.tabDirectory')}</button>
            <button type="button" className={view === 'hierarchy' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('hierarchy')}><Network size={15} className="inline me-1" />{t('workforce.directory.tabHierarchy')}</button>
            {isManager && <button type="button" className={view === 'tasks' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('tasks')}><ClipboardList size={15} className="inline me-1" />{t('workforce.directory.tabTasks')}</button>}
            <button type="button" className="btn-secondary" onClick={exportDirectory} disabled={loading || !filtered.length}><Download size={15} className="inline me-1" />{t('workforce.directory.export')}</button>
            <button type="button" className="btn-secondary" onClick={load} aria-label={t('workforce.directory.refreshLabel')}><RefreshCw size={15} /></button>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {t('workforce.directory.roleNote')}
          {!isManager && ` ${t('workforce.directory.ownRecordNote')}`}
        </p>
        {notice && <div role="status" className="text-sm text-green-600">{notice}</div>}
        {error && (
          <div role="alert" className="flex items-center gap-2 text-sm text-red-500">
            <AlertTriangle size={16} />{error}
            <button type="button" className="btn-secondary ms-auto" onClick={load}>{t('workforce.directory.retry')}</button>
          </div>
        )}
        {certError && <p className="text-xs text-amber-600" role="status">{t('workforce.directory.certsFailedNote', { error: certError })}</p>}
        {skillsError && <p className="text-xs text-amber-600" role="status">{t('workforce.directory.skillsFailedNote')}</p>}
        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Stat label={t('workforce.directory.statPeople')} value={stats.total} />
            <Stat label={t('workforce.directory.statNoRecord')} value={stats.missing} onClick={() => { setView('directory'); setFilter('flag', 'missing') }} />
            <Stat label={t('workforce.directory.statUnavailable')} value={stats.unavailable} onClick={() => { setView('directory'); setFilter('status', 'temporarily_unavailable') }} />
            <Stat label={t('workforce.directory.statCertExpired')} value={certError ? 'N/A' : stats.expired} onClick={certError ? null : () => { setView('directory'); setFilter('flag', 'expired') }} />
            <Stat label={t('workforce.directory.statCertExpiring')} value={certError ? 'N/A' : stats.expiring} onClick={certError ? null : () => { setView('directory'); setFilter('flag', 'expiring') }} />
          </div>
        )}
      </div>

      {view === 'directory' && (
        <div className="card space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <Labeled id="emp-search" label={t('workforce.directory.search')}>
              <input id="emp-search" className="input" value={filters.search} placeholder={t('workforce.directory.searchPlaceholder')}
                onChange={e => setFilter('search', e.target.value)} />
            </Labeled>
            <FilterSelect id="emp-dept" label={t('workforce.directory.department')} value={filters.department} onChange={v => setFilter('department', v)} options={options.departments} />
            <FilterSelect id="emp-team" label={t('workforce.directory.team')} value={filters.team} onChange={v => setFilter('team', v)} options={options.teams} />
            <Labeled id="emp-status" label={t('workforce.directory.status')}>
              <select id="emp-status" className="input" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
                <option value="all">{t('workforce.directory.all')}</option>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{statusLabelOf(t, s)}</option>)}
                <option value="no_record">{t('workforce.directory.noEmployeeRecord')}</option>
              </select>
            </Labeled>
            <FilterSelect id="emp-site" label={t('workforce.directory.site')} value={filters.site} onChange={v => setFilter('site', v)} options={options.sites} />
            <Labeled id="emp-flag" label={t('workforce.directory.show')}>
              <select id="emp-flag" className="input" value={filters.flag} onChange={e => setFilter('flag', e.target.value)}>
                <option value="all">{t('workforce.directory.everyone')}</option>
                <option value="missing">{t('workforce.directory.missingRecord')}</option>
                <option value="expired">{t('workforce.directory.statCertExpired')}</option>
                <option value="expiring">{t('workforce.directory.statCertExpiring')}</option>
              </select>
            </Labeled>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span data-testid="directory-count">{t('workforce.directory.showing', { shown: filtered.length, total: rows.length })}</span>
            {Object.entries(filters).some(([k, v]) => k === 'search' ? v : v !== 'all') && (
              <button type="button" className="btn-secondary" onClick={() => setFilters({ search: '', department: 'all', team: 'all', status: 'all', site: 'all', flag: 'all' })}>{t('workforce.directory.clearFilters')}</button>
            )}
          </div>
          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={r => r.id}
            loading={loading}
            error={error}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            onRowClick={r => r && setOpenId(r.id)}
            resetPageKey={JSON.stringify(filters)}
            emptyMessage={rows.length ? t('workforce.directory.noMatch') : t('workforce.directory.noAccounts')}
          />
        </div>
      )}

      {view === 'hierarchy' && (
        <div className="card space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Network size={16} />{t('workforce.directory.reportingLines')}</h3>
          {loading ? <p className="text-sm text-[var(--text-muted)]">{t('workforce.directory.loading')}</p> : (
            <>
              {hierarchy.tree.length === 0
                ? <p className="text-sm text-[var(--text-muted)]">{t('workforce.directory.noReportingLines')}</p>
                : <ul className="space-y-2" data-testid="hierarchy-tree">{hierarchy.tree.map(n => <HierarchyNode key={n.id} node={n} nameOf={nameOf} />)}</ul>}
              {hierarchy.loops.length > 0 && (
                <div role="alert" className="text-sm text-red-500">
                  <ShieldAlert size={15} className="inline me-1" />{t('workforce.directory.loopAlert', { names: hierarchy.loops.map(nameOf).join(', ') })}
                </div>
              )}
              <section data-testid="hierarchy-unassigned">
                <h4 className="text-sm font-semibold">{t('workforce.directory.noSupervisor', { count: hierarchy.unassigned.length })}</h4>
                {hierarchy.unassigned.length
                  ? <p className="text-sm">{hierarchy.unassigned.map(nameOf).join(', ')}</p>
                  : <p className="text-xs text-[var(--text-muted)]">{t('workforce.directory.everyoneHasSupervisor')}</p>}
              </section>
              {isManager && stats.missing > 0 && <p className="text-xs text-[var(--text-muted)]">{t('workforce.directory.missingCount', { count: stats.missing })}</p>}
            </>
          )}
        </div>
      )}

      {view === 'tasks' && isManager && (
        <TaskRequirements taskTypes={taskTypes} onSaved={async () => { setTaskTypes(await listTaskTypes()); setNotice(t('workforce.directory.taskSaved')) }} />
      )}

      <EmployeeDrawer
        row={openRow}
        open={!!openRow}
        onClose={() => setOpenId(null)}
        isManager={isManager}
        profiles={profiles}
        nameOf={nameOf}
        certs={certs.filter(c => c.profile_id === openId)}
        certError={certError}
        skills={skills ? skills.filter(s => s.user_id === openId) : null}
        today={today}
        onSaved={async (text) => { setNotice(text); await load() }}
      />
    </div>
  )
}

function Stat ({ label, value, onClick }) {
  const body = <><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="text-xl font-bold tabular-nums">{value}</div></>
  return onClick
    ? <button type="button" className="rounded-lg border border-[var(--input-border)] p-2 text-start" onClick={onClick}>{body}</button>
    : <div className="rounded-lg border border-[var(--input-border)] p-2">{body}</div>
}

function FilterSelect ({ id, label, value, onChange, options }) {
  const { t } = useLanguage()
  return (
    <Labeled id={id} label={label}>
      <select id={id} className="input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="all">{t('workforce.directory.all')}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </Labeled>
  )
}

function EmployeeDrawer ({ row, open, onClose, isManager, profiles, nameOf, certs, certError, skills, today, onSaved }) {
  const { t } = useLanguage()
  const NR = t('workforce.directory.notRecorded')
  const [tab, setTab] = useState('details')
  const [form, setForm] = useState(null)
  const [siteInput, setSiteInput] = useState('')
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [certForm, setCertForm] = useState({ cert_type: '', cert_number: '', issued_on: '', expires_on: '' })
  const [certFormError, setCertFormError] = useState(null)

  const rowId = row?.id
  useEffect(() => {
    if (!rowId) return
    setTab('details'); setForm(blankForm(rowId, row.record)); setFormError(null); setHistory(null); setHistoryError(null)
    setSiteInput(''); setCertForm({ cert_type: '', cert_number: '', issued_on: '', expires_on: '' }); setCertFormError(null)
  // Reset only when a different person is opened, never on a background reload of the same person.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId])

  useEffect(() => {
    if (tab !== 'history' || !rowId || history) return
    let live = true
    listEmployeeHistory(rowId).then(h => { if (live) setHistory(h || []) }).catch(e => { if (live) setHistoryError(workforceErrorText(e, t, t('workforce.directory.historyFailed'))) })
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t only labels the fallback message
  }, [tab, rowId, history])

  if (!row || !form) return null
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const addSite = () => {
    const s = siteInput.trim().toUpperCase()
    if (s && !form.sites.includes(s)) set('sites', [...form.sites, s])
    setSiteInput('')
  }

  const save = async e => {
    e.preventDefault()
    setFormError(null); setBusy(true)
    try {
      await saveEmployeeRecord(form, { exists: row.has_record })
      await onSaved(row.has_record ? t('workforce.directory.recordUpdated') : t('workforce.directory.recordCreated'))
      onClose()
    } catch (err) { setFormError(workforceErrorText(err, t, t('workforce.directory.saveFailed'))) } finally { setBusy(false) }
  }

  const saveCert = async e => {
    e.preventDefault()
    setCertFormError(null); setBusy(true)
    try {
      await addCertification({ profile_id: row.id, ...certForm })
      setCertForm({ cert_type: '', cert_number: '', issued_on: '', expires_on: '' })
      await onSaved(t('workforce.directory.certRecorded'))
    } catch (err) { setCertFormError(workforceErrorText(err, t, t('workforce.directory.certFailed'))) } finally { setBusy(false) }
  }

  const fmtValue = (field, v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return NR
    if (field === 'supervisor_id') return nameOf(v)
    if (field === 'employment_status') return statusLabelOf(t, v)
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  }
  const editable = isManager
  const supervisorOptions = profiles.filter(p => p.id !== row.id).sort((a, b) => String(accountName(a) || '').localeCompare(String(accountName(b) || '')))
  const tabs = [['details', t('workforce.directory.tabDetails'), Pencil], ['history', t('workforce.directory.tabHistory'), History], ['certs', t('workforce.directory.tabCerts'), Award], ['skills', t('workforce.directory.tabSkills'), Wrench]]

  return (
    <SideDrawer open={open} onClose={onClose} busy={busy} size="lg"
      title={row.name}
      subtitle={row.has_record ? row.designation : t('workforce.directory.noRecordYet')}>
      <div className="flex flex-wrap gap-2 mb-3" role="tablist">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>
            <Icon size={14} className="inline me-1" />{label}
          </button>
        ))}
      </div>

      {tab === 'details' && (editable ? (
        <form className="space-y-3" onSubmit={save} noValidate>
          {!row.has_record && <p className="text-sm text-amber-600">{t('workforce.directory.noRecordCreate')}</p>}
          {formError && <div role="alert" className="text-sm text-red-500 flex items-center gap-2"><AlertTriangle size={15} />{formError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Labeled id="ed-designation" label={t('workforce.directory.designationRequired')}>
              <input id="ed-designation" className="input" value={form.designation} maxLength={120} aria-invalid={/designation/i.test(formError || '')} onChange={e => set('designation', e.target.value)} />
            </Labeled>
            <Labeled id="ed-code" label={t('workforce.directory.employeeCode')}><input id="ed-code" className="input" value={form.employee_code} maxLength={40} onChange={e => set('employee_code', e.target.value)} /></Labeled>
            <Labeled id="ed-dept" label={t('workforce.directory.department')}><input id="ed-dept" className="input" value={form.department} maxLength={120} onChange={e => set('department', e.target.value)} /></Labeled>
            <Labeled id="ed-team" label={t('workforce.directory.team')}><input id="ed-team" className="input" value={form.team} maxLength={120} onChange={e => set('team', e.target.value)} /></Labeled>
            <Labeled id="ed-sup" label={t('workforce.directory.supervisor')} hint={t('workforce.directory.supervisorHint')}>
              <select id="ed-sup" className="input" value={form.supervisor_id} onChange={e => set('supervisor_id', e.target.value)}>
                <option value="">{t('workforce.directory.noSupervisorOption')}</option>
                {supervisorOptions.map(p => <option key={p.id} value={p.id}>{accountName(p) || t('workforce.directory.unnamedAccount')}{p.employee_id ? ` (${p.employee_id})` : ''}</option>)}
              </select>
            </Labeled>
            <Labeled id="ed-status" label={t('workforce.directory.employmentStatus')}>
              <select id="ed-status" className="input" value={form.employment_status} onChange={e => set('employment_status', e.target.value)}>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{statusLabelOf(t, s)}</option>)}
              </select>
            </Labeled>
            {form.employment_status === 'temporarily_unavailable' && (
              <Labeled id="ed-until" label={t('workforce.directory.unavailableUntil')} hint={t('workforce.directory.unavailableHint')}>
                <input id="ed-until" className="input" type="date" value={form.unavailable_until} onChange={e => set('unavailable_until', e.target.value)} />
              </Labeled>
            )}
            <Labeled id="ed-shift-start" label={t('workforce.directory.shiftStart')}><input id="ed-shift-start" className="input" type="time" value={form.shift_start} onChange={e => set('shift_start', e.target.value)} /></Labeled>
            <Labeled id="ed-shift-end" label={t('workforce.directory.shiftEnd')}><input id="ed-shift-end" className="input" type="time" value={form.shift_end} onChange={e => set('shift_end', e.target.value)} /></Labeled>
          </div>
          <Labeled id="ed-site" label={t('workforce.directory.sites')} hint={t('workforce.directory.sitesHint')}>
            <div className="flex gap-2">
              <input id="ed-site" className="input" value={siteInput} onChange={e => setSiteInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSite() } }} placeholder={t('workforce.directory.siteCode')} />
              <button type="button" className="btn-secondary" onClick={addSite}><Plus size={14} className="inline" /> {t('workforce.directory.add')}</button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {form.sites.length === 0 && <span className="text-xs text-[var(--text-muted)]">{t('workforce.directory.noSites')}</span>}
              {form.sites.map(s => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full border border-[var(--input-border)] px-2 py-0.5 text-xs">
                  {s}<button type="button" aria-label={t('workforce.directory.removeSite', { site: s })} onClick={() => set('sites', form.sites.filter(x => x !== s))}>x</button>
                </span>
              ))}
            </div>
          </Labeled>
          <Labeled id="ed-resp" label={t('workforce.directory.responsibilities')}><textarea id="ed-resp" className="input" rows={3} maxLength={4000} value={form.responsibilities} onChange={e => set('responsibilities', e.target.value)} /></Labeled>
          <Labeled id="ed-esc" label={t('workforce.directory.escalationContact')}><input id="ed-esc" className="input" maxLength={200} value={form.escalation_contact} onChange={e => set('escalation_contact', e.target.value)} /></Labeled>
          <p className="text-xs text-[var(--text-muted)]">{t('workforce.directory.accountRoleNote', { role: row.account_role || NR })}</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}><Save size={14} className="inline me-1" />{busy ? t('workforce.directory.saving') : row.has_record ? t('workforce.directory.saveChanges') : t('workforce.directory.createRecord')}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>{t('workforce.directory.cancel')}</button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm" data-testid="employee-readonly">
          {!row.has_record && <p className="md:col-span-2 text-amber-600">{t('workforce.directory.noRecordReadonly')}</p>}
          {['designation', 'employee_code', 'department', 'team', 'supervisor_id', 'sites', 'employment_status', 'unavailable_until', 'shift_start', 'shift_end', 'responsibilities', 'escalation_contact'].map(k => (
            <div key={k}><dt className="text-xs text-[var(--text-muted)]">{fieldLabelOf(t, k)}</dt><dd className="whitespace-pre-wrap">{fmtValue(k, row.record?.[k])}</dd></div>
          ))}
          <div><dt className="text-xs text-[var(--text-muted)]">{t('workforce.directory.accountRole')}</dt><dd>{row.account_role || NR}</dd></div>
        </dl>
      ))}

      {tab === 'history' && (
        <div className="space-y-2">
          {historyError && <div role="alert" className="text-sm text-red-500">{historyError}</div>}
          {!history && !historyError && <p className="text-sm text-[var(--text-muted)]">{t('workforce.directory.loadingHistory')}</p>}
          {history && history.length === 0 && <p className="text-sm text-[var(--text-muted)]">{t('workforce.directory.noHistory')}</p>}
          {history && history.map(h => {
            const diff = h.old_values ? historyDiff(h.old_values, h.new_values) : []
            return (
              <div key={h.id} className="rounded-lg border border-[var(--input-border)] p-2 text-sm">
                <div className="text-xs text-[var(--text-muted)]">{t('workforce.directory.changedBy', { when: new Date(h.changed_at).toLocaleString(), name: h.changed_by ? nameOf(h.changed_by) : t('workforce.directory.system') })}</div>
                {!h.old_values ? <div>{t('workforce.directory.recordCreatedEvent')}</div>
                  : diff.length === 0 ? <div className="text-[var(--text-muted)]">{t('workforce.directory.noTrackedChange')}</div>
                    : <ul>{diff.map(d => <li key={d.field}><span className="font-medium">{fieldLabelOf(t, d.field)}</span>: {t('workforce.directory.diff', { from: fmtValue(d.field, d.from), to: fmtValue(d.field, d.to) })}</li>)}</ul>}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'certs' && (
        <div className="space-y-3">
          {certError ? <div role="alert" className="text-sm text-red-500">{certError}</div>
            : certs.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{t('workforce.directory.noCerts')}</p>
              : (
                <ul className="space-y-2">
                  {certs.map(c => {
                    const st = certificateState(c, today)
                    return (
                      <li key={c.id} className="rounded-lg border border-[var(--input-border)] p-2 text-sm flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.cert_type}</span>
                        <Badge className={CERT_TONE[st]}>{CERT_KEY[st] ? t(CERT_KEY[st]) : st}</Badge>
                        <span className="text-xs text-[var(--text-muted)]">{t('workforce.directory.certLine', { number: c.cert_number || NR, issued: c.issued_on || NR, expires: c.expires_on || t('workforce.directory.noExpiry') })}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
          <p className="text-xs text-[var(--text-muted)]">{t('workforce.directory.certsPermanent')}</p>
          {isManager && (
            <form className="grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-[var(--input-border)] pt-3" onSubmit={saveCert} noValidate>
              <h4 className="md:col-span-2 font-semibold text-sm">{t('workforce.directory.addCertificate')}</h4>
              {certFormError && <div role="alert" className="md:col-span-2 text-sm text-red-500">{certFormError}</div>}
              <Labeled id="cert-type" label={t('workforce.directory.certTypeRequired')}><input id="cert-type" className="input" maxLength={80} value={certForm.cert_type} onChange={e => setCertForm(f => ({ ...f, cert_type: e.target.value }))} /></Labeled>
              <Labeled id="cert-no" label={t('workforce.directory.certNumber')}><input id="cert-no" className="input" maxLength={80} value={certForm.cert_number} onChange={e => setCertForm(f => ({ ...f, cert_number: e.target.value }))} /></Labeled>
              <Labeled id="cert-issued" label={t('workforce.directory.issuedOn')}><input id="cert-issued" className="input" type="date" value={certForm.issued_on} onChange={e => setCertForm(f => ({ ...f, issued_on: e.target.value }))} /></Labeled>
              <Labeled id="cert-expires" label={t('workforce.directory.expiresOn')}><input id="cert-expires" className="input" type="date" value={certForm.expires_on} onChange={e => setCertForm(f => ({ ...f, expires_on: e.target.value }))} /></Labeled>
              <div className="md:col-span-2"><button type="submit" className="btn-primary" disabled={busy}><Plus size={14} className="inline me-1" />{t('workforce.directory.recordCertificate')}</button></div>
            </form>
          )}
        </div>
      )}

      {tab === 'skills' && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">{t('workforce.directory.skillsNotePrefix')} <a className="underline" href="/technician-scorecard">{t('workforce.directory.skillsNoteLink')}</a>{t('workforce.directory.skillsNoteSuffix')}</p>
          {skills == null ? <div role="alert" className="text-sm text-red-500">{t('workforce.directory.skillsReadFailedFull')}</div>
            : skills.length === 0 ? <p className="text-sm text-[var(--text-muted)]">{t('workforce.directory.noSkills')}</p>
              : (
                <ul className="space-y-1" data-testid="skills-list">
                  {skills.map(s => (
                    <li key={s.id || s.skill_id} className="text-sm flex items-center justify-between gap-2 rounded-lg border border-[var(--input-border)] p-2">
                      <span>{SKILL_NAME.get(s.skill_id) || s.skill_id}</span>
                      <span className="tabular-nums">{t('workforce.directory.skillLevel', { level: s.level ?? '?' })}</span>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}
    </SideDrawer>
  )
}

const BLANK_TASK = { id: null, task_type: '', label: '', required_skill_id: '', min_skill_level: 1, required_cert_type: '', safety_critical: false, evidence_required: false, technical_review_required: false, operational_record_table: '', active: true }

function TaskRequirements ({ taskTypes, onSaved }) {
  const { t } = useLanguage()
  const [form, setForm] = useState(BLANK_TASK)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const submit = async e => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await saveTaskType(form); setForm(BLANK_TASK); await onSaved() } catch (x) { setErr(workforceErrorText(x, t, t('workforce.directory.taskFailed'))) } finally { setBusy(false) }
  }
  const missingGate = form.safety_critical && !String(form.required_skill_id).trim() && !String(form.required_cert_type).trim()
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><ClipboardList size={16} />{t('workforce.directory.taskHeading')}</h3>
      <p className="text-xs text-[var(--text-muted)]">
        {t('workforce.directory.taskRule')}
      </p>
      {taskTypes.length === 0
        ? <p className="text-sm text-[var(--text-muted)]">{t('workforce.directory.noTaskTypes')}</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-start text-xs text-[var(--text-muted)]"><th className="text-start p-1">{t('workforce.directory.thTaskType')}</th><th className="text-start p-1">{t('workforce.directory.thSkill')}</th><th className="text-start p-1">{t('workforce.directory.thCertificate')}</th><th className="text-start p-1">{t('workforce.directory.thGates')}</th><th className="text-start p-1">{t('workforce.directory.thRecord')}</th><th /></tr></thead>
              <tbody>
                {taskTypes.map(tt => (
                  <tr key={tt.id} className="border-t border-[var(--input-border)]">
                    <td className="p-1"><div className="font-medium">{tt.label || tt.task_type}</div><div className="text-xs text-[var(--text-muted)]">{tt.task_type}{tt.active ? '' : ` ${t('workforce.directory.inactive')}`}</div></td>
                    <td className="p-1">{tt.required_skill_id ? t('workforce.directory.skillWithLevel', { skill: SKILL_NAME.get(tt.required_skill_id) || tt.required_skill_id, level: tt.min_skill_level }) : t('workforce.directory.none')}</td>
                    <td className="p-1">{tt.required_cert_type || t('workforce.directory.none')}</td>
                    <td className="p-1 space-x-1">
                      {tt.safety_critical && <Badge className={CERT_TONE.expired}>{t('workforce.directory.gateSafety')}</Badge>}
                      {tt.evidence_required && <Badge className={CERT_TONE.not_yet_valid}>{t('workforce.directory.gateEvidence')}</Badge>}
                      {tt.technical_review_required && <Badge className={CERT_TONE.not_yet_valid}>{t('workforce.directory.gateReview')}</Badge>}
                    </td>
                    <td className="p-1">{tt.operational_record_table ? (OPERATIONAL_TABLES[tt.operational_record_table] ? t(`workforce.opTable.${tt.operational_record_table}`) : tt.operational_record_table) : t('workforce.directory.none')}</td>
                    <td className="p-1"><button type="button" className="btn-secondary" onClick={() => setForm({ ...BLANK_TASK, ...tt, required_skill_id: tt.required_skill_id || '', required_cert_type: tt.required_cert_type || '', operational_record_table: tt.operational_record_table || '', label: tt.label || '' })}>{t('workforce.directory.edit')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <form className="grid grid-cols-1 md:grid-cols-3 gap-2 border-t border-[var(--input-border)] pt-3" onSubmit={submit} noValidate>
        <h4 className="md:col-span-3 font-semibold text-sm">{form.id ? t('workforce.directory.editTask') : t('workforce.directory.addTask')}</h4>
        {err && <div role="alert" className="md:col-span-3 text-sm text-red-500">{err}</div>}
        <Labeled id="tt-type" label={t('workforce.directory.taskTypeRequired')}><input id="tt-type" className="input" maxLength={80} value={form.task_type} onChange={e => set('task_type', e.target.value)} /></Labeled>
        <Labeled id="tt-label" label={t('workforce.directory.displayLabel')}><input id="tt-label" className="input" value={form.label} onChange={e => set('label', e.target.value)} /></Labeled>
        <Labeled id="tt-record" label={t('workforce.directory.operationalRecord')}>
          <select id="tt-record" className="input" value={form.operational_record_table} onChange={e => set('operational_record_table', e.target.value)}>
            <option value="">{t('workforce.directory.none')}</option>
            {Object.keys(OPERATIONAL_TABLES).map(k => <option key={k} value={k}>{t(`workforce.opTable.${k}`)}</option>)}
          </select>
        </Labeled>
        <Labeled id="tt-skill" label={t('workforce.directory.requiredSkill')}>
          <select id="tt-skill" className="input" value={form.required_skill_id} onChange={e => set('required_skill_id', e.target.value)}>
            <option value="">{t('workforce.directory.none')}</option>
            {SKILL_CATALOGUE.map(s => <option key={s.skill_id} value={s.skill_id}>{s.name}</option>)}
          </select>
        </Labeled>
        <Labeled id="tt-level" label={t('workforce.directory.minSkillLevel')}>
          <select id="tt-level" className="input" value={form.min_skill_level} onChange={e => set('min_skill_level', Number(e.target.value))}>
            {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Labeled>
        <Labeled id="tt-cert" label={t('workforce.directory.requiredCert')}><input id="tt-cert" className="input" maxLength={80} value={form.required_cert_type} onChange={e => set('required_cert_type', e.target.value)} /></Labeled>
        <div className="md:col-span-3 flex flex-wrap gap-4 text-sm">
          {[['safety_critical', t('workforce.directory.flagSafety')], ['evidence_required', t('workforce.directory.flagEvidence')], ['technical_review_required', t('workforce.directory.flagReview')], ['active', t('workforce.directory.flagActive')]].map(([k, label]) => (
            <label key={k} className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />{label}</label>
          ))}
        </div>
        {missingGate && <p className="md:col-span-3 text-xs text-amber-600" role="status">{t('workforce.directory.missingGate')}</p>}
        <div className="md:col-span-3 flex gap-2">
          <button type="submit" className="btn-primary" disabled={busy}><Save size={14} className="inline me-1" />{form.id ? t('workforce.directory.saveRequirement') : t('workforce.directory.addRequirement')}</button>
          {form.id && <button type="button" className="btn-secondary" onClick={() => { setForm(BLANK_TASK); setErr(null) }}>{t('workforce.directory.cancelEdit')}</button>}
        </div>
      </form>
    </div>
  )
}
