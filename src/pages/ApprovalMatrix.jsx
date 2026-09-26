import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ShieldCheck, FileSpreadsheet, FileText, RefreshCw, Layers, CheckCircle2, Archive, Clock, GitBranch, Timer } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { listApprovalPolicies, listApprovalPeople, listApprovalRoles, saveApprovalPolicy, publishApprovalPolicy, retireApprovalPolicy, simulateApprovalPolicy, listApprovalPolicyEvents, getApprovalRegionCoverage } from '../lib/api/approvalMatrix'
import { listSites } from '../lib/api/sites'
import { approvalPolicyCopy } from '../lib/approvalPolicyCopy'
import { toUserMessage } from '../lib/safeError'
import { Link } from 'react-router-dom'
import { buildApprovalCoverage, approvalCoverageKpis, filterGaps, gapExportRows, APPROVAL_ENTITY_TYPES } from '../lib/approvalCoverageAnalytics'
import {
  filterPolicies, policyKpis, policyRows, validatePolicyDraft, regionCoverageSummary,
  regionOptions as regionOptionsFor, siteOptions as siteOptionsFor, siteRegion as siteRegionFor,
} from '../lib/approvalMatrixAnalytics'

// Status is carried by the WORD in every cell; the colour only reinforces it.
const CELL_TONE = { covered: 'text-green-600', partial: 'text-amber-600', none: 'text-red-500' }
const CELL_TEXT = { covered: 'Covered', partial: 'Partial', none: 'No rule' }

// Labels this page adds on top of the shared copy file. Kept per language so
// the KPI strip never falls back to English inside an Arabic workspace.
const KPI_COPY = {
  en: { inView: 'Policies in view', live: 'Live now', scheduled: 'Scheduled', drafts: 'Drafts', retired: 'Retired', multi: 'Multi-stage', sla: 'Average stage SLA', hours: 'h', notSet: 'N/A', noSla: 'No stage has an SLA', regions: 'Regions read', routed: 'Routed', unrouted: 'Vehicles with no route', unmapped: 'Base locations with no region', stages: 'Stages' },
  ar: { inView: 'السياسات المعروضة', live: 'سارية الآن', scheduled: 'مجدولة', drafts: 'مسودات', retired: 'متقاعدة', multi: 'متعددة المراحل', sla: 'متوسط مهلة المرحلة', hours: 'س', notSet: 'غير متاح', noSla: 'لا توجد مرحلة بمهلة', regions: 'المناطق المقروءة', routed: 'لها مسار', unrouted: 'مركبات بلا مسار', unmapped: 'مواقع بلا منطقة', stages: 'المراحل' },
}

function KpiTile({ icon: Icon, label, value, sub, tone }) {
  return <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] p-3 min-w-0">
    <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">{Icon && <Icon size={13} aria-hidden="true" />}{label}</p>
    <p className={`text-xl font-bold tabular-nums ${tone || 'text-[var(--text-primary)]'}`}>{value}</p>
    {sub && <p className="text-xs text-[var(--text-muted)] truncate">{sub}</p>}
  </div>
}

