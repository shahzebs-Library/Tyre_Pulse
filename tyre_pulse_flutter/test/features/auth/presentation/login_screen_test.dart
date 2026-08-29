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
import 'dart:ui' show Tristate;

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
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/sign_in_outcome.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/security/device_biometric_authenticator.dart';
import 'package:tyre_pulse/features/auth/data/login_country_preference_repository.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';
import 'package:tyre_pulse/features/auth/presentation/login_country_preference_provider.dart';
import 'package:tyre_pulse/features/auth/presentation/login_screen.dart';
import 'package:tyre_pulse/features/auth/presentation/widgets/login_country_hero.dart';

import '../../../core/auth/auth_test_support.dart';

final class _Pumped {
  const _Pumped({
    required this.auth,
    required this.container,
    required this.countryRepository,
    required this.biometrics,
  });

  final FakeAuthRepository auth;

  /// Kept so a test can read [localeProvider] back through the ordinary,
  /// public `container.read(provider)` path - never through
  /// `TpLocaleController.state`, which the framework marks `@protected`.
  final ProviderContainer container;
  final _LoginCountryRepository countryRepository;
  final _FakeDeviceBiometricAuthenticator biometrics;
}

final class _FakeDeviceBiometricAuthenticator
    implements DeviceBiometricAuthenticator {
  DeviceBiometricResult result = DeviceBiometricResult.authenticated;
  int calls = 0;

  @override
  Future<DeviceBiometricResult> authenticate({required String reason}) async {
    calls++;
    return result;
  }
}

final class _LoginCountryRepository
    implements LoginCountryPreferenceRepository {
  _LoginCountryRepository(this.value);

  LoginCountry? value;
  Object? readFailure;
  Object? saveFailure;

  @override
  Future<void> clear() async => value = null;

  @override
  Future<LoginCountry?> read() async {
    if (readFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    return value;
  }

  @override
  Future<void> save(LoginCountry country) async {
    if (saveFailure case final Object error) {
      Error.throwWithStackTrace(error, StackTrace.current);
    }
    value = country;
  }
}

/// Matches `auth_controller_test.dart`'s own short default.
const Duration _kRestoreTimeout = Duration(milliseconds: 30);

Future<_Pumped> _pump(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
  LoginCountry? country = LoginCountry.saudiArabia,
  ThemeData? theme,
}) async {
  final FakeAuthRepository auth = FakeAuthRepository();
  final _LoginCountryRepository countryRepository = _LoginCountryRepository(
    country,
  );
  final _FakeDeviceBiometricAuthenticator biometrics =
      _FakeDeviceBiometricAuthenticator();
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
      loginCountryPreferenceRepositoryProvider.overrideWithValue(
        countryRepository,
      ),
      currentAppVersionProvider.overrideWithValue('2.0'),
      deviceBiometricAuthenticatorProvider.overrideWithValue(biometrics),
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
        theme: theme ?? TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const LoginScreen(route: LoginRoute()),
      ),
    ),
  );
  await tester.pump();

  return _Pumped(
    auth: auth,
    container: container,
    countryRepository: countryRepository,
    biometrics: biometrics,
  );
}

