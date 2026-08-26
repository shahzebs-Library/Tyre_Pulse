/// The fleet register: paged remote reads, an offline-cached fallback, and
/// the pure filters the vehicles screens apply over whatever they loaded.
///
/// # Shape, and why it looks like `auth_profile_repository.dart`
///
/// This file follows the SAME pattern that lane already established for "a
/// PostgREST read with an offline-cache fallback": a narrow interface
/// ([VehicleFleetSource]) the orchestration depends on, a real
/// `with SupabaseGateway` implementation over that interface
/// ([SupabaseVehicleFleetSource]), and an orchestrating repository that never
/// throws - every outcome, including a failure, is a value a caller can
/// switch over. Two repositories built the same way cannot quietly diverge
/// on what "offline" means.
///
/// The interface exists for exactly the reason `AuthRepository` and
/// `ProfileRepository` are interfaces rather than the Supabase-backed class
/// itself: it lets the PAGING loop and the CACHE-fallback ordering be
/// exercised with a plain Dart fake that has never heard of
/// `supabase_flutter`, in an environment with no Flutter SDK installed to
/// compile-check a mock of the real builder chain against. See
/// `SupabaseVehicleFleetSource`'s own comment for what is, and is not,
/// verified about it.
///
/// # Never destructive toward the shared cache
///
/// `CacheDao.replaceAssets` DELETES a whole workspace+country slice of
/// `cached_assets` before inserting the rows it was given. This repository
/// selects only sixteen columns (matching the production screen exactly, per
/// AGENTS.md rule 4), while `cached_assets` also carries `chassis_no`,
/// `serial_no` and `ops_status` - columns another feature (scanning, tyre
/// lookup) may have populated for its own offline fallback. Calling
/// `replaceAssets` here would silently erase those richer rows the moment
/// this screen loaded, for a feature this file does not own and a table it
/// only READS. So this repository never writes to [CacheDao] at all: it
/// reads whatever a sync populated, and reports honestly when there is
/// nothing to read.
library;

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/assets/domain/asset_classes.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

// ---------------------------------------------------------------------------
// Paging - pure, no Supabase type in its signature
// ---------------------------------------------------------------------------

/// One assembled read: every row a paged fetch produced, plus whether the
/// cap was hit.
@immutable
class PagedRows<T> {
  const PagedRows({required this.rows, required this.truncated});

  final List<T> rows;

  /// True when the read stopped because it reached the row cap, not because
  /// the server confirmed there was nothing more. `cache_dao.dart`'s own rule
  /// for exactly this flag: "must be told the truth... a silently short list
  /// reads to a user as 'that asset was never created'." The production
  /// TypeScript `fetchAllRows` this loop is ported from has no such flag and
  /// silently caps - this is a deliberate improvement, not a straight port,
  /// made because the flag already exists as a first-class concept
  /// elsewhere in this Flutter codebase and dropping it here would be the
  /// one place that regresses it.
  final bool truncated;
}

/// Assembles every row of a PostgREST-backed table by walking `.range()`
/// pages.
///
/// PostgREST caps any single response at 1000 rows regardless of what a
/// `.limit()` on the query itself asks for - artifact 01 rule 5.19 and
/// `mobile/lib/fetchAllRows.ts`, which this is a direct port of. This
/// function never imports a Supabase type: [fetchPage] is a plain callback,
/// so the loop itself - the exact-multiple boundary, the short-page stop,
/// the [maxRows] cap, and the honest [PagedRows.truncated] flag - is
/// testable with a fake that has never heard of `supabase_flutter`.
///
/// [fetchPage] MUST already be ordered on a genuinely unique column, or a
/// compound tiebreak that is unique. `asset_no` alone is unique only per
/// country, not globally (artifact 01, section 2.6), so ordering on it
/// without an `id` tiebreak drops or repeats rows at a page boundary - that
/// is the caller's responsibility, because only the caller knows the shape
/// of its own query.
///
/// [pageSize] is clamped to `1..1000`: passing anything above 1000 asks the
/// server for more than it will ever return in one response, which would
/// make [PagedRows.truncated] compare a real page against a size the server
/// can never satisfy.
///
/// `truncated` is decided against the ACTUAL window size requested, not the
/// nominal [pageSize]. When [maxRows] is not an exact multiple of
/// [pageSize], the final window is narrower than [pageSize] by construction,
/// and a page that exactly fills a narrowed window is not evidence the data
/// ends there - only a page that comes back SHORT of what was actually asked
/// for is.
Future<PagedRows<T>> fetchAllPages<T>(
  Future<List<T>> Function(int from, int to) fetchPage, {
  int pageSize = 1000,
  int maxRows = 5000,
}) async {
  final int boundedPageSize = pageSize < 1
      ? 1
      : (pageSize > 1000 ? 1000 : pageSize);
  final int cap = maxRows < boundedPageSize ? boundedPageSize : maxRows;

  final List<T> rows = <T>[];
  for (int from = 0; from < cap; from += boundedPageSize) {
    final int windowEnd =
        (from + boundedPageSize > cap) ? cap : from + boundedPageSize;
    final int windowSize = windowEnd - from;

    final List<T> page = await fetchPage(from, windowEnd - 1);
    rows.addAll(page);

    if (page.length < windowSize) {
      return PagedRows<T>(rows: List<T>.unmodifiable(rows), truncated: false);
    }
  }
  return PagedRows<T>(rows: List<T>.unmodifiable(rows), truncated: true);
}

