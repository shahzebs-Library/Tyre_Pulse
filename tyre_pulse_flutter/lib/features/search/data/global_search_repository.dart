/// One search term, resolved against four separate tables through four
/// separate, already-verified lookups - never one raw client-side scan of
/// everything.
///
/// # Which identifier type resolves through which existing mechanism
///
/// This is the reuse mandate this feature was built under, stated as a
/// table so the mapping cannot drift out of the code that implements it:
///
/// - **Asset number, registration, chassis number, fleet number** ->
///   [CacheDao.searchAssets], scoped by a [WorkspaceScopeFilter] the
///   caller resolves via `vehicleCacheScopeFor` exactly the way
///   `features/assets/presentation/vehicle_fleet_providers.dart` already
///   does for every other asset read. `CachedAssets`' own `LIKE` predicate
///   already covers all four columns in one indexed local read (with one
///   addition made to that DAO as part of this feature - see
///   `core/database/dao/cache_dao.dart`'s own doc comment on
///   `searchAssets` for the `fleetNumber` gap it closed).
/// - **Tyre serial** -> [TyreLookupRepository.lookupBySerial], unchanged.
///   That repository already normalises a scanned or typed serial and
///   relies on server-side RLS rather than a client scope, so this file
///   asks nothing extra of it.
/// - **Work order number** -> a scoped read of [SupabaseTables.workOrders]
///   decoded through the WORK-ORDERS feature's OWN, already-verified
///   [WorkOrderItem.fromRow] and [workOrderListColumns] (imported
///   read-only; this file does not own or duplicate that decoder).
///   [WorkOrderRepository] itself exposes no lookup by the human-readable
///   `work_order_no` - only `listRecent` and a lookup by the server row
///   id - so this is the one identifier type with no existing repository
///   method to reuse outright; the query below reuses everything ELSE
///   that repository already established (the verified table constant,
///   the verified column list, the verified row decoder) and adds only
///   the one missing predicate.
/// - **Inspection reference** -> [InspectionRemoteRepository.byId]. An
///   inspection carries no separate human-readable reference field
///   anywhere in [InspectionRecord] - `id` (the server row uuid) is the
///   only identifier an inspection has, so "inspection reference" can
///   only mean that id. [isUuidLike] gates the attempt so a plainly
///   non-uuid term is never sent to a `.eq('id', ...)` filter, which
///   would otherwise raise a real PostgREST error rather than answering
///   "no matches" - see `domain/search_identifiers.dart`'s own reasoning.
///
/// Accident reference is deliberately ABSENT from this file. No Flutter
/// accidents feature or repository exists yet in this port; a bespoke
/// direct query against the `accidents` table here would be exactly the
/// kind of ad hoc, unverified access this project's rules forbid (a
/// control that does something the rest of the codebase has not signed
/// off on is worse than a control that plainly does nothing yet) - see
/// this feature's own top-level report for the explicit statement of that
/// omission.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart' show CachedAsset;
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/search/domain/search_identifiers.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';
import 'package:tyre_pulse/features/tyres/data/tyre_lookup_repository.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_serial_code.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';

/// How many rows a single identifier-type lookup returns at most. A search
/// box is not a report - past this many matches the honest answer is "type
/// more", not a silently truncated wall of rows.
const int _resultLimit = 20;

/// The narrow surface the global search feature needs from each of the
/// four data sources it fans out to.
abstract interface class GlobalSearchRepository {
  /// Matches [term] against asset number, registration, chassis number and
  /// fleet number in one pass. [scope] is resolved by the caller from the
  /// active [WorkspaceContext] via `vehicleCacheScopeFor` - a null scope
  /// (no signed-in workspace) answers an empty list rather than throwing,
  /// mirroring how every other asset read in this project degrades.
  Future<List<AssetSearchResult>> searchAssets(
    String term, {
    required WorkspaceScopeFilter? scope,
  });

  /// Matches [term] as a tyre serial via the existing, unmodified
  /// [TyreLookupRepository.lookupBySerial].
  Future<List<TyreSearchResult>> searchTyres(String term);

  /// Matches [term] against `work_orders.work_order_no`.
  Future<List<WorkOrderSearchResult>> searchWorkOrders(String term);

  /// Matches [term] as an inspection's server row id, only when [term]
  /// has the shape of one - see [isUuidLike].
  Future<List<InspectionSearchResult>> searchInspections(String term);
}

