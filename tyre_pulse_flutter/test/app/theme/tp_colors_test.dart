/// Tests for [TpPalette] and the status colour vocabulary.
///
/// The two properties that matter, per the doc comment on `tp_colors.dart`:
///
/// 1. Light and dark are meant to be visually distinct themes, not the same
///    hues at a different brightness. Every token pair is checked below.
/// 2. `TpStatus.unknown` must read as a different hue FAMILY from
///    `TpStatus.neutral`, not merely a lighter or darker shade of the same
///    grey-blue, because a measurement that was never taken must not look
///    like one that came back clean.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';

void main() {
  group('TpPalette.light and TpPalette.dark differ on every core token', () {
    void expectDiffers(String label, Color light, Color dark) {
      expect(
        light,
        isNot(dark),
        reason:
            '$label is the same colour in light and dark - the two themes '
            'are meant to be visually distinct.',
      );
    }

    test('surfaces, text, brand and border tokens', () {
      expectDiffers(
        'background',
        TpPalette.light.background,
        TpPalette.dark.background,
      );
      expectDiffers(
        'surface',
        TpPalette.light.surface,
        TpPalette.dark.surface,
      );
      expectDiffers(
        'surfaceAlt',
        TpPalette.light.surfaceAlt,
        TpPalette.dark.surfaceAlt,
      );
      expectDiffers(
        'surfaceSunken',
        TpPalette.light.surfaceSunken,
        TpPalette.dark.surfaceSunken,
      );
      expectDiffers('text', TpPalette.light.text, TpPalette.dark.text);
      expectDiffers(
        'textSecondary',
        TpPalette.light.textSecondary,
        TpPalette.dark.textSecondary,
      );
      expectDiffers(
        'textMuted',
        TpPalette.light.textMuted,
        TpPalette.dark.textMuted,
      );
      expectDiffers(
        'textInverse',
        TpPalette.light.textInverse,
        TpPalette.dark.textInverse,
      );
      expectDiffers(
        'primary',
        TpPalette.light.primary,
        TpPalette.dark.primary,
      );
      expectDiffers(
        'primaryDark',
        TpPalette.light.primaryDark,
        TpPalette.dark.primaryDark,
      );
      expectDiffers(
        'primarySoft',
        TpPalette.light.primarySoft,
        TpPalette.dark.primarySoft,
      );
      expectDiffers(
        'onPrimary',
        TpPalette.light.onPrimary,
        TpPalette.dark.onPrimary,
      );
      expectDiffers('border', TpPalette.light.border, TpPalette.dark.border);
      expectDiffers(
        'borderStrong',
        TpPalette.light.borderStrong,
        TpPalette.dark.borderStrong,
      );
      expectDiffers('focus', TpPalette.light.focus, TpPalette.dark.focus);
      expectDiffers(
        'overlay',
        TpPalette.light.overlay,
        TpPalette.dark.overlay,
      );
    });

    test('every leg of every status colour', () {
      void expectStatusDiffers(
        String label,
        TpStatusColors light,
        TpStatusColors dark,
      ) {
        expectDiffers('$label.base', light.base, dark.base);
        expectDiffers('$label.soft', light.soft, dark.soft);
        expectDiffers('$label.onBase', light.onBase, dark.onBase);
        expectDiffers('$label.onSoft', light.onSoft, dark.onSoft);
      }

      expectStatusDiffers('ok', TpPalette.light.ok, TpPalette.dark.ok);
      expectStatusDiffers(
        'warning',
        TpPalette.light.warning,
        TpPalette.dark.warning,
      );
      expectStatusDiffers(
        'critical',
        TpPalette.light.critical,
        TpPalette.dark.critical,
      );
      expectStatusDiffers('info', TpPalette.light.info, TpPalette.dark.info);
      expectStatusDiffers(
        'neutral',
        TpPalette.light.neutral,
        TpPalette.dark.neutral,
      );
      expectStatusDiffers(
        'unknown',
        TpPalette.light.unknown,
        TpPalette.dark.unknown,
      );
    });

    test('brightness is the constant that names each palette', () {
      expect(TpPalette.light.brightness, Brightness.light);
      expect(TpPalette.dark.brightness, Brightness.dark);
    });
  });

  group('sunlight readability (spec section 53)', () {
    test('light theme is near-black text on a near-white surface', () {
      // The doc comment names this explicitly: "near-black text" on
      // "bright near-white surfaces". Relative luminance is 0 for pure
      // black and 1 for pure white.
      expect(TpPalette.light.text.computeLuminance(), lessThan(0.05));
      expect(
        TpPalette.light.background.computeLuminance(),
        greaterThan(0.85),
      );
      expect(
        TpPalette.light.surface.computeLuminance(),
        greaterThan(0.85),
      );
    });
  });

  group('TpStatus vocabulary', () {
    test('exactly six statuses exist', () {
      // forStatus is a switch EXPRESSION with no default, so the compiler
      // already refuses a build where a new status is unhandled. This pins
      // the count as a readable regression marker alongside that guarantee.
      expect(TpStatus.values.length, 6);
      expect(
        TpStatus.values,
        containsAll(const <TpStatus>[
          TpStatus.ok,
          TpStatus.warning,
          TpStatus.critical,
          TpStatus.info,
          TpStatus.neutral,
          TpStatus.unknown,
        ]),
      );
    });

    test('forStatus is the one mapping - it returns the matching field', () {
      const TpPalette p = TpPalette.light;
      expect(p.forStatus(TpStatus.ok), same(p.ok));
      expect(p.forStatus(TpStatus.warning), same(p.warning));
      expect(p.forStatus(TpStatus.critical), same(p.critical));
      expect(p.forStatus(TpStatus.info), same(p.info));
      expect(p.forStatus(TpStatus.neutral), same(p.neutral));
      expect(p.forStatus(TpStatus.unknown), same(p.unknown));
    });

    test('forStatus agrees with the fields on the dark palette too', () {
      const TpPalette p = TpPalette.dark;
      for (final TpStatus status in TpStatus.values) {
        expect(
          p.forStatus(status),
          isA<TpStatusColors>(),
          reason: '$status must resolve to a colour set on every palette',
        );
      }
      expect(p.forStatus(TpStatus.critical), same(p.critical));
    });

    test('unknown is a different hue family from neutral, not a shade of it',
        () {
      double hueDiff(Color a, Color b) {
        final double raw =
            (HSLColor.fromColor(a).hue - HSLColor.fromColor(b).hue).abs();
        return raw > 180 ? 360 - raw : raw;
      }

      // Spec section 32, and the doc comment on TpPalette.light.unknown:
      // "not measured" must never be mistaken for "measured and
      // unremarkable" (neutral), so the two colours are deliberately from
      // different hue families rather than different shades of one hue.
      expect(
        hueDiff(TpPalette.light.neutral.base, TpPalette.light.unknown.base),
        greaterThan(30),
      );
      expect(
        hueDiff(TpPalette.dark.neutral.base, TpPalette.dark.unknown.base),
        greaterThan(30),
      );
    });
  });

  group('TpStatusColors', () {
    test('the const constructor keeps all four legs distinct', () {
      const TpStatusColors colors = TpStatusColors(
        base: Color(0xFF111111),
        soft: Color(0xFF222222),
        onBase: Color(0xFF333333),
        onSoft: Color(0xFF444444),
      );
      expect(colors.base, const Color(0xFF111111));
      expect(colors.soft, const Color(0xFF222222));
      expect(colors.onBase, const Color(0xFF333333));
      expect(colors.onSoft, const Color(0xFF444444));
    });
  });

  group('TpPalette.of resolves from the ambient Theme brightness', () {
    testWidgets('a light Theme resolves TpPalette.light',
        (WidgetTester tester) async {
      late TpPalette resolved;
      await tester.pumpWidget(
        MaterialApp(
          home: Theme(
            data: ThemeData(brightness: Brightness.light),
            child: Builder(
              builder: (BuildContext context) {
                resolved = TpPalette.of(context);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );

      expect(resolved, same(TpPalette.light));
    });

    testWidgets('a dark Theme resolves TpPalette.dark',
        (WidgetTester tester) async {
      late TpPalette resolved;
      await tester.pumpWidget(
        MaterialApp(
          home: Theme(
            data: ThemeData(brightness: Brightness.dark),
            child: Builder(
              builder: (BuildContext context) {
                resolved = TpPalette.of(context);
                return const SizedBox.shrink();
              },
            ),
          ),
        ),
      );

      expect(resolved, same(TpPalette.dark));
    });
  });
}
