-- Applied to the database COPY only (never to staging or production). Synthetic accounts.
-- 1. The synthetic Tyre Man is limited to one site, so "only reports he is authorised to see" can be shown.
-- 2. The Tyre Man role is given the web Inspections module ON THIS COPY. In the staging baseline (and in
--    production today) that module is switched off for the role, so a Tyre Man cannot open the web
--    inspections register at all. The test needs the screen to prove what he would be able to download.
set session_replication_role = replica;
update public.profiles set sites = array['ALPHA EAST PLANT'] where email = 'alpha.tyreman@staging.tyrepulse.invalid';
update public.module_permissions set enabled = true where role = 'Tyre Man' and module_key = 'inspections';
set session_replication_role = origin;
