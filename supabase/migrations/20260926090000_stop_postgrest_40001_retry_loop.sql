-- Stop PostgREST's infinite retry loop on business "stale data" errors.
--
-- ROOT CAUSE (measured 2026-09-26): 19 RPCs raised a deliberate optimistic-
-- concurrency refusal with ERRCODE '40001' (serialization_failure). PostgREST
-- runs every request through hasql-transaction, which AUTOMATICALLY RETRIES a
-- transaction that fails with 40001 - with no limit. A 40001 raised on purpose
-- by a deterministic check fails identically on every retry, so the request
-- never ends. Three save_vehicle_meter_readings requests from 2026-09-19 were
-- still looping ~100 times a second a week later: 8.6M "Meter changed; refresh
-- before saving" ERROR lines per day in the Postgres log, 59,113 distinct
-- transactions in 10 minutes from 3 backend sessions, while the API gateway saw
-- ~220 requests in the same 10 minutes.
--
-- FIX: raise PT409 instead. PostgREST maps an SQLSTATE of the form PTnnn to
-- HTTP status nnn and never retries it, so the caller gets a 409 Conflict with
-- the same message. Clients now accept both '40001' and 'PT409'.
-- The single handler that CATCHES this refusal
-- (tyre_change_approval_context: WHEN SQLSTATE '40001') is widened to catch
-- PT409 as well, so its behaviour is unchanged.
--
-- RULE: never raise 40001 (or 40P01) on purpose from a function reachable via
-- PostgREST. Use PT409 for "someone else changed this, refresh".
--
-- Bodies are rewritten from their LIVE pg_get_functiondef text, so nothing is
-- retyped; the block aborts if any deliberate 40001 raise survives.
DO $$
DECLARE
  r record;
  def text;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p
    WHERE p.prosrc ~* $re$errcode\s*=\s*'40001'$re$
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, $re$(errcode\s*=\s*)'40001'$re$, $rp$\1'PT409'$rp$, 'gi');
    EXECUTE def;
    n := n + 1;
  END LOOP;

  FOR r IN
    SELECT p.oid FROM pg_proc p
    WHERE p.prosrc ~* $re$when\s+sqlstate\s+'40001'\s+then$re$
  LOOP
    def := pg_get_functiondef(r.oid);
    def := regexp_replace(def, $re$when\s+sqlstate\s+'40001'\s+then$re$,
                          $rp$WHEN SQLSTATE '40001' OR SQLSTATE 'PT409' THEN$rp$, 'gi');
    EXECUTE def;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE prosrc ~* $re$errcode\s*=\s*'40001'$re$) THEN
    RAISE EXCEPTION 'a deliberate 40001 raise survived the rewrite';
  END IF;
  RAISE NOTICE 'rewrote % functions', n;
END $$;
