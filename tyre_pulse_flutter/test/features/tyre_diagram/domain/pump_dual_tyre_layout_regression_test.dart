/// Product-owner regression coverage for pump axle counts and physically
/// paired rear dual tyres.
///
/// The position ids and coordinates remain the audited production values from
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md`. These tests do not
/// invent a new layout; they make the important physical meaning of the
/// existing coordinates explicit: on each rear axle, Inner and Outer are a
/// joined pair on both sides, with Inner nearest the chassis centreline.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

void main() {
  test('4-axle Line pump has 12 tyres including two rear dual axles', () {
    final DiagramLayout layout = kTyreDiagramLayouts['Line pump']!;

    expect(layout.tyres.length, 12);
    expect(
      layout.tyres.map((TyreSlot slot) => slot.id),
      <String>[
        'F1L',
        'F1R',
        'F2L',
        'F2R',
        'R1Lo',
        'R1Li',
        'R1Ri',
        'R1Ro',
        'R2Lo',
        'R2Li',
        'R2Ri',
        'R2Ro',
      ],
    );
    _expectJoinedRearDualPairs(layout, rearAxles: 2);
  });

  test('5-axle Concrete pump has 14 tyres including two rear dual axles', () {
    final DiagramLayout layout = kTyreDiagramLayouts['Concrete pump']!;

    expect(layout.tyres.length, 14);
    expect(
      layout.tyres.map((TyreSlot slot) => slot.id),
      <String>[
        'F1L',
        'F1R',
        'F2L',
        'F2R',
        'F3L',
        'F3R',
        'R1Lo',
        'R1Li',
        'R1Ri',
        'R1Ro',
        'R2Lo',
        'R2Li',
        'R2Ri',
        'R2Ro',
      ],
    );
    _expectJoinedRearDualPairs(layout, rearAxles: 2);
  });

  test('every built-in multi-rear-axle layout keeps each dual pair joined', () {
    const Map<String, int> rearDualAxles = <String, int>{
      'Trailer': 2,
      'Truck 6x4': 2,
      'Tri-mixer': 2,
      'Line pump': 2,
      'Concrete pump': 2,
    };

    for (final MapEntry<String, int> entry in rearDualAxles.entries) {
      _expectJoinedRearDualPairs(
        kTyreDiagramLayouts[entry.key]!,
        rearAxles: entry.value,
      );
    }
  });

  test('single-rear-axle classes also keep Inner and Outer together', () {
    for (final String key in <String>[
      'Canter',
      'Bus',
      'Tata',
      'Ashok Leyland',
      'Tanker',
    ]) {
      _expectJoinedLegacyRearDualPair(kTyreDiagramLayouts[key]!);
    }
  });
}

void _expectJoinedRearDualPairs(
  DiagramLayout layout, {
  required int rearAxles,
}) {
  final Map<String, TyreSlot> byId = <String, TyreSlot>{
    for (final TyreSlot slot in layout.tyres) slot.id: slot,
  };

  for (int axle = 1; axle <= rearAxles; axle++) {
    _expectJoinedPair(
      layout.key,
      byId['R${axle}Lo']!,
      byId['R${axle}Li']!,
      leftSide: true,
    );
    _expectJoinedPair(
      layout.key,
      byId['R${axle}Ro']!,
      byId['R${axle}Ri']!,
      leftSide: false,
    );
  }
}

void _expectJoinedLegacyRearDualPair(DiagramLayout layout) {
  final Map<String, TyreSlot> byId = <String, TyreSlot>{
    for (final TyreSlot slot in layout.tyres) slot.id: slot,
  };
  _expectJoinedPair(
    layout.key,
    byId['RLo']!,
    byId['RLi']!,
    leftSide: true,
  );
  _expectJoinedPair(
    layout.key,
    byId['RRo']!,
    byId['RRi']!,
    leftSide: false,
  );
}

void _expectJoinedPair(
  String layoutKey,
  TyreSlot outer,
  TyreSlot inner, {
  required bool leftSide,
}) {
  expect(inner.y, outer.y, reason: '$layoutKey ${outer.id}/${inner.id} y');
  expect(inner.h, outer.h, reason: '$layoutKey ${outer.id}/${inner.id} h');

  // Audited geometry leaves only a two-unit visual seam between the two
  // tyre bodies. A larger gap would make Inner and Outer appear to belong to
  // different axles instead of one physical dual-wheel assembly.
  final double seam =
      leftSide ? inner.x - (outer.x + outer.w) : outer.x - (inner.x + inner.w);
  expect(
    seam,
    inInclusiveRange(0, 2),
    reason: '$layoutKey ${outer.id}/${inner.id} must be visually joined',
  );

  const double chassisCentreX = 100;
  final double outerDistance = (outer.x + outer.w / 2 - chassisCentreX).abs();
  final double innerDistance = (inner.x + inner.w / 2 - chassisCentreX).abs();
  expect(
    innerDistance,
    lessThan(outerDistance),
    reason:
        '$layoutKey ${inner.id} must be nearer the chassis than ${outer.id}',
  );
}
