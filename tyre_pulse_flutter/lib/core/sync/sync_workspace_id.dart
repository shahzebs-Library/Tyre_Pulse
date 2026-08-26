/// The offline queue's `workspaceId`, derived from a resolved
/// [WorkspaceContext].
///
/// `pending_commands.workspaceId`
/// (`lib/core/database/tables/queue_tables.dart`) documents itself as "a
/// REFUSAL, not a filter" - a command captured under
/// one workspace must never be pushed under a different one after a
/// workspace switch, because that would be a cross-tenant write. That
/// refusal only means what it says if `workspaceId` names the SAME thing
/// everywhere it is compared.
///
/// `lib/core/database/query_scope.dart`'s [WorkspaceScopeFilter] already
/// establishes what "workspace" means for every CACHED read in this app: its
/// doc comment is explicit that the scope's `workspaceId` is
/// `organisation_id`. This file keeps that meaning for the QUEUE side too -
/// `workspaceId` here is [WorkspaceContext.companyId]
/// (`profiles.organisation_id`, the column data rows carry), never a
/// composite built from country or
/// sites, and never [WorkspaceContext.tenantId] (`profiles.org_id`, the
/// column `app_current_org()` reads) except as a fallback. Country is
/// tracked as its OWN column on `pending_commands` precisely because it is a
/// different, more-frequently-changing dimension than which organisation the
/// user belongs to - conflating the two here would make a country switch
/// look like a workspace switch and block every queued command captured
/// before it.
library;

import 'package:tyre_pulse/core/workspace/workspace_context.dart';

/// The queue's `workspaceId` for [context]: `organisation_id`.
///
/// Prefers [WorkspaceContext.companyId]. Falls back to
/// [WorkspaceContext.tenantId] only when `companyId` is unexpectedly absent -
/// see [WorkspaceProfile.organisationIdIncomplete], which already names that
/// as a data-quality condition elsewhere in this codebase rather than a
/// state this function should refuse to handle. The two columns agree on
/// every healthy profile; a command still deserves to be queued under
/// SOMETHING resolvable while that data-quality condition is being fixed,
/// rather than being refused outright.
///
/// A blank string is treated the same as a missing one, matching the
/// `_stringOrNull` convention `WorkspaceProfile.fromRow` already applies when
/// decoding these same two columns - an empty `organisation_id` is not a
/// workspace, it is an unset one.
///
/// Throws [ArgumentError] when BOTH are absent. Enqueuing a command with no
/// resolvable organisation is a caller bug - nothing may be captured before
/// a workspace exists - not a runtime condition to swallow into an empty
/// string that would then silently satisfy every future `workspaceId`
/// comparison.
String workspaceIdFor(WorkspaceContext context) {
  final String? companyId = _presentOrNull(context.companyId);
  if (companyId != null) {
    return companyId;
  }

  final String? tenantId = _presentOrNull(context.tenantId);
  if (tenantId != null) {
    return tenantId;
  }

  throw ArgumentError.value(
    context,
    'context',
    'has neither companyId (organisation_id) nor tenantId (org_id) set, so '
        'no workspace can be resolved for the offline queue. A command must '
        'not be captured before a workspace exists.',
  );
}

String? _presentOrNull(String? raw) {
  if (raw == null) {
    return null;
  }
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}
