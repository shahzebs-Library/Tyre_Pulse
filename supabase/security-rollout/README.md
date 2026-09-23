# Pending security rollout

These reviewed replacements and explicit SQL migrations are deliberately outside
Supabase's deployment directories. The project has a Git integration for `main`;
pushing client fixes must not change the backend used by installed mobile apps.
The active `supabase/functions/` sources remain at their pre-audit versions.

`npm run test:database` exercises these pending changes in isolated PostgreSQL and
mocked Edge handlers. Passing these tests does not mean production is remediated.

Before a separately authorized backend rollout:

1. Verify current schema, deployment versions and mobile role/capability behavior.
   Test approved field users, read-only users, tenant boundaries and retained
   offline commands. The fleet policies deliberately reject unauthorized writes
   that the existing permissive policy previously accepted.
2. Apply the timestamped migrations here using the migration deployment tool.
   Do not run a database reset. The accident migration is also pending live.
3. Deploy the account-recovery and billing-webhook replacements at their existing
   function names. Use the existing `supabase/functions/_shared/` dependencies
   and original JWT verification settings. Recovery requires its atomic RPC
   migration first; its public request/response contract is unchanged.
4. Verify authentication, recovery and permitted mobile operations with dedicated
   test accounts before considering the rollout complete.

Anonymous `get_email_by_identifier` and `record_login_failure` remain unchanged:
installed clients depend on them. Removing those exposures requires a coordinated
server-verified sign-in flow and client rollout. Existing AI deployment drift is
also unresolved. No production all-clear is implied by this package.