/// The real implementation, composing three already-verified data sources
/// plus one small scoped read this file owns outright (work orders).
final class SupabaseGlobalSearchRepository
    with SupabaseGateway
    implements GlobalSearchRepository {
  SupabaseGlobalSearchRepository({
    required SupabaseClient client,
    required CacheDao cacheDao,
    required TyreLookupRepository tyreLookupRepository,
    required InspectionRemoteRepository inspectionRemoteRepository,
  })  : _client = client,
        _cacheDao = cacheDao,
        _tyres = tyreLookupRepository,
        _inspections = inspectionRemoteRepository;

  /// The test seam: [searchAssets], [searchTyres] and [searchInspections]
  /// can all be exercised with no [SupabaseClient] at all, for the same
  /// reason `SupabaseTyreLookupRepository.withRpcCaller` exists in the
  /// tyres feature - see that file's own library comment on why its
  /// `supabase_flutter` query-builder calls cannot be verified against the
  /// real SDK in an environment with no Flutter toolchain. Only
  /// [searchWorkOrders] genuinely needs a client (it is the one identifier
  /// type with no existing repository method to delegate to - see this
  /// file's own library comment); a test that never calls it may build a
  /// repository through this constructor and supply none.
  SupabaseGlobalSearchRepository.withoutClient({
    required CacheDao cacheDao,
    required TyreLookupRepository tyreLookupRepository,
    required InspectionRemoteRepository inspectionRemoteRepository,
  })  : _client = null,
        _cacheDao = cacheDao,
        _tyres = tyreLookupRepository,
        _inspections = inspectionRemoteRepository;

  final SupabaseClient? _client;
  final CacheDao _cacheDao;
  final TyreLookupRepository _tyres;
  final InspectionRemoteRepository _inspections;

  /// Reads [_client], failing with a clear message rather than a null
  /// dereference when this repository was built via [.withoutClient] and
  /// the caller reaches the one method that actually needs it.
  SupabaseClient _requireClient(String forMethod) {
    final SupabaseClient? client = _client;
    if (client == null) {
      throw StateError(
        '$forMethod needs a SupabaseClient, but this repository was built '
        'with .withoutClient and no client was supplied.',
      );
    }
    return client;
  }

  @override
  Future<List<AssetSearchResult>> searchAssets(
    String term, {
    required WorkspaceScopeFilter? scope,
  }) async {
    final String trimmed = term.trim();
    if (trimmed.isEmpty || scope == null) {
      return const <AssetSearchResult>[];
    }

    final List<CachedAsset> rows = await _cacheDao.searchAssets(
      scope: scope,
      term: trimmed,
      limit: _resultLimit,
    );

    return rows
        .map(
          (CachedAsset row) => AssetSearchResult(
            assetNo: row.assetNo,
            registrationNo: row.registrationNo,
            chassisNo: row.chassisNo,
            fleetNumber: row.fleetNumber,
            site: row.site,
            vehicleType: row.vehicleType,
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<List<TyreSearchResult>> searchTyres(String term) async {
    final String trimmed = term.trim();
    if (trimmed.isEmpty) return const <TyreSearchResult>[];

    final TyreLookupRecord? record = await _tyres.lookupBySerial(trimmed);
    if (record == null) return const <TyreSearchResult>[];

    // lookupBySerial does not echo the serial back on the row (it never
    // needed to - its own caller already knows what it typed), so the
    // displayed serial is the same normalisation the lookup itself applies
    // to the raw term, not a value read off the response.
    final String displaySerial = sanitizeSerial(extractScanCode(trimmed));
    return <TyreSearchResult>[
      TyreSearchResult(
        serialNo: displaySerial.isEmpty ? trimmed : displaySerial,
        assetNo: record.assetNo,
        position: record.bestPosition,
        brand: record.brand,
        size: record.size,
      ),
    ];
  }

  @override
  Future<List<WorkOrderSearchResult>> searchWorkOrders(String term) async {
    final String trimmed = term.trim();
    if (trimmed.isEmpty) return const <WorkOrderSearchResult>[];

    final SupabaseClient client = _requireClient('searchWorkOrders');
    final String pattern = '%${escapeLikePattern(trimmed)}%';
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      final List<Map<String, dynamic>> result = await client
          .from(SupabaseTables.workOrders)
          .select(workOrderListColumns)
          .ilike('work_order_no', pattern)
          .limit(_resultLimit);
      return result;
    });

    return rows
        .map((Map<String, dynamic> row) => WorkOrderItem.fromRow(row))
        .map(
          (WorkOrderItem item) => WorkOrderSearchResult(
            id: item.id,
            workOrderNo: item.workOrderNo,
            assetNo: item.assetNo,
            status: item.status,
            workType: item.workType,
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<List<InspectionSearchResult>> searchInspections(String term) async {
    final String trimmed = term.trim();
    if (!isUuidLike(trimmed)) return const <InspectionSearchResult>[];

    // InspectionRemoteRepository.byId already wraps its own call through
    // SupabaseGateway - a second guard() here would double-wrap the same
    // failure rather than add anything, so this calls straight through,
    // matching how `SerialSearchController.search` calls
    // `TyreLookupRepository.lookupBySerial` directly for the same reason.
    final InspectionRecord? record = await _inspections.byId(trimmed);
    if (record == null) return const <InspectionSearchResult>[];

    return <InspectionSearchResult>[
      InspectionSearchResult(
        id: record.id,
        assetNo: record.assetNo,
        site: record.site,
        status: record.status,
        inspectionDate: record.inspectionDate,
      ),
    ];
  }
}
