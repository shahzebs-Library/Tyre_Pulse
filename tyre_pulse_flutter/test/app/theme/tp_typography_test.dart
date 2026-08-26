/// Tests for [TpTypography], the Material text theme built from a palette.
///
/// The doc comment sets the intent: one step larger and one weight heavier
/// than a typical application, readable at arm's length in direct sunlight,
/// with the muted greys used sparingly because glare washes out mid greys
/// first. This file pins the exact scale that intent produced, checks the
/// hierarchy it describes, and confirms only [TpTypography.textThemeFor]'s
/// documented single muted slot actually uses the muted ink.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';

void main() {
  group('TpTypography.textThemeFor - font size', () {
    final TextTheme light = TpTypography.textThemeFor(TpPalette.light);

    test('pins every declared font size', () {
      expect(light.displaySmall!.fontSize, 32);
      expect(light.headlineMedium!.fontSize, 26);
      expect(light.headlineSmall!.fontSize, 21);
      expect(light.titleLarge!.fontSize, 18);
      expect(light.titleMedium!.fontSize, 16);
      expect(light.bodyLarge!.fontSize, 15);
      expect(light.bodyMedium!.fontSize, 15);
      expect(light.labelLarge!.fontSize, 15);
      expect(light.labelMedium!.fontSize, 13);
      expect(light.labelSmall!.fontSize, 12);
    });

    test(
      'display, headline, title, then the 15pt tier, then label-medium and '
      'label-small strictly decrease',
      () {
        expect(
          light.displaySmall!.fontSize,
          greaterThan(light.headlineMedium!.fontSize),
        );
        expect(
          light.headlineMedium!.fontSize,
          greaterThan(light.headlineSmall!.fontSize),
        );
        expect(
          light.headlineSmall!.fontSize,
          greaterThan(light.titleLarge!.fontSize),
        );
        expect(
          light.titleLarge!.fontSize,
          greaterThan(light.titleMedium!.fontSize),
        );
        expect(
          light.titleMedium!.fontSize,
          greaterThan(light.bodyLarge!.fontSize),
        );
        expect(
          light.bodyLarge!.fontSize,
          greaterThan(light.labelMedium!.fontSize),
        );
        expect(
          light.labelMedium!.fontSize,
          greaterThan(light.labelSmall!.fontSize),
        );
      },
    );

    test('bodyLarge, bodyMedium and labelLarge deliberately tie at 15pt', () {
      // They are distinguished by weight and colour, not size - see the
      // weight and colour groups below. This is not a bug in the scale.
      expect(light.bodyLarge!.fontSize, light.bodyMedium!.fontSize);
      expect(light.bodyLarge!.fontSize, light.labelLarge!.fontSize);
    });
  });

  group('TpTypography.textThemeFor - font weight', () {
    final TextTheme light = TpTypography.textThemeFor(TpPalette.light);

    test('pins every declared font weight', () {
      expect(light.displaySmall!.fontWeight, FontWeight.w800);
      expect(light.headlineMedium!.fontWeight, FontWeight.w800);
      expect(light.headlineSmall!.fontWeight, FontWeight.w800);
      expect(light.titleLarge!.fontWeight, FontWeight.w700);
      expect(light.titleMedium!.fontWeight, FontWeight.w700);
      expect(light.bodyLarge!.fontWeight, FontWeight.w500);
      expect(light.bodyMedium!.fontWeight, FontWeight.w500);
      expect(light.labelLarge!.fontWeight, FontWeight.w700);
      expect(light.labelMedium!.fontWeight, FontWeight.w700);
      expect(light.labelSmall!.fontWeight, FontWeight.w600);
    });

    test('labelLarge is bold at the same size bodyLarge is regular weight at',
        () {
      expect(light.labelLarge!.fontSize, light.bodyLarge!.fontSize);
      expect(
        light.labelLarge!.fontWeight,
        isNot(light.bodyLarge!.fontWeight),
      );
    });
  });

  group('TpTypography.textThemeFor - letter spacing', () {
    final TextTheme light = TpTypography.textThemeFor(TpPalette.light);

    test('pins the four styles with a declared tracking value', () {
      expect(light.displaySmall!.letterSpacing, -0.5);
      expect(light.headlineMedium!.letterSpacing, -0.3);
      expect(light.headlineSmall!.letterSpacing, -0.2);
      expect(light.labelMedium!.letterSpacing, 0.2);
      expect(light.labelSmall!.letterSpacing, 0.2);
    });

    test('the remaining styles leave tracking null, not defaulted to zero', () {
      expect(light.titleLarge!.letterSpacing, isNull);
      expect(light.titleMedium!.letterSpacing, isNull);
      expect(light.bodyLarge!.letterSpacing, isNull);
      expect(light.bodyMedium!.letterSpacing, isNull);
      expect(light.labelLarge!.letterSpacing, isNull);
    });
  });

  group('TpTypography.textThemeFor - line height', () {
    final TextTheme light = TpTypography.textThemeFor(TpPalette.light);

    test('pins the exact height multiplier declared for every slot', () {
      expect(light.displaySmall!.height, 38 / 32);
      expect(light.headlineMedium!.height, 32 / 26);
      expect(light.headlineSmall!.height, 27 / 21);
      expect(light.titleLarge!.height, 24 / 18);
      expect(light.titleMedium!.height, 22 / 16);
      expect(light.bodyLarge!.height, 22 / 15);
      expect(light.bodyMedium!.height, 22 / 15);
      expect(light.labelLarge!.height, 20 / 15);
      expect(light.labelMedium!.height, 17 / 13);
      expect(light.labelSmall!.height, 16 / 12);
    });
  });

  group('TpTypography.textThemeFor - colour on the light palette', () {
    final TextTheme light = TpTypography.textThemeFor(TpPalette.light);

    test('display, headline, title, bodyLarge and labelLarge use full ink', () {
      for (final Color? color in <Color?>[
        light.displaySmall!.color,
        light.headlineMedium!.color,
        light.headlineSmall!.color,
        light.titleLarge!.color,
        light.titleMedium!.color,
        light.bodyLarge!.color,
        light.labelLarge!.color,
      ]) {
        expect(color, TpPalette.light.text);
      }
    });

    test('bodyMedium and labelMedium use the secondary ink', () {
      expect(light.bodyMedium!.color, TpPalette.light.textSecondary);
      expect(light.labelMedium!.color, TpPalette.light.textSecondary);
    });

    test('only labelSmall uses the muted ink - the scale uses it sparingly',
        () {
      expect(light.labelSmall!.color, TpPalette.light.textMuted);
      expect(light.displaySmall!.color, isNot(TpPalette.light.textMuted));
      expect(light.bodyLarge!.color, isNot(TpPalette.light.textMuted));
      expect(light.bodyMedium!.color, isNot(TpPalette.light.textMuted));
    });
  });

  group('TpTypography.textThemeFor - light and dark differ', () {
    test('every text colour slot resolves to a different colour per palette',
        () {
      final TextTheme light = TpTypography.textThemeFor(TpPalette.light);
      final TextTheme dark = TpTypography.textThemeFor(TpPalette.dark);

      expect(light.displaySmall!.color, isNot(dark.displaySmall!.color));
      expect(
        light.headlineMedium!.color,
        isNot(dark.headlineMedium!.color),
      );
      expect(light.headlineSmall!.color, isNot(dark.headlineSmall!.color));
      expect(light.titleLarge!.color, isNot(dark.titleLarge!.color));
      expect(light.titleMedium!.color, isNot(dark.titleMedium!.color));
      expect(light.bodyLarge!.color, isNot(dark.bodyLarge!.color));
      expect(light.bodyMedium!.color, isNot(dark.bodyMedium!.color));
      expect(light.labelLarge!.color, isNot(dark.labelLarge!.color));
      expect(light.labelMedium!.color, isNot(dark.labelMedium!.color));
      expect(light.labelSmall!.color, isNot(dark.labelSmall!.color));
    });

    test('sizes, weights and heights do not change between palettes', () {
      // Only colour is palette-dependent; the scale itself is one constant
      // shared by both themes.
      final TextTheme light = TpTypography.textThemeFor(TpPalette.light);
      final TextTheme dark = TpTypography.textThemeFor(TpPalette.dark);

      expect(light.displaySmall!.fontSize, dark.displaySmall!.fontSize);
      expect(light.displaySmall!.fontWeight, dark.displaySmall!.fontWeight);
      expect(light.displaySmall!.height, dark.displaySmall!.height);
      expect(light.labelSmall!.fontSize, dark.labelSmall!.fontSize);
      expect(light.labelSmall!.letterSpacing, dark.labelSmall!.letterSpacing);
    });
  });

  group('TpTypography.identifier', () {
    test('pins the exact style used for technical identifiers', () {
      final TextStyle style = TpTypography.identifier(TpPalette.light);
      expect(style.fontSize, 14);
      expect(style.height, 18 / 14);
      expect(style.fontWeight, FontWeight.w700);
      expect(style.letterSpacing, 0.4);
      expect(style.color, TpPalette.light.text);
    });

    test('carries tabular figures so a column of codes stays aligned', () {
      final TextStyle style = TpTypography.identifier(TpPalette.light);
      expect(
        style.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
    });

    test('colour differs between palettes, same as every other slot', () {
      expect(
        TpTypography.identifier(TpPalette.light).color,
        isNot(TpTypography.identifier(TpPalette.dark).color),
      );
    });
  });
}
