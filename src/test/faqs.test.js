import { describe, it, expect } from 'vitest'
import { FAQS, FAQ_CATEGORIES, searchFaqs, groupFaqsByCategory, visibleFaqsForRole } from '../lib/help/faqs'

describe('Help Center FAQ knowledge base', () => {
  it('every FAQ has the required shape and a known category', () => {
    for (const f of FAQS) {
      expect(f.id && f.q && f.a && f.category).toBeTruthy()
      expect(FAQ_CATEGORIES).toContain(f.category)
    }
    // ids are unique
    expect(new Set(FAQS.map((f) => f.id)).size).toBe(FAQS.length)
  })

  it('searchFaqs matches question, answer and keywords (AND across terms)', () => {
    expect(searchFaqs('interval').some((f) => f.id === 'cl-interval')).toBe(true)
    expect(searchFaqs('cpk').some((f) => f.id === 'an-cpk')).toBe(true)
    // multi-term AND
    const r = searchFaqs('checklist pdf')
    expect(r.some((f) => f.id === 'cl-pdf')).toBe(true)
    // empty query returns everything
    expect(searchFaqs('')).toHaveLength(FAQS.length)
    // no match
    expect(searchFaqs('zznomatchzz')).toHaveLength(0)
  })

  it('scopes FAQs to the user role — no one sees areas they cannot use', () => {
    // Admin (and any unlisted role) sees everything.
    expect(visibleFaqsForRole('Admin')).toHaveLength(FAQS.length)
    expect(visibleFaqsForRole(null)).toHaveLength(FAQS.length)

    // The checklist-only role sees only checklist-relevant + essential help.
    const ms = visibleFaqsForRole('Maintenance Supervisor')
    const cats = new Set(ms.map((f) => f.category))
    expect(cats).toEqual(new Set(['Getting Started', 'Checklists', 'Roles & Access', 'Account']))
    expect(ms.some((f) => f.category === 'Analytics & KPIs')).toBe(false)
    expect(ms.some((f) => f.category === 'Data & Imports')).toBe(false)
  })

  it('has no AI references anywhere in the help content', () => {
    const blob = FAQS.map((f) => `${f.q} ${f.a} ${(f.keywords || []).join(' ')}`).join(' ').toLowerCase()
    for (const term of [' ai ', 'artificial intelligence', 'copilot', 'chatbot', 'llm', 'gpt']) {
      expect(blob.includes(term)).toBe(false)
    }
  })

  it('groups by category in the canonical order', () => {
    const grouped = groupFaqsByCategory()
    const cats = grouped.map(([c]) => c)
    // categories appear in FAQ_CATEGORIES order
    const idx = cats.map((c) => FAQ_CATEGORIES.indexOf(c))
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    // total items preserved
    expect(grouped.reduce((n, [, l]) => n + l.length, 0)).toBe(FAQS.length)
  })
})
