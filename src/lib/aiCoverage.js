/**
 * aiCoverage.js - turn the orchestrator's deterministic `coverage` list into
 * plain lines the Command Center shows under every answer. The coverage is
 * built server-side from tool provenance, never from model text, so these
 * lines say what data the answer really rested on.
 */
import { TOOL_POLICY } from '../../supabase/functions/ai-orchestrator/policy.ts'

export function coverageLines(coverage) {
  if (!Array.isArray(coverage)) return []
  return coverage.map((c) => {
    const label = TOOL_POLICY[c?.tool]?.sourceLabel ?? String(c?.tool ?? 'Unknown source')
    if (!c?.ok) return { label, tone: 'warn', text: `${label}: not available (${c?.error ?? 'unavailable'})` }
    const parts = [label]
    if (Number.isFinite(c.rows)) parts.push(`${c.rows} row${c.rows === 1 ? '' : 's'}`)
    if (c.generated_at) {
      const d = new Date(c.generated_at)
      if (!isNaN(d.getTime())) parts.push(`read ${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`)
    }
    if (c.truncated) parts.push('partial result')
    const notes = Array.isArray(c.notes) ? c.notes.filter(Boolean) : []
    return { label, tone: c.truncated || notes.length ? 'warn' : 'ok', text: parts.join(', ') + (notes.length ? `. ${notes.join(' ')}` : '') }
  })
}

/**
 * Honest grounding verdict. `grounded === false` means no operational data was
 * retrieved, so any figure in the answer is unverified. Undefined (older
 * server) returns null: we cannot tell, so we say nothing.
 */
export function groundingNotice(result) {
  if (!result || typeof result.grounded !== 'boolean') return null
  if (result.grounded) return null
  return 'No operational data was retrieved for this answer. Treat any figures as unverified.'
}
