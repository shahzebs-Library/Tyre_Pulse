-- 20261110144000 user_devices_fail_count  (DRAFT - NOT APPLIED; lead applies)
-- F-K-02: workflow-notify counts FCM THIRD_PARTY_AUTH_ERRORs per device and revokes after 5.
-- Additive only. Idempotent.
alter table public.user_devices add column if not exists fail_count integer not null default 0;
alter table public.user_devices add column if not exists last_fail_at timestamptz;

-- VERIFY (separate call):
--   select column_name, data_type, column_default from information_schema.columns
--   where table_schema='public' and table_name='user_devices' and column_name in ('fail_count','last_fail_at');   -- 2 rows
--   select count(*) from public.user_devices where fail_count <> 0;                                              -- 0
-- ROLLBACK:
--   alter table public.user_devices drop column if exists fail_count, drop column if exists last_fail_at;
