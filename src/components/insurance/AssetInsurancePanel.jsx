/**
 * Per-asset insurance, shown where a fleet person actually stands: the asset's
 * own page. Two facts, both read straight from the insurer's documents:
 *
 *   - the cover this machine carries (policy, cover type, sum insured, period,
 *     expiry countdown), and
 *   - its claim history on the insurer's own register.
 *
 * Neither is inferred. An asset with no schedule row says "no cover record on
 * file" rather than implying it is uninsured, because the schedule may name it
 * by a plate or chassis this register does not hold; and a read that failed says
 * so instead of rendering as an empty history.
 */
import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldOff, RefreshCw, AlertTriangle, FileText } from 'lucide-react'
import { listPolicyAssets, listClaimRegister } from '../../lib/api/insurancePortfolio'
import { normAssetNo, normPlate, normChassis } from '../../lib/insuranceMatch'
import { money, count, textOr, dateText, ExpiryPill, Pill, Fact, n } from './InsuranceUi'

/** Does this schedule/claim row describe this asset? Same key order as the engine. */
function describesAsset(row, asset) {
  const a = normAssetNo(asset?.asset_no)
  const p = normPlate(asset?.registration_no || asset?.plate_number)
  const c = normChassis(asset?.chassis_no || asset?.chassis_number)
  if (c && normChassis(row?.chassis_no) === c) return true
  if (p && normPlate(row?.plate_no) === p) return true
  return !!a && normAssetNo(row?.asset_no) === a
}

export default function AssetInsurancePanel({ asset, country }) {
  const [state, setState] = useState({ loading: true, error: '', cover: [], claims: [] })

  useEffect(() => {
    let cancelled = false
    if (!asset?.asset_no) { setState({ loading: false, error: '', cover: [], claims: [] }); return undefined }
    setState((s) => ({ ...s, loading: true, error: '' }))
    ;(async () => {
      const scope = { country: country && country !== 'All' ? country : asset.country }
      const [sched, claims] = await Promise.all([listPolicyAssets(scope), listClaimRegister(scope)])
      if (cancelled) return
      const err = sched.error || claims.error || ''
      setState({
        loading: false,
        error: err,
        cover: (sched.data || []).filter((r) => describesAsset(r, asset)),
        claims: (claims.data || []).filter((r) => describesAsset(r, asset))
          .sort((a, b) => String(b.accident_date || '').localeCompare(String(a.accident_date || ''))),
      })
    })()
    return () => { cancelled = true }
  }, [asset, country])

  const { loading, error, cover, claims } = state

  if (loading) {
    return (
      <div className="card">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
          <ShieldCheck className="h-4 w-4 text-blue-400" /> Insurance
        </h3>
        <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><RefreshCw size={14} className="animate-spin" /> Loading the insurance record...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
          <ShieldCheck className="h-4 w-4 text-blue-400" /> Insurance
        </h3>
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
          <ShieldCheck className="h-4 w-4 text-blue-400" /> Insurance
        </h3>
        {cover.length > 0
          ? <Pill tone="good">{count(cover.length)} cover record(s)</Pill>
          : <Pill tone="neutral">No cover record on file</Pill>}
      </div>

      {cover.length === 0 ? (
        <p className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
          <ShieldOff size={15} className="mt-0.5 shrink-0" />
          No insurance schedule row names this asset by code, plate or chassis. That does not prove it is uninsured; check the coverage gaps view on Insurance Policies.
        </p>
      ) : (
        <div className="space-y-3">
          {cover.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--border-dim)] bg-[var(--surface-2)] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-[var(--text-primary)]">{textOr(c.policy_no)}</span>
                <ExpiryPill to={c.cover_to} />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Fact label="Cover type" value={textOr(c.cover_type)} />
                <Fact label="Sum insured" value={money(c.sum_insured, c.currency)} />
                <Fact label="Premium" value={money(c.premium, c.currency)} />
                <Fact label="Period" value={`${dateText(c.cover_from, country)} to ${dateText(c.cover_to, country)}`} />
              </div>
              {c.description ? <p className="mt-2 text-xs text-[var(--text-muted)]">{c.description}</p> : null}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 border-t border-[var(--border-dim)] pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            <FileText size={13} /> Claim history on the insurer's register
          </h4>
          {claims.length > 0 ? <Pill tone="warn">{count(claims.length)} claim(s)</Pill> : null}
        </div>
        {claims.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">This asset does not appear on the insurer's claim register.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border-dim)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="py-2 pr-3">Claim no</th>
                  <th className="py-2 pr-3">Accident</th>
                  <th className="py-2 pr-3">Cause of loss</th>
                  <th className="py-2 pr-3 text-right">Insurer estimate</th>
                  <th className="py-2 pr-3 text-right">Paid</th>
                  <th className="py-2">Najm survey</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border-dim)] last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-[var(--text-primary)]">{textOr(c.claim_no)}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{dateText(c.accident_date, country)}</td>
                    <td className="max-w-[16rem] truncate py-2 pr-3 text-[var(--text-secondary)]" title={c.cause_of_loss || ''}>{textOr(c.cause_of_loss)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{money(c.estimate_payment, c.currency)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[var(--text-secondary)]">{money(c.paid_amount, c.currency)}</td>
                    <td className="py-2 font-mono text-xs text-[var(--text-secondary)]">{textOr(c.survey_no)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {claims.some((c) => n(c.paid_amount) == null) && claims.length > 0 ? (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">A blank Paid figure means the insurer's register states none, not that nothing was paid.</p>
        ) : null}
      </div>
    </div>
  )
}
