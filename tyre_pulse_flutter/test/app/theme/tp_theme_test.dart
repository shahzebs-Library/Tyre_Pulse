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
      // `ThemeData`'s own constructor merges whatever `textTheme` it is given
      // onto a Material-derived default (`packages/flutter/.../theme_data.dart`:
      // `textTheme = defaultTextTheme.merge(textTheme)`), and that default
      // itself is built from `colorScheme` and `brightness`
      // (`Typography.material2021(platform: ..., colorScheme: ...)`) - which
      // is why even a Material 3 role `TpTypography` never defines, such as
      // `displayLarge`, still comes out coloured with `palette.text`: it
      // inherited that from the SAME custom `colorScheme` `_themeFor` passed
      // in. `_themeFor` does nothing beyond handing `textTheme:` straight to
      // `ThemeData` alongside its own `colorScheme` and `brightness` (see
      // `tp_theme.dart`'s own doc comment on how little it configures), so
      // the true expectation is what `ThemeData` itself produces from those
      // three inputs - not the bare, unmerged `TpTypography` value, which
      // `Theme.of(context).textTheme` never actually hands to a widget.
      // Reconstructing the merge (rather than hand-picking fields) still
      // catches a real regression: a `_themeFor` that stopped passing
      // `textTheme:`, or passed the wrong palette, changes what this
      // equality reports. `colorScheme` is read live off the already-built
      // theme rather than re-derived, so this stays correct even if
      // `_themeFor`'s own colour-scheme construction changes later - that is
      // independently pinned by the "ColorScheme" group below.
      TextTheme mergedWith(ThemeData built, TpPalette palette) => ThemeData(
            useMaterial3: true,
            brightness: palette.brightness,
            colorScheme: built.colorScheme,
            textTheme: TpTypography.textThemeFor(palette),
          ).textTheme;

      expect(
        TpTheme.light.textTheme,
        mergedWith(TpTheme.light, TpPalette.light),
      );
      expect(
        TpTheme.dark.textTheme,
        mergedWith(TpTheme.dark, TpPalette.dark),
      );
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
