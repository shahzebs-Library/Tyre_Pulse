import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * F-G-04 prompt v4. The 14 defect-type tokens the prompt tells the model to use
 * must be exactly the set normalizeAnalysis() accepts in logic.ts: any token the
 * prompt names but the validator rejects would be silently rewritten to
 * "uncertain", and any token the validator accepts but the prompt never names
 * would never be produced. This guard pins the two lists as a mirror and the
 * version at tyre-photo-v4 (the bump that invalidates the v3 reuse cache).
 */
const index = readFileSync('supabase/functions/ai-tyre-inspection/index.ts', 'utf8')
const logic = readFileSync('supabase/functions/ai-tyre-inspection/logic.ts', 'utf8')

describe('ai-tyre-inspection prompt tokens mirror the validator (F-G-04)', () => {
  it('PROMPT_VERSION is tyre-photo-v4', () => {
    expect(/PROMPT_VERSION\s*=\s*["'`]tyre-photo-v4["'`]/.test(logic)).toBe(true)
  })

  it('the prompt lists the same 14 tokens the validator allows', () => {
    const promptList = index.match(/14 tokens:\s*([a-z_,\s]+?)\.\s*Use uncertain/)
    expect(promptList, 'prompt must name "these 14 tokens: ..."').toBeTruthy()
    const promptTokens = promptList[1].split(',').map((t) => t.trim()).filter(Boolean)

    const allowedBlock = logic.match(/const allowed = new Set\(\[([\s\S]*?)\]\)/)
    expect(allowedBlock, 'logic.ts must declare the allowed Set').toBeTruthy()
    const allowedTokens = [...allowedBlock[1].matchAll(/["'`]([a-z_]+)["'`]/g)].map((m) => m[1])

    expect(promptTokens.length).toBe(14)
    expect(allowedTokens.length).toBe(14)
    expect([...promptTokens].sort()).toEqual([...allowedTokens].sort())
  })

  it('the prompt carries the uncertain rule', () => {
    expect(/Use uncertain only when the photo does not show the tyre surface clearly/.test(index)).toBe(true)
  })
})
