-- Pin lookup paths for the private, pure approval helpers.
ALTER FUNCTION approval_private.module_keys(text) SET search_path = pg_catalog, public;
ALTER FUNCTION approval_private.work_order_content(jsonb) SET search_path = pg_catalog, public;
ALTER FUNCTION approval_private.source_matches(text,jsonb,jsonb) SET search_path = pg_catalog, public;
