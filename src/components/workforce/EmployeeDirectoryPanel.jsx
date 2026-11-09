import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Users, Network, Download, RefreshCw, AlertTriangle, ShieldAlert, Award, History,
  Plus, Wrench, ClipboardList, Pencil, Save, UserX,
} from 'lucide-react'
import EnterpriseTable from '../ui/EnterpriseTable'
import SideDrawer from '../ui/SideDrawer'
import { toUserMessage } from '../../lib/safeError'
import { exportToExcel } from '../../lib/exportUtils'
import { SKILL_CATALOGUE } from '../../lib/technicianScorecard'
import { listSkills } from '../../lib/api/technicianScorecard'
import { NOT_INSTALLED, OPERATIONAL_TABLES } from '../../lib/api/workforceAssignments'
import {
  EMPLOYMENT_STATUSES, listEmployeeRecords, saveEmployeeRecord, listEmployeeHistory, historyDiff,
  listCertifications, addCertification, certificateState, listTaskTypes, saveTaskType, reportingTree,
} from '../../lib/api/workforceEmployees'

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
const STATUS_LABEL = { active: 'Active', temporarily_unavailable: 'Temporarily unavailable', inactive: 'Inactive' }
const CERT_LABEL = { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired', not_yet_valid: 'Not yet valid' }
const CERT_TONE = {
  valid: 'bg-green-500/15 text-green-600',
  expiring: 'bg-amber-500/15 text-amber-600',
  expired: 'bg-red-500/15 text-red-600',
  not_yet_valid: 'bg-slate-500/15 text-[var(--text-muted)]',
}
const FIELD_LABEL = {
  employee_code: 'Employee code', designation: 'Designation', department: 'Department', team: 'Team',
  supervisor_id: 'Supervisor', sites: 'Sites', employment_status: 'Status', unavailable_until: 'Unavailable until',
  shift_start: 'Shift start', shift_end: 'Shift end', responsibilities: 'Responsibilities', escalation_contact: 'Escalation contact',
}
const SKILL_NAME = new Map(SKILL_CATALOGUE.map(s => [s.skill_id, s.name]))

/** Local calendar day (YYYY-MM-DD). toISOString() would roll the day back east of UTC. */
export function localDay (d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const accountName = p => p?.full_name || p?.username || null
const msg = (e, fallback) => toUserMessage(e, fallback)
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
  if (!cert.total) return <span className="text-xs text-[var(--text-muted)]">{NOT_RECORDED}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {cert.expired > 0 && <Badge className={CERT_TONE.expired}>{cert.expired} expired</Badge>}
      {cert.expiring > 0 && <Badge className={CERT_TONE.expiring}>{cert.expiring} expiring</Badge>}
      {cert.valid > 0 && <Badge className={CERT_TONE.valid}>{cert.valid} valid</Badge>}
      {cert.not_yet_valid > 0 && <Badge className={CERT_TONE.not_yet_valid}>{cert.not_yet_valid} not yet valid</Badge>}
    </span>
  )
}

function HierarchyNode ({ node, nameOf, depth = 0 }) {
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm" style={{ paddingInlineStart: depth * 16 }}>
        <span className="font-medium">{nameOf(node.id)}</span>
        {node.loop
          ? <Badge className={CERT_TONE.expired}>Reporting loop</Badge>
          : node.direct > 0 && <span className="text-xs text-[var(--text-muted)]">{node.direct} direct, {node.indirect} indirect</span>}
      </div>
      {node.children?.length > 0 && (
        <ul className="space-y-1">{node.children.map(c => <HierarchyNode key={c.id} node={c} nameOf={nameOf} depth={depth + 1} />)}</ul>
      )}
    </li>
  )
}

