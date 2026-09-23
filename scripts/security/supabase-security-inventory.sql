-- Read-only Supabase/Postgres security inventory.
-- Run in the SQL editor or with psql against the target environment. This file
-- changes no database state; save/export each result set as release evidence.

-- 1. Data API tables without RLS in commonly exposed schemas.
select n.nspname as schema_name, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname in ('public', 'storage', 'graphql_public')
  and not c.relrowsecurity
order by 1, 2;

-- 2. RLS-enabled tables with no policy (normally inaccessible to API roles).
select n.nspname as schema_name, c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname in ('public', 'storage', 'graphql_public')
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policy p where p.polrelid = c.oid
  )
order by 1, 2;

-- 3. Policy inventory. Review role-only policies and predicates that do not
-- include ownership, organisation, country, site, or another tenant boundary.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage', 'graphql_public')
order by schemaname, tablename, policyname;

-- 4. Views in exposed schemas that do not explicitly use security_invoker.
select n.nspname as schema_name, c.relname as view_name, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v'
  and n.nspname in ('public', 'storage', 'graphql_public')
  and not exists (
    select 1 from pg_options_to_table(c.reloptions) as options
    where options.option_name = 'security_invoker'
      and options.option_value::boolean
  )
order by 1, 2;

-- 5. SECURITY DEFINER functions, pinned search_path, owner, and effective
-- PUBLIC/anon/authenticated execute access. Every returned row needs review.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  owner.rolname as owner,
  p.proconfig as function_settings,
  has_function_privilege('public', p.oid, 'execute') as public_can_execute,
  has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_roles owner on owner.oid = p.proowner
where p.prosecdef
order by 1, 2, 3;

-- 6. SECURITY DEFINER functions with no function-local search_path.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
    where setting like 'search_path=%'
  )
order by 1, 2, 3;

-- 7. Direct table privileges granted to Data API roles. Grants are not row
-- authorization: correlate this list with RLS and policy results above.
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee in ('anon', 'authenticated')
  and table_schema not in ('pg_catalog', 'information_schema')
order by grantee, table_schema, table_name, privilege_type;

-- 8. Functions executable by anon. SECURITY DEFINER rows are highest priority.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and has_function_privilege('anon', p.oid, 'execute')
order by p.prosecdef desc, 1, 2, 3;

-- 9. FORCE RLS status. Table owners bypass ordinary RLS unless FORCE RLS is
-- enabled; use this as an assessment list, not a blanket migration request.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname = 'public'
order by 1, 2;

-- 10. Policies containing authorization anti-patterns. `auth.role()` is
-- deprecated for policy authorization and user_metadata is user-editable.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage', 'graphql_public')
  and (
    coalesce(qual, '') ~* 'auth[.]role\s*[(]'
    or coalesce(with_check, '') ~* 'auth[.]role\s*[(]'
    or coalesce(qual, '') ~* '(raw_)?user_meta_data|user_metadata'
    or coalesce(with_check, '') ~* '(raw_)?user_meta_data|user_metadata'
  )
order by schemaname, tablename, policyname;

-- 11. UPDATE policies without WITH CHECK. A separate SELECT policy is also
-- required for UPDATE; correlate each result with query 3.
select schemaname, tablename, policyname, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'storage', 'graphql_public')
  and cmd in ('UPDATE', 'ALL')
  and with_check is null
order by schemaname, tablename, policyname;

-- 12. Role-only policies. These can be intentional for non-tenant reference
-- data, but on tenant data `TO authenticated` without a row predicate is BOLA.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage', 'graphql_public')
  and ('authenticated' = any(roles) or 'anon' = any(roles))
  and coalesce(qual, 'true') = 'true'
  and coalesce(with_check, 'true') = 'true'
order by schemaname, tablename, policyname;

-- 13. Writable public schemas. Untrusted roles must not be able to create an
-- object that a privileged function could resolve through its search_path.
select n.nspname as schema_name,
       has_schema_privilege('anon', n.oid, 'create') as anon_can_create,
       has_schema_privilege('authenticated', n.oid, 'create') as authenticated_can_create,
       exists (
         select 1
         from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
         where acl.grantee = 0 and acl.privilege_type = 'CREATE'
       ) as public_can_create
from pg_namespace n
where n.nspname in ('public', 'storage', 'graphql_public')
order by 1;

-- 14. Privileged functions whose search_path includes a writable or mutable
-- application schema. Prefer `set search_path = ''` and schema-qualified names.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
    where setting ~* '(^|[=,[:space:]])public([,[:space:]]|$)'
  )
order by 1, 2, 3;

-- 15. Storage buckets and policy coverage. A private bucket still requires
-- appropriate INSERT/SELECT/UPDATE policies for authenticated upsert flows.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

select tablename, cmd, count(*) as policy_count
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
group by tablename, cmd
order by cmd;
