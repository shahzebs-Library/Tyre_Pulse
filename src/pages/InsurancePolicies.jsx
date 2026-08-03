/**
 * InsurancePolicies (route /insurance-policies) - ADMIN ONLY.
 *
 * The insurance knowledge base: the fleet's real insurance policies and their
 * conditions (RLS restricts every row to Admin + super-admin). This page turns
 * that knowledge into concrete, cited claim decisions so an admin can answer
 * "if a case is rejected or delayed, which policy and which clause says so".
 *
 * All reasoning is the PURE engine (src/lib/insuranceKnowledge.js). Data is the
 * service (src/lib/api/insurancePolicies.js). This page never fabricates policy
 * data beyond what the service returns; null numbers render N/A.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Shield, FileText, FileSpreadsheet, AlertOctagon, Clock, Info,
  Plus, Pencil, Trash2, X, RefreshCw, Search, Calculator, Save, Upload,
} from 'lucide-react'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrency, formatDate } from '../lib/formatters'
import {
  listPolicies, getPolicy, createPolicy, updatePolicy, deletePolicy,
  addCondition, updateCondition, deleteCondition,
} from '../lib/api/insurancePolicies'
import {
  assessClaim, totalLossAssessment,
  POLICY_TYPE_LABELS, CONDITION_CATEGORY_LABELS, num,
} from '../lib/insuranceKnowledge'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'

// ── small presentational helpers ─────────────────────────────────────────────
function money(v, ccy) {
  const n = num(v)
  return n == null ? 'N/A' : formatCurrency(n, ccy)
}
function pctText(v) {
  const n = num(v)
  return n == null ? 'N/A' : `${n}%`
}
function dateText(v, country) {
  if (!v) return 'N/A'
  return formatDate(v, country)
}

function SeverityBadge({ severity }) {
  const map = {
    reject: { label: 'Rejection', cls: 'bg-red-500/15 text-red-300 border border-red-500/30' },
    delay: { label: 'Delay', cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' },
    info: { label: 'Info', cls: 'bg-slate-500/15 text-slate-300 border border-slate-500/30' },
  }
  const m = map[severity] || map.info
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>
}

// ── condition CRUD categories ─────────────────────────────────────────────────
const CATEGORY_KEYS = Object.keys(CONDITION_CATEGORY_LABELS)
const POLICY_TYPE_KEYS = Object.keys(POLICY_TYPE_LABELS)

// The claim-scenario context flags the operator sets.
const DEFAULT_CTX = {
  repairedBeforeApproval: false,
  driverLicenceValid: true,
  driverAge: '',
  vehicleCommercial: false,
  authorizedDriver: true,
  stolen: false,
  originalKeysHandedOver: true,
  reportedToPolice: true,
  thirdPartyFaultPct: '',
  outsideKsa: false,
}

export default function InsurancePolicies() {
  const { activeCountry } = useSettings() || {}

  const [policies, setPolicies] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null) // { ...policy, conditions: [] }
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  // scenario checker state
  const [ctx, setCtx] = useState(DEFAULT_CTX)

  // total-loss state (defaults seeded from the selected policy)
  const [repairCost, setRepairCost] = useState('')
  const [insuredValue, setInsuredValue] = useState('')

  // modals
  const [policyModal, setPolicyModal] = useState(null)   // { mode:'create'|'edit', row }
  const pdfRef = useRef(null)
  const [importing, setImporting] = useState(false)

  async function onImportPdf(e) {
    const file = e.target.files?.[0]
    if (pdfRef.current) pdfRef.current.value = ''
    if (!file) return
    setImporting(true); setError('')
    try {
      const { insurancePolicyRowsFromPdf } = await import('../lib/import/parseInsurancePolicy')
      const parsed = await insurancePolicyRowsFromPdf(file)
      // Open the create form prefilled from the parsed schedule; the reviewer
      // confirms before saving. Detected conditions are noted for reference.
      const condNote = Array.isArray(parsed.conditions) && parsed.conditions.length
        ? `${parsed.conditions.length} condition(s) detected in the PDF; add them below after saving.`
        : ''
      setPolicyModal({ mode: 'create', row: { country: activeCountry && activeCountry !== 'All' ? activeCountry : 'KSA', ...parsed, notes: condNote } })
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setImporting(false)
    }
  }
  const [conditionModal, setConditionModal] = useState(null) // { mode:'create'|'edit', row }
  const [busy, setBusy] = useState(false)

  const loadPolicies = useCallback(async (keepSelection = false) => {
    setLoading(true)
    setError('')
    const { data, error: err } = await listPolicies({ country: activeCountry })
    if (err) setError(err)
    const rows = Array.isArray(data) ? data : []
    setPolicies(rows)
    setLoading(false)
    if (!keepSelection) {
      setSelectedId(rows.length ? rows[0].id : null)
    } else if (selectedId && !rows.some((r) => r.id === selectedId)) {
      setSelectedId(rows.length ? rows[0].id : null)
    }
  }, [activeCountry, selectedId])

  useEffect(() => { loadPolicies() }, [activeCountry]) // eslint-disable-line react-hooks/exhaustive-deps

  // load the selected policy's full detail + conditions
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!selectedId) { setDetail(null); return }
      setDetailLoading(true)
      const { data, error: err } = await getPolicy(selectedId)
      if (cancelled) return
      if (err) setError(err)
      setDetail(data || null)
      setDetailLoading(false)
    }
    run()
    return () => { cancelled = true }
  }, [selectedId])

  // seed the insured value + threshold defaults when a policy is selected
  useEffect(() => {
    if (!detail) return
    const seed = detail.sum_insured ?? detail.limit_of_liability ?? ''
    setInsuredValue(seed == null ? '' : String(seed))
  }, [detail])

  const ccy = detail?.currency || 'SAR'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return policies
    return policies.filter((p) =>
      [p.policy_no, p.insurer, p.insured_name, POLICY_TYPE_LABELS[p.policy_type] || p.policy_type]
        .some((v) => String(v || '').toLowerCase().includes(q)))
  }, [policies, search])

  // enrich conditions with the policy_no so findings can cite it
  const conditions = useMemo(() => {
    if (!detail) return []
    return (detail.conditions || []).map((c) => ({ ...c, policy_no: detail.policy_no }))
  }, [detail])

  const conditionsByCategory = useMemo(() => {
    const groups = {}
    for (const c of conditions) {
      const k = c.category || 'other'
      if (!groups[k]) groups[k] = []
      groups[k].push(c)
    }
    return groups
  }, [conditions])

  const findings = useMemo(() => {
    if (!conditions.length) return []
    const parsed = {
      ...ctx,
      driverAge: ctx.driverAge === '' ? null : Number(ctx.driverAge),
      thirdPartyFaultPct: ctx.thirdPartyFaultPct === '' ? null : Number(ctx.thirdPartyFaultPct),
      policyNo: detail?.policy_no,
    }
    return assessClaim(conditions, parsed)
  }, [conditions, ctx, detail])

  const totalLoss = useMemo(() => totalLossAssessment({
    repairCost,
    insuredValue,
    thresholdPct: detail?.total_loss_threshold_pct,
  }), [repairCost, insuredValue, detail])

  // ── exports ─────────────────────────────────────────────────────────────────
  function exportRows() {
    return conditions.map((c) => ({
      seq: c.seq ?? '',
      category: CONDITION_CATEGORY_LABELS[c.category] || c.category || '',
      clause_text: c.clause_text || '',
      causes_rejection: c.causes_rejection ? 'Yes' : 'No',
      causes_delay: c.causes_delay ? 'Yes' : 'No',
    }))
  }
  const EXPORT_KEYS = ['seq', 'category', 'clause_text', 'causes_rejection', 'causes_delay']
  const EXPORT_HEADERS = ['Seq', 'Category', 'Clause', 'Rejection', 'Delay']

  function onExportExcel() {
    if (!detail) return
    exportToExcel(exportRows(), EXPORT_KEYS, EXPORT_HEADERS,
      reportFileName('Insurance Policy', detail.policy_no || ''), 'Conditions')
  }
  function onExportPdf() {
    if (!detail) return
    exportToPdf(
      exportRows(),
      EXPORT_KEYS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
      `Insurance Policy ${detail.policy_no || ''}`,
      reportFileName('Insurance Policy', detail.policy_no || ''),
      'landscape',
      '',
      { currency: ccy },
    )
  }

  // ── policy CRUD ───────────────────────────────────────────────────────────────
  async function savePolicy(form) {
    setBusy(true)
    const payload = {
      country: form.country || null,
      policy_no: form.policy_no || null,
      policy_type: form.policy_type || null,
      insurer: form.insurer || null,
      insured_name: form.insured_name || null,
      period_from: form.period_from || null,
      period_to: form.period_to || null,
      premium: num(form.premium),
      sum_insured: num(form.sum_insured),
      limit_of_liability: num(form.limit_of_liability),
      currency: form.currency || 'SAR',
      deductible_text: form.deductible_text || null,
      total_loss_threshold_pct: num(form.total_loss_threshold_pct),
      coverage_summary: form.coverage_summary || null,
      notes: form.notes || null,
    }
    const res = policyModal.mode === 'edit'
      ? await updatePolicy(policyModal.row.id, payload)
      : await createPolicy(payload)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setPolicyModal(null)
    const newId = res.data?.id
    await loadPolicies(true)
    if (newId) setSelectedId(newId)
  }

  async function removePolicy(id) {
    setBusy(true)
    const res = await deletePolicy(id)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    await loadPolicies()
  }

  // ── condition CRUD ────────────────────────────────────────────────────────────
  async function saveCondition(form) {
    if (!detail) return
    setBusy(true)
    const payload = {
      policy_id: detail.id,
      seq: num(form.seq),
      category: form.category || 'other',
      clause_text: form.clause_text || null,
      causes_rejection: !!form.causes_rejection,
      causes_delay: !!form.causes_delay,
    }
    const res = conditionModal.mode === 'edit'
      ? await updateCondition(conditionModal.row.id, payload)
      : await addCondition(payload)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setConditionModal(null)
    // reload the selected policy detail
    const { data } = await getPolicy(detail.id)
    setDetail(data || null)
  }

  async function removeCondition(id) {
    if (!detail) return
    setBusy(true)
    const res = await deleteCondition(id)
    setBusy(false)
    if (res.error) { setError(res.error); return }
    const { data } = await getPolicy(detail.id)
    setDetail(data || null)
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Insurance Policies"
        subtitle="Admin knowledge base: policies, conditions and cited claim decisions"
        icon={Shield}
        onRefresh={() => loadPolicies(true)}
        refreshing={loading}
        actions={
          <div className="flex items-center gap-2">
            <input ref={pdfRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={onImportPdf} />
            <button
              type="button"
              disabled={importing}
              onClick={() => pdfRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              title="Read a policy schedule PDF and prefill a new policy"
            >
              <Upload size={16} /> {importing ? 'Reading...' : 'Import PDF'}
            </button>
            <button
              type="button"
              onClick={() => setPolicyModal({ mode: 'create', row: {} })}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              <Plus size={16} /> Add policy
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => loadPolicies(true)} className="inline-flex items-center gap-1 rounded-md border border-red-400/40 px-2 py-1 text-red-200 hover:bg-red-500/20">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {/* search */}
      <div className="relative max-w-md">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search policies by number, insurer or type"
          className="w-full rounded-lg border border-slate-700 bg-slate-900/50 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">Loading insurance policies...</div>
      ) : policies.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center">
          <Shield className="mx-auto mb-3 text-slate-500" size={32} />
          <p className="text-slate-300">No insurance policies found.</p>
          <p className="mt-1 text-sm text-slate-500">Add a policy to build the claim knowledge base.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── policy list ── */}
          <div className="space-y-3 lg:col-span-1">
            {filtered.map((p) => {
              const active = p.id === selectedId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-xl border p-4 text-left transition ${active ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 bg-slate-900/40 hover:border-slate-600'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-slate-100">{p.policy_no || 'N/A'}</p>
                      <p className="mt-0.5 text-xs text-emerald-300">{POLICY_TYPE_LABELS[p.policy_type] || p.policy_type || 'Other'}</p>
                    </div>
                  </div>
                  <p className="mt-2 truncate text-xs text-slate-400">{p.insurer || 'Insurer N/A'}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                    <span>{dateText(p.period_from, activeCountry)} to {dateText(p.period_to, activeCountry)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Sum insured / limit</span>
                      <p className="text-slate-200">{money(p.sum_insured ?? p.limit_of_liability, p.currency || 'SAR')}</p>
                    </div>
                    <div>
                      <span className="text-slate-500">Total loss</span>
                      <p className="text-slate-200">{pctText(p.total_loss_threshold_pct)}</p>
                    </div>
                  </div>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-center text-sm text-slate-500">No policies match "{search}".</p>
            )}
          </div>

          {/* ── selected policy detail ── */}
          <div className="space-y-6 lg:col-span-2">
            {detailLoading ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">Loading policy...</div>
            ) : !detail ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center text-slate-400">Select a policy to view its detail.</div>
            ) : (
              <>
                {/* detail header */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-mono text-lg text-slate-100">{detail.policy_no || 'N/A'}</h2>
                      <p className="text-sm text-emerald-300">{POLICY_TYPE_LABELS[detail.policy_type] || detail.policy_type || 'Other'}</p>
                      <p className="mt-1 text-sm text-slate-400">{detail.insurer || 'Insurer N/A'}{detail.insured_name ? ` - ${detail.insured_name}` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={onExportExcel} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
                        <FileSpreadsheet size={14} /> Excel
                      </button>
                      <button type="button" onClick={onExportPdf} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
                        <FileText size={14} /> PDF
                      </button>
                      <button type="button" onClick={() => setPolicyModal({ mode: 'edit', row: detail })} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
                        <Pencil size={14} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (window.confirm(`Delete policy ${detail.policy_no || ''}? Its conditions are removed too.`)) removePolicy(detail.id) }}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Fact label="Period" value={`${dateText(detail.period_from, activeCountry)} - ${dateText(detail.period_to, activeCountry)}`} />
                    <Fact label="Premium" value={money(detail.premium, ccy)} />
                    <Fact label="Sum insured" value={money(detail.sum_insured, ccy)} />
                    <Fact label="Limit of liability" value={money(detail.limit_of_liability, ccy)} />
                    <Fact label="Total-loss threshold" value={pctText(detail.total_loss_threshold_pct)} />
                    <Fact label="Currency" value={ccy} />
                  </div>

                  {detail.coverage_summary && (
                    <div className="mt-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Coverage summary</p>
                      <p className="mt-1 text-sm text-slate-300">{detail.coverage_summary}</p>
                    </div>
                  )}
                  {detail.deductible_text && (
                    <div className="mt-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Deductible</p>
                      <p className="mt-1 text-sm text-slate-300">{detail.deductible_text}</p>
                    </div>
                  )}
                </div>

                {/* conditions grouped by category */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200">Conditions</h3>
                    <button type="button" onClick={() => setConditionModal({ mode: 'create', row: {} })} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800">
                      <Plus size={14} /> Add condition
                    </button>
                  </div>
                  {conditions.length === 0 ? (
                    <p className="text-sm text-slate-500">No conditions recorded for this policy.</p>
                  ) : (
                    <div className="space-y-4">
                      {Object.entries(conditionsByCategory).map(([cat, list]) => (
                        <div key={cat}>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{CONDITION_CATEGORY_LABELS[cat] || cat}</p>
                          <div className="space-y-2">
                            {list.map((c) => (
                              <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-sm text-slate-200">{c.clause_text || '(no clause text)'}</p>
                                  <div className="flex shrink-0 items-center gap-1">
                                    <button type="button" onClick={() => setConditionModal({ mode: 'edit', row: c })} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200" aria-label="Edit condition">
                                      <Pencil size={13} />
                                    </button>
                                    <button type="button" onClick={() => { if (window.confirm('Delete this condition?')) removeCondition(c.id) }} className="rounded p-1 text-red-400 hover:bg-red-500/10" aria-label="Delete condition">
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {c.causes_rejection && <SeverityBadge severity="reject" />}
                                  {c.causes_delay && <SeverityBadge severity="delay" />}
                                  {c.seq != null && <span className="text-xs text-slate-500">Clause {c.seq}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* claim scenario checker */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertOctagon size={16} className="text-amber-300" />
                    <h3 className="text-sm font-semibold text-slate-200">Claim scenario checker</h3>
                  </div>
                  <p className="mb-4 text-xs text-slate-500">Set the case facts. The engine cites the exact policy clause behind any rejection or delay.</p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Check label="Repaired before insurer approval" checked={ctx.repairedBeforeApproval} onChange={(v) => setCtx((s) => ({ ...s, repairedBeforeApproval: v }))} />
                    <Check label="Driver held a valid licence" checked={ctx.driverLicenceValid} onChange={(v) => setCtx((s) => ({ ...s, driverLicenceValid: v }))} />
                    <Check label="Commercial vehicle" checked={ctx.vehicleCommercial} onChange={(v) => setCtx((s) => ({ ...s, vehicleCommercial: v }))} />
                    <Check label="Authorized driver" checked={ctx.authorizedDriver} onChange={(v) => setCtx((s) => ({ ...s, authorizedDriver: v }))} />
                    <Check label="Vehicle stolen" checked={ctx.stolen} onChange={(v) => setCtx((s) => ({ ...s, stolen: v }))} />
                    <Check label="Original keys handed over" checked={ctx.originalKeysHandedOver} onChange={(v) => setCtx((s) => ({ ...s, originalKeysHandedOver: v }))} />
                    <Check label="Reported to police" checked={ctx.reportedToPolice} onChange={(v) => setCtx((s) => ({ ...s, reportedToPolice: v }))} />
                    <Check label="Incident outside KSA" checked={ctx.outsideKsa} onChange={(v) => setCtx((s) => ({ ...s, outsideKsa: v }))} />
                    <NumField label="Driver age" value={ctx.driverAge} onChange={(v) => setCtx((s) => ({ ...s, driverAge: v }))} placeholder="years" />
                    <NumField label="Third-party fault %" value={ctx.thirdPartyFaultPct} onChange={(v) => setCtx((s) => ({ ...s, thirdPartyFaultPct: v }))} placeholder="0 - 100" />
                  </div>

                  <div className="mt-4 space-y-2">
                    {findings.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
                        <Info size={15} /> No rejection or delay condition triggered for these facts.
                      </div>
                    ) : (
                      findings.map((f, i) => {
                        const tone = f.severity === 'reject'
                          ? 'border-red-500/30 bg-red-500/5'
                          : f.severity === 'delay' ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-700 bg-slate-950/40'
                        const Icon = f.severity === 'reject' ? AlertOctagon : f.severity === 'delay' ? Clock : Info
                        return (
                          <div key={i} className={`rounded-lg border p-3 ${tone}`}>
                            <div className="flex items-start gap-2">
                              <Icon size={16} className={f.severity === 'reject' ? 'text-red-300' : f.severity === 'delay' ? 'text-amber-300' : 'text-slate-300'} />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-slate-100">{f.title}</span>
                                  <SeverityBadge severity={f.severity} />
                                </div>
                                <p className="mt-1 text-sm text-slate-300">{f.reason}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  Policy {f.policyNo || 'N/A'}
                                  {f.conditionSeq != null ? ` | clause ${f.conditionSeq}` : ''}
                                  {f.category ? ` | ${CONDITION_CATEGORY_LABELS[f.category] || f.category}` : ''}
                                </p>
                                {f.clauseText && <p className="mt-1 text-xs italic text-slate-500">"{f.clauseText}"</p>}
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* vehicle value & total loss */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Calculator size={16} className="text-emerald-300" />
                    <h3 className="text-sm font-semibold text-slate-200">Vehicle value & total loss</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumField label={`Repair cost (${ccy})`} value={repairCost} onChange={setRepairCost} placeholder="0" />
                    <NumField label={`Insured value (${ccy})`} value={insuredValue} onChange={setInsuredValue} placeholder="0" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Fact label="Threshold" value={pctText(detail.total_loss_threshold_pct)} />
                    <Fact label="Threshold value" value={money(totalLoss.thresholdValue, ccy)} />
                    <Fact label="Repair / insured ratio" value={totalLoss.ratioPct == null ? 'N/A' : `${totalLoss.ratioPct}%`} />
                  </div>
                  <div className={`mt-3 rounded-lg border p-3 text-sm ${totalLoss.isTotalLoss == null ? 'border-slate-700 bg-slate-950/40 text-slate-300' : totalLoss.isTotalLoss ? 'border-red-500/30 bg-red-500/5 text-red-300' : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'}`}>
                    {totalLoss.isTotalLoss == null ? totalLoss.note : (totalLoss.isTotalLoss ? `Constructive total loss. ${totalLoss.note}` : `Not a total loss. ${totalLoss.note}`)}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {policyModal && (
        <PolicyModal
          mode={policyModal.mode}
          row={policyModal.row}
          busy={busy}
          onClose={() => setPolicyModal(null)}
          onSave={savePolicy}
        />
      )}
      {conditionModal && (
        <ConditionModal
          mode={conditionModal.mode}
          row={conditionModal.row}
          busy={busy}
          onClose={() => setConditionModal(null)}
          onSave={saveCondition}
        />
      )}
    </div>
  )
}

// ── small building blocks ─────────────────────────────────────────────────────
function Fact({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-200">{value}</p>
    </div>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500" />
      {label}
    </label>
  )
}

function NumField({ label, value, onChange, placeholder }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
      />
    </label>
  )
}

function ModalShell({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-100">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PolicyModal({ mode, row, busy, onClose, onSave }) {
  const [form, setForm] = useState({
    country: row.country || '',
    policy_no: row.policy_no || '',
    policy_type: row.policy_type || 'motor_comprehensive',
    insurer: row.insurer || '',
    insured_name: row.insured_name || '',
    period_from: (row.period_from || '').slice(0, 10),
    period_to: (row.period_to || '').slice(0, 10),
    premium: row.premium ?? '',
    sum_insured: row.sum_insured ?? '',
    limit_of_liability: row.limit_of_liability ?? '',
    currency: row.currency || 'SAR',
    deductible_text: row.deductible_text || '',
    total_loss_threshold_pct: row.total_loss_threshold_pct ?? '',
    coverage_summary: row.coverage_summary || '',
    notes: row.notes || '',
  })
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }))
  return (
    <ModalShell title={mode === 'edit' ? 'Edit policy' : 'Add policy'} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Policy number" value={form.policy_no} onChange={set('policy_no')} />
        <Select label="Type" value={form.policy_type} onChange={set('policy_type')} options={POLICY_TYPE_KEYS.map((k) => ({ value: k, label: POLICY_TYPE_LABELS[k] }))} />
        <Text label="Insurer" value={form.insurer} onChange={set('insurer')} />
        <Text label="Insured name" value={form.insured_name} onChange={set('insured_name')} />
        <Text label="Country" value={form.country} onChange={set('country')} />
        <Text label="Currency" value={form.currency} onChange={set('currency')} />
        <Text label="Period from" type="date" value={form.period_from} onChange={set('period_from')} />
        <Text label="Period to" type="date" value={form.period_to} onChange={set('period_to')} />
        <Text label="Premium" type="number" value={form.premium} onChange={set('premium')} />
        <Text label="Sum insured" type="number" value={form.sum_insured} onChange={set('sum_insured')} />
        <Text label="Limit of liability" type="number" value={form.limit_of_liability} onChange={set('limit_of_liability')} />
        <Text label="Total-loss threshold %" type="number" value={form.total_loss_threshold_pct} onChange={set('total_loss_threshold_pct')} />
        <Area label="Deductible" value={form.deductible_text} onChange={set('deductible_text')} className="sm:col-span-2" />
        <Area label="Coverage summary" value={form.coverage_summary} onChange={set('coverage_summary')} className="sm:col-span-2" />
        <Area label="Notes" value={form.notes} onChange={set('notes')} className="sm:col-span-2" />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Cancel</button>
        <button type="button" disabled={busy} onClick={() => onSave(form)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
          <Save size={15} /> {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </ModalShell>
  )
}

function ConditionModal({ mode, row, busy, onClose, onSave }) {
  const [form, setForm] = useState({
    seq: row.seq ?? '',
    category: row.category || 'claim_process',
    clause_text: row.clause_text || '',
    causes_rejection: !!row.causes_rejection,
    causes_delay: !!row.causes_delay,
  })
  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }))
  return (
    <ModalShell title={mode === 'edit' ? 'Edit condition' : 'Add condition'} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Sequence" type="number" value={form.seq} onChange={set('seq')} />
        <Select label="Category" value={form.category} onChange={set('category')} options={CATEGORY_KEYS.map((k) => ({ value: k, label: CONDITION_CATEGORY_LABELS[k] }))} />
        <Area label="Clause text" value={form.clause_text} onChange={set('clause_text')} className="sm:col-span-2" />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={form.causes_rejection} onChange={(e) => setForm((s) => ({ ...s, causes_rejection: e.target.checked }))} className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-red-500 focus:ring-red-500" />
          Causes rejection
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={form.causes_delay} onChange={(e) => setForm((s) => ({ ...s, causes_delay: e.target.checked }))} className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500" />
          Causes delay
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Cancel</button>
        <button type="button" disabled={busy} onClick={() => onSave(form)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
          <Save size={15} /> {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </ModalShell>
  )
}

function Text({ label, value, onChange, type = 'text', className = '' }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <input type={type} value={value} onChange={onChange} className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none" />
    </label>
  )
}
function Area({ label, value, onChange, className = '' }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <textarea value={value} onChange={onChange} rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none" />
    </label>
  )
}
function Select({ label, value, onChange, options }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <select value={value} onChange={onChange} className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-slate-100 focus:border-emerald-500 focus:outline-none">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
