/// Reads the tyre records register (`tyre_records`), paged.
///
/// # Parity source and page size
///
/// `mobile/app/(app)/records/index.tsx` is the production screen this ports.
/// Its own comment names the page size directly: `const PAGE = 30`. That
/// number is confirmed independently by
/// `docs/flutter-migration/01-feature-inventory.md` section 2.5 ("Paged
/// tyre list (30/page)"), so it is not a guess - see [kTyreRecordsPageSize]
/// in `../domain/tyre_records_paging.dart`, the single place it is defined.
///
/// # This register is admin-only, and the gate runs before this file is
/// # ever asked for anything
///
/// `core/permissions/module_registry.dart` declares `ModuleKey.records` with
/// `ModuleDef.adminOnly` - a bulk listing with no role default at all. The
/// presentation layer (`tyre_records_list_screen.dart`) checks
/// `moduleAccessProvider(ModuleKey.records)` and returns
/// `TpPermissionDeniedState` WITHOUT ever reading the controller provider
/// when access is denied, and a `NotifierProvider` does not run its `build`
/// - and therefore never calls this repository - until something first
/// reads it. So the gate genuinely runs before any fetch is attempted,
/// rather than merely being checked and then ignored.
///
/// # A page's `hasMore` never depends on an exact total count
///
/// This file deliberately does NOT request `count: 'exact'` from PostgREST.
/// [TyreRecordsPage.hasMore] is derived purely from whether the page came
/// back full (`rows.length == pageSize`), which is the exact signal the
/// production screen itself uses for the same purpose
/// (`setHasMore(rows.length === PAGE)`) - independent of any total count.
/// This was a deliberate choice, not an oversight: this environment has no
/// Flutter SDK or pub cache to check the installed `supabase_flutter:
/// ^2.17.2` / `postgrest` package sources against (see
/// `test/core/network/supabase_gateway_test.dart`'s own note on the same
/// limitation, and `lib/features/tyres/data/tyre_lookup_repository.dart`'s
/// library comment, which records the identical constraint for a sibling
/// repository built in this same environment). No exact-count call appears
/// anywhere else in this codebase to confirm the correct method shape
/// against, so a total-row-count feature was left out rather than guessed
/// at. Every query shape actually used below (`.select().eq().or().order()
/// .range()`, awaited directly to `List<Map<String, dynamic>>`) mirrors a
/// shape [SupabaseTyreLookupRepository] already uses successfully in this
/// same codebase.
///
/// # Why this is an interface with two implementations
///
/// [TyreRecordsRepository] is declared as an `abstract interface class`,
/// the same pattern `ModuleAccessResolver` in `app/router/route_access.dart`
/// uses, so the paging state machine in
/// `../presentation/controllers/tyre_records_list_controller.dart` can be
/// driven end to end by a hand-written fake in tests - proving the "no
/// drops, no duplicates across a page boundary" property with full
/// confidence - without needing a real or mocked [SupabaseClient]. The raw
/// PostgREST query construction in [SupabaseTyreRecordsRepository] itself is
/// NOT independently unit tested in this delivery, for the reason above:
/// [rangeForPage] (the one piece of "does paging work" that is pure
/// arithmetic, with no SDK dependency at all) is exhaustively tested
/// instead.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_page.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_query.dart';
import 'package:tyre_pulse/features/records/domain/tyre_records_paging.dart';
import 'package:tyre_pulse/features/records/domain/tyre_records_search.dart';

/// The columns [TyreRecord.fromRow] reads. Kept as one constant, exactly
/// like `_lookupColumns` in the sibling serial-search repository, so the
/// query and the decoder cannot silently drift apart.
const String _tyreRecordColumns = 'id,asset_no,serial_no,brand,site,'
    'position,tyre_position,issue_date,risk_level,category,cost_per_tyre,'
    'km_at_fitment,km_at_removal,description,remarks,country';

/// The columns the free-text search box matches against. Mirrors the
/// production screen's `orIlike(['asset_no', 'serial_no', 'brand'], ...)`
/// exactly.
const List<String> _searchColumns = <String>['asset_no', 'serial_no', 'brand'];

/// PostgREST's own hard cap on a single response, whatever `.range()` or
/// `.limit()` asks for. [_distinctSiteScanPageSize] must never exceed it.
const int _postgrestMaxRowsPerResponse = 1000;

/// The page size used while scanning for distinct site names.
const int _distinctSiteScanPageSize = _postgrestMaxRowsPerResponse;

/// Ceiling on the distinct-site scan. Ported from the production screen's
/// own `TYRE_SITE_SCAN_CAP`: it sits above the live `tyre_records` row count
/// so the site list is complete today, and bounds the read if the table
/// keeps growing rather than paging it without limit.
const int _distinctSiteScanCap = 40000;

/// The narrow surface the tyre records register needs.
abstract interface class TyreRecordsRepository {
  /// Fetches page [pageIndex] (zero-based) under [query].
  ///
  /// Never returns more than [kTyreRecordsPageSize] rows.
  /// [TyreRecordsPage.hasMore] tells the caller whether another page might
  /// exist - see the library comment for why that is not the same question
  /// as "how many rows are there in total".
  Future<TyreRecordsPage> fetchPage({
    required int pageIndex,
    TyreRecordsQuery query = const TyreRecordsQuery(),
  });

