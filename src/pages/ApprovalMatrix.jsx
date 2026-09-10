import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ShieldCheck } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { listApprovalPolicies, listApprovalPeople, listApprovalRoles, saveApprovalPolicy, publishApprovalPolicy, retireApprovalPolicy, simulateApprovalPolicy, listApprovalPolicyEvents } from '../lib/api/approvalMatrix'
import { listSites } from '../lib/api/sites'
import { approvalPolicyCopy } from '../lib/approvalPolicyCopy'
import { toUserMessage } from '../lib/safeError'

const inputCls = 'min-h-11 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)] w-full'
const buttonCls = 'min-h-11 rounded-lg border border-[var(--input-border)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40'
const newStage = () => ({ name: '', approver_role: '', approver_user_id: null, require_signature: true, prevent_self_approval: true, distinct_reviewer: true, sla_hours: null })
const blankPolicy = (country = '') => ({ name: '', entity_type: 'inspection', priority: 0, match_country: country, match_site: '', match_role: '', match_user_id: null, change_reason: '', stages: [newStage()] })
function Field({ label, hint, children }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="font-semibold text-[var(--text-secondary)]">{label}</span>{children}{hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}</label>
}
function PersonPicker({ label, value, onChange, people, copy, blank }) {
  const [query, setQuery] = useState('')
  const filtered = people.filter(p => p.id === value || [p.full_name, p.role, ...(p.sites || [])].join(' ').toLowerCase().includes(query.toLowerCase()))
  return <div className="space-y-1"><Field label={`${copy.peopleSearch}: ${label}`}><input className={inputCls} value={query} onChange={e => setQuery(e.target.value)} /></Field><Field label={label}><select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value || null)}><option value="">{blank || copy.none}</option>{filtered.map(p => <option key={p.id} value={p.id}>{p.full_name} — {p.role}{p.sites?.length ? ` — ${p.sites.join(', ')}` : ''}</option>)}</select></Field>{!filtered.length && <p className="text-xs">{copy.noPeople}</p>}</div>
}
export default function ApprovalMatrix() {
  const { activeCountry } = useSettings()
  const { language, isRTL } = useLanguage()
  const { profile } = useAuth()
  const canManage = !!profile?.id && (profile.role === 'Admin' || profile.is_super_admin === true) && profile.locked !== true && profile.approved !== false
  const c = approvalPolicyCopy[language] || approvalPolicyCopy.en
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
  const [test, setTest] = useState({ entity_type: 'inspection', country: scope, site: '', role: '', user_id: null })
  const [includeDraft, setIncludeDraft] = useState(false)
  const [preview, setPreview] = useState(null)
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
    const results = await Promise.allSettled([listApprovalPolicies(), listApprovalPeople(), listSites({ activeOnly: true }), listApprovalRoles()])
    if (token !== generation.current) return
    if (results[0].status === 'fulfilled') setPolicies(results[0].value)
    else { setPolicies([]); setError('unavailable') }
    setPartial(results.slice(1).some(r => r.status === 'rejected'))
    setPeople(results[1].status === 'fulfilled' ? results[1].value : [])
    setSites(results[2].status === 'fulfilled' ? results[2].value : [])
    setRoles(results[3].status === 'fulfilled' ? results[3].value : [])
    setLoading(false)
  }, [canManage])
  useEffect(() => {
    setPolicies([]); setPeople([]); setSites([]); setRoles([]); setForm(null); setReview(null); setHistory(null); setMessage(''); setIncludeDraft(false); setDirty(false); setTest({ entity_type: 'inspection', country: scope, site: '', role: '', user_id: null })
    load()
    const requests = generation
    const previews = previewGeneration
    return () => { ++requests.current; ++previews.current }
  }, [load, scope, profile?.org_id, profile?.id, profile?.role, profile?.is_super_admin, profile?.locked, profile?.approved])
  const scopedPolicies = useMemo(() => policies.filter(p => (!scope || !p.match_country || p.match_country === scope) && (!stateFilter || p.state === stateFilter) && [p.name, p.entity_type, p.match_site, p.match_country].join(' ').toLowerCase().includes(search.toLowerCase())), [policies, scope, stateFilter, search])
  const pager = usePagedRows(scopedPolicies)
  const users = useMemo(() => Object.fromEntries(people.map(p => [p.id, p])), [people])
  const disabled = !canManage || busy || loading || !!error || partial
  const draftMatchesTest = !!form?.id && form.entity_type === test.entity_type
  const reviewHasUnsavedChanges = review && dirty && form?.id === review.policy.id
  const siteOptions = country => sites.filter(s => country && s.country === country && s.active !== false)
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
    if (!form.name.trim() || !form.change_reason.trim() || !Number.isInteger(Number(form.priority)) || Number(form.priority) < 0 || Number(form.priority) > 10000 || !form.stages.length || form.stages.length > 5 || form.stages.some(s => !s.name.trim() || Boolean(s.approver_role) === Boolean(s.approver_user_id) || (s.sla_hours != null && (!Number.isInteger(Number(s.sla_hours)) || Number(s.sla_hours) < 1 || Number(s.sla_hours) > 8760)))) { setMessage(c.validation); return }
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
  const renderStages = stages => <ol className="space-y-2">{(stages || []).map((s, i) => <li key={i} className="rounded-lg border border-[var(--hairline)] p-3"><b>{i + 1}. {s.name}</b><p>{labelReviewer(s)}</p><p className="text-xs text-[var(--text-muted)]">{s.require_signature && c.signature} · {s.prevent_self_approval && c.self} · {s.distinct_reviewer && c.distinct}{s.sla_hours ? ` · ${c.sla}: ${s.sla_hours}` : ''}</p></li>)}</ol>
  if (!canManage) return <div dir={isRTL ? 'rtl' : 'ltr'} className="card" role="alert">{c.accessDenied}</div>
  return <div dir={isRTL ? 'rtl' : 'ltr'} className="space-y-5">
    <PageHeader title={c.title} subtitle={c.subtitle} icon={ShieldCheck} actions={<button className={buttonCls} disabled={busy || loading} onClick={load}>{c.refresh}</button>} />
    <p className="text-sm text-[var(--text-muted)]">{c.unsupported}</p>
    {error && <div role="alert" className="card text-red-500">{c.unavailable} <button className={buttonCls} onClick={load}>{c.retry}</button></div>}
    {partial && <p role="alert" className="card text-amber-600">{c.partial}</p>}
    {message && <p role="status" className="card">{message}</p>}
    <section className="card space-y-4" aria-label={c.policies}>
      <div className="flex flex-wrap gap-3 items-end"><Field label={c.search}><input className={inputCls} value={search} onChange={e => setSearch(e.target.value)} /></Field><Field label={c.policies}><select className={inputCls} value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="">{c.all}</option>{['draft', 'published', 'retired'].map(s => <option key={s} value={s}>{c[s]}</option>)}</select></Field><button className={buttonCls} disabled={disabled} onClick={() => openEditor(blankPolicy(scope))}>{c.new}</button></div>
      {loading ? <p role="status">{c.loading}</p> : !error && !scopedPolicies.length ? <p>{c.empty}</p> : <><div className="overflow-x-auto"><table className="w-full text-sm text-start"><thead><tr>{[c.name, c.type, c.scope, c.version, c.policies, c.actions].map((h, i) => <th key={i} className="p-2 text-start">{h}</th>)}</tr></thead><tbody>{pager.pageRows.map(p => <tr key={p.id} className="border-t border-[var(--hairline)]"><td className="p-2">{p.name}</td><td className="p-2">{c[p.entity_type]}</td><td className="p-2">{[p.match_country, p.match_site, p.match_role, users[p.match_user_id]?.full_name].filter(Boolean).join(' · ') || c.anyScope}</td><td className="p-2">{p.version}</td><td className="p-2">{c[p.state]}{p.effective_at && <time className="block text-xs text-[var(--text-muted)]" dateTime={p.effective_at}>{new Date(p.effective_at).toLocaleString(language)}</time>}</td><td className="p-2"><div className="flex flex-wrap gap-2"><button className={buttonCls} disabled={disabled} onClick={() => openEditor(p.state === 'draft' ? structuredClone(p) : { ...structuredClone(p), id: undefined, updated_at: undefined, state: 'draft', change_reason: '' })}>{p.state === 'draft' ? c.edit : c.clone}</button><button className={buttonCls} disabled={disabled} onClick={() => showHistory(p)}>{c.history}</button>{p.state !== 'retired' && <button className={buttonCls} disabled={disabled || (dirty && form?.id === p.id)} onClick={() => { setReason(''); setEffectiveAt(''); setReview({ policy: p, action: p.state === 'draft' ? 'publish' : 'retire' }) }}>{p.state === 'draft' ? c.publish : c.retire}</button>}</div></td></tr>)}</tbody></table></div><TablePagination {...pager} /></>}
    </section>
    {form && <section ref={editorRef} tabIndex={-1} className="card space-y-4" aria-label={c.editor}><div className="flex justify-between"><h2 className="font-bold">{c.editor}</h2><button className={buttonCls} disabled={busy} onClick={() => { setForm(null); setIncludeDraft(false); setPreview(null) }}>{c.close}</button></div><fieldset disabled={disabled} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={c.name}><input className={inputCls} value={form.name} maxLength={160} onChange={e => patch({ name: e.target.value })} /></Field>
      <Field label={c.type}><select className={inputCls} value={form.entity_type} onChange={e => patch({ entity_type: e.target.value })}>{['inspection', 'checklist', 'work_order', 'tyre_change'].map(t => <option key={t} value={t}>{c[t]}</option>)}</select></Field>
      <Field label={c.priority} hint={c.priorityHint}><input className={inputCls} type="number" min="0" max="10000" step="1" value={form.priority} onChange={e => patch({ priority: Number(e.target.value) })} /></Field>
      <Field label={c.country}><select className={inputCls} value={form.match_country || ''} onChange={e => patch({ match_country: e.target.value || null, match_site: null })}><option value="">{c.anyCountry}</option>{COUNTRIES.map(t => <option key={t}>{t}</option>)}</select></Field>
      <Field label={c.site} hint={c.countryFirst}><select className={inputCls} disabled={!form.match_country} value={form.match_site || ''} onChange={e => patch({ match_site: e.target.value || null })}><option value="">{c.anySite}</option>{siteOptions(form.match_country).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
      <Field label={c.role}><select className={inputCls} value={form.match_role || ''} onChange={e => patch({ match_role: e.target.value || null })}><option value="">{c.anyRole}</option>{roles.map(r => <option key={r}>{r}</option>)}</select></Field>
      <PersonPicker label={c.person} value={form.match_user_id} onChange={id => patch({ match_user_id: id })} people={people} copy={c} blank={c.anyPerson} />
    </div><h3 className="font-bold">{c.stages}</h3><p className="text-sm text-[var(--text-muted)]">{c.eligibilityHint}</p>{form.stages.map((s, i) => <div key={i} className="rounded-lg border border-[var(--hairline)] p-3 space-y-3"><div className="flex justify-between items-center"><h4>{c.stage} {i + 1}</h4><button className={buttonCls} disabled={form.stages.length === 1} onClick={() => patch({ stages: form.stages.filter((_, n) => n !== i) })}>{c.removeStage}</button></div><div className="grid gap-3 sm:grid-cols-2">
      <Field label={c.stageName}><input className={inputCls} value={s.name} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, name: e.target.value } : v) })} /></Field>
      <Field label={c.reviewerRole}><select className={inputCls} value={s.approver_role || ''} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, approver_role: e.target.value || null, approver_user_id: null } : v) })}><option value="">{c.none}</option>{roles.map(r => <option key={r}>{r}</option>)}</select></Field>
      <PersonPicker label={c.reviewerPerson} value={s.approver_user_id} onChange={id => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, approver_user_id: id, approver_role: null } : v) })} people={people} copy={c} />
      <Field label={c.sla} hint={c.slaHint}><input className={inputCls} type="number" min="1" max="8760" step="1" value={s.sla_hours ?? ''} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, sla_hours: e.target.value === '' ? null : Number(e.target.value) } : v) })} /></Field>
    </div><p className="text-sm text-[var(--text-secondary)]">{c.signature} · {c.self}</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={s.distinct_reviewer !== false} onChange={e => patch({ stages: form.stages.map((v, n) => n === i ? { ...v, distinct_reviewer: e.target.checked } : v) })} />{c.distinct}</label></div>)}<button className={buttonCls} disabled={form.stages.length >= 5} onClick={() => patch({ stages: [...form.stages, newStage()] })}>{c.addStage}</button><Field label={c.reason} hint={c.reasonHint}><textarea className={inputCls} value={form.change_reason || ''} maxLength={2000} onChange={e => patch({ change_reason: e.target.value })} /></Field><button className={buttonCls} onClick={save}>{busy ? c.saving : c.save}</button></fieldset></section>}
    {review && <section className="card space-y-3" aria-label={c.reviewTitle}><h2 className="font-bold">{c.reviewTitle}: {c[review.action]}</h2><p>{review.policy.name} · {c.version} {review.policy.version}</p><p className="text-sm">{c.reviewHint}</p>{renderStages(review.policy.stages)}{reviewHasUnsavedChanges && <p role="alert">{c.unsaved}</p>}{review.action === 'publish' && <><p className="text-sm">{c.separatePublisher}</p><Field label={c.effective} hint={c.effectiveHint}><input type="datetime-local" className={inputCls} value={effectiveAt} onChange={e => setEffectiveAt(e.target.value)} /></Field></>}<Field label={c.reason}><textarea className={inputCls} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} /></Field><div className="flex gap-2"><button className={buttonCls} disabled={disabled || reviewHasUnsavedChanges || !reason.trim() || (review.action === 'publish' && review.policy.created_by === profile?.id)} onClick={commitReview}>{c.confirm}</button><button className={buttonCls} disabled={busy} onClick={() => setReview(null)}>{c.cancel}</button></div></section>}
    {history && <section className="card space-y-3" aria-label={c.history}><div className="flex justify-between"><h2>{c.history}: {history.policy.name}</h2><button className={buttonCls} onClick={() => setHistory(null)}>{c.close}</button></div>{!history.events.length ? <p>{c.eventsEmpty}</p> : <ol className="space-y-3">{history.events.map(event => <li key={event.id} className="border-b border-[var(--hairline)] pb-2"><p>{c[event.action] || event.action} · {new Date(event.created_at).toLocaleString(language)}</p><p>{c.actor}: {users[event.actor_id]?.full_name || c.userUnknown}</p><p>{event.reason}</p></li>)}</ol>}</section>}
    <section className="card space-y-3" aria-label={c.simulation}><h2 className="font-bold">{c.simulation}</h2><p className="text-sm text-[var(--text-muted)]">{c.simulationHint}</p><fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label={c.type}><select className={inputCls} value={test.entity_type} onChange={e => changeTest({ entity_type: e.target.value })}>{['inspection', 'checklist', 'work_order', 'tyre_change'].map(t => <option key={t} value={t}>{c[t]}</option>)}</select></Field><Field label={c.country}><select className={inputCls} value={test.country} onChange={e => changeTest({ country: e.target.value, site: '' })}><option value="">{c.anyCountry}</option>{COUNTRIES.map(t => <option key={t}>{t}</option>)}</select></Field><Field label={c.site}><select className={inputCls} disabled={!test.country} value={test.site} onChange={e => changeTest({ site: e.target.value })}><option value="">{c.anySite}</option>{siteOptions(test.country).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field><Field label={c.role}><select className={inputCls} value={test.role} onChange={e => changeTest({ role: e.target.value })}><option value="">{c.anyRole}</option>{roles.map(r => <option key={r}>{r}</option>)}</select></Field><PersonPicker label={c.person} value={test.user_id} onChange={id => changeTest({ user_id: id })} people={people} copy={c} blank={c.anyPerson} /></fieldset>{form?.id && <label className="flex gap-2 min-h-11 items-center"><input type="checkbox" disabled={disabled || dirty || !draftMatchesTest} checked={includeDraft} onChange={e => { ++previewGeneration.current; setPreview(null); setIncludeDraft(e.target.checked) }} />{c.includeDraft}</label>}{form?.id && !draftMatchesTest && <p className="text-sm">{c.draftModuleMismatch}</p>}{form && dirty && <p className="text-sm">{c.unsaved}</p>}<button className={buttonCls} disabled={disabled || (includeDraft && (dirty || !draftMatchesTest))} onClick={simulate}>{busy ? c.saving : c.run}</button>{preview && <div role="status" className="space-y-3"><p>{c.mode}: {c[preview.mode] || preview.mode}</p><p>{c[preview.status]}</p>{preview.policy && <><p className="font-bold">{preview.policy.name} · {c.version} {preview.policy.version}</p>{renderStages(preview.policy.stages)}</>}<p>{c.candidates}: {preview.candidates?.length || 0}</p><ul className="space-y-2 text-sm">{preview.candidates?.map(candidate => <li key={candidate.id} className="border-t border-[var(--hairline)] pt-2"><b>{candidate.name}</b> · {c.priority}: {candidate.priority} · {c.matchStrength}: {candidate.specificity} · {candidate.rank === 1 ? c.topRank : c.lowerRank}</li>)}</ul></div>}</section>
  </div>
}
