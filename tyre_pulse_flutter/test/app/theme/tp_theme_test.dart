/// Tests for [TpTheme], which builds [ThemeData] from a [TpPalette].
///
/// The doc comment on `tp_theme.dart` explains why so little is set here: the
/// design system widgets own their own appearance, so only `colorScheme`,
/// `textTheme`, `scaffoldBackgroundColor`, `brightness`, `visualDensity` and
/// `dividerColor` are configured. This file checks exactly those fields
/// against the palette they are built from, and that the pairs of colours
/// the resulting `ColorScheme` puts text on top of each other actually read
/// clearly against one another.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';

/// A minimum, meaningful difference in relative luminance. Not a full WCAG
/// contrast ratio check; just "clearly different", which is what a colour
/// pair that ink is drawn on top of the other requires.
const double _kMinLuminanceDiff = 0.25;

void expectClearlyDifferent(String label, Color a, Color b) {
  final double diff = (a.computeLuminance() - b.computeLuminance()).abs();
  expect(
    diff,
    greaterThan(_kMinLuminanceDiff),
    reason: '$label: luminance difference was only ${diff.toStringAsFixed(4)}, '
        'below the $_kMinLuminanceDiff floor for legible ink on a fill',
  );
}

void main() {
  group('TpTheme.light and TpTheme.dark - the fields this file owns', () {
    test('brightness matches the palette it was built from', () {
      expect(TpTheme.light.brightness, Brightness.light);
      expect(TpTheme.dark.brightness, Brightness.dark);
    });

    test('material 3 is enabled', () {
      expect(TpTheme.light.useMaterial3, isTrue);
      expect(TpTheme.dark.useMaterial3, isTrue);
    });

    test('scaffoldBackgroundColor mirrors the palette background', () {
      expect(TpTheme.light.scaffoldBackgroundColor, TpPalette.light.background);
      expect(TpTheme.dark.scaffoldBackgroundColor, TpPalette.dark.background);
    });

    test('dividerColor mirrors the palette border', () {
      expect(TpTheme.light.dividerColor, TpPalette.light.border);
      expect(TpTheme.dark.dividerColor, TpPalette.dark.border);
    });

    test(
      'splashFactory is disabled, per spec section 55 on low-memory phones',
      () {
        expect(TpTheme.light.splashFactory, NoSplash.splashFactory);
        expect(TpTheme.dark.splashFactory, NoSplash.splashFactory);
      },
    );

    test(
      'visualDensity is standard so touch targets never shrink below 48dp',
      () {
        expect(TpTheme.light.visualDensity, VisualDensity.standard);
        expect(TpTheme.dark.visualDensity, VisualDensity.standard);
      },
    );

    test('textTheme is exactly what TpTypography builds for the palette', () {
      expect(
        TpTheme.light.textTheme,
        TpTypography.textThemeFor(TpPalette.light),
      );
      expect(TpTheme.dark.textTheme, TpTypography.textThemeFor(TpPalette.dark));
    });
  });

  group('ColorScheme - every field TpTheme explicitly sets', () {
    void expectSchemeMirrors(ColorScheme scheme, TpPalette palette) {
      expect(scheme.brightness, palette.brightness);
      expect(scheme.primary, palette.primary);
      expect(scheme.onPrimary, palette.onPrimary);
      expect(scheme.surface, palette.surface);
      expect(scheme.onSurface, palette.text);
      expect(scheme.error, palette.critical.base);
      expect(scheme.onError, palette.critical.onBase);
      expect(scheme.outline, palette.borderStrong);
      expect(scheme.outlineVariant, palette.border);
      expect(scheme.scrim, palette.overlay);
    }

    test('the light theme colour scheme', () {
      expectSchemeMirrors(TpTheme.light.colorScheme, TpPalette.light);
    });

    test('the dark theme colour scheme', () {
      expectSchemeMirrors(TpTheme.dark.colorScheme, TpPalette.dark);
    });
  });

  group('ColorScheme - the pairs that must read clearly', () {
    test('onPrimary against primary', () {
      final ColorScheme light = TpTheme.light.colorScheme;
      final ColorScheme dark = TpTheme.dark.colorScheme;
      expectClearlyDifferent(
        'light onPrimary/primary',
        light.onPrimary,
        light.primary,
      );
      expectClearlyDifferent(
        'dark onPrimary/primary',
        dark.onPrimary,
        dark.primary,
      );
    });

    test('onSurface (palette text) against surface', () {
      final ColorScheme light = TpTheme.light.colorScheme;
      final ColorScheme dark = TpTheme.dark.colorScheme;
      expectClearlyDifferent(
        'light onSurface/surface',
        light.onSurface,
        light.surface,
      );
      expectClearlyDifferent(
        'dark onSurface/surface',
        dark.onSurface,
        dark.surface,
      );
    });

    test('onError against error', () {
      final ColorScheme light = TpTheme.light.colorScheme;
      final ColorScheme dark = TpTheme.dark.colorScheme;
      expectClearlyDifferent('light onError/error', light.onError, light.error);
      expectClearlyDifferent('dark onError/error', dark.onError, dark.error);
    });
  });

  group('building a real app on these themes', () {
    testWidgets('MaterialApp with both themes registered does not throw', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: TpTheme.light,
          darkTheme: TpTheme.dark,
          home: const Scaffold(body: SizedBox.shrink()),
        ),
      );

      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'a subtree explicitly themed dark resolves TpPalette.dark through it',
      (WidgetTester tester) async {
        late Brightness resolvedBrightness;
        late TpPalette resolvedPalette;

        await tester.pumpWidget(
          MaterialApp(
            theme: TpTheme.light,
            home: Theme(
              data: TpTheme.dark,
              child: Builder(
                builder: (BuildContext context) {
                  resolvedBrightness = Theme.of(context).brightness;
                  resolvedPalette = TpPalette.of(context);
                  return const SizedBox.shrink();
                },
              ),
            ),
          ),
        );

        expect(tester.takeException(), isNull);
        expect(resolvedBrightness, Brightness.dark);
        expect(resolvedPalette, same(TpPalette.dark));
      },
    );
  });
}
