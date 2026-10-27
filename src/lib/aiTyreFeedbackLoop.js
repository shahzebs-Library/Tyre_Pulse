/**
 * Reviewer-correction feedback loop (pure). Aggregates reviewer decisions into per-condition error rates
 * and PROPOSES prompt / threshold adjustments as a report. Never applies anything and never trains a model.
 *
 * Input rows (one per reviewed finding): { condition, decision: 'accepted'|'rejected'|'corrected',
 *   correctedTo?: condition, position?, confidence?, promptVersion?, modelVersion? }
 * A rejected finding is a false positive; a corrected finding is a mislabel (FP for `condition`, and
 * a confusion toward `correctedTo`); accepted is a confirmation. Missed defects (reviewer added a condition
 * the AI never reported) come in as { condition, decision: 'added' }.
 */
export const FEEDBACK_LOOP_DISCLAIMER =
  'Proposals only. Nothing is applied automatically; a person must review, change the prompt or threshold, and re-run the accuracy gate.'

export const LOOP_DEFAULTS = Object.freeze({
  minReviewed: 10,          // reviewed findings per condition before a rate is reported
  highErrorRate: 0.3,       // error rate that triggers a proposal
  highConfidenceError: 0.55, // mean confidence of wrong findings that suggests the threshold is too low
  confusionMin: 3,          // repeated correctedTo pairs before proposing a prompt clarification
  missedMin: 3,
})

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const round = (v, d = 3) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)))

export function aggregateCorrections(rows, opts = {}) {
  const o = { ...LOOP_DEFAULTS, ...opts }
  const by = new Map()
  const conf = new Map()
  const get = (c) => { if (!by.has(c)) by.set(c, { condition: c, reviewed: 0, accepted: 0, rejected: 0, corrected: 0, added: 0, wrongConf: [], rightConf: [] }); return by.get(c) }
  for (const r of rows || []) {
    const c = str(r?.condition), d = str(r?.decision)
    if (!c) continue
    const g = get(c)
    const cf = Number.isFinite(Number(r.confidence)) && r.confidence !== null && r.confidence !== '' ? Number(r.confidence) : null
    if (d === 'accepted') { g.reviewed++; g.accepted++; if (cf != null) g.rightConf.push(cf) }
    else if (d === 'rejected') { g.reviewed++; g.rejected++; if (cf != null) g.wrongConf.push(cf) }
    else if (d === 'corrected') {
      g.reviewed++; g.corrected++; if (cf != null) g.wrongConf.push(cf)
      const to = str(r.correctedTo)
      if (to && to !== c) { const k = `${c}>${to}`; conf.set(k, (conf.get(k) || 0) + 1) }
    } else if (d === 'added') g.added++
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
  const conditions = [...by.values()].map((g) => ({
    condition: g.condition, reviewed: g.reviewed, accepted: g.accepted, rejected: g.rejected, corrected: g.corrected, added: g.added,
    errorRate: g.reviewed >= o.minReviewed ? round((g.rejected + g.corrected) / g.reviewed) : null,
    falsePositiveRate: g.reviewed >= o.minReviewed ? round(g.rejected / g.reviewed) : null,
    mislabelRate: g.reviewed >= o.minReviewed ? round(g.corrected / g.reviewed) : null,
    meanConfidenceWrong: round(mean(g.wrongConf)), meanConfidenceRight: round(mean(g.rightConf)),
  })).sort((a, b) => (b.errorRate ?? -1) - (a.errorRate ?? -1) || a.condition.localeCompare(b.condition))
  const confusions = [...conf].map(([k, n]) => { const [from, to] = k.split('>'); return { from, to, count: n } }).sort((a, b) => b.count - a.count || a.from.localeCompare(b.from))
  return { conditions, confusions, totalReviewed: conditions.reduce((s, c) => s + c.reviewed, 0) }
}

/** Turn aggregated error rates into a proposal report. Pure; returns text proposals, never config changes. */
export function proposeAdjustments(rows, opts = {}) {
  const o = { ...LOOP_DEFAULTS, ...opts }
  const agg = aggregateCorrections(rows, o)
  const proposals = []
  for (const c of agg.conditions) {
    if (c.errorRate == null) continue
    if (c.errorRate >= o.highErrorRate && c.falsePositiveRate >= c.mislabelRate) {
      const lowThreshold = c.meanConfidenceWrong != null && c.meanConfidenceWrong >= o.highConfidenceError
      proposals.push({
        kind: lowThreshold ? 'raise_confidence_threshold' : 'tighten_prompt', condition: c.condition, severity: c.errorRate >= 0.5 ? 'high' : 'medium',
        evidence: `${c.rejected} of ${c.reviewed} reviewed ${c.condition} findings were rejected (${Math.round(c.falsePositiveRate * 100)}%)`,
        suggestion: lowThreshold
          ? `Wrong ${c.condition} findings carry mean confidence ${c.meanConfidenceWrong}; consider requiring a higher confidence before reporting it, then re-run the accuracy gate.`
          : `Add an explicit counter-example for ${c.condition} to the prompt (what it must NOT be called), then re-run the accuracy gate.`,
      })
    } else if (c.errorRate >= o.highErrorRate) {
      proposals.push({
        kind: 'clarify_definition', condition: c.condition, severity: c.errorRate >= 0.5 ? 'high' : 'medium',
        evidence: `${c.corrected} of ${c.reviewed} reviewed ${c.condition} findings were corrected to another condition`,
        suggestion: `Clarify the definition of ${c.condition} versus its look-alikes in the prompt.`,
      })
    }
    if (c.added >= o.missedMin) {
      proposals.push({
        kind: 'review_missed_condition', condition: c.condition, severity: 'medium',
        evidence: `Reviewers added ${c.added} ${c.condition} findings the AI did not report`,
        suggestion: `The AI under-reports ${c.condition}; consider lowering the reporting threshold or adding examples, then re-run the accuracy gate.`,
      })
    }
  }
  for (const f of agg.confusions) if (f.count >= o.confusionMin) {
    proposals.push({
      kind: 'disambiguate_pair', condition: f.from, severity: f.count >= o.confusionMin * 2 ? 'high' : 'medium',
      evidence: `${f.count} findings called ${f.from} were corrected to ${f.to}`,
      suggestion: `Add a disambiguation rule between ${f.from} and ${f.to} to the prompt.`,
    })
  }
  const rank = { high: 0, medium: 1 }
  proposals.sort((a, b) => rank[a.severity] - rank[b.severity] || a.condition.localeCompare(b.condition))
  return { disclaimer: FEEDBACK_LOOP_DISCLAIMER, applied: false, totalReviewed: agg.totalReviewed, conditions: agg.conditions, confusions: agg.confusions, proposals }
}

export function formatFeedbackProposals(report) {
  const out = [report.disclaimer, `Reviewed findings: ${report.totalReviewed}`]
  if (!report.proposals.length) out.push('No proposals: no condition has enough reviewed data above the error threshold.')
  for (const p of report.proposals) out.push(`[${p.severity}] ${p.kind} (${p.condition}): ${p.evidence}. ${p.suggestion}`)
  return out.join('\n')
}
