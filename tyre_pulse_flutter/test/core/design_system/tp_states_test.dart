/// Tests for the seven states in tp_states.dart.
///
/// AGENTS.md:
///
/// > Loading, empty, offline-cached, permission-denied, backend-unavailable,
/// > not-configured and error are seven different states with seven
/// > different renderings. A spinner is none of them.
///
/// The two things this file exists to pin: [TpLoadingState] is the only one
/// of the eight that ever shows a [CircularProgressIndicator], and the eight
/// keys in [TpStateKeys] really do identify eight different renderings
/// rather than the same view wearing different words.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

import 'design_system_test_support.dart';

// Every state other than TpLoadingState, keyed by the same name TpStateKeys
// uses. Declared once so the "never a spinner" sweep and the "own key only"
// sweep below cannot silently drift apart.
const Map<String, Widget> _nonLoadingStates = <String, Widget>{
  'empty': TpEmptyState(),
  'offlineCached': TpOfflineCachedState(),
  'permissionDenied': TpPermissionDeniedState(reason: 'No access.'),
  'backendUnavailable': TpBackendUnavailableState(),
  'notConfigured': TpNotConfiguredState(),
  'error': TpErrorState(error: AppError.network()),
  'screenNotAvailable': TpScreenNotAvailableState(),
};

