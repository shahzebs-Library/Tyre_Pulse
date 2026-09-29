/**
 * Validation Result card: a score ring built only from checks that ran, the
 * verdict, and one row per check. "Not checked" rows are shown but never
 * counted in the score.
 */
import { Info } from 'lucide-react'
import { Card } from '../commandCenter/kit'
import { CHECK_STATUS_META } from '../../lib/fitmentValidationView'
import { FITMENT_UNAVAILABLE_CHECKS, FITMENT_UNAVAILABLE_NOTE } from '../../lib/fitmentValidation'

function ScoreRing({ score, tone }) {
  const R = 52
  const C = 2 * Math.PI * R
  const v = score == null ? 0 : Math.max(0, Math.min(100, score))
  const color = tone === 'bad' ? 'var(--cc-red)' : tone === 'warn' ? 'var(--cc-amber)' : 'var(--cc-green)'
  return (
    <svg viewBox="0 0 140 140" className="fv-ring" role="img" aria-label={score == null ? 'Fitment score not available' : `Fitment score ${score} percent`}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="var(--cc-track)" strokeWidth="12" />
      {score != null && (
        <circle cx="70" cy="70" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(v / 100) * C} ${C}`} transform="rotate(-90 70 70)" />
      )}
      <text x="70" y="70" textAnchor="middle" className="fv-ring-num">{score == null ? 'N/A' : `${score}%`}</text>
      <text x="70" y="90" textAnchor="middle" className="fv-ring-cap">Fitment score</text>
    </svg>
  )
}

export default function FitmentResultCard({ result, context, busy }) {
  const s = result?.score
  return (
    <Card
      title="Validation Result"
      className="fv-result"
      action={s ? <span className={`cc-pill ${s.tone}`}>{s.badge || s.verdict}</span> : null}
    >
      {!result ? (
        <div className="cc-empty">{busy ? 'Checking...' : 'Enter an asset and a tyre serial, then press Validate fitment. Each check reads real records; a check without data shows as Not checked and is left out of the score.'}</div>
      ) : (
        <>
          <div className="fv-result-body" aria-live="polite">
            <ScoreRing score={s.score} tone={s.tone} />
            <div className="fv-result-main">
              <h3 className={`fv-verdict ${s.tone}`}>{s.verdict}</h3>
              <p className="fv-verdict-sub">
                {s.run ? `${s.run} of ${result.checks.length} checks ran.` : 'No check had enough data to run.'}
                {result.preview ? ' Preview, not saved.' : ' Saved to the validation history.'}
                {context?.rule?._default ? ' Built-in default policy applied.' : context?.rule?.rule_name ? ` Rule: ${context.rule.rule_name}.` : ''}
              </p>
              <ul className="fv-checks">
                {result.checks.map((c) => {
                  const meta = CHECK_STATUS_META[c.status]
                  return (
                    <li key={c.key} title={c.detail}>
                      <span>{c.label}</span>
                      <b className={`fv-check-val ${meta.tone}`}>{c.status === 'na' ? 'Not checked' : c.value}</b>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
          <details className="fv-details">
            <summary>What each check read</summary>
            <ul>
              {result.checks.map((c) => <li key={c.key}><b>{c.label}:</b> {c.detail}</li>)}
            </ul>
          </details>
          <p className="fv-note"><Info size={12} aria-hidden="true" /> {FITMENT_UNAVAILABLE_NOTE} Not evaluated: {FITMENT_UNAVAILABLE_CHECKS.map((c) => c.label).join('; ')}.</p>
        </>
      )}
    </Card>
  )
}
