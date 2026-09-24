-- =============================================================================
-- Access Review (periodic access recertification) - ISO 27001 A.5.18 / A.8.2,
-- SOC 2 CC6.
--
-- STATUS: APPLIED LIVE 2026-09-24 via Supabase MCP (migration name
--         access_reviews), project jhssdmeruxtrlqnwfksc.
--
-- WHAT: a super admin starts a campaign that SNAPSHOTS every approved profile
-- (role, super-admin flag, countries, sites, approved, locked, per-user grants,
-- last sign-in from auth.users) so the evidence reflects what was reviewed,
-- records keep / revoke / modify per user (revoke REQUIRES a reason), then
-- applies: every revoked user is LOCKED (profiles.locked = true), an
-- access_audit row is written per lock, and the campaign is closed with a
-- summary. Deciding never changes access by itself; only apply does.
--
-- SECURITY: tables RLS on, super-admin SELECT only, no client writes (all
-- writes via SECURITY DEFINER RPCs that refuse non super admins with 42501),
-- anon has no table grant and no EXECUTE. Grant order: revoke PUBLIC, revoke
-- anon by name, grant authenticated (V500 lesson).
-- guard_profile_privileged_cols admits a super admin, so apply does NOT need to
-- disable trg_guard_profile_privileged. guard_last_admin still refuses locking
-- the last super admin / last org Admin; the per-item exception handler records
-- that as "refused: ..." instead of aborting the batch. The caller can never
-- lock themselves.
--
-- VERIFIED (one DO block, forced rollback, impersonating super admin
-- d2d43a5f-...): start snapshotted 726 items (144 with a sign-in, 5 with
-- grants); revoke without note refused; list/get OK; apply locked the target
-- Manager (1 access_audit row) and refused the caller's own item; deciding
-- after close refused. As Manager ecdcdb9e-...: list/start/decide/apply/get all
-- refused 42501, direct SELECT on campaigns returned 0. After rollback: 0
-- campaigns, 0 items, 0 audit rows, Manager still unlocked. anon EXECUTE false
-- on all 6 functions, anon SELECT false on both tables.
--
-- ROLLBACK:
--   drop function if exists public.admin_get_access_review(uuid);
--   drop function if exists public.admin_list_access_reviews();
--   drop function if exists public.admin_apply_access_review(uuid);
--   drop function if exists public.admin_decide_access_item(uuid, text, text);
--   drop function if exists public.admin_start_access_review(text, timestamptz);
--   drop function if exists public._access_review_require_super();
--   drop table if exists public.access_review_items;
--   drop table if exists public.access_review_campaigns;
--   (Locks already applied are ordinary profiles.locked values; unlock via the
--    console Users page. access_audit rows are the evidence and stay.)
-- =============================================================================

-- Tables ---------------------------------------------------------------------
create table if not exists public.access_review_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  scope       jsonb not null default '{"population":"approved_profiles"}'::jsonb,
  status      text not null default 'open' check (status in ('draft','open','closed')),
  due_at      timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid,
  summary     jsonb
);

create table if not exists public.access_review_items (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.access_review_campaigns(id) on delete cascade,
  user_id         uuid not null,
  user_email      text,
  full_name       text,
  role            text,
  is_super_admin  boolean not null default false,
  country         text[],
  sites           text[],
  approved        boolean,
  locked          boolean,
  grants          jsonb not null default '[]'::jsonb,
  last_sign_in_at timestamptz,
  decision        text not null default 'pending' check (decision in ('pending','keep','revoke','modify')),
  decision_note   text,
  decided_by      uuid,
  decided_at      timestamptz,
  apply_result    text,
  applied_at      timestamptz,
  constraint access_review_items_revoke_note check (decision <> 'revoke' or length(btrim(coalesce(decision_note,''))) > 0),
  unique (campaign_id, user_id)
);
create index if not exists access_review_items_campaign_idx on public.access_review_items (campaign_id, decision);
create index if not exists access_review_campaigns_created_idx on public.access_review_campaigns (created_at desc);

alter table public.access_review_campaigns enable row level security;
alter table public.access_review_items     enable row level security;

drop policy if exists access_review_campaigns_super_read on public.access_review_campaigns;
create policy access_review_campaigns_super_read on public.access_review_campaigns
  for select to authenticated using ((select public.is_super_admin()));
drop policy if exists access_review_items_super_read on public.access_review_items;
create policy access_review_items_super_read on public.access_review_items
  for select to authenticated using ((select public.is_super_admin()));

