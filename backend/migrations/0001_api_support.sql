-- +goose Up
-- API support tables for the Go backend. These are ADDITIVE only — they do not
-- modify, rename, or drop any existing TyrePulse table. Safe to apply against
-- the existing Supabase Postgres in Phase A.

-- Immutable audit trail for critical API actions (append-only).
CREATE TABLE IF NOT EXISTS public.api_audit_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    uuid,
    action      text NOT NULL,
    entity      text NOT NULL,
    entity_id   text,
    request_id  text,
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_audit_events_actor   ON public.api_audit_events (actor_id);
CREATE INDEX IF NOT EXISTS idx_api_audit_events_entity  ON public.api_audit_events (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_api_audit_events_created ON public.api_audit_events (created_at DESC);

-- Idempotency keys make mobile write commands safe to retry. The same key
-- replays the stored response instead of performing the action twice.
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idem_key      text NOT NULL,
    actor_id      uuid,
    endpoint      text NOT NULL,
    request_hash  text NOT NULL,
    status_code   int,
    response_body jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    CONSTRAINT idempotency_keys_unique UNIQUE (idem_key, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON public.idempotency_keys (expires_at);

-- +goose Down
DROP TABLE IF EXISTS public.idempotency_keys;
DROP TABLE IF EXISTS public.api_audit_events;
