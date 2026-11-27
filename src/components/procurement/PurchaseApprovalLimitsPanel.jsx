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
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import {
  newIdempotencyKey, listPurchaseApprovalLimits, listPurchaseApproverRoles, savePurchaseApprovalLimit,
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
  const { t } = useLanguage()
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
    }).catch((e) => { if (live) setSt({ loading: false, error: toUserMessage(e, t('wmsprocure.limits.loadErr')), notSetUp: false, rows: [], roles: [] }) })
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
  const formError = form ? validateLimitForm(form, st.roles, t) : null

  const save = async () => {
    if (formError) { setMsg({ error: formError }); return }
    setBusy('save'); setMsg({})
    try {
      await savePurchaseApprovalLimit(limitPayload(form, true), newIdempotencyKey())
      setMsg({ ok: form.noUpperLimit ? t('wmsprocure.limits.savedNoUpper', { role: form.role }) : t('wmsprocure.limits.savedUpTo', { role: form.role, currency: form.currency, amount: Number(form.amount).toLocaleString('en-US') }) })
      setForm(null); load()
    } catch (e) { setMsg({ error: toUserMessage(e, t('wmsprocure.limits.saveErr')) }) } finally { setBusy('') }
  }
  const remove = async (r) => {
    if (!window.confirm(t(shaped.active.length === 1 ? 'wmsprocure.limits.confirmRemoveLast' : 'wmsprocure.limits.confirmRemove', { currency: r.currency, role: r.role }))) return
    setBusy(r.id); setMsg({})
    try {
      await savePurchaseApprovalLimit(limitPayload({ role: r.role, currency: r.currency, amount: r.amount, noUpperLimit: r.amount === null, site: r.site }, false), newIdempotencyKey())
      setMsg({ ok: t('wmsprocure.limits.removed', { currency: r.currency, role: r.role }) }); load()
    } catch (e) { setMsg({ error: toUserMessage(e, t('wmsprocure.limits.removeErr')) }) } finally { setBusy('') }
  }

  return (
    <section className="card space-y-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Scale size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('wmsprocure.limits.title')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('wmsprocure.limits.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" onClick={load} aria-label={t('wmsprocure.limits.refresh')}>
            <RefreshCw size={14} aria-hidden="true" /> {t('wmsprocure.limits.refresh')}
          </button>
          {isAdmin && !st.notSetUp && !st.loading && !st.error && (
            <button type="button" className="cc-btn inline-flex items-center gap-1 min-h-[44px]" onClick={openAdd}>
              <Plus size={14} aria-hidden="true" /> {t('wmsprocure.limits.addLimit')}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--hairline)] p-3 text-xs text-[var(--text-secondary)] space-y-1" role="note">
        <p className="flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('wmsprocure.limits.noLimitNote')}</span></p>
        <p className="flex items-start gap-2 text-amber-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('wmsprocure.limits.anyLimitNote')}</span></p>
        <p>{t('wmsprocure.limits.emergencyNote')}</p>
      </div>

      {!isAdmin && <p className="text-xs text-[var(--text-muted)]">{t('wmsprocure.limits.viewOnly')}</p>}

      {msg.error && <p role="alert" className="flex items-start gap-2 text-sm text-red-300"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{msg.error}</p>}
      {msg.ok && <p role="status" className="text-sm text-green-300">{msg.ok}</p>}

      {form && isAdmin && (
        <div className="rounded-lg border border-[var(--hairline)] p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{form.editing ? t('wmsprocure.limits.changeLimit') : t('wmsprocure.limits.addLimit')}</h3>
            <button type="button" className="cc-btn-ghost min-h-[44px] min-w-[44px]" onClick={() => setForm(null)} aria-label={t('wmsprocure.limits.close')}><X size={14} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs text-[var(--text-secondary)] block">{t('wmsprocure.limits.role')}
              <select className="input w-full mt-1" value={form.role} disabled={!!form.editing}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {st.roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-secondary)] block">{t('wmsprocure.limits.currency')}
              <select className="input w-full mt-1" value={form.currency} disabled={!!form.editing}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                {LIMIT_CURRENCIES.map((c) => <option key={c.currency} value={c.currency}>{t(`wmsprocure.limits.cur.${c.currency}`)}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--text-secondary)] block">{t('wmsprocure.limits.highest')}
              <input className="input w-full mt-1" type="number" min="0" step="0.01" inputMode="decimal" value={form.amount}
                disabled={form.noUpperLimit} placeholder={form.noUpperLimit ? t('wmsprocure.limits.noUpperLimit') : t('wmsprocure.limits.amountPlaceholder')}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </label>
          </div>
          <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)] min-h-[44px]">
            <input type="checkbox" className="mt-0.5" checked={form.noUpperLimit}
              onChange={(e) => setForm((f) => ({ ...f, noUpperLimit: e.target.checked }))} />
            <span>{t('wmsprocure.limits.noUpperHelp', { currency: form.currency })}</span>
          </label>
          {formError && <p className="text-xs text-amber-300">{formError}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="cc-btn min-h-[44px]" disabled={!!formError || busy === 'save'} onClick={save}>
              {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : t('wmsprocure.limits.saveLimit')}
            </button>
            <button type="button" className="cc-btn-ghost min-h-[44px]" onClick={() => setForm(null)}>{t('wmsprocure.limits.cancel')}</button>
          </div>
        </div>
      )}

      {st.loading && !st.rows.length ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="cc-skel" style={{ height: 30 }} />)}</div>
      ) : st.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-300">
          <AlertTriangle size={15} aria-hidden="true" />{st.error}
          <button type="button" className="underline min-h-[44px]" onClick={load}>{t('wmsprocure.limits.tryAgain')}</button>
        </div>
      ) : st.notSetUp ? (
        <p className="text-xs text-amber-300" role="note">{t('wmsmsgprocure.notSetUp')}</p>
      ) : !shaped.active.length ? (
        <p className="text-sm text-[var(--text-muted)]">{t('wmsprocure.limits.empty')}{isAdmin ? t('wmsprocure.limits.emptyAdmin') : ''}</p>
      ) : (
        <>
          <ul className="sm:hidden space-y-2">
            {shaped.active.map((r) => (
              <li key={r.id} className="rounded-lg border border-[var(--hairline)] p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.role}</p>
                  <p className="text-xs text-[var(--text-muted)]">{formatLimitAmount(r, t)}{r.site ? t('wmsprocure.limits.siteSuffix', { site: r.site }) : ''}</p>
                </div>
                {isAdmin && <RowActions r={r} busy={busy} onEdit={openEdit} onRemove={remove} />}
              </li>
            ))}
          </ul>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-[var(--text-muted)]">
                <th className="py-2 pe-2 text-start font-medium">{t('wmsprocure.limits.role')}</th>
                <th className="py-2 pe-2 text-start font-medium">{t('wmsprocure.limits.currency')}</th>
                <th className="py-2 pe-2 text-end font-medium">{t('wmsprocure.limits.highest')}</th>
                <th className="py-2 pe-2 text-start font-medium">{t('wmsprocure.limits.updated')}</th>
                {isAdmin && <th className="py-2 pe-2 text-start font-medium">{t('wmsprocure.limits.action')}</th>}
              </tr></thead>
              <tbody>{shaped.active.map((r) => (
                <tr key={r.id} className="border-t border-[var(--hairline)]">
                  <td className="py-2 pe-2">{r.role}{r.site ? <span className="block text-xs text-[var(--text-muted)]">{t('wmsprocure.limits.siteLine', { site: r.site })}</span> : null}</td>
                  <td className="py-2 pe-2">{r.currency || t('wmsprocure.limits.na')}</td>
                  <td className="py-2 pe-2 text-end tabular-nums">{formatLimitAmount(r, t)}</td>
                  <td className="py-2 pe-2">{fmtDate(r.updated_at)}</td>
                  {isAdmin && <td className="py-2 pe-2"><RowActions r={r} busy={busy} onEdit={openEdit} onRemove={remove} /></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <p className="text-xs text-amber-300" role="note">
              {t('wmsprocure.limits.missing', { roles: missing.join(', ') })}
            </p>
          )}
        </>
      )}
    </section>
  )
}

function RowActions({ r, busy, onEdit, onRemove }) {
  const { t } = useLanguage()
  return (
    <div className="flex gap-1">
      <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" onClick={() => onEdit(r)} aria-label={t('wmsprocure.limits.changeAria', { role: r.role, currency: r.currency })}>
        <Pencil size={14} aria-hidden="true" /> {t('wmsprocure.limits.change')}
      </button>
      <button type="button" className="cc-btn-ghost inline-flex items-center gap-1 min-h-[44px]" disabled={busy === r.id}
        onClick={() => onRemove(r)} aria-label={t('wmsprocure.limits.removeAria', { role: r.role, currency: r.currency })}>
        {busy === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} aria-hidden="true" />} {t('wmsprocure.limits.remove')}
      </button>
    </div>
  )
}
