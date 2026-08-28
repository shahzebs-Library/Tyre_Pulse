/// Fleet-class regression coverage grounded in the imported PMV register.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

void main() {
  const List<(String, String, int, int)> classes = <(String, String, int, int)>[
    ('TM514', 'Tri-mixer', 12, 4),
    ('MP083', 'Concrete pump', 14, 5),
    ('PL077', 'Pickup', 4, 2),
    ('WL003', 'Wheel loader', 4, 2),
    ('BH021', 'Bus', 6, 2),
    ('SL019', 'Skid loader', 4, 2),
    ('LP003', 'Line pump', 12, 4),
    ('MB003', 'Bus', 6, 2),
  ];

  for (final (String, String, int, int) fixture in classes) {
    test(
      '${fixture.$1} resolves to ${fixture.$2} with '
      '${fixture.$4} axles and ${fixture.$3} tyres',
      () {
        final String key = resolveVehicleType('HEAVY EQP', fixture.$1);
        final DiagramLayout layout = kTyreDiagramLayouts[key]!;

        expect(key, fixture.$2);
        expect(layout.tyres, hasLength(fixture.$3));
        expect(_axleCount(layout), fixture.$4);
        expect(
          diagramPositions('HEAVY EQP', fixture.$1),
          hasLength(fixture.$3),
        );
      },
    );
  }

  test('real type wins, while blank and catch-all types use the prefix', () {
    expect(resolveVehicleType('BUS', 'TM514'), 'Bus');
    expect(resolveVehicleType('', 'LP003'), 'Line pump');
    expect(resolveVehicleType(null, 'MP083'), 'Concrete pump');
    expect(resolveVehicleType('HEAVY EQP', 'WL003'), 'Wheel loader');
  });

  test('dual rows stay in physical left-to-right outer/inner order', () {
    for (final DiagramLayout layout in kTyreDiagramLayouts.values) {
      final Map<double, List<TyreSlot>> dualRows = <double, List<TyreSlot>>{};
      for (final TyreSlot slot in layout.tyres) {
        final PositionStruct parsed = parsePositionStruct(slot.id);
        if (parsed.role == PositionRole.inner ||
            parsed.role == PositionRole.outer) {
          dualRows.putIfAbsent(slot.y, () => <TyreSlot>[]).add(slot);
        }
      }

      for (final List<TyreSlot> row in dualRows.values) {
        expect(row, hasLength(4), reason: layout.key);
        final List<PositionRole> roles = row
            .map((TyreSlot slot) => parsePositionStruct(slot.id).role)
            .toList(growable: false);
        expect(
          roles,
          <PositionRole>[
            PositionRole.outer,
            PositionRole.inner,
            PositionRole.inner,
            PositionRole.outer,
          ],
          reason: '${layout.key}: ${row.map((TyreSlot slot) => slot.id)}',
        );
        expect(
          row.map((TyreSlot slot) => slot.x).toList(growable: false),
          orderedEquals(
            row.map((TyreSlot slot) => slot.x).toList(growable: false)..sort(),
          ),
          reason: '${layout.key} must declare the physical left-to-right row',
        );
      }
    }
  });
}

int _axleCount(DiagramLayout layout) {
  return <(PositionKind, int)>{
    for (final TyreSlot slot in layout.tyres)
      (
        parsePositionStruct(slot.id).kind,
        parsePositionStruct(slot.id).axle,
      ),
  }.length;
}
