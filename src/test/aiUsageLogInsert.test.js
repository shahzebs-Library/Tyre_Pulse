import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * F-G-01. ai_usage_log.total_tokens and ai_token_logs.total_tokens are GENERATED
 * columns (input + output). Writing them in an INSERT payload errors the insert
 * and strands the row (the #484 ai_token_logs class). This guard forbids a
 * total_tokens key inside any ai_usage_log / ai_token_logs insert in the two AI
 * edge functions. A total_tokens field in the RESPONSE body (the usage object the
 * caller reads) is legitimate and is not an insert, so it is not matched.
 */
const FILES = [
  'supabase/functions/chat-ai/index.ts',
  'supabase/functions/ai-orchestrator/index.ts',
]
const TABLES = ['ai_usage_log', 'ai_token_logs']

// The argument text of each `.from('<table>').insert( ... )` call, paren-balanced.
function insertPayloads(src, table) {
  const out = []
  const re = new RegExp(`from\\(\\s*['"\`]${table}['"\`]\\s*\\)\\s*\\.insert\\(`, 'g')
  let m
  while ((m = re.exec(src))) {
    let depth = 1
    const start = m.index + m[0].length
    let i = start
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (c === '(') depth++
      else if (c === ')') depth--
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

describe('AI usage-log inserts never write the GENERATED total_tokens (F-G-01)', () => {
  const byFile = FILES.map((file) => ({ file, src: readFileSync(file, 'utf8') }))

  it('the guard is not vacuous (ai_usage_log insert is present in both functions)', () => {
    for (const { file, src } of byFile) {
      expect(insertPayloads(src, 'ai_usage_log').length, `${file} has an ai_usage_log insert`).toBeGreaterThan(0)
    }
  })

  for (const { file, src } of byFile) {
    for (const table of TABLES) {
      insertPayloads(src, table).forEach((payload, i) => {
        it(`${file} ${table} insert #${i + 1} omits total_tokens`, () => {
          expect(/\btotal_tokens\s*:/.test(payload), `${table} insert in ${file} must not write the GENERATED total_tokens`).toBe(false)
        })
      })
    }
  }
})
