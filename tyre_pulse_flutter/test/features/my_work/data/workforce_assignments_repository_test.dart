import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';

void main() {
  test('fromJson tolerates a missing priority, site and due date', () {
    final WorkforceAssignment a = WorkforceAssignment.fromJson(
      <String, dynamic>{'id': 'x', 'title': 'T', 'status': 'assigned'},
    );
    expect(a.priority, 'normal');
    expect(a.site, isNull);
    expect(a.dueAt, isNull);
  });

  group('operations-core columns (20261109160000)', () {
    test('are parsed when present', () {
      final WorkforceAssignment a = WorkforceAssignment.fromJson(
        <String, dynamic>{
          'id': 'a1',
          'title': 'Replace tyre',
          'status': 'in_progress',
          'organisation_id': 'org-1',
          'asset_no': 'TM514',
          'tyre_serial': ' YMA55312 ',
          'tyre_position': 'LHF1',
          'operational_record_table': 'tyre_records',
          'operational_record_id': null,
          'due_at': '2026-11-10T08:00:00Z',
        },
      );
      expect(a.organisationId, 'org-1');
      expect(a.assetNo, 'TM514');
      expect(a.tyreSerial, 'YMA55312');
      expect(a.tyrePosition, 'LHF1');
      expect(a.operationalRecordTable, 'tyre_records');
      expect(a.operationalRecordId, isNull);
      expect(a.needsOperationalRecord, isTrue);
      expect(a.dueAt, DateTime.utc(2026, 11, 10, 8));
    });

    test('absent columns (older server or older cache) read as null', () {
      final WorkforceAssignment a = WorkforceAssignment.fromJson(
        <String, dynamic>{'id': 'a1', 'title': 'T', 'status': 'blocked'},
      );
      expect(a.assetNo, isNull);
      expect(a.tyreSerial, isNull);
      expect(a.tyrePosition, isNull);
      expect(a.operationalRecordTable, isNull);
      expect(a.organisationId, isNull);
      expect(a.needsOperationalRecord, isFalse);
    });

    test('wrong types, blanks and unknown record kinds read as null', () {
      final WorkforceAssignment a = WorkforceAssignment.fromJson(
        <String, dynamic>{
          'id': 'a1',
          'title': 'T',
          'status': 'assigned',
          'asset_no': 42,
          'tyre_serial': '   ',
          'operational_record_table': 'accidents',
          'due_at': 'not a date',
        },
      );
      expect(a.assetNo, isNull);
      expect(a.tyreSerial, isNull);
      expect(a.operationalRecordTable, isNull);
      expect(a.dueAt, isNull);
    });

    test('a linked record no longer needs linking', () {
      final WorkforceAssignment a = WorkforceAssignment.fromJson(
        <String, dynamic>{
          'id': 'a1',
          'title': 'T',
          'status': 'submitted',
          'operational_record_table': 'work_orders',
          'operational_record_id': 'wo-1',
        },
      );
      expect(a.needsOperationalRecord, isFalse);
    });
  });

  test('the extended select falls back only on a missing-column error', () {
    expect(
      isWorkforceMissingColumn(
        const PostgrestException(message: 'column', code: '42703'),
      ),
      isTrue,
    );
    expect(
      isWorkforceMissingColumn(
        const PostgrestException(message: 'cache', code: 'PGRST204'),
      ),
      isTrue,
    );
    expect(
      isWorkforceMissingColumn(
        const PostgrestException(message: 'rls', code: '42501'),
      ),
      isFalse,
    );
    expect(isWorkforceMissingColumn(StateError('socket')), isFalse);
    expect(
      workforceAssignmentExtendedColumns
          .startsWith(workforceAssignmentBaseColumns),
      isTrue,
    );
  });
}
