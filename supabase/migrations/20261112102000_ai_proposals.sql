-- AI-prepared proposals: findings a deterministic detector prepares and a person decides.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's go-ahead.
--
-- WHAT: public.ai_proposals holds one row per finding (critical inspection finding
-- with no action, repeated failure on one wheel, CPK spike, abnormal monthly
-- consumption, premature removal, warranty opportunity, overdue corrective action,
-- tyre past life with no action, data-integrity issue). The detector is the pure
-- engine src/lib/aiProposals.js; its PROPOSAL_TYPES / SEVERITIES MIRROR the CHECKs
-- below - change both together.
--
-- THE AI NEVER ACTS. It never purchases, edits a source record, approves safety,
-- closes an inspection or submits a warranty claim. Accepting a proposal only
-- records the decision; when the decider asks for it, ONE corrective action is
-- opened through the existing corrective_actions path (source_type 'ai_proposal',
-- source_id = proposal id), which the V20261104090000 sync then mirrors into the
-- Action Center like any other corrective action.
--
-- DEDUPE: (organisation_id, dedupe_key) is unique among OPEN ('proposed') rows.
-- Re-running the scan refreshes an open proposal in place; a key rejected within
-- the last 30 days is not re-proposed (a rejection is a human answer, not noise).
--
-- SECURITY: RLS org RESTRICTIVE (ALL) + country RESTRICTIVE (SELECT, the V396
-- InitPlan form) + active-member SELECT. No client INSERT/UPDATE/DELETE grant:
-- every write goes through the two SECURITY DEFINER RPCs below, which re-check
-- org, country scope and app_is_elevated(). The event history is append-only
-- (trigger refuses UPDATE/DELETE; no client write grant).
-- Errors use PT409 (never 40001 - PostgREST retries 40001 forever).
--
-- VERIFY (each in its own call, rolled back):
--   begin;
--   select set_config('request.jwt.claims', '{"sub":"<elevated user uuid>","role":"authenticated"}', true);
--   set local role authenticated;
--   select public.ai_proposals_record('[{"proposal_type":"overdue_corrective_action","severity":"high",
--     "dedupe_key":"verify:1","title":"t","evidence":[]}]'::jsonb);              -- created 1
--   select public.ai_proposals_record(<same payload>);                          -- created 0, refreshed 0|1
--   select public.ai_proposal_decide((select id from public.ai_proposals where dedupe_key='verify:1'),
--     'accepted', 'ok', true);                                                  -- ok, corrective_action_id set
--   select count(*) from public.corrective_actions where source_type='ai_proposal'; -- 1
--   update public.ai_proposal_events set note='x';                              -- refused
--   rollback;
--   As a Reporter: ai_proposals_record -> {"ok":false,"reason":"forbidden"}.
--
-- ROLLBACK:
--   drop function if exists public.ai_proposal_decide(uuid, text, text, boolean);
--   drop function if exists public.ai_proposals_record(jsonb);
--   drop function if exists public.ai_proposals_expire(integer);
--   drop table if exists public.ai_proposal_events;
--   drop table if exists public.ai_proposals;
--   drop function if exists public.ai_proposals_touch();
--   drop function if exists public.ai_proposal_events_immutable();
--   -- only when no row uses it:
--   alter table public.corrective_actions drop constraint corrective_actions_source_type_chk;
--   alter table public.corrective_actions add constraint corrective_actions_source_type_chk
--     check (source_type in ('manual','inspection','checklist','accident'));

-- 1. corrective_actions may carry an AI-proposal origin (widening only).
alter table public.corrective_actions drop constraint if exists corrective_actions_source_type_chk;
alter table public.corrective_actions add constraint corrective_actions_source_type_chk
  check (source_type in ('manual','inspection','checklist','accident','ai_proposal'));

