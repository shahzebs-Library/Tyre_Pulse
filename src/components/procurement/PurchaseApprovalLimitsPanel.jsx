/**
 * Purchase approval limits (owner decision A, 2026-11-24).
 *
 * Admin screen over inventory_approval_limits (entity_type 'purchase_order').
 * One row per role and currency; SAR, AED and EGP are separate rows and are
 * never converted. Every write goes through inv_approval_limit_upsert, which
 * the database restricts to a super admin or Admin; this screen only hides
 * the buttons from everyone else. Props: { scope, can, userId, onNavigate }.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info, Loader2, Pencil, Plus, RefreshCw, Scale, Trash2, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'
import {
  NOT_SET_UP, newIdempotencyKey, listPurchaseApprovalLimits, listPurchaseApproverRoles, savePurchaseApprovalLimit,
} from '../../lib/api/procurementDepth'
import {
  LIMIT_CURRENCIES, shapeLimits, rolesWithoutLimit, validateLimitForm, limitPayload, formatLimitAmount,
} from '../../lib/procurement/purchaseLimits'

const EMPTY = { role: '', currency: 'SAR', amount: '', noUpperLimit: false }
const fmtDate = (v) => {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function PurchaseApprovalLimitsPanel() {
  const { profile, isSuperAdmin } = useAuth() || {}
  const isAdmin = !!isSuperAdmin || profile?.role === 'Admin'
  const [st, setSt] = useState({ loading: true, error: '', notSetUp: false, rows: [], roles: [] })
  const [form, setForm] = useState(null)        // null = closed; { ...EMPTY, editing }
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState({})

  const load = useCallback(() => {
    let live = true
    setSt((s) => ({ ...s, loading: true, error: '' }))
    Promise.all([listPurchaseApprovalLimits(), listPurchaseApproverRoles()]).then(([lim, roles]) => {
      if (!live) return
      const notSetUp = lim.status === 'not_provisioned' || roles.status === 'not_provisioned' || roles.rows.length === 0
      setSt({ loading: false, error: '', notSetUp, rows: lim.rows, roles: roles.rows })
    }).catch((e) => { if (live) setSt({ loading: false, error: toUserMessage(e, 'Could not load the approval limits.'), notSetUp: false, rows: [], roles: [] }) })
    return () => { live = false }
  }, [])
  useEffect(() => load(), [load])

  const shaped = useMemo(() => shapeLimits(st.rows), [st.rows])
  const missing = useMemo(() => rolesWithoutLimit(st.roles, shaped.active), [st.roles, shaped.active])

  const openAdd = () => { setMsg({}); setForm({ ...EMPTY, role: st.roles[0] || '' }) }
  const openEdit = (r) => {
    setMsg({})
    setForm({ role: r.role, currency: r.currency || 'SAR', amount: r.amount ?? '', noUpperLimit: r.amount === null, site: r.site, editing: r.id })
  }
  const formError = form ? validateLimitForm(form, st.roles) : null

  const save = async () => {
    if (formError) { setMsg({ error: formError }); return }
    setBusy('save'); setMsg({})
    try {
      await savePurchaseApprovalLimit(limitPayload(form, true), newIdempotencyKey())
      setMsg({ ok: `${form.role}: ${form.noUpperLimit ? 'no upper limit' : `up to ${form.currency} ${Number(form.amount).toLocaleString('en-US')}`} saved.` })
      setForm(null); load()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not save the limit.') }) } finally { setBusy('') }
  }
  const remove = async (r) => {
    if (!window.confirm(`Remove the ${r.currency} limit for ${r.role}? ${shaped.active.length === 1
      ? 'It is the last limit, so purchase orders will have no value threshold again.'
      : `${r.role} will then not be able to approve ${r.currency} purchase orders.`}`)) return
    setBusy(r.id); setMsg({})
    try {
      await savePurchaseApprovalLimit(limitPayload({ role: r.role, currency: r.currency, amount: r.amount, noUpperLimit: r.amount === null, site: r.site }, false), newIdempotencyKey())
      setMsg({ ok: `${r.currency} limit for ${r.role} removed.` }); load()
    } catch (e) { setMsg({ error: toUserMessage(e, 'Could not remove the limit.') }) } finally { setBusy('') }
  }

  return (
    <section className="card space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Scale size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Purchase approval limits</h2>
            <p className="text-xs text-[var(--text-muted)]">The highest purchase order value each role may approve, per currency. SAR, AED and EGP are set separately and never converted.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" onClick={load} aria-label="Refresh">
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
          {isAdmin && !st.notSetUp && !st.loading && !st.error && (
            <button type="button" className="cc-btn inline-flex items-center gap-1 min-h-[44px]" onClick={openAdd}>
              <Plus size={14} aria-hidden="true" /> Add limit
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--hairline)] p-3 text-xs text-[var(--text-secondary)] space-y-1" role="note">
        <p className="flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>While no limit is set, purchase orders have no value threshold: any permitted approver other than the creator can approve them.</span></p>
        <p className="flex items-start gap-2 text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Once any limit exists, a role without its own limit in the order's currency cannot approve purchase orders. Add a row for every role that should approve.</span></p>
        <p>Emergency purchases are approved after the fact by a second person, within the same limits.</p>
      </div>

      {!isAdmin && <p className="text-xs text-[var(--text-muted)]">Only an administrator can change these limits. You can view them.</p>}

      {msg.error && <p role="alert" className="flex items-start gap-2 text-sm text-red-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{msg.error}</p>}
      {msg.ok && <p role="status" className="text-sm text-green-300">{msg.ok}</p>}

      {form && isAdmin && (
        <div className="rounded-lg border border-[var(--hairline)] p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{form.editing ? 'Change limit' : 'Add limit'}</h3>
            <button type="button" className="cc-btn-ghost min-h-[44px] min-w-[44px]" onClick={() => setForm(null)} aria-label="Close"><X size={14} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs text-[var(--text-secondary)] block">Role
              <select className="input w-full mt-1" value={form.role} disabled={!!form.editing}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {st.roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-secondary)] block">Currency
              <select className="input w-full mt-1" value={form.currency} disabled={!!form.editing}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                {LIMIT_CURRENCIES.map((c) => <option key={c.currency} value={c.currency}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-secondary)] block">Highest order value
              <input className="input w-full mt-1" type="number" min="0" step="0.01" inputMode="decimal" value={form.amount}
                disabled={form.noUpperLimit} placeholder={form.noUpperLimit ? 'No upper limit' : 'e.g. 50000'}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </label>
          </div>
          <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)] min-h-[44px]">
            <input type="checkbox" className="mt-0.5" checked={form.noUpperLimit}
              onChange={(e) => setForm((f) => ({ ...f, noUpperLimit: e.target.checked }))} />
            <span>No upper limit: this role may approve any {form.currency} order value (unpriced orders included).</span>
          </label>
          {formError && <p className="text-xs text-amber-300">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cc-btn min-h-[44px]" disabled={!!formError || busy === 'save'} onClick={save}>
              {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : 'Save limit'}
            </button>
            <button type="button" className="cc-btn-ghost min-h-[44px]" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {st.loading && !st.rows.length ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 30 }} />)}</div>
      ) : st.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-300">
          <AlertTriangle size={15} aria-hidden="true" />{st.error}
          <button type="button" className="underline min-h-[44px]" onClick={load}>Try again</button>
        </div>
      ) : st.notSetUp ? (
        <p className="text-xs text-amber-300" role="note">{NOT_SET_UP}</p>
      ) : !shaped.active.length ? (
        <p className="text-sm text-[var(--text-muted)]">No purchase approval limits are set. There is no value threshold today.{isAdmin ? ' Use Add limit to set the first one.' : ''}</p>
      ) : (
        <>
          <ul className="sm:hidden space-y-2">
            {shaped.active.map((r) => (
              <li key={r.id} className="rounded-lg border border-[var(--hairline)] p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.role}</p>
                  <p className="text-xs text-[var(--text-muted)]">{formatLimitAmount(r)}{r.site ? `, site ${r.site}` : ''}</p>
                </div>
                {isAdmin && <RowActions r={r} busy={busy} onEdit={openEdit} onRemove={remove} />}
              </li>
            ))}
          </ul>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-[var(--text-muted)]">
                <th className="py-2 pr-2 text-left font-medium">Role</th>
                <th className="py-2 pr-2 text-left font-medium">Currency</th>
                <th className="py-2 pr-2 text-right font-medium">Highest order value</th>
                <th className="py-2 pr-2 text-left font-medium">Updated</th>
                {isAdmin && <th className="py-2 pr-2 text-left font-medium">Action</th>}
              </tr></thead>
              <tbody>{shaped.active.map((r) => (
                <tr key={r.id} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pr-2">{r.role}{r.site ? <span className="block text-xs text-[var(--text-muted)]">Site {r.site}</span> : null}</td>
                  <td className="py-2 pr-2">{r.currency || 'N/A'}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatLimitAmount(r)}</td>
                  <td className="py-2 pr-2">{fmtDate(r.updated_at)}</td>
                  {isAdmin && <td className="py-2 pr-2"><RowActions r={r} busy={busy} onEdit={openEdit} onRemove={remove} /></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <p className="text-xs text-amber-300" role="note">
              No limit, so these roles cannot approve purchase orders now: {missing.join(', ')}.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function RowActions({ r, busy, onEdit, onRemove }) {
  return (
    <div className="flex gap-1">
      <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" onClick={() => onEdit(r)} aria-label={`Change ${r.role} ${r.currency} limit`}>
        <Pencil size={14} aria-hidden="true" /> Change
      </button>
      <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" disabled={busy === r.id}
        onClick={() => onRemove(r)} aria-label={`Remove ${r.role} ${r.currency} limit`}>
        {busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} aria-hidden="true" />} Remove
      </button>
    </div>
  )
}
