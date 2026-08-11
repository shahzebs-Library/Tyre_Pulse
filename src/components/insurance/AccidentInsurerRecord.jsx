/**
 * What the INSURER has already recorded about this case.
 *
 * The insurance workstream used to be blind to it: our accident row carries our
 * own claim fields, while the insurer's claim register is a separate document
 * with its own claim number, its own estimate and the Najm survey number. This
 * panel shows the register row that matches this accident so the two can be
 * compared rather than assumed to agree.
 *
 * The match is the pure engine's `linkClaimToAccident` (asset plus a date
 * window). Nothing here writes; a claim that could not be linked is simply not
 * shown, and a failed read says so rather than reading as "the insurer has
 * nothing".
 */
import { useEffect, useState } from 'react'
import { ShieldCheck, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { listClaimRegister } from '../../lib/api/insurancePortfolio'
import { linkClaimToAccident } from '../../lib/insuranceMatch'
import { money, textOr, dateText, Pill, n } from './InsuranceUi'

export default function AccidentInsurerRecord({ accident }) {
  const [state, setState] = useState({ loading: true, error: '', rows: [] })

  useEffect(() => {
    let cancelled = false
    if (!accident?.id) { setState({ loading: false, error: '', rows: [] }); return undefined }
    setState((s) => ({ ...s, loading: true, error: '' }))
    ;(async () => {
      const { data, error } = await listClaimRegister({ country: accident.country })
      if (cancelled) return
      const claims = Array.isArray(data) ? data : []
      // Ask the engine, per claim, whether it links to THIS accident.
      const rows = claims.filter((c) => linkClaimToAccident(c, [accident], { windowDays: 3 }).accident_id === accident.id)
      setState({ loading: false, error: error || '', rows })
    })()
    return () => { cancelled = true }
  }, [accident])

  const { loading, error, rows } = state

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <RefreshCw size={14} className="animate-spin" /> Checking the insurer's claim register...
      </p>
    )
  }
  if (error) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          <ShieldCheck size={13} /> Insurer claim record
        </p>
        <Link to="/insurance-policies" className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline">
          Claims register <ExternalLink size={11} />
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No row on the insurer&apos;s claim register links to this case. Either the claim has not been filed, or the
          register names a vehicle and date this case does not match. It is not evidence that the insurer has nothing.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-1)] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-[var(--text-primary)]">{textOr(c.claim_no)}</span>
                {c.claim_type ? <Pill tone="info">{c.claim_type}</Pill> : null}
                {n(c.outstanding_amount) ? <Pill tone="warn">Outstanding</Pill> : null}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Field label="Accident date" value={dateText(c.accident_date, c.country)} />
                <Field label="Intimated" value={dateText(c.intimation_date, c.country)} />
                <Field label="Najm survey no" value={textOr(c.survey_no)} />
                <Field label="Insurer estimate" value={money(c.estimate_payment, c.currency)} />
                <Field label="Paid" value={money(c.paid_amount, c.currency)} />
                <Field label="Outstanding" value={money(c.outstanding_amount, c.currency)} />
                <Field label="Cause of loss" value={textOr(c.cause_of_loss)} />
                <Field label="Policy" value={textOr(c.policy_no)} />
                <Field label="Driver on the record" value={textOr(c.driver_name)} />
              </div>
            </div>
          ))}
          <p className="text-[11px] text-[var(--text-muted)]">
            These are the insurer&apos;s own figures. Where they differ from the claim fields on this case, neither has been
            overwritten with the other.
          </p>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--text-primary)]">{value}</p>
    </div>
  )
}
