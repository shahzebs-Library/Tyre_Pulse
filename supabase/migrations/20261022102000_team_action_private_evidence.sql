-- Deployed to Tyre_pulse on 2026-10-22. Private evidence storage.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('team-action-evidence','team-action-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create table if not exists public.team_action_evidence(
 id uuid primary key default gen_random_uuid(), action_id uuid not null references public.action_items(id) on delete cascade,
 uploaded_by uuid not null references auth.users(id), storage_path text not null unique,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 created_at timestamptz not null default now());
alter table public.team_action_evidence enable row level security;
grant select,insert on public.team_action_evidence to authenticated;
drop policy if exists "employee uploads assigned action evidence" on public.team_action_evidence;
create policy "employee uploads assigned action evidence" on public.team_action_evidence for insert to authenticated
 with check(uploaded_by=auth.uid() and exists(select 1 from public.action_items a where a.id=action_id and a.assigned_user_id=auth.uid() and a.organisation_id=public.app_current_org()) and storage_path like (auth.uid()::text||'/'||action_id::text||'/%'));
drop policy if exists "employee reads own action evidence" on public.team_action_evidence;
create policy "employee reads own action evidence" on public.team_action_evidence for select to authenticated
 using(exists(select 1 from public.action_items a where a.id=action_id and a.assigned_user_id=auth.uid() and a.organisation_id=public.app_current_org()));
drop policy if exists "action evidence storage upload" on storage.objects;
create policy "action evidence storage upload" on storage.objects for insert to authenticated
 with check(bucket_id='team-action-evidence' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.action_items a where a.id::text=(storage.foldername(name))[2] and a.assigned_user_id=auth.uid() and a.organisation_id=public.app_current_org()));
drop policy if exists "action evidence storage read" on storage.objects;
create policy "action evidence storage read" on storage.objects for select to authenticated
 using(bucket_id='team-action-evidence' and exists(select 1 from public.action_items a where a.id::text=(storage.foldername(name))[2] and a.assigned_user_id=auth.uid() and a.organisation_id=public.app_current_org()));
