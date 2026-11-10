import { describe, it, expect } from 'vitest'
import { formatKnowledgeHits, citation, pageRange, NO_KNOWLEDGE_MATCH } from '../../supabase/functions/ai-orchestrator/knowledge.ts'
import { TOOL_POLICY } from '../../supabase/functions/ai-orchestrator/policy.ts'

const hit = (extra = {}) => ({
  id: 'chunk-1', document_id: 'doc-uuid-1', title: 'Tyre Removal Criteria', version: 3,
  status: 'approved', page_from: 4, page_to: 5, doc_type: 'policy', similarity: 0.82,
  content: 'Remove steer tyres at 4 mm tread.', effective_from: '2026-01-01', ...extra,
})

describe('ai-orchestrator search_knowledge_base formatting', () => {
  it('returns doc id, title, version, page, status and a cite string', () => {
    const out = JSON.parse(formatKnowledgeHits([hit()]))
    expect(out.note).toMatch(/do not invent policy/i)
    expect(out.documents[0]).toMatchObject({
      document_id: 'doc-uuid-1', chunk_id: 'chunk-1', title: 'Tyre Removal Criteria', version: 3,
      status: 'approved', page: 'p.4-5', cite: 'Tyre Removal Criteria v3, p.4-5 [doc doc-uuid-1]',
    })
  })

  it('tells the model not to invent policy when nothing matches', () => {
    expect(formatKnowledgeHits([])).toBe(NO_KNOWLEDGE_MATCH)
    expect(formatKnowledgeHits(null)).toBe(NO_KNOWLEDGE_MATCH)
    expect(NO_KNOWLEDGE_MATCH).toMatch(/Do NOT invent/)
  })

  it('drops non-approved or status-less rows (older database function)', () => {
    expect(formatKnowledgeHits([hit({ status: 'draft' }), hit({ status: undefined })])).toBe(NO_KNOWLEDGE_MATCH)
    const out = JSON.parse(formatKnowledgeHits([hit({ status: 'withdrawn' }), hit({ id: 'c2' })]))
    expect(out.documents.map((d) => d.chunk_id)).toEqual(['c2'])
  })

  it('handles single pages, missing pages and long excerpts', () => {
    expect(pageRange({ page_from: 2, page_to: 2 })).toBe('p.2')
    expect(pageRange({})).toBe(null)
    expect(citation({ title: 'Warranty rules', id: 'x1' })).toBe('Warranty rules [doc x1]')
    const out = JSON.parse(formatKnowledgeHits([hit({ content: 'a'.repeat(5000) })]))
    expect(out.documents[0].excerpt.length).toBe(800)
  })

  it('keeps the tool registered as read-only', () => {
    expect(TOOL_POLICY.search_knowledge_base).toMatchObject({ risk: 'read', requiresApproval: false })
  })
})