  /// Re-reads one record by its primary key, or null when it no longer
  /// exists (or never did). For a caller that genuinely needs a fresh row -
  /// a deep link into the register, a "this looks stale, reload it" action -
  /// rather than reusing the row the list already holds.
  Future<TyreRecord?> fetchById(String id);

  /// The distinct, non-blank site names to offer in the filter sheet.
  ///
  /// When [restrictToSite] is set, the caller is scoped to exactly one site
  /// and there is nothing further to offer - this returns that one site
  /// without touching the network at all, matching the production screen's
  /// own rule that only an elevated (here: admin-level, or explicitly
  /// granted) reader ever sees the site picker.
  Future<List<String>> fetchDistinctSites({
    String? country,
    String? restrictToSite,
  });
}

/// The real implementation: paged PostgREST reads over `tyre_records`.
final class SupabaseTyreRecordsRepository
    with SupabaseGateway
    implements TyreRecordsRepository {
  SupabaseTyreRecordsRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<TyreRecordsPage> fetchPage({
    required int pageIndex,
    TyreRecordsQuery query = const TyreRecordsQuery(),
  }) {
    return guard<TyreRecordsPage>(() async {
      final ({int from, int to}) range = rangeForPage(pageIndex);

      var builder =
          _client.from(SupabaseTables.tyreRecords).select(_tyreRecordColumns);

      final String? searchOr = orIlikeFilter(_searchColumns, query.search);
      if (searchOr != null) {
        builder = builder.or(searchOr);
      }

      final String? site = query.effectiveSite;
      if (site != null) {
        builder = builder.eq('site', site);
      }

      final String? riskLevel = query.riskLevel;
      if (riskLevel != null) {
        builder = builder.eq('risk_level', riskLevel);
      }

      // Null-safe on purpose: a row whose own `country` is NULL is visible
      // to every country scope by this application's own convention (see
      // `WorkspaceContext.filtersByCountry`'s doc comment), and a plain
      // `.eq('country', ...)` would silently hide it - recorded there as
      // the exact defect that once hid 55,606 country-less job cards from
      // every country view on the web application.
      final String? country = query.country;
      if (country != null) {
        builder = builder.or('country.is.null,country.eq.$country');
      }

      // `issue_date` alone is NOT unique - many tyres share a fitment day -
      // so the production screen's own ordering
      // (`.order('issue_date', { ascending: false })` with no second term)
      // can drop or repeat a row across a page boundary whenever two rows
      // tie on that column. `id` is `tyre_records`' primary key and is
      // therefore globally unique, unlike `asset_no` (unique only per
      // country - artifact 01 section 5.19). Adding it as a second ORDER BY
      // term is a deliberate correctness improvement over the parity
      // source, not a reproduction of it.
      final List<Map<String, dynamic>> rows = await builder
          .order('issue_date', ascending: false)
          .order('id', ascending: false)
          .range(range.from, range.to);

      final List<TyreRecord> items =
          rows.map(TyreRecord.fromRow).toList(growable: false);

      return TyreRecordsPage(
        items: items,
        hasMore: rows.length == kTyreRecordsPageSize,
      );
    });
  }

  @override
  Future<TyreRecord?> fetchById(String id) async {
    final String trimmed = id.trim();
    if (trimmed.isEmpty) {
      return null;
    }
    return guard<TyreRecord?>(() async {
      final Map<String, dynamic>? row = await _client
          .from(SupabaseTables.tyreRecords)
          .select(_tyreRecordColumns)
          .eq('id', trimmed)
          .maybeSingle();
      if (row == null) return null;
      return TyreRecord.fromRow(row);
    });
  }

  @override
  Future<List<String>> fetchDistinctSites({
    String? country,
    String? restrictToSite,
  }) async {
    if (restrictToSite != null) {
      return <String>[restrictToSite];
    }

    return guard<List<String>>(() async {
      final Set<String> seen = <String>{};

      // PAGED and ORDERED with an `id` tiebreak, for the same reason the
      // production screen's `loadSites()` is - the table is well past
      // PostgREST's 1000-row cap and site values repeat heavily, so an
      // unpaged or untiebroken scan returns a DIFFERENT, incomplete subset
      // on every call. See `../domain/tyre_records_paging.dart`'s library
      // comment for the class of defect this avoids.
      for (
        int from = 0;
        from < _distinctSiteScanCap;
        from += _distinctSiteScanPageSize
      ) {
        final int to = from + _distinctSiteScanPageSize - 1;

        var builder = _client
            .from(SupabaseTables.tyreRecords)
            .select('site')
            .not('site', 'is', null);

        if (country != null) {
          builder = builder.or('country.is.null,country.eq.$country');
        }

        final List<Map<String, dynamic>> rows = await builder
            .order('site', ascending: true)
            .order('id', ascending: true)
            .range(from, to);

        for (final Map<String, dynamic> row in rows) {
          final Object? value = row['site'];
          if (value is String) {
            final String trimmed = value.trim();
            if (trimmed.isNotEmpty) seen.add(trimmed);
          }
        }

        if (rows.length < _distinctSiteScanPageSize) break;
      }

      final List<String> sites = seen.toList()..sort();
      return sites;
    });
  }
}
