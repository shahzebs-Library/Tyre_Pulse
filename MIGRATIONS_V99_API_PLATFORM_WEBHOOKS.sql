-- ============================================================================
-- MIGRATIONS_V99_API_PLATFORM_WEBHOOKS.sql
-- Phase 15 (roadmap): API platform (keys) + outbound webhooks.
--
--  * api_keys — org-scoped keys for the `public-api` edge function. The
--    plaintext key ('tp_' + 48 hex chars) is returned ONCE by
--    create_api_key(); only its SHA-256 lands in the table.
--    api_key_authenticate() (service-role only) validates, bumps
--    last_used_at, and enforces a per-minute rate limit via api_key_usage.
--  * webhook_subscriptions / webhook_deliveries — V98 domain events fan out
--    to customer endpoints. Delivery is pure SQL + pg_net with HMAC-SHA256
--    signatures (X-TyrePulse-Signature), exponential backoff (2^n minutes,
--    6 attempts), and auto-disable after 20 consecutive failures.
--    At-least-once event replays are absorbed by a (subscription, event)
--    uniqueness guard.
--
-- Depends on: V98 (domain_events, event_consumers), V42 (app_current_org),
--             pgcrypto (digest/hmac), pg_net, pg_cron.
--
-- Rollback:
--   SELECT cron.unschedule('deliver-webhooks');
--   DELETE FROM public.event_consumers WHERE consumer = 'consume_event_webhooks';
--   DROP FUNCTION public.deliver_pending_webhooks();
--   DROP FUNCTION public.consume_event_webhooks(public.domain_events);
--   DROP FUNCTION public.api_key_authenticate(text);
--   DROP FUNCTION public.revoke_api_key(uuid);
--   DROP FUNCTION public.create_api_key(text,text[],timestamptz);
--   DROP TABLE public.webhook_deliveries, public.webhook_subscriptions,
--              public.api_key_usage, public.api_keys;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. API KEYS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  name            text NOT NULL,
  key_prefix      text NOT NULL,                  -- first 10 chars, for display
  key_hash        text NOT NULL UNIQUE,           -- sha256 hex of the full key
  scopes          text[] NOT NULL DEFAULT ARRAY['read'],
  active          boolean NOT NULL DEFAULT true,
  rate_per_minute int NOT NULL DEFAULT 120 CHECK (rate_per_minute BETWEEN 1 AND 10000),
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  expires_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON public.api_keys (organisation_id, active);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys
  FOR SELECT TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()));
DROP POLICY IF EXISTS api_keys_update ON public.api_keys;
CREATE POLICY api_keys_update ON public.api_keys
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()))
  WITH CHECK ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()));
-- No INSERT policy: keys are minted only via create_api_key().

-- Per-key, per-minute usage counters (pruned as they age).
CREATE TABLE IF NOT EXISTS public.api_key_usage (
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  minute timestamptz NOT NULL,
  count  int NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, minute)
);
ALTER TABLE public.api_key_usage ENABLE ROW LEVEL SECURITY;
-- service-role only; no policies.

