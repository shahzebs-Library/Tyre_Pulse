/// Tests for the signature icon family: [TpAssetIcon], [TpIcon], [TpGem].
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

Widget _row(double size) => Wrap(
      children: <Widget>[
        for (final TpAssetIconKind kind in TpAssetIconKind.values)
          TpAssetIcon(kind, size: size),
      ],
    );

/// WCAG relative luminance of an sRGB colour.
double _luminance(Color c) {
  double f(double v) =>
      v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

double _contrastWithWhite(Color c) => 1.05 / (_luminance(c) + 0.05);

void main() {
  test('the family is exactly the fifteen approved glyphs', () {
    expect(TpAssetIconKind.values.map((TpAssetIconKind k) => k.name), <String>[
      'tyre',
      'mixer',
      'pump',
      'scan',
      'inspection',
      'approve',
      'accident',
      'wash',
      'sync',
      'issue',
      'gauge',
      'more',
      'home',
      'user',
      'bell',
    ]);
  });

  testWidgets('every kind renders as a vector at each size token', (
    WidgetTester tester,
  ) async {
    for (final double size in <double>[
      TpIconSize.sm,
      TpIconSize.md,
      TpIconSize.lg,
      TpIconSize.xl,
    ]) {
      await pumpTp(tester, _row(size));
      expect(find.byType(SvgPicture), findsNWidgets(15));
      expect(
        tester.getSize(find.byType(SvgPicture).first),
        Size(size, size),
      );
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('is decorative without a label and labelled with one', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      const Column(
        children: <Widget>[
          TpAssetIcon(TpAssetIconKind.mixer),
          TpAssetIcon(TpAssetIconKind.tyre, semanticLabel: 'Tyre'),
        ],
      ),
    );
    expect(find.bySemanticsLabel('Tyre'), findsOneWidget);
  });

  testWidgets('follows the ambient icon colour', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const IconTheme(
        data: IconThemeData(color: Color(0xFF123456)),
        child: TpAssetIcon(TpAssetIconKind.gauge),
      ),
    );
    final SvgPicture picture = tester.widget(find.byType(SvgPicture));
    expect(
      picture.colorFilter,
      const ColorFilter.mode(Color(0xFF123456), BlendMode.srcIn),
    );
  });

  testWidgets('TpIcon swaps mapped Material icons and leaves the rest', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      const Column(
        children: <Widget>[
          TpIcon(Icons.notifications_none_rounded),
          TpIcon(Icons.qr_code_scanner_rounded),
          TpIcon(Icons.chevron_right_rounded),
          TpIcon(Icons.speed_outlined),
        ],
      ),
    );
    expect(find.byType(SvgPicture), findsNWidgets(2));
    expect(find.byIcon(Icons.chevron_right_rounded), findsOneWidget);
    expect(find.byIcon(Icons.speed_outlined), findsOneWidget);
    expect(tpGlyphForMaterial(Icons.local_car_wash), TpAssetIconKind.wash);
    expect(tpGlyphForMaterial(Icons.warning_amber_rounded), isNull);
  });

  test('white glyph clears 3:1 where it sits on every gem tone', () {
    for (final TpGemTone tone in TpGemTone.values) {
      // The glyph occupies the middle of the tile; its lightest pixels sit
      // about a quarter of the way along the gradient.
      final Color lightest = Color.lerp(tone.start, tone.end, 0.25)!;
      expect(
        _contrastWithWhite(lightest),
        greaterThanOrEqualTo(3.0),
        reason: '${tone.name} gem glyph contrast',
      );
    }
  });

  testWidgets('gem tiles render at 48 and 64 with the glyph at 58%', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      Wrap(
        children: <Widget>[
          for (final TpGemSpec spec in TpGemSpec.values) ...<Widget>[
            TpGem.spec(spec),
            TpGem.spec(spec, size: TpGemSize.lg),
          ],
        ],
      ),
    );
    expect(find.byType(TpGem), findsNWidgets(TpGemSpec.values.length * 2));
    expect(tester.getSize(find.byType(TpGem).first), const Size(48, 48));
    expect(tester.getSize(find.byType(TpGem).at(1)), const Size(64, 64));
    final Size glyph = tester.getSize(find.byType(SvgPicture).first);
    expect(glyph.width, closeTo(48 * 0.58, 0.01));
    expect(tester.takeException(), isNull);
  });

  testWidgets('dark, right-to-left, 2x text: no overflow', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: TpTheme.dark,
        locale: const Locale('ar'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: const TextScaler.linear(2),
          ),
          child: child!,
        ),
        home: Scaffold(
          body: SizedBox(
            width: 260,
            child: Row(
              children: <Widget>[
                TpGem.spec(TpGemSpec.asset),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'محطة خلط الخرسانة رقم ١',
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });
}