function CoverageCheck({ policies, sites, countries, c, disabled }) {
  const [typeFilter, setTypeFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('none')
  const [query, setQuery] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const coverage = useMemo(() => buildApprovalCoverage({ policies, sites, countries }), [policies, sites, countries])
  const kpis = useMemo(() => approvalCoverageKpis(policies, coverage), [policies, coverage])
  const gaps = useMemo(() => filterGaps(coverage.gaps, { entityType: typeFilter, state: stateFilter, search: query }), [coverage, typeFilter, stateFilter, query])
  const labels = useMemo(() => Object.fromEntries(APPROVAL_ENTITY_TYPES.map(t => [t, c[t] || t])), [c])
  const matrixColumns = useMemo(() => [
    { id: 'type', header: c.type, accessorFn: r => labels[r.entityType] },
    ...countries.map(k => ({
      id: `c_${k}`, header: k, accessorFn: r => r.cells[k]?.status || 'none',
      cell: ({ row }) => { const cell = row.original.cells[k] || { status: 'none' }; return <span className={CELL_TONE[cell.status]}>{CELL_TEXT[cell.status]}{cell.sites > 0 && cell.gapSites > 0 && <span className="block text-xs text-[var(--text-muted)]">{cell.gapSites} of {cell.sites} sites uncovered</span>}</span> },
    })),
    { id: 'drafts', header: c.draft, accessorFn: r => r.drafts, meta: { align: 'right' }, cell: ({ row }) => <span>{row.original.drafts}{row.original.scheduled > 0 && <span className="block text-xs text-[var(--text-muted)]">{row.original.scheduled} scheduled</span>}</span> },
  ], [c, countries, labels])
  const gapColumns = useMemo(() => [
    { id: 'type', header: c.type, accessorFn: g => labels[g.entityType] },
    { id: 'country', header: c.country, accessorFn: g => g.country },
    { id: 'region', header: c.region, accessorFn: g => g.region || 'N/A' },
    { id: 'site', header: c.site, accessorFn: g => g.site },
    { id: 'state', header: 'Coverage', accessorFn: g => CELL_TEXT[g.state], cell: ({ row }) => <span className={CELL_TONE[row.original.state]}>{CELL_TEXT[row.original.state]}</span> },
  ], [c, labels])
  async function doExport(kind) {
    setExportMsg('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../lib/exportUtils')
      const { rows, cols, heads } = gapExportRows(gaps, labels)
      const name = reportFileName('Approval Coverage Gaps')
      if (kind === 'excel') await exportToExcel(rows, cols, heads, name)
      else await exportToPdf(rows, cols.map((k, i) => ({ key: k, header: heads[i] })), 'Approval Coverage Gaps', name, 'landscape')
    } catch (e) { setExportMsg(toUserMessage(e, 'The export could not be created.')) }
  }
  return <section className="card space-y-4" aria-label="Coverage check">
    <div><h2 className="font-bold">Coverage check</h2><p className="text-sm text-[var(--text-muted)]">Where a submission would find no published rule. Partial means only a role or person specific rule applies, so some submitters are not routed. Use the simulation below to confirm a specific case.</p></div>
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {[['Live rules', kpis.published], ['Scheduled', kpis.scheduled], ['Drafts', kpis.drafts], ['Types with no rule', kpis.typesWithoutRule], ['Sites with no rule', kpis.siteGaps], ['Sites partly covered', kpis.partialSites]].map(([l, v]) => <KpiTile key={l} label={l} value={v} />)}
    </div>
    <EnterpriseTable columns={matrixColumns} data={coverage.matrix} getRowId={r => r.entityType} enableGlobalFilter={false} enableColumnFilters={false} enableExport={false} enableColumnVisibility={false} initialPageSize={25} emptyMessage="No approval types to show." />
    {!sites.length && <p className="text-sm text-[var(--text-muted)]">No active sites were read, so coverage is judged at country level only.</p>}
    <div className="flex flex-wrap gap-3 items-end">
      <Field label="Search gaps"><input className={inputCls} value={query} onChange={e => setQuery(e.target.value)} /></Field>
      <Field label="Gap type"><select className={inputCls} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="all">{c.all}</option>{APPROVAL_ENTITY_TYPES.map(t => <option key={t} value={t}>{labels[t]}</option>)}</select></Field>
      <Field label="Gap kind"><select className={inputCls} value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="all">{c.all}</option><option value="none">No rule</option><option value="partial">Partial</option></select></Field>
      <button type="button" className={buttonCls} disabled={disabled || !gaps.length} onClick={() => doExport('excel')}><FileSpreadsheet size={14} aria-hidden="true" className="inline me-1.5" />Export gaps Excel</button>
      <button type="button" className={buttonCls} disabled={disabled || !gaps.length} onClick={() => doExport('pdf')}><FileText size={14} aria-hidden="true" className="inline me-1.5" />Export gaps PDF</button>
    </div>
    {exportMsg && <p role="alert" className="text-sm text-red-500">{exportMsg}</p>}
    {!coverage.gaps.length ? <p className="text-sm">Every active site has a published rule for every approval type.</p>
      : <EnterpriseTable columns={gapColumns} data={gaps} getRowId={g => `${g.entityType}:${g.country}:${g.site}`} enableGlobalFilter={false} enableColumnFilters={false} enableExport={false} initialPageSize={25} emptyMessage="No gaps match these filters." />}
  </section>
}

