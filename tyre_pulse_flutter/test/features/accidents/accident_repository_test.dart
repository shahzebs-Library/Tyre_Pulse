import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

void main() {
  test('list uses one look-ahead row for honest hasMore', () async {
    final _FakeSource source = _FakeSource(
      listRows: List<Map<String, dynamic>>.generate(
        3,
        (int index) => _accident('id-$index'),
      ),
    );
    final AccidentListPage page = await SupabaseAccidentRepository(source).list(
      offset: 0,
      pageSize: 2,
      country: 'Saudi Arabia',
    );

    expect(page.items, hasLength(2));
    expect(page.hasMore, isTrue);
    expect(source.lastFrom, 0);
    expect(source.lastTo, 2);
    expect(source.lastCountry, 'Saudi Arabia');
  });

  test('case orders canonical workstreams and preserves unknowns last',
      () async {
    final _FakeSource source = _FakeSource(
      byIdRow: _accident('a1'),
      workstreamRows: <Map<String, dynamic>>[
        _workstream('repair'),
        _workstream('incident_evidence'),
        _workstream('future_stream'),
      ],
    );
    final AccidentCaseSnapshot? snapshot =
        await SupabaseAccidentRepository(source).caseById('a1');

    expect(snapshot, isNotNull);
    expect(snapshot!.provisioned, isTrue);
    expect(
      snapshot.workstreams.map((AccidentWorkstream item) => item.key),
      <String>['incident_evidence', 'repair', 'future_stream'],
    );
  });

  test('missing workstream relation degrades without inventing progress',
      () async {
    final _FakeSource source = _FakeSource(
      byIdRow: _accident('a1'),
      workstreamError: const SupabaseFailure(
        error: AppError(
          kind: AppErrorKind.server,
          message: 'Feature unavailable.',
        ),
        cause: SupabaseFailureCause.schemaMismatch,
      ),
    );
    final AccidentCaseSnapshot? snapshot =
        await SupabaseAccidentRepository(source).caseById('a1');

    expect(snapshot, isNotNull);
    expect(snapshot!.provisioned, isFalse);
    expect(snapshot.workstreams, isEmpty);
  });
}

Map<String, dynamic> _accident(String id) => <String, dynamic>{
      'id': id,
      'asset_no': 'PMP-01',
      'site': 'Riyadh',
      'incident_date': '2026-08-28',
    };

Map<String, dynamic> _workstream(String key) => <String, dynamic>{
      'id': key,
      'workstream_key': key,
      'status': 'not_started',
    };

final class _FakeSource implements AccidentRemoteSource {
  _FakeSource({
    this.listRows = const <Map<String, dynamic>>[],
    this.byIdRow,
    this.workstreamRows = const <Map<String, dynamic>>[],
    this.workstreamError,
  });

  final List<Map<String, dynamic>> listRows;
  final Map<String, dynamic>? byIdRow;
  final List<Map<String, dynamic>> workstreamRows;
  final Exception? workstreamError;
  int? lastFrom;
  int? lastTo;
  String? lastCountry;

  @override
  Future<Map<String, dynamic>?> byId(String id) async => byIdRow;

  @override
  Future<List<Map<String, dynamic>>> listPage({
    required int from,
    required int to,
    required String? country,
    String? reporterId,
  }) async {
    lastFrom = from;
    lastTo = to;
    lastCountry = country;
    return listRows;
  }

  @override
  Future<List<Map<String, dynamic>>> workstreams({
    required String accidentId,
    required String? country,
  }) async {
    if (workstreamError != null) throw workstreamError!;
    return workstreamRows;
  }
}