export default function EmployeeDirectoryPanel ({ profiles = [], isManager = false, currentUserId = null }) {
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
      else { setCerts([]); setCertError(msg(c.reason, 'Certificates could not be read')) }
      if (s.status === 'fulfilled') setSkills(s.value || [])
      else { setSkills(null); setSkillsError(msg(s.reason, 'Skill records could not be read')) }
    } catch (e) {
      if (e?.message === NOT_INSTALLED) setNotInstalled(true)
      else setError(msg(e, 'Unable to load the employee directory'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const profById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])
  const nameOf = useCallback(id => accountName(profById.get(id)) || 'Account not in active directory', [profById])

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
      employee_id: r.employee_id || NOT_RECORDED,
      designation: r.has_record ? r.designation : 'No employee record',
      department: r.department || NOT_RECORDED,
      team: r.team || NOT_RECORDED,
      supervisor: r.supervisor_name || NOT_RECORDED,
      sites: r.sites.join(', ') || NOT_RECORDED,
      status: r.has_record ? STATUS_LABEL[r.employment_status] : 'No employee record',
      unavailable_until: r.unavailable_until || '',
      shift: r.shift || NOT_RECORDED,
      certs_valid: r.cert.valid, certs_expiring: r.cert.expiring, certs_expired: r.cert.expired,
      skills: r.skill_count == null ? 'Not available' : r.skill_count,
      account_role: r.account_role || NOT_RECORDED,
    }))
    try {
      await exportToExcel(out,
        ['name', 'employee_id', 'designation', 'department', 'team', 'supervisor', 'sites', 'status', 'unavailable_until', 'shift', 'certs_valid', 'certs_expiring', 'certs_expired', 'skills', 'account_role'],
        ['Name', 'Employee ID', 'Designation', 'Department', 'Team', 'Supervisor', 'Sites', 'Employment status', 'Unavailable until', 'Shift', 'Certificates valid', 'Certificates expiring', 'Certificates expired', 'Skills recorded', 'Account role (access)'],
        'Employee Directory', 'Employees', { title: 'Employee Directory' })
    } catch (e) { setError(msg(e, 'Could not export the directory')) }
  }

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Employee', accessorFn: r => r.name, size: 220,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          <div className="text-xs text-[var(--text-muted)]">{row.original.employee_id ? `ID ${row.original.employee_id}` : 'ID not recorded'}</div>
          {!row.original.account_active && <div className="text-xs text-amber-600">Account not active</div>}
        </div>
      ),
    },
    {
      id: 'designation', header: 'Designation', accessorFn: r => r.designation || '', size: 190,
      cell: ({ row }) => row.original.has_record
        ? row.original.designation
        : <Badge className={CERT_TONE.expiring}><UserX size={12} className="me-1" />No employee record</Badge>,
    },
    { id: 'department', header: 'Department / team', accessorFn: r => [r.department, r.team].filter(Boolean).join(' / '), size: 180, cell: ({ getValue }) => getValue() || <span className="text-xs text-[var(--text-muted)]">{NOT_RECORDED}</span> },
    { id: 'supervisor', header: 'Supervisor', accessorFn: r => r.supervisor_name || '', size: 160, cell: ({ getValue }) => getValue() || <span className="text-xs text-[var(--text-muted)]">{NOT_RECORDED}</span> },
    {
      id: 'sites', header: 'Sites', accessorFn: r => r.sites.join(', '), size: 150,
      cell: ({ row }) => row.original.sites.length
        ? <span title={row.original.sites_from_record ? 'From the employee record' : 'From the account (no employee record sites)'}>{row.original.sites.join(', ')}</span>
        : <span className="text-xs text-[var(--text-muted)]">{NOT_RECORDED}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: r => r.employment_status || '', size: 170,
      cell: ({ row }) => {
        const r = row.original
        if (!r.has_record) return <span className="text-xs text-[var(--text-muted)]">{NOT_RECORDED}</span>
        return (
          <div>
            <div>{STATUS_LABEL[r.employment_status] || r.employment_status}</div>
            {r.employment_status === 'temporarily_unavailable' && <div className="text-xs text-[var(--text-muted)]">{r.unavailable_until ? `Until ${r.unavailable_until}` : 'Return date not recorded'}</div>}
          </div>
        )
      },
    },
    { id: 'shift', header: 'Shift', accessorFn: r => r.shift || '', size: 120, cell: ({ getValue }) => getValue() || <span className="text-xs text-[var(--text-muted)]">{NOT_RECORDED}</span> },
    { id: 'certs', header: 'Certificates', accessorFn: r => r.cert.expired * 1000 + r.cert.expiring, size: 170, cell: ({ row }) => certError ? <span className="text-xs text-[var(--text-muted)]">Not available</span> : <CertCell cert={row.original.cert} /> },
    { id: 'skills', header: 'Skills', accessorFn: r => r.skill_count ?? -1, size: 90, cell: ({ row }) => row.original.skill_count == null ? <span className="text-xs text-[var(--text-muted)]">Not available</span> : row.original.skill_count },
    {
      id: 'actions', header: '', size: 90, enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" className="btn-secondary" onClick={e => { e.stopPropagation(); setOpenId(row.original.id) }}
          aria-label={`${isManager ? 'Edit' : 'View'} ${row.original.name}`}>
          {isManager ? (row.original.has_record ? 'Edit' : 'Create') : 'View'}
        </button>
      ),
    },
  ], [isManager, certError])

  if (notInstalled) {
    return (
      <div className="card space-y-2" role="status">
        <h2 className="font-semibold flex items-center gap-2"><Users size={18} />Employees and teams</h2>
        <p className="text-sm">Not installed yet. {NOT_INSTALLED}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold flex items-center gap-2"><Users size={18} />Employees and teams</h2>
          <div className="ms-auto flex flex-wrap gap-2">
            <button type="button" className={view === 'directory' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('directory')}>Directory</button>
            <button type="button" className={view === 'hierarchy' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('hierarchy')}><Network size={15} className="inline me-1" />Team hierarchy</button>
            {isManager && <button type="button" className={view === 'tasks' ? 'btn-primary' : 'btn-secondary'} onClick={() => setView('tasks')}><ClipboardList size={15} className="inline me-1" />Task requirements</button>}
            <button type="button" className="btn-secondary" onClick={exportDirectory} disabled={loading || !filtered.length}><Download size={15} className="inline me-1" />Export</button>
            <button type="button" className="btn-secondary" onClick={load} aria-label="Refresh employee directory"><RefreshCw size={15} /></button>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          The account role controls what a person can open in the app. It is not a job title. Designation, reporting line, sites and availability come from the employee record.
          {!isManager && ' You see your own record and the people who report to you.'}
        </p>
        {notice && <div role="status" className="text-sm text-green-600">{notice}</div>}
        {error && (
          <div role="alert" className="flex items-center gap-2 text-sm text-red-500">
            <AlertTriangle size={16} />{error}
            <button type="button" className="btn-secondary ms-auto" onClick={load}>Retry</button>
          </div>
        )}
        {certError && <p className="text-xs text-amber-600" role="status">Certificates could not be read, so certificate counts show as not available. {certError}</p>}
        {skillsError && <p className="text-xs text-amber-600" role="status">Skill records could not be read, so skill counts show as not available.</p>}
        {!loading && !error && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Stat label="People" value={stats.total} />
            <Stat label="No employee record" value={stats.missing} onClick={() => { setView('directory'); setFilter('flag', 'missing') }} />
            <Stat label="Temporarily unavailable" value={stats.unavailable} onClick={() => { setView('directory'); setFilter('status', 'temporarily_unavailable') }} />
            <Stat label="Certificate expired" value={certError ? 'N/A' : stats.expired} onClick={certError ? null : () => { setView('directory'); setFilter('flag', 'expired') }} />
            <Stat label="Certificate expiring" value={certError ? 'N/A' : stats.expiring} onClick={certError ? null : () => { setView('directory'); setFilter('flag', 'expiring') }} />
          </div>
        )}
      </div>

      {view === 'directory' && (
        <div className="card space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <Labeled id="emp-search" label="Search">
              <input id="emp-search" className="input" value={filters.search} placeholder="Name, ID, designation"
                onChange={e => setFilter('search', e.target.value)} />
            </Labeled>
            <FilterSelect id="emp-dept" label="Department" value={filters.department} onChange={v => setFilter('department', v)} options={options.departments} />
            <FilterSelect id="emp-team" label="Team" value={filters.team} onChange={v => setFilter('team', v)} options={options.teams} />
            <Labeled id="emp-status" label="Status">
              <select id="emp-status" className="input" value={filters.status} onChange={e => setFilter('status', e.target.value)}>
                <option value="all">All</option>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                <option value="no_record">No employee record</option>
              </select>
            </Labeled>
            <FilterSelect id="emp-site" label="Site" value={filters.site} onChange={v => setFilter('site', v)} options={options.sites} />
            <Labeled id="emp-flag" label="Show">
              <select id="emp-flag" className="input" value={filters.flag} onChange={e => setFilter('flag', e.target.value)}>
                <option value="all">Everyone</option>
                <option value="missing">Missing employee record</option>
                <option value="expired">Certificate expired</option>
                <option value="expiring">Certificate expiring</option>
              </select>
            </Labeled>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span data-testid="directory-count">Showing {filtered.length} of {rows.length}</span>
            {Object.entries(filters).some(([k, v]) => k === 'search' ? v : v !== 'all') && (
              <button type="button" className="btn-secondary" onClick={() => setFilters({ search: '', department: 'all', team: 'all', status: 'all', site: 'all', flag: 'all' })}>Clear filters</button>
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
            emptyMessage={rows.length ? 'No employees match these filters.' : 'No employee accounts to show.'}
          />
        </div>
      )}

      {view === 'hierarchy' && (
        <div className="card space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Network size={16} />Reporting lines</h3>
          {loading ? <p className="text-sm text-[var(--text-muted)]">Loading...</p> : (
            <>
              {hierarchy.tree.length === 0
                ? <p className="text-sm text-[var(--text-muted)]">No reporting lines recorded yet. Set a supervisor on an employee record to build the hierarchy.</p>
                : <ul className="space-y-2" data-testid="hierarchy-tree">{hierarchy.tree.map(n => <HierarchyNode key={n.id} node={n} nameOf={nameOf} />)}</ul>}
              {hierarchy.loops.length > 0 && (
                <div role="alert" className="text-sm text-red-500">
                  <ShieldAlert size={15} className="inline me-1" />Reporting line could not be resolved for: {hierarchy.loops.map(nameOf).join(', ')}. Their supervisors form a loop.
                </div>
              )}
              <section data-testid="hierarchy-unassigned">
                <h4 className="text-sm font-semibold">No supervisor recorded ({hierarchy.unassigned.length})</h4>
                {hierarchy.unassigned.length
                  ? <p className="text-sm">{hierarchy.unassigned.map(nameOf).join(', ')}</p>
                  : <p className="text-xs text-[var(--text-muted)]">Everyone with an employee record has a supervisor or manages others.</p>}
              </section>
              {isManager && stats.missing > 0 && <p className="text-xs text-[var(--text-muted)]">{stats.missing} account(s) have no employee record and are not part of any reporting line.</p>}
            </>
          )}
        </div>
      )}

      {view === 'tasks' && isManager && (
        <TaskRequirements taskTypes={taskTypes} onSaved={async () => { setTaskTypes(await listTaskTypes()); setNotice('Task requirement saved') }} />
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
  return (
    <Labeled id={id} label={label}>
      <select id={id} className="input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="all">All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </Labeled>
  )
}

function EmployeeDrawer ({ row, open, onClose, isManager, profiles, nameOf, certs, certError, skills, today, onSaved }) {
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
    listEmployeeHistory(rowId).then(h => { if (live) setHistory(h || []) }).catch(e => { if (live) setHistoryError(msg(e, 'Unable to load history')) })
    return () => { live = false }
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
      await onSaved(row.has_record ? 'Employee record updated' : 'Employee record created')
      onClose()
    } catch (err) { setFormError(msg(err, 'Could not save the employee record')) } finally { setBusy(false) }
  }

  const saveCert = async e => {
    e.preventDefault()
    setCertFormError(null); setBusy(true)
    try {
      await addCertification({ profile_id: row.id, ...certForm })
      setCertForm({ cert_type: '', cert_number: '', issued_on: '', expires_on: '' })
      await onSaved('Certificate recorded')
    } catch (err) { setCertFormError(msg(err, 'Could not record the certificate')) } finally { setBusy(false) }
  }

  const fmtValue = (field, v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return NOT_RECORDED
    if (field === 'supervisor_id') return nameOf(v)
    if (field === 'employment_status') return STATUS_LABEL[v] || v
    if (Array.isArray(v)) return v.join(', ')
    return String(v)
  }
  const editable = isManager
  const supervisorOptions = profiles.filter(p => p.id !== row.id).sort((a, b) => String(accountName(a) || '').localeCompare(String(accountName(b) || '')))
  const tabs = [['details', 'Details', Pencil], ['history', 'History', History], ['certs', 'Certifications', Award], ['skills', 'Skills', Wrench]]

  return (
    <SideDrawer open={open} onClose={onClose} busy={busy} size="lg"
      title={row.name}
      subtitle={row.has_record ? row.designation : 'No employee record yet'}>
      <div className="flex flex-wrap gap-2 mb-3" role="tablist">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(k)}>
            <Icon size={14} className="inline me-1" />{label}
          </button>
        ))}
      </div>

      {tab === 'details' && (editable ? (
        <form className="space-y-3" onSubmit={save} noValidate>
          {!row.has_record && <p className="text-sm text-amber-600">This account has no employee record. Create one to record the job, reporting line and sites.</p>}
          {formError && <div role="alert" className="text-sm text-red-500 flex items-center gap-2"><AlertTriangle size={15} />{formError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Labeled id="ed-designation" label="Designation (required)">
              <input id="ed-designation" className="input" value={form.designation} maxLength={120} aria-invalid={/designation/i.test(formError || '')} onChange={e => set('designation', e.target.value)} />
            </Labeled>
            <Labeled id="ed-code" label="Employee code"><input id="ed-code" className="input" value={form.employee_code} maxLength={40} onChange={e => set('employee_code', e.target.value)} /></Labeled>
            <Labeled id="ed-dept" label="Department"><input id="ed-dept" className="input" value={form.department} maxLength={120} onChange={e => set('department', e.target.value)} /></Labeled>
            <Labeled id="ed-team" label="Team"><input id="ed-team" className="input" value={form.team} maxLength={120} onChange={e => set('team', e.target.value)} /></Labeled>
            <Labeled id="ed-sup" label="Supervisor" hint="An employee cannot supervise themselves. A supervisor that would create a loop is refused.">
              <select id="ed-sup" className="input" value={form.supervisor_id} onChange={e => set('supervisor_id', e.target.value)}>
                <option value="">No supervisor</option>
                {supervisorOptions.map(p => <option key={p.id} value={p.id}>{accountName(p) || 'Unnamed account'}{p.employee_id ? ` (${p.employee_id})` : ''}</option>)}
              </select>
            </Labeled>
            <Labeled id="ed-status" label="Employment status">
              <select id="ed-status" className="input" value={form.employment_status} onChange={e => set('employment_status', e.target.value)}>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Labeled>
            {form.employment_status === 'temporarily_unavailable' && (
              <Labeled id="ed-until" label="Unavailable until" hint="Leave blank when the return date is not known.">
                <input id="ed-until" className="input" type="date" value={form.unavailable_until} onChange={e => set('unavailable_until', e.target.value)} />
              </Labeled>
            )}
            <Labeled id="ed-shift-start" label="Shift start"><input id="ed-shift-start" className="input" type="time" value={form.shift_start} onChange={e => set('shift_start', e.target.value)} /></Labeled>
            <Labeled id="ed-shift-end" label="Shift end"><input id="ed-shift-end" className="input" type="time" value={form.shift_end} onChange={e => set('shift_end', e.target.value)} /></Labeled>
          </div>
          <Labeled id="ed-site" label="Sites" hint="Use ALL for every site. Work outside these sites is flagged when assigning.">
            <div className="flex gap-2">
              <input id="ed-site" className="input" value={siteInput} onChange={e => setSiteInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSite() } }} placeholder="Site code" />
              <button type="button" className="btn-secondary" onClick={addSite}><Plus size={14} className="inline" /> Add</button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {form.sites.length === 0 && <span className="text-xs text-[var(--text-muted)]">No sites recorded</span>}
              {form.sites.map(s => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full border border-[var(--input-border)] px-2 py-0.5 text-xs">
                  {s}<button type="button" aria-label={`Remove site ${s}`} onClick={() => set('sites', form.sites.filter(x => x !== s))}>x</button>
                </span>
              ))}
            </div>
          </Labeled>
          <Labeled id="ed-resp" label="Responsibilities"><textarea id="ed-resp" className="input" rows={3} maxLength={4000} value={form.responsibilities} onChange={e => set('responsibilities', e.target.value)} /></Labeled>
          <Labeled id="ed-esc" label="Escalation contact"><input id="ed-esc" className="input" maxLength={200} value={form.escalation_contact} onChange={e => set('escalation_contact', e.target.value)} /></Labeled>
          <p className="text-xs text-[var(--text-muted)]">Account role (access): {row.account_role || NOT_RECORDED}. Change access in user management, not here.</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}><Save size={14} className="inline me-1" />{busy ? 'Saving...' : row.has_record ? 'Save changes' : 'Create employee record'}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm" data-testid="employee-readonly">
          {!row.has_record && <p className="md:col-span-2 text-amber-600">No employee record has been created for this account.</p>}
          {['designation', 'employee_code', 'department', 'team', 'supervisor_id', 'sites', 'employment_status', 'unavailable_until', 'shift_start', 'shift_end', 'responsibilities', 'escalation_contact'].map(k => (
            <div key={k}><dt className="text-xs text-[var(--text-muted)]">{FIELD_LABEL[k]}</dt><dd className="whitespace-pre-wrap">{fmtValue(k, row.record?.[k])}</dd></div>
          ))}
          <div><dt className="text-xs text-[var(--text-muted)]">Account role (access)</dt><dd>{row.account_role || NOT_RECORDED}</dd></div>
        </dl>
      ))}

      {tab === 'history' && (
        <div className="space-y-2">
          {historyError && <div role="alert" className="text-sm text-red-500">{historyError}</div>}
          {!history && !historyError && <p className="text-sm text-[var(--text-muted)]">Loading history...</p>}
          {history && history.length === 0 && <p className="text-sm text-[var(--text-muted)]">No changes recorded yet.</p>}
          {history && history.map(h => {
            const diff = h.old_values ? historyDiff(h.old_values, h.new_values) : []
            return (
              <div key={h.id} className="rounded-lg border border-[var(--input-border)] p-2 text-sm">
                <div className="text-xs text-[var(--text-muted)]">{new Date(h.changed_at).toLocaleString()} by {h.changed_by ? nameOf(h.changed_by) : 'System'}</div>
                {!h.old_values ? <div>Record created</div>
                  : diff.length === 0 ? <div className="text-[var(--text-muted)]">Saved with no tracked change</div>
                    : <ul>{diff.map(d => <li key={d.field}><span className="font-medium">{FIELD_LABEL[d.field] || d.field}</span>: {fmtValue(d.field, d.from)} to {fmtValue(d.field, d.to)}</li>)}</ul>}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'certs' && (
        <div className="space-y-3">
          {certError ? <div role="alert" className="text-sm text-red-500">{certError}</div>
            : certs.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No certificates recorded.</p>
              : (
                <ul className="space-y-2">
                  {certs.map(c => {
                    const st = certificateState(c, today)
                    return (
                      <li key={c.id} className="rounded-lg border border-[var(--input-border)] p-2 text-sm flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.cert_type}</span>
                        <Badge className={CERT_TONE[st]}>{CERT_LABEL[st]}</Badge>
                        <span className="text-xs text-[var(--text-muted)]">No. {c.cert_number || NOT_RECORDED} | Issued {c.issued_on || NOT_RECORDED} | Expires {c.expires_on || 'No expiry recorded'}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
          <p className="text-xs text-[var(--text-muted)]">Certificates are kept as a permanent record. Record a renewal as a new certificate.</p>
          {isManager && (
            <form className="grid grid-cols-1 md:grid-cols-2 gap-2 border-t border-[var(--input-border)] pt-3" onSubmit={saveCert} noValidate>
              <h4 className="md:col-span-2 font-semibold text-sm">Add certificate</h4>
              {certFormError && <div role="alert" className="md:col-span-2 text-sm text-red-500">{certFormError}</div>}
              <Labeled id="cert-type" label="Certificate type (required)"><input id="cert-type" className="input" maxLength={80} value={certForm.cert_type} onChange={e => setCertForm(f => ({ ...f, cert_type: e.target.value }))} /></Labeled>
              <Labeled id="cert-no" label="Certificate number"><input id="cert-no" className="input" maxLength={80} value={certForm.cert_number} onChange={e => setCertForm(f => ({ ...f, cert_number: e.target.value }))} /></Labeled>
              <Labeled id="cert-issued" label="Issued on"><input id="cert-issued" className="input" type="date" value={certForm.issued_on} onChange={e => setCertForm(f => ({ ...f, issued_on: e.target.value }))} /></Labeled>
              <Labeled id="cert-expires" label="Expires on"><input id="cert-expires" className="input" type="date" value={certForm.expires_on} onChange={e => setCertForm(f => ({ ...f, expires_on: e.target.value }))} /></Labeled>
              <div className="md:col-span-2"><button type="submit" className="btn-primary" disabled={busy}><Plus size={14} className="inline me-1" />Record certificate</button></div>
            </form>
          )}
        </div>
      )}

      {tab === 'skills' && (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">Skills are recorded on the <a className="underline" href="/technician-scorecard">Technician Scorecard</a>. This view is read-only.</p>
          {skills == null ? <div role="alert" className="text-sm text-red-500">Skill records could not be read.</div>
            : skills.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No skills recorded.</p>
              : (
                <ul className="space-y-1" data-testid="skills-list">
                  {skills.map(s => (
                    <li key={s.id || s.skill_id} className="text-sm flex items-center justify-between gap-2 rounded-lg border border-[var(--input-border)] p-2">
                      <span>{SKILL_NAME.get(s.skill_id) || s.skill_id}</span>
                      <span className="tabular-nums">Level {s.level ?? '?'} of 3</span>
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
  const [form, setForm] = useState(BLANK_TASK)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const submit = async e => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await saveTaskType(form); setForm(BLANK_TASK); await onSaved() } catch (x) { setErr(msg(x, 'Could not save the task type')) } finally { setBusy(false) }
  }
  const missingGate = form.safety_critical && !String(form.required_skill_id).trim() && !String(form.required_cert_type).trim()
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold flex items-center gap-2"><ClipboardList size={16} />Task requirements</h3>
      <p className="text-xs text-[var(--text-muted)]">
        A safety-critical task requires a skill or a certificate. Assigning safety-critical work to someone without the required skill level or a valid certificate is refused by the system and cannot be overridden. For other tasks a missing requirement is flagged and a manager can proceed with a written reason.
      </p>
      {taskTypes.length === 0
        ? <p className="text-sm text-[var(--text-muted)]">No task requirements defined yet. Task types without a requirement are assignable to anyone.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-start text-xs text-[var(--text-muted)]"><th className="text-start p-1">Task type</th><th className="text-start p-1">Skill</th><th className="text-start p-1">Certificate</th><th className="text-start p-1">Gates</th><th className="text-start p-1">Record</th><th /></tr></thead>
              <tbody>
                {taskTypes.map(t => (
                  <tr key={t.id} className="border-t border-[var(--input-border)]">
                    <td className="p-1"><div className="font-medium">{t.label || t.task_type}</div><div className="text-xs text-[var(--text-muted)]">{t.task_type}{t.active ? '' : ' (inactive)'}</div></td>
                    <td className="p-1">{t.required_skill_id ? `${SKILL_NAME.get(t.required_skill_id) || t.required_skill_id} (level ${t.min_skill_level}+)` : 'None'}</td>
                    <td className="p-1">{t.required_cert_type || 'None'}</td>
                    <td className="p-1 space-x-1">
                      {t.safety_critical && <Badge className={CERT_TONE.expired}>Safety-critical</Badge>}
                      {t.evidence_required && <Badge className={CERT_TONE.not_yet_valid}>Evidence</Badge>}
                      {t.technical_review_required && <Badge className={CERT_TONE.not_yet_valid}>Technical review</Badge>}
                    </td>
                    <td className="p-1">{t.operational_record_table ? OPERATIONAL_TABLES[t.operational_record_table] || t.operational_record_table : 'None'}</td>
                    <td className="p-1"><button type="button" className="btn-secondary" onClick={() => setForm({ ...BLANK_TASK, ...t, required_skill_id: t.required_skill_id || '', required_cert_type: t.required_cert_type || '', operational_record_table: t.operational_record_table || '', label: t.label || '' })}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <form className="grid grid-cols-1 md:grid-cols-3 gap-2 border-t border-[var(--input-border)] pt-3" onSubmit={submit} noValidate>
        <h4 className="md:col-span-3 font-semibold text-sm">{form.id ? 'Edit task requirement' : 'Add task requirement'}</h4>
        {err && <div role="alert" className="md:col-span-3 text-sm text-red-500">{err}</div>}
        <Labeled id="tt-type" label="Task type (required)"><input id="tt-type" className="input" maxLength={80} value={form.task_type} onChange={e => set('task_type', e.target.value)} /></Labeled>
        <Labeled id="tt-label" label="Display label"><input id="tt-label" className="input" value={form.label} onChange={e => set('label', e.target.value)} /></Labeled>
        <Labeled id="tt-record" label="Operational record">
          <select id="tt-record" className="input" value={form.operational_record_table} onChange={e => set('operational_record_table', e.target.value)}>
            <option value="">None</option>
            {Object.entries(OPERATIONAL_TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Labeled>
        <Labeled id="tt-skill" label="Required skill">
          <select id="tt-skill" className="input" value={form.required_skill_id} onChange={e => set('required_skill_id', e.target.value)}>
            <option value="">None</option>
            {SKILL_CATALOGUE.map(s => <option key={s.skill_id} value={s.skill_id}>{s.name}</option>)}
          </select>
        </Labeled>
        <Labeled id="tt-level" label="Minimum skill level">
          <select id="tt-level" className="input" value={form.min_skill_level} onChange={e => set('min_skill_level', Number(e.target.value))}>
            {[1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Labeled>
        <Labeled id="tt-cert" label="Required certificate type"><input id="tt-cert" className="input" maxLength={80} value={form.required_cert_type} onChange={e => set('required_cert_type', e.target.value)} /></Labeled>
        <div className="md:col-span-3 flex flex-wrap gap-4 text-sm">
          {[['safety_critical', 'Safety-critical'], ['evidence_required', 'Evidence required'], ['technical_review_required', 'Technical review required'], ['active', 'Active']].map(([k, label]) => (
            <label key={k} className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />{label}</label>
          ))}
        </div>
        {missingGate && <p className="md:col-span-3 text-xs text-amber-600" role="status">Safety-critical requires a skill or a certificate. Choose at least one before saving.</p>}
        <div className="md:col-span-3 flex gap-2">
          <button type="submit" className="btn-primary" disabled={busy}><Save size={14} className="inline me-1" />{form.id ? 'Save requirement' : 'Add requirement'}</button>
          {form.id && <button type="button" className="btn-secondary" onClick={() => { setForm(BLANK_TASK); setErr(null) }}>Cancel edit</button>}
        </div>
      </form>
    </div>
  )
}