// ---------------------------------------------------------------------------
// The remote source
// ---------------------------------------------------------------------------

/// The exact columns the production vehicles screen reads. Kept as one
/// constant so the query and [VehicleAsset.fromRow] cannot silently drift
/// apart - the same discipline `auth_profile_repository.dart` applies to
/// `_profileColumns`.
const String vehicleFleetColumns = 'id, asset_no, fleet_number, make, '
    'model, vehicle_type, site, status, operator_name, tyre_size, '
    'current_km, country, department, region, registration_no, year';

/// The narrow surface [VehicleFleetRepository] needs from the remote fleet
/// register. See the library comment for why this exists as an interface
/// rather than [VehicleFleetRepository] depending on [SupabaseClient]
/// directly.
abstract interface class VehicleFleetSource {
  /// One page of `vehicle_fleet`, ordered by `asset_no` then `id` (the
  /// unique tiebreak [fetchAllPages] requires) and scoped null-safely to
  /// [country] when it is not null. [from]/[to] are inclusive PostgREST
  /// range bounds. Never throws a raw Supabase exception - the real
  /// implementation reclassifies it via [SupabaseGateway.guard].
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  });

  /// One row matching [assetNo] exactly, scoped the same way. Null is a
  /// legitimate outcome ("this asset does not exist in this scope"), never
  /// an error.
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
  });
}

/// The real implementation, over a live [SupabaseClient].
///
/// # Verification, per AGENTS.md rule 3
///
/// `SupabaseTables.vehicleFleet` is the already-verified table name (network
/// lane). [vehicleFleetColumns] is transcribed from the production
/// `mobile/app/(app)/vehicles.tsx` `.select(...)` string verbatim. The
/// `.eq()` / `.or()` / `.order()` / `.range()` / `.limit()` chain mirrors
/// that same screen's query construction, restructured so every FILTER call
/// (`.eq`, `.or`) precedes every TRANSFORM call (`.order`, `.range`,
/// `.limit`) - the production RN client tolerates the reverse order because
/// JavaScript's fluent builder is not statically typed there, but this
/// project has no Flutter SDK installed to compile-check whether Dart's
/// typed `postgrest` builder chain would accept the same ordering, so this
/// file takes the ordering that is unambiguously correct in a typed
/// filter-then-transform builder rather than gambling on the looser one.
/// **This class is not exercised by the test suite added alongside it** -
/// see the report accompanying this change for why, and for the same
/// decision already made (and left untested) for
/// `SupabaseAuthRepository`/`SupabaseProfileRepository`.
final class SupabaseVehicleFleetSource
    with SupabaseGateway
    implements VehicleFleetSource {
  SupabaseVehicleFleetSource(this._client);

  final SupabaseClient _client;

  @override
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  }) {
    return guard(() async {
      final query = _client
          .from(SupabaseTables.vehicleFleet)
          .select(vehicleFleetColumns);

      // The country filter is null-safe by construction: a row whose
      // `country` is null belongs to no single country and must be visible
      // under every country's view. A strict `.eq('country', country)`
      // would hide it - RECORDED as the exact defect that hid 55,606
      // country-less job cards on the web application. See the warning on
      // `WorkspaceContext.filtersByCountry`.
      final List<Map<String, dynamic>> rows = country == null
          ? await query.order('asset_no').order('id').range(from, to)
          : await query
              .or('country.eq.$country,country.is.null')
              .order('asset_no')
              .order('id')
              .range(from, to);
      return rows;
    });
  }

  @override
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
  }) {
    return guard(() async {
      final query = _client
          .from(SupabaseTables.vehicleFleet)
          .select(vehicleFleetColumns)
          .eq('asset_no', assetNo);

      final List<Map<String, dynamic>> rows = country == null
          ? await query.limit(1)
          : await query
              .or('country.eq.$country,country.is.null')
              .limit(1);

      if (rows.isEmpty) {
        return null;
      }
      return rows.first;
    });
  }
}

