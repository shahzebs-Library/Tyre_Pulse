import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_damage_zone_sheet.dart';

Future<void> _pump(
  WidgetTester tester, {
  required AccidentDamageSeverity value,
  required ValueChanged<AccidentDamageSeverity> onChanged,
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        body: AccidentDamageLevelSelector(value: value, onChanged: onChanged),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

ShapeBorder _shape(WidgetTester tester, AccidentDamageSeverity severity) =>
    tester
        .widget<Material>(
          find.byKey(
            ValueKey<String>('accident.damageZone.level.${severity.name}'),
          ),
        )
        .shape!;

void main() {
  test('levels map to ok / warning / critical', () {
    expect(
      accidentDamageLevelTone(AccidentDamageSeverity.minor),
      TpStatus.ok,
    );
    expect(
      accidentDamageLevelTone(AccidentDamageSeverity.moderate),
      TpStatus.warning,
    );
    expect(
      accidentDamageLevelTone(AccidentDamageSeverity.severe),
      TpStatus.critical,
    );
  });

  testWidgets('the selected level is tinted by status and keeps its words',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    AccidentDamageSeverity? picked;
    await _pump(
      tester,
      value: AccidentDamageSeverity.severe,
      onChanged: (AccidentDamageSeverity v) => picked = v,
    );
    final TpPalette palette = TpPalette.of(
      tester.element(find.byType(AccidentDamageLevelSelector)),
    );
    final RoundedRectangleBorder selected =
        _shape(tester, AccidentDamageSeverity.severe) as RoundedRectangleBorder;
    expect(selected.side.color, palette.critical.base);
    expect(find.text('Major'), findsOneWidget);
    expect(
      tester.getSemantics(find.text('Major')),
      matchesSemantics(
        label: 'Major',
        isButton: true,
        hasSelectedState: true,
        isSelected: true,
        isInMutuallyExclusiveGroup: true,
        hasTapAction: true,
      ),
    );
    for (final AccidentDamageSeverity s in AccidentDamageSeverity.values) {
      expect(
        tester
            .getSize(
              find.byKey(
                ValueKey<String>('accident.damageZone.level.${s.name}'),
              ),
            )
            .height,
        greaterThanOrEqualTo(48),
      );
    }
    await tester.tap(find.text('Minor'));
    expect(picked, AccidentDamageSeverity.minor);
    handle.dispose();
  });

  testWidgets('Arabic labels come from the ARB, not inline strings',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: TpTheme.light,
        locale: const Locale('ar'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Builder(
          builder: (BuildContext context) => Text(
            accidentDamageTypeLabel(context, AccidentDamageType.dent),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('انبعاج'), findsOneWidget);
    for (final AccidentDamageType type in AccidentDamageType.values) {
      expect(accidentDamageTypeIcon(type), isA<IconData>());
    }
  });
}