-- 2. proposals
create table if not exists public.ai_proposals (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null default public.app_current_org(),
  country             text,
  site                text,
  proposal_type       text not null check (proposal_type in (
                        'critical_finding_no_action','repeated_failure','cpk_spike',
                        'abnormal_consumption','premature_removal','warranty_opportunity',
                        'overdue_corrective_action','tyre_overdue_no_action','data_integrity')),
  severity            text not null check (severity in ('critical','high','medium','low')),
  dedupe_key          text not null check (length(dedupe_key) between 1 and 300),
  title               text not null check (length(title) between 1 and 300),
  summary             text,
  recommended_action  text,
  entity_refs         jsonb not null default '{}'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  evidence_total      integer not null default 0,
  metrics             jsonb not null default '{}'::jsonb,
  detector_version    text,
  status              text not null default 'proposed'
                        check (status in ('proposed','accepted','rejected','expired')),
  decided_by          uuid,
  decided_at          timestamptz,
  decision_note       text,
  corrective_action_id uuid references public.corrective_actions(id) on delete set null,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  constraint ai_proposals_decision_chk check (
    (status = 'proposed' and decided_at is null) or
    (status <> 'proposed' and decided_at is not null))
);

create unique index if not exists ux_ai_proposals_open_key
  on public.ai_proposals (organisation_id, dedupe_key) where status = 'proposed';
create index if not exists idx_ai_proposals_org_status
  on public.ai_proposals (organisation_id, status, severity);
create index if not exists idx_ai_proposals_country_status
  on public.ai_proposals (country, status);
create index if not exists idx_ai_proposals_key_decided
  on public.ai_proposals (organisation_id, dedupe_key, decided_at desc) where status <> 'proposed';
create index if not exists idx_ai_proposals_ca
  on public.ai_proposals (corrective_action_id) where corrective_action_id is not null;
create index if not exists idx_ai_proposals_decided_by on public.ai_proposals (decided_by);

create or replace function public.ai_proposals_touch()
 returns trigger language plpgsql set search_path to '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_ai_proposals_touch on public.ai_proposals;
create trigger trg_ai_proposals_touch before update on public.ai_proposals
  for each row execute function public.ai_proposals_touch();

alter table public.ai_proposals enable row level security;

drop policy if exists ai_proposals_org_isolation on public.ai_proposals;
create policy ai_proposals_org_isolation on public.ai_proposals as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

drop policy if exists ai_proposals_country_isolation on public.ai_proposals;
create policy ai_proposals_country_isolation on public.ai_proposals as restrictive for select to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));

drop policy if exists ai_proposals_member_read on public.ai_proposals;
create policy ai_proposals_member_read on public.ai_proposals for select to authenticated
  using ((select public.app_is_active()));

revoke all on public.ai_proposals from anon;
revoke insert, update, delete, truncate, trigger on public.ai_proposals from authenticated;
grant select on public.ai_proposals to authenticated;

-- 3. append-only decision history
create table if not exists public.ai_proposal_events (
  id              bigserial primary key,
  proposal_id     uuid not null references public.ai_proposals(id) on delete cascade,
  organisation_id uuid not null,
  event           text not null check (event in ('created','refreshed','accepted','rejected','expired')),
  actor           uuid,
  note            text,
  detail          jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);
create index if not exists idx_ai_proposal_events_proposal on public.ai_proposal_events (proposal_id, at);
create index if not exists idx_ai_proposal_events_org on public.ai_proposal_events (organisation_id);

create or replace function public.ai_proposal_events_immutable()
 returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception 'Proposal history is append-only' using errcode = '42501';
end $$;
drop trigger if exists trg_ai_proposal_events_immutable on public.ai_proposal_events;
create trigger trg_ai_proposal_events_immutable before update or delete on public.ai_proposal_events
  for each row execute function public.ai_proposal_events_immutable();

alter table public.ai_proposal_events enable row level security;
drop policy if exists ai_proposal_events_org_isolation on public.ai_proposal_events;
create policy ai_proposal_events_org_isolation on public.ai_proposal_events as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
-- An event is visible exactly when its proposal is (inherits proposal RLS).
drop policy if exists ai_proposal_events_read on public.ai_proposal_events;
create policy ai_proposal_events_read on public.ai_proposal_events for select to authenticated
  using (exists (select 1 from public.ai_proposals p where p.id = proposal_id));
