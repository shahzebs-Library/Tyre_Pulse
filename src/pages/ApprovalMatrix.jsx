/**
 * Approval Matrix - who approves what, set by an admin.
 *
 * Three routing styles coexist and the NARROWEST matching rule wins:
 *   named person > site > role
 * A blank match field means "any", so one broad fallback plus a few narrow
 * exceptions covers a whole fleet without a row per person.
 *
 * The preview asks the SERVER (resolve_approvers) rather than recomputing in the
 * browser, so what an admin is shown is what the database will actually do.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { ShieldCheck, Plus, Trash2, RefreshCcw, Play, AlertTriangle } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import {
  listApprovalRules, createApprovalRule, updateApprovalRule,
  deleteApprovalRule, previewApprovers,
} from '../lib/api/approvalMatrix'
import { listSites } from '../lib/api/sites'
import { listAssignableRoles, ASSIGNABLE_BUILTIN_ROLES } from '../lib/api/customRoles'
import { ENTITY_TYPES, entityLabel, scopeLabel, approverLabel, validateRule, specificity } from '../lib/approvalMatrix'
import { toUserMessage } from '../lib/safeError'

/**
 * Roles come from the database, not a list typed here. The hardcoded seven left
 * out every custom job title this company created - Tyre Data Collector, Tire
 * Planning Engineer, Workshop Maintenance Area Manager and four more - so an
 * approval could not be routed to roles a third of the staff actually hold,
 * which is why this page looked like it could not set anything.
 */
const FALLBACK_ROLES = ASSIGNABLE_BUILTIN_ROLES

const BLANK = {
  entity_type: 'inspection', match_country: '', match_site: '', match_role: '',
  approver_role: 'Manager', approver_user_id: '', level: 1, escalate_after_days: '', note: '',
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-tertiary)]">{hint}</span>}
    </label>
  )
}

const inputCls = 'rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2.5 py-1.5 text-sm text-[var(--text-primary)]'

