import { useLanguage } from '../../contexts/LanguageContext'
import { verificationBadge } from '../../lib/fleetVerification'

const TONE = {
  good: { bg: 'rgba(22,163,74,0.12)', fg: 'var(--success, #15803d)' },
  warning: { bg: 'rgba(217,119,6,0.12)', fg: 'var(--warning, #b45309)' },
  danger: { bg: 'rgba(220,38,38,0.12)', fg: 'var(--danger, #b91c1c)' },
  info: { bg: 'rgba(37,99,235,0.12)', fg: 'var(--info, #1d4ed8)' },
  quiet: { bg: 'transparent', fg: 'var(--text-dim)' },
}

/** Register column cell: verification state + when it was last checked. */
export default function VerificationBadge({ status, lastVerifiedAt }) {
  const { t } = useLanguage()
  const b = verificationBadge(status)
  const tone = TONE[b.tone] || TONE.quiet
  const date = lastVerifiedAt ? new Date(lastVerifiedAt).toLocaleDateString() : null
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ background: tone.bg, color: tone.fg }}>{t(b.key)}</span>
      {date && <span className="text-[11px]" style={{ color: 'var(--text-dim)' }}>{t('fleetVerification.column.lastOn', { date })}</span>}
    </span>
  )
}
