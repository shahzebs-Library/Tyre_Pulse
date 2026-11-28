/// The per-condition colour tokens (owner, 2026-11-27): one colour per tyre
/// condition, each readable on both themes.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';

double _ratio(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  test('every condition fill carries white ink at 4.5:1 or better', () {
    for (final TpConditionColor c in TpConditionColors.all) {
      expect(
        _ratio(c.fill, Colors.white),
        greaterThanOrEqualTo(4.5),
        reason: 'fill $c',
      );
    }
  });

  test('accents keep 3:1 against the surfaces of their own theme', () {
    for (final TpConditionColor c in TpConditionColors.all) {
      for (final Color surface in <Color>[
        TpPalette.light.surface,
        TpPalette.light.surfaceAlt,
      ]) {
        expect(
          _ratio(c.accent(Brightness.light), surface),
          greaterThanOrEqualTo(3),
        );
      }
      for (final Color surface in <Color>[
        TpPalette.dark.surface,
        TpPalette.dark.surfaceAlt,
      ]) {
        expect(
          _ratio(c.accent(Brightness.dark), surface),
          greaterThanOrEqualTo(3),
        );
      }
    }
  });

  test('the six conditions have six different colours', () {
    final List<TpConditionColor> six = <TpConditionColor>[
      TpConditionColors.good,
      TpConditionColors.worn,
      TpConditionColors.damaged,
      TpConditionColors.puncture,
      TpConditionColors.flat,
      TpConditionColors.missing,
    ];
    expect(six.map((TpConditionColor c) => c.fill).toSet(), hasLength(6));
    expect(
      six.map((TpConditionColor c) => c.accent(Brightness.light)).toSet(),
      hasLength(6),
    );
    expect(
      six.map((TpConditionColor c) => c.accent(Brightness.dark)).toSet(),
      hasLength(6),
    );
  });
}
