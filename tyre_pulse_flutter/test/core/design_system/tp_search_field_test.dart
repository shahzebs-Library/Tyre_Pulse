/// Tests for [TpSearchField].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  testWidgets('shows the default hint while empty',
      (WidgetTester tester) async {
    await pumpTp(tester, const TpSearchField());

    expect(find.text('Search'), findsOneWidget);
  });

  testWidgets('a custom hint replaces the default',
      (WidgetTester tester) async {
    await pumpTp(tester, const TpSearchField(hint: 'Search by asset number'));

    expect(find.text('Search by asset number'), findsOneWidget);
    expect(find.text('Search'), findsNothing);
  });

  testWidgets('typing fires onChanged with the typed value',
      (WidgetTester tester) async {
    String? changed;
    await pumpTp(tester, TpSearchField(onChanged: (String v) => changed = v));

    await tester.enterText(find.byType(TextField), 'TM514');
    await tester.pump();

    expect(changed, 'TM514');
  });

  group('the clear button appears exactly when there is something to clear',
      () {
    testWidgets('is absent while the field is empty',
        (WidgetTester tester) async {
      await pumpTp(tester, const TpSearchField());

      expect(find.byTooltip('Clear'), findsNothing);
    });

    testWidgets('appears once text is entered', (WidgetTester tester) async {
      await pumpTp(tester, const TpSearchField());

      await tester.enterText(find.byType(TextField), 'TM514');
      await tester.pump();

      expect(find.byTooltip('Clear'), findsOneWidget);
    });

    testWidgets('clears the field and reports an empty change',
        (WidgetTester tester) async {
      String? lastChange;
      await pumpTp(
        tester,
        TpSearchField(onChanged: (String v) => lastChange = v),
      );

      await tester.enterText(find.byType(TextField), 'TM514');
      await tester.pump();

      await tester.tap(find.byTooltip('Clear'));
      await tester.pump();

      final TextField field = tester.widget<TextField>(
        find.byType(TextField),
      );
      expect(field.controller?.text, '');
      expect(lastChange, '');
      expect(find.byTooltip('Clear'), findsNothing);
    });
  });

  testWidgets('onSubmitted fires when the field is submitted',
      (WidgetTester tester) async {
    String? submitted;
    await pumpTp(
      tester,
      TpSearchField(onSubmitted: (String v) => submitted = v),
    );

    await tester.enterText(find.byType(TextField), 'TM514');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();

    expect(submitted, 'TM514');
  });

  testWidgets('enabled: false disables the field', (WidgetTester tester) async {
    await pumpTp(tester, const TpSearchField(enabled: false));

    final TextField field = tester.widget<TextField>(find.byType(TextField));
    expect(field.enabled, isFalse);
  });

  testWidgets(
    'a controller the caller owns is not disposed by this widget',
    (WidgetTester tester) async {
      // The widget's own doc comment: "Disposing a controller the caller
      // owns is how a search box starts throwing 'used after being
      // disposed' on the second visit to a screen."
      final TextEditingController controller = TextEditingController();

      await pumpTp(tester, TpSearchField(controller: controller));
      await tester.enterText(find.byType(TextField), 'TM514');
      await tester.pump();

      // Unmount the widget, which runs its State.dispose().
      await tester.pumpWidget(const SizedBox.shrink());

      // If TpSearchField had already disposed the caller's controller, this
      // second dispose would throw. It must not.
      expect(controller.dispose, returnsNormally);
    },
  );

  testWidgets('renders under a right-to-left locale',
      (WidgetTester tester) async {
    await pumpTpRtl(tester, const TpSearchField(hint: 'Search'));

    expect(find.text('Search'), findsOneWidget);
  });
}