revoke all on public.access_review_campaigns from anon, public;
revoke all on public.access_review_items     from anon, public;
revoke insert, update, delete, truncate, trigger, references on public.access_review_campaigns from authenticated;
revoke insert, update, delete, truncate, trigger, references on public.access_review_items     from authenticated;
grant select on public.access_review_campaigns to authenticated;
grant select on public.access_review_items     to authenticated;

-- Helper: refuse anyone who is not a super admin ------------------------------
create or replace function public._access_review_require_super()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can run access reviews.' using errcode = '42501';
  end if;
end $$;

-- Start: snapshot every approved profile ------------------------------------
create or replace function public.admin_start_access_review(p_name text, p_due_at timestamptz default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_n int;
begin
  perform public._access_review_require_super();
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'A campaign name is required.' using errcode = '22023';
  end if;
  if p_due_at is not null and p_due_at < now() - interval '1 day' then
    raise exception 'The due date cannot be in the past.' using errcode = '22023';
  end if;

  insert into public.access_review_campaigns (name, due_at, created_by, status, scope)
  values (btrim(p_name), p_due_at, auth.uid(), 'open',
          jsonb_build_object('population','approved_profiles','snapshot_at', now()))
  returning id into v_id;

  insert into public.access_review_items
    (campaign_id, user_id, user_email, full_name, role, is_super_admin, country, sites,
     approved, locked, grants, last_sign_in_at)
  select v_id, p.id, coalesce(p.email, u.email), p.full_name, p.role, coalesce(p.is_super_admin,false),
         p.country, p.sites, p.approved, p.locked,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'module_key', g.module_key, 'capability', g.capability, 'effect', g.effect,
                     'expires_at', g.expires_at, 'note', g.note) order by g.module_key)
                   from public.user_access_grants g where g.user_id = p.id), '[]'::jsonb),
         u.last_sign_in_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where coalesce(p.approved, false) = true;

  get diagnostics v_n = row_count;
  update public.access_review_campaigns
     set scope = scope || jsonb_build_object('users', v_n)
   where id = v_id;
  return v_id;
end $$;

-- Decide one item -----------------------------------------------------------
create or replace function public.admin_decide_access_item(p_item uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_status text; v_dec text := lower(btrim(coalesce(p_decision,'')));
begin
  perform public._access_review_require_super();
  if v_dec not in ('pending','keep','revoke','modify') then
    raise exception 'Decision must be keep, revoke, modify or pending.' using errcode = '22023';
  end if;
  if v_dec = 'revoke' and length(btrim(coalesce(p_note,''))) = 0 then
    raise exception 'A revoke decision needs a reason.' using errcode = '22023';
  end if;
  select c.status into v_status
    from public.access_review_items i join public.access_review_campaigns c on c.id = i.campaign_id
   where i.id = p_item;
  if v_status is null then
    raise exception 'Review item not found.' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'This review is closed; decisions can no longer change.' using errcode = '22023';
  end if;
  update public.access_review_items
     set decision = v_dec,
         decision_note = nullif(btrim(coalesce(p_note,'')), ''),
         decided_by = case when v_dec = 'pending' then null else auth.uid() end,
         decided_at = case when v_dec = 'pending' then null else now() end
   where id = p_item;
  return jsonb_build_object('ok', true, 'item', p_item, 'decision', v_dec);
end $$;

-- Apply: lock revoked users, close the campaign -----------------------------
create or replace function public.admin_apply_access_review(p_campaign uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_status text; r record; v_results jsonb := '[]'::jsonb; v_res text;
  v_summary jsonb; v_actor uuid := auth.uid(); v_actor_email text;
begin
  perform public._access_review_require_super();
  select status into v_status from public.access_review_campaigns where id = p_campaign for update;
  if v_status is null then raise exception 'Review not found.' using errcode = 'P0002'; end if;
  if v_status <> 'open' then raise exception 'This review is already closed.' using errcode = '22023'; end if;
  select email into v_actor_email from public.profiles where id = v_actor;

  for r in select * from public.access_review_items
            where campaign_id = p_campaign and decision = 'revoke' order by full_name loop
    if r.user_id = v_actor then
      v_res := 'refused: you cannot lock your own account';
    else
      begin
        update public.profiles set locked = true where id = r.user_id and coalesce(locked,false) = false;
        if found then
          v_res := 'locked';
          insert into public.access_audit (actor, actor_email, action, target_user, entity, before, after, reason)
          values (v_actor, v_actor_email, 'access_review_revoke', r.user_id, 'profiles',
                  jsonb_build_object('locked', false),
                  jsonb_build_object('locked', true, 'campaign_id', p_campaign, 'item_id', r.id),
                  r.decision_note);
        elsif exists (select 1 from public.profiles where id = r.user_id) then
          v_res := 'already locked';
        else
          v_res := 'user no longer exists';
        end if;
      exception when others then
        v_res := 'refused: ' || sqlerrm;
      end;
    end if;
    update public.access_review_items set apply_result = v_res, applied_at = now() where id = r.id;
    v_results := v_results || jsonb_build_object('item', r.id, 'user_id', r.user_id, 'result', v_res);
  end loop;

  select jsonb_build_object(
           'total',    count(*),
           'kept',     count(*) filter (where decision = 'keep'),
           'revoked',  count(*) filter (where decision = 'revoke'),
           'modified', count(*) filter (where decision = 'modify'),
           'pending',  count(*) filter (where decision = 'pending'),
           'locked',   count(*) filter (where apply_result = 'locked'),
           'refused',  count(*) filter (where apply_result like 'refused%'))
    into v_summary from public.access_review_items where campaign_id = p_campaign;

  update public.access_review_campaigns
     set status = 'closed', closed_at = now(), closed_by = v_actor, summary = v_summary
   where id = p_campaign;

  return jsonb_build_object('ok', true, 'summary', v_summary, 'results', v_results);
end $$;

-- Reads ----------------------------------------------------------------------
create or replace function public.admin_list_access_reviews()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._access_review_require_super();
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object(
             'total',    (select count(*) from public.access_review_items i where i.campaign_id = c.id),
             'pending',  (select count(*) from public.access_review_items i where i.campaign_id = c.id and i.decision = 'pending'),
             'kept',     (select count(*) from public.access_review_items i where i.campaign_id = c.id and i.decision = 'keep'),
             'revoked',  (select count(*) from public.access_review_items i where i.campaign_id = c.id and i.decision = 'revoke'),
             'modified', (select count(*) from public.access_review_items i where i.campaign_id = c.id and i.decision = 'modify'),
             'created_by_email', (select email from public.profiles p where p.id = c.created_by),
             'closed_by_email',  (select email from public.profiles p where p.id = c.closed_by))
           order by c.created_at desc)
    from public.access_review_campaigns c), '[]'::jsonb);
