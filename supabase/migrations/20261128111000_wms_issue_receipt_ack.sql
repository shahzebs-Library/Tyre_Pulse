-- 20261128111000_wms_issue_receipt_ack
--
-- "Who received the parts": a slim acknowledgement record per ISSUE movement.
-- The store keeper who issued names the receiver (a real person, not free text);
-- the receiver confirms in their own session (web or phone). A Mechanic needs no
-- stock rights to acknowledge: only the named receiver can acknowledge, and only
-- their own line.
--
-- Keyed on the issue movement (stock_movements.id). A slip line
-- (material_issue_lines.movement_id, posted by _inv_issue_slip) is linked when
-- given, so slips and Picking (inv_issue) share one record. stock_movements is
-- append-only and is NOT changed. Additive only: one new table, three new functions.
--
-- Rules (all server side):
--   * request: approved + unlocked, stock 'issue'; idempotent (_inv_req_begin),
--     a key reused for another payload = PT409; one record per movement
--     (a second request for the same issue = PT409); the movement must be a live
--     (not reversed) 'issue' of the caller's company and scope;
--   * receiver: required, approved, unlocked, same company, the issue's country in
--     their country scope and the issue's site in their site scope (or an
--     Admin/super admin); receiver IS DISTINCT FROM the issuer (movement actor)
--     and from the requester;
--   * acknowledge / dispute: only the named receiver, once (repeat = PT409);
--     a dispute needs a note;
--   * table: org (restrictive, all) + country + site (restrictive, select) RLS;
--     read by stock viewers, the receiver and the requester; no direct writes;
--     every write audited through record_audit_event.

begin;

create table if not exists public.stock_issue_receipts (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null default public.app_current_org(),
  country                text,
  site                   text,
  movement_id            uuid not null references public.stock_movements(id),
  material_issue_line_id uuid references public.material_issue_lines(id),
  job_card_no            text,
  item_id                uuid,
  item_code              text,
  item_description       text,
  qty                    numeric not null check (qty > 0),
  uom                    text,
  issued_by              uuid,
  requested_by           uuid not null default auth.uid(),
  requested_at           timestamptz not null default now(),
  receiver_user_id       uuid not null references public.profiles(id),
  receiver_name          text,
  status                 text not null default 'pending' check (status in ('pending', 'acknowledged', 'disputed')),
  decided_at             timestamptz,
  decision_note          text check (decision_note is null or length(decision_note) <= 500),
  idempotency_key        text not null check (length(idempotency_key) between 1 and 200),
  constraint stock_issue_receipts_movement_uniq unique (movement_id),
  constraint stock_issue_receipts_key_uniq unique (organisation_id, idempotency_key),
  constraint stock_issue_receipts_not_self check (receiver_user_id is distinct from requested_by
                                                  and receiver_user_id is distinct from issued_by),
  constraint stock_issue_receipts_decided_chk check ((status = 'pending') = (decided_at is null))
);

create index if not exists stock_issue_receipts_receiver_idx
  on public.stock_issue_receipts (receiver_user_id, status, requested_at desc);
create index if not exists stock_issue_receipts_job_card_idx
  on public.stock_issue_receipts (organisation_id, job_card_no);
create unique index if not exists stock_issue_receipts_line_uniq
  on public.stock_issue_receipts (material_issue_line_id) where material_issue_line_id is not null;

alter table public.stock_issue_receipts enable row level security;

create policy stock_issue_receipts_org_isolation on public.stock_issue_receipts as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
create policy stock_issue_receipts_country_isolation on public.stock_issue_receipts as restrictive for select to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
create policy stock_issue_receipts_site_isolation on public.stock_issue_receipts as restrictive for select to authenticated
  using ((site is null) or (btrim(site) = '') or (select public.app_sees_all_sites())
         or (upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))));
create policy stock_issue_receipts_read on public.stock_issue_receipts for select to authenticated
  using ((select public.app_is_active()) is true
         and (receiver_user_id = (select auth.uid()) or requested_by = (select auth.uid())
              or (select public.inv_can('view'))));

revoke all on public.stock_issue_receipts from anon;
revoke insert, update, delete, truncate, trigger, references on public.stock_issue_receipts from authenticated;
grant select on public.stock_issue_receipts to authenticated;

