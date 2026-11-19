/**
 * Offline evaluation of the DRAFT AI serial reading (docs/features/AI_SERIAL_RECOGNITION.md).
 * Pure: no I/O, no paid calls. scripts/ai-serial-eval.mjs feeds it files.
 *
 * truth:       [{ photo_id, true_serial: 'YMA55312' | '' , source_type: 'label' | 'moulded' | 'none' }]
 *              true_serial '' with source 'none' = the expert sees no serial in the photo.
 * predictions: [{ photo_id, reading: { normalized, status, confidence, source }, usage: { input_tokens, output_tokens } }]
 *
 * THE critical metric is the FALSE-READ rate: a reading claimed 'readable' whose value is not the
 * true serial (including any readable claim on a photo with no serial). That is the error that
 * could make a reviewer trust a wrong tyre identity.
 */
/** READ-ONLY SQL proposing a stratified expert-labelling sample (80 ids on 2026-11-16). */
export const SAMPLE_SQL = `-- READ ONLY. Proposes a stratified sample of completed AI photo jobs for expert serial labelling.
-- Strata: wheel has ONE strong registered serial / NONE / SEVERAL; assessable vs not; vehicle class.
-- Deterministic order (md5 of the id) so two people get the same list. Prints ids only.
with j as (
  select j.id, j.organisation_id, j.tyre_position, i.country, i.vehicle_type, i.asset_no,
         coalesce(i.inspection_date, i.created_at::date) d, (j.analysis->>'assessable') = 'true' assessable
    from public.ai_tyre_inspection_jobs j join public.inspections i on i.id = j.inspection_id
   where j.status = 'completed'),
l as (select j.*, public.tyre_asset_layout(j.organisation_id, j.country, j.asset_no, j.vehicle_type, j.d) lay from j),
w as (select l.*, (select count(*) from public.tyre_records t
         where t.organisation_id = l.organisation_id and t.country is not distinct from l.country
           and upper(btrim(t.asset_no)) = upper(btrim(l.asset_no)) and t.issue_date <= l.d
           and (t.removal_date is null or t.removal_date > l.d) and public.tyre_serial_is_strong(t.serial_no)
           and (public.tyre_position_compare(l.lay, l.tyre_position,
                 coalesce(nullif(btrim(t.tyre_position), ''), nullif(btrim(t.position), ''), ''))->>'match') = 'true') k
      from l),
s as (select id, case when k = 1 then 'one' when k = 0 then 'none' else 'several' end stratum, assessable,
             upper(coalesce(vehicle_type, '?')) vt,
             row_number() over (partition by (case when k = 1 then 'one' when k = 0 then 'none' else 'several' end), assessable
                                order by md5(id::text)) rn
        from w)
select id as photo_id, stratum, assessable, vt from s
 where (stratum = 'one' and assessable and rn <= 30) or (stratum = 'one' and not assessable and rn <= 10)
    or (stratum = 'none' and rn <= 12) or (stratum = 'several' and rn <= 8)
 order by stratum, assessable desc, md5(id::text);`

export const SERIAL_GATES = Object.freeze({
  minSample: 50,
  minPerSource: 15,          // label and moulded each
  maxFalseReadRate: 0.01,    // of readable claims (pooled)
  maxFalseReadCount: 1,      // absolute, at 50-100 photos the rate alone is noisy
  minLabelExactRate: 0.80,   // printed labels with a true serial: readable and exact
  minMouldedExactRate: 0.40, // moulded rubber is hard; below this the feature adds little
  maxUsdPerPhoto: 0.0015,    // v4 measured 0.000945; serial adds roughly 50-200 tokens
})

const norm = (v) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9?]/g, '') : '')
const pct = (n, d) => (d > 0 ? n / d : null)

export function scoreSerialPredictions(truthRows, predictionRows, { rates = { input: 0.1, output: 0.5 }, photosPerMonth = 1000, monthlyBudgetUsd = 20, damageUsdPerPhoto = 0.000945 } = {}) {
  const truth = new Map((truthRows || []).map((t) => [String(t.photo_id), t]))
  const groups = {}
  const g = (k) => (groups[k] ??= { n: 0, withSerial: 0, exact: 0, partial: 0, partialConsistent: 0, unreadable: 0, readableClaims: 0, falseReads: 0, hallucinated: 0 })
  let tokensIn = 0, tokensOut = 0, usageKnown = 0
  const missing = []
  const falseReadExamples = []
  for (const t of truth.values()) {
    const p = (predictionRows || []).find((x) => String(x.photo_id) === String(t.photo_id))
    if (!p) { missing.push(t.photo_id); continue }
    const src = ['label', 'moulded', 'none'].includes(t.source_type) ? t.source_type : 'none'
    const r = p.reading || {}
    const want = norm(t.true_serial)
    const got = norm(r.normalized)
    for (const key of ['all', src]) {
      const s = g(key)
      s.n++
      if (want) s.withSerial++
      if (r.status === 'readable') {
        s.readableClaims++
        if (want && got === want) s.exact++
        else { s.falseReads++; if (!want) s.hallucinated++ }
      } else if (r.status === 'partial') {
        s.partial++
        if (want && got.length === want.length && [...got].every((c, i) => c === '?' || c === want[i])) s.partialConsistent++
      } else s.unreadable++
    }
    if (r.status === 'readable' && got !== want && falseReadExamples.length < 20) falseReadExamples.push({ photo_id: t.photo_id, read: got, truth: want || '(none)', source: src })
    const u = p.usage || {}
    if (Number.isFinite(Number(u.input_tokens)) && Number.isFinite(Number(u.output_tokens))) {
      usageKnown++; tokensIn += Number(u.input_tokens); tokensOut += Number(u.output_tokens)
    }
  }
  const finish = (s) => ({ ...s,
    exactRate: pct(s.exact, s.withSerial),
    falseReadRate: pct(s.falseReads, s.readableClaims),
    partialRate: pct(s.partial, s.n), unreadableRate: pct(s.unreadable, s.n) })
  const bySource = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, finish(v)]))
  const avgIn = usageKnown ? tokensIn / usageKnown : null
  const avgOut = usageKnown ? tokensOut / usageKnown : null
  const usdPerPhoto = usageKnown ? (avgIn * rates.input + avgOut * rates.output) / 1e6 : null
  const monthly = usdPerPhoto == null ? null : usdPerPhoto * photosPerMonth
  const cost = { photosWithUsage: usageKnown, avgInputTokens: avgIn, avgOutputTokens: avgOut, usdPerPhoto,
    incrementalUsdPerPhoto: usdPerPhoto == null ? null : usdPerPhoto - damageUsdPerPhoto,
    projectedMonthlyUsd: monthly, monthlyBudgetUsd, budgetShare: monthly == null ? null : monthly / monthlyBudgetUsd }
  return { bySource, cost, missing, falseReadExamples }
}

