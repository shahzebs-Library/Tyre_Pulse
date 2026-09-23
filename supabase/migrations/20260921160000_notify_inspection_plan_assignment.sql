-- Tell an inspector when work is planned for them.
--
-- WHY. A supervisor could build a schedule, assign it to a named person, and
-- that person was never told. The only trigger on `inspection_schedules` was
-- `updated_at`. The plan existed, the work did not reach the crew, and the
-- adherence board then reported the result as missed.
--
-- IN-APP ONLY, AND THAT IS STATED RATHER THAN GLOSSED. This writes a
-- `notifications` row, which both clients already read - the Flutter inbox
-- streams that table in realtime, so an assignment appears while the app is
-- open and its tap opens My Plans. It does NOT send a device push: the push
-- chain here delivers through the Expo Push API, and the Flutter app carries no
-- push dependency at all (no firebase_messaging in its pubspec). Wiring
-- background delivery for that app is FCM work plus the owner's Firebase
-- credentials, not a line of SQL.
--
-- STATEMENT-LEVEL, NOT PER ROW, and that is the whole design. A plan upload is
-- a batch: the 244-row backlog load would have sent 244 notifications to 18
-- people. One row per assignee per statement, carrying a count, is a message
-- somebody reads; 244 is a reason to turn notifications off.

create or replace function public.notify_inspection_plan_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_single_id uuid;
begin
  -- One notification per assignee for this statement. `count(*)` is what makes
  -- a batch legible: "6 inspections planned for you" rather than six rows.
  --
  -- entity_id is the plan id ONLY when this statement touched exactly one plan
  -- for that person. For a batch it is deliberately null: there is no single
  -- plan the message is about, and an id that names one arbitrary row would
  -- send the reader to the wrong place. The client already treats a null id as
  -- "open the list", which is the honest landing either way.
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    select
      a.assigned_to,
      'plan_assigned',
      case when a.n = 1
           then 'An inspection is planned for you'
           else a.n || ' inspections are planned for you' end,
      case when a.n = 1
           then 'Vehicle ' || coalesce(a.sample_asset, 'unknown')
                || coalesce(' at ' || a.sample_site, '')
                || ' on ' || to_char(a.first_day, 'DD Mon YYYY') || '.'
           else 'Between ' || to_char(a.first_day, 'DD Mon')
                || ' and ' || to_char(a.last_day, 'DD Mon YYYY')
                || '. Open My plans to see them.' end,
      'inspection_plan',
      case when a.n = 1 then a.single_id end
    from (
      select
        n.assigned_to,
        count(*)                                                         as n,
        min(n.scheduled_date)                                            as first_day,
        max(n.scheduled_date)                                            as last_day,
        -- POSTGRES HAS NO min()/max() AGGREGATE FOR uuid. `min(n.id)` raises
        -- 42883, and the fail-safe handler below swallowed it, so the trigger
        -- silently inserted nothing and looked like it had found no assignees.
        -- Take the representative row positionally from an ordered array_agg.
        -- (`min(id::text)::uuid` would work only because uuids happen to render
        -- lowercase canonical - a coincidence, not a contract.)
        (array_agg(n.id order by n.scheduled_date, n.asset_no))[1]       as single_id,
        (array_agg(n.asset_no order by n.scheduled_date, n.asset_no))[1] as sample_asset,
        (array_agg(n.site order by n.scheduled_date, n.asset_no))[1]     as sample_site
      from new_plans n
      where n.assigned_to is not null
        -- A plan created already cancelled is not work anybody should be told
        -- about.
        and lower(coalesce(n.status, '')) <> 'cancelled'
      group by n.assigned_to
    ) a;
  exception when others then
    -- Never let a notification failure block the plan write. A supervisor
    -- losing a whole upload because the inbox insert failed is far worse than
    -- a missing message, and the plan itself is still visible in My plans.
    null;
  end;

  return null;
end;
$$;

comment on function public.notify_inspection_plan_assignment() is
  'Statement-level: one in-app notification per assignee per plan write, aggregated so a batch upload does not send one message per row. Fail-safe - never blocks the write.';

-- INSERT: new plans.
drop trigger if exists trg_notify_plan_assigned_insert on public.inspection_schedules;
create trigger trg_notify_plan_assigned_insert
after insert on public.inspection_schedules
referencing new table as new_plans
for each statement
execute function public.notify_inspection_plan_assignment();

-- REASSIGNMENT: the plan already existed and has changed hands.
--
-- A separate function because the transition table has a different name and,
-- more importantly, because it must notify ONLY the people who did not already
-- have the plan - re-saving a plan for any other reason must not re-notify the
-- same person.
create or replace function public.notify_inspection_plan_reassignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    select
      a.assigned_to,
      'plan_assigned',
      case when a.n = 1
           then 'An inspection was moved to you'
           else a.n || ' inspections were moved to you' end,
      case when a.n = 1
           then 'Vehicle ' || coalesce(a.sample_asset, 'unknown')
                || ' on ' || to_char(a.first_day, 'DD Mon YYYY') || '.'
           else 'Between ' || to_char(a.first_day, 'DD Mon')
                || ' and ' || to_char(a.last_day, 'DD Mon YYYY')
                || '. Open My plans to see them.' end,
      'inspection_plan',
      case when a.n = 1 then a.single_id end
    from (
      select
        n.assigned_to,
        count(*)                                                         as n,
        min(n.scheduled_date)                                            as first_day,
        max(n.scheduled_date)                                            as last_day,
        -- See the insert trigger above: no min()/max() for uuid.
        (array_agg(n.id order by n.scheduled_date, n.asset_no))[1]       as single_id,
        (array_agg(n.asset_no order by n.scheduled_date, n.asset_no))[1] as sample_asset
      from new_plans n
      join old_plans o on o.id = n.id
      where n.assigned_to is not null
        -- The assignee genuinely CHANGED. `is distinct from` rather than <>
        -- because the previous assignee is very often null, and null <> x is
        -- null - which would silently notify nobody on exactly the common case
        -- of filling in an unassigned plan.
        and n.assigned_to is distinct from o.assigned_to
        and lower(coalesce(n.status, '')) <> 'cancelled'
      group by n.assigned_to
    ) a;
  exception when others then
    null;
  end;

  return null;
end;
$$;

comment on function public.notify_inspection_plan_reassignment() is
  'Statement-level: notifies only assignees who did not already hold the plan, so an unrelated edit cannot re-notify. Fail-safe.';

-- Plain AFTER UPDATE, NOT `after update of assigned_to`, for two reasons.
--
-- The first is that Postgres refuses the combination outright: "transition
-- tables cannot be specified for triggers with column lists" (0A000).
--
-- The second is that the column list would have been the wrong tool anyway.
-- `UPDATE OF <col>` fires on the statement's column LIST, not on a value
-- actually changing, and a column set by a BEFORE trigger is not in that list -
-- the same trap already recorded against the accident stage ledger. The real
-- filter is `is distinct from` inside the function, which is precise about the
-- thing that matters: the plan changed hands.
drop trigger if exists trg_notify_plan_assigned_update on public.inspection_schedules;
create trigger trg_notify_plan_assigned_update
after update on public.inspection_schedules
referencing old table as old_plans new table as new_plans
for each statement
execute function public.notify_inspection_plan_reassignment();

-- Rollback:
--   drop trigger if exists trg_notify_plan_assigned_insert on public.inspection_schedules;
--   drop trigger if exists trg_notify_plan_assigned_update on public.inspection_schedules;
--   drop function if exists public.notify_inspection_plan_assignment();
--   drop function if exists public.notify_inspection_plan_reassignment();
