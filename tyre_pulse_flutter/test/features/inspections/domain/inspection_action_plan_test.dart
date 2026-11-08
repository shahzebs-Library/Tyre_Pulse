import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_action_plan.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

ActionInspectionFacts _facts({
  Map<String, TyrePositionReading>? tyres,
  String? findings,
}) =>
    ActionInspectionFacts(
      id: 'insp-1',
      assetNo: 'TM514',
      vehicleType: '',
      site: 'NHC',
      inspector: 'Ali',
      inspectionDate: DateTime(2026, 11, 1, 9),
      country: 'KSA',
      findings: findings,
      odometerKm: 123456,
      tyreConditions: tyres ??
          const <String, TyrePositionReading>{
            'LHF1': TyrePositionReading(
              position: 'LHF1',
              condition: 'Damaged',
              serialNumber: 'SER1',
            ),
            'RHF1': TyrePositionReading(position: 'RHF1', condition: 'Worn'),
            'LHR1': TyrePositionReading(position: 'LHR1'),
          },
    );

void main() {
  group('defectsForInspection', () {
    test('a damaged tyre is High, a worn one Medium, a Good one ignored', () {
      final List<ActionDefect> d = defectsForInspection(_facts());
      expect(
        d.map((ActionDefect e) => e.key),
        <String>['damage:LHF1', 'damage:RHF1', 'general'],
      );
      expect(d[0].priority, 'High');
      expect(d[0].urgency, 'severe');
      expect(d[1].priority, 'Medium');
      expect(d[0].title, 'Tyre Damaged at LHF1 on TM514');
    });

    test('the general item quotes the remark and stays Medium', () {
      final ActionDefect g = generalDefectFor(
        _facts(findings: 'Mud flap missing'),
      );
      expect(g.key, 'general');
      expect(g.priority, 'Medium');
      expect(g.description, 'Inspection remark: Mud flap missing');
    });
  });

  group('actionRowsForInspection', () {
    test('rows point at THIS inspection and vehicle, keyed for V496', () {
      final ActionInspectionFacts f = _facts();
      final List<Map<String, Object?>> rows = actionRowsForInspection(
        f,
        defectsForInspection(f),
        now: DateTime(2026, 11, 8),
      );
      final Map<String, Object?> r = rows.first;
      expect(r['asset_no'], 'TM514');
      expect(r['source_type'], 'inspection');
      expect(r['source_id'], 'insp-1');
      expect(r['source_detail'], 'damage:LHF1');
      expect(r['status'], 'Open');
      expect(r['tyre_serial'], 'SER1');
      expect(r['country'], 'KSA');
      expect(r['due_date'], '2026-11-09'); // severe = 1 day
      expect(rows[1]['due_date'], '2026-11-22'); // medium = 14 days
      expect(r['description'], contains('Odometer: 123,456 km'));
    });

    test('already-raised keys are skipped', () {
      final ActionInspectionFacts f = _facts();
      final List<Map<String, Object?>> rows = actionRowsForInspection(
        f,
        defectsForInspection(f),
        existingKeys: <String>{'damage:LHF1'},
      );
      expect(
        rows.map((Map<String, Object?> r) => r['source_detail']),
        isNot(contains('damage:LHF1')),
      );
    });

    test('the plan adds instruction, comment, due date and assignee', () {
      final ActionInspectionFacts f = _facts();
      final List<Map<String, Object?>> rows = actionRowsForInspection(
        f,
        defectsForInspection(f).take(1).toList(),
        plans: <String, ActionPlan>{
          'damage:LHF1': const ActionPlan(
            instruction: 'Swap with the spare',
            comment: 'Driver reported vibration',
            dueDate: '2026-12-01',
            assigneeName: 'Imran',
          ),
        },
      );
      final Map<String, Object?> r = rows.single;
      expect(r['due_date'], '2026-12-01');
      expect(r['assigned_to'], 'Imran');
      expect(
        r['description'],
        contains('INSTRUCTION FROM THE RAISER\nSwap with the spare'),
      );
      expect(
        r['description'],
        contains('COMMENT OR CORRECTION\nDriver reported vibration'),
      );
    });

    test('a blank plan changes nothing', () {
      final Map<String, Object?> row = <String, Object?>{
        'description': 'x',
        'due_date': '2026-01-01',
      };
      expect(applyPlanToRow(row, const ActionPlan()), row);
    });
  });
}
