-- The archive is an internal source for server-side stamping. Review clients
-- consume the immutable copy on checklist_submissions and do not need direct
-- GraphQL access to all template revisions.
drop policy if exists checklist_template_revisions_read
  on public.checklist_template_revisions;
revoke select on public.checklist_template_revisions from authenticated;
