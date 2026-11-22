-- HOSTED Supabase staging project only (never the local stand-in, never production).
-- Run once, before the baseline, as the postgres role of the STAGING project.
-- A hosted project already has auth, storage, extensions, net, vault, realtime and the roles.
create extension if not exists vector with schema public;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_net;      -- schema net; staging should not call out: leave cron jobs unscheduled
create extension if not exists pg_cron;     -- needed only because functions reference cron.job and cron.job_run_details
create schema if not exists _bak;
create table if not exists _bak.cron_run_details_20261011 (like cron.job_run_details);
