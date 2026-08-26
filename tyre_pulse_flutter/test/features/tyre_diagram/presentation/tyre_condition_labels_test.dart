/// Tests for the localised condition legend text and the wheel
/// accessibility label builder (artifact section 7.2).
///
/// [AppLocalizations] has no BuildContext-free way to construct outside a
/// widget tree from a feature (`tp_localizations.dart` re-exports only the
/// base `AppLocalizations` type, not the generated per-locale
/// implementations), so each test briefly pumps a bare localised
/// [MaterialApp] to capture a real instance via a [Builder], then runs its
/// assertions against that captured value - the same pattern
/// `test/core/design_system/design_system_test_support.dart` uses for
/// widgets in this design system, adapted here for a PURE function that
/// merely happens to need [AppLocalizations] as an argument.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_labels.dart';

Future<AppLocalizations> _captureL10n(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
}) async {
  late AppLocalizations captured;
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Builder(
        builder: (BuildContext context) {
          captured = AppLocalizations.of(context);
          return const SizedBox.shrink();
        },
      ),
    ),
  );
  return captured;
}

void main() {
  testWidgets('tyreConditionLabel returns non-empty, distinct text for '
      'every condition', (WidgetTester tester) async {
    final AppLocalizations l10n = await _captureL10n(tester);
    final Set<String> labels = <String>{};
    for (final TyreCondition condition in TyreCondition.values) {
      final String label = tyreConditionLabel(l10n, condition);
      expect(label, isNotEmpty, reason: condition.name);
      labels.add(label);
    }
    expect(labels.length, TyreCondition.values.length);
  });

  testWidgets('tyreConditionLabel produces the exact English words', (
    WidgetTester tester,
  ) async {
    final AppLocalizations l10n = await _captureL10n(tester);
    expect(tyreConditionLabel(l10n, TyreCondition.good), 'Good');
    expect(tyreConditionLabel(l10n, TyreCondition.worn), 'Worn');
    expect(tyreConditionLabel(l10n, TyreCondition.damaged), 'Damaged');
    expect(tyreConditionLabel(l10n, TyreCondition.puncture), 'Puncture');
    expect(tyreConditionLabel(l10n, TyreCondition.flat), 'Flat');
    expect(tyreConditionLabel(l10n, TyreCondition.missing), 'Missing');
  });

  group('tyreConditionStatus', () {
    test('flat maps to warning, NOT critical - easy to get backwards', () {
      expect(tyreConditionStatus(TyreCondition.flat), TpStatus.warning);
    });

    test('good maps to ok', () {
      expect(tyreConditionStatus(TyreCondition.good), TpStatus.ok);
    });

    test('worn maps to warning', () {
      expect(tyreConditionStatus(TyreCondition.worn), TpStatus.warning);
    });

    test('damaged and puncture both map to critical', () {
      expect(tyreConditionStatus(TyreCondition.damaged), TpStatus.critical);
      expect(tyreConditionStatus(TyreCondition.puncture), TpStatus.critical);
    });

    test('missing maps to unknown - never measured, not "measured fine"', () {
      expect(tyreConditionStatus(TyreCondition.missing), TpStatus.unknown);
    });
  });

  group('normaliseCondition', () {
    test('legacy spellings fold onto the canonical value', () {
      expect(normaliseCondition('wear'), TyreCondition.worn);
      expect(normaliseCondition('damage'), TyreCondition.damaged);
    });

    test('is case-insensitive', () {
      expect(normaliseCondition('GOOD'), TyreCondition.good);
      expect(normaliseCondition('Puncture'), TyreCondition.puncture);
    });

    test('null and unrecognised text default to good, matching the '
        'production capture-form seed', () {
      expect(normaliseCondition(null), TyreCondition.good);
      expect(normaliseCondition('nonsense'), TyreCondition.good);
    });
  });

  testWidgets(
    'tyreDiagramAccessibilityLabel: code, condition and pressure, in order',
    (WidgetTester tester) async {
      final AppLocalizations l10n = await _captureL10n(tester);
      final String label = tyreDiagramAccessibilityLabel(
        l10n,
        code: 'LHCO',
        condition: TyreCondition.good,
        pressureText: '110',
      );
      expect(label, contains('LHCO'));
      expect(label, contains('Good'));
      expect(label, contains('110'));
      // The code must come before the condition, which must come before
      // the pressure - "LHCO, Good, pressure 110 psi", not reordered.
      expect(label.indexOf('LHCO'), lessThan(label.indexOf('Good')));
      expect(label.indexOf('Good'), lessThan(label.indexOf('110')));
    },
  );

  testWidgets(
    'tyreDiagramAccessibilityLabel omits the pressure clause entirely '
    'when no reading was recorded',
    (WidgetTester tester) async {
      final AppLocalizations l10n = await _captureL10n(tester);
      final String label = tyreDiagramAccessibilityLabel(
        l10n,
        code: 'LHF1',
        condition: TyreCondition.worn,
      );
      expect(label, contains('LHF1'));
      expect(label, contains('Worn'));
      expect(label, isNot(contains('psi')));
    },
  );
}
