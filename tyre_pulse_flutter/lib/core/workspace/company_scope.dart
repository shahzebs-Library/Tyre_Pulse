/// Company scope for list and count reads.
///
/// An ordinary user only ever sees their own company: restrictive RLS on
/// `organisation_id` is the boundary. A super admin's reads span EVERY
/// company, so an unpinned list (accidents, the fleet register, approval
/// queues, Home counts) mixes another company's rows - a demo company's
/// `DEMO-PL01` accident in the real accident register - into the user's own.
///
/// Every list/count read therefore also pins `organisation_id` to the
/// caller's ACTIVE company. This is a narrowing only: RLS still decides
/// what the caller may read, and a missing or malformed company id leaves
/// the query unchanged (never a wider read, never a blank screen).
///
/// Mirrors the web `pinCompany` in `src/lib/api/companyScope.js`.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';

final RegExp _uuid = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

/// True for a well-formed uuid string.
bool isCompanyId(String? value) =>
    value != null && _uuid.hasMatch(value.trim());

/// The company the caller's data rows carry: `profiles.organisation_id`
/// ([WorkspaceContext.companyId]), falling back to `profiles.org_id`
/// ([WorkspaceContext.tenantId]) - the two agree on every healthy profile
/// (V311). Null when neither is a real company id.
String? activeCompanyIdFor(WorkspaceContext? workspace) {
  for (final String? candidate in <String?>[
    workspace?.companyId,
    workspace?.tenantId,
  ]) {
    if (isCompanyId(candidate)) return candidate!.trim();
  }
  return null;
}

/// Narrows [query] to [companyId] when it is a real company id; otherwise
/// returns it unchanged.
PostgrestFilterBuilder<T> pinCompany<T>(
  PostgrestFilterBuilder<T> query,
  String? companyId,
) =>
    isCompanyId(companyId)
        ? query.eq('organisation_id', companyId!.trim())
        : query;
