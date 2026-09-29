import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/assets/domain/asset_360_facts.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

PmPlan _plan(Map<String, dynamic> row) =>
    pmPlanFromRow(<String, dynamic>{'id': 'p', 'status': 'active', ...row})!;

void main() {
  final DateTime now = DateTime(2026, 9, 29);

  group('resolveAssetServiceDue', () {
    test('an odometer plan is measured against the current km', () {
      final AssetServiceDue? due = resolveAssetServiceDue(
        <PmPlan>[
          _plan(<String, dynamic>{
            'meter_source': 'odometer',
            'next_due_meter': 68740,
          }),
        ],
        currentKm: 68420,
        engineHours: null,
        now: now,
      );
      expect(due?.unit, AssetServiceDueUnit.km);
      expect(due?.remaining, 320);
      expect(due?.isOverdue, isFalse);
    });

    test('an engine-hours plan needs an hours reading, else its date', () {
      final PmPlan plan = _plan(<String, dynamic>{
        'meter_source': 'engine_hours',
        'next_due_meter': 9000,
        'next_due': '2026-10-09',
      });
      expect(
        resolveAssetServiceDue(
          <PmPlan>[plan],
          currentKm: null,
          engineHours: 8742,
          now: now,
        )?.remaining,
        258,
      );
      final AssetServiceDue? byDate = resolveAssetServiceDue(
        <PmPlan>[plan],
        currentKm: null,
        engineHours: null,
        now: now,
      );
      expect(byDate?.unit, AssetServiceDueUnit.days);
      expect(byDate?.remaining, 10);
    });

    test('an overdue plan wins, and an unmeasurable plan is skipped', () {
      final AssetServiceDue? due = resolveAssetServiceDue(
        <PmPlan>[
          _plan(<String, dynamic>{
            'meter_source': 'odometer',
            'next_due_meter': 70000,
          }),
          _plan(<String, dynamic>{'next_due': '2026-09-20'}),
          _plan(<String, dynamic>{'meter_source': 'none'}),
        ],
        currentKm: 68420,
        engineHours: null,
        now: now,
      );
      expect(due?.unit, AssetServiceDueUnit.days);
      expect(due?.isOverdue, isTrue);
    });

    test('no measurable plan gives null, never a guess', () {
      expect(
        resolveAssetServiceDue(
          <PmPlan>[
            _plan(<String, dynamic>{
              'meter_source': 'odometer',
              'next_due_meter': 70000,
            }),
          ],
          currentKm: null,
          engineHours: null,
          now: now,
        ),
        isNull,
      );
    });
  });

  test('open tyre actions mirror the V496 closed words', () {
    expect(
      countOpenTyreActions(<Map<String, dynamic>>[
        <String, dynamic>{'status': 'Open'},
        <String, dynamic>{'status': null},
        <String, dynamic>{'status': 'In Progress'},
        <String, dynamic>{'status': 'Closed'},
        <String, dynamic>{'status': 'resolved'},
        <String, dynamic>{'status': 'Cancelled'},
      ]),
      3,
    );
  });

  group('asset documents', () {
    test('a permit with nothing recorded is left out', () {
      final List<AssetDocument> docs = assetDocumentsFromRow(
        <String, dynamic>{
          'registration_no': 'ABC-1',
          'insurance_name': null,
          'insurance_type': 'Comprehensive',
          'insurance_expiry': '2027-01-01',
          'driver_licence_issue': null,
          'driver_licence_expiry': null,
        },
      );
      expect(
        docs.map((AssetDocument d) => d.kind),
        <AssetDocumentKind>[
          AssetDocumentKind.registration,
          AssetDocumentKind.insurance,
        ],
      );
      expect(docs[1].reference, 'Comprehensive');
    });

    test('expiry state is read on the calendar day', () {
      AssetDocument doc(String? expires) => AssetDocument(
            kind: AssetDocumentKind.insurance,
            expires: parseAssetDate(expires),
          );
      expect(doc('2026-09-28').stateOn(now), AssetDocumentState.expired);
      expect(doc('2026-09-29').stateOn(now), AssetDocumentState.expiringSoon);
      expect(doc('2026-10-29').stateOn(now), AssetDocumentState.expiringSoon);
      expect(doc('2026-10-30').stateOn(now), AssetDocumentState.valid);
      expect(doc(null).stateOn(now), AssetDocumentState.noExpiry);
    });
  });
}
