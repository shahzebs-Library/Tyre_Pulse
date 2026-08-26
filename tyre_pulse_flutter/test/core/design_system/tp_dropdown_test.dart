/// Tests for [TpDropdown].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

const List<TpDropdownItem<String>> _severities = <TpDropdownItem<String>>[
  TpDropdownItem<String>(value: 'ok', label: 'OK'),
  TpDropdownItem<String>(value: 'warning', label: 'Warning'),
  TpDropdownItem<String>(value: 'critical', label: 'Critical'),
];

void main() {
  testWidgets('the label renders', (WidgetTester tester) async {
    await pumpTp(
      tester,
      TpDropdown<String>(
        label: 'Severity',
        value: null,
        items: _severities,
        onChanged: (String? v) {},
      ),
    );

    expect(find.text('Severity'), findsOneWidget);
  });

  group('the current value', () {
    testWidgets('a null value shows the hint', (WidgetTester tester) async {
      await pumpTp(
        tester,
        TpDropdown<String>(
          label: 'Severity',
          value: null,
          items: _severities,
          onChanged: (String? v) {},
        ),
      );

      expect(find.text('Select'), findsOneWidget);
    });

    testWidgets('a custom hint replaces the default',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        TpDropdown<String>(
          label: 'Severity',
          value: null,
          hint: 'Choose a severity',
          items: _severities,
          onChanged: (String? v) {},
        ),
      );

      expect(find.text('Choose a severity'), findsOneWidget);
      expect(find.text('Select'), findsNothing);
    });

    testWidgets("a chosen value shows that item's label, not the hint",
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        TpDropdown<String>(
          label: 'Severity',
          value: 'warning',
          items: _severities,
          onChanged: (String? v) {},
        ),
      );

      expect(find.text('Warning'), findsOneWidget);
      expect(find.text('Select'), findsNothing);
    });
  });

  testWidgets('choosing an option calls onChanged with its value',
      (WidgetTester tester) async {
    String? chosen;
    await pumpTp(
      tester,
      TpDropdown<String>(
        label: 'Severity',
        value: 'ok',
        items: _severities,
        onChanged: (String? v) => chosen = v,
      ),
    );

    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Critical').last);
    await tester.pumpAndSettle();

    expect(chosen, 'critical');
  });

  group('a disabled dropdown never claims to be interactive', () {
    testWidgets('onChanged: null disables it', (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpDropdown<String>(
          label: 'Severity',
          value: 'ok',
          items: _severities,
          onChanged: null,
        ),
      );

      final DropdownButton<String> button =
          tester.widget<DropdownButton<String>>(
        find.byType(DropdownButton<String>),
      );
      expect(button.onChanged, isNull);
    });

    testWidgets('enabled: false disables it even with a real onChanged',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        TpDropdown<String>(
          label: 'Severity',
          value: 'ok',
          items: _severities,
          onChanged: (String? v) {},
          enabled: false,
        ),
      );

      final DropdownButton<String> button =
          tester.widget<DropdownButton<String>>(
        find.byType(DropdownButton<String>),
      );
      expect(button.onChanged, isNull);
    });

    testWidgets(
      'an empty item list disables it even with a real onChanged',
      (WidgetTester tester) async {
        // Repository rule 7: a control that opens and has nothing it could
        // possibly change to is not being honest about what it can do.
        await pumpTp(
          tester,
          TpDropdown<String>(
            label: 'Severity',
            value: null,
            items: const <TpDropdownItem<String>>[],
            onChanged: (String? v) {},
          ),
        );

        final DropdownButton<String> button =
            tester.widget<DropdownButton<String>>(
          find.byType(DropdownButton<String>),
        );
        expect(button.onChanged, isNull);
      },
    );
  });

  testWidgets('isRequired shows the required marker',
      (WidgetTester tester) async {
    await pumpTp(
      tester,
      TpDropdown<String>(
        label: 'Severity',
        value: null,
        items: _severities,
        onChanged: (String? v) {},
        isRequired: true,
      ),
    );

    expect(find.text('Required'), findsOneWidget);
  });

  testWidgets('errorText renders below the control',
      (WidgetTester tester) async {
    await pumpTp(
      tester,
      TpDropdown<String>(
        label: 'Severity',
        value: null,
        items: _severities,
        onChanged: (String? v) {},
        errorText: 'Pick a severity',
      ),
    );

    expect(find.text('Pick a severity'), findsOneWidget);
  });

  testWidgets('renders under a right-to-left locale',
      (WidgetTester tester) async {
    await pumpTpRtl(
      tester,
      TpDropdown<String>(
        label: 'Severity',
        value: null,
        items: _severities,
        onChanged: (String? v) {},
      ),
    );

    expect(find.text('Severity'), findsOneWidget);
  });
}
