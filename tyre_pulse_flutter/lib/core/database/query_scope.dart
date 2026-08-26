/// The one place the cache scope predicate is written.
///
/// Artifact 05 section 2.0 requires that EVERY read of cached business data
/// filters on the workspace. Not "usually" - a repository that forgets it
/// returns another tenant's rows, in a picker, with no error and no way to
/// tell.
///
/// The predicate therefore lives in exactly one function. A DAO calls
/// [scopeWhere]; it never writes `workspaceId.equals(...)` itself. If the
/// null-safety rule below ever changes, it changes here and nowhere else.
library;

import 'package:drift/drift.dart';

/// The scope a cached read runs under.
///
/// [country] null means "every country this user may see", which is a real
/// state and not a missing value: a user with no country narrowing is scoped by
/// the workspace alone.
class WorkspaceScopeFilter {
  const WorkspaceScopeFilter({required this.workspaceId, this.country});

  /// `organisation_id`. Always required. There is no unscoped read.
  final String workspaceId;

  /// The active country, or null for all of them.
  final String? country;

  @override
  bool operator ==(Object other) =>
      other is WorkspaceScopeFilter &&
      other.workspaceId == workspaceId &&
      other.country == country;

  @override
  int get hashCode => Object.hash(workspaceId, country);

  @override
  String toString() =>
      'WorkspaceScopeFilter(workspaceId: $workspaceId, country: $country)';
}

/// Builds `workspace_id = ? AND (country = ? OR country IS NULL)`.
///
/// **The country half must be null-safe and this is why.** A strict equality on
/// `country` silently hid 55,606 country-less rows on the web, because a row
/// with no country belongs to no country and therefore matches nobody under
/// `=`. The server's own `applyCountry` treats a null country as visible to
/// everyone, and the local predicate must mirror it or the phone shows a
/// shorter list than the server would - which reads as missing data, not as a
/// filter.
///
/// When [WorkspaceScopeFilter.country] is null the country term is omitted
/// entirely rather than compared to null, because "all countries" is not the
/// same question as "rows with no country".
Expression<bool> scopeWhere(
  WorkspaceScopeFilter scope,
  GeneratedColumn<String> workspaceIdColumn,
  GeneratedColumn<String> countryColumn,
) {
  final Expression<bool> workspaceTerm =
      workspaceIdColumn.equals(scope.workspaceId);

  final String? country = scope.country;
  if (country == null) {
    return workspaceTerm;
  }

  return workspaceTerm &
      (countryColumn.equals(country) | countryColumn.isNull());
}

/// Trims and uppercases a lookup value.
///
/// Used for `assetNoNorm`, `serialNoNorm` and `termNorm`. These are LOOKUP
/// aids: the normalised form never leaves the device. A command always carries
/// the value the server gave us, because the server's own filters are
/// case-sensitive and uppercasing a tyre serial turns a split-history problem
/// into a cannot-find-the-tyre problem in the field.
String normaliseLookupKey(String? raw) => (raw ?? '').trim().toUpperCase();
