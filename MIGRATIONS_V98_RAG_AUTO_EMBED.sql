-- ============================================================================
-- MIGRATIONS_V98_RAG_AUTO_EMBED.sql
-- Phase 17 (roadmap): close the Knowledge Base RAG gaps left by V51.
--
--  * Chunking: knowledge_documents gains chunk_of / chunk_index so long
--    documents can be split into retrieval-sized chunks (each chunk is its
--    own row + embedding; match_knowledge_documents already returns rows,
--    so retrieval works unchanged). Client chunking lives in
--    src/lib/embeddingService.js.
--  * Auto-embedding: documents inserted WITHOUT an embedding (imports, API,
--    manual adds) no longer wait for a manual "Re-index". A pg_cron job
--    (every 10 min) wakes the `embed-worker` edge function (x-cron-secret
--    gated, service role) which embeds every row where embedding IS NULL.
--    Requires the OPENAI_API_KEY edge secret (same as generate-embedding).
--
-- Depends on: V51 (knowledge_documents, pgvector), V61 (cron_config secret).
--
-- Rollback:
--   SELECT cron.unschedule('embed-knowledge-documents');
--   ALTER TABLE public.knowledge_documents DROP COLUMN chunk_of, DROP COLUMN chunk_index;
-- ============================================================================

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS chunk_of    uuid REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chunk_index int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_chunk_of
  ON public.knowledge_documents (chunk_of) WHERE chunk_of IS NOT NULL;

-- Fast "what still needs embedding" scans for the worker.
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_unembedded
  ON public.knowledge_documents (created_at) WHERE embedding IS NULL;

COMMENT ON COLUMN public.knowledge_documents.chunk_of IS
  'Parent document id when this row is a chunk of a longer document (NULL = standalone doc or parent).';

-- Wake the embed-worker edge function every 10 minutes (V61 cron pattern:
-- public anon bearer for the gateway, real gate is x-cron-secret).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'embed-knowledge-documents') THEN
    PERFORM cron.unschedule('embed-knowledge-documents');
  END IF;
END $$;

SELECT cron.schedule(
  'embed-knowledge-documents',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/embed-worker',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impoc3NkbWVydXh0cmxxbndma3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODYyMzIsImV4cCI6MjA5NjE2MjIzMn0.W18y4ifFRuEkR2-lseAm1cqcnjq-mL4-OtpsgEyzMoM',
      'x-cron-secret', (SELECT value FROM public.cron_config WHERE name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
