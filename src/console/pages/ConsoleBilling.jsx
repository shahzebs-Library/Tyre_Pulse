/**
 * ConsoleBilling - plans, subscriptions and invoices for every organization
 * (/console/billing). NEW page: before this, each company could only see its
 * own plan in the main app (/billing, unchanged).
 *
 * Billing is not live. This page makes NO payment change: assigning a plan is a
 * preview only, because the first subscription row switches plan limits on for
 * that organization (enforce_plan_limit, V313) and a paid plan may only be
 * activated by the payment provider. Revenue is N/A (never 0) while nothing is
 * measured, and amounts in different currencies are never added together.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CreditCard, Receipt, Layers, Building2, ShieldCheck, TrendingUp, Download, ClipboardList, Info, Check, CircleDashed, AlertTriangle,
} from 'lucide-react'
import {
  Btn, Panel, PanelHeader, Note, StatTile, LoadingState, ErrorState, EmptyState, ImpactBox, Modal, Select,
} from '../components/ui'
import { PageHeader, Drawer } from './shared/pageKit'
import {
  listPlans, listOrgsFull, getOrgOverview, listOrgSubscriptions, billingCounts, apiKeysByOrg,
} from '../../lib/api/consolePlatform'
import { limitLabel, planFit, planPriceLabel, isCustomPlan, invoicePreview, fmtMoney, isEmptyOrg, fmtRiyadh } from '../../lib/consolePlatform'
import { exportConsoleRows } from '../../lib/consoleTable'
import { getOrgStorage } from '../../lib/api/consoleDataGaps'
import { orgStorageMap, storageFor } from '../../lib/consoleDataGaps'
import { fmtBytes } from '../../lib/databaseCenter'
import { toUserMessage } from '../../lib/safeError'
import { DecisionTag, Pill, fmtNum } from './platform/PlatformKit'

const FEATURE_LABEL = {
  ai_tools: 'AI tools', tv_display: 'TV display', report_scheduling: 'Scheduled reports', erp_sync: 'ERP sync', automation_platform: 'Automation',
}

function featureLine(plan) {
  const f = plan?.features && typeof plan.features === 'object' ? plan.features : {}
  const on = Object.keys(FEATURE_LABEL).filter((k) => f[k])
  if (on.length === Object.keys(FEATURE_LABEL).length) return 'Everything'
  return on.length ? on.map((k) => FEATURE_LABEL[k]).join(', ') : 'Core features only'
}

function useBillingData() {
  const [state, setState] = useState({ loading: true })
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const settle = async (p) => { try { return { ok: true, data: await p } } catch (e) { return { ok: false, error: toUserMessage(e, 'Could not load this part.') } } }
    const [plans, orgs, stats, subs, counts, keys, storage] = await Promise.all([
      settle(listPlans()), settle(listOrgsFull()), settle(getOrgOverview()), settle(listOrgSubscriptions()), settle(billingCounts()), settle(apiKeysByOrg()), settle(getOrgStorage()),
    ])
    setState({
      loading: false, loadedAt: Date.now(),
      plans: plans.ok ? plans.data || [] : [], plansError: plans.ok ? null : plans.error,
      orgs: orgs.ok ? orgs.data || [] : [], orgsError: orgs.ok ? null : orgs.error,
      stats: stats.ok ? stats.data : null, subs: subs.ok ? subs.data : null,
      counts: counts.ok ? counts.data : null, keys: keys.ok ? keys.data : null,
      storage: storage.ok ? orgStorageMap(storage.data) : null, storageError: storage.ok ? null : storage.error,
    })
  }, [])
  useEffect(() => { load() }, [load])
  return { ...state, reload: load }
}

export default function ConsoleBilling() {
  const data = useBillingData()
  const { loading, plans = [], plansError, orgs = [], orgsError, stats, subs, counts, keys, storage, storageError, reload } = data
  const storageText = (orgId) => { const st = storageFor(storage, orgId); return st ? `${fmtBytes(st.bytes)} (${fmtNum(st.files)} files)` : 'N/A' }
  const [params] = useSearchParams()
  const [assign, setAssign] = useState(null) // { orgId, planCode }
  const [setup, setSetup] = useState(false)
  const [trial, setTrial] = useState(false)

  const statsById = useMemo(() => Object.fromEntries((stats || []).map((s) => [s.id, s])), [stats])
  const subByOrg = useMemo(() => Object.fromEntries((subs || []).map((s) => [s.organisation_id, s])), [subs])
  const usageFor = useCallback((o) => {
    const s = statsById[o.id]
    return { users: s?.members ?? null, vehicles: s?.vehicles ?? null, apiKeys: keys ? (keys[o.id] || 0) : null }
  }, [statsById, keys])

  useEffect(() => {
    const org = params.get('org')
    if (org && plans.length && orgs.some((o) => o.id === org)) setAssign({ orgId: org, planCode: '' })
  }, [params, plans.length, orgs])

  const largest = useMemo(() => [...orgs].sort((a, b) => (statsById[b.id]?.vehicles || 0) - (statsById[a.id]?.vehicles || 0))[0], [orgs, statsById])
  const largestFits = largest ? plans.filter((p) => planFit(p, usageFor(largest)).fits).map((p) => p.name) : []
  const subCount = subs == null ? null : subs.length
  const plansInUse = (code) => (subs || []).filter((s) => s.plan_code === code).length

  const steps = [
    { label: 'Plans defined', detail: `${plans.length} plans with prices and limits`, state: plans.length ? 'done' : 'todo' },
    { label: 'Checkout function deployed', detail: 'billing-checkout creates a payment page for a paid plan', state: 'done' },
    { label: 'Payment confirmation deployed', detail: 'billing-webhook turns a plan on only after the provider confirms payment', state: 'done' },
    { label: 'Payment provider keys', detail: 'Not verified from here. The live keys live in the server settings, never on this page.', state: 'check' },
    { label: 'Tax and currency', detail: 'Plans are in USD. Whether to bill in SAR, AED or EGP, and how tax is shown, is a business decision.', state: 'todo', decision: true },
    { label: 'Failed-payment retry and grace', detail: 'How long to retry a failed card and how long an organization keeps full access is an owner decision.', state: 'todo', decision: true },
    { label: 'First plan assigned', detail: 'The first subscription turns plan limits on for that organization.', state: subCount ? 'done' : 'todo', decision: !subCount },
  ]
  const doneSteps = steps.filter((s) => s.state === 'done').length

  async function exportPlanTable() {
    await exportConsoleRows({
      rows: orgs, title: 'Plan per organization', columns: [
        { key: 'name', header: 'Organization' },
        { key: 'plan', header: 'Plan', value: (o) => subByOrg[o.id]?.plan_code || 'None' },
        { key: 'old', header: 'Old label', value: (o) => o.plan || '' },
        { key: 'users', header: 'Users', value: (o) => usageFor(o).users ?? 'N/A' },
        { key: 'vehicles', header: 'Vehicles', value: (o) => usageFor(o).vehicles ?? 'N/A' },
        { key: 'storage', header: 'Storage', value: (o) => storageText(o.id) },
        { key: 'keys', header: 'API keys', value: (o) => usageFor(o).apiKeys ?? 'N/A' },
        { key: 'fits', header: 'Plans it fits', value: (o) => plans.filter((p) => planFit(p, usageFor(o)).fits).map((p) => p.name).join(', ') },
      ],
    })
  }

  if (loading && !plans.length && !orgs.length) return <LoadingState label="Loading billing" rows={6} />

  const assignOrg = assign ? orgs.find((o) => o.id === assign.orgId) : null
  const assignPlan = assign ? plans.find((p) => p.code === assign.planCode) : null
  const preview = invoicePreview(assignPlan)

  return (
    <div className="space-y-4">
      <PageHeader icon={CreditCard} title="Billing"
        purpose="Plans, subscriptions and invoices for every organization. Billing is not switched on yet; this page shows exactly what would change when it is."
        refreshedAt={data.loadedAt} onRefresh={reload} refreshing={loading}
        actions={<>
          <Btn icon={ClipboardList} onClick={() => setSetup(true)}>Setup checklist</Btn>
          <Btn variant="primary" icon={CreditCard} onClick={() => setAssign({ orgId: orgs[0]?.id || '', planCode: '' })}>Assign plan</Btn>
        </>} />

      <Note icon={Info}>New page. No console page existed before; each company could only see its own plan in the main app.</Note>
      {(plansError || orgsError) && <ErrorState message={plansError || orgsError} onRetry={reload} />}

      <section className="rounded-xl border border-amber-800/40 bg-amber-950/15 p-4 flex flex-col md:flex-row md:items-center gap-3">
        <AlertTriangle size={18} className="text-amber-400 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-100">Billing is not live</h2>
          <p className="text-xs text-gray-400 max-w-[80ch]">Plans are defined, but {subCount === 0 ? 'no organization has a subscription' : subCount == null ? 'subscriptions could not be read' : `${subCount} organizations have a subscription`} and {counts?.invoices === 0 ? 'no invoice has ever been issued' : counts?.invoices == null ? 'invoices could not be read' : `${counts.invoices} invoices exist`}. Nobody is charged. Revenue is shown as N/A rather than 0 because nothing is being measured yet.</p>
        </div>
        <div className="text-xs text-gray-300 shrink-0">Setup: <span className="font-semibold">{doneSteps} of {steps.length}</span> steps done
          <div className="mt-1 h-1.5 w-40 rounded bg-gray-800"><div className="h-1.5 rounded bg-orange-500" style={{ width: `${(doneSteps / steps.length) * 100}%` }} /></div>
        </div>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={Building2} label="Subscriptions" value={fmtNum(subCount)} sub={`of ${orgs.length} organizations`} />
        <StatTile icon={TrendingUp} label="Monthly revenue" value="N/A" sub="Never 0 while not live; per currency once live" />
        <StatTile icon={Receipt} label="Invoices" value={fmtNum(counts?.invoices ?? null)} sub={counts ? `${fmtNum(counts.pastDue)} past due` : 'N/A'} />
        <StatTile icon={Layers} label="Plans defined" value={fmtNum(plans.length)} sub={plans.map((p) => p.name).join(', ')} />
        <StatTile icon={Building2} label="Largest organization" value={largest ? fmtNum(statsById[largest.id]?.vehicles ?? null) : 'N/A'} sub={largest ? `vehicles in ${largest.name}; fits ${largestFits.join(', ') || 'no plan'}` : 'N/A'} />
        <StatTile icon={ShieldCheck} label="Limits enforced" value={`${fmtNum(subCount)} orgs`} sub="Check is built; starts with the first subscription" />
      </div>

      <Panel>
        <PanelHeader title="Plans" subtitle={`${plans.length} defined. Prices are in US dollars; SAR, AED and EGP amounts are never added together.`} />
        {plans.length === 0 ? <EmptyState title="No plans" reason="No subscription plan is defined." /> : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4">
            {plans.map((p) => (
              <li key={p.id} className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-100">{p.name}</h3>
                  <span className="text-[11px] text-gray-500">{p.code}</span>
                </div>
                <p className="text-2xl font-semibold text-gray-100 tabular-nums">{planPriceLabel(p)}</p>
                <p className="text-[11px] text-gray-500">{isCustomPlan(p) ? 'Agreed per contract' : Number(p.price_monthly) > 0 ? `per month, ${p.currency}; ${fmtMoney(p.price_annual, p.currency)} a year` : p.description || 'Free'}</p>
                <dl className="grid grid-cols-2 gap-y-1 text-[11px] mt-1">
                  <dt className="text-gray-500">Vehicles</dt><dd className="text-right text-gray-200">{limitLabel(p.max_vehicles)}</dd>
                  <dt className="text-gray-500">Users</dt><dd className="text-right text-gray-200">{limitLabel(p.max_users)}</dd>
                  <dt className="text-gray-500">API keys</dt><dd className="text-right text-gray-200">{limitLabel(p.max_api_keys)}</dd>
                  <dt className="text-gray-500">Storage</dt><dd className="text-right text-gray-200">{limitLabel(p.max_storage_gb, ' GB')}</dd>
                </dl>
                <p className="text-[11px] text-gray-400">{featureLine(p)}</p>
                <p className="mt-auto text-[11px] text-gray-500">{subs == null ? 'N/A' : `${plansInUse(p.code)} organizations`}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader title="Plan per organization" subtitle="Current usage against what each plan allows"
          actions={<Btn size="xs" icon={Download} onClick={exportPlanTable}>Excel</Btn>} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[11px] text-gray-500 border-b border-gray-800">
              <tr><th className="px-3 py-2 text-left">Organization</th><th className="px-3 py-2 text-left">Plan</th>
                <th className="px-3 py-2 text-right">Users</th><th className="px-3 py-2 text-right">Vehicles</th>
                <th className="px-3 py-2 text-left">Storage</th><th className="px-3 py-2 text-right">API keys</th>
                <th className="px-3 py-2 text-left">Which plans it fits</th><th className="px-3 py-2 relative"><span className="sr-only">Action</span></th></tr>
            </thead>
            <tbody className="divide-y divide-gray-800/70">
              {orgs.map((o) => {
                const u = usageFor(o)
                const empty = isEmptyOrg(statsById[o.id])
                return (
                  <tr key={o.id}>
                    <td className="px-3 py-2 text-gray-200">{o.name}</td>
                    <td className="px-3 py-2 text-gray-400">{subByOrg[o.id]?.plan_code || 'None'}{o.plan ? <span className="text-gray-500"> (old: {o.plan})</span> : null}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(u.users)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(u.vehicles)}</td>
                    <td className="px-3 py-2 text-gray-300 tabular-nums whitespace-nowrap" title={storageError ? `Storage could not be read: ${storageError}` : "Uploaded files owned by this organization's people"}>{storageText(o.id)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(u.apiKeys)}</td>
                    <td className="px-3 py-2">
                      {empty ? <span className="text-gray-500">Empty organization</span> : (
                        <div className="flex flex-wrap gap-1">{plans.map((p) => {
                          const f = planFit(p, u)
                          return <Pill key={p.code} tone={f.fits ? 'good' : 'danger'} title={f.fits ? 'Fits today' : `Would block new ${f.blocks.join(', ')}`}>{p.name}</Pill>
                        })}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right"><Btn size="xs" onClick={() => setAssign({ orgId: o.id, planCode: '' })}>Assign plan</Btn></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-t border-gray-800">
          <p className="text-[11px] text-gray-500 flex-1 min-w-[16rem]">Storage counts uploaded files owned by each organization&apos;s people (photos, import files); plan storage limits are not checked against it yet. Green plans fit today&apos;s usage; red plans would block new vehicles or users the moment they are assigned. The old words on each organization (standard, starter) are leftover labels that nothing bills or limits.</p>
          <Btn size="xs" onClick={() => setTrial(true)}>Set trial end</Btn>
        </div>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Panel>
          <PanelHeader title="What switching billing on would change" />
          <ol className="p-4 space-y-3 text-xs text-gray-300">
            {[
              ['Plan limits start to apply', `Only organizations with a subscription are checked.${largest ? ` ${largest.name} could only take ${largestFits.join(', ') || 'no plan'} without blocking new vehicles or users.` : ''}`],
              ['Paid plans activate only after payment', 'A paid plan is switched on by the payment provider confirming payment, never by an admin click.'],
              ['Invoices start', 'Each billing period creates an invoice per organization, in the plan currency.'],
              ['Failed payment', 'Retry window and grace length (banner, then read-only) are chosen by the owner before go-live. Data is never deleted.', true],
              ['Revenue appears', 'Monthly recurring revenue counts paying plans only, before tax, shown per currency and never added across currencies.'],
            ].map(([t, b, dec], i) => (
              <li key={t} className="flex gap-3">
                <span className="h-5 w-5 rounded-full bg-gray-800 text-gray-300 text-[11px] grid place-items-center shrink-0">{i + 1}</span>
                <div><p className="font-semibold text-gray-200 flex flex-wrap items-center gap-2">{t}{dec && <DecisionTag />}</p><p className="text-gray-400">{b}</p></div>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel>
          <PanelHeader title="Revenue" subtitle="Not live" />
          <div className="grid grid-cols-2 gap-3 p-4">
            <StatTile label="Monthly revenue" value="N/A" sub={`${fmtNum(subCount)} subscriptions`} />
            <StatTile label="Annual revenue" value="N/A" sub="per currency once live" />
            <StatTile label="Invoices" value={fmtNum(counts?.invoices ?? null)} sub="ever issued" />
            <StatTile label="Past due" value={fmtNum(counts?.pastDue ?? null)} sub="no one is billed" />
            <StatTile label="Trials running" value={fmtNum(counts?.trialing ?? null)} sub="no trial end dates set" />
            <StatTile label="Payment events" value="N/A" sub="No payment event log exists yet" />
          </div>
        </Panel>
      </div>

      <Modal open={!!assign} title="Assign a plan" onClose={() => setAssign(null)} width="max-w-2xl"
        footer={<><Btn onClick={() => setAssign(null)}>Close</Btn><Btn variant="primary" disabled>Assign plan</Btn></>}>
        {assign && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><DecisionTag label="Needs owner decision: billing is not live" /></div>
            <label className="block"><span className="block text-[11px] font-semibold text-gray-400 mb-1">Organization</span>
              <Select value={assign.orgId} onChange={(v) => setAssign((a) => ({ ...a, orgId: v }))} ariaLabel="Organization" options={orgs.map((o) => ({ value: o.id, label: o.name }))} /></label>
            {assignOrg && (
              <p className="text-xs text-gray-400">{assignOrg.name} has {fmtNum(usageFor(assignOrg).users)} members and {fmtNum(usageFor(assignOrg).vehicles)} vehicles.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Plan">
              {plans.map((p) => {
                const f = assignOrg ? planFit(p, usageFor(assignOrg)) : { fits: true, blocks: [] }
                const on = assign.planCode === p.code
                return (
                  <button key={p.code} type="button" role="radio" aria-checked={on} onClick={() => setAssign((a) => ({ ...a, planCode: p.code }))}
                    className={`text-left rounded-lg border p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 ${on ? 'border-orange-600/60 bg-orange-950/20' : 'border-gray-800 hover:border-gray-700'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-gray-100">{p.name}</span><Pill tone={f.fits ? 'good' : 'danger'}>{f.fits ? 'Fits' : 'Would block'}</Pill></div>
                    <p className="text-[11px] text-gray-500 mt-1">{isCustomPlan(p) ? 'Unlimited, custom contract price' : `${limitLabel(p.max_vehicles)} vehicles, ${limitLabel(p.max_users)} users, ${planPriceLabel(p)} a month`}</p>
                    {!f.fits && <p className="text-[11px] text-red-300 mt-1">Would block new {f.blocks.join(', ')}.</p>}
                  </button>
                )
              })}
            </div>
            {assignPlan && (
              <div className="rounded-lg border border-gray-800 p-3 text-xs space-y-1">
                <p className="font-semibold text-gray-200">Next invoice preview</p>
                <p className="text-gray-400">Plan price: {preview.price == null ? 'Custom, set per contract' : fmtMoney(preview.price, assignPlan.currency)}</p>
                <p className="text-gray-400">Part-month charge: {preview.prorated == null ? 'N/A, no price to split' : `${fmtMoney(preview.prorated, assignPlan.currency)} for ${preview.daysLeft} of ${preview.daysInMonth} days`}</p>
                <p className="text-gray-400">First full invoice: {preview.price == null ? 'Only after a contract price is entered' : fmtRiyadh(preview.firstInvoice.toISOString(), { time: false, year: true })}</p>
              </div>
            )}
            <ImpactBox tone="warning" what={assignOrg ? `${assignOrg.name} would get its first subscription.` : 'An organization would get a subscription.'}
              change="Plan limits would start to apply to this organization at once (the limit check turns on with the first subscription). A paid plan activates only after the payment provider confirms payment."
              who={assignOrg ? `${fmtNum(usageFor(assignOrg).users)} members of ${assignOrg.name}.` : 'Its members.'}
              undo="Yes. Removing the plan turns limits off again." />
            <Note icon={Info}>This is a preview. Assigning is switched off until the owner decides to take billing live (tax and currency, retry and grace). Nothing on this page charges anyone.</Note>
          </div>
        )}
      </Modal>

      <Modal open={trial} title="Set trial end" onClose={() => setTrial(false)} width="max-w-md" footer={<Btn onClick={() => setTrial(false)}>Close</Btn>}>
        <div className="space-y-2 text-xs text-gray-300">
          <DecisionTag />
          <p>A trial end date belongs to a subscription, and {subCount === 0 ? 'no organization has one yet' : 'this action waits on billing going live'}. Once the first plan is assigned, the trial end is set there.</p>
        </div>
      </Modal>

      <Drawer open={setup} onClose={() => setSetup(false)} title="Billing setup" subtitle={`${doneSteps} of ${steps.length} steps done`}>
        <ul className="space-y-3">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-3 text-xs">
              {s.state === 'done' ? <Check size={15} className="text-emerald-400 shrink-0" aria-hidden="true" />
                : s.state === 'check' ? <AlertTriangle size={15} className="text-amber-400 shrink-0" aria-hidden="true" />
                  : <CircleDashed size={15} className="text-gray-500 shrink-0" aria-hidden="true" />}
              <div className="min-w-0">
                <p className="font-semibold text-gray-200 flex flex-wrap items-center gap-2">{s.label}
                  <Pill tone={s.state === 'done' ? 'good' : s.state === 'check' ? 'warning' : 'muted'}>{s.state === 'done' ? 'Done' : s.state === 'check' ? 'Check' : 'To do'}</Pill>
                  {s.decision && <DecisionTag />}
                </p>
                <p className="text-gray-400">{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-gray-500">A test-clock rehearsal of renewals and failed payments needs the provider&apos;s test key and is not run from this page.</p>
      </Drawer>
    </div>
  )
}
