/**
 * AI Administration — pure, dependency-free domain logic for the AI &
 * Automation Administration module (/ai-administration). Turns model catalogue,
 * budget and usage rows into deterministic derived values (per-call cost,
 * catalogue summary, budget utilisation) with no Supabase and no React, so the
 * maths lives in exactly one place and is fully unit-tested.
 *
 * Pricing convention mirrors the edge functions' MODEL_PRICING: input_price and
 * output_price are USD per 1,000,000 tokens.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Cost (USD) of a single call for a given model, priced per 1M tokens.
 *   cost = prompt/1e6 * input_price + completion/1e6 * output_price
 * Missing/invalid prices and token counts degrade to 0 (never NaN), so a
 * half-configured model row can never poison an aggregate. Returns >= 0.
 *
 * @param {{ input_price?:number|string, output_price?:number|string }} model
 * @param {number|string} promptTokens
 * @param {number|string} completionTokens
 * @returns {number}
 */
export function costPerCall(model, promptTokens, completionTokens) {
  const inPrice = toFiniteNumber(model?.input_price) ?? 0
  const outPrice = toFiniteNumber(model?.output_price) ?? 0
  const inTok = Math.max(toFiniteNumber(promptTokens) ?? 0, 0)
  const outTok = Math.max(toFiniteNumber(completionTokens) ?? 0, 0)
  const cost = (inTok / 1e6) * inPrice + (outTok / 1e6) * outPrice
  return Number.isFinite(cost) && cost > 0 ? cost : 0
}

/**
 * Summarise a model catalogue for the KPI header:
 *   • total        — number of rows
 *   • activeCount   — rows with active === true
 *   • defaultModel — the row flagged is_default (first active default wins;
 *                    falls back to any is_default row); null when none.
 *
 * @param {Array<object>} rows
 * @returns {{ total:number, activeCount:number, defaultModel:object|null }}
 */
export function summariseModels(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let activeCount = 0
  let defaultModel = null
  let fallbackDefault = null

  for (const r of list) {
    if (r?.active === true) activeCount += 1
    if (r?.is_default === true) {
      if (!fallbackDefault) fallbackDefault = r
      if (r?.active === true && !defaultModel) defaultModel = r
    }
  }

  return {
    total: list.length,
    activeCount,
    defaultModel: defaultModel ?? fallbackDefault ?? null,
  }
}

/**
 * Budget utilisation against current spend. Chooses cost_cap_usd as the cap when
 * present, else token_cap, so the same helper covers both cost- and token-capped
 * budgets. Guards a zero/absent cap (pct 0, never Infinity/NaN).
 *
 * @param {{ cost_cap_usd?:number|string, token_cap?:number|string }} budget
 * @param {number|string} currentSpend  spend in the same unit as the chosen cap
 * @returns {{ pct:number, over:boolean, remaining:number, cap:number }}
 */
export function budgetStatus(budget, currentSpend) {
  const costCap = toFiniteNumber(budget?.cost_cap_usd)
  const tokenCap = toFiniteNumber(budget?.token_cap)
  const cap = costCap != null && costCap > 0
    ? costCap
    : (tokenCap != null && tokenCap > 0 ? tokenCap : 0)
  const spend = Math.max(toFiniteNumber(currentSpend) ?? 0, 0)

  if (cap <= 0) {
    return { pct: 0, over: false, remaining: 0, cap: 0 }
  }

  const pct = (spend / cap) * 100
  return {
    pct,
    over: spend > cap,
    remaining: cap - spend,
    cap,
  }
}
