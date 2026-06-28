-- MIGRATIONS_V35.sql
-- Fix: tables with RLS enabled but ZERO policies were silently returning empty
-- to the app (Stock, Audit Trail, Organisations console, RAG knowledge base).
-- Add least-privilege policies. ai_response_cache / document_chunks /
-- kpi_snapshots intentionally remain policy-less — only edge functions using the
-- service role access them, which bypasses RLS (and is the secure default).
-- Applied on Supabase as `add_rls_policies_blocked_client_tables`.

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select is_super_admin from public.profiles
                   where id = auth.uid() and locked = false), false);
$$;

-- stock: all authenticated read; managers/admin write
drop policy if exists stock_select on public.stock;
create policy stock_select on public.stock for select to authenticated using (true);
drop policy if exists stock_write on public.stock;
create policy stock_write on public.stock for all to authenticated
  using (get_my_role() = any(array['Admin','Manager']))
  with check (get_my_role() = any(array['Admin','Manager']));

-- knowledge_documents: authenticated read (RAG retrieval); managers/admin write
drop policy if exists knowledge_documents_select on public.knowledge_documents;
create policy knowledge_documents_select on public.knowledge_documents for select to authenticated using (true);
drop policy if exists knowledge_documents_write on public.knowledge_documents;
create policy knowledge_documents_write on public.knowledge_documents for all to authenticated
  using (get_my_role() = any(array['Admin','Manager']))
  with check (get_my_role() = any(array['Admin','Manager']));

-- audit_log_v2: any authenticated INSERTs audit events; management/admin read;
-- immutable (no update/delete policy)
drop policy if exists audit_log_v2_insert on public.audit_log_v2;
create policy audit_log_v2_insert on public.audit_log_v2 for insert to authenticated with check (true);
drop policy if exists audit_log_v2_select on public.audit_log_v2;
create policy audit_log_v2_select on public.audit_log_v2 for select to authenticated
  using (get_my_role() = any(array['Admin','Manager','Director']) or is_super_admin());

-- organisations: authenticated read (console pickers); admin/super_admin write
drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations for select to authenticated using (true);
drop policy if exists organisations_write on public.organisations;
create policy organisations_write on public.organisations for all to authenticated
  using (get_my_role() = 'Admin' or is_super_admin())
  with check (get_my_role() = 'Admin' or is_super_admin());