export default function ApprovalMatrix() {
  const { activeCountry } = useSettings()
  const [rules, setRules] = useState([])
  const [sites, setSites] = useState([])
  const [roles, setRoles] = useState(FALLBACK_ROLES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState(BLANK)

  // Preview state
  // Seed the preview with the country the admin is already looking at, so the
  // first run answers for their own scope instead of every country at once.
  // 'All' is a scope, not a country, so it seeds blank (= any).
  const [test, setTest] = useState({
    entity_type: 'inspection',
    country: activeCountry && activeCountry !== 'All' ? activeCountry : '',
    site: '',
    role: 'Tyre Man',
  })
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [r, s, ro] = await Promise.all([
        listApprovalRules(),
        listSites().catch(() => []),
        // Never let an unreadable role list blank the pickers - the built-ins
        // alone are still a usable page, an empty dropdown is not.
        listAssignableRoles().catch(() => FALLBACK_ROLES),
      ])
      setRules(r)
      setSites(Array.isArray(s) ? s : [])
      setRoles(Array.isArray(ro) && ro.length ? ro : FALLBACK_ROLES)
    } catch (e) {
      setError(toUserMessage(e, 'Could not load the approval matrix.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const siteNames = useMemo(
    () => [...new Set(sites.map((s) => s.name || s.site_name).filter(Boolean))].sort(),
    [sites],
  )

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  async function addRule() {
    const errs = validateRule(form)
    if (errs.length) { setMsg(errs[0]); return }
    setSaving(true); setMsg('')
    try {
      await createApprovalRule(form)
      setForm(BLANK)
      setMsg('Rule added.')
      await load()
    } catch (e) { setMsg(toUserMessage(e, 'Could not save the rule.')) }
    finally { setSaving(false) }
  }

  async function toggle(rule) {
    try { await updateApprovalRule(rule.id, { active: !rule.active }); await load() }
    catch (e) { setMsg(toUserMessage(e, 'Could not update the rule.')) }
  }

  async function remove(rule) {
    if (!window.confirm(`Delete this rule? ${entityLabel(rule.entity_type)} - ${scopeLabel(rule)}`)) return
    try { await deleteApprovalRule(rule.id); await load() }
    catch (e) { setMsg(toUserMessage(e, 'Could not delete the rule.')) }
  }

  async function runPreview() {
    setPreview(null)
    try {
      const out = await previewApprovers({
        entityType: test.entity_type,
        country: test.country,
        site: test.site,
        role: test.role,
      })
      setPreview(out)
    } catch (e) { setMsg(toUserMessage(e, 'Could not run the preview.')) }
  }

  const grouped = useMemo(() => {
    const by = {}
    for (const r of rules) (by[r.entity_type] ||= []).push(r)
    for (const k of Object.keys(by)) {
      by[k].sort((a, b) => (a.level || 1) - (b.level || 1) || specificity(b) - specificity(a))
    }
    return by
  }, [rules])

  // A rule with nothing pinned catches everything; without one, a submission
  // that matches no rule has no approver at all - worth saying out loud.
  const missingFallback = useMemo(() => {
    const covered = new Set(rules.filter((r) => r.active !== false && specificity(r) === 0).map((r) => r.entity_type))
    return ENTITY_TYPES.filter((e) => rules.some((r) => r.entity_type === e.key) && !covered.has(e.key))
  }, [rules])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Approval Matrix"
        subtitle="Who signs what. The most specific rule wins: a named person beats a site rule, which beats a role rule."
        icon={ShieldCheck}
        actions={(
          <button type="button" onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
            <RefreshCcw size={14} /> Refresh
          </button>
        )}
      />

      {error && (
        <div className="card border-red-500/40 text-sm text-red-400">
          {error} <button type="button" className="underline ml-2" onClick={load}>Retry</button>
        </div>
      )}

      {/* ── Add a rule ─────────────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">Add a rule</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="What needs approving">
            <select className={inputCls} value={form.entity_type} onChange={(e) => set({ entity_type: e.target.value })}>
              {ENTITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Country" hint="Blank = any">
            <select className={inputCls} value={form.match_country} onChange={(e) => set({ match_country: e.target.value })}>
              <option value="">Any country</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Site" hint="Blank = any">
            <select className={inputCls} value={form.match_site} onChange={(e) => set({ match_site: e.target.value })}>
              <option value="">Any site</option>
              {siteNames.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Submitted by role" hint="Blank = any">
            <select className={inputCls} value={form.match_role} onChange={(e) => set({ match_role: e.target.value })}>
              <option value="">Any role</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Approved by role" hint="Leave blank if naming a person">
            <select className={inputCls} value={form.approver_role}
              onChange={(e) => set({ approver_role: e.target.value, approver_user_id: '' })}>
              <option value="">-- none --</option>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Level" hint="1 = first signer">
            <select className={inputCls} value={form.level} onChange={(e) => set({ level: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Escalate after (days)" hint="Blank = never escalate">
            <input className={inputCls} type="number" min="1" value={form.escalate_after_days}
              onChange={(e) => set({ escalate_after_days: e.target.value })} placeholder="e.g. 3" />
          </Field>
          <Field label="Note">
            <input className={inputCls} value={form.note} onChange={(e) => set({ note: e.target.value })}
              placeholder="why this rule exists" />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={addRule} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            <Plus size={14} /> {saving ? 'Saving...' : 'Add rule'}
          </button>
          {msg && <span className="text-xs text-[var(--text-tertiary)]">{msg}</span>}
        </div>
      </div>

      {missingFallback.length > 0 && (
        <div className="card border-amber-500/40 flex items-start gap-2 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <b>No catch-all rule</b> for {missingFallback.map((e) => e.label).join(', ')}. A submission that
            matches no rule has nobody to approve it. Add a rule with every match field left blank as the fallback.
          </div>
        </div>
      )}

      {/* ── Existing rules ─────────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-3">Rules</h2>
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading...</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No rules yet. Until one exists, approvals follow whatever the app did before.
          </p>
        ) : Object.entries(grouped).map(([type, list]) => (
          <div key={type} className="mb-5 last:mb-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{entityLabel(type)}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--hairline)]">
                    <th className="py-1.5 pr-3 font-semibold">Applies to</th>
                    <th className="py-1.5 px-3 font-semibold">Approved by</th>
                    <th className="py-1.5 px-3 font-semibold text-center">Level</th>
                    <th className="py-1.5 px-3 font-semibold text-center">Escalate</th>
                    <th className="py-1.5 px-3 font-semibold text-center">Priority</th>
                    <th className="py-1.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className={`border-b border-[var(--hairline)]/40 ${r.active === false ? 'opacity-45' : ''}`}>
                      <td className="py-1.5 pr-3 text-[var(--text-primary)]">
                        {scopeLabel(r)}
                        {r.note && <span className="block text-[11px] text-[var(--text-tertiary)]">{r.note}</span>}
                      </td>
                      <td className="py-1.5 px-3 text-[var(--text-secondary)]">{approverLabel(r)}</td>
                      <td className="py-1.5 px-3 text-center tabular-nums">{r.level}</td>
                      <td className="py-1.5 px-3 text-center text-[var(--text-secondary)]">
                        {r.escalate_after_days ? `${r.escalate_after_days}d` : 'N/A'}
                      </td>
                      <td className="py-1.5 px-3 text-center tabular-nums text-[var(--text-tertiary)]">{specificity(r)}</td>
                      <td className="py-1.5 px-3 text-right whitespace-nowrap">
                        <button type="button" onClick={() => toggle(r)}
                          className="text-xs underline text-[var(--text-secondary)] mr-3">
                          {r.active === false ? 'Enable' : 'Disable'}
                        </button>
                        <button type="button" onClick={() => remove(r)} className="text-red-400" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* ── Preview: ask the server who would sign ─────────────────────────── */}
      <div className="card space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-secondary)]">
          Test it: who would approve this?
        </h2>
        <p className="text-xs text-[var(--text-tertiary)]">
          Runs against the database, not a copy of the rules in this page, so the answer is what will really happen.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Type">
            <select className={inputCls} value={test.entity_type} onChange={(e) => setTest({ ...test, entity_type: e.target.value })}>
              {ENTITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Country">
            <select className={inputCls} value={test.country} onChange={(e) => setTest({ ...test, country: e.target.value })}>
              <option value="">(none)</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Site">
            <select className={inputCls} value={test.site} onChange={(e) => setTest({ ...test, site: e.target.value })}>
              <option value="">(none)</option>
              {siteNames.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Submitted by">
            <select className={inputCls} value={test.role} onChange={(e) => setTest({ ...test, role: e.target.value })}>
              {roles.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <button type="button" onClick={runPreview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--input-border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
            <Play size={14} /> Check
          </button>
        </div>

        {preview && (
          preview.length === 0 ? (
            <p className="text-sm text-amber-300">
              No rule matches. This submission would have no approver - add a catch-all rule.
            </p>
          ) : (
            <ol className="text-sm space-y-1">
              {preview.map((p, i) => (
                <li key={p.rule_id || i} className="text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text-primary)]">Level {p.level}:</span>{' '}
                  {p.approver_role ? `any ${p.approver_role}` : 'a named person'}
                  {p.escalate_after_days ? ` (escalates after ${p.escalate_after_days} days)` : ''}
                  <span className="text-[var(--text-tertiary)]"> - match strength {p.specificity}</span>
                </li>
              ))}
            </ol>
          )
        )}
      </div>
    </div>
  )
}
