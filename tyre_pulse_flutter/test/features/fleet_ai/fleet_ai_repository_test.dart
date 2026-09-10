import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/fleet_ai/data/fleet_ai_repository.dart';

class _Fleet implements VehicleFleetSource {
  Map<String, dynamic>? row;
  String? country;
  String? assetNo;
  @override
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
  }) async {
    this.assetNo = assetNo;
    this.country = country;
    return row;
  }

  @override
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  }) =>
      throw UnimplementedError();
}

void main() {
  test('does not send context after the workspace changes', () async {
    var calls = 0;
    final repository = FleetAiRepository(_Fleet(), (body) async {
      calls++;
      return <String, dynamic>{'content': 'must not be used'};
    });
    await expectLater(
      repository.ask(
        question: 'Check',
        country: 'KSA',
        sites: <String>[],
        language: 'en',
        isCurrentWorkspace: () => false,
      ),
      throwsA(isA<SupabaseFailure>()),
    );
    expect(calls, 0);
  });

  test('uses scoped exact asset lookup and excludes operator details',
      () async {
    final fleet = _Fleet()
      ..row = <String, dynamic>{
        'asset_no': 'A-1',
        'site': 'S1',
        'current_km': null,
        'operator_name': 'Private operator',
      };
    Map<String, dynamic>? request;
    final repository = FleetAiRepository(fleet, (body) async {
      request = body;
      return <String, dynamic>{'content': 'Real answer'};
    });
    final answer = await repository.ask(
      question: ' Check tyres ',
      assetNo: ' A-1 ',
      country: 'KSA',
      sites: <String>['S1'],
      language: 'ar',
    );
    expect(answer, 'Real answer');
    expect(fleet.country, 'KSA');
    expect(fleet.assetNo, 'A-1');
    expect(request!['site'], 'S1');
    expect(request!['system'], contains('"current_km":null'));
    expect(request!['system'], isNot(contains('Private operator')));
    expect(request!['messages'], <Map<String, String>>[
      <String, String>{'role': 'user', 'content': 'Check tyres'},
    ]);
  });

  test('refuses asset outside selected site before calling AI', () async {
    final fleet = _Fleet()
      ..row = <String, dynamic>{'asset_no': 'A-1', 'site': 'S2'};
    var calls = 0;
    final repository = FleetAiRepository(fleet, (body) async {
      calls++;
      return <String, dynamic>{'content': 'must not be used'};
    });
    await expectLater(
      repository.ask(
        question: 'Check',
        assetNo: 'A-1',
        country: 'KSA',
        sites: <String>['S1'],
        language: 'en',
      ),
      throwsA(isA<SupabaseFailure>()),
    );
    expect(calls, 0);
  });

  test('missing answer fails explicitly without a fabricated result', () async {
    final repository = FleetAiRepository(
      _Fleet(),
      (body) async => <String, dynamic>{'error': 'Unavailable'},
    );
    await expectLater(
      repository.ask(
        question: 'Check',
        country: null,
        sites: <String>[],
        language: 'en',
      ),
      throwsA(isA<SupabaseFailure>()),
    );
  });
}
