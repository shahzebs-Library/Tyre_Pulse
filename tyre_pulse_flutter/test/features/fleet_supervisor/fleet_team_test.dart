import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/fleet_supervisor/domain/fleet_team.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/fleet_supervisor_copy.dart';

void main() {
  test('the pool views and actions match the server, no ownership actions', () {
    expect(
      FleetTeamView.values.map((FleetTeamView v) => v.wire),
      <String>['all', 'with_vehicle', 'without_vehicle'],
    );
    expect(FleetTeamAction.all, <String>{
      'assign_vehicle',
      'unassign_vehicle',
      'set_responsible',
      'set_driver_profile',
    });
    expect(FleetTeamAction.all.contains('take_driver'), isFalse);
  });

  test('a row reads type, region and the responsible label', () {
    final FleetTeamDriver d = FleetTeamDriver.fromRow(<String, Object?>{
      'id': 'd1',
      'driver_id': '100',
      'driver_name': 'A',
      'driver_category': ' Transit mixer driver ',
      'region': 'Central',
      'responsible_name': 'Firoz',
    });
    expect(d.category, 'Transit mixer driver');
    expect(d.region, 'Central');
    expect(d.responsibleName, 'Firoz');
    final FleetTeamDriver cleared = d.withProfile(category: null, region: 'W');
    expect(cleared.category, isNull);
    expect(cleared.region, 'W');
    expect(cleared.responsibleName, 'Firoz');
  });

  test('filter options are sorted and drop blanks', () {
    final FleetFilterOptions f =
        FleetFilterOptions.fromResult(<String, Object?>{
      'categories': <Object?>['Pump driver', '', 'Bus driver', null],
      'regions': <Object?>['Western', 'Central'],
    });
    expect(f.categories, <String>['Bus driver', 'Pump driver']);
    expect(f.regions, <String>['Central', 'Western']);
    expect(() => FleetFilterOptions.fromResult(null), throwsFormatException);
  });

  group('FleetTeamPage', () {
    test('parses rows and treats 101 rows as another page', () {
      final List<Map<String, Object?>> rows = <Map<String, Object?>>[
        for (int i = 0; i < 101; i++)
          <String, Object?>{
            'id': 'd$i',
            'driver_id': '100$i',
            'driver_name': 'Driver $i',
            'open_charges': 2,
            'last_km': 127702.0,
          },
      ];
      final FleetTeamPage page =
          FleetTeamPage.fromResult(<String, Object?>{'rows': rows});
      expect(page.rows, hasLength(100));
      expect(page.hasMore, isTrue);
      expect(page.rows.first.openCharges, 2);
      expect(page.rows.first.hasVehicle, isFalse);
    });

    test('refuses a malformed answer instead of showing an empty team', () {
      expect(() => FleetTeamPage.fromResult(null), throwsFormatException);
      expect(
        () => FleetTeamPage.fromResult(<String, Object?>{'rows': 1}),
        throwsFormatException,
      );
    });
  });

  group('FleetCommandOutcome', () {
    test('a conflict is returned, never treated as done', () {
      final FleetCommandOutcome o = FleetCommandOutcome.fromResult(
        <String, Object?>{
          'ok': false,
          'conflict': <String, Object?>{
            'driver_id': 'x',
            'driver_name': 'SARFARAJ',
            'asset_no': 'TM655',
          },
        },
      );
      expect(o, isA<FleetVehicleConflict>());
      expect((o as FleetVehicleConflict).assetNo, 'TM655');
    });

    test('ok true is done; anything else is an error', () {
      expect(
        FleetCommandOutcome.fromResult(<String, Object?>{'ok': true}),
        isA<FleetCommandDone>(),
      );
      expect(
        () => FleetCommandOutcome.fromResult(<String, Object?>{}),
        throwsFormatException,
      );
    });
  });

  group('FleetChargeDraft', () {
    final DateTime now = DateTime(2026, 11, 27, 12);
    FleetChargeDraft draft({
      String category = 'tyre_damage',
      String amount = '450',
      String basis = 'Sidewall cut after kerb strike at the plant gate',
      List<String> photos = const <String>[
        'tp-storage://tyre-photos/modules/driver-charge/d/1.jpg',
      ],
      String? fault = 'driver_fault',
      String doc = '',
      DateTime? at,
    }) =>
        FleetChargeDraft(
          driverId: 'd1',
          category: category,
          amount: amount,
          currency: 'SAR',
          basis: basis,
          incidentAt: at ?? DateTime(2026, 11, 26),
          vehicleId: 'v1',
          faultFinding: fault,
          photoRefs: photos,
          documentRef: doc,
        );

    test('a complete damage charge has no issues and builds the payload', () {
      final FleetChargeDraft d = draft();
      expect(d.issues(now: now), isEmpty);
      final Map<String, Object?> p = d.toPayload();
      expect(p['amount'], 450.0);
      expect(p['source_type'], 'none');
      expect(p['fault_finding'], 'driver_fault');
      expect(
        (p['evidence'] as List<Object?>).single,
        containsPair('kind', 'photo'),
      );
    });

    test('damage needs a photo and a fault finding', () {
      final List<FleetFormIssue> issues =
          draft(photos: const <String>[], fault: null, doc: 'JC-1')
              .issues(now: now);
      expect(issues, contains(FleetFormIssue.photo));
      expect(issues, contains(FleetFormIssue.faultFinding));
    });

    test('a non-damage charge accepts a paper reference instead of a photo',
        () {
      final FleetChargeDraft d = draft(
        category: 'other',
        photos: const <String>[],
        fault: null,
        doc: 'Statement 44',
      );
      expect(d.issues(now: now), isEmpty);
      expect(d.toPayload().containsKey('fault_finding'), isFalse);
    });

    test('rejects zero, too large, short basis and a future date', () {
      expect(
        draft(amount: '0').issues(now: now),
        contains(FleetFormIssue.amount),
      );
      expect(
        draft(amount: '1000001').issues(now: now),
        contains(FleetFormIssue.amount),
      );
      expect(
        draft(basis: 'short').issues(now: now),
        contains(FleetFormIssue.basis),
      );
      expect(
        draft(at: DateTime(2026, 12, 1)).issues(now: now),
        contains(FleetFormIssue.incidentInFuture),
      );
    });
  });

  group('FleetFineDraft', () {
    test('needs the vehicle, authority, notice and amount', () {
      final FleetFineDraft f = FleetFineDraft(
        driverId: 'd1',
        vehicleId: null,
        authority: '',
        noticeReference: '',
        incidentAt: DateTime(2026, 11, 20),
        amount: '',
        currency: 'SAR',
        description: '',
        assignmentReason: '',
      );
      expect(
        f.issues(now: DateTime(2026, 11, 27)),
        containsAll(<FleetFormIssue>[
          FleetFormIssue.vehicle,
          FleetFormIssue.authority,
          FleetFormIssue.reference,
          FleetFormIssue.amount,
          FleetFormIssue.basis,
        ]),
      );
    });

    test('formats the due date as a plain date', () {
      final FleetFineDraft f = FleetFineDraft(
        driverId: 'd1',
        vehicleId: 'v1',
        authority: 'Muroor',
        noticeReference: 'N-1',
        incidentAt: DateTime(2026, 11, 20),
        dueDate: DateTime(2026, 12, 5),
        amount: '300',
        currency: 'sar',
        description: 'Speeding',
        assignmentReason: 'On the roster that day',
      );
      expect(f.issues(now: DateTime(2026, 11, 27)), isEmpty);
      expect(f.toPayload()['due_date'], '2026-12-05');
      expect(f.toPayload()['currency'], 'SAR');
    });
  });

  test('currency follows the driver country', () {
    expect(fleetCurrencyFor('KSA'), 'SAR');
    expect(fleetCurrencyFor('Saudi Arabia'), 'SAR');
    expect(fleetCurrencyFor('UAE'), 'AED');
    expect(fleetCurrencyFor('Egypt'), 'EGP');
    expect(fleetCurrencyFor(null), isNull);
  });

  test('every copy key exists in Arabic and Urdu', () {
    final Set<String> en = FleetSupervisorCopy.values['en']!.keys.toSet();
    for (final String lang in <String>['ar', 'ur']) {
      expect(FleetSupervisorCopy.values[lang]!.keys.toSet(), en, reason: lang);
    }
    for (final String c in fleetChargeCategories) {
      expect(en, contains('cat_$c'));
    }
    for (final FleetFormIssue i in FleetFormIssue.values) {
      expect(en, contains('issue_${i.name}'));
    }
  });
}
