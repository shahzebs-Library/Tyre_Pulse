import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudgetDb, ORG_A, U } from './fixtures/tyre_cost_harness.mjs'

// The ai-orchestrator budget reserve/settle cycle against the REAL migrations
// 20261112100000 + the 107000 settle fix. reserve/settle are SECURITY DEFINER and
// service-role only, so they are exercised as the DB owner (the superuser PGlite runs as).
// Proves the Codex #484 fix: settle must NOT write ai_token_logs.total_tokens (GENERATED
// ALWAYS), or every settlement fails and leaves the reservation 'reserved' forever.

const ATTEMPT = '00000000-0000-0000-0000-00000000cc01'

const reserve = (id = ATTEMPT, est = 0.01) =>
  `select public.ai_orchestrator_reserve_budget('${id}', '${ORG_A}', '${U.manager}', ${est}, 'orchestrator') v`
const settle = (id = ATTEMPT) =>
  `select public.ai_orchestrator_settle_budget('${id}', 'success', 0.002, true, 'claude-haiku-4-5', 5, 7, 200, null, 1200) v`

test('reserve then settle: the GENERATED total_tokens is computed, never supplied, and the reservation settles once', async () => {
  const db = await createBudgetDb()

  const r = await db.query(reserve())
  assert.equal(r.rows[0].v.ok, true)
  assert.equal(r.rows[0].v.state, 'uncapped', 'no cap configured -> reserves uncapped')
  const resv = await db.query(`select status from public.ai_budget_reservations where id = '${ATTEMPT}'`)
  assert.equal(resv.rows[0].status, 'reserved')

  const s = await db.query(settle())
  assert.equal(s.rows[0].v.ok, true)
  assert.equal(s.rows[0].v.state, 'settled')

  const log = await db.query(`select prompt_tokens, completion_tokens, total_tokens, cost_usd from public.ai_token_logs limit 1`)
  assert.equal(Number(log.rows[0].total_tokens), 12, 'total_tokens = prompt + completion, computed by the GENERATED column')
  assert.equal(Number(log.rows[0].cost_usd), 0.002)

  const after = await db.query(`select status, actual_usd from public.ai_budget_reservations where id = '${ATTEMPT}'`)
  assert.equal(after.rows[0].status, 'settled')
  assert.equal(Number(after.rows[0].actual_usd), 0.002)

  // Settling again is a no-op (idempotent), not a second log row.
  const again = await db.query(settle())
  assert.equal(again.rows[0].v.already, true)
  const logs = await db.query(`select count(*)::int n from public.ai_token_logs`)
  assert.equal(logs.rows[0].n, 1)

  // No reservation is left stranded in 'reserved'.
  const stranded = await db.query(`select count(*)::int n from public.ai_budget_reservations where status = 'reserved'`)
  assert.equal(stranded.rows[0].n, 0)
  await db.close?.()
})

test('mutation: if settle writes total_tokens again, every settlement fails and the reservation is stranded', async () => {
  // Re-introduce the original defect in the 107000 settle body.
  const db = await createBudgetDb({
    mutate: (s) => s
      .replace('error, latency_ms)', 'error, latency_ms, total_tokens)')
      .replace('p_latency_ms)', 'p_latency_ms, 123)'),
  })

  const r = await db.query(reserve())
  assert.equal(r.rows[0].v.ok, true)

  await assert.rejects(db.query(settle()), /generated|GENERATED|total_tokens/, 'writing the GENERATED column fails')

  // The whole settle rolled back: the reservation is still 'reserved' (the stranding bug).
  const resv = await db.query(`select status from public.ai_budget_reservations where id = '${ATTEMPT}'`)
  assert.equal(resv.rows[0].status, 'reserved')
  const logs = await db.query(`select count(*)::int n from public.ai_token_logs`)
  assert.equal(logs.rows[0].n, 0, 'nothing was logged')
  await db.close?.()
})