// ---------------------------------------------------------------------------
// Pure filters
// ---------------------------------------------------------------------------

/// The class-filter sentinel meaning "only classes that carry tyres".
///
/// Ported from the production screen's own `classFilter` state, which
/// defaults to this literal string. Kept as a named constant here rather
/// than the bare string so a comparison against it cannot be mistyped.
const String tyreAssetClassFilter = 'TYRES';

/// Whether [asset] matches a free-text search [term].
///
/// Ported field-for-field from `mobile/app/(app)/vehicles.tsx`'s `shown`
/// filter: asset number, fleet number, make, model, vehicle type, operator,
/// registration and site - eight fields, case-insensitive substring match.
/// An empty or whitespace-only [term] matches every asset, matching the
/// production behaviour of falling back to `classed` when nothing was typed.
bool vehicleMatchesSearch(VehicleAsset asset, String term) {
  final String needle = term.trim().toLowerCase();
  if (needle.isEmpty) {
    return true;
  }
  bool has(String? value) =>
      value != null && value.toLowerCase().contains(needle);
  return has(asset.assetNo) ||
      has(asset.fleetNumber) ||
      has(asset.make) ||
      has(asset.model) ||
      has(asset.vehicleType) ||
      has(asset.operatorName) ||
      has(asset.registrationNo) ||
      has(asset.site);
}

