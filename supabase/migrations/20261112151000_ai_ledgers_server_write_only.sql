-- AI usage ledgers are written by the server only.
--
-- FINDING: AI-1 (P2)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as a Driver, rolled back):
--   insert into ai_token_logs (own user id, cost_usd 1000)   -> accepted
--     ai_month_spend_usd(0.01): 0.336129 -> 1000.336129 (monthly budget is 20,
--     so chat-ai, ai-orchestrator and the tyre photo worker all stop).
--   insert into ai_usage_log under ANOTHER user's id        -> accepted
--   A negative cost makes ai_month_spend_usd return NULL (all gates fail closed).
--
-- WHAT THIS DOES
--   1. INSERT and UPDATE on both ledgers are revoked from authenticated / anon.
--   2. The two client insert policies are closed (WITH CHECK false) and
--      commented, so the catalog does not suggest a client write path.
--   3. ai_token_logs.cost_usd can no longer be negative.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Writers checked (every one keeps working):
--   supabase/functions chat-ai, ai-orchestrator, ai-tyre-inspection,
--     embed-worker, generate-embedding  -> service-role client (svc / admin)
--   ai_orchestrator_settle_budget        -> SECURITY DEFINER
--   src/, mobile/, tyre_pulse_flutter/   -> SELECT only (no insert / update)
-- Data loss: none. ai_token_logs had 104 rows, 0 with a negative cost, so the
--   new CHECK validates.
-- Locks: ADD CONSTRAINT validates 104 rows (instant).
-- Readers: unchanged (atl_select, ai_read_own, super admin).
-- Client behaviour that changes: none.
-- Not done here: per-organisation budget (AI-2) - edge function work.
-- Rollback: at the foot.

revoke insert, update on public.ai_token_logs from authenticated, anon;
revoke insert, update on public.ai_usage_log  from authenticated, anon;

alter policy atl_insert on public.ai_token_logs with check (false);
alter policy ai_insert_authenticated on public.ai_usage_log with check (false);

comment on policy atl_insert on public.ai_token_logs is
  'Closed 2026-11-12 (AI-1). The ledger is written by edge functions (service role) and ai_orchestrator_settle_budget only.';
comment on policy ai_insert_authenticated on public.ai_usage_log is
  'Closed 2026-11-12 (AI-1). The ledger is written by edge functions (service role) only.';

alter table public.ai_token_logs
  add constraint chk_ai_token_logs_cost_nonneg check (cost_usd is null or cost_usd >= 0);

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12 in one rolled-back transaction, role switched per block)
--   Driver:  insert ai_token_logs (cost 1000)            -> 42501
--            insert ai_usage_log as another user          -> 42501
--            ai_month_spend_usd(0.01) before = after = 0.336129
--   service_role: insert ai_token_logs / ai_usage_log     -> accepted
--                 insert ai_token_logs cost_usd = -5      -> 23514
--   Manager: select count(*) from ai_token_logs           -> 94 (unchanged)
--
-- ---------------------------------------------------------------------- ROLLBACK
--   grant insert, update on public.ai_token_logs, public.ai_usage_log to authenticated;
--   alter policy atl_insert on public.ai_token_logs
--     with check ((auth.uid() is not null) and (user_id = auth.uid()));
--   alter policy ai_insert_authenticated on public.ai_usage_log
--     with check ((select auth.role()) = 'authenticated');
--   (owner, SQL editor) remove constraint chk_ai_token_logs_cost_nonneg.