end $$;

create or replace function public.admin_get_access_review(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c jsonb;
begin
  perform public._access_review_require_super();
  select to_jsonb(c) || jsonb_build_object(
           'created_by_email', (select email from public.profiles p where p.id = c.created_by),
           'closed_by_email',  (select email from public.profiles p where p.id = c.closed_by))
    into v_c from public.access_review_campaigns c where c.id = p_campaign;
  if v_c is null then raise exception 'Review not found.' using errcode = 'P0002'; end if;
  return jsonb_build_object('campaign', v_c, 'items', coalesce((
    select jsonb_agg(to_jsonb(i) || jsonb_build_object(
             'decided_by_email', (select email from public.profiles p where p.id = i.decided_by))
           order by i.full_name nulls last, i.user_email)
    from public.access_review_items i where i.campaign_id = p_campaign), '[]'::jsonb));
end $$;

-- Grants: PUBLIC first, then anon by name, then authenticated ----------------
revoke execute on function public._access_review_require_super() from public;
revoke execute on function public._access_review_require_super() from anon;
revoke execute on function public._access_review_require_super() from authenticated;
revoke execute on function public.admin_start_access_review(text, timestamptz) from public;
revoke execute on function public.admin_start_access_review(text, timestamptz) from anon;
revoke execute on function public.admin_decide_access_item(uuid, text, text) from public;
revoke execute on function public.admin_decide_access_item(uuid, text, text) from anon;
revoke execute on function public.admin_apply_access_review(uuid) from public;
revoke execute on function public.admin_apply_access_review(uuid) from anon;
revoke execute on function public.admin_list_access_reviews() from public;
revoke execute on function public.admin_list_access_reviews() from anon;
revoke execute on function public.admin_get_access_review(uuid) from public;
revoke execute on function public.admin_get_access_review(uuid) from anon;
grant execute on function public.admin_start_access_review(text, timestamptz) to authenticated, service_role;
grant execute on function public.admin_decide_access_item(uuid, text, text)   to authenticated, service_role;
grant execute on function public.admin_apply_access_review(uuid)             to authenticated, service_role;
grant execute on function public.admin_list_access_reviews()                 to authenticated, service_role;
grant execute on function public.admin_get_access_review(uuid)               to authenticated, service_role;
