import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';

void main() {
  group('AccidentCasePeopleRepository', () {
    test('resolves assigned owners and leaves unassigned ones null', () async {
      final List<List<String>> asked = <List<String>>[];
      final AccidentCasePeopleRepository repo = AccidentCasePeopleRepository(
        readOwners: (String id) async => <Map<String, dynamic>>[
          <String, dynamic>{
            'workstream_key': 'fleet_validation',
            'owner_id': 'u1',
          },
          <String, dynamic>{'workstream_key': 'insurance', 'owner_id': null},
        ],
        readNames: (List<String> ids) async {
          asked.add(ids);
          return <Map<String, dynamic>>[
            <String, dynamic>{'id': 'u1', 'full_name': 'Recorded Owner'},
          ];
        },
      );
      final AccidentCasePeople people = await repo.owners('case-1');
      expect(people.loaded, isTrue);
      expect(people.ownerName('fleet_validation'), 'Recorded Owner');
      expect(people.isUnassigned('fleet_validation'), isFalse);
      expect(people.isUnassigned('insurance'), isTrue);
      expect(
        people.isUnassigned('timeline'),
        isFalse,
        reason: 'a presentation-only step has no ledger row to be unassigned',
      );
      expect(asked.single, <String>['u1']);
    });

    test('namesFor skips blanks and never queries for nothing', () async {
      int calls = 0;
      final AccidentCasePeopleRepository repo = AccidentCasePeopleRepository(
        readOwners: (_) async => <Map<String, dynamic>>[],
        readNames: (_) async {
          calls++;
          return <Map<String, dynamic>>[];
        },
      );
      expect(await repo.namesFor(<String?>[null, ' ']), isEmpty);
      expect(calls, 0);
    });
  });

  testWidgets('owner display: name, unassigned, or team only',
      (WidgetTester tester) async {
    late AccidentMockCopy copy;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) {
            copy = AccidentMockCopy.of(context);
            return const SizedBox();
          },
        ),
      ),
    );
    const AccidentCasePeople people = AccidentCasePeople(
      loaded: true,
      ownerNames: <String, String?>{'fleet_validation': 'A. Owner', 'x': null},
    );
    expect(
      accidentOwnerDisplay(copy, people, 'fleet_validation', 'Fleet'),
      'A. Owner · Fleet',
    );
    expect(
      accidentOwnerDisplay(copy, people, 'x', 'Fleet'),
      'Unassigned · Fleet',
    );
    expect(
      accidentOwnerDisplay(copy, AccidentCasePeople.unknown, 'x', 'Fleet'),
      'Fleet',
    );
  });
}
