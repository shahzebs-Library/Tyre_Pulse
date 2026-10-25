-- Repo record of broadcast_recipient_receipts and broadcast_replies.
-- Both tables already exist live (created in the dashboard); this file is a
-- faithful, idempotent copy read from the live catalog on 2026-10-25 so a fresh
-- environment can be rebuilt and the RLS can be tested. Safe to re-run: on the
-- live database every statement is a no-op.

create table if not exists public.broadcast_recipient_receipts (
  id              uuid primary key default gen_random_uuid(),
  broadcast_id    uuid not null references public.broadcast_messages(id) on delete cascade,
  recipient_id    uuid not null references auth.users(id) on delete cascade,
  read_at         timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (broadcast_id, recipient_id)
);
create index if not exists broadcast_receipts_recipient_idx
  on public.broadcast_recipient_receipts (recipient_id);

create table if not exists public.broadcast_replies (
  id           uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcast_messages(id) on delete cascade,
  author_id    uuid not null references auth.users(id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at   timestamptz not null default now()
);
create index if not exists broadcast_replies_broadcast_idx
  on public.broadcast_replies (broadcast_id, created_at desc);

alter table public.broadcast_recipient_receipts enable row level security;
alter table public.broadcast_replies enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='broadcast_recipient_receipts' and policyname='recipient views own receipt') then
    create policy "recipient views own receipt" on public.broadcast_recipient_receipts
      for select using (recipient_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='broadcast_recipient_receipts' and policyname='sender views receipt') then
    create policy "sender views receipt" on public.broadcast_recipient_receipts
      for select using (exists (select 1 from public.broadcast_messages b
        where b.id = broadcast_recipient_receipts.broadcast_id and b.sent_by = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where tablename='broadcast_recipient_receipts' and policyname='recipient marks own receipt') then
    create policy "recipient marks own receipt" on public.broadcast_recipient_receipts
      for update using (recipient_id = (select auth.uid()))
      with check (recipient_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='broadcast_replies' and policyname='participants view replies') then
    create policy "participants view replies" on public.broadcast_replies
      for select using (
        author_id = (select auth.uid())
        or exists (select 1 from public.broadcast_messages b
                   where b.id = broadcast_replies.broadcast_id and b.sent_by = (select auth.uid()))
        or exists (select 1 from public.broadcast_recipient_receipts r
                   where r.broadcast_id = broadcast_replies.broadcast_id and r.recipient_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where tablename='broadcast_replies' and policyname='recipient replies') then
    create policy "recipient replies" on public.broadcast_replies
      for insert with check (
        author_id = (select auth.uid())
        and exists (select 1 from public.broadcast_recipient_receipts r
                    where r.broadcast_id = broadcast_replies.broadcast_id and r.recipient_id = (select auth.uid())));
  end if;
end $$;

-- Recipients may only change the two receipt timestamps, never who or what.
grant select on public.broadcast_recipient_receipts to authenticated;
grant update (read_at, acknowledged_at) on public.broadcast_recipient_receipts to authenticated;
grant select, insert on public.broadcast_replies to authenticated;
