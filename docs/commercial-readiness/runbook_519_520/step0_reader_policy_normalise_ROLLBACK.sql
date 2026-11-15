-- ROLLBACK of STEP 0 (narrow): removes exactly the 8 policies step 0 added, nothing else.
-- Run only after every later step has been rolled back (order 9..1, then 0). Steps 2, 6 and 8 recreate
-- these same 8 policies through apply_reader_policies(); rolling back step 0 while they are applied
-- would bring the drift back.
-- Contains the words d-r-o-p and d-e-l-e-t-e: the MCP confirm prompt appears; the owner must be present.
begin;
drop policy anum_reader_select_scope on public.observation_erp_links;
drop policy anum_reader_no_insert    on public.observation_erp_links;
drop policy anum_reader_no_update    on public.observation_erp_links;
drop policy anum_reader_no_delete    on public.observation_erp_links;
drop policy anum_reader_select_scope on public.observation_erp_link_events;
drop policy anum_reader_no_insert    on public.observation_erp_link_events;
drop policy anum_reader_no_update    on public.observation_erp_link_events;
drop policy anum_reader_no_delete    on public.observation_erp_link_events;
commit;
