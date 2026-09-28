/// Pins the exact `tyre_service_events` row a rotation writes, and the
/// validation that refuses a row that could not describe a real rotation.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/tyre_diagram/data/tyre_service_event_repository.dart';

const UserRole _role = UserRole.known(RoleId.tyreMan);

WorkspaceContext _workspace({String? country = 'KSA'}) => WorkspaceContext(
      userId: 'user-1',
      role: _role,
      effectivePermissions: const AccessState(role: _role),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      activeCountry: country,
      fullName: 'Ali Fitter',
    );

void main() {
  late List<(String, Map<String, Object?>)> inserted;
  late SupabaseTyreServiceEventRepository repo;

  setUp(() {
    inserted = <(String, Map<String, Object?>)>[];
    repo = SupabaseTyreServiceEventRepository.withInserter(
      (String table, Map<String, Object?> row) async {
        inserted.add((table, row));
      },
    );
  });

  test('a rotation inserts one rotation row into tyre_service_events',
      () async {
    await repo.recordRotation(
      workspace: _workspace(),
      input: RecordTyreRotationInput(
        fromPosition: ' lhf1 ',
        toPosition: 'rhf1',
        eventDate: DateTime(2026, 9, 28, 23, 30),
        assetNo: 'tm514',
        tyreSerial: 'YMA55312',
        site: 'NHC',
        notes: '  uneven wear  ',
      ),
    );

    expect(inserted, hasLength(1));
    final (String table, Map<String, Object?> row) = inserted.single;
    expect(table, 'tyre_service_events');
    expect(row, <String, Object?>{
      'tyre_serial': 'YMA55312',
      'asset_no': 'TM514',
      'position': 'LHF1',
      'event_type': 'rotation',
      'event_date': '2026-09-28',
      'site': 'NHC',
      'country': 'KSA',
      'technician': 'Ali Fitter',
      'notes': 'Rotated from LHF1 to RHF1. uneven wear',
    });
  });

  test('blank optional fields are written as null, never as empty text',
      () async {
    await repo.recordRotation(
      workspace: _workspace(country: null),
      input: RecordTyreRotationInput(
        fromPosition: 'LHF1',
        toPosition: 'LHR1-O',
        eventDate: DateTime(2026, 1, 5),
        assetNo: 'TM514',
        tyreSerial: '  ',
        site: '',
      ),
    );

    final Map<String, Object?> row = inserted.single.$2;
    expect(row['tyre_serial'], isNull);
    expect(row['site'], isNull);
    expect(row['country'], isNull);
    expect(row['event_date'], '2026-01-05');
    expect(row['notes'], 'Rotated from LHF1 to LHR1-O');
  });

  for (final (String name, RecordTyreRotationInput input)
      in <(String, RecordTyreRotationInput)>[
    (
      'a blank destination',
      RecordTyreRotationInput(
        fromPosition: 'LHF1',
        toPosition: '  ',
        eventDate: DateTime(2026),
        assetNo: 'TM514',
      ),
    ),
    (
      'the same position',
      RecordTyreRotationInput(
        fromPosition: 'LHF1',
        toPosition: 'lhf1',
        eventDate: DateTime(2026),
        assetNo: 'TM514',
      ),
    ),
    (
      'neither serial nor asset',
      RecordTyreRotationInput(
        fromPosition: 'LHF1',
        toPosition: 'RHF1',
        eventDate: DateTime(2026),
      ),
    ),
  ]) {
    test('refuses $name without writing anything', () async {
      await expectLater(
        repo.recordRotation(workspace: _workspace(), input: input),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.validation,
          ),
        ),
      );
      expect(inserted, isEmpty);
    });
  }

  test(
      'a failed insert is rethrown as a classified SupabaseFailure, never swallowed',
      () async {
    final SupabaseTyreServiceEventRepository failing =
        SupabaseTyreServiceEventRepository.withInserter(
      (String table, Map<String, Object?> row) async => throw Exception('boom'),
    );

    await expectLater(
      failing.recordRotation(
        workspace: _workspace(),
        input: RecordTyreRotationInput(
          fromPosition: 'LHF1',
          toPosition: 'RHF1',
          eventDate: DateTime(2026),
          assetNo: 'TM514',
        ),
      ),
      throwsA(isA<SupabaseFailure>()),
    );
  });
}
