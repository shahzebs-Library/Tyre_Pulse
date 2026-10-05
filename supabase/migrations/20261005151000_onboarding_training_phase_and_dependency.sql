-- ============================================================================
-- 20261005151000  onboarding_tasks: Training & UAT phase + task dependency
-- (APPLIED LIVE 2026-10-05 as onboarding_training_phase_and_dependency)
--
-- The owner's Onboarding Wizard mockup shows a "Training & UAT" phase and a
-- "Depends on" column on the activation task board. onboarding_tasks (V199)
-- has neither: its phase CHECK stops at integration/go_live, and there is no
-- link between tasks. This WIDENS the phase CHECK (cannot invalidate a stored
-- row) and adds a nullable self-reference. Existing rows are untouched.
--
-- The page works before apply: it falls back to the base column list when
-- depends_on is missing, and explains a refused 'training' save.
-- Rollback:
--   alter table public.onboarding_tasks drop column if exists depends_on;
--   (re-narrow the CHECK only after moving any 'training' rows to another phase)
-- ============================================================================

alter table public.onboarding_tasks drop constraint if exists onboarding_tasks_phase_check;
alter table public.onboarding_tasks add constraint onboarding_tasks_phase_check
  check (phase in ('setup','data_import','configuration','team','integration','training','go_live'));

alter table public.onboarding_tasks
  add column if not exists depends_on uuid references public.onboarding_tasks(id) on delete set null;

alter table public.onboarding_tasks drop constraint if exists onboarding_tasks_not_self_dependent;
alter table public.onboarding_tasks add constraint onboarding_tasks_not_self_dependent
  check (depends_on is null or depends_on <> id);

create index if not exists idx_onboarding_tasks_depends_on on public.onboarding_tasks (depends_on);

revoke all on public.onboarding_tasks from anon;

-- VERIFY (rolled back): insert a task with phase 'training' -> accepted;
-- update a task set depends_on = id -> refused by onboarding_tasks_not_self_dependent.
