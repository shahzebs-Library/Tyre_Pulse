/// Product-specific heavy-vehicle layout rules confirmed by the owner:
/// the line pump is a four-axle/12-tyre machine, the concrete pump is a
/// five-axle/14-tyre machine, and each rear inner/outer pair is physically
/// adjacent with the inner tyre nearest the chassis.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

void main() {
  test('line and concrete pumps remain distinct four/five-axle layouts', () {
    final DiagramLayout line = kTyreDiagramLayouts['Line pump']!;
    final DiagramLayout concrete = kTyreDiagramLayouts['Concrete pump']!;

    expect(line.tyres, hasLength(12));
    expect(concrete.tyres, hasLength(14));
    expect(_axleCount(line), 4);
    expect(_axleCount(concrete), 5);
    expect(line.tyres.map((TyreSlot slot) => slot.id), isNot(contains('F3L')));
    expect(concrete.tyres.map((TyreSlot slot) => slot.id), contains('F3L'));
    expect(concrete.tyres.map((TyreSlot slot) => slot.id), contains('F3R'));
  });

  for (final String layoutKey in <String>[
    'Truck 6x4',
    'Tri-mixer',
    'Trailer',
    'Line pump',
    'Concrete pump',
  ]) {
    test('$layoutKey keeps rear duals together with inner nearest chassis', () {
      final DiagramLayout layout = kTyreDiagramLayouts[layoutKey]!;
      final Map<(PositionSide, int), List<TyreSlot>> groups =
          <(PositionSide, int), List<TyreSlot>>{};
      for (final TyreSlot slot in layout.tyres) {
        final PositionStruct position = parsePositionStruct(slot.id);
        if (position.kind == PositionKind.drive &&
            position.side != null &&
            position.role != PositionRole.single) {
          groups.putIfAbsent(
            (position.side!, position.axle),
            () => <TyreSlot>[],
          ).add(slot);
        }
      }

      expect(groups, isNotEmpty);
      for (final MapEntry<(PositionSide, int), List<TyreSlot>> entry
          in groups.entries) {
        expect(entry.value, hasLength(2));
        final TyreSlot outer = entry.value.singleWhere(
          (TyreSlot slot) =>
              parsePositionStruct(slot.id).role == PositionRole.outer,
        );
        final TyreSlot inner = entry.value.singleWhere(
          (TyreSlot slot) =>
              parsePositionStruct(slot.id).role == PositionRole.inner,
        );

        // The 2-unit authored gap is the production geometry: close enough
        // to render as one twin assembly, without merging the stored slots.
        final double gap = entry.key.$1 == PositionSide.left
            ? inner.x - (outer.x + outer.w)
            : outer.x - (inner.x + inner.w);
        expect(gap, inInclusiveRange(0, 2));

        if (entry.key.$1 == PositionSide.left) {
          expect(inner.x, greaterThan(outer.x));
        } else {
          expect(inner.x, lessThan(outer.x));
        }
      }
    });
  }
}

int _axleCount(DiagramLayout layout) {
  final Set<(PositionKind, int)> axles = <(PositionKind, int)>{};
  for (final TyreSlot slot in layout.tyres) {
    final PositionStruct position = parsePositionStruct(slot.id);
    axles.add((position.kind, position.axle));
  }
  return axles.length;
}
