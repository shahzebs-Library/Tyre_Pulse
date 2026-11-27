import { useLanguage } from '../../contexts/LanguageContext'
import { verificationProgress } from '../../lib/fleetVerification'

/**
 * "N of M verified". Pass `counts` ({ verified, pending, total }) from the
 * server for a whole register, or `rows` for a list already fully loaded.
 * `loading` shows a placeholder; `notSetUp` says the server side is missing.
 */
export default function VerificationProgressTile({ rows = [], counts, loading = false, notSetUp = false }) {
  const { t } = useLanguage()
  const p = counts
    ? { ...counts, pct: counts.total ? Math.round((counts.verified / counts.total) * 100) : null }
    : verificationProgress(rows)
  if (loading || notSetUp) {
    return (
      <div className="card p-4" aria-label={t('fleetVerification.progress.title')} aria-busy={loading}>
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('fleetVerification.progress.title')}</div>
        <div className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>{loading ? '...' : t('fleetVerification.notSetUp')}</div>
      </div>
    )
  }
  return (
    <div className="card p-4" aria-label={t('fleetVerification.progress.title')}>
      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('fleetVerification.progress.title')}</div>
      {p.total === 0 ? (
        <div className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.progress.empty')}</div>
      ) : (
        <>
          <div className="text-lg font-semibold mt-1">{t('fleetVerification.progress.value', { done: p.verified, total: p.total })}</div>
          <div className="h-1.5 rounded mt-2" style={{ background: 'var(--border)' }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct}>
            <div className="h-1.5 rounded" style={{ width: `${p.pct}%`, background: 'var(--accent, #16a34a)' }} />
          </div>
          {p.pending > 0 && <div className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.progress.pending', { n: p.pending })}</div>}
        </>
      )}
    </div>
  )
}
