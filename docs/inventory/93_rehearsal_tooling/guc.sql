ALTER SYSTEM SET search_path = "$user", public, extensions;
SELECT pg_reload_conf();
