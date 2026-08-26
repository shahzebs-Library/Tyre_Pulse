/// Tests for [TpBottomSheet] and [TpDialog] in tp_bottom_sheet.dart.
///
/// Both are returned as futures rather than fired and forgotten (the file's
/// own doc comment says `unawaited_futures` is an analyser error here for
/// exactly that reason), so every test captures and resolves that future
/// rather than only checking what is on screen.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  group('TpBottomSheet.show', () {
    testWidgets('renders the title and the content the builder returns',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<String?> future = TpBottomSheet.show<String>(
        context: context,
        title: 'Pick one',
        builder: (BuildContext sheetContext) => const Text('Sheet body'),
      );
      await tester.pumpAndSettle();

      expect(find.text('Pick one'), findsOneWidget);
      expect(find.text('Sheet body'), findsOneWidget);

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      await future;
    });

    testWidgets('resolves with whatever value the builder pops',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<String?> future = TpBottomSheet.show<String>(
        context: context,
        builder: (BuildContext sheetContext) => TpButton.primary(
          label: 'Choose',
          onPressed: () => Navigator.of(sheetContext).pop('picked'),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Choose'));
      await tester.pumpAndSettle();

      expect(await future, 'picked');
    });

    testWidgets('isDismissible: true, the default, closes on a barrier tap',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<String?> future = TpBottomSheet.show<String>(
        context: context,
        title: 'Pick one',
        builder: (BuildContext sheetContext) => const Text('Sheet body'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Pick one'), findsOneWidget);

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();

      expect(find.text('Pick one'), findsNothing);
      expect(await future, isNull);
    });

    testWidgets('isDismissible: false ignores a barrier tap',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<String?> future = TpBottomSheet.show<String>(
        context: context,
        title: 'Pick one',
        isDismissible: false,
        builder: (BuildContext sheetContext) => TpButton.primary(
          label: 'Choose',
          onPressed: () => Navigator.of(sheetContext).pop('picked'),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(find.text('Pick one'), findsOneWidget);

      await tester.tap(find.text('Choose'));
      await tester.pumpAndSettle();
      expect(await future, 'picked');
    });
  });

  group('TpDialog.confirm', () {
    testWidgets('renders the title, message and default button labels',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<bool> future = TpDialog.confirm(
        context: context,
        title: 'Delete tyre?',
        message: 'This cannot be undone.',
      );
      await tester.pumpAndSettle();

      expect(find.text('Delete tyre?'), findsOneWidget);
      expect(find.text('This cannot be undone.'), findsOneWidget);
      expect(find.text('Cancel'), findsOneWidget);
      expect(find.text('Close'), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await future;
    });

    testWidgets('Cancel resolves to false', (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<bool> future = TpDialog.confirm(
        context: context,
        title: 'Delete tyre?',
        message: 'This cannot be undone.',
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(await future, isFalse);
    });

    testWidgets('the confirm button resolves to true',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<bool> future = TpDialog.confirm(
        context: context,
        title: 'Delete tyre?',
        message: 'This cannot be undone.',
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();

      expect(await future, isTrue);
    });

    testWidgets('custom confirmLabel and cancelLabel replace the defaults',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<bool> future = TpDialog.confirm(
        context: context,
        title: 'Delete tyre?',
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      );
      await tester.pumpAndSettle();

      expect(find.text('Delete'), findsOneWidget);
      expect(find.text('Keep it'), findsOneWidget);
      expect(find.text('Close'), findsNothing);
      expect(find.text('Cancel'), findsNothing);

      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(await future, isTrue);
    });

    testWidgets(
      'dismissing without choosing resolves to false, never to a null a '
      'caller could mistake for consent',
      (WidgetTester tester) async {
        // The widget's own doc comment: "Resolves to false when the dialog
        // is dismissed without a choice, so a caller can never read a
        // dismissal as consent."
        await pumpTp(tester, const SizedBox());
        final BuildContext context = tester.element(find.byType(Scaffold));

        final Future<bool> future = TpDialog.confirm(
          context: context,
          title: 'Delete tyre?',
          message: 'This cannot be undone.',
        );
        await tester.pumpAndSettle();

        await tester.tapAt(const Offset(10, 10));
        await tester.pumpAndSettle();

        expect(find.text('Delete tyre?'), findsNothing);
        expect(await future, isFalse);
      },
    );

    testWidgets('isDestructive still resolves true from its confirm button',
        (WidgetTester tester) async {
      await pumpTp(tester, const SizedBox());
      final BuildContext context = tester.element(find.byType(Scaffold));

      final Future<bool> future = TpDialog.confirm(
        context: context,
        title: 'Delete tyre?',
        message: 'This cannot be undone.',
        isDestructive: true,
      );
      await tester.pumpAndSettle();

      // TODO(design-system): with isDestructive: true and no confirmLabel,
      // the destructive button falls back to l10n.actionClose ("Close") -
      // the same generic default the non-destructive path uses. A
      // destructive confirmation whose button reads "Close" by default is
      // worth a second look in tp_bottom_sheet.dart's TpDialog.confirm; this
      // test only pins that the RETURN VALUE is still correct.
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();

      expect(await future, isTrue);
    });
  });
}
