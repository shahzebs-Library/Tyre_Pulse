/**
 * Retread casing register for Retread Management (owner mockup, 2026-10-05).
 *
 * Reads and writes the retread_jobs table (migration 20261005101000, authored,
 * applied by the lead). Before that migration is applied the section says the
 * register is not set up yet instead of reading as "no retreads". The table
 * starts empty: casings are added with "New retread" and moved through the
 * pipeline from the selected casing card.
 *
 * Blocks: pipeline by stage, vendor performance, ROI snapshot (from the page's
 * ROI calculator inputs), filter bar, register table and the selected casing's
 * lifecycle with Approve return / Reject / Raise claim.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Pencil, Trash2, CheckCircle2, XCircle, ShieldAlert, Info } from 'lucide-react'
import Modal from '../ui/Modal'
import { Card, CardState, KitTable, fmtInt } from '../commandCenter/kit'
import {
  listRetreadJobs, createRetreadJob, updateRetreadJob, setRetreadJobStatus, deleteRetreadJob,
  RETREAD_JOB_STATUS_VALUES, RETREAD_GRADES,
} from '../../lib/api/retreadJobs'
import {
  JOB_STATUS, OUTCOME, pipelineCounts, vendorPerformance, jobsWithoutVendor, filterJobs, optionsOf,
  turnaroundDays, daysAtVendor, jobCpk, lifecycleSteps,
} from '../../lib/retreadView'
import { COUNTRIES, COUNTRY_CURRENCY } from '../../contexts/SettingsContext'
import { toUserMessage } from '../../lib/safeError'

const NA = <span className="cc-na">N/A</span>
const EMPTY_FORM = {
  casing_serial: '', country: '', site: '', brand: '', size: '', last_asset_no: '', first_life_km: '',
  vendor_name: '', grade: '', cycle: 1, status: 'eligible', inspected_at: '', sent_at: '', returned_at: '',
  cost: '', outcome: 'pending', life_km: '', warranty_months: '', notes: '',
}
const EMPTY_FILTERS = { search: '', vendor: 'All', status: 'All', grade: 'All' }

const fmtDate = (v) => {
  if (!v) return null
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
const money = (v, cur) => (v == null || !Number.isFinite(Number(v)) || !cur
  ? null
  : `${cur} ${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
const todayIso = () => new Date().toISOString().slice(0, 10)

function Pill({ meta }) {
  return <span className={`cc-pill ${meta?.tone || 'muted'}`}>{meta?.label || 'N/A'}</span>
}

export default function RetreadJobsSection({ activeCountry, site = 'All', roi, roiInputs, onOpenRoi, openNewSignal = 0, canWrite = true }) {
  const [state, setState] = useState({ loading: true, rows: [], missing: false, error: '', truncated: false })
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await listRetreadJobs({ country: activeCountry })
      setState({ loading: false, rows: res.rows, missing: res.missing, error: '', truncated: res.truncated })
    } catch (e) {
      setState({ loading: false, rows: [], missing: false, error: toUserMessage(e, 'Could not load the retread register.'), truncated: false })
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const openCreate = useCallback(() => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, country: activeCountry && activeCountry !== 'All' ? activeCountry : '', site: site !== 'All' ? site : '' })
    setFormError('')
    setModalOpen(true)
  }, [activeCountry, site])

  useEffect(() => { if (openNewSignal) openCreate() }, [openNewSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const siteRows = useMemo(() => (site === 'All' ? state.rows : state.rows.filter((r) => r.site === site)), [state.rows, site])
  const pipeline = useMemo(() => pipelineCounts(siteRows), [siteRows])
  const vendors = useMemo(() => vendorPerformance(siteRows), [siteRows])
  const noVendor = useMemo(() => jobsWithoutVendor(siteRows), [siteRows])
  const filtered = useMemo(() => filterJobs(siteRows, filters), [siteRows, filters])
  const vendorOptions = useMemo(() => optionsOf(state.rows, 'vendor_name'), [state.rows])
  const selected = useMemo(() => state.rows.find((r) => r.id === selectedId) || null, [state.rows, selectedId])
  const filterCount = Object.entries(filters).filter(([k, v]) => (k === 'search' ? v.trim() : v !== 'All')).length

  const cardState = { loading: state.loading, data: state.error ? null : state.rows, error: state.error || null, retry: load }
  const notSetUp = 'The retread register is not set up on this database yet. It starts working once the retread jobs update is applied.'
  const emptyInvite = (
    <div>
      No casings have been sent for retreading yet.
      {canWrite && <><br /><button type="button" className="cc-btn" onClick={openCreate}>Add the first casing</button></>}
    </div>
  )
  const empty = state.missing ? notSetUp : (!state.loading && !siteRows.length ? emptyInvite : null)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const formCurrency = COUNTRY_CURRENCY[form.country] || null

  const openEdit = (r) => {
    setEditing(r)
    setForm({
      ...EMPTY_FORM,
      ...Object.fromEntries(Object.keys(EMPTY_FORM).map((k) => [k, r[k] ?? EMPTY_FORM[k]])),
    })
    setFormError('')
    setModalOpen(true)
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    setFormError('')
    setSaving(true)
    try {
      const values = { ...form, currency: form.cost !== '' && form.cost != null ? formCurrency : null }
      const saved = editing ? await updateRetreadJob(editing.id, values) : await createRetreadJob(values)
      setState((s) => ({
        ...s,
        rows: editing ? s.rows.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...s.rows],
      }))
      setSelectedId(saved.id)
      setModalOpen(false)
      setEditing(null)
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the retread.'))
    } finally {
      setSaving(false)
    }
  }

  const patchSelected = async (patch, done) => {
    if (!selected) return
    setBusy(true); setNotice('')
    try {
      const saved = await setRetreadJobStatus(selected.id, patch)
      setState((s) => ({ ...s, rows: s.rows.map((r) => (r.id === saved.id ? saved : r)) }))
      setNotice(done)
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not update the retread.'))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDel) return
    setBusy(true)
    try {
      await deleteRetreadJob(confirmDel.id)
      setState((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== confirmDel.id) }))
      if (selectedId === confirmDel.id) setSelectedId(null)
      setConfirmDel(null)
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the retread.'))
      setConfirmDel(null)
    } finally {
      setBusy(false)
    }
  }

  const maxPipe = Math.max(1, ...pipeline.map((p) => p.count))

  const columns = [
    { key: 'casing_serial', header: 'Casing serial', cell: (r) => <span className="cc-strong">{r.casing_serial}</span> },
    {
      key: 'brand', header: 'Brand / size', sortValue: (r) => `${r.brand || ''} ${r.size || ''}`,
      cell: (r) => ([r.brand, r.size].filter(Boolean).join(' ') || NA),
    },
    { key: 'last_asset_no', header: 'Last vehicle', cell: (r) => r.last_asset_no || NA },
    { key: 'grade', header: 'Grade', cell: (r) => (r.grade ? <span className={`rtj-grade g-${r.grade[0]}`}>{r.grade}</span> : NA) },
    { key: 'cycle', header: 'Cycle', numeric: true, cell: (r) => r.cycle ?? NA },
    { key: 'vendor_name', header: 'Vendor', cell: (r) => r.vendor_name || NA },
    { key: 'status', header: 'Status', sortValue: (r) => JOB_STATUS[r.status]?.label || '', cell: (r) => <Pill meta={JOB_STATUS[r.status]} /> },
    {
      key: 'tat', header: 'TAT', numeric: true, sortValue: (r) => turnaroundDays(r) ?? daysAtVendor(r) ?? -1,
      cell: (r) => {
        const t = turnaroundDays(r)
        if (t != null) return `${t} d`
        const so = daysAtVendor(r)
        return so != null ? <span title="Still at the vendor: days so far">{so} d so far</span> : NA
      },
    },
    { key: 'cost', header: 'Cost', numeric: true, sortValue: (r) => Number(r.cost) || -1, cell: (r) => money(r.cost, r.currency) || NA },
    { key: 'outcome', header: 'Outcome', sortValue: (r) => r.outcome || '', cell: (r) => <Pill meta={OUTCOME[r.outcome]} /> },
    {
      key: 'actions', header: 'Actions', sortable: false,
      cell: (r) => (
        <div className="rtj-row-actions" onClick={(e) => e.stopPropagation()} role="presentation">
          <button type="button" className="cc-icon-btn" disabled={!canWrite} onClick={() => openEdit(r)} aria-label={`Edit ${r.casing_serial}`} title="Edit"><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn rtj-danger" disabled={!canWrite} onClick={() => setConfirmDel(r)} aria-label={`Delete ${r.casing_serial}`} title="Delete"><Trash2 size={14} /></button>
        </div>
      ),
    },
  ]

  const steps = lifecycleSteps(selected, fmtDate)
  const selCpk = selected ? jobCpk(selected) : null

  return (
    <div className="rtj">
      <div className="rtj-row">
        <Card title="Retread pipeline" sub={`Casings by stage${site !== 'All' ? `, ${site}` : ''}`}>
          <CardState state={cardState} empty={empty}>
            <ul className="rtj-pipe">
              {pipeline.map((p) => (
                <li key={p.key}>
                  <button type="button" onClick={() => setFilters((f) => ({ ...f, status: STAGE_FILTER[p.key] || 'All' }))} title={`Show ${p.label.toLowerCase()} in the register`}>
                    <span className="rtj-pipe-label">{p.label}</span>
                    <span className="rtj-pipe-track"><i className={`tone-${p.tone}`} style={{ width: `${(p.count / maxPipe) * 100}%` }} /></span>
                    <b>{fmtInt(p.count)}</b>
                  </button>
                </li>
              ))}
            </ul>
          </CardState>
        </Card>

        <Card title="Vendor performance" sub="Turnaround, QA success and cost per km on the retread's own life">
          <CardState state={cardState} empty={empty || (!vendors.length ? 'No casing has a vendor recorded yet. Add the vendor when a casing is sent.' : null)}>
            <KitTable
              compact
              rows={vendors}
              columns={[
                { key: 'vendor', header: 'Vendor', cell: (v) => <span className="cc-strong">{v.vendor}</span> },
                {
                  key: 'successRate', header: 'Success', numeric: true,
                  cell: (v) => (v.successRate == null
                    ? <span className="cc-na" title="No casing from this vendor has passed or failed QA yet">N/A</span>
                    : <span className={`cc-pill ${v.successRate >= 85 ? 'good' : v.successRate >= 70 ? 'info' : v.successRate >= 50 ? 'warn' : 'bad'}`}>{Math.round(v.successRate)}%</span>),
                },
                { key: 'avgTat', header: 'TAT', numeric: true, cell: (v) => (v.avgTat == null ? NA : `${v.avgTat.toFixed(1)} d`) },
                {
                  key: 'cpk', header: 'CPK', numeric: true,
                  cell: (v) => (v.cpk == null
                    ? <span className="cc-na" title={v.currency ? 'No returned casing has a recorded life yet' : 'Costs are missing or in more than one currency'}>N/A</span>
                    : `${v.currency} ${v.cpk.toFixed(3)}`),
                },
              ]}
            />
            {noVendor > 0 && <p className="rtj-note">{fmtInt(noVendor)} casing{noVendor === 1 ? '' : 's'} with no vendor recorded {noVendor === 1 ? 'is' : 'are'} not in this table.</p>}
          </CardState>
        </Card>

        <Card title="ROI snapshot" sub="From the ROI calculator inputs" action={<button type="button" className="cc-link cc-link-btn" onClick={onOpenRoi}>Open ROI calculator</button>}>
          <div className="rtj-roi">
            <svg viewBox="0 0 120 120" className="rtj-ring" role="img" aria-label={roi?.cpkImprovement == null ? 'CPK improvement not measurable' : `CPK improvement ${Math.round(roi.cpkImprovement)}%`}>
              <circle cx="60" cy="60" r="48" fill="none" stroke="var(--cc-track)" strokeWidth="14" />
              {roi?.cpkImprovement != null && roi.cpkImprovement > 0 && (
                <circle cx="60" cy="60" r="48" fill="none" stroke="var(--cc-green)" strokeWidth="14" strokeLinecap="round"
                  strokeDasharray={`${Math.min(100, roi.cpkImprovement) * 3.016} 302`} transform="rotate(-90 60 60)" />
              )}
              <text x="60" y="58" textAnchor="middle" className="rtj-ring-num">{roi?.cpkImprovement == null ? 'N/A' : `${Math.round(roi.cpkImprovement)}%`}</text>
              <text x="60" y="76" textAnchor="middle" className="rtj-ring-cap">lower CPK</text>
            </svg>
            <dl className="rtj-roi-facts">
              <div><dt>Retread vs new saving</dt><dd>{roi?.savingsPerTyre == null ? NA : `${roiInputs.currency} ${Math.round(roi.savingsPerTyre).toLocaleString('en-US')} / tyre`}</dd></div>
              <div><dt>Projected annual saving</dt><dd className="rtj-accent">{roi?.annualSavings == null ? NA : `${roiInputs.currency} ${Math.round(roi.annualSavings).toLocaleString('en-US')}`}</dd></div>
              <div><dt>Break-even</dt><dd>{roi?.breakEvenKm == null ? NA : `${Math.round(roi.breakEvenKm).toLocaleString('en-US')} km`}</dd></div>
            </dl>
          </div>
          <p className="rtj-note">A projection from the prices and lives entered in the calculator, not measured savings. Measured savings are in the Savings vs new tile.</p>
        </Card>
      </div>

      <Card className="rtj-register" title="Retread casing register" sub={state.truncated ? 'Showing the newest 5,000 casings' : undefined}
        action={canWrite && !state.missing ? <button type="button" className="cc-btn" onClick={openCreate}>Add casing</button> : null}>
        <div className="cc-filters rtj-filters" role="group" aria-label="Register filters">
          <label className="cc-search">
            <Search size={14} aria-hidden="true" />
            <span className="sr-only">Search casings</span>
            <input type="search" value={filters.search} placeholder="Search casing serial, brand, vehicle, vendor"
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
          </label>
          <select className="cc-select" aria-label="Filter by vendor" value={filters.vendor} onChange={(e) => setFilters((f) => ({ ...f, vendor: e.target.value }))}>
            <option value="All">All vendors</option>
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="cc-select" aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="All">All statuses</option>
            {RETREAD_JOB_STATUS_VALUES.map((s) => <option key={s} value={s}>{JOB_STATUS[s].label}</option>)}
          </select>
          <select className="cc-select" aria-label="Filter by grade" value={filters.grade} onChange={(e) => setFilters((f) => ({ ...f, grade: e.target.value }))}>
            <option value="All">All grades</option>
            {RETREAD_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          {filterCount > 0 && <button type="button" className="cc-btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
          <span className="rtj-count" aria-live="polite">{fmtInt(filtered.length)} of {fmtInt(siteRows.length)} casings</span>
        </div>
        <CardState state={cardState} empty={empty}>
          <KitTable
            rows={filtered}
            columns={columns}
            empty="No casings match these filters."
            onRowClick={(r) => { setSelectedId(r.id); setNotice('') }}
            getRowId={(r) => String(r.id)}
          />
        </CardState>
      </Card>

      {selected && (
        <Card
          className="rtj-selected"
          title={`Lifecycle detail: ${selected.casing_serial}`}
          sub={[selected.brand, selected.size, selected.site].filter(Boolean).join(', ') || undefined}
          action={(
            <div className="rtj-sel-actions">
              <button type="button" className="cc-btn-primary" disabled={!canWrite || busy || selected.status === 'returned'}
                onClick={() => patchSelected({ status: 'returned', outcome: 'pass', returned_at: selected.returned_at || todayIso() }, `${selected.casing_serial} approved and returned to service.`)}>
                <CheckCircle2 size={14} aria-hidden="true" /> Approve return
              </button>
              <button type="button" className="cc-btn-ghost rtj-reject" disabled={!canWrite || busy || selected.status === 'rejected'}
                onClick={() => patchSelected({ status: 'rejected', outcome: 'fail' }, `${selected.casing_serial} marked rejected.`)}>
                <XCircle size={14} aria-hidden="true" /> Reject
              </button>
              <Link className="cc-btn-ghost" to="/retread-claims" title="Open retread claims to raise a claim against the vendor">
                <ShieldAlert size={14} aria-hidden="true" /> Raise claim
              </Link>
            </div>
          )}
        >
          {steps.length
            ? <ol className="rtj-steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
            : <p className="cc-na">No inspection, vendor or return date is recorded for this casing yet.</p>}
          <p className="rtj-facts">
            <span>Life on retread: {selected.life_km != null ? `${Number(selected.life_km).toLocaleString('en-US')} km` : 'not recorded yet'}</span>
            <span>Warranty: {selected.warranty_months != null ? `${selected.warranty_months} months` : 'not recorded'}</span>
            <span>Retread CPK: {selCpk != null && selected.currency ? `${selected.currency} ${selCpk.toFixed(3)} per km` : 'not measurable yet'}</span>
            <span>Status: <Pill meta={JOB_STATUS[selected.status]} /></span>
          </p>
          {notice && <p role="status" className="rtj-notice"><Info size={13} aria-hidden="true" /> {notice}</p>}
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { if (!saving) { setModalOpen(false); setEditing(null) } }}
        title={editing ? `Edit casing ${editing.casing_serial}` : 'New retread'}
        subtitle="Record a casing sent, or proposed, for retreading."
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={() => { setModalOpen(false); setEditing(null) }} disabled={saving}>Cancel</button>
            <button type="submit" form="retread-job-form" className="btn-primary text-sm min-h-[44px]" disabled={saving}>{saving ? 'Saving...' : 'Save casing'}</button>
          </div>
        )}
      >
        <form id="retread-job-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label="Casing serial" required><input className="input w-full" value={form.casing_serial} onChange={(e) => set('casing_serial', e.target.value)} maxLength={80} required /></Field>
          <Field label="Country">
            <select className="input w-full" value={form.country} onChange={(e) => set('country', e.target.value)}>
              <option value="">Not set</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Site"><input className="input w-full" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={80} /></Field>
          <Field label="Last vehicle"><input className="input w-full" value={form.last_asset_no} onChange={(e) => set('last_asset_no', e.target.value)} maxLength={60} /></Field>
          <Field label="Brand"><input className="input w-full" value={form.brand} onChange={(e) => set('brand', e.target.value)} maxLength={80} /></Field>
          <Field label="Size"><input className="input w-full" value={form.size} onChange={(e) => set('size', e.target.value)} maxLength={40} placeholder="315/80R22.5" /></Field>
          <Field label="First life (km)"><input className="input w-full" type="number" min="0" value={form.first_life_km} onChange={(e) => set('first_life_km', e.target.value)} /></Field>
          <Field label="Vendor"><input className="input w-full" value={form.vendor_name} onChange={(e) => set('vendor_name', e.target.value)} maxLength={160} list="retread-vendors" /></Field>
          <datalist id="retread-vendors">{vendorOptions.map((v) => <option key={v} value={v} />)}</datalist>
          <Field label="Casing grade">
            <select className="input w-full" value={form.grade} onChange={(e) => set('grade', e.target.value)}>
              <option value="">Not graded</option>
              {RETREAD_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Retread cycle"><input className="input w-full" type="number" min="1" max="6" value={form.cycle} onChange={(e) => set('cycle', e.target.value)} /></Field>
          <Field label="Status">
            <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {RETREAD_JOB_STATUS_VALUES.map((s) => <option key={s} value={s}>{JOB_STATUS[s].label}</option>)}
            </select>
          </Field>
          <Field label="Outcome">
            <select className="input w-full" value={form.outcome} onChange={(e) => set('outcome', e.target.value)}>
              {Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Inspected on"><input className="input w-full" type="date" value={form.inspected_at || ''} onChange={(e) => set('inspected_at', e.target.value)} /></Field>
          <Field label="Sent to vendor on"><input className="input w-full" type="date" value={form.sent_at || ''} onChange={(e) => set('sent_at', e.target.value)} /></Field>
          <Field label="Returned on"><input className="input w-full" type="date" value={form.returned_at || ''} onChange={(e) => set('returned_at', e.target.value)} /></Field>
          <Field label={`Cost${formCurrency ? ` (${formCurrency})` : ''}`} hint={formCurrency ? null : 'Pick a country first so the cost is stored in its own currency.'}>
            <input className="input w-full" type="number" min="0" step="0.01" value={form.cost} disabled={!formCurrency} onChange={(e) => set('cost', e.target.value)} />
          </Field>
          <Field label="Life on retread (km)" hint="Fill when the retread is removed. Used for retread CPK."><input className="input w-full" type="number" min="0" value={form.life_km} onChange={(e) => set('life_km', e.target.value)} /></Field>
          <Field label="Warranty (months)"><input className="input w-full" type="number" min="0" max="60" value={form.warranty_months} onChange={(e) => set('warranty_months', e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Notes"><textarea className="input w-full min-h-[64px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} /></Field>
          </div>
          {formError && <p role="alert" className="sm:col-span-2 text-sm text-red-400">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={!!confirmDel}
        onClose={() => { if (!busy) setConfirmDel(null) }}
        title="Delete this casing?"
        size="sm"
        footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={() => setConfirmDel(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-danger text-sm min-h-[44px]" onClick={doDelete} disabled={busy}>{busy ? 'Deleting...' : 'Delete casing'}</button>
          </div>
        )}
      >
        <p className="text-sm text-[var(--text-secondary)]">
          {confirmDel?.casing_serial} and its retread history will be removed from the register. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

const STAGE_FILTER = { awaiting: 'eligible', eligible: 'eligible', at_vendor: 'at_vendor', qa: 'qa', returned: 'returned', rejected: 'rejected' }

function Field({ label, hint, required, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)]">{label}{required ? ' (required)' : ''}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-dim)]">{hint}</span>}
    </label>
  )
}
