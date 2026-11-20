-- Production role model (read from pg_roles / pg_auth_members / pg_db_role_setting, 2026-11-20)
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT;
CREATE ROLE dashboard_user NOLOGIN CREATEROLE CREATEDB REPLICATION;
CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE;
CREATE ROLE supabase_read_only_user LOGIN BYPASSRLS;
CREATE ROLE postgres LOGIN CREATEROLE CREATEDB REPLICATION BYPASSRLS;   -- NOT superuser, as in production
GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role, authenticator TO postgres;
GRANT pg_read_all_data, pg_monitor TO supabase_read_only_user;
GRANT pg_monitor, pg_signal_backend, pg_read_all_data TO postgres;
ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE postgres SET search_path = "$user", public, extensions;
ALTER ROLE supabase_auth_admin SET search_path = auth;
ALTER ROLE supabase_read_only_user SET default_transaction_read_only = on;
ALTER ROLE authenticator SET statement_timeout = '8s';
ALTER ROLE authenticator SET lock_timeout = '8s';
