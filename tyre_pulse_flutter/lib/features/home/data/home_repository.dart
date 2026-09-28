/// Home's two data sources: the device's own inspection drafts and a small,
/// bounded set of server reads.
///
/// Every remote call below is PostgREST on `inspections`, a table the
/// production app already reads (artifact 02 section 2; registered as
/// `SupabaseTables.inspections`). No RPC, no new table (AGENTS.md rule 3).
///
/// - [HomeRemoteRepository.pendingInspectionApprovals]: an exact head count of
///   `approval_status = 'pending_approval'` plus the newest `created_at`, so
///   Home never reports a bounded page length as the queue size.
/// - [HomeRemoteRepository.recentInspectedAssets]: the signed-in user's own
///   inspections (`created_by`, the column `inspection_payload.dart` writes and
///   `MIGRATIONS_V21.sql` indexes), newest first.
///
/// The local half, [HomeDraftSource], watches the Drift draft store so a
/// draft that is submitted or discarded elsewhere disappears from Home
/// without Home having to be rebuilt.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';

/// The columns [recentAssetsFromInspections] reads. One constant so the query
/// and the mapper cannot drift apart.
const String homeRecentInspectionColumns =
    'id, asset_no, vehicle_type, site, inspection_date, created_at, '
    'tyre_conditions';

/// How many recent inspection rows are read to find distinct assets. A few
/// times the strip's six cards, so a person who inspected one machine five
/// times today still sees their other recent machines.
const int homeRecentInspectionScanLimit = 40;

/// The `.or(...)` country convenience filter: the active country plus rows
/// with no country, which the RESTRICTIVE country RLS shows to everyone.
/// Null (no filter) for the all-countries view. RLS remains the boundary.
String? homeCountryFilter(String? country) {
  final String trimmed = country?.trim() ?? '';
  if (trimmed.isEmpty || trimmed.toLowerCase() == 'all') return null;
  return 'country.eq.$trimmed,country.is.null';
}

abstract interface class HomeRemoteRepository {
  Future<HomePendingApprovals> pendingInspectionApprovals({String? country});

  Future<List<HomeRecentAsset>> recentInspectedAssets({
    required String userId,
    String? country,
  });
}

final class SupabaseHomeRemoteRepository
    with SupabaseGateway
    implements HomeRemoteRepository {
  SupabaseHomeRemoteRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<HomePendingApprovals> pendingInspectionApprovals({
    String? country,
  }) async {
    final String? filter = homeCountryFilter(country);

    Future<int> count() => guard<int>(() async {
          var query = _client
              .from(SupabaseTables.inspections)
              .count()
              .eq('approval_status', 'pending_approval');
          if (filter != null) query = query.or(filter);
          return await query;
        });

    Future<List<Map<String, dynamic>>> newest() =>
        guard<List<Map<String, dynamic>>>(() async {
          var query = _client
              .from(SupabaseTables.inspections)
              .select('created_at')
              .eq('approval_status', 'pending_approval');
          if (filter != null) query = query.or(filter);
          return await query.order('created_at', ascending: false).limit(1);
        });

    final (int total, List<Map<String, dynamic>> rows) =
        await (count(), newest()).wait;
    final DateTime? newestAt = rows.isEmpty
        ? null
        : DateTime.tryParse(rows.first['created_at'] as String? ?? '');
    return HomePendingApprovals(count: total, newestAt: newestAt);
  }

  @override
  Future<List<HomeRecentAsset>> recentInspectedAssets({
    required String userId,
    String? country,
  }) async {
    if (userId.trim().isEmpty) return const <HomeRecentAsset>[];
    final String? filter = homeCountryFilter(country);
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      var query = _client
          .from(SupabaseTables.inspections)
          .select(homeRecentInspectionColumns)
          .eq('created_by', userId);
      if (filter != null) query = query.or(filter);
      return await query
          .order('inspection_date', ascending: false)
          .order('created_at', ascending: false)
          .limit(homeRecentInspectionScanLimit);
    });
    return recentAssetsFromInspections(rows);
  }
}

/// The newest unfinished inspection draft for one user, as a live stream.
final class HomeDraftSource {
  const HomeDraftSource(this._db);

  final AppDatabase _db;

  /// Emits the newest draft that (a) belongs to [userId] in one of
  /// [workspaceIds], (b) matches [activeCountry], (c) names an asset, and
  /// (d) has real content - progress, a photo or a signature - the same test
  /// the inspection wizard's own resume list applies (`hasContent`), so a
  /// draft holding only photos still shows. Null when none qualifies.
  Stream<InspectionDraftSummary?> watchLatest({
    required String userId,
    required Set<String> workspaceIds,
    String? activeCountry,
  }) {
    return _db.draftsDao
        .watchInspectionDraftsForUser(
      userId: userId,
      workspaceIds: workspaceIds,
    )
        .asyncMap((List<InspectionDraft> rows) async {
      for (final InspectionDraft row in rows) {
        if (row.assetNo.trim().isEmpty) continue;
        if (!draftMatchesActiveCountry(
          draftCountry: row.country,
          activeCountry: activeCountry,
        )) {
          continue;
        }
        final bool hasContent = await _db.draftsDao.draftHasContent(
          ownerKind: OwnerKind.inspectionDraft,
          ownerKey: row.draftKey,
          filled: row.filled,
        );
        if (!hasContent) continue;
        return InspectionDraftSummary(
          draftKey: row.draftKey,
          assetNo: row.assetNo,
          site: row.site,
          vehicleType: row.vehicleType,
          filled: row.filled,
          total: row.total,
          updatedAt: row.updatedAt,
        );
      }
      return null;
    });
  }
}
