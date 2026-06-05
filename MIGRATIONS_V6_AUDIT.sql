-- ============================================================
-- TYREPULSE — MIGRATIONS V6 AUDIT
-- Run in Supabase SQL Editor
-- Adds: audit_log table for tracking all user actions
-- Built by Shahzeb Rahman © 2026
-- ============================================================

create table if not exists public.audit_log (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles(id),
  action text not null,
  table_name text,
  record_count integer default 1,
  details jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_audit_log_user on public.audit_log(user_id);
create index if not exists idx_audit_log_action on public.audit_log(action);
create index if not exists idx_audit_log_created on public.audit_log(created_at desc);
alter table public.audit_log enable row level security;
create policy "audit_select" on public.audit_log for select using (auth.role()='authenticated');
create policy "audit_insert" on public.audit_log for insert with check (auth.role()='authenticated');