CREATE OR REPLACE FUNCTION public.create_api_key(
  p_name       text,
  p_scopes     text[] DEFAULT ARRAY['read'],
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key  text;
  v_id   uuid;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  IF COALESCE(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF p_scopes IS NULL OR array_length(p_scopes, 1) IS NULL
     OR EXISTS (SELECT 1 FROM unnest(p_scopes) s WHERE s NOT IN ('read')) THEN
    RAISE EXCEPTION 'invalid scopes (supported: read)';
  END IF;

  v_key := 'tp_' || encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.api_keys (organisation_id, name, key_prefix, key_hash, scopes, expires_at, created_by)
  VALUES (public.app_current_org(), trim(p_name), left(v_key, 10),
          encode(digest(v_key, 'sha256'), 'hex'), p_scopes, p_expires_at, auth.uid())
  RETURNING id INTO v_id;

  -- The only time the plaintext key ever leaves the database.
  RETURN jsonb_build_object('id', v_id, 'key', v_key, 'prefix', left(v_key, 10));
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_api_key(text,text[],timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_api_key(text,text[],timestamptz) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.revoke_api_key(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  UPDATE public.api_keys
     SET active = false
   WHERE id = p_id AND organisation_id = public.app_current_org();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api key not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_api_key(uuid) FROM PUBLIC, anon;

-- Called by the public-api edge function (service role). Validates the key,
-- bumps last_used_at, enforces the per-minute rate limit.
CREATE OR REPLACE FUNCTION public.api_key_authenticate(p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row    public.api_keys%ROWTYPE;
  v_minute timestamptz := date_trunc('minute', now());
  v_count  int;
BEGIN
  SELECT * INTO v_row FROM public.api_keys
   WHERE key_hash = encode(digest(COALESCE(p_key, ''), 'sha256'), 'hex');

  IF NOT FOUND OR NOT v_row.active
     OR (v_row.expires_at IS NOT NULL AND v_row.expires_at < now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_key');
  END IF;

  INSERT INTO public.api_key_usage AS u (key_id, minute, count)
  VALUES (v_row.id, v_minute, 1)
  ON CONFLICT (key_id, minute) DO UPDATE SET count = u.count + 1
  RETURNING count INTO v_count;

  -- Opportunistic pruning of stale counters.
  DELETE FROM public.api_key_usage WHERE minute < now() - interval '1 hour';

  UPDATE public.api_keys SET last_used_at = now() WHERE id = v_row.id;

  IF v_count > v_row.rate_per_minute THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited',
                              'limit', v_row.rate_per_minute);
  END IF;

  RETURN jsonb_build_object('ok', true, 'key_id', v_row.id,
                            'organisation_id', v_row.organisation_id,
                            'scopes', to_jsonb(v_row.scopes),
                            'remaining', v_row.rate_per_minute - v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.api_key_authenticate(text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WEBHOOK SUBSCRIPTIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhook_subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      uuid NOT NULL DEFAULT public.app_current_org(),
  name                 text NOT NULL,
  url                  text NOT NULL CHECK (url ~* '^https://'),
  secret               text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  event_types          text[],                    -- NULL = all events
  active               boolean NOT NULL DEFAULT true,
  consecutive_failures int NOT NULL DEFAULT 0,
  disabled_reason      text,
  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  created_by           uuid DEFAULT auth.uid(),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_org
  ON public.webhook_subscriptions (organisation_id, active);

ALTER TABLE public.webhook_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_subscriptions_all ON public.webhook_subscriptions;
CREATE POLICY webhook_subscriptions_all ON public.webhook_subscriptions
  FOR ALL TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()))
  WITH CHECK ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()));

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES public.webhook_subscriptions(id) ON DELETE CASCADE,
  event_id        bigint NOT NULL,
  organisation_id uuid,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','delivered','failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request_id      bigint,                          -- pg_net request id of the last attempt
  response_status int,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_deliveries_sub_event
  ON public.webhook_deliveries (subscription_id, event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due
  ON public.webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub_time
  ON public.webhook_deliveries (subscription_id, created_at DESC);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_deliveries_select ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_select ON public.webhook_deliveries
  FOR SELECT TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EVENT CONSUMER — queue deliveries for matching subscriptions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_event_webhooks(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.webhook_deliveries
    (subscription_id, event_id, organisation_id, event_type, payload)
  SELECT s.id, ev.id, s.organisation_id, ev.event_type,
         jsonb_build_object(
           'id',          ev.id,
           'type',        ev.event_type,
           'entity_type', ev.entity_type,
           'entity_id',   ev.entity_id,
           'created_at',  ev.created_at,
           'data',        ev.payload)
    FROM public.webhook_subscriptions s
   WHERE s.active
     AND s.organisation_id IS NOT DISTINCT FROM ev.organisation_id
     AND (s.event_types IS NULL OR ev.event_type = ANY (s.event_types))
  ON CONFLICT (subscription_id, event_id) DO NOTHING;   -- absorbs event replays
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_event_webhooks(public.domain_events) FROM PUBLIC, anon, authenticated;

INSERT INTO public.event_consumers (consumer, event_types, description)
VALUES ('consume_event_webhooks', NULL, 'Queues webhook_deliveries for active subscriptions matching each domain event.')
ON CONFLICT (consumer) DO UPDATE SET enabled = true, event_types = NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DELIVERER (pg_cron, every minute)
--    Sends due deliveries via pg_net with an HMAC signature, then reconciles
--    responses from net._http_response on the next sweep. Backoff: 2^n min.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deliver_pending_webhooks()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d          record;
  r          record;
  v_body     text;
  v_sig      text;
  v_req      bigint;
  n_sent     int := 0;
  n_done     int := 0;
  n_dead     int := 0;
BEGIN
  -- 4a. Reconcile responses of previously sent attempts.
  FOR d IN
    SELECT wd.id, wd.subscription_id, wd.attempts, wd.request_id
      FROM public.webhook_deliveries wd
     WHERE wd.status = 'pending' AND wd.request_id IS NOT NULL
  LOOP
    SELECT status_code, error_msg INTO r
      FROM net._http_response WHERE id = d.request_id;
    IF NOT FOUND THEN
      CONTINUE;  -- response not landed yet
    END IF;

    IF r.status_code BETWEEN 200 AND 299 THEN
      UPDATE public.webhook_deliveries
         SET status = 'delivered', delivered_at = now(),
             response_status = r.status_code, last_error = NULL, request_id = NULL
       WHERE id = d.id;
      UPDATE public.webhook_subscriptions
         SET last_success_at = now(), consecutive_failures = 0
       WHERE id = d.subscription_id;
      n_done := n_done + 1;
    ELSE
      UPDATE public.webhook_deliveries
         SET response_status = r.status_code,
             last_error = left(COALESCE(r.error_msg, 'HTTP ' || COALESCE(r.status_code::text, '?')), 500),
             request_id = NULL,
             status = CASE WHEN d.attempts >= 6 THEN 'failed' ELSE 'pending' END
       WHERE id = d.id;
      UPDATE public.webhook_subscriptions s
         SET last_failure_at = now(),
             consecutive_failures = s.consecutive_failures + 1,
             active = CASE WHEN s.consecutive_failures + 1 >= 20 THEN false ELSE s.active END,
             disabled_reason = CASE WHEN s.consecutive_failures + 1 >= 20
                                    THEN 'Auto-disabled after 20 consecutive failures' END
       WHERE id = d.subscription_id;
      IF d.attempts >= 6 THEN n_dead := n_dead + 1; END IF;
    END IF;
  END LOOP;

  -- 4b. Send due deliveries.
  FOR d IN
    SELECT wd.id, wd.payload, wd.attempts, s.url, s.secret, wd.event_type
      FROM public.webhook_deliveries wd
      JOIN public.webhook_subscriptions s ON s.id = wd.subscription_id
     WHERE wd.status = 'pending'
       AND wd.request_id IS NULL
       AND wd.next_attempt_at <= now()
       AND wd.attempts < 6
       AND s.active
     ORDER BY wd.next_attempt_at
     LIMIT 50
     FOR UPDATE OF wd SKIP LOCKED
  LOOP
    v_body := d.payload::text;
    v_sig  := 'sha256=' || encode(hmac(v_body, d.secret, 'sha256'), 'hex');

    v_req := net.http_post(
      url     := d.url,
      headers := jsonb_build_object(
        'Content-Type',           'application/json',
        'User-Agent',             'TyrePulse-Webhooks/1.0',
        'X-TyrePulse-Event',      d.event_type,
        'X-TyrePulse-Signature',  v_sig),
      body    := d.payload,
      timeout_milliseconds := 10000
    );

    UPDATE public.webhook_deliveries
       SET attempts = d.attempts + 1,
           request_id = v_req,
           next_attempt_at = now() + make_interval(mins => least(power(2, d.attempts + 1)::int, 60))
     WHERE id = d.id;
    n_sent := n_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('sent', n_sent, 'delivered', n_done, 'dead', n_dead);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.deliver_pending_webhooks() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deliver-webhooks') THEN
    PERFORM cron.unschedule('deliver-webhooks');
  END IF;
END $$;

SELECT cron.schedule(
  'deliver-webhooks',
  '* * * * *',
  $$SELECT public.deliver_pending_webhooks();$$
);

COMMENT ON TABLE public.api_keys IS
  'Org-scoped API keys for the public-api edge function. Plaintext returned once by create_api_key(); only sha256 stored.';
COMMENT ON TABLE public.webhook_subscriptions IS
  'Customer webhook endpoints. Deliveries signed with HMAC-SHA256 (X-TyrePulse-Signature: sha256=<hex> over the raw JSON body).';
