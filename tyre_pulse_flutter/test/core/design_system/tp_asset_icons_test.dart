/// Tests for [TpAssetIcon].
library;

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

void main() {
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
      expect(find.byType(SvgPicture), findsNWidgets(8));
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
        home: const Scaffold(
          body: SizedBox(
            width: 220,
            child: Row(
              children: <Widget>[
                TpAssetIcon(TpAssetIconKind.mixer),
                SizedBox(width: 8),
                Expanded(
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
