-- V66: create the 3 country organisations and let an Admin assign each user to an
-- organisation. app_current_org() reads profiles.org_id, so assignment sets BOTH
-- org_id and organisation_id. A super-admin still sees all orgs (V65); a normal
-- user assigned to an org sees only that org's rows. Verified live: assignment
-- via admin_update_profile(p_org_id) succeeds.
INSERT INTO public.organisations (name, slug, country)
VALUES ('Saudi Arabia (KSA)', 'ksa', 'KSA'),
       ('United Arab Emirates (UAE)', 'uae', 'UAE'),
       ('Egypt', 'egypt', 'Egypt')
ON CONFLICT (slug) DO NOTHING;

-- admin_update_profile extended with p_org_id (Admin-gated; sets org_id +
-- organisation_id; validates the org exists). Full body in the applied migration.
