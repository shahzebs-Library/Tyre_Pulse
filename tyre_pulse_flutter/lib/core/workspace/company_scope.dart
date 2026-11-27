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

/// The company list reads are pinned to, or null for no pin.
///
/// Prefers `profiles.org_id` ([WorkspaceContext.tenantId]): that is the
/// column `app_current_org()` reads, i.e. the company the RESTRICTIVE RLS
/// layer already scopes an ordinary user to, so the pin can never show a
/// company RLS would not. Falls back to `profiles.organisation_id`
/// ([WorkspaceContext.companyId]) when org_id is absent.
///
/// When BOTH are real ids and they DISAGREE (the V311 data-quality case,
/// `WorkspaceProfile.organisationIdsDiffer`), no pin is applied: picking one
/// would silently hide the other company's rows, so RLS alone decides.
String? activeCompanyIdFor(WorkspaceContext? workspace) {
  final String? tenant =
      isCompanyId(workspace?.tenantId) ? workspace!.tenantId!.trim() : null;
  final String? company =
      isCompanyId(workspace?.companyId) ? workspace!.companyId!.trim() : null;
  if (tenant != null && company != null && tenant != company) return null;
  return tenant ?? company;
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
