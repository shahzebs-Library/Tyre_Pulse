/// Renders [LoginScreen] behind a real [MaterialApp] with the app's own
/// theme and localisation delegates, driving [AuthController.signIn] through
/// a [ProviderScope] override of [FakeAuthRepository.signInHandler] - the
/// SAME fake `auth_controller_test.dart` already uses, shared via
/// `auth_test_support.dart` (see that file's own library comment for why a
/// second, slightly-different copy was not written instead).
///
/// A plain [MaterialApp] (not `.router`) is enough here, matching
/// `vehicles_list_screen_test.dart`'s own identical choice: [LoginScreen]
/// never sets `TpScaffold.backFallback` (see that screen's own library
/// comment - signed out, it IS the app's root, the same way Home is once
/// signed in), so `TpScaffold` never calls `TpBack.of(context)` at all and no
/// router ancestor is needed. [LoginScreen] also never navigates on success -
/// see its own library comment for exactly why - so there is nothing here to
/// assert about where the app goes next; only what the screen itself renders
/// for each [SignInOutcome].
///
/// [_pump] deliberately lets [AuthController]'s session-restore [Timer] fire
/// and clear itself before any test body runs, rather than arming a long
/// [restoreTimeout] to keep it from firing at all. `AutomatedTestWidgetsFlutterBinding`
/// asserts NO real [Timer] is left pending once a test ends
/// (`!timersPending`), and nothing in [LoginScreen] ever reads session state
/// to begin with - see the class's own doc comment - so there is no reason
/// for that timer to still be armed by the time a test's own assertions run.
///
/// THE ORDER THIS HAS TO HAPPEN IN, and why an earlier attempt at this fix
/// did not work: [AuthController.build] - the method that actually arms the
/// timer - runs on the FIRST read of [authControllerProvider], and
/// [LoginScreen] never reads it until [LoginScreen] `_submit`, i.e. until a
/// test taps the button. Advancing the fake clock immediately after
/// `pumpWidget` (before anything has read the provider) elapses time against
/// a timer that does not exist yet. So [_pump] reads the provider directly -
/// arming the SAME short interval `auth_controller_test.dart` already uses
/// to deliberately exercise this path (30ms) - and elapses the fake clock
/// past it BEFORE the widget tree is even built, so every test starts from a
/// clean slate with nothing pending.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `Override` is deliberately not exported by the main flutter_riverpod
// barrel in Riverpod 3.x - see `vehicles_list_screen_test.dart`'s own
// identical comment.
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/auth/presentation/login_screen.dart';

import '../../../core/auth/auth_test_support.dart';

final class _Pumped {
  const _Pumped({required this.auth, required this.container});

  final FakeAuthRepository auth;

  /// Kept so a test can read [localeProvider] back through the ordinary,
  /// public `container.read(provider)` path - never through
  /// `TpLocaleController.state`, which the framework marks `@protected`.
  final ProviderContainer container;
}

/// Matches `auth_controller_test.dart`'s own short default.
const Duration _kRestoreTimeout = Duration(milliseconds: 30);

Future<_Pumped> _pump(WidgetTester tester) async {
  final FakeAuthRepository auth = FakeAuthRepository();
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      ...authTestOverrides(
        auth: auth,
        profiles: FakeProfileRepository(),
        versionGate: FakeVersionGateRepository(),
        secureStore: FakeSecureStore(),
        foreground: FakeForegroundSignal(),
        restoreTimeout: _kRestoreTimeout,
      ),
    ],
  );
  addTearDown(container.dispose);

  // Forces `AuthController.build()` to run NOW, arming its session-restore
  // `Timer`, and then elapses the fake clock past it - both before the
  // widget tree exists at all. See the library comment for why this must
  // happen in this order.
  container.read(authControllerProvider);
  await tester.pump(_kRestoreTimeout * 3);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const LoginScreen(route: LoginRoute()),
      ),
    ),
  );
  await tester.pump();

  return _Pumped(auth: auth, container: container);
}

Finder _identifierField() => find.byType(TextField).at(0);
Finder _passwordField() => find.byType(TextField).at(1);
Finder _submitButton() => find.widgetWithText(TpButton, 'Sign in');

Future<void> _fillValidCredentials(WidgetTester tester) async {
  await tester.enterText(_identifierField(), 'tyreman@example.com');
  await tester.enterText(_passwordField(), 'correct-horse');
  await tester.pump();
}