void main() {
  group('TpLoadingState is the only state with a spinner', () {
    testWidgets('shows the default loading message', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpLoadingState());

      expect(find.byKey(TpStateKeys.loading), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Loading'), findsOneWidget);
    });

    testWidgets('a custom message replaces the default', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpLoadingState(message: 'Fetching your queue'),
      );

      expect(find.text('Fetching your queue'), findsOneWidget);
      expect(find.text('Loading'), findsNothing);
    });
  });

  for (final MapEntry<String, Widget> entry in _nonLoadingStates.entries) {
    testWidgets('${entry.key} never shows a spinner', (
      WidgetTester tester,
    ) async {
      // The production incident this file documents: a screen that is
      // denied, or has failed, or is empty must never look like it is still
      // working - that spinner never stops.
      await pumpTp(tester, entry.value);

      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  }

  group('each state key identifies a genuinely different rendering', () {
    for (final MapEntry<String, Widget> entry in _nonLoadingStates.entries) {
      testWidgets('${entry.key} renders under its own key only', (
        WidgetTester tester,
      ) async {
        await pumpTp(tester, entry.value);

        const Map<String, Key> keys = <String, Key>{
          'loading': TpStateKeys.loading,
          'empty': TpStateKeys.empty,
          'offlineCached': TpStateKeys.offlineCached,
          'permissionDenied': TpStateKeys.permissionDenied,
          'backendUnavailable': TpStateKeys.backendUnavailable,
          'notConfigured': TpStateKeys.notConfigured,
          'error': TpStateKeys.error,
          'screenNotAvailable': TpStateKeys.screenNotAvailable,
        };

        for (final MapEntry<String, Key> keyEntry in keys.entries) {
          final Matcher expected = keyEntry.key == entry.key
              ? findsOneWidget
              : findsNothing;
          expect(
            find.byKey(keyEntry.value),
            expected,
            reason: '${entry.key} was checked against key ${keyEntry.key}',
          );
        }
      });
    }
  });

  group('TpEmptyState', () {
    testWidgets('shows the default title and message', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpEmptyState());

      expect(find.text('Nothing here yet'), findsOneWidget);
      expect(
        find.text('When there is something to show, it will appear here.'),
        findsOneWidget,
      );
    });

    testWidgets('a custom title, message and icon replace the defaults', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpEmptyState(
          title: 'No inspections today',
          message: 'Everything due today has been completed.',
          icon: Icons.check_circle_outline,
        ),
      );

      expect(find.text('No inspections today'), findsOneWidget);
      expect(
        find.text('Everything due today has been completed.'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
      expect(find.text('Nothing here yet'), findsNothing);
    });

    testWidgets('an action label with no handler shows no button', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpEmptyState(actionLabel: 'Start one'));

      expect(find.byType(TpButton), findsNothing);
    });

    testWidgets('a handler with no label shows no button', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, TpEmptyState(onAction: () {}));

      expect(find.byType(TpButton), findsNothing);
    });

    testWidgets('a label with a handler shows a working button', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpTp(
        tester,
        TpEmptyState(actionLabel: 'Start one', onAction: () => taps++),
      );

      await tester.tap(find.text('Start one'));
      await tester.pump();

      expect(taps, 1);
    });
  });

  group('TpOfflineCachedState', () {
    testWidgets('shows the default title and message', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpOfflineCachedState());

      expect(find.text('Showing saved data'), findsOneWidget);
      expect(
        find.text(
          'You are offline. This is the copy saved on this device, so it '
          'may be out of date.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('an omitted cachedAtLabel shows no timestamp detail', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpOfflineCachedState());

      expect(find.textContaining('Saved '), findsNothing);
    });

    testWidgets('a cachedAtLabel says when the copy was taken', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineCachedState(cachedAtLabel: '12 Aug, 14:05'),
      );

      expect(find.text('Saved 12 Aug, 14:05'), findsOneWidget);
    });

    testWidgets('no retry handler means no retry button', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpOfflineCachedState());

      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('a retry handler renders a button that calls it', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpTp(tester, TpOfflineCachedState(onRetry: () => taps++));

      await tester.tap(find.text('Try again'));
      await tester.pump();

      expect(taps, 1);
    });
  });

  group('TpPermissionDeniedState requires a reason', () {
    testWidgets('the reason renders exactly as given', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpPermissionDeniedState(
          reason: 'You do not have access to this module.',
        ),
      );

      expect(find.text('No access to this screen'), findsOneWidget);
      expect(
        find.text('You do not have access to this module.'),
        findsOneWidget,
      );
    });

    testWidgets('with no onBack there is nothing to press', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpPermissionDeniedState(reason: 'No access.'));

      expect(find.text('Back'), findsNothing);
      expect(find.byType(TpButton), findsNothing);
    });

    testWidgets('onBack renders Back and calls it, without navigating away', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpTp(
        tester,
        TpPermissionDeniedState(reason: 'No access.', onBack: () => taps++),
      );

      await tester.tap(find.text('Back'));
      await tester.pump();

      expect(taps, 1);
      // The state itself does not navigate - only the caller's callback
      // does, and the widget is still on screen after it fires.
      expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
    });
  });

  group('TpBackendUnavailableState', () {
    testWidgets('shows the default reassurance about queued work', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpBackendUnavailableState());

      expect(find.text('The server is not responding'), findsOneWidget);
      expect(
        find.text(
          'Your work is safe on this device. It will be sent when the '
          'connection comes back.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('an optional detail line renders alongside the message', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpBackendUnavailableState(detail: 'Last tried 09:41'),
      );

      expect(find.text('Last tried 09:41'), findsOneWidget);
    });

    testWidgets('a retry handler renders a button that calls it', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpTp(tester, TpBackendUnavailableState(onRetry: () => taps++));

      await tester.tap(find.text('Try again'));
      await tester.pump();

      expect(taps, 1);
    });
  });

  group('TpNotConfiguredState', () {
    testWidgets('shows the default title and message', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpNotConfiguredState());

      expect(find.text('Not set up'), findsOneWidget);
      expect(
        find.text(
          'This part of the app has not been set up for your organisation. '
          'Your administrator can turn it on.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a custom title and a detail line both render', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpNotConfiguredState(
          title: 'Fuel tracking is off',
          detail: 'Ask an administrator to enable it for this site.',
        ),
      );

      expect(find.text('Fuel tracking is off'), findsOneWidget);
      expect(
        find.text('Ask an administrator to enable it for this site.'),
        findsOneWidget,
      );
    });

    testWidgets('offers no action at all - there is nothing to retry', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpNotConfiguredState());

      expect(find.byType(TpButton), findsNothing);
    });
  });

  group('TpErrorState shows only the message its AppError decided is safe', () {
    testWidgets('shows the message, never the technical detail', (
      WidgetTester tester,
    ) async {
      // Spec section 57: a user must never see a raw driver message such as
      // PostgrestException PGRST116. AppError.technical exists precisely to
      // keep that out of what this widget renders.
      const AppError error = AppError(
        kind: AppErrorKind.server,
        message: 'The last action did not finish.',
        technical: 'PostgrestException PGRST116',
      );

      await pumpTp(tester, const TpErrorState(error: error));

      expect(find.text('Something went wrong'), findsOneWidget);
      expect(find.text('The last action did not finish.'), findsOneWidget);
      expect(find.textContaining('PostgrestException'), findsNothing);
      expect(find.textContaining('PGRST116'), findsNothing);
    });

    testWidgets('a retryable error with a handler shows a working retry', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpTp(
        tester,
        TpErrorState(error: const AppError.network(), onRetry: () => taps++),
      );

      await tester.tap(find.text('Try again'));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('a non-retryable error offers no retry, even with a handler', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        TpErrorState(error: const AppError.authentication(), onRetry: () {}),
      );

      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('a retryable error with no handler offers no retry either', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpErrorState(error: AppError.network()));

      expect(find.text('Try again'), findsNothing);
    });
  });

  group('TpScreenNotAvailableState', () {
    testWidgets('shows the default title and message', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpScreenNotAvailableState());

      expect(find.text('This screen is not built yet'), findsOneWidget);
    });

    testWidgets('an optional route id renders as the detail line', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpScreenNotAvailableState(routeId: '/alerts'));

      expect(find.text('/alerts'), findsOneWidget);
    });

    testWidgets('an onBack handler renders Back and calls it', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pumpTp(tester, TpScreenNotAvailableState(onBack: () => taps++));

      await tester.tap(find.text('Back'));
      await tester.pump();

      expect(taps, 1);
    });
  });

  group('TpStateView is the shared shape every state above builds on', () {
    testWidgets('a detail line only shows when one is supplied', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpStateView(
          icon: Icons.info_outline,
          title: 'Title',
          message: 'Message',
        ),
      );
      expect(find.text('Extra detail line'), findsNothing);

      await pumpTp(
        tester,
        const TpStateView(
          icon: Icons.info_outline,
          title: 'Title',
          message: 'Message',
          detail: 'Extra detail line',
        ),
      );
      expect(find.text('Extra detail line'), findsOneWidget);
    });

    testWidgets('the primary and secondary actions are independent controls', (
      WidgetTester tester,
    ) async {
      int primaryTaps = 0;
      int secondaryTaps = 0;
      await pumpTp(
        tester,
        TpStateView(
          icon: Icons.info_outline,
          title: 'Title',
          message: 'Message',
          primaryActionLabel: 'Retry',
          onPrimaryAction: () => primaryTaps++,
          secondaryActionLabel: 'Dismiss',
          onSecondaryAction: () => secondaryTaps++,
        ),
      );

      await tester.tap(find.text('Retry'));
      await tester.pump();
      expect(primaryTaps, 1);
      expect(secondaryTaps, 0);

      await tester.tap(find.text('Dismiss'));
      await tester.pump();
      expect(primaryTaps, 1);
      expect(secondaryTaps, 1);
    });
  });

  testWidgets('renders under a right-to-left locale', (
    WidgetTester tester,
  ) async {
    await pumpTpRtl(
      tester,
      const TpPermissionDeniedState(reason: 'You do not have access.'),
    );

    expect(find.byKey(TpStateKeys.permissionDenied), findsOneWidget);
    expect(find.text('You do not have access.'), findsOneWidget);
  });
}
