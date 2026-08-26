/// Parity group I - invariants across the whole engine. Cases 84-90.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// I. These are the assertions that keep the inspection form and the
/// diagram from ever disagreeing.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

void main() {
  test('case 84: exactly 13 layouts', () {
    expect(kTyreDiagramLayouts.length, 13);
  });

  test('case 85: exactly 98 slots across the 13 layouts', () {
    int total = 0;
    for (final DiagramLayout layout in kTyreDiagramLayouts.values) {
      total += layout.tyres.length;
    }
    expect(total, 98);
  });

  final RegExp spareIdPattern = RegExp(r'^SP(ARE)?\d*$');

  test('case 86: no slot id matches the spare pattern in any layout', () {
    for (final DiagramLayout layout in kTyreDiagramLayouts.values) {
      for (final TyreSlot slot in layout.tyres) {
        expect(
          spareIdPattern.hasMatch(slot.id.toUpperCase()),
          isFalse,
          reason: '${layout.key}/${slot.id}',
        );
      }
    }
  });

  test('case 87: every slot id parses to a known kind', () {
    for (final DiagramLayout layout in kTyreDiagramLayouts.values) {
      for (final TyreSlot slot in layout.tyres) {
        expect(
          parsePositionStruct(slot.id).kind,
          isNot(PositionKind.unknown),
          reason: '${layout.key}/${slot.id}',
        );
      }
    }
  });

  test('case 88: ids are unique within a layout', () {
    for (final DiagramLayout layout in kTyreDiagramLayouts.values) {
      final Set<String> seen = <String>{};
      for (final TyreSlot slot in layout.tyres) {
        expect(
          seen.add(slot.id),
          isTrue,
          reason: 'duplicate id ${slot.id} in ${layout.key}',
        );
      }
    }
  });

  test('case 89: declaration order is render order - y is non-decreasing', () {
    for (final DiagramLayout layout in kTyreDiagramLayouts.values) {
      for (int i = 1; i < layout.tyres.length; i++) {
        expect(
          layout.tyres[i].y >= layout.tyres[i - 1].y,
          isTrue,
          reason: '${layout.key} at index $i',
        );
      }
    }
  });

  test(
    'case 90: diagramPositions agrees with kTyreDiagramLayouts for all 13 '
    'layouts',
    () {
      for (final String key in kTyreDiagramLayouts.keys) {
        final List<String> ids = <String>[
          for (final TyreSlot t in kTyreDiagramLayouts[key]!.tyres) t.id,
        ];
        expect(diagramPositions(key), ids, reason: key);
      }
    },
  );
}
