// ─────────────────────────────────────────────────────────────────────────────
// askData.js - "Ask your data" natural-language -> STRUCTURED read-only filter.
//
// The AI ONLY parses a plain-English question into a single structured filter
// { table, column, op, value }. It NEVER computes, aggregates, or returns data.
// The caller runs the actual read locally via admin_db_query using this filter
// (local-first: keep data off the LLM, minimise tokens, stay auditable).
//
// Reuses the existing secure chat-ai edge function (server-side Anthropic key)
// via supabase.functions.invoke('chat-ai', { body: { system, user, model,
// max_tokens } }) - the same contract used by lib/agents/index.js and
// lib/api/uploads.js (invokeChatAI). Parse-only and read-only by construction.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './_client'

/** Allowed comparison operators. The filter is read-only; no write ops exist. */
export const SUPPORTED_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike']

const MODEL = 'claude-haiku-4-5-20251001'

const UNUSABLE = {
  ok: false,
  reason: 'Could not understand the question. Try the manual filters.',
}

/**
 * Extract the first balanced {...} JSON object from an arbitrary AI string and
 * JSON.parse it. Tolerant of surrounding prose, code fences, and trailing text.
 * Returns the parsed object or null (never throws).
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const slice = text.slice(start, i + 1)
        try { return JSON.parse(slice) } catch { return null }
      }
    }
  }
  return null
}

function buildSystemPrompt(tables, columnsByTable) {
  const tableList = tables.join(', ')
  const lines = [
    'You translate a plain-English question about a fleet/tyre database into a',
    'SINGLE structured read-only filter. You never compute, aggregate, or return',
    'data - you only pick the best table, column, operator and value.',
    '',
    `Available tables: ${tableList}`,
  ]
  if (columnsByTable && typeof columnsByTable === 'object') {
    for (const t of tables) {
      const cols = columnsByTable[t]
      if (Array.isArray(cols) && cols.length) {
        lines.push(`Columns for ${t}: ${cols.join(', ')}`)
      }
    }
  }
  lines.push(
    '',
    `Allowed operators (op): ${SUPPORTED_OPS.join(', ')}. Use ilike for text`,
    'contains/matches; use eq/neq/gt/gte/lt/lte for exact or numeric/date',
    'comparisons.',
    '',
    'Respond with STRICT JSON only, no prose, no code fences, exactly:',
    '{"table": "<one of the available tables>", "column": "<column name>",',
    '"op": "<one allowed operator>", "value": <string or number>}',
    '',
    'Choose the single most relevant table and column from the provided list.',
    'Do not invent tables or columns that were not provided.',
  )
  return lines.join('\n')
}

/**
 * Translate a natural-language question into a structured read-only filter.
 *
 * @param {string} question             the user's plain-English question
 * @param {object} opts
 * @param {string[]} opts.tables         allowed table names (required, non-empty)
 * @param {Object<string,string[]>} [opts.columns]  optional column hints per table
 * @returns {Promise<{ok:true, filter:{table,column,op,value}, explanation:string}
 *                    | {ok:false, reason:string}>}  never rejects
 */
export async function askDataToFilter(question, { tables, columns } = {}) {
  const q = typeof question === 'string' ? question.trim() : ''
  const tableList = Array.isArray(tables) ? tables.filter(t => typeof t === 'string' && t) : []

  if (!q) return { ok: false, reason: 'Please enter a question.' }
  if (!tableList.length) {
    return { ok: false, reason: 'No tables are available to search.' }
  }

  let raw
  try {
    const { data, error } = await supabase.functions.invoke('chat-ai', {
      body: {
        system: buildSystemPrompt(tableList, columns),
        user: q,
        model: MODEL,
        max_tokens: 300,
      },
    })
    if (error) return { ...UNUSABLE }
    if (data?.error) return { ...UNUSABLE }
    raw = data?.content
  } catch {
    // AI unavailable / network / edge-function failure: fail closed, never throw.
    return { ...UNUSABLE }
  }

  const parsed = extractJsonObject(typeof raw === 'string' ? raw : '')
  if (!parsed || typeof parsed !== 'object') return { ...UNUSABLE }

  const table = typeof parsed.table === 'string' ? parsed.table.trim() : ''
  const column = typeof parsed.column === 'string' ? parsed.column.trim() : ''
  const op = typeof parsed.op === 'string' ? parsed.op.trim().toLowerCase() : ''
  const value = parsed.value

  if (!tableList.includes(table)) return { ...UNUSABLE }
  if (!column) return { ...UNUSABLE }
  if (!SUPPORTED_OPS.includes(op)) return { ...UNUSABLE }
  if (value === undefined || value === null || value === '') return { ...UNUSABLE }
  if (typeof value !== 'string' && typeof value !== 'number') return { ...UNUSABLE }

  const filter = { table, column, op, value }
  const explanation = `Filter ${table}.${column} ${op} ${value}`
  return { ok: true, filter, explanation }
}