revoke all on public.ai_proposal_events from anon;
revoke insert, update, delete, truncate, trigger on public.ai_proposal_events from authenticated;
grant select on public.ai_proposal_events to authenticated;

-- 4. record detector output (insert new, refresh open, skip recently rejected)
create or replace function public.ai_proposals_record(p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  it jsonb;
  v_key text; v_type text; v_sev text; v_country text;
  v_open public.ai_proposals%rowtype;
  v_id uuid;
  v_created int := 0; v_refreshed int := 0; v_skipped int := 0; v_invalid int := 0;
begin
  if v_org is null or not public.app_is_elevated() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if jsonb_array_length(p_items) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  for it in select value from jsonb_array_elements(p_items) loop
    v_key := nullif(btrim(it->>'dedupe_key'), '');
    v_type := it->>'proposal_type';
    v_sev := it->>'severity';
    v_country := nullif(btrim(it->>'country'), '');
    if v_key is null or nullif(btrim(it->>'title'), '') is null
       or v_type not in ('critical_finding_no_action','repeated_failure','cpk_spike',
                         'abnormal_consumption','premature_removal','warranty_opportunity',
                         'overdue_corrective_action','tyre_overdue_no_action','data_integrity')
       or v_sev not in ('critical','high','medium','low') then
      v_invalid := v_invalid + 1; continue;
    end if;
    if v_country is not null and public.app_can_see_country(v_country) is false then
      v_invalid := v_invalid + 1; continue;
    end if;

    select * into v_open from public.ai_proposals
     where organisation_id = v_org and dedupe_key = v_key and status = 'proposed'
     for update;

    if found then
      if v_open.evidence is distinct from coalesce(it->'evidence', '[]'::jsonb)
         or v_open.severity is distinct from v_sev
         or v_open.metrics is distinct from coalesce(it->'metrics', '{}'::jsonb) then
        update public.ai_proposals set
          severity = v_sev,
          title = left(it->>'title', 300),
          summary = left(it->>'summary', 2000),
          recommended_action = left(it->>'recommended_action', 2000),
          entity_refs = coalesce(it->'entity_refs', '{}'::jsonb),
          evidence = coalesce(it->'evidence', '[]'::jsonb),
          evidence_total = coalesce((it->>'evidence_total')::int, 0),
          metrics = coalesce(it->'metrics', '{}'::jsonb),
          detector_version = it->>'detector_version',
          last_seen_at = now()
        where id = v_open.id;
        insert into public.ai_proposal_events (proposal_id, organisation_id, event, actor, detail)
        values (v_open.id, v_org, 'refreshed', v_uid,
                jsonb_build_object('severity', v_sev, 'evidence_total', it->'evidence_total'));
        v_refreshed := v_refreshed + 1;
      else
        update public.ai_proposals set last_seen_at = now() where id = v_open.id;
        v_skipped := v_skipped + 1;
      end if;
      continue;
    end if;

    if exists (select 1 from public.ai_proposals
                where organisation_id = v_org and dedupe_key = v_key
                  and status = 'rejected' and decided_at > now() - interval '30 days') then
      v_skipped := v_skipped + 1; continue;
    end if;

    insert into public.ai_proposals
      (organisation_id, country, site, proposal_type, severity, dedupe_key, title, summary,
       recommended_action, entity_refs, evidence, evidence_total, metrics, detector_version, created_by)
    values
      (v_org, v_country, nullif(btrim(it->>'site'), ''), v_type, v_sev, v_key,
       left(it->>'title', 300), left(it->>'summary', 2000), left(it->>'recommended_action', 2000),
       coalesce(it->'entity_refs', '{}'::jsonb), coalesce(it->'evidence', '[]'::jsonb),
       coalesce((it->>'evidence_total')::int, 0), coalesce(it->'metrics', '{}'::jsonb),
       it->>'detector_version', v_uid)
    returning id into v_id;
    insert into public.ai_proposal_events (proposal_id, organisation_id, event, actor)
    values (v_id, v_org, 'created', v_uid);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('ok', true, 'created', v_created, 'refreshed', v_refreshed,
                            'skipped', v_skipped, 'invalid', v_invalid);
end $$;

-- 5. decide a proposal. Accept never performs the action itself.
create or replace function public.ai_proposal_decide(
  p_id uuid, p_decision text, p_note text default null, p_create_action boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  p public.ai_proposals%rowtype;
  v_ca uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_org is null or not public.app_is_elevated() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_decision not in ('accepted','rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  end if;
  if p_decision = 'rejected' and v_note is null then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;

  select * into p from public.ai_proposals where id = p_id and organisation_id = v_org for update;
  if not found or (p.country is not null and public.app_can_see_country(p.country) is false) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p.status <> 'proposed' then
    raise exception 'This proposal was already %', p.status using errcode = 'PT409';
  end if;

  if p_decision = 'accepted' and coalesce(p_create_action, false) then
    insert into public.corrective_actions
      (organisation_id, title, description, priority, status, site, asset_no, country, region,
       source_type, source_id, source_detail, created_by)
    values
      (v_org,
       left('AI proposal: ' || p.title, 240),
       concat_ws(E'\n', p.summary,
                 case when p.recommended_action is not null then 'Recommended: ' || p.recommended_action end,
                 case when v_note is not null then 'Decision note: ' || v_note end),
       case p.severity when 'critical' then 'High' when 'high' then 'High'
                       when 'medium' then 'Medium' else 'Low' end,
       'Open', p.site, nullif(p.entity_refs->>'asset_no', ''),
       coalesce(p.country, 'KSA'), coalesce(p.country, 'KSA'),
       'ai_proposal', p.id, left(p.dedupe_key, 300), v_uid)
    returning id into v_ca;
  end if;

  update public.ai_proposals set
    status = p_decision, decided_by = v_uid, decided_at = now(),
    decision_note = v_note, corrective_action_id = v_ca
  where id = p.id;

  insert into public.ai_proposal_events (proposal_id, organisation_id, event, actor, note, detail)
  values (p.id, v_org, p_decision, v_uid, v_note,
          jsonb_build_object('corrective_action_id', v_ca, 'created_action', v_ca is not null));

  return jsonb_build_object('ok', true, 'status', p_decision, 'corrective_action_id', v_ca);
end $$;

-- 6. expire open proposals the detector has not seen for a while
create or replace function public.ai_proposals_expire(p_days integer default 30)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_org uuid := public.app_current_org();
  v_n int := 0;
  r record;
begin
  if v_org is null or not public.app_is_elevated() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  for r in select id from public.ai_proposals
            where organisation_id = v_org and status = 'proposed'
              and last_seen_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 7))
            for update loop
    update public.ai_proposals set status = 'expired', decided_at = now() where id = r.id;
    insert into public.ai_proposal_events (proposal_id, organisation_id, event, note)
    values (r.id, v_org, 'expired', 'Not detected for ' || greatest(coalesce(p_days, 30), 7) || ' days');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'expired', v_n);
end $$;

-- Grant order is load-bearing (V500): grant first, then revoke PUBLIC, then anon.
grant execute on function public.ai_proposals_record(jsonb) to authenticated, service_role;
grant execute on function public.ai_proposal_decide(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.ai_proposals_expire(integer) to authenticated, service_role;
revoke all on function public.ai_proposals_record(jsonb) from public;
revoke all on function public.ai_proposal_decide(uuid, text, text, boolean) from public;
revoke all on function public.ai_proposals_expire(integer) from public;
revoke all on function public.ai_proposals_record(jsonb) from anon;
revoke all on function public.ai_proposal_decide(uuid, text, text, boolean) from anon;
revoke all on function public.ai_proposals_expire(integer) from anon;
-- Trigger functions need no EXECUTE grant.
revoke all on function public.ai_proposals_touch() from public, anon, authenticated;
revoke all on function public.ai_proposal_events_immutable() from public, anon, authenticated;

-- Required for every migration that creates a table (owner rule 2026-11-11).
select anum_integration.apply_reader_policies();
