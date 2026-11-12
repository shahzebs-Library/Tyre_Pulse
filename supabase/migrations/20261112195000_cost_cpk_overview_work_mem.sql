-- get_cost_cpk_overview: enough sort memory to stop spilling (PERF-4)
-- STATUS: APPLIED LIVE 2026-11-12 (schema_migrations 20261112080751).
--
-- MEASURED BEFORE (KSA-only Manager, KSA 2026): shared 83,323, temp 6,582 read + 1,231 written.
-- MEASURED AFTER: shared 83,323, temp 0 (71,416 shared after the same day's VACUUM).
-- Output md5 identical (`generated_at` removed). The setting applies inside this function only;
-- the instance default stays 3.5 MB. Ten pages call this RPC, usually one at a time per user.
--
-- NOT DONE: the audit's summary table. It would put a second cost source beside the expense grid
-- and a trigger on the parts_consumption write path; that is a design decision for the owner.
--
-- ROLLBACK: alter function public.get_cost_cpk_overview(text,text,date,date) reset work_mem;

alter function public.get_cost_cpk_overview(text,text,date,date) set work_mem = '24MB';
