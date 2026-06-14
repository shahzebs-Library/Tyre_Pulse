-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V23.sql — Security advisor hardening (functions)
--
-- Idempotent, safe to re-run. Addresses Supabase advisor WARNs:
--   1. "Function Search Path Mutable" — pin search_path on the 17 app functions
--      (pgvector extension functions are intentionally left untouched).
--   2. "SECURITY DEFINER / function executable by anon" — revoke EXECUTE from
--      trigger functions (never called directly) and from anon on post-auth RPCs.
--
-- DELIBERATELY PRESERVED:
--   • get_email_by_identifier(text) keeps anon EXECUTE — used pre-auth at login.
--   • get_my_role / get_my_site / is_admin_or_above keep grants — RLS helpers.
--   • get_user_email_by_id keeps grants — used in account flows.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. PIN search_path ON APP FUNCTIONS ────────────────────────────────────────
ALTER FUNCTION public.check_duplicate_serials(text[])                      SET search_path = public, extensions;
ALTER FUNCTION public.count_records_with_extra_fields()                    SET search_path = public, extensions;
ALTER FUNCTION public.get_console_users(uuid, text, integer, integer)      SET search_path = public, extensions;
ALTER FUNCTION public.get_country_kpi(text)                                SET search_path = public, extensions;
ALTER FUNCTION public.get_email_by_identifier(text)                        SET search_path = public, extensions;
ALTER FUNCTION public.get_extra_field_stats(text)                          SET search_path = public, extensions;
ALTER FUNCTION public.normalize_brand(text)                               SET search_path = public, extensions;
ALTER FUNCTION public.normalize_site(text)                                SET search_path = public, extensions;
ALTER FUNCTION public.normalize_country(text)                             SET search_path = public, extensions;
ALTER FUNCTION public.calc_cpk(numeric, numeric, numeric)                 SET search_path = public, extensions;
ALTER FUNCTION public.generate_po_number()                               SET search_path = public, extensions;
ALTER FUNCTION public.generate_work_order_no()                           SET search_path = public, extensions;
ALTER FUNCTION public.set_updated_at()                                   SET search_path = public, extensions;
ALTER FUNCTION public.stamp_reviewed_by()                                SET search_path = public, extensions;
ALTER FUNCTION public.tyre_records_master_process()                      SET search_path = public, extensions;
ALTER FUNCTION public.update_purchase_orders_updated_at()                SET search_path = public, extensions;
ALTER FUNCTION public.update_work_orders_updated_at()                    SET search_path = public, extensions;

-- ── 2. LOCK DOWN TRIGGER / EVENT-TRIGGER FUNCTIONS (never called directly) ──────
REVOKE EXECUTE ON FUNCTION public.set_updated_at()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_reviewed_by()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tyre_records_master_process()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_purchase_orders_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_work_orders_updated_at()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_accident_notifications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_accident_change()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_app_settings_updated_at()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                FROM PUBLIC, anon, authenticated;

-- ── 3. REVOKE anon ON POST-AUTH RPCs (keep authenticated) ──────────────────────
REVOKE EXECUTE ON FUNCTION public.check_duplicate_serials(text[])                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_records_with_extra_fields()               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_console_users(uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_console_stats()                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_country_kpi(text)                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_extra_field_stats(text)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_module_permissions(uuid)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_console_action(text, uuid, text, jsonb)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.normalize_brand(text)                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.normalize_site(text)                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.normalize_country(text)                        FROM PUBLIC, anon;
