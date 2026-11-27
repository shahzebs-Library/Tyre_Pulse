import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '../../contexts/LanguageContext'
import { toUserMessage } from '../../lib/safeError'
import { listPossibleTransfers } from '../../lib/api/fleetVerification'

/**
 * Read-only review list: inactive machines whose asset code also exists in
 * another country. The same code is usually a DIFFERENT machine (V376), so
 * this changes nothing; each candidate is checked on site with Verify.
 */
export default function PossibleTransfersPanel({ country = 'KSA', onVerify }) {
  const { t } = useLanguage()
  const [state, setState] = useState({ loading: true, rows: [], notSetUp: false, error: null })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const r = await listPossibleTransfers(country)
      setState({ loading: false, rows: r.rows, notSetUp: r.notSetUp, error: null })
    } catch (e) {
      setState({ loading: false, rows: [], notSetUp: false, error: toUserMessage(e, t('fleetVerification.loadError')) })
    }
  }, [country, t])

  useEffect(() => { load() }, [load])
  const yn = (b) => t(`fleetVerification.transfers.${b ? 'yes' : 'no'}`)

  return (
    <section className="card p-4" aria-labelledby="fv-transfers-h">
      <h2 id="fv-transfers-h" className="text-base font-semibold">{t('fleetVerification.transfers.title')}</h2>
      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>{t('fleetVerification.transfers.intro')}</p>
      {state.loading && <p className="text-sm" aria-busy="true">...</p>}
      {!state.loading && state.notSetUp && <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.notSetUp')}</p>}
      {!state.loading && state.error && (
        <p role="alert" className="text-sm">{state.error} <button type="button" className="underline" onClick={load}>{t('fleetVerification.action.retry')}</button></p>
      )}
      {!state.loading && !state.error && !state.notSetUp && state.rows.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.transfers.empty')}</p>
      )}
      {state.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-start text-xs" style={{ color: 'var(--text-secondary)' }}>
              <th className="text-start py-1 pe-3">{t('fleetVerification.transfers.asset')}</th>
              <th className="text-start py-1 pe-3">{t('fleetVerification.transfers.here')}</th>
              <th className="text-start py-1 pe-3">{t('fleetVerification.transfers.there')}</th>
              <th className="text-start py-1 pe-3">{t('fleetVerification.transfers.typeMatch')}</th>
              <th className="text-start py-1 pe-3">{t('fleetVerification.transfers.lastJob')}</th>
              {onVerify && <th />}
            </tr></thead>
            <tbody>
              {state.rows.map((r) => (
                <tr key={`${r.vehicle_id}-${r.other_vehicle_id}`} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-1 pe-3 font-medium">{r.asset_no}</td>
                  <td className="py-1 pe-3">{[r.vehicle_type, r.site].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="py-1 pe-3">{[r.other_country, r.other_vehicle_type, r.other_status].filter(Boolean).join(' / ')}</td>
                  <td className="py-1 pe-3">{yn(r.type_match)}</td>
                  <td className="py-1 pe-3">{r.other_latest_job_card || t('fleetVerification.transfers.none')}</td>
                  {onVerify && <td className="py-1"><button type="button" className="btn-secondary text-xs" onClick={() => onVerify(r)}>{t('fleetVerification.action.verify')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
