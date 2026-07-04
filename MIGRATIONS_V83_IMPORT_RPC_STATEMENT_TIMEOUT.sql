-- V83: fix large imports (2k+ rows) failing to commit.
-- The `authenticated` role has statement_timeout=8s. A big batch is committed in
-- ONE row-by-row RPC (import_commit_batch), so anything over a few thousand rows
-- ran past 8s and was killed with "canceling statement due to statement timeout".
-- Give the batch-processing RPCs their own generous timeout — they are
-- SECURITY DEFINER, so this overrides the role default for their execution only.
-- 120s comfortably covers tens of thousands of rows and is still bounded.
ALTER FUNCTION public.import_commit_batch(uuid)  SET statement_timeout TO '120s';
ALTER FUNCTION public.import_enrich_batch(uuid)  SET statement_timeout TO '120s';
ALTER FUNCTION public.import_reverse_batch(uuid) SET statement_timeout TO '120s';