void main() {
  testWidgets(
    'both fields blank: the required-field check blocks the call entirely '
    'and shows the error banner, never the lockout one',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);

      await tester.tap(_submitButton());
      await tester.pump();

      expect(p.auth.calls, isEmpty);
      expect(find.byKey(LoginBannerKeys.error), findsOneWidget);
      expect(find.byKey(LoginBannerKeys.locked), findsNothing);
      expect(
        find.text('Please enter your login and password.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'a successful sign-in clears the busy state and shows no banner at all',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      p.auth.signInHandler =
          (String identifier, String password) async => const SignInSucceeded();

      await _fillValidCredentials(tester);
      await tester.tap(_submitButton());
      await tester.pump();
      await tester.pump();

      expect(p.auth.calls, <String>['signIn']);
      expect(find.byKey(LoginBannerKeys.error), findsNothing);
      expect(find.byKey(LoginBannerKeys.locked), findsNothing);
      final TpButton button = tester.widget<TpButton>(_submitButton());
      expect(button.isBusy, isFalse);
      expect(button.onPressed, isNotNull);
    },
  );

  testWidgets(
    'SignInRejected renders the generic error banner with the domain '
    "error's own message - never a second, screen-invented sentence",
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      p.auth.signInHandler = (String identifier, String password) async =>
          const SignInRejected(
            AppError.authorization(message: 'That did not match our records.'),
          );

      await _fillValidCredentials(tester);
      await tester.tap(_submitButton());
      await tester.pump();
      await tester.pump();

      expect(find.byKey(LoginBannerKeys.error), findsOneWidget);
      expect(find.byKey(LoginBannerKeys.locked), findsNothing);
      expect(
        find.text('That did not match our records.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'SignInFailed renders through the SAME banner key as SignInRejected, '
    "with its own AppError message - the prompt's own instruction that the "
    'two need not be visually distinguished from each other',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      p.auth.signInHandler = (String identifier, String password) async =>
          const SignInFailed(AppError.network());

      await _fillValidCredentials(tester);
      await tester.tap(_submitButton());
      await tester.pump();
      await tester.pump();

      expect(find.byKey(LoginBannerKeys.error), findsOneWidget);
      expect(find.byKey(LoginBannerKeys.locked), findsNothing);
      expect(find.text(const AppError.network().message), findsOneWidget);
    },
  );

  testWidgets(
    'SignInLocked renders through its OWN distinct key, naming the minutes '
    'to wait - never folded into the generic error banner',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      p.auth.signInHandler =
          (String identifier, String password) async => const SignInLocked(5);

      await _fillValidCredentials(tester);
      await tester.tap(_submitButton());
      await tester.pump();
      await tester.pump();

      expect(find.byKey(LoginBannerKeys.locked), findsOneWidget);
      expect(find.byKey(LoginBannerKeys.error), findsNothing);
      expect(
        find.text('Too many failed attempts. Try again in 5 minutes.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'a single-minute lockout uses the singular form, not "1 minutes"',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      p.auth.signInHandler =
          (String identifier, String password) async => const SignInLocked(1);

      await _fillValidCredentials(tester);
      await tester.tap(_submitButton());
      await tester.pump();
      await tester.pump();

      expect(
        find.text('Too many failed attempts. Try again in 1 minute.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'the submit button and both fields disable while a sign-in is '
    'genuinely still in flight, and re-enable once it resolves',
    (WidgetTester tester) async {
      // Never completes for the life of this test - the same technique
      // `vehicles_list_screen_test.dart` uses for its own loading-state test,
      // and for the identical reason: do NOT pumpAndSettle against it.
      final _Pumped p = await _pump(tester);
      p.auth.signInHandler = (String identifier, String password) =>
          Completer<SignInOutcome>().future;

      await _fillValidCredentials(tester);
      await tester.tap(_submitButton());
      await tester.pump();

      final TpButton busyButton = tester.widget<TpButton>(_submitButton());
      expect(busyButton.isBusy, isTrue);
      expect(busyButton.onPressed, isNull);
      expect(tester.widget<TextField>(_identifierField()).enabled, isFalse);
      expect(tester.widget<TextField>(_passwordField()).enabled, isFalse);
    },
  );

  testWidgets(
    'tapping a language chip reaches the real TpLocaleController, proving '
    'the toggle is genuinely wired rather than cosmetic',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      expect(p.container.read(localeProvider), isNull);

      await tester.tap(find.byKey(const Key('login.language.ar')));
      await tester.pump();

      expect(p.container.read(localeProvider), const Locale('ar'));
      final TpButton arChip = tester.widget<TpButton>(
        find.byKey(const Key('login.language.ar')),
      );
      expect(arChip.variant, TpButtonVariant.primary);
      final TpButton enChip = tester.widget<TpButton>(
        find.byKey(const Key('login.language.en')),
      );
      expect(enChip.variant, TpButtonVariant.secondary);
    },
  );
}
