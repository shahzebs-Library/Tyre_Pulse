-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V51 — Knowledge Base / RAG backend provisioning
-- Applied live to project jhssdmeruxtrlqnwfksc on 2026-07-01.
--
-- Reason: the live knowledge_documents table had drifted from the application
-- code. pgvector was not installed, the table lacked an embedding column (and
-- used source_type instead of doc_type/asset_no/tags), and the
-- match_knowledge_documents() RAG function did not exist — so every Knowledge
-- Base upload failed with a 400 and the table stayed empty. This migration
-- rebuilds the table to the exact contract used by:
--   src/pages/KnowledgeBase.jsx, src/lib/embeddingService.js, src/lib/ragService.js
-- The table was empty (0 rows) so the rebuild is non-destructive.
--
-- Post-migration step (cannot be done in SQL): set OPENAI_API_KEY on the
-- generate-embedding edge function, then use "Re-index" on the KB page to
-- populate embeddings. Uploads persist as "Pending" until then.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists vector;

drop table if exists public.knowledge_documents cascade;

create table public.knowledge_documents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content     text not null,
  doc_type    text not null default 'other'
              check (doc_type in ('sop','manual','policy','inspection','rca','vendor','other')),
  site        text,
  asset_no    text,
  country     text,
  tags        text[] not null default '{}',
  embedding   vector(1536),
  organisation_id uuid default app_current_org(),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index knowledge_documents_doc_type_idx on public.knowledge_documents (doc_type);
create index knowledge_documents_site_idx     on public.knowledge_documents (site);
create index knowledge_documents_created_idx   on public.knowledge_documents (created_at desc);
-- Approximate-nearest-neighbour index for cosine similarity search.
create index knowledge_documents_embedding_idx
  on public.knowledge_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create trigger knowledge_documents_set_updated_at
  before update on public.knowledge_documents
  for each row execute function public.set_updated_at();

alter table public.knowledge_documents enable row level security;

create policy knowledge_documents_select
  on public.knowledge_documents for select
  using (true);

create policy knowledge_documents_write
  on public.knowledge_documents for all
  using (get_my_role() = any (array['Admin','Manager']))
  with check (get_my_role() = any (array['Admin','Manager']));

-- RAG vector search RPC consumed by ragService.searchKnowledgeBase().
create or replace function public.match_knowledge_documents(
  query_embedding  vector(1536),
  match_count      int default 5,
  filter_doc_type  text default null,
  filter_site      text default null
)
returns table (
  id         uuid,
  title      text,
  content    text,
  doc_type   text,
  site       text,
  similarity float
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    kd.id,
    kd.title,
    kd.content,
    kd.doc_type,
    kd.site,
    1 - (kd.embedding <=> query_embedding) as similarity
  from public.knowledge_documents kd
  where kd.embedding is not null
    and (filter_doc_type is null or kd.doc_type = filter_doc_type)
    and (filter_site     is null or kd.site     = filter_site)
  order by kd.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_knowledge_documents(vector, int, text, text) to authenticated;
