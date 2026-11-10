import { describe, it, expect } from 'vitest'
import { groupDocuments } from '../lib/knowledgeBaseView'

describe('groupDocuments with lifecycle rows', () => {
  it('groups chunks under their parent and does not count the container as a chunk', () => {
    const rows = [
      { id: 'c2', chunk_of: 'P', chunk_index: 2, title: 'Pressure SOP (part 2)', doc_type: 'sop', embedding: true, status: 'draft' },
      { id: 'P', chunk_of: null, chunk_count: 2, title: 'Pressure SOP', doc_type: 'sop', status: 'approved', version: 2, created_by: 'u1', review_due: '2027-01-01' },
      { id: 'c1', chunk_of: 'P', chunk_index: 1, title: 'Pressure SOP (part 1)', doc_type: 'sop', embedding: null, status: 'draft' },
    ]
    const [d] = groupDocuments(rows)
    expect(d.key).toBe('doc:P')
    expect(d.documentId).toBe('P')
    expect(d.title).toBe('Pressure SOP')
    expect(d.chunkCount).toBe(2)
    expect(d.chunks.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(d.indexed).toBe(1)
    expect(d.lifecycle).toMatchObject({ id: 'P', status: 'approved', version: 2, created_by: 'u1', review_due: '2027-01-01' })
  })

  it('keeps two versions with the same title as separate documents', () => {
    const rows = [
      { id: 'A', chunk_count: 0, title: 'Warranty rules', doc_type: 'policy', status: 'superseded', version: 1, content: 'v1' },
      { id: 'B', chunk_count: 0, title: 'Warranty rules', doc_type: 'policy', status: 'approved', version: 2, content: 'v2' },
    ]
    const docs = groupDocuments(rows)
    expect(docs).toHaveLength(2)
    expect(docs.map((d) => d.lifecycle.version).sort()).toEqual([1, 2])
  })

  it('still groups legacy rows by title and leaves lifecycle null', () => {
    const docs = groupDocuments([
      { id: 'l1', title: 'Manual (1/2)', doc_type: 'manual' },
      { id: 'l2', title: 'Manual (2/2)', doc_type: 'manual' },
    ])
    expect(docs).toHaveLength(1)
    expect(docs[0].chunkCount).toBe(2)
    expect(docs[0].lifecycle).toBe(null)
  })
})
