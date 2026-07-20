import { useEffect, useMemo, useState } from 'react'
import {
  CreditCard, Check, Zap, TrendingUp, AlertTriangle, RefreshCw, Clock,
  ShieldCheck, XCircle, Loader2, FileText, Infinity as InfinityIcon,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import { useBilling } from '../hooks/useBilling'
import * as billing from '../lib/api/billing'
import {
  STATUS_META, monthlyEquivalent, annualSavingPct, planAllows,
} from '../lib/entitlements'
import { formatCurrency, formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { Illustration } from '../components/illustrations'

const TONE = {
  blue:  'bg-blue-900/40 text-blue-300 border-blue-700/40',
  green: 'bg-green-900/40 text-green-300 border-green-700/40',
  amber: 'bg-amber-900/40 text-amber-300 border-amber-700/40',
  gray:  'bg-gray-800 text-gray-300 border-gray-700',
  red:   'bg-red-900/40 text-red-300 border-red-700/40',
}

const INVOICE_TONE = {
  paid:          'bg-green-900/40 text-green-300 border-green-700/40',
  open:          'bg-blue-900/40 text-blue-300 border-blue-700/40',
  draft:         'bg-gray-800 text-gray-300 border-gray-700',
  void:          'bg-gray-800 text-gray-500 border-gray-700',
  uncollectible: 'bg-red-900/40 text-red-300 border-red-700/40',
}

const FEATURE_LABELS = {
  ai_tools: 'AI Tools & Copilot',
  automation_platform: 'Automation Platform',
  tv_display: 'Executive TV Display',
  erp_sync: 'ERP Sync',
  report_scheduling: 'Scheduled Reports',
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.canceled
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-semibold ${TONE[meta.tone]}`}>
      {meta.label}
    </span>
  )
}

function UsageMeter({ row, currency }) {
  const over = row.pct >= 100 && !row.unlimited
  const warn = row.pct >= 80 && !over
  const barColor = over ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="bg-gray-800/50 rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-300">{row.label}</span>
        <span className={`text-sm font-medium ${over ? 'text-red-400' : 'text-white'}`}>
          {row.usage.toLocaleString()}
          {row.unlimited ? (
            <span className="text-gray-500 inline-flex items-center gap-1"> / <InfinityIcon size={13} /></span>
          ) : (
            <span className="text-gray-500"> / {row.limit.toLocaleString()}</span>
          )}
        </span>
      </div>
      {row.unlimited ? (
        <div className="h-2 rounded-full bg-gray-700/60 overflow-hidden">
          <div className="h-full w-full bg-gradient-to-r from-emerald-600/40 to-emerald-500/20" />
        </div>
      ) : (
        <div className="h-2 rounded-full bg-gray-700/60 overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${row.pct}%` }} />
        </div>
      )}
      {over && (
        <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
          <AlertTriangle size={11} /> Over plan limit. Upgrade to add more.
        </p>
      )}
      {warn && (
        <p className="text-xs text-amber-400/80 mt-1.5">{row.remaining.toLocaleString()} remaining</p>
      )}
    </div>
  )
}

