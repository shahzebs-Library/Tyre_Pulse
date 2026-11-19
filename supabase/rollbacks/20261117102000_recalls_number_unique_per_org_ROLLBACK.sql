-- ROLLBACK for 20261117102000_recalls_number_unique_per_org.sql
-- Valid only while no two companies hold the same recall_number + country (always true
-- while public.recalls is empty, as in production on 2026-11-19: 0 rows).
begin;
alter table public.recalls drop constraint if exists recalls_org_number_country_uniq;
alter table public.recalls add constraint recall_number_country_uniq unique (recall_number, country);
commit;