-- Can this profile receive parts at this country/site? (the receiver's OWN scope,
-- read from their profile, mirroring the app_country_scope / app_site_scope rules)
create or replace function public._inv_receiver_in_scope(p_user uuid, p_org uuid, p_country text, p_site text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles r
     where r.id = p_user
       and coalesce(r.approved, false) and not coalesce(r.locked, false)
       and (r.org_id = p_org or r.organisation_id = p_org)
       and (coalesce(r.is_super_admin, false) or lower(btrim(coalesce(r.role, ''))) = 'admin'
            or ((p_country is null
                 or lower(btrim(p_country)) = any (select lower(btrim(c)) from unnest(coalesce(r.country, '{}'::text[])) c))
                and (p_site is null or btrim(p_site) = ''
                     or exists (select 1 from unnest(coalesce(r.sites, '{}'::text[])) s
                                 where upper(btrim(s)) in ('ALL', '*') or upper(btrim(s)) = upper(btrim(p_site)))))))
$$;
revoke all on function public._inv_receiver_in_scope(uuid, uuid, text, text) from public;
revoke all on function public._inv_receiver_in_scope(uuid, uuid, text, text) from anon;
revoke all on function public._inv_receiver_in_scope(uuid, uuid, text, text) from authenticated;

create or replace function public.inv_issue_receipt_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p jsonb := p_payload;
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
  v_cached jsonb;
  v_m public.stock_movements%rowtype;
  v_line public.material_issue_lines%rowtype;
  v_receiver uuid;
  v_name text;
  v_code text; v_desc text; v_uom text;
  v_row public.stock_issue_receipts%rowtype;
  v_res jsonb;