export default function Billing() {
  const reportMeta = useReportMeta('Billing & Invoices')
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'Admin'
  const {
    overview, plans, invoices, rows, trialDaysLeft,
    loading, invoicesLoading, error, invoicesError, refresh,
    subscriptionAccess,
  } = useBilling()
  // Fail-open: only block when the pure policy explicitly says so.
  const blockPlanChange = subscriptionAccess?.blockSelfServiceBilling === true

  const [interval, setInterval] = useState('monthly')
  const [pending, setPending] = useState(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionErr, setActionErr] = useState('')
  const [confirm, setConfirm] = useState(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('checkout')
    if (!outcome) return
    if (outcome === 'success') { setActionMsg('Payment received. Your plan is now active.'); refresh() }
    else if (outcome === 'cancel') setActionErr('Checkout was cancelled. Your plan is unchanged.')
    window.history.replaceState({}, '', '/billing')
    const id = setTimeout(() => { setActionMsg(''); setActionErr('') }, 5000)
    return () => clearTimeout(id)
  }, [refresh])

  const sub = overview?.subscription
  const plan = overview?.plan
  const currency = plan?.currency || 'USD'
  const currentCode = sub?.plan_code || 'trial'

  const orderedPlans = useMemo(
    () => [...plans].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [plans],
  )
  const currentIndex = orderedPlans.findIndex((p) => p.code === currentCode)

  async function applyPlan(target) {
    // Grace period (e.g. past_due): block self-service plan changes at the
    // action boundary too, so a disabled button can never be bypassed.
    if (blockPlanChange) {
      setConfirm(null)
      setActionMsg('')
      setActionErr('Your payment is past due. Resolve billing before changing plans.')
      return
    }
    setPending(target.code)
    setActionErr('')
    setActionMsg('')
    try {
      const paid = target.code !== 'trial' && (target.price_monthly > 0 || target.price_annual > 0)
      if (paid) {
        // A paid plan can ONLY be activated through Stripe checkout + the
        // signature-verified webhook. Never fall back to a direct changePlan
        // (that would grant the paid plan for free).
        const res = await billing.startCheckout({ planCode: target.code, interval })
        if (res?.configured && res.url) {
          // Only ever redirect the browser to an https checkout endpoint —
          // never a javascript:/data: or plain-http URL smuggled in the response.
          if (typeof res.url !== 'string' || !res.url.trim().toLowerCase().startsWith('https://')) {
            throw new Error('Checkout returned an invalid redirect URL.')
          }
          window.location.href = res.url
          return
        }
        setActionErr('Online checkout is not set up yet. Please contact your administrator to activate a paid plan.')
        return
      }
      await billing.changePlan({ planCode: target.code, interval })
      setActionMsg(`Switched to the ${target.name} plan.`)
      refresh()
    } catch (err) {
      setActionErr(toUserMessage(err, 'Could not change the plan.'))
    } finally {
      setPending(null)
      setConfirm(null)
      setTimeout(() => setActionMsg(''), 4000)
    }
  }

  async function toggleCancel() {
    if (!sub?.id) return
    setActionErr('')
    setActionMsg('')
    try {
      const next = !sub.cancel_at_period_end
      await billing.setCancelAtPeriodEnd(sub.id, next)
      setActionMsg(next
        ? 'Subscription will cancel at the end of the current period.'
        : 'Cancellation reverted. Your subscription will renew.')
      refresh()
    } catch (err) {
      setActionErr(toUserMessage(err, 'Could not update the subscription.'))
    } finally {
      setTimeout(() => setActionMsg(''), 4000)
    }
  }

  const invoiceColumns = useMemo(() => [
    {
      id: 'number',
      header: 'Invoice',
      accessorFn: r => r.number || r.id.slice(0, 8),
      size: 120,
      cell: ({ getValue }) => <span className="text-white font-medium">{getValue()}</span>,
    },
    {
      id: 'period',
      header: 'Period',
      accessorFn: r => r.period_start ? `${formatDate(r.period_start)} to ${formatDate(r.period_end)}` : '—',
      size: 200,
    },
    {
      id: 'issued_at',
      header: 'Issued',
      accessorFn: r => formatDate(r.issued_at),
      size: 100,
    },
    {
      id: 'amount_due',
      header: 'Amount',
      accessorFn: r => formatCurrency(r.amount_due, r.currency || currency, 2),
      size: 100,
      meta: { align: 'right' },
      cell: ({ getValue }) => <span className="text-white">{getValue()}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: r => r.status,
      size: 90,
      meta: { align: 'center' },
      cell: ({ getValue }) => {
        const val = getValue()
        return (
          <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${INVOICE_TONE[val] || INVOICE_TONE.draft}`}>
            {val}
          </span>
        )
      },
    },
  ], [currency])

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing & Subscription" subtitle="Plan, usage and invoices" icon={CreditCard} />
        <div className="card flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading your subscription…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing & Subscription" subtitle="Plan, usage and invoices" icon={CreditCard} />
        <div className="card border border-red-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-red-300 font-medium">Couldn't load billing information.</p>
              <p className="text-gray-400 text-sm mt-1">
                {error.message?.includes('function') || error.message?.includes('does not exist')
                  ? 'The billing tables aren\u2019t applied to this database yet. Apply MIGRATIONS_V105_SUBSCRIPTION_BILLING.sql, then reload.'
                  : toUserMessage(error, 'Could not load billing information.')}
              </p>
              <button onClick={refresh} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing & Subscription"
        subtitle="Manage your plan, track usage against limits, and review invoices"
        icon={CreditCard}
      />

      {(actionMsg || actionErr) && (
        <div className={`rounded-lg px-4 py-2.5 text-sm border ${
          actionErr ? 'bg-red-900/30 border-red-800/50 text-red-300' : 'bg-emerald-900/30 border-emerald-800/50 text-emerald-300'}`}>
          {actionErr || actionMsg}
        </div>
      )}

      {sub?.status === 'trialing' && trialDaysLeft !== null && (
        <div className="rounded-xl px-5 py-4 bg-gradient-to-r from-blue-950/60 to-indigo-950/40 border border-blue-800/40 flex items-center gap-3">
          <Clock size={18} className="text-blue-300 shrink-0" />
          <p className="text-sm text-blue-200 flex-1">
            <strong>{trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'}</strong> left in your trial.
            {isAdmin ? ' Choose a plan below to keep uninterrupted access.' : ' Ask an administrator to select a plan.'}
          </p>
          <div className="hidden sm:block shrink-0" aria-hidden="true">
            <Illustration name="marketing/cta-upgrade" size={140} title="Upgrade your plan" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-400" /> Current Plan
            </h2>
            {sub && <StatusBadge status={sub.status} />}
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{plan?.name || '—'}</p>
            <p className="text-gray-400 text-sm mt-0.5">{plan?.description}</p>
          </div>
          <div className="space-y-2 text-sm border-t border-gray-800 pt-3">
            <div className="flex justify-between">
              <span className="text-gray-400">Price</span>
              <span className="text-white font-medium">
                {(!plan?.price_monthly && !plan?.price_annual)
                  ? (plan?.code === 'enterprise' ? 'Custom' : 'Free')
                  : `${formatCurrency(monthlyEquivalent(plan, sub?.billing_interval), currency, 0)}/mo`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Billing</span>
              <span className="text-white capitalize">{sub?.billing_interval || 'monthly'}</span>
            </div>
            {sub?.current_period_end && (
              <div className="flex justify-between">
                <span className="text-gray-400">
                  {sub.cancel_at_period_end ? 'Ends' : 'Renews'}
                </span>
                <span className="text-white">{formatDate(sub.current_period_end)}</span>
              </div>
            )}
          </div>
          {isAdmin && sub?.id && sub.status !== 'trialing' && (
            sub.cancel_at_period_end ? (
              <button onClick={toggleCancel} className="btn-secondary w-full justify-center text-sm">
                <RefreshCw size={14} /> Resume subscription
              </button>
            ) : (
              <button onClick={toggleCancel} className="w-full justify-center text-sm inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-950/30 border border-red-800/40 text-red-400 hover:bg-red-950/50 transition-colors">
                <XCircle size={14} /> Cancel at period end
              </button>
            )
          )}
        </div>

        <div className="card lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <TrendingUp size={16} className="text-blue-400" /> Usage & Limits
            </h2>
            <button onClick={refresh} className="text-gray-400 hover:text-white transition-colors" title="Refresh usage">
              <RefreshCw size={15} />
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="text-gray-500 text-sm py-6 text-center">No metered limits on this plan.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rows.map((row) => <UsageMeter key={row.resource} row={row} currency={currency} />)}
            </div>
          )}
          <p className="text-xs text-gray-500">
            Usage is measured live for your organisation. Reaching a limit blocks new records of that
            type until you upgrade. Historical data is never removed.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Zap size={16} className="text-amber-400" /> Plans
            </h2>
            <div className="hidden md:block shrink-0" aria-hidden="true">
              <Illustration name="marketing/cost-savings" size={72} title="Save with the right plan" />
            </div>
          </div>
          <div className="inline-flex rounded-lg bg-gray-800 p-1 text-sm">
            {['monthly', 'annual'].map((iv) => (
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={`px-3 py-1.5 rounded-md capitalize transition-colors ${
                  interval === iv ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {iv}{iv === 'annual' && <span className="text-emerald-400 text-xs ml-1">save</span>}
              </button>
            ))}
          </div>
        </div>
        {blockPlanChange && (
          <div className="rounded-lg px-4 py-3 mb-5 bg-amber-900/30 border border-amber-800/50 text-amber-200 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="flex-1">
              Your payment is past due - resolve billing before changing plans.{' '}
              <a
                href="mailto:support@tyrepulse.app?subject=Past%20due%20billing"
                className="underline font-medium text-amber-100 hover:text-white"
              >
                Update payment / contact support
              </a>
              .
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {orderedPlans.map((p, idx) => {
            const isCurrent = p.code === currentCode
            const price = monthlyEquivalent(p, interval)
            const saving = annualSavingPct(p)
            const custom = p.code === 'enterprise' && !p.price_monthly && !p.price_annual
            const direction = idx > currentIndex ? 'Upgrade' : idx < currentIndex ? 'Downgrade' : 'Current'
            return (
              <div key={p.code} className={`rounded-xl border p-5 flex flex-col ${isCurrent ? 'border-emerald-600/60 bg-emerald-950/20' : 'border-gray-700 bg-gray-800/40'}`}>
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold">{p.name}</h3>
                  {isCurrent && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 border border-emerald-700/40">Current</span>}
                </div>
                <div className="mt-3">
                  {custom ? <p className="text-2xl font-bold text-white">Custom</p>
                  : price > 0 ? <p className="text-2xl font-bold text-white">{formatCurrency(price, p.currency || 'USD', 0)}<span className="text-sm font-normal text-gray-400">/mo</span></p>
                  : <p className="text-2xl font-bold text-white">Free</p>}
                  {interval === 'annual' && saving > 0 && <p className="text-xs text-emerald-400 mt-0.5">Save {saving}% billed annually</p>}
                </div>
                <p className="text-gray-400 text-xs mt-2 min-h-[2.5rem]">{p.description}</p>
                <ul className="mt-4 space-y-2 text-sm flex-1">
                  <LimitLine label="Vehicles" value={p.max_vehicles} />
                  <LimitLine label="Users" value={p.max_users} />
                  <LimitLine label="API keys" value={p.max_api_keys} />
                  <LimitLine label="Storage" value={p.max_storage_gb} unit=" GB" />
                  {Object.keys(FEATURE_LABELS).map((fk) =>
                    planAllows({ plan: p }, fk) && p.features?.[fk] ? (
                      <li key={fk} className="flex items-center gap-2 text-gray-300">
                        <Check size={14} className="text-emerald-400 shrink-0" /> {FEATURE_LABELS[fk]}
                      </li>
                    ) : null,
                  )}
                </ul>
                <div className="mt-5">
                  {isCurrent ? (
                    <button disabled className="btn-secondary w-full justify-center text-sm opacity-60 cursor-default">Current plan</button>
                  ) : !isAdmin ? (
                    <button disabled className="btn-secondary w-full justify-center text-sm opacity-50 cursor-not-allowed">Admin only</button>
                  ) : blockPlanChange ? (
                    <button disabled title="Resolve past-due billing before changing plans"
                      className="btn-secondary w-full justify-center text-sm opacity-50 cursor-not-allowed">
                      Billing past due
                    </button>
                  ) : (
                    <button onClick={() => setConfirm({ plan: p, direction })} disabled={pending === p.code}
                      className={`w-full justify-center text-sm inline-flex items-center gap-2 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${direction === 'Upgrade' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}>
                      {pending === p.code ? <><Loader2 size={14} className="animate-spin" /> Applying…</> : direction === 'Upgrade' ? <><TrendingUp size={14} /> Upgrade</> : custom ? 'Contact sales' : 'Switch'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Invoice History - EnterpriseTable */}
      <div className="card">
        <h2 className="text-base font-semibold text-white flex items-center gap-2 mb-4">
          <FileText size={16} className="text-gray-400" /> Invoice History
        </h2>
        {invoicesLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 size={18} className="animate-spin mr-2" /> Loading invoices…
          </div>
        ) : invoicesError ? (
          <p className="text-sm text-red-300">Couldn't load invoices: {toUserMessage(invoicesError, 'Please try again.')}</p>
        ) : invoices.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-gray-700 rounded-xl">
            <FileText size={26} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No invoices yet</p>
            <p className="text-gray-600 text-xs mt-1">Invoices appear here once a paid billing period closes.</p>
          </div>
        ) : (
          <EnterpriseTable
            reportMeta={reportMeta}
            columns={invoiceColumns}
            data={invoices}
            getRowId={(row) => row.id}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableSorting={false}
            enableColumnVisibility={false}
            enableExport={false}
            initialPageSize={10}
            pageSizeOptions={[10, 25, 50]}
            emptyMessage="No invoices"
          />
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirm(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <CreditCard size={18} className="text-emerald-400" /> {confirm.direction} to {confirm.plan.name}?
            </h3>
            <p className="text-gray-400 text-sm mt-2">
              Your organisation will move to the <strong className="text-white">{confirm.plan.name}</strong> plan,
              billed <strong className="text-white">{interval}</strong>. Limits and features take effect immediately.
              {confirm.direction === 'Downgrade' && " Anything currently over the new limits stays but you won't be able to add more until you're back under the cap."}
            </p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setConfirm(null)} className="btn-secondary flex-1 justify-center text-sm">Cancel</button>
              <button onClick={() => applyPlan(confirm.plan)} disabled={pending} className="btn-primary flex-1 justify-center text-sm">
                {pending ? 'Applying…' : `Confirm ${confirm.direction.toLowerCase()}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LimitLine({ label, value, unit = '' }) {
  const unlimited = value === null || value === undefined
  return (
    <li className="flex items-center justify-between text-gray-300">
      <span className="text-gray-400">{label}</span>
      <span className="text-white">{unlimited ? 'Unlimited' : `${Number(value).toLocaleString()}${unit}`}</span>
    </li>
  )
}