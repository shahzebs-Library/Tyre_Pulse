library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

void main() {
  group('PmPlan due state', () {
    final DateTime now = DateTime(2026, 8, 28, 18, 30);

    PmPlan plan(DateTime? nextDue) => PmPlan(
          id: 'pm-1',
          nextDue: nextDue,
        );

    test('uses whole calendar days and the 14-day due-soon boundary', () {
      expect(plan(DateTime(2026, 8, 27)).daysToDue(now), -1);
      expect(plan(DateTime(2026, 8, 27)).dueBand(now), PmDueBand.overdue);
      expect(plan(DateTime(2026, 8, 28)).dueBand(now), PmDueBand.dueSoon);
      expect(plan(DateTime(2026, 9, 11)).dueBand(now), PmDueBand.dueSoon);
      expect(plan(DateTime(2026, 9, 12)).dueBand(now), PmDueBand.ok);
      expect(plan(null).dueBand(now), PmDueBand.none);
    });

    test('maps only verified meter sources to units', () {
      expect(const PmPlan(id: 'a', meterSource: 'odometer').meterUnit, 'km');
      expect(
        const PmPlan(id: 'b', meterSource: 'engine_hours').meterUnit,
        'h',
      );
      expect(const PmPlan(id: 'c', meterSource: 'other').meterUnit, isEmpty);
    });
  });
}
