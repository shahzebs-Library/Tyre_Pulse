import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_role_workspaces_primary.dart';

const snapshot = AccidentCaseSnapshot(
  accident: AccidentRecord(
    id: 'case',
    assetNo: 'CP045',
    site: 'Yard',
    incidentDate: '2026-09-01',
    driverName: 'Recorded driver',
    policeReportNo: 'POL-REAL',
    claimAmount: 900,
    recoveredAmount: 0,
    insurer: 'Recorded insurer',
    payer: 'other_party_insurance',
  ),
  provisioned: true,
  workstreams: <AccidentWorkstream>[
    AccidentWorkstream(
      id: 'fleet',
      key: 'fleet_validation',
      status: 'completed',
      team: 'Actual fleet team',
    ),
  ],
);

Future<void> pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(320, 760);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  final panels = <String, Widget>{
    'fleet': const AccidentFleetValidationWorkspace(snapshot: snapshot),
    'insurance': const AccidentInsuranceClaimsWorkspace(snapshot: snapshot),
    'responsibility':
        const AccidentResponsibilityPaymentWorkspace(snapshot: snapshot),
  };
  for (final entry in panels.entries) {
    for (final language in <String>['en', 'ar', 'ur']) {
      testWidgets('${entry.key} preserves real facts on compact $language',
          (tester) async {
        await pump(tester, entry.value, locale: Locale(language));
        expect(tester.takeException(), isNull);
        expect(find.textContaining('Ms. Fatima'), findsNothing);
        expect(find.textContaining('46,900'), findsNothing);
        expect(find.textContaining('Preview'), findsNothing);
        expect(find.text('100%'), findsNothing);
        for (final button
            in tester.widgetList<OutlinedButton>(find.byType(OutlinedButton))) {
          expect(button.onPressed, isNull);
        }
      });
    }
  }
  testWidgets(
      'a completed fleet workstream never fabricates item confirmations',
      (tester) async {
    await pump(tester, panels['fleet']!);
    expect(find.text('completed'), findsOneWidget);
    expect(find.text('Actual fleet team'), findsOneWidget);
    expect(find.text('Recorded driver'), findsOneWidget);
    expect(find.text('Not recorded'), findsWidgets);
    expect(find.byIcon(Icons.check_circle), findsNothing);
  });
  testWidgets(
      'claim amounts preserve recorded zero and unknown approved amount separately',
      (tester) async {
    await pump(tester, panels['insurance']!);
    expect(find.text('900'), findsOneWidget);
    expect(
      find.text('0'),
      findsNWidgets(2),
    ); // Evidence count and recorded recovery.
    expect(find.text('Recorded insurer'), findsOneWidget);
    expect(find.text('Not recorded'), findsWidgets);
  });
  testWidgets(
      'only recorded payer is selected and no local decision can be changed',
      (tester) async {
    await pump(tester, panels['responsibility']!);
    final selected = tester
        .widgetList<InputChip>(find.byType(InputChip))
        .where((chip) => chip.selected);
    expect(selected, hasLength(1));
    expect((selected.single.label as Text).data, 'Other-party insurance');
    expect(selected.single.onSelected, isNull);
    expect(find.text('POL-REAL'), findsOneWidget);
  });
  testWidgets('claim action invokes only the supplied existing flow',
      (tester) async {
    int calls = 0;
    await pump(
      tester,
      AccidentInsuranceClaimsWorkspace(
        snapshot: snapshot,
        onRegisterClaim: () => calls++,
      ),
    );
    final action = find.byWidgetPredicate(
      (widget) => widget is OutlinedButton && widget.onPressed != null,
    );
    await tester.ensureVisible(action);
    await tester.tap(action);
    expect(calls, 1);
  });
}