/// The full RN-parity filter pipeline: a free-text [searchTerm], when
/// non-blank, searches the WHOLE list and ignores [assetClassFilter]
/// entirely - a class chip only shapes browsing, per the production
/// screen's own comment, and must never make a real asset unfindable.
/// Otherwise [assetClassFilter] narrows the list: [tyreAssetClassFilter] to
/// tyre-carrying classes, a specific class code to exactly that class, or
/// null for every asset.
List<VehicleAsset> applyVehicleFilters(
  List<VehicleAsset> assets, {
  String? assetClassFilter,
  String searchTerm = '',
}) {
  final String term = searchTerm.trim();
  if (term.isNotEmpty) {
    return assets
        .where((VehicleAsset asset) => vehicleMatchesSearch(asset, term))
        .toList(growable: false);
  }

  if (assetClassFilter == tyreAssetClassFilter) {
    return assets
        .where((VehicleAsset asset) => isTyreAsset(asset.assetNo))
        .toList(growable: false);
  }
  if (assetClassFilter != null) {
    return assets
        .where(
          (VehicleAsset asset) =>
              assetClassOf(asset.assetNo) == assetClassFilter,
        )
        .toList(growable: false);
  }
  return assets;
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/// The result of loading the whole fleet register.
sealed class VehicleFleetListOutcome {
  const VehicleFleetListOutcome();
}

/// A live read succeeded.
final class VehicleFleetListLoaded extends VehicleFleetListOutcome {
  const VehicleFleetListLoaded({required this.assets, required this.truncated});

  final List<VehicleAsset> assets;

  /// See [PagedRows.truncated].
  final bool truncated;
}

/// The live read failed to reach the server, and the on-device cache had a
/// usable copy to fall back to.
final class VehicleFleetListFromCache extends VehicleFleetListOutcome {
  const VehicleFleetListFromCache({required this.assets, this.cachedAt});

  final List<VehicleAsset> assets;

  /// When the cache was last populated by a sync. Null when that timestamp
  /// itself could not be read - the cached rows are still shown, just
  /// without a saved-at label.
  final DateTime? cachedAt;
}

/// Nothing usable could be obtained: the live read failed and there was no
/// usable cache either (or [VehicleFleetRepository] was built with none).
final class VehicleFleetListFailed extends VehicleFleetListOutcome {
  const VehicleFleetListFailed(this.error);

  final AppError error;
}

/// The result of loading one vehicle by its asset number.
sealed class VehicleDetailOutcome {
  const VehicleDetailOutcome();
}

final class VehicleDetailLoaded extends VehicleDetailOutcome {
  const VehicleDetailLoaded(this.asset);

  final VehicleAsset asset;
}

final class VehicleDetailFromCache extends VehicleDetailOutcome {
  const VehicleDetailFromCache({required this.asset, this.cachedAt});

  final VehicleAsset asset;
  final DateTime? cachedAt;
}

/// A genuine "no such row" - the query ran, and matched nothing. Distinct
/// from [VehicleDetailFailed]: this is a fact about the fleet, not a
/// malfunction, and the caller renders it as an empty state rather than an
/// error - mirroring `SupabaseFailure.isNoRowsFound`'s own distinction.
final class VehicleDetailNotFound extends VehicleDetailOutcome {
  const VehicleDetailNotFound();
}

final class VehicleDetailFailed extends VehicleDetailOutcome {
  const VehicleDetailFailed(this.error);

  final AppError error;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/// Resolves the scope a cached read runs under from the active workspace, or
/// null when the workspace cannot yet supply one.
///
/// [WorkspaceContext.companyId] - `profiles.organisation_id`, the column
/// data rows actually carry (see that class's own library comment) - may be
/// null while a profile is still resolving. A null result here means the
/// caller has nothing to scope a cache read by, and must skip the fallback
/// rather than construct a filter that scopes by nothing.
WorkspaceScopeFilter? vehicleCacheScopeFor(WorkspaceContext? workspace) {
  final String? workspaceId = workspace?.companyId;
  if (workspaceId == null) {
    return null;
  }
  return WorkspaceScopeFilter(
    workspaceId: workspaceId,
    country: workspace?.activeCountry,
  );
}

/// The fleet register, front to back: paged remote reads with a read-only
/// offline-cache fallback. Never throws - every method returns a sealed
/// outcome a caller switches over, matching `ProfileRepository`'s own
/// contract.
final class VehicleFleetRepository {
  VehicleFleetRepository(this._source, {CacheDao? cacheDao})
      : _cacheDao = cacheDao;

  final VehicleFleetSource _source;

  /// Read-only. See the library comment for why this repository never
  /// writes to it. Null until a caller wires a real [CacheDao] - see
  /// `vehicleFleetCacheDaoProvider` in
  /// `lib/features/assets/presentation/vehicle_fleet_providers.dart` for the
  /// gap that leaves open today.
  final CacheDao? _cacheDao;

  /// PostgREST's own per-response cap - see [fetchAllPages].
  static const int _pageSize = 1000;

  /// Matches the production screen's own `{ max: 5000 }` bound.
  static const int _maxRows = 5000;

  /// A generous ceiling for the offline-cache fallback read. The cache is
  /// deliberately read WITHOUT the class/search filters applied server-side
  /// - see [applyVehicleFilters] - so it needs enough headroom to return the
  /// whole cached fleet for a country, not merely the first fifty rows
  /// [CacheDao.searchAssets]'s own default would give.
  static const int _cacheReadLimit = 5000;

  /// Loads the whole fleet register for [country] (null for every country
  /// the caller's own scope permits - the server's RLS decides that, this
  /// method adds no further narrowing beyond the null-safe country filter).
  ///
  /// [scope] is used ONLY if the live read fails and a cache fallback is
  /// attempted; build it with [vehicleCacheScopeFor]. Passing null simply
  /// means "no cache fallback is possible" and is safe.
  Future<VehicleFleetListOutcome> loadAll({
    required WorkspaceScopeFilter? scope,
    required String? country,
  }) async {
    try {
      final PagedRows<Map<String, dynamic>> paged =
          await fetchAllPages<Map<String, dynamic>>(
        (int from, int to) =>
            _source.fetchPage(from: from, to: to, country: country),
        pageSize: _pageSize,
        maxRows: _maxRows,
      );
      final List<VehicleAsset> assets =
          paged.rows.map(VehicleAsset.fromRow).toList(growable: false);
      return VehicleFleetListLoaded(assets: assets, truncated: paged.truncated);
    } on AppError catch (error) {
      // Either a row failed to decode (see VehicleAsset.fromRow, always
      // AppErrorKind.validation) or a fake VehicleFleetSource in a test threw
      // an AppError directly rather than something classifySupabaseError
      // would reclassify. Either way, [isBackendUnavailableError] - not a
      // hard-coded false - is what decides whether this is worth a cache
      // fallback: an AppError.network thrown by EITHER path is exactly as
      // much a connectivity failure as one classifySupabaseError produced.
      return await _fallbackOrFail(
        scope,
        error,
        isConnectivity: isBackendUnavailableError(error),
      );
    } on Object catch (error) {
      final SupabaseFailure failure = classifySupabaseError(error);
      return await _fallbackOrFail(
        scope,
        failure.error,
        isConnectivity: failure.isConnectivity,
      );
    }
  }

  Future<VehicleFleetListOutcome> _fallbackOrFail(
    WorkspaceScopeFilter? scope,
    AppError liveError, {
    required bool isConnectivity,
  }) async {
    // Only a connectivity failure falls back to the cache. A permission
    // refusal, a schema mismatch or a validation failure is a fact about
    // THIS read, not about being offline, and showing stale data over one
    // would mask a real problem rather than explain it.
    if (isConnectivity) {
      final VehicleFleetListFromCache? cached = await _readCachedList(scope);
      if (cached != null) {
        return cached;
      }
    }
    return VehicleFleetListFailed(liveError);
  }

  Future<VehicleFleetListFromCache?> _readCachedList(
    WorkspaceScopeFilter? scope,
  ) async {
    final CacheDao? dao = _cacheDao;
    if (dao == null || scope == null) {
      return null;
    }
    try {
      final List<CachedAsset> rows = await dao.searchAssets(
        scope: scope,
        limit: _cacheReadLimit,
      );
      if (rows.isEmpty) {
        return null;
      }
      final DateTime? cachedAt = await dao.cacheLastSyncedAt('cached_assets');
      return VehicleFleetListFromCache(
        assets: rows.map(_fromCachedAsset).toList(growable: false),
        cachedAt: cachedAt,
      );
    } on Object {
      // Best-effort, matching ProfileCache's own contract: a broken cache
      // read must not crash the failure path it exists to soften.
      return null;
    }
  }

  /// Loads one vehicle by its exact `asset_no`.
  ///
  /// A blank [assetNo] is treated as "not found" rather than attempted
  /// against the server - an empty string is not a value anything in
  /// `vehicle_fleet` was ever stamped with, so the round trip could only
  /// ever answer the question this already answers for free.
  Future<VehicleDetailOutcome> byAssetNo({
    required WorkspaceScopeFilter? scope,
    required String assetNo,
    required String? country,
  }) async {
    final String trimmed = assetNo.trim();
    if (trimmed.isEmpty) {
      return const VehicleDetailNotFound();
    }

    try {
      final Map<String, dynamic>? row =
          await _source.fetchByAssetNo(assetNo: trimmed, country: country);
      if (row == null) {
        return const VehicleDetailNotFound();
      }
      return VehicleDetailLoaded(VehicleAsset.fromRow(row));
    } on AppError catch (error) {
      return await _fallbackOrFailDetail(
        scope,
        trimmed,
        error,
        isConnectivity: isBackendUnavailableError(error),
      );
    } on Object catch (error) {
      final SupabaseFailure failure = classifySupabaseError(error);
      return await _fallbackOrFailDetail(
        scope,
        trimmed,
        failure.error,
        isConnectivity: failure.isConnectivity,
      );
    }
  }

  Future<VehicleDetailOutcome> _fallbackOrFailDetail(
    WorkspaceScopeFilter? scope,
    String assetNo,
    AppError liveError, {
    required bool isConnectivity,
  }) async {
    if (isConnectivity) {
      final VehicleDetailFromCache? cached =
          await _readCachedDetail(scope, assetNo);
      if (cached != null) {
        return cached;
      }
    }
    return VehicleDetailFailed(liveError);
  }

  Future<VehicleDetailFromCache?> _readCachedDetail(
    WorkspaceScopeFilter? scope,
    String assetNo,
  ) async {
    final CacheDao? dao = _cacheDao;
    if (dao == null || scope == null) {
      return null;
    }
    try {
      final CachedAsset? row =
          await dao.assetByCode(scope: scope, code: assetNo);
      if (row == null) {
        return null;
      }
      final DateTime? cachedAt = await dao.cacheLastSyncedAt('cached_assets');
      return VehicleDetailFromCache(
        asset: _fromCachedAsset(row),
        cachedAt: cachedAt,
      );
    } on Object {
      return null;
    }
  }

  /// Reshapes a [CachedAsset] into the same [VehicleAsset] the live path
  /// produces.
  ///
  /// `cached_assets` does not carry `operator_name`, `tyre_size`,
  /// `department`, `region` or `year` - see `cache_tables.dart`'s own column
  /// list. Those fields are honestly null on a cached row rather than
  /// invented, and every renderer that shows a [VehicleAsset] already
  /// handles a null field by falling back to the design system's
  /// unmeasured-value placeholder, so this degrades exactly the way a live
  /// row with a genuinely blank column already does.
  VehicleAsset _fromCachedAsset(CachedAsset row) => VehicleAsset(
        id: row.id,
        assetNo: row.assetNo,
        fleetNumber: row.fleetNumber,
        make: row.make,
        model: row.model,
        vehicleType: row.vehicleType,
        site: row.site,
        status: row.status,
        currentKm: row.currentKm,
        country: row.country,
        registrationNo: row.registrationNo,
      );
}
