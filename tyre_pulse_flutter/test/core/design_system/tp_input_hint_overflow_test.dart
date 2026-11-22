import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

/// A long placeholder, a large value style and a long subtitle must not
/// overflow on a 320 dp phone at 2x text, in light or dark.
void main() {
  for (final ThemeData theme in <ThemeData>[TpTheme.light, TpTheme.dark]) {
    testWidgets('long hints and subtitle fit 320dp at 2x (${theme.brightness})',
        (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
            ),
            child: child!,
          ),
          home: Scaffold(
            appBar: const TpAppBar(
              title: 'Tyre inspection',
              subtitle: 'DEMO-TM02 · SANY SY412C Transit Mixer · DEMO PLANT',
              subtitleMaxLines: 2,
            ),
            body: ListView(
              children: const <Widget>[
                TpSearchField(
                  hint: 'Search asset, reference, site or location',
                ),
                TpInput(
                  label: 'Odometer (km)',
                  hint: 'Enter the reading',
                  textStyle: TextStyle(fontSize: 34),
                  helperText:
                      'Filled in automatically from the fleet record. Change it '
                      'if this reading is from a different site.',
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  }
}
