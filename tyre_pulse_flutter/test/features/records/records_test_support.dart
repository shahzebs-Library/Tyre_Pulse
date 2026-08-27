/// Shared test doubles for the tyre records feature.
///
/// [FakeTyreRecordsRepository] is a hand-written fake implementing
/// [TyreRecordsRepository] directly, mirroring `FakeDependencies implements
/// WorkspaceDependencies` in `test/core/workspace/workspace_switch_test.dart`
/// - the established pattern in this codebase for making a paging/sequencing
/// state machine testable without a real or mocked [SupabaseClient]. The
/// recorded call list ([fetchPageCalls]) is part of the point, not
/// incidental: several of the properties this feature must prove are rules
/// about WHAT WAS CALLED, not just what the resulting state looks like -
/// "page zero is fetched by exactly one call path" can only be checked by
/// inspecting the calls themselves.
library;

import 'package:tyre_pulse/features/records/data/tyre_records_repository.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_page.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_query.dart';
import 'package:tyre_pulse/features/records/domain/tyre_records_paging.dart';

/// A private sentinel distinguishing "the caller did not pass [assetNo] at
/// all" from "the caller explicitly passed null". A plain `String? assetNo`
/// parameter defaulting via `assetNo ?? 'TM$id'` cannot tell those two
/// apart - `buildTyreRecord(id: '1', assetNo: null)` and
/// `buildTyreRecord(id: '1')` would build the identical record, which makes
/// it impossible to construct a record that genuinely has no asset number
/// on record (exactly the case a "falls back to a generic title" test needs
/// to exercise).
const Object _unset = Object();

/// Builds a minimal, valid [TyreRecord] for tests. Every field beyond [id]
/// is optional so a test can construct exactly the shape it needs.
///
/// [assetNo] defaults to `'TM$id'` when OMITTED, exactly as before. Passing
/// it explicitly - including `assetNo: null` - always wins.
TyreRecord buildTyreRecord({
  required String id,
  Object? assetNo = _unset,
  String? serialNo,
  String? brand,
  String? site,
  String? position,
  String? tyrePosition,
  String? issueDate,
  String? riskLevel,
  String? category,
  num? costPerTyre,
  num? kmAtFitment,
  num? kmAtRemoval,
  String? description,
  String? remarks,
  String? country,
}) {
  return TyreRecord(
    id: id,
    assetNo: identical(assetNo, _unset) ? 'TM$id' : assetNo as String?,
    serialNo: serialNo,
    brand: brand,
    site: site,
    position: position,
    tyrePosition: tyrePosition,
    issueDate: issueDate,
    riskLevel: riskLevel,
    category: category,
    costPerTyre: costPerTyre,
    kmAtFitment: kmAtFitment,
    kmAtRemoval: kmAtRemoval,
    description: description,
    remarks: remarks,
    country: country,
  );
}

/// One recorded call to [FakeTyreRecordsRepository.fetchPage].
typedef FetchPageCall = ({int pageIndex, TyreRecordsQuery query});

/// A page responder: given the page index and query a call arrived with,
/// produces the [TyreRecordsPage] that call resolves to (or throws, to
/// simulate a failure). Queued responders let a test control EXACTLY how
/// many calls have been made and in what order two calls resolve relative
/// to each other - the shape needed to prove the sequence-ticket rule holds
/// even when a slower earlier request would otherwise resolve after a
/// faster later one.
typedef PageResponder = Future<TyreRecordsPage> Function(
  int pageIndex,
  TyreRecordsQuery query,
);

final class FakeTyreRecordsRepository implements TyreRecordsRepository {
  FakeTyreRecordsRepository({
    List<TyreRecord> dataset = const <TyreRecord>[],
    this.pageSize = kTyreRecordsPageSize,
  }) : _dataset = dataset;

  final List<TyreRecord> _dataset;
  final int pageSize;

  /// Every [fetchPage] call, in the order it was MADE (not the order it
  /// resolved in - those can differ, which is the whole point of the
  /// sequence-ticket rule this fake exists to help prove).
  final List<FetchPageCall> fetchPageCalls = <FetchPageCall>[];

  /// Consumed one per call, in order. A call beyond the queued responders
  /// falls back to slicing [_dataset] by [pageIndex] and [pageSize] -
  /// PostgREST's own real paging behaviour, reproduced exactly: a page
  /// short of [pageSize] or past the end of the dataset reports no further
  /// page.
  final List<PageResponder> _responders = <PageResponder>[];

  /// Queues an explicit responder for the NEXT call to [fetchPage].
  void queueResponder(PageResponder responder) {
    _responders.add(responder);
  }

  /// Queues a plain failure for the next call.
  void queueFailure(Object error) {
    queueResponder(
      (int pageIndex, TyreRecordsQuery query) =>
          Future<TyreRecordsPage>.error(error),
    );
  }

  @override
  Future<TyreRecordsPage> fetchPage({
    required int pageIndex,
    TyreRecordsQuery query = const TyreRecordsQuery(),
  }) {
    fetchPageCalls.add((pageIndex: pageIndex, query: query));
    if (_responders.isNotEmpty) {
      final PageResponder responder = _responders.removeAt(0);
      return responder(pageIndex, query);
    }
    return Future<TyreRecordsPage>.value(_defaultPageFor(pageIndex));
  }

  TyreRecordsPage _defaultPageFor(int pageIndex) {
    final int from = pageIndex * pageSize;
    if (from >= _dataset.length) {
      return const TyreRecordsPage(items: <TyreRecord>[], hasMore: false);
    }
    final int to = (from + pageSize) > _dataset.length
        ? _dataset.length
        : (from + pageSize);
    final List<TyreRecord> items = _dataset.sublist(from, to);
    // Derived from whether THIS page came back full, mirroring
    // SupabaseTyreRecordsRepository.fetchPage's real contract - never from
    // the total dataset length, which the real repository never has either.
    // A full final page therefore reads hasMore=true; only the following,
    // empty page proves the list is exhausted (see
    // TyreRecordsPage.hasMore's own doc comment).
    return TyreRecordsPage(items: items, hasMore: items.length == pageSize);
  }

  @override
  Future<TyreRecord?> fetchById(String id) async {
    for (final TyreRecord record in _dataset) {
      if (record.id == id) return record;
    }
    return null;
  }

  @override
  Future<List<String>> fetchDistinctSites({
    String? country,
    String? restrictToSite,
  }) async {
    if (restrictToSite != null) return <String>[restrictToSite];
    final Set<String> sites = <String>{};
    for (final TyreRecord record in _dataset) {
      final String? site = record.site;
      if (site != null) sites.add(site);
    }
    final List<String> sorted = sites.toList()..sort();
    return sorted;
  }
}