/** Gate verdicts. Passing makes the pilot ELIGIBLE for an owner decision, never enables anything. */
export function serialGateVerdicts(score, gates = SERIAL_GATES) {
  const all = score.bySource.all || { n: 0, falseReads: 0 }
  const label = score.bySource.label || { n: 0, exactRate: null }
  const moulded = score.bySource.moulded || { n: 0, exactRate: null }
  const checks = [
    ['sample size', all.n >= gates.minSample, `${all.n} photos (need ${gates.minSample})`],
    ['label photos', label.n >= gates.minPerSource, `${label.n} (need ${gates.minPerSource})`],
    ['moulded photos', moulded.n >= gates.minPerSource, `${moulded.n} (need ${gates.minPerSource})`],
    ['false-read rate', all.falseReadRate == null ? all.n > 0 : all.falseReadRate <= gates.maxFalseReadRate, `${all.falseReads} of ${all.readableClaims ?? 0} readable claims`],
    ['false-read count', all.falseReads <= gates.maxFalseReadCount, `${all.falseReads} (max ${gates.maxFalseReadCount})`],
    ['label exact', label.exactRate != null && label.exactRate >= gates.minLabelExactRate, `${label.exactRate == null ? 'N/A' : (label.exactRate * 100).toFixed(1) + '%'} (min ${gates.minLabelExactRate * 100}%)`],
    ['moulded exact', moulded.exactRate != null && moulded.exactRate >= gates.minMouldedExactRate, `${moulded.exactRate == null ? 'N/A' : (moulded.exactRate * 100).toFixed(1) + '%'} (min ${gates.minMouldedExactRate * 100}%)`],
    ['cost per photo', score.cost.usdPerPhoto != null && score.cost.usdPerPhoto <= gates.maxUsdPerPhoto, `${score.cost.usdPerPhoto == null ? 'unknown' : '$' + score.cost.usdPerPhoto.toFixed(6)} (max $${gates.maxUsdPerPhoto})`],
    ['inside the monthly budget', score.cost.budgetShare != null && score.cost.budgetShare <= 1, `${score.cost.projectedMonthlyUsd == null ? 'unknown' : '$' + score.cost.projectedMonthlyUsd.toFixed(2)} of $${score.cost.monthlyBudgetUsd}`],
  ].map(([name, pass, detail]) => ({ name, pass: !!pass, detail }))
  return { eligible: checks.every((c) => c.pass), checks }
}

export function formatSerialReport(score, verdicts) {
  const line = (k, s) => `${k.padEnd(8)} n=${s.n} withSerial=${s.withSerial} exact=${s.exact}${s.exactRate == null ? '' : ` (${(s.exactRate * 100).toFixed(1)}%)`} partial=${s.partial} (consistent ${s.partialConsistent}) unreadable=${s.unreadable} readableClaims=${s.readableClaims} FALSE-READS=${s.falseReads} (hallucinated ${s.hallucinated})`
  const out = ['AI serial reading evaluation (offline)', '']
  for (const k of ['all', 'label', 'moulded', 'none']) if (score.bySource[k]) out.push(line(k, score.bySource[k]))
  const c = score.cost
  out.push('', `Usage known for ${c.photosWithUsage} photos: avg input ${c.avgInputTokens?.toFixed(0) ?? 'N/A'} / output ${c.avgOutputTokens?.toFixed(0) ?? 'N/A'} tokens`,
    `Cost per photo ${c.usdPerPhoto == null ? 'N/A' : '$' + c.usdPerPhoto.toFixed(6)} (serial adds ${c.incrementalUsdPerPhoto == null ? 'N/A' : '$' + c.incrementalUsdPerPhoto.toFixed(6)})`,
    `Projected month ${c.projectedMonthlyUsd == null ? 'N/A' : '$' + c.projectedMonthlyUsd.toFixed(2)} of $${c.monthlyBudgetUsd} budget`)
  if (score.missing.length) out.push(`Missing predictions for ${score.missing.length} photo(s)`)
  if (score.falseReadExamples.length) { out.push('', 'False reads (first 20):'); for (const f of score.falseReadExamples) out.push(`  ${f.photo_id} [${f.source}] read ${f.read} truth ${f.truth}`) }
  out.push('', ...verdicts.checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`), '',
    verdicts.eligible ? 'ELIGIBLE for an owner decision (nothing is enabled by this report).' : 'NOT eligible.')
  return out.join('\n')
}
