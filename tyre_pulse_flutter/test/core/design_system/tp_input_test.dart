/// Tests for [TpInput].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  testWidgets('the label renders', (WidgetTester tester) async {
    await pumpTp(tester, const TpInput(label: 'Serial number'));

    expect(find.text('Serial number'), findsOneWidget);
  });

  group('isRequired', () {
    testWidgets('true shows the required marker',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpInput(label: 'Serial number', isRequired: true),
      );

      expect(find.text('Required'), findsOneWidget);
    });

    testWidgets('false, the default, shows no marker',
        (WidgetTester tester) async {
      await pumpTp(tester, const TpInput(label: 'Serial number'));

      expect(find.text('Required'), findsNothing);
    });
  });

  testWidgets('the hint shows while the field is empty',
      (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpInput(label: 'Serial number', hint: 'e.g. YMA55312'),
    );

    expect(find.text('e.g. YMA55312'), findsOneWidget);
  });

  group('errorText', () {
    testWidgets('shows the message and puts the field into its error state',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpInput(label: 'Serial number', errorText: 'Required field'),
      );

      expect(find.text('Required field'), findsOneWidget);
      final TextField field = tester.widget<TextField>(
        find.byType(TextField),
      );
      expect(field.decoration?.errorText, 'Required field');
    });

    testWidgets('null, the default, carries no error',
        (WidgetTester tester) async {
      await pumpTp(tester, const TpInput(label: 'Serial number'));

      final TextField field = tester.widget<TextField>(
        find.byType(TextField),
      );
      expect(field.decoration?.errorText, isNull);
    });
  });

  testWidgets('helperText renders when supplied', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpInput(
        label: 'Serial number',
        helperText: 'Found on the tyre sidewall',
      ),
    );

    expect(find.text('Found on the tyre sidewall'), findsOneWidget);
  });

  group('entering text', () {
    testWidgets('onChanged fires with the typed value',
        (WidgetTester tester) async {
      String? changed;
      await pumpTp(
        tester,
        TpInput(label: 'Serial number', onChanged: (String v) => changed = v),
      );

      await tester.enterText(find.byType(TextField), 'YMA55312');
      await tester.pump();

      expect(changed, 'YMA55312');
    });

    testWidgets('onSubmitted fires when the field is submitted',
        (WidgetTester tester) async {
      String? submitted;
      await pumpTp(
        tester,
        TpInput(
          label: 'Serial number',
          onSubmitted: (String v) => submitted = v,
        ),
      );

      await tester.enterText(find.byType(TextField), 'YMA55312');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();

      expect(submitted, 'YMA55312');
    });

    testWidgets('a supplied controller keeps the field text in sync',
        (WidgetTester tester) async {
      final TextEditingController controller = TextEditingController();
      addTearDown(controller.dispose);

      await pumpTp(
        tester,
        TpInput(label: 'Serial number', controller: controller),
      );

      await tester.enterText(find.byType(TextField), 'YMA55312');
      await tester.pump();

      expect(controller.text, 'YMA55312');
    });
  });

  testWidgets('enabled: false disables the field', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpInput(label: 'Serial number', enabled: false),
    );

    final TextField field = tester.widget<TextField>(find.byType(TextField));
    expect(field.enabled, isFalse);
  });

  testWidgets('obscureText forces a single line even if maxLines says more',
      (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpInput(label: 'PIN', obscureText: true, maxLines: 5),
    );

    final TextField field = tester.widget<TextField>(find.byType(TextField));
    expect(field.obscureText, isTrue);
    expect(field.maxLines, 1);
  });

  testWidgets('maxLength passes through to the field',
      (WidgetTester tester) async {
    await pumpTp(tester, const TpInput(label: 'Code', maxLength: 6));

    final TextField field = tester.widget<TextField>(find.byType(TextField));
    expect(field.maxLength, 6);
  });

  testWidgets('a prefix icon renders', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpInput(label: 'Search', prefixIcon: Icons.search),
    );

    expect(find.byIcon(Icons.search), findsOneWidget);
  });

  testWidgets('a suffix widget renders as given', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpInput(
        label: 'Serial number',
        suffix: Icon(Icons.qr_code_scanner),
      ),
    );

    expect(find.byIcon(Icons.qr_code_scanner), findsOneWidget);
  });

  testWidgets('exposes itself as a text field to assistive technology',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    addTearDown(handle.dispose);

    await pumpTp(tester, const TpInput(label: 'Serial number'));

    expect(
      tester.getSemantics(find.byType(TextField)),
      matchesSemantics(isTextField: true),
    );
  });

  testWidgets('renders under a right-to-left locale',
      (WidgetTester tester) async {
    await pumpTpRtl(tester, const TpInput(label: 'Serial number'));

    expect(find.text('Serial number'), findsOneWidget);
  });
}