const inputCls = 'min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]'
const buttonCls = 'min-h-11 rounded-lg border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]'
const newStage = () => ({ name: '', approver_role: '', approver_user_id: null, require_signature: true, prevent_self_approval: true, distinct_reviewer: true, sla_hours: null })
const blankPolicy = (country = '') => ({ name: '', entity_type: 'inspection', priority: 0, match_country: country, match_region: '', match_site: '', match_role: '', match_user_id: null, change_reason: '', stages: [newStage()] })
function Field({ label, hint, children }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="font-semibold text-[var(--text-secondary)]">{label}</span>{children}{hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}</label>
}
function PersonPicker({ label, value, onChange, people, copy, blank }) {
  const [query, setQuery] = useState('')
  const filtered = people.filter(p => p.id === value || [p.full_name, p.role, ...(p.sites || [])].join(' ').toLowerCase().includes(query.toLowerCase()))
  return <div className="space-y-1"><Field label={`${copy.peopleSearch}: ${label}`}><input className={inputCls} value={query} onChange={e => setQuery(e.target.value)} /></Field><Field label={label}><select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)}><option value="">{blank || copy.none}</option>{filtered.map(p => <option key={p.id} value={p.id}>{p.full_name}: {p.role}{p.sites?.length ? ` (${p.sites.join(', ')})` : ''}</option>)}</select></Field>{!filtered.length && <p className="text-xs">{copy.noPeople}</p>}</div>
}
export default function ApprovalMatrix() {
  const { activeCountry } = useSettings()
  const { language, isRTL } = useLanguage()
  const { profile } = useAuth()
  const canManage = !!profile?.id && (profile.role === 'Admin' || profile.is_super_admin === true) && profile.locked !== true && profile.approved !== false
  const c = approvalPolicyCopy[language] || approvalPolicyCopy.en
  const k = KPI_COPY[language] || KPI_COPY.en
  const scope = activeCountry && activeCountry !== 'All' ? activeCountry : ''
  const [policies, setPolicies] = useState([])
  const [people, setPeople] = useState([])
  const [sites, setSites] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [partial, setPartial] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [review, setReview] = useState(null)
  const [reason, setReason] = useState('')
  const [effectiveAt, setEffectiveAt] = useState('')
  const [history, setHistory] = useState(null)
  const [test, setTest] = useState({ entity_type: 'inspection', country: scope, region: '', site: '', asset_no: '', role: '', user_id: null })
  const [includeDraft, setIncludeDraft] = useState(false)
  const [preview, setPreview] = useState(null)
  const [coverage, setCoverage] = useState(null)
  const generation = useRef(0)
  const previewGeneration = useRef(0)
  const mutationLock = useRef(false)
  const editorRef = useRef(null)
  const load = useCallback(async () => {
    const token = ++generation.current
    ++previewGeneration.current
    setLoading(true); setError(''); setPreview(null)
    if (!canManage) {
      setPolicies([]); setPeople([]); setSites([]); setRoles([]); setPartial(false); setLoading(false)
      return
    }
    const results = await Promise.allSettled([listApprovalPolicies(), listApprovalPeople(), listSites({ activeOnly: true }), listApprovalRoles(), getApprovalRegionCoverage('inspection')])
    if (token !== generation.current) return
    if (results[0].status === 'fulfilled') setPolicies(results[0].value)
    else { setPolicies([]); setError('unavailable') }
    setPartial(results.slice(1, 4).some(r => r.status === 'rejected'))
    setPeople(results[1].status === 'fulfilled' ? results[1].value : [])
    setSites(results[2].status === 'fulfilled' ? results[2].value : [])
    setRoles(results[3].status === 'fulfilled' ? results[3].value : [])
    // Coverage is a confirmation aid; if it cannot load, the rest of the page still works.
    setCoverage(results[4]?.status === 'fulfilled' ? results[4].value : null)
    setLoading(false)
  }, [canManage])
  useEffect(() => {
    setPolicies([]); setPeople([]); setSites([]); setRoles([]); setForm(null); setReview(null); setHistory(null); setMessage(''); setIncludeDraft(false); setDirty(false); setTest({ entity_type: 'inspection', country: scope, region: '', site: '', asset_no: '', role: '', user_id: null })
    load()
    const requests = generation
    const previews = previewGeneration
    return () => { ++requests.current; ++previews.current }
  }, [load, scope, profile?.org_id, profile?.id, profile?.role, profile?.is_super_admin, profile?.locked, profile?.approved])
  const scopedPolicies = useMemo(() => filterPolicies(policies, { scope, state: stateFilter, search }), [policies, scope, stateFilter, search])
  const users = useMemo(() => Object.fromEntries(people.map(p => [p.id, p])), [people])
  const tableRows = useMemo(() => policyRows(scopedPolicies, { usersById: users, anyLabel: c.anyScope }), [scopedPolicies, users, c.anyScope])
  const kpis = useMemo(() => policyKpis(scopedPolicies), [scopedPolicies])
  const regionSummary = useMemo(() => regionCoverageSummary(coverage), [coverage])
  const disabled = !canManage || busy || loading || !!error || partial
  const draftMatchesTest = !!form?.id && form.entity_type === test.entity_type
  const reviewHasUnsavedChanges = review && dirty && form?.id === review.policy.id
  // Region lives once on the site register; it is never typed free-hand here.
  const regionOptions = country => regionOptionsFor(sites, country)
  const siteOptions = (country, region = '') => siteOptionsFor(sites, country, region)
  const siteRegion = (country, name) => siteRegionFor(sites, country, name)
  const patch = change => { ++previewGeneration.current; setPreview(null); setDirty(true); setForm(f => ({ ...f, ...change })) }
  const changeTest = change => { ++previewGeneration.current; setPreview(null); setTest(t => ({ ...t, ...change })) }
  const openEditor = p => { ++previewGeneration.current; setForm(p); setReview(null); setDirty(!p.id); setIncludeDraft(false); setPreview(null); setMessage(''); requestAnimationFrame(() => editorRef.current?.focus()) }
  async function mutate(action) {
    if (mutationLock.current || disabled) return
    mutationLock.current = true; setBusy(true); setMessage('')
    const token = generation.current
    try { await action(token) } catch (e) { if (token === generation.current) setMessage(toUserMessage(e, c.failed)) }
    finally { mutationLock.current = false; setBusy(false) }
  }
  async function save() {
    if (!validatePolicyDraft(form)) { setMessage(c.validation); return }
    await mutate(async token => {
      const saved = await saveApprovalPolicy(form, form.updated_at || null)
      if (token !== generation.current) return
      setForm(saved); setDirty(false); setMessage(c.saved); await load()
    })
  }
  async function commitReview() {
    if (!reason.trim() || reviewHasUnsavedChanges) return
    await mutate(async token => {
      const fn = review.action === 'publish' ? publishApprovalPolicy : retireApprovalPolicy
      if (review.action === 'publish') await fn(review.policy, reason.trim(), effectiveAt ? new Date(effectiveAt).toISOString() : null)
      else await fn(review.policy, reason.trim())
      if (token !== generation.current) return
      setReview(null); setForm(null); setMessage(c.committed); await load()
    })
  }
  async function showHistory(policy) {
    await mutate(async token => {
      const events = await listApprovalPolicyEvents(policy.id)
      if (token === generation.current) setHistory({ policy, events })
    })
  }
  async function simulate() {
    if (includeDraft && (dirty || !draftMatchesTest)) return
    const token = ++previewGeneration.current
    await mutate(async () => {
      const out = await simulateApprovalPolicy(test, includeDraft && !dirty ? form?.id : null)
      if (token === previewGeneration.current) setPreview(out)
    })
  }
  const labelReviewer = stage => stage.approver_role || users[stage.approver_user_id]?.full_name || c.userUnknown
  const renderStages = stages => <ol className="space-y-2">{(stages || []).map((s, i) => <li key={i} className="rounded-lg border border-[var(--hairline)] p-3"><b>{i + 1}. {s.name}</b><p>{labelReviewer(s)}</p><p className="text-xs text-[var(--text-muted)]">{[s.require_signature && c.signature, s.prevent_self_approval && c.self, s.distinct_reviewer && c.distinct, s.sla_hours ? `${c.sla}: ${s.sla_hours}` : null].filter(Boolean).join(' | ')}</p></li>)}</ol>
  const policyColumns = [
    { id: 'name', header: c.name, accessorFn: r => r.policy.name },
    { id: 'type', header: c.type, accessorFn: r => c[r.policy.entity_type] || r.policy.entity_type },
    { id: 'scope', header: c.scope, accessorFn: r => r.scopeLabel },
    { id: 'stages', header: k.stages, accessorFn: r => r.stageCount, meta: { align: 'right' } },
    { id: 'version', header: c.version, accessorFn: r => r.policy.version, meta: { align: 'right' } },
    { id: 'state', header: c.policies, accessorFn: r => c[r.policy.state] || r.policy.state, cell: ({ row }) => { const p = row.original.policy; return <span>{c[p.state]}{p.effective_at && <time className="block text-xs text-[var(--text-muted)]" dateTime={p.effective_at}>{new Date(p.effective_at).toLocaleString(language)}</time>}</span> } },
    { id: 'actions', header: c.actions, enableSorting: false, meta: { export: false }, cell: ({ row }) => { const p = row.original.policy; return <div className="flex flex-wrap gap-2"><button type="button" className={buttonCls} disabled={disabled} onClick={() => openEditor(p.state === 'draft' ? structuredClone(p) : { ...structuredClone(p), id: undefined, updated_at: undefined, state: 'draft', change_reason: '' })}>{p.state === 'draft' ? c.edit : c.clone}</button><button type="button" className={buttonCls} disabled={disabled} onClick={() => showHistory(p)}>{c.history}</button>{p.state !== 'retired' && <button type="button" className={buttonCls} disabled={disabled || (dirty && form?.id === p.id)} onClick={() => { setReason(''); setEffectiveAt(''); setReview({ policy: p, action: p.state === 'draft' ? 'publish' : 'retire' }) }}>{p.state === 'draft' ? c.publish : c.retire}</button>}</div> } },
  ]
  const regionColumns = [
    { id: 'country', header: c.country, accessorFn: r => r.country },
    { id: 'region', header: c.region, accessorFn: r => r.region || c.noRegionShort },
    { id: 'vehicles', header: c.vehiclesCol, accessorFn: r => (Number.isFinite(Number(r.vehicles)) ? Number(r.vehicles) : null), meta: { align: 'right' }, cell: ({ row }) => (Number.isFinite(Number(row.original.vehicles)) ? Number(row.original.vehicles).toLocaleString() : 'N/A') },
    { id: 'sites', header: c.sitesCol, accessorFn: r => (r.sites || []).filter(Boolean).join(', '), cell: ({ getValue }) => <span className="text-xs text-[var(--text-muted)]">{getValue()}</span> },
    { id: 'route', header: c.routeCol, accessorFn: r => (r.route_status === 'matched' ? r.route : r.route_status === 'ambiguous' ? c.ambiguousShort : c.noPublishedRoute), cell: ({ row }) => (row.original.route_status === 'matched' ? row.original.route : <span className="text-amber-600">{row.original.route_status === 'ambiguous' ? c.ambiguousShort : c.noPublishedRoute}</span>) },
  ]
  if (!canManage) return <div dir={isRTL ? 'rtl' : 'ltr'} className="card" role="alert">{c.accessDenied}</div>
  return <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-5">
    <PageHeader title={c.title} subtitle={c.subtitle} icon={ShieldCheck} actions={<button type="button" className={buttonCls} disabled={busy || loading} onClick={load}><RefreshCw size={14} aria-hidden="true" className={`inline me-1.5 ${loading ? 'animate-spin' : ''}`} />{c.refresh}</button>} />
    <p className="text-sm text-[var(--text-muted)]">{c.unsupported}</p>
    {error && <div role="alert" className="card text-red-500">{c.unavailable} <button className={buttonCls} onClick={load}>{c.retry}</button></div>}
    {partial && <p role="alert" className="card text-amber-600">{c.partial}</p>}
    {message && <p role="status" className="card">{message}</p>}
    <section className="card space-y-4" aria-label={c.policies}>
      <div className="flex flex-wrap gap-3 items-end"><Field label={c.search}><input className={inputCls} value={search} onChange={e => setSearch(e.target.value)} /></Field><Field label={c.policies}><select className={inputCls} value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="">{c.all}</option>{['draft', 'published', 'retired'].map(s => <option key={s} value={s}>{c[s]}</option>)}</select></Field><button className={buttonCls} disabled={disabled} onClick={() => openEditor(blankPolicy(scope))}>{c.new}</button></div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3">
        <KpiTile icon={Layers} label={k.inView} value={loading ? '...' : kpis.total} />
        <KpiTile icon={CheckCircle2} label={k.live} value={loading ? '...' : kpis.live} />
        <KpiTile icon={Clock} label={k.scheduled} value={loading ? '...' : kpis.scheduled} />
        <KpiTile icon={GitBranch} label={k.drafts} value={loading ? '...' : kpis.drafts} tone={kpis.drafts ? 'text-amber-600' : undefined} />
        <KpiTile icon={Archive} label={k.retired} value={loading ? '...' : kpis.retired} />
        <KpiTile icon={Layers} label={k.multi} value={loading ? '...' : kpis.multiStage} />
        <KpiTile icon={Timer} label={k.sla} value={loading ? '...' : kpis.avgSlaHours == null ? k.notSet : `${kpis.avgSlaHours} ${k.hours}`} sub={!loading && kpis.avgSlaHours == null ? k.noSla : null} />
      </div>
      {loading ? <p role="status">{c.loading}</p> : !error && !scopedPolicies.length ? <p>{c.empty}</p> : !error && <EnterpriseTable
        columns={policyColumns}
        data={tableRows}
        getRowId={r => String(r.id)}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        initialPageSize={25}
        exportFileName="Approval Policies"
        reportMeta={{ title: 'Approval Policies' }}
        emptyMessage={c.empty}
      />}
    </section>
    {!loading && !error && <CoverageCheck policies={policies} sites={sites} countries={scope ? [scope] : COUNTRIES} c={c} disabled={busy} />}
    {form && <section ref={editorRef} tabIndex={-1} className="card space-y-4" aria-label={c.editor}><div className="flex justify-between"><h2 className="font-bold">{c.editor}</h2><button className={buttonCls} disabled={busy} onClick={() => { setForm(null); setIncludeDraft(false); setPreview(null) }}>{c.close}</button></div><fieldset disabled={disabled} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={c.name}><input className={inputCls} value={form.name} maxLength={160} onChange={e => patch({ name: e.target.value })} /></Field>
      <Field label={c.type}><select className={inputCls} value={form.entity_type} onChange={e => patch({ entity_type: e.target.value })}>{['inspection', 'checklist', 'work_order', 'tyre_change'].map(t => <option key={t} value={t}>{c[t]}</option>)}</select></Field>
      <Field label={c.priority} hint={c.priorityHint}><input className={inputCls} type="number" min="0" max="10000" step="1" value={form.priority} onChange={e => patch({ priority: Number(e.target.value) })} /></Field>
      <Field label={c.country}><select className={inputCls} value={form.match_country || ''} onChange={e => patch({ match_country: e.target.value || null, match_region: null, match_site: null })}><option value="">{c.anyCountry}</option>{COUNTRIES.map(t => <option key={t}>{t}</option>)}</select></Field>
      <Field label={c.region} hint={c.regionHint}><select className={inputCls} disabled={!regionOptions(form.match_country).length} value={form.match_region || ''} onChange={e => patch({ match_region: e.target.value || null, match_site: null })}><option value="">{c.anyRegion}</option>{regionOptions(form.match_country).map(r => <option key={r} value={r}>{r}</option>)}</select></Field>
      <Field label={c.site} hint={c.countryFirst}><select className={inputCls} disabled={!form.match_country} value={form.match_site || ''} onChange={e => { const site = e.target.value || null; patch({ match_site: site, match_region: site ? (siteRegion(form.match_country, site) || null) : form.match_region }) }}><option value="">{c.anySite}</option>{siteOptions(form.match_country, form.match_region || '').map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
      <Field label={c.role}><select className={inputCls} value={form.match_role || ''} onChange={e => patch({ match_role: e.target.value || null })}><option value="">{c.anyRole}</option>{roles.map(r => <option key={r}>{r}</option>)}</select></Field>
      <PersonPicker label={c.person} value={form.match_user_id} onChange={id => patch({ match_user_id: id })} people={people} copy={c} blank={c.anyPerson} />
    </div><h3 className="font-bold">{c.stages}</h3><p className="text-sm text-[var(--text-muted)]">{c.eligibilityHint}</p>{form.stages.map((s, i) => <div key={i} className="rounded-lg border border-[var(--hairline)] p-3 space-y-3"><div className="flex justify-between items-center"><h4>{c.stage} {i + 1}</h4><button className={buttonCls} disabled={form.stages.length === 1} onClick={() => patch({ stages: form.stages.filter((_, n) => n !== i) })}>{c.removeStage}</button></div><div className="grid gap-3 sm:grid-cols-2">
      <Field label={c.stageName}><input className={inputCls} value={s.name} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, name: e.target.value } : v) })} /></Field>
      <Field label={c.reviewerRole}><select className={inputCls} value={s.approver_role || ''} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, approver_role: e.target.value || null, approver_user_id: null } : v) })}><option value="">{c.none}</option>{roles.map(r => <option key={r}>{r}</option>)}</select></Field>
      <PersonPicker label={c.reviewerPerson} value={s.approver_user_id} onChange={id => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, approver_user_id: id, approver_role: null } : v) })} people={people} copy={c} />
      <Field label={c.sla} hint={c.slaHint}><input className={inputCls} type="number" min="1" max="8760" step="1" value={s.sla_hours ?? ''} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, sla_hours: e.target.value === '' ? null : Number(e.target.value) } : v) })} /></Field>
    </div><p className="text-sm text-[var(--text-secondary)]">{c.signature} | {c.self}</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.distinct_reviewer !== false} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, distinct_reviewer: e.target.checked } : v) })} />{c.distinct}</label></div>)}<button className={buttonCls} disabled={form.stages.length >= 5} onClick={() => patch({ stages: [...form.stages, newStage()] })}>{c.addStage}</button><Field label={c.reason} hint={c.reasonHint}><textarea className={inputCls} value={form.change_reason || ''} maxLength={2000} onChange={e => patch({ change_reason: e.target.value })} /></Field><button className={buttonCls} onClick={save}>{busy ? c.saving : c.save}</button></fieldset></section>}
    {review && <section className="card space-y-3" aria-label={c.reviewTitle}><h2 className="font-bold">{c.reviewTitle}: {c[review.action]}</h2><p>{review.policy.name} | {c.version} {review.policy.version}</p><p className="text-sm">{c.reviewHint}</p>{renderStages(review.policy.stages)}{reviewHasUnsavedChanges && <p role="alert">{c.unsaved}</p>}{review.action === 'publish' && <><p className="text-sm">{c.separatePublisher}</p><Field label={c.effective} hint={c.effectiveHint}><input type="datetime-local" className={inputCls} value={effectiveAt} onChange={e => setEffectiveAt(e.target.value)} /></Field></>}<Field label={c.reason}><textarea className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} /></Field><div className="flex gap-2"><button className={buttonCls} disabled={disabled || reviewHasUnsavedChanges || !reason.trim() || (review.action === 'publish' && review.policy.created_by === profile?.id)} onClick={commitReview}>{c.confirm}</button><button className={buttonCls} disabled={busy} onClick={() => setReview(null)}>{c.cancel}</button></div></section>}
    {history && <section className="card space-y-3" aria-label={c.history}><div className="flex justify-between"><h2>{c.history}: {history.policy.name}</h2><button className={buttonCls} onClick={() => setHistory(null)}>{c.close}</button></div>{!history.events.length ? <p>{c.eventsEmpty}</p> : <ol className="space-y-3">{history.events.map(event => <li key={event.id} className="border-b border-[var(--hairline)] pb-2"><p>{c[event.action] || event.action} | {new Date(event.created_at).toLocaleString(language)}</p><p>{c.actor}: {users[event.actor_id]?.full_name || c.userUnknown}</p><p>{event.reason}</p></li>)}</ol>}</section>}
    {coverage && <section className="card space-y-3" aria-label={c.coverage}><h2 className="font-bold">{c.coverage}</h2><p className="text-sm text-[var(--text-muted)]">{c.coverageHint}</p><div className="grid grid-cols-2 md:grid-cols-4 gap-3"><KpiTile label={k.regions} value={regionSummary.regions} /><KpiTile label={k.routed} value={`${regionSummary.matched} / ${regionSummary.regions}`} /><KpiTile label={k.unrouted} value={regionSummary.vehiclesUnrouted.toLocaleString()} tone={regionSummary.vehiclesUnrouted ? 'text-amber-600' : undefined} /><KpiTile label={k.unmapped} value={regionSummary.unmappedSites} tone={regionSummary.unmappedSites ? 'text-amber-600' : undefined} /></div><EnterpriseTable columns={regionColumns} data={coverage.regions || []} getRowId={r => `${r.country}:${r.region}`} enableGlobalFilter={false} enableColumnFilters={false} initialPageSize={25} exportFileName="Approval Regional Coverage" reportMeta={{ title: 'Approval Regional Coverage' }} emptyMessage="No vehicle regions were returned for this scope." />{coverage.unmapped_sites?.length > 0 && <p role="alert" className="text-sm text-amber-600">{c.unmappedSites}: {coverage.unmapped_sites.map(u => `${u.site} (${u.vehicles})`).join(', ')}. <Link className="underline" to="/sites">{c.openSites}</Link></p>}</section>}
    <section className="card space-y-3" aria-label={c.simulation}><h2 className="font-bold">{c.simulation}</h2><p className="text-sm text-[var(--text-muted)]">{c.simulationHint}</p><fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label={c.type}><select className={inputCls} value={test.entity_type} onChange={e => changeTest({ entity_type: e.target.value })}>{['inspection', 'checklist', 'work_order', 'tyre_change'].map(t => <option key={t} value={t}>{c[t]}</option>)}</select></Field><Field label={c.country}><select className={inputCls} value={test.country} onChange={e => changeTest({ country: e.target.value, region: '', site: '' })}><option value="">{c.anyCountry}</option>{COUNTRIES.map(t => <option key={t}>{t}</option>)}</select></Field><Field label={c.region}><select className={inputCls} disabled={!regionOptions(test.country).length} value={test.region} onChange={e => changeTest({ region: e.target.value, site: '' })}><option value="">{c.anyRegion}</option>{regionOptions(test.country).map(r => <option key={r} value={r}>{r}</option>)}</select></Field><Field label={c.site}><select className={inputCls} disabled={!test.country} value={test.site} onChange={e => { const site = e.target.value; changeTest({ site, region: site ? siteRegion(test.country, site) : test.region }) }}><option value="">{c.anySite}</option>{siteOptions(test.country, test.region).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field><Field label={c.role}><select className={inputCls} value={test.role} onChange={e => changeTest({ role: e.target.value })}><option value="">{c.anyRole}</option>{roles.map(r => <option key={r}>{r}</option>)}</select></Field><Field label={c.vehicle} hint={c.vehicleHint}><input className={inputCls} value={test.asset_no} maxLength={40} onChange={e => changeTest({ asset_no: e.target.value })} /></Field><PersonPicker label={c.person} value={test.user_id} onChange={id => changeTest({ user_id: id })} people={people} copy={c} blank={c.anyPerson} /></fieldset>{form?.id && <label className="flex gap-2 min-h-11 items-center"><input type="checkbox" disabled={disabled || dirty || !draftMatchesTest} checked={includeDraft} onChange={e => { ++previewGeneration.current; setPreview(null); setIncludeDraft(e.target.checked) }} />{c.includeDraft}</label>}{form?.id && !draftMatchesTest && <p className="text-sm">{c.draftModuleMismatch}</p>}{form && dirty && <p className="text-sm">{c.unsaved}</p>}<button className={buttonCls} disabled={disabled || (includeDraft && (dirty || !draftMatchesTest))} onClick={simulate}>{busy ? c.saving : c.run}</button>{preview && <div role="status" className="space-y-3"><p>{c.mode}: {c[preview.mode] || preview.mode}</p><p>{c[preview.status]}</p>{preview.region && <p className="text-sm">{c.resolvedRegion}: {preview.region}{preview.region_basis === 'vehicle_base_site' ? ` (${c.fromVehicle} ${preview.vehicle_base_site})` : preview.region_basis === 'document_site' ? ` (${c.fromSite})` : ''}</p>}{preview.region_basis === 'none' && <p className="text-sm">{c.noRegion}</p>}{preview.policy && <><p className="font-bold">{preview.policy.name} | {c.version} {preview.policy.version}</p>{renderStages(preview.policy.stages)}</>}<p>{c.candidates}: {preview.candidates?.length || 0}</p><ul className="space-y-2 text-sm">{preview.candidates?.map(candidate => <li key={candidate.id} className="border-t border-[var(--hairline)] pt-2"><b>{candidate.name}</b> | {c.priority}: {candidate.priority} | {c.matchStrength}: {candidate.specificity} | {candidate.rank === 1 ? c.topRank : c.lowerRank}</li>)}</ul></div>}</section>
  </div>
}
