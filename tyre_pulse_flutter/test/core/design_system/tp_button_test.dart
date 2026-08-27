/// Tests for [TpButton].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  group('a variant selects the underlying control', () {
    testWidgets('primary renders a FilledButton', (WidgetTester tester) async {
      await pumpTp(tester, TpButton.primary(label: 'Save', onPressed: () {}));

      expect(find.widgetWithText(FilledButton, 'Save'), findsOneWidget);
    });

    testWidgets('secondary renders an OutlinedButton', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        TpButton.secondary(label: 'Cancel', onPressed: () {}),
      );

      expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsOneWidget);
    });

    testWidgets('danger renders a FilledButton', (WidgetTester tester) async {
      await pumpTp(tester, TpButton.danger(label: 'Delete', onPressed: () {}));

      expect(find.widgetWithText(FilledButton, 'Delete'), findsOneWidget);
    });

    testWidgets('text renders a TextButton', (WidgetTester tester) async {
      await pumpTp(tester, TpButton.text(label: 'Skip', onPressed: () {}));

      expect(find.widgetWithText(TextButton, 'Skip'), findsOneWidget);
    });

    testWidgets('the base constructor honours an explicit variant', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpButton(
          label: 'Explicit',
          onPressed: null,
          variant: TpButtonVariant.secondary,
        ),
      );

      expect(find.widgetWithText(OutlinedButton, 'Explicit'), findsOneWidget);
    });
  });

  group('the press callback', () {
    testWidgets('fires exactly once per tap', (WidgetTester tester) async {
      int taps = 0;
      await pumpTp(
        tester,
        TpButton.primary(label: 'Save', onPressed: () => taps++),
      );

      await tester.tap(find.text('Save'));
      await tester.pump();
      await tester.tap(find.text('Save'));
      await tester.pump();

      expect(taps, 2);
    });

    testWidgets('a null onPressed disables the control and never fires', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpButton.primary(label: 'Save', onPressed: null),
      );

      final FilledButton button = tester.widget<FilledButton>(
        find.byType(FilledButton),
      );
      expect(button.onPressed, isNull);

      // A disabled button must not throw when it is tapped.
      await tester.tap(find.byType(FilledButton), warnIfMissed: false);
      await tester.pump();
    });

    testWidgets('isBusy blocks the press even when onPressed is real', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpTp(
        tester,
        TpButton.primary(label: 'Save', onPressed: () => taps++, isBusy: true),
      );

      final FilledButton button = tester.widget<FilledButton>(
        find.byType(FilledButton),
      );
      expect(button.onPressed, isNull);

      await tester.tap(find.byType(FilledButton), warnIfMissed: false);
      await tester.pump();

      expect(taps, 0);
    });
  });

  group('the content swaps between a spinner and an icon', () {
    testWidgets('isBusy shows the only spinner this widget can show', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        TpButton.primary(
          label: 'Save',
          onPressed: () {},
          icon: Icons.save_outlined,
          isBusy: true,
        ),
      );

      // The spinner replaces the icon while busy, it does not sit beside it.
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byIcon(Icons.save_outlined), findsNothing);
      expect(find.text('Save'), findsOneWidget);
    });

    testWidgets('an icon shows when the button is not busy', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        TpButton.primary(
          label: 'Save',
          onPressed: () {},
          icon: Icons.save_outlined,
        ),
      );

      expect(find.byIcon(Icons.save_outlined), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('no icon and not busy shows neither', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, TpButton.primary(label: 'Save', onPressed: () {}));

      expect(find.byType(Icon), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });

  group('sizing never drops below the touch target minimum', () {
    // Spec section 53: the standard control is 52, but even the compact
    // control this design system offers is clamped up to the 48dp minimum -
    // see the arithmetic in TpButton.build. Measuring the RENDERED size
    // pins that clamp rather than trusting the source comment.
    testWidgets('the standard control clears the minimum height', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, TpButton.primary(label: 'Save', onPressed: () {}));

      final Size size = tester.getSize(find.byType(FilledButton));
      expect(size.height, greaterThanOrEqualTo(TpSizing.minTouchTarget));
    });

    testWidgets('a compact control still clears the minimum height', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        TpButton.primary(label: 'Save', onPressed: () {}, isCompact: true),
      );

      final Size size = tester.getSize(find.byType(FilledButton));
      expect(size.height, greaterThanOrEqualTo(TpSizing.minTouchTarget));
    });

    testWidgets('isFullWidth stretches the button wider than its default', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, TpButton.primary(label: 'Save', onPressed: () {}));
      final double defaultWidth =
          tester.getSize(find.byType(FilledButton)).width;

      await pumpTp(
        tester,
        TpButton.primary(label: 'Save', onPressed: () {}, isFullWidth: true),
      );
      final double fullWidth = tester.getSize(find.byType(FilledButton)).width;

      expect(fullWidth, greaterThan(defaultWidth));
    });
  });

  group('semantics', () {
    testWidgets('an enabled button exposes its label as a button', (
      WidgetTester tester,
    ) async {
      // Disposed with an explicit call at the end of the test body, not via
      // addTearDown: the binding's own end-of-test invariant check (no
      // SemanticsHandle left active) runs before addTearDown callbacks fire,
      // so an addTearDown-only disposal reads as a leak every time. This is
      // the exact pattern flutter_test's own `matchesSemantics` doc comment
      // uses.
      final SemanticsHandle handle = tester.ensureSemantics();

      await pumpTp(tester, TpButton.primary(label: 'Save', onPressed: () {}));

      // An enabled, focusable Material button genuinely exposes a tap
      // action, a focus action and isFocusable - that is what makes it
      // reachable from a keyboard or a switch device, not an incidental
      // extra. Omitting them here would assert that a real button is LESS
      // accessible than it actually is.
      expect(
        tester.getSemantics(find.byType(FilledButton)),
        matchesSemantics(
          label: 'Save',
          isButton: true,
          hasEnabledState: true,
          isEnabled: true,
          isFocusable: true,
          hasTapAction: true,
          hasFocusAction: true,
        ),
      );

      handle.dispose();
    });

    testWidgets('a disabled button reports itself as not enabled', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pumpTp(
        tester,
        const TpButton.primary(label: 'Save', onPressed: null),
      );

      // hasEnabledState: true is the flag itself, not an accident of being
      // disabled - it is what tells assistive technology this control HAS a
      // concept of being enabled, so announcing "disabled" means something.
      // A control with no enabled/disabled concept at all would omit it.
      expect(
        tester.getSemantics(find.byType(FilledButton)),
        matchesSemantics(
          label: 'Save',
          isButton: true,
          isEnabled: false,
          hasEnabledState: true,
        ),
      );

      handle.dispose();
    });
  });

  testWidgets('renders under a right-to-left locale', (
    WidgetTester tester,
  ) async {
    await pumpTpRtl(tester, TpButton.primary(label: 'Save', onPressed: () {}));

    expect(find.text('Save'), findsOneWidget);
  });
}
