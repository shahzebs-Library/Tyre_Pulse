-- Enable pgvector if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge documents table (SOPs, manuals, policies, reports)
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title       text NOT NULL,
  content     text NOT NULL,
  doc_type    text NOT NULL CHECK (doc_type IN ('SOP','Manual','Policy','Report','Inspection','Note','History')),
  tags        text[] DEFAULT '{}',
  site        text,
  asset_no    text,
  source_ref  text,
  embedding   vector(1536),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Inspection comment embeddings (for semantic search on findings)
CREATE TABLE IF NOT EXISTS inspection_embeddings (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id  uuid REFERENCES inspections(id) ON DELETE CASCADE,
  asset_no       text,
  site           text,
  content        text NOT NULL,
  embedding      vector(1536),
  created_at     timestamptz DEFAULT now()
);

-- Tyre record comment embeddings
CREATE TABLE IF NOT EXISTS tyre_record_embeddings (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id      uuid REFERENCES tyre_records(id) ON DELETE CASCADE,
  asset_no       text,
  site           text,
  content        text NOT NULL,
  embedding      vector(1536),
  created_at     timestamptz DEFAULT now()
);

-- Indexes for vector similarity search
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_embedding
  ON knowledge_documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_inspection_embeddings_embedding
  ON inspection_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_tyre_record_embeddings_embedding
  ON tyre_record_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_doc_type ON knowledge_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_site ON knowledge_documents(site);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_asset_no ON knowledge_documents(asset_no);

-- RLS
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tyre_record_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_documents_select" ON knowledge_documents;
DROP POLICY IF EXISTS "knowledge_documents_write" ON knowledge_documents;
DROP POLICY IF EXISTS "inspection_embeddings_select" ON inspection_embeddings;
DROP POLICY IF EXISTS "tyre_record_embeddings_select" ON tyre_record_embeddings;

CREATE POLICY "knowledge_documents_select" ON knowledge_documents
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "knowledge_documents_write" ON knowledge_documents
  FOR ALL TO authenticated
  USING (get_my_role() = 'Admin')
  WITH CHECK (get_my_role() = 'Admin');

CREATE POLICY "inspection_embeddings_select" ON inspection_embeddings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tyre_record_embeddings_select" ON tyre_record_embeddings
  FOR SELECT TO authenticated USING (true);

-- Similarity search function for knowledge documents
CREATE OR REPLACE FUNCTION match_knowledge_documents(
  query_embedding vector(1536),
  match_count     int DEFAULT 5,
  filter_doc_type text DEFAULT NULL,
  filter_site     text DEFAULT NULL
)
RETURNS TABLE (
  id         uuid,
  title      text,
  content    text,
  doc_type   text,
  site       text,
  asset_no   text,
  tags       text[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kd.id,
    kd.title,
    kd.content,
    kd.doc_type,
    kd.site,
    kd.asset_no,
    kd.tags,
    1 - (kd.embedding <=> query_embedding) AS similarity
  FROM knowledge_documents kd
  WHERE kd.embedding IS NOT NULL
    AND (filter_doc_type IS NULL OR kd.doc_type = filter_doc_type)
    AND (filter_site IS NULL OR kd.site = filter_site OR kd.site IS NULL)
  ORDER BY kd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Similarity search for inspection findings
CREATE OR REPLACE FUNCTION match_inspection_findings(
  query_embedding vector(1536),
  match_count     int DEFAULT 10,
  filter_site     text DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  inspection_id  uuid,
  asset_no       text,
  site           text,
  content        text,
  similarity     float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ie.id,
    ie.inspection_id,
    ie.asset_no,
    ie.site,
    ie.content,
    1 - (ie.embedding <=> query_embedding) AS similarity
  FROM inspection_embeddings ie
  WHERE ie.embedding IS NOT NULL
    AND (filter_site IS NULL OR ie.site = filter_site)
  ORDER BY ie.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- updated_at trigger for knowledge_documents
DROP TRIGGER IF EXISTS set_updated_at_knowledge_documents ON knowledge_documents;
CREATE TRIGGER set_updated_at_knowledge_documents
  BEFORE UPDATE ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