begin
  if v_uid is null or not public.is_approved_and_unlocked() or v_org is null or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  begin
    v_cached := public._inv_req_begin('inv_issue_receipt_request', p);
  exception when unique_violation then
    raise exception 'This key was already used for a different handover.' using errcode = 'PT409';
  end;
  if v_cached is not null then return v_cached; end if;

  begin
    v_receiver := nullif(btrim(coalesce(p->>'receiver_user_id', '')), '')::uuid;
    select * into v_m from public.stock_movements
     where id = nullif(btrim(coalesce(p->>'movement_id', '')), '')::uuid and organisation_id = v_org;
  exception when invalid_text_representation then
    raise exception 'movement_id and receiver_user_id must be ids.' using errcode = '22023';
  end;
  if v_receiver is null then
    raise exception 'Choose the person who received the parts.' using errcode = '22023';
  end if;
  if v_m.id is null or v_m.movement_type is distinct from 'issue' or coalesce(v_m.qty_change, 0) >= 0 then
    raise exception 'Choose an issue movement of your company.' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements x where x.reverses_movement_id = v_m.id) then
    raise exception 'That issue was reversed; there is nothing to hand over.' using errcode = '22023';
  end if;
  if not public._inv_scope_ok(v_m.country, v_m.site) then
    raise exception 'This issue is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_receiver is not distinct from v_m.actor_id or v_receiver is not distinct from v_uid then
    raise exception 'The receiver must be someone other than the person who issued the parts.' using errcode = '22023';
  end if;
  if not public._inv_receiver_in_scope(v_receiver, v_org, v_m.country, v_m.site) then
    raise exception 'The receiver must be an active person of your company with access to this site.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p->>'material_issue_line_id', '')), '') is not null then
    begin
      select * into v_line from public.material_issue_lines where id = (p->>'material_issue_line_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'material_issue_line_id must be an id.' using errcode = '22023';
    end;
    if v_line.id is null or v_line.movement_id is distinct from v_m.id then
      raise exception 'That slip line was not posted as this issue.' using errcode = '22023';
    end if;
  end if;

  select mm.item_code, coalesce(mm.item_name, mm.item_code), mm.uom into v_code, v_desc, v_uom
    from public.material_master mm where mm.id = v_m.item_id;
  select nullif(btrim(full_name), '') into v_name from public.profiles where id = v_receiver;

  begin
    insert into public.stock_issue_receipts (organisation_id, country, site, movement_id, material_issue_line_id,
      job_card_no, item_id, item_code, item_description, qty, uom, issued_by, requested_by, receiver_user_id,
      receiver_name, idempotency_key)
    values (v_org, v_m.country, v_m.site, v_m.id, v_line.id,
      case when v_m.source_doc_type = 'job_card' then v_m.source_doc_id end,
      v_m.item_id, coalesce(v_code, v_line.item_code), coalesce(v_desc, v_m.description, v_line.item_description),
      -v_m.qty_change, coalesce(v_uom, v_line.uom), v_m.actor_id, v_uid, v_receiver, v_name, v_key)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'A receiver is already named for this issue.' using errcode = 'PT409';
  end;

  perform public.record_audit_event('ISSUE_RECEIPT_REQUEST', 'stock_issue_receipts', v_row.id::text, null, to_jsonb(v_row));
  v_res := jsonb_build_object('status', 'pending', 'id', v_row.id, 'movement_id', v_m.id,
    'receiver_user_id', v_receiver, 'receiver_name', v_name);
  return public._inv_req_end('inv_issue_receipt_request', p, v_res);
end
$$;

-- The receiver acknowledges (or disputes) in their own session. No stock rights needed.
create or replace function public.inv_issue_receipt_ack(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.app_current_org();
  v_decision text := lower(btrim(coalesce(p_payload->>'decision', 'acknowledge')));
  v_note text := left(nullif(btrim(coalesce(p_payload->>'note', '')), ''), 500);
  v_old public.stock_issue_receipts%rowtype;
  v_new public.stock_issue_receipts%rowtype;
begin
  if v_uid is null or v_org is null or not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if v_decision not in ('acknowledge', 'dispute') then
    raise exception 'decision must be acknowledge or dispute.' using errcode = '22023';
  end if;
  if v_decision = 'dispute' and v_note is null then
    raise exception 'Say what is wrong with the parts you received.' using errcode = '22023';
  end if;
  begin
    select * into v_old from public.stock_issue_receipts
     where id = nullif(btrim(coalesce(p_payload->>'receipt_id', '')), '')::uuid and organisation_id = v_org for update;
  exception when invalid_text_representation then
    raise exception 'receipt_id must be an id.' using errcode = '22023';
  end;
  if v_old.id is null or v_old.receiver_user_id is distinct from v_uid then
    raise exception 'Only the named receiver can confirm these parts.' using errcode = '42501';
  end if;
  if v_old.status is distinct from 'pending' then
    raise exception 'You already answered this handover (%).', v_old.status using errcode = 'PT409';
  end if;
  update public.stock_issue_receipts
     set status = case when v_decision = 'dispute' then 'disputed' else 'acknowledged' end,
         decided_at = now(), decision_note = v_note
   where id = v_old.id
  returning * into v_new;
  perform public.record_audit_event('ISSUE_RECEIPT_' || upper(v_new.status), 'stock_issue_receipts', v_new.id::text,
    to_jsonb(v_old), to_jsonb(v_new));
  return jsonb_build_object('status', v_new.status, 'id', v_new.id, 'decided_at', v_new.decided_at);
end
$$;

revoke all on function public.inv_issue_receipt_request(jsonb) from public;
revoke all on function public.inv_issue_receipt_request(jsonb) from anon;
revoke all on function public.inv_issue_receipt_ack(jsonb) from public;
revoke all on function public.inv_issue_receipt_ack(jsonb) from anon;
grant execute on function public.inv_issue_receipt_request(jsonb), public.inv_issue_receipt_ack(jsonb)
  to authenticated, service_role;

commit;

-- Rollback is manual and needs the owner's OK (no other object references these):
-- the two inv_issue_receipt_* functions, _inv_receiver_in_scope and the table.

-- ── Rolled-back proof, 2026-11-28 (live DB, one DO block ending in RAISE; afterwards the table
--    and functions are absent, material_issues 0, movements 5,876, audit rows 0)
-- 0 real slip posted by _inv_issue_slip as a Store Keeper: issue -2 against GCKR/JC/1332/0526.
-- 1 Store Keeper names a Plant Mechanic: pending, job card + qty 2 + slip line linked, audit +1.
-- 2 same key, same payload: replayed, still 1 row.     3 same key, other receiver: PT409.
-- 4 second request for the same issue, new key: PT409.  5 receiver = issuer: 22023.
-- 6 receiver in another company: 22023.  7 receiver with no site scope (Driver): 22023.
-- 8 a receipt movement: 22023.  9 Driver requests: 42501.
-- 10 another mechanic acknowledges: 42501.
-- 11 RLS: another mechanic reads 0 rows, the named receiver reads 1; direct insert 42501,
--    direct update 42501.
-- 12 dispute without a note: 22023.
-- 13 the named receiver (no stock rights: inv_can('issue') = false) acknowledges: acknowledged.
-- 14 repeat: PT409.   15 audit rows for the record: 2 (request + acknowledge).
