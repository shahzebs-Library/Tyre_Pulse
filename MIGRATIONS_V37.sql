-- MIGRATIONS_V37.sql
-- Admin-only control of country & site assignment.
-- The guard trigger on profiles already blocked non-Admins from changing
-- role/approved/locked/is_super_admin. Country and site are access-control
-- assignments too (they decide what data a user sees and how mobile-created
-- rows are stamped), so a user must not be able to change their own — only an
-- Admin may. Applied on Supabase as `guard_profile_country_site_admin_only`.

create or replace function public.guard_profile_privileged_cols()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
BEGIN
  IF get_my_role() IS DISTINCT FROM 'Admin' THEN
    IF NEW.role           IS DISTINCT FROM OLD.role
       OR NEW.approved    IS DISTINCT FROM OLD.approved
       OR NEW.locked      IS DISTINCT FROM OLD.locked
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
       OR NEW.country     IS DISTINCT FROM OLD.country
       OR NEW.site        IS DISTINCT FROM OLD.site THEN
      RAISE EXCEPTION 'Not authorized to change role, approval, lock, country, or site.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
