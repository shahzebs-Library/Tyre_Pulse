-- ============================================================================
-- MIGRATIONS_V99_AI_CONVERSATIONS.sql
-- Phase 16 (roadmap): server-side AI copilot memory.
--
-- Until now copilot memory was the last 4 turns held in client state and lost
-- on refresh. These tables give the `ai-orchestrator` edge function durable,
-- org-scoped conversations:
--   * ai_conversations — one per chat thread (owner = user).
--   * ai_messages — full turn history incl. tool calls; the orchestrator
--     replays the recent window as model context.
--
-- Writes happen through the orchestrator (service role) and the owning user;
-- RLS keeps every thread private to its owner.
--
-- Rollback:
--   DROP TABLE public.ai_messages;
--   DROP TABLE public.ai_conversations;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organisation_id uuid DEFAULT public.app_current_org(),
  title           text,
  agent           text,                          -- analyst | tyre_engineer | qa_data | planner | auto
  archived        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON public.ai_conversations (user_id, archived, updated_at DESC);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_conversations_own ON public.ai_conversations;
CREATE POLICY ai_conversations_own ON public.ai_conversations
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant','tool')),
  content         text NOT NULL,
  tool_name       text,
  tokens_in       int,
  tokens_out      int,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON public.ai_messages (conversation_id, id);

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_messages_own ON public.ai_messages;
CREATE POLICY ai_messages_own ON public.ai_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_conversations c
                  WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS ai_messages_insert_own ON public.ai_messages;
CREATE POLICY ai_messages_insert_own ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_conversations c
                       WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())));

COMMENT ON TABLE public.ai_conversations IS
  'Durable copilot chat threads (owner-private). Written by the ai-orchestrator edge function and the owning user.';
