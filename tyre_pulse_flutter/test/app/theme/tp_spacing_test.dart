/// Tests for the layout scale: [TpSpace], [TpRadius], [TpBorderWidth] and
/// [TpSizing].
///
/// Spec section 53 is the doc comment's own framing: a tight 4pt spacing
/// scale for density, and a minimum hit target that never shrinks below
/// Material's own 48dp floor for gloved, dusty hands. Every value here is
/// pinned to what the source actually declares, not merely asserted to be
/// positive, so a silent change to the scale is caught here rather than
/// discovered later as a layout regression.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// Every step, in declaration order. Every element is itself a
/// `static const double`, so this whole list is a compile-time constant.
const List<double> _kTpSpaceScale = <double>[
  TpSpace.xs,
  TpSpace.sm,
  TpSpace.md,
  TpSpace.lg,
  TpSpace.xl,
  TpSpace.xxl,
  TpSpace.xxxl,
  TpSpace.huge,
];

void main() {
  group('TpSpace - the 4pt scale', () {
    test('pins the exact scale', () {
      expect(TpSpace.xs, 4);
      expect(TpSpace.sm, 8);
      expect(TpSpace.md, 12);
      expect(TpSpace.lg, 16);
      expect(TpSpace.xl, 20);
      expect(TpSpace.xxl, 24);
      expect(TpSpace.xxxl, 32);
      expect(TpSpace.huge, 40);
    });

    test('every step is a strict increase over the last', () {
      for (int i = 1; i < _kTpSpaceScale.length; i++) {
        expect(
          _kTpSpaceScale[i],
          greaterThan(_kTpSpaceScale[i - 1]),
          reason:
              'step $i (${_kTpSpaceScale[i]}) must be larger than step '
              '${i - 1} (${_kTpSpaceScale[i - 1]})',
        );
      }
    });

    test('every step is a multiple of 4, per the doc comment', () {
      for (final double step in _kTpSpaceScale) {
        expect(step % 4, 0, reason: '$step is not on the 4pt scale');
      }
    });
  });

  group('TpRadius', () {
    test('pins the exact values', () {
      expect(TpRadius.sm, 8);
      expect(TpRadius.md, 12);
      expect(TpRadius.lg, 16);
      expect(TpRadius.xl, 20);
      expect(TpRadius.pill, 999);
    });

    test('the named radii strictly increase before the pill', () {
      expect(TpRadius.sm, lessThan(TpRadius.md));
      expect(TpRadius.md, lessThan(TpRadius.lg));
      expect(TpRadius.lg, lessThan(TpRadius.xl));
      expect(TpRadius.xl, lessThan(TpRadius.pill));
    });

    test('pill is large enough to round any control this app draws into a '
        'capsule', () {
      // A pill radius that were smaller than half the tallest standard
      // control would leave straight edges on the short sides instead of
      // a true stadium shape.
      expect(TpRadius.pill, greaterThanOrEqualTo(TpSizing.controlHeight));
    });
  });

  group('TpBorderWidth', () {
    test('pins hairline and strong, and strong is exactly double', () {
      expect(TpBorderWidth.hairline, 1);
      expect(TpBorderWidth.strong, 2);
      expect(TpBorderWidth.strong, TpBorderWidth.hairline * 2);
    });
  });

  group('TpSizing', () {
    test('pins the exact values', () {
      expect(TpSizing.minTouchTarget, 48);
      expect(TpSizing.controlHeight, 52);
      expect(TpSizing.controlHeightCompact, 40);
      expect(TpSizing.iconSm, 16);
      expect(TpSizing.iconMd, 20);
      expect(TpSizing.iconLg, 24);
      expect(TpSizing.iconState, 44);
      expect(TpSizing.stateMaxWidth, 420);
    });

    test('minTouchTarget never drops below the Material minimum of 48dp', () {
      expect(TpSizing.minTouchTarget, greaterThanOrEqualTo(48));
    });

    test('the standard control meets the minimum touch target', () {
      expect(
        TpSizing.controlHeight,
        greaterThanOrEqualTo(TpSizing.minTouchTarget),
      );
    });

    test('the compact control used inside dense rows is smaller than the '
        'standard one', () {
      expect(TpSizing.controlHeightCompact, lessThan(TpSizing.controlHeight));
    });

    test('icon sizes strictly increase from small to large', () {
      expect(TpSizing.iconSm, lessThan(TpSizing.iconMd));
      expect(TpSizing.iconMd, lessThan(TpSizing.iconLg));
    });

    test('the full-screen state icon is larger than every control icon', () {
      expect(TpSizing.iconState, greaterThan(TpSizing.iconLg));
      expect(TpSizing.iconState, greaterThan(TpSizing.iconMd));
      expect(TpSizing.iconState, greaterThan(TpSizing.iconSm));
    });
  });
}