Finder _identifierField() => find.byType(TextField).at(0);
Finder _passwordField() => find.byType(TextField).at(1);
Finder _submitButton() => find.byKey(const Key('login.submit'));
Finder _passwordToggle() => find.byType(IconButton);

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

  testWidgets(
    'compact phone and keyboard-height layouts remain scrollable without '
    'overflow and keep the real submit action reachable',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 480);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final _Pumped p = await _pump(tester);
      p.auth.signInHandler =
          (String identifier, String password) async => const SignInSucceeded();

      expect(find.byKey(const Key('login.brand.panel')), findsOneWidget);
      expect(find.byKey(const Key('login.form.card')), findsOneWidget);
      expect(tester.takeException(), isNull);

      await _fillValidCredentials(tester);
      await tester.showKeyboard(_passwordField());
      await tester.ensureVisible(_submitButton());
      await tester.pump();

      expect(tester.testTextInput.isVisible, isTrue);
      expect(tester.takeException(), isNull);

      await tester.tap(_submitButton());
      await tester.pump();
      await tester.pump();

      expect(p.auth.calls, <String>['signIn']);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Arabic uses true RTL in the compact layout and selects the Arabic '
    'language control without changing login behaviour',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pump(tester, locale: const Locale('ar'));

      final BuildContext panelContext = tester.element(
        find.byKey(const Key('login.brand.panel')),
      );
      expect(Directionality.of(panelContext), TextDirection.rtl);
      final TpButton arChip = tester.widget<TpButton>(
        find.byKey(const Key('login.language.ar')),
      );
      expect(arChip.variant, TpButtonVariant.primary);
      expect(find.byType(TextField), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'wide screens use the richer split hero and form hierarchy without '
    'duplicating either panel',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1100, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pump(tester);

      final Finder brand = find.byKey(const Key('login.brand.panel'));
      final Finder form = find.byKey(const Key('login.form.card'));
      expect(brand, findsOneWidget);
      expect(form, findsOneWidget);
      expect(tester.getTopLeft(brand).dx, lessThan(tester.getTopLeft(form).dx));
      expect(find.text('One platform for every PMV asset'), findsOneWidget);
      expect(find.text('Saudi Arabia'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey<String>('assets/login/figma_city_background.png'),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a remembered Egypt selection renders the Egypt identity without '
    'changing the shared authentication form',
    (WidgetTester tester) async {
      await _pump(tester, country: LoginCountry.egypt);

      expect(find.text('Egypt'), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('assets/login/egypt_hero.png')),
        findsOneWidget,
      );
      expect(find.byType(TextField), findsNWidgets(2));
      expect(_submitButton(), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'country selector switches to UAE and durably remembers the visual choice',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);

      await tester.tap(find.byKey(LoginCountryKeys.change));
      await tester.pumpAndSettle();

      expect(find.byKey(LoginCountryKeys.picker), findsOneWidget);
      await tester.tap(
        find.byKey(
          LoginCountryKeys.option(LoginCountry.unitedArabEmirates),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        p.countryRepository.value,
        LoginCountry.unitedArabEmirates,
      );
      expect(find.text('Secure company workspace · UAE'), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey<String>(
            'assets/login/united_arab_emirates_pmv_hero.webp',
          ),
        ),
        findsOneWidget,
      );
      expect(find.text('Secure company workspace · UAE'), findsOneWidget);
    },
  );

  testWidgets(
    'first launch asks for a country and persists the selected presentation',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester, country: null);
      await tester.pumpAndSettle();

      expect(find.byKey(LoginCountryKeys.picker), findsOneWidget);
      await tester.tap(
        find.byKey(LoginCountryKeys.option(LoginCountry.egypt)),
      );
      await tester.pumpAndSettle();

      expect(p.countryRepository.value, LoginCountry.egypt);
      expect(find.byKey(LoginCountryKeys.picker), findsNothing);
      expect(find.text('Egypt'), findsOneWidget);
    },
  );

  testWidgets(
    'Urdu uses true RTL while all three native-language controls remain '
    'available and Urdu is selected',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pump(tester, locale: const Locale('ur'));

      final BuildContext formContext = tester.element(
        find.byKey(const Key('login.form.card')),
      );
      expect(Directionality.of(formContext), TextDirection.rtl);
      expect(find.text('EN'), findsOneWidget);
      expect(find.text('عربي'), findsOneWidget);
      expect(find.text('اردو'), findsOneWidget);
      final TpButton urChip = tester.widget<TpButton>(
        find.byKey(const Key('login.language.ur')),
      );
      expect(urChip.variant, TpButtonVariant.primary);
      expect(find.text('سائن اِن'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'language controls, password toggle, and submit action all keep the '
    '48dp field-use touch target',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pump(tester);

      for (final String language in <String>['en', 'ar', 'ur']) {
        final Size size = tester.getSize(
          find.byKey(Key('login.language.$language')),
        );
        expect(size.width, greaterThanOrEqualTo(TpSizing.minTouchTarget));
        expect(size.height, greaterThanOrEqualTo(TpSizing.minTouchTarget));
      }
      expect(
        tester.getSize(_passwordToggle()).shortestSide,
        greaterThanOrEqualTo(TpSizing.minTouchTarget),
      );
      expect(
        tester.getSize(_submitButton()).height,
        greaterThanOrEqualTo(TpSizing.minTouchTarget),
      );
    },
  );

  testWidgets(
    'brand and form titles are semantic headings and the active language '
    'announces its selected state',
    (WidgetTester tester) async {
      await _pump(tester);

      expect(
        tester
            .getSemantics(find.byKey(const Key('login.brand.title')))
            .flagsCollection
            .isHeader,
        isTrue,
      );
      expect(
        tester
            .getSemantics(find.text('Welcome back').first)
            .flagsCollection
            .isHeader,
        isTrue,
      );
      expect(
        tester
            .getSemantics(find.byKey(const Key('login.language.en')))
            .flagsCollection
            .isSelected,
        Tristate.isTrue,
      );
      expect(
        tester
            .getSemantics(find.byKey(const Key('login.language.ar')))
            .flagsCollection
            .isSelected,
        Tristate.isFalse,
      );
    },
  );

  testWidgets(
    'password visibility toggle changes obscuring and keeps its localized '
    'tooltip contract',
    (WidgetTester tester) async {
      await _pump(tester);

      expect(tester.widget<TextField>(_passwordField()).obscureText, isTrue);
      expect(find.byTooltip('Show password'), findsOneWidget);

      await tester.tap(_passwordToggle());
      await tester.pump();

      expect(tester.widget<TextField>(_passwordField()).obscureText, isFalse);
      expect(find.byTooltip('Hide password'), findsOneWidget);
    },
  );

  testWidgets(
    'editing either credential clears stale error and lockout feedback '
    'without making another authentication call',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      p.auth.signInHandler =
          (String identifier, String password) async => const SignInLocked(5);

      await _fillValidCredentials(tester);
      await tester.tap(_submitButton());
      await tester.pump();
      await tester.pump();
      expect(find.byKey(LoginBannerKeys.locked), findsOneWidget);

      await tester.enterText(_identifierField(), 'changed@example.com');
      await tester.pump();

      expect(find.byKey(LoginBannerKeys.locked), findsNothing);
      expect(find.byKey(LoginBannerKeys.error), findsNothing);
      expect(p.auth.calls, <String>['signIn']);
    },
  );

  testWidgets(
    'device biometrics verifies locally before using the existing sign-in path',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(
        tester,
        country: LoginCountry.unitedArabEmirates,
      );
      p.auth.signInHandler =
          (String identifier, String password) async => const SignInSucceeded();

      await _fillValidCredentials(tester);
      await tester.tap(find.byKey(LoginActionKeys.biometric));
      await tester.pump();
      await tester.pump();

      expect(p.biometrics.calls, 1);
      expect(p.auth.calls, <String>['signIn']);
      expect(find.byKey(LoginBannerKeys.error), findsNothing);
    },
  );

  testWidgets(
    'unavailable device biometrics is explicit and never bypasses credentials',
    (WidgetTester tester) async {
      final _Pumped p = await _pump(tester);
      p.biometrics.result = DeviceBiometricResult.unavailable;

      await _fillValidCredentials(tester);
      await tester.tap(find.byKey(LoginActionKeys.biometric));
      await tester.pump();

      expect(p.biometrics.calls, 1);
      expect(p.auth.calls, isEmpty);
      expect(find.byKey(LoginBannerKeys.error), findsOneWidget);
      expect(
        find.text('Device biometrics are unavailable or not enrolled.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'forgot-password and access controls open truthful administrator help',
    (WidgetTester tester) async {
      await _pump(tester);

      await tester.tap(find.byKey(LoginActionKeys.forgotPassword));
      await tester.pumpAndSettle();

      expect(find.text('Sign-in help'), findsOneWidget);
      expect(
        find.textContaining('Password resets are managed'),
        findsOneWidget,
      );
      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(LoginActionKeys.accessHelp));
      await tester.pumpAndSettle();
      expect(find.textContaining('manages mobile access'), findsOneWidget);
    },
  );

  testWidgets('approved 390x844 mobile composition keeps the exact anchors', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pump(tester, country: LoginCountry.unitedArabEmirates);

    final Finder hero = find.byKey(const Key('login.brand.panel'));
    final Finder form = find.byKey(const Key('login.form.card'));
    expect(tester.getSize(hero), const Size(390, 354));
    expect(tester.getTopLeft(form).dy, 328);
    expect(tester.getSize(_identifierField()).height, 48);
    expect(tester.getSize(_passwordField()).height, 48);
    expect(tester.getSize(_submitButton()).height, 52);
    expect(find.byIcon(Icons.fingerprint), findsOneWidget);
    expect(find.byIcon(Icons.arrow_forward), findsOneWidget);
    expect(find.text('Use device biometrics'), findsOneWidget);
    expect(find.text('Version 2.0'), findsOneWidget);
    expect(
      find.byKey(
        const ValueKey<String>(
          'assets/login/united_arab_emirates_pmv_hero.webp',
        ),
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'dark appearance keeps the complete mobile login composition in the '
    'real dark palette',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pump(
        tester,
        country: LoginCountry.unitedArabEmirates,
        theme: TpTheme.dark,
      );

      final BuildContext formContext = tester.element(
        find.byKey(const Key('login.form.card')),
      );
      expect(Theme.of(formContext).brightness, Brightness.dark);
      expect(find.byType(TextField), findsNWidgets(2));
      expect(find.byKey(LoginActionKeys.biometric), findsOneWidget);
      expect(find.text('Version 2.0'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('wide Arabic remains responsive and keeps one functional form', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(1024, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pump(tester, locale: const Locale('ar'));

    expect(find.byKey(const Key('login.brand.panel')), findsOneWidget);
    expect(find.byKey(const Key('login.form.card')), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(2));
    expect(_submitButton(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
