-- ============================================================================
-- 20261112101000_ai_feedback_loop.sql
-- STATUS: AUTHORED, NOT APPLIED. Owner applies after review.
--
-- Supervised feedback loop for AI Command Center answers. NO online retraining
-- and NO automatic prompt/model promotion: feedback is stored, an expert marks
-- the useful rows as verified, and an OFFLINE evaluation set is built from the
-- verified rows (src/lib/aiEvaluation.js, scripts/ai-eval.mjs).
--
-- Why this migration is needed (measured live 2026-11-10, 0 rows in ai_feedback):
--   1. ai_feedback.message_id is uuid but ai_messages.id is bigint, so a
--      feedback row can never reference the answer it rates.
--   2. ai_feedback_read is `auth.uid() is not null`: every org member can read
--      every other member's corrections. Now: own rows + elevated reviewers.
--   3. ai_feedback_insert does not bind user_id: a member could file feedback
--      as someone else. Now user_id is forced to auth.uid().
--   4. No agent / category / expected answer / expert verification columns, so
--      no evaluation set can be built.
--
-- The question and answer are SNAPSHOTTED by a trigger from ai_messages (which
-- RLS limits to the conversation owner), so a user can only rate their OWN
-- assistant answers and the eval set survives a later conversation delete.
--
-- Verify (rolled back, as a real approved user who owns a conversation):
--   begin; set local role authenticated;
--   select set_config('request.jwt.claims','{"sub":"<user uuid>","role":"authenticated"}',true);
--   insert into ai_feedback (assistant_message_id, rating, correct) values (<own assistant msg id>, 5, true)
--     returning user_id, conversation_id, left(question,40), left(answer,40);   -- expect filled
--   insert into ai_feedback (assistant_message_id, rating) values (<someone else's msg id>, 1); -- expect 42501
--   update ai_feedback set expert_verified = true;                               -- expect 42501 (non-elevated)
--   rollback;
--
-- Rollback:
--   drop trigger if exists trg_ai_feedback_guard on public.ai_feedback;
--   drop function if exists public.ai_feedback_guard();
--   drop policy if exists ai_feedback_select on public.ai_feedback;
--   drop policy if exists ai_feedback_insert_own on public.ai_feedback;
--   drop policy if exists ai_feedback_update_own_or_reviewer on public.ai_feedback;
--   (re-create ai_feedback_read / ai_feedback_insert / ai_feedback_update from V205)
--   alter table public.ai_feedback drop constraint if exists ai_feedback_category_chk,
--     drop constraint if exists ai_feedback_rating_chk,
--     drop constraint if exists ai_feedback_user_message_uq,
--     drop column if exists assistant_message_id, drop column if exists agent,
--     drop column if exists category, drop column if exists question,
--     drop column if exists answer, drop column if exists expected_answer,
--     drop column if exists grounded, drop column if exists coverage,
--     drop column if exists prompt_version, drop column if exists expert_verified,
--     drop column if exists verified_by, drop column if exists verified_at,
--     drop column if exists review_note;
-- ============================================================================

begin;

alter table public.ai_feedback
  add column if not exists assistant_message_id bigint
    references public.ai_messages(id) on delete set null,
  add column if not exists agent           text,
  add column if not exists category        text,
  add column if not exists question        text,
  add column if not exists answer          text,
  add column if not exists expected_answer text,
  add column if not exists grounded        boolean,
  add column if not exists coverage        jsonb,
  add column if not exists prompt_version  text,
  add column if not exists expert_verified boolean not null default false,
  add column if not exists verified_by     uuid,
  add column if not exists verified_at     timestamptz,
  add column if not exists review_note     text;

-- 0 rows live, so these constraints cannot invalidate anything.
alter table public.ai_feedback drop constraint if exists ai_feedback_category_chk;
alter table public.ai_feedback add constraint ai_feedback_category_chk
  check (category is null or category in ('wrong_figure','wrong_cause','missing_data','unsafe','other'));

alter table public.ai_feedback drop constraint if exists ai_feedback_rating_chk;
alter table public.ai_feedback add constraint ai_feedback_rating_chk
  check (rating is null or rating between 1 and 5);

alter table public.ai_feedback drop constraint if exists ai_feedback_text_len_chk;
alter table public.ai_feedback add constraint ai_feedback_text_len_chk
  check (coalesce(length(expected_answer),0) <= 8000 and coalesce(length(note),0) <= 8000
     and coalesce(length(review_note),0) <= 4000 and coalesce(length(agent),0) <= 200);

-- One rating per person per answer (a second press updates it). Plain unique:
-- NULL assistant_message_id rows (manual admin entries) never collide.
alter table public.ai_feedback drop constraint if exists ai_feedback_user_message_uq;
alter table public.ai_feedback add constraint ai_feedback_user_message_uq
  unique (user_id, assistant_message_id);

create index if not exists idx_ai_feedback_org_created
  on public.ai_feedback (organisation_id, created_at desc);
create index if not exists idx_ai_feedback_verified
  on public.ai_feedback (organisation_id, verified_at desc) where expert_verified;
create index if not exists idx_ai_feedback_message
  on public.ai_feedback (assistant_message_id);

-- ── reviewer predicate (no profiles join in policies; uses existing helpers) ──
-- Expert review is limited to Admin / Manager / Director / super admin.
-- OWNER DECISION: widen to a named engineering role if wanted.

create or replace function public.ai_feedback_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reviewer boolean := coalesce(public.get_my_role() in ('Admin','Manager','Director'), false)
                        or coalesce(public.is_super_admin(), false);
  v_conv uuid;
  v_role text;
  v_content text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.user_id := auth.uid();
    end if;
    -- Verification is a separate, reviewer-only step.
    new.expert_verified := false;
    new.verified_by := null;
    new.verified_at := null;
    new.review_note := null;

    if new.assistant_message_id is not null then
      -- ai_messages RLS returns only the caller's own conversations, so "not
      -- found" covers both a wrong id and someone else's answer.
      select m.conversation_id, m.role, m.content
        into v_conv, v_role, v_content
        from public.ai_messages m
       where m.id = new.assistant_message_id;
      if v_conv is null or v_role <> 'assistant' then
        raise exception 'Feedback must reference one of your own assistant answers'
          using errcode = '42501';
      end if;
      new.conversation_id := v_conv;
      new.answer := left(v_content, 12000);
      new.question := (
        select left(u.content, 4000) from public.ai_messages u
         where u.conversation_id = v_conv and u.role = 'user'
           and u.id < new.assistant_message_id
         order by u.id desc limit 1);
    else
      new.answer := null;
      new.question := null;
    end if;
    return new;
  end if;

  -- UPDATE: provenance is immutable.
  if new.user_id is distinct from old.user_id
     or new.organisation_id is distinct from old.organisation_id
     or new.assistant_message_id is distinct from old.assistant_message_id
     or new.conversation_id is distinct from old.conversation_id
     or new.question is distinct from old.question
     or new.answer is distinct from old.answer then
    raise exception 'Feedback provenance cannot be changed' using errcode = '42501';
  end if;

  if (new.expert_verified is distinct from old.expert_verified
      or new.review_note is distinct from old.review_note
      or new.verified_by is distinct from old.verified_by
      or new.verified_at is distinct from old.verified_at)
     and not v_reviewer then
    raise exception 'Only a reviewer can verify feedback' using errcode = '42501';
  end if;

  if new.expert_verified and not old.expert_verified then
    new.verified_by := auth.uid();
    new.verified_at := now();
  elsif not new.expert_verified then
    new.verified_by := null;
    new.verified_at := null;
  else
    new.verified_by := old.verified_by;
    new.verified_at := old.verified_at;
  end if;
  return new;
end;
$$;

revoke all on function public.ai_feedback_guard() from public, anon, authenticated;

drop trigger if exists trg_ai_feedback_guard on public.ai_feedback;
create trigger trg_ai_feedback_guard
  before insert or update on public.ai_feedback
  for each row execute function public.ai_feedback_guard();

-- ── RLS (org isolation RESTRICTIVE and admin delete guard are kept) ──────────
drop policy if exists ai_feedback_read on public.ai_feedback;
drop policy if exists ai_feedback_select on public.ai_feedback;
create policy ai_feedback_select on public.ai_feedback for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.get_my_role()) in ('Admin','Manager','Director')
    or (select public.is_super_admin())
  );

drop policy if exists ai_feedback_insert on public.ai_feedback;
drop policy if exists ai_feedback_insert_own on public.ai_feedback;
create policy ai_feedback_insert_own on public.ai_feedback for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists ai_feedback_update on public.ai_feedback;
drop policy if exists ai_feedback_update_own_or_reviewer on public.ai_feedback;
create policy ai_feedback_update_own_or_reviewer on public.ai_feedback for update to authenticated
  using (
    (user_id = (select auth.uid()) and not expert_verified)
    or (select public.get_my_role()) in ('Admin','Manager','Director')
    or (select public.is_super_admin())
  )
  with check (
    user_id = (select auth.uid())
    or (select public.get_my_role()) in ('Admin','Manager','Director')
    or (select public.is_super_admin())
  );

-- ai_feedback_delete (Admin/Manager/Director) and admin_only_delete_guard stay.
revoke all on public.ai_feedback from anon;

-- Sanity: abort if the reference type does not match.
do $$
begin
  if (select data_type from information_schema.columns
       where table_schema='public' and table_name='ai_feedback'
         and column_name='assistant_message_id') <> 'bigint' then
    raise exception 'assistant_message_id must be bigint to reference ai_messages.id';
  end if;
end $$;

commit;
