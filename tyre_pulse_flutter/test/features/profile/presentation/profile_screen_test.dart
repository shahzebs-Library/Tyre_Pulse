/// Renders [ProfileScreen] over a real, signed-in [AuthController] session,
/// using the SAME fakes `auth_controller_test.dart` and
/// `login_screen_test.dart` already share via `auth_test_support.dart`.
///
/// Unlike `login_screen_test.dart`, this screen genuinely needs a resolved
/// session: [ProfileScreen] reads [AuthState.profile] directly (see that
/// screen's own library comment for why - `WorkspaceContext` does not carry
/// `full_name`), so every test here drives the harness through a real
/// sign-in via [FakeAuthRepository.emit] before pumping, exactly the pattern
/// `auth_controller_test.dart` itself uses.
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
import 'package:tyre_pulse/core/auth/auth_dependency_providers.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_screen.dart';
import 'package:tyre_pulse/features/profile/profile_providers.dart';

import '../../../core/auth/auth_test_support.dart';

final class _Pumped {
  const _Pumped({required this.auth, required this.container});

  final FakeAuthRepository auth;
  final ProviderContainer container;
}

Future<_Pumped> _pumpSignedIn(
  WidgetTester tester, {
  String? fullName = 'Amina Yusuf',
  String? site = 'NHC',
  bool isSuperAdmin = false,
  List<String> countries = const <String>['ALL'],
  List<String> sites = const <String>['ALL'],
  Locale locale = const Locale('en'),
  AsyncValue<int> pendingSync = const AsyncData<int>(0),
  Stream<int>? pendingSyncStream,
  int unread = 0,
  String appVersion = '2.0.0',
}) async {
  final FakeAuthRepository auth = FakeAuthRepository();
  final FakeProfileRepository profiles = FakeProfileRepository();
  profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
    WorkspaceProfile.fromRow(<String, Object?>{
      'id': 'user-1',
      'role': 'Manager',
      'country': countries,
      'sites': sites,
      'org_id': 'org-1',
      'organisation_id': 'org-1',
      'is_super_admin': isSuperAdmin,
      'approved': true,
      'locked': false,
      'site': site,
      'full_name': fullName,
      'employee_id': 'EMP-1048',
    }),
  );

  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      ...authTestOverrides(
        auth: auth,
        profiles: profiles,
        versionGate: FakeVersionGateRepository(),
        secureStore: FakeSecureStore(),
        foreground: FakeForegroundSignal(),
        restoreTimeout: const Duration(seconds: 5),
      ),
      // Read-only counts the screen shows. Overridden so the test never
      // touches the offline database or the live Supabase inbox.
      profilePendingSyncCountProvider.overrideWith(
        (Ref ref) =>
            pendingSyncStream ??
            switch (pendingSync) {
              AsyncData<int>(:final int value) => Stream<int>.value(value),
              _ => Stream<int>.error(StateError('queue unreadable')),
            },
      ),
      unreadNotificationsCountProvider.overrideWithValue(
        AsyncData<int>(unread),
      ),
      currentAppVersionProvider.overrideWithValue(appVersion),
    ],
  );
  addTearDown(container.dispose);

  // Seeds the session BEFORE the controller is ever read, mirroring
  // `auth_controller_test.dart`'s own "an already-resolved session at build
  // time" fixtures - `build()` picks it up via `currentSession` on the very
  // first read, which the widget tree below triggers.
  auth.emit(const AuthSessionSignal(userId: 'user-1'));

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const ProfileScreen(route: ProfileRoute()),
      ),
    ),
  );
  await tester.pumpAndSettle();

  expect(
    container.read(authControllerProvider).profileStatus,
    ProfileStatus.loaded,
    reason: 'the profile must have resolved before a test asserts on it',
  );

  return _Pumped(auth: auth, container: container);
}

void main() {
  testWidgets(
    'a loaded profile with a full name, role and site renders all three, '
    'shows its real access scope and no super-admin badge',
    (WidgetTester tester) async {
      await _pumpSignedIn(
        tester,
        fullName: 'Amina Yusuf',
        site: 'NHC',
      );

      expect(find.text('Amina Yusuf'), findsOneWidget);
      expect(find.text('AY'), findsOneWidget);
      expect(find.text('EMP-1048'), findsOneWidget);
      expect(find.text('Manager'), findsWidgets);
      expect(find.text('NHC'), findsWidgets);
      expect(find.text('Employee ID'), findsOneWidget);
      expect(find.text('Workspace'), findsOneWidget);
      expect(find.text('Language & display'), findsOneWidget);
      expect(find.text('App language'), findsOneWidget);
      expect(find.text('English'), findsOneWidget);
      expect(find.text('Theme'), findsOneWidget);
      expect(find.text('Light'), findsOneWidget);
      expect(find.text('Offline & data'), findsOneWidget);
      expect(find.text('All'), findsNWidgets(2));
      expect(find.text('Platform administrator'), findsNothing);
      expect(find.byKey(ProfileScreenKeys.status), findsOneWidget);
      // The old header wrongly reused an inspection's "Synced" status as an
      // account-verified line. It is gone, not replaced by an invented one.
      expect(find.text('Synced'), findsNothing);
      expect(find.text('All changes synced'), findsOneWidget);
      expect(find.text('Version 2.0.0'), findsOneWidget);
      expect(find.byKey(ProfileScreenKeys.unsyncedFooter), findsNothing);
    },
  );

  testWidgets(
    'named country and site scopes render the stored values without '
    'inventing access',
    (WidgetTester tester) async {
      await _pumpSignedIn(
        tester,
        countries: const <String>['Saudi Arabia', 'UAE'],
        sites: const <String>['NHC', 'Riyadh Workshop'],
      );

      expect(find.text('Saudi Arabia, UAE'), findsOneWidget);
      expect(find.text('NHC, Riyadh Workshop'), findsOneWidget);
    },
  );

  testWidgets(
    'no full name on record renders the honest Unavailable placeholder, '
    'never an invented one',
    (WidgetTester tester) async {
      await _pumpSignedIn(tester, fullName: null);

      expect(find.text('Unavailable'), findsOneWidget);
    },
  );

  testWidgets(
    'no site on record renders the same honest "no site on file" caption '
    'the Home screen already uses for the identical gap',
    (WidgetTester tester) async {
      await _pumpSignedIn(tester, site: null);

      expect(find.text('No site on file'), findsOneWidget);
    },
  );

  testWidgets(
    'is_super_admin true shows the platform-administrator badge',
    (WidgetTester tester) async {
      await _pumpSignedIn(tester, isSuperAdmin: true);

      expect(find.text('Platform administrator'), findsOneWidget);
    },
  );

  testWidgets(
    'profile groups stack on a phone and sit side-by-side on a wide layout',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await _pumpSignedIn(tester);

      final double narrowAccessTop =
          tester.getTopLeft(find.byKey(ProfileScreenKeys.access)).dy;
      final double narrowAccountTop =
          tester.getTopLeft(find.byKey(ProfileScreenKeys.account)).dy;
      expect(narrowAccountTop, greaterThan(narrowAccessTop));
      expect(tester.takeException(), isNull);

      await tester.binding.setSurfaceSize(const Size(900, 900));
      await tester.pumpAndSettle();

      final double wideAccessTop =
          tester.getTopLeft(find.byKey(ProfileScreenKeys.access)).dy;
      final double wideAccountTop =
          tester.getTopLeft(find.byKey(ProfileScreenKeys.account)).dy;
      expect(wideAccountTop, closeTo(wideAccessTop, 0.1));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Arabic keeps the richer profile layout RTL without overflow',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await _pumpSignedIn(
        tester,
        fullName: 'Amina Yusuf',
        countries: const <String>['Saudi Arabia'],
        sites: const <String>['NHC'],
        locale: const Locale('ar'),
      );

      expect(
        Directionality.of(tester.element(find.byKey(ProfileScreenKeys.hero))),
        TextDirection.rtl,
      );
      expect(find.byKey(ProfileScreenKeys.access), findsOneWidget);
      expect(find.byKey(ProfileScreenKeys.account), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'sign out is confirmed before anything happens: cancelling leaves the '
    'session alone',
    (WidgetTester tester) async {
      final _Pumped p = await _pumpSignedIn(tester);

      // The button sits below the driver workspace panel on a phone-height
      // surface; scroll it into view the way a person would.
      await tester.ensureVisible(find.byKey(ProfileScreenKeys.signOut));
      await tester.pump();
      await tester.tap(find.byKey(ProfileScreenKeys.signOut));
      await tester.pumpAndSettle();
      expect(find.text('Sign out?'), findsOneWidget);

      await tester.tap(find.widgetWithText(TpButton, 'Cancel'));
      await tester.pumpAndSettle();

      expect(p.auth.calls, isNot(contains('signOut')));
      expect(
        p.container.read(authControllerProvider).sessionPhase,
        AuthSessionPhase.authenticated,
      );
    },
  );

  testWidgets(
    'sign out, confirmed, calls AuthController.signOut - the one real path '
    'every shell gate already uses - and reaches signedOut',
    (WidgetTester tester) async {
      final _Pumped p = await _pumpSignedIn(tester);

      // The button sits below the driver workspace panel on a phone-height
      // surface; scroll it into view the way a person would.
      await tester.ensureVisible(find.byKey(ProfileScreenKeys.signOut));
      await tester.pump();
      await tester.tap(find.byKey(ProfileScreenKeys.signOut));
      await tester.pumpAndSettle();

      // The screen's own action is an outlined button; the dialog's confirm
      // is the only "Sign out" TpButton.
      await tester.tap(find.widgetWithText(TpButton, 'Sign out'));
      // NOT pumpAndSettle from here: a successful sign-out clears
      // AuthState.profile, and this screen honestly renders TpLoadingState
      // - the design system's ONE spinner-bearing widget - for that
      // in-between frame (see profile_screen.dart's own comment on it).
      // TpLoadingState's CircularProgressIndicator never stops scheduling a
      // new frame on its own, so pumpAndSettle against it never settles -
      // exactly the reason `vehicles_list_screen_test.dart`'s own loading
      // -state test gives for the identical choice. A bounded pump is
      // enough: the dialog pop and the awaited (real, un-delayed)
      // FakeAuthRepository.signOut() both resolve on ordinary microtasks.
      await tester.pump();
      await tester.pump();

      expect(p.auth.calls, contains('signOut'));
      expect(
        p.container.read(authControllerProvider).sessionPhase,
        AuthSessionPhase.signedOut,
      );
    },
  );

  testWidgets(
    'queued work shows its real count in the strip and the Offline row, '
    'and the footer line appears only while something is queued',
    (WidgetTester tester) async {
      await _pumpSignedIn(tester, pendingSync: const AsyncData<int>(2));

      expect(
        find.descendant(
          of: find.byKey(ProfileScreenKeys.status),
          matching: find.text('2'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(ProfileScreenKeys.pendingSyncRow),
          matching: find.text('2 changes waiting to sync'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(ProfileScreenKeys.unsyncedFooter), findsOneWidget);
      expect(
        find.text('Unsynced drafts remain safely on this device'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'the pending count is live: a sync finishing while Profile stays open '
    'updates the strip and removes the unsynced footer',
    (WidgetTester tester) async {
      final StreamController<int> queue = StreamController<int>();
      addTearDown(queue.close);
      queue.add(3);
      await _pumpSignedIn(tester, pendingSyncStream: queue.stream);

      expect(
        find.descendant(
          of: find.byKey(ProfileScreenKeys.status),
          matching: find.text('3'),
        ),
        findsOneWidget,
      );
      expect(find.byKey(ProfileScreenKeys.unsyncedFooter), findsOneWidget);

      queue.add(0);
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byKey(ProfileScreenKeys.status),
          matching: find.text('3'),
        ),
        findsNothing,
      );
      expect(find.text('All changes synced'), findsOneWidget);
      expect(find.byKey(ProfileScreenKeys.unsyncedFooter), findsNothing);
    },
  );

  testWidgets(
    'an unreadable queue renders a dash and Unavailable, never a zero',
    (WidgetTester tester) async {
      await _pumpSignedIn(
        tester,
        pendingSync: AsyncError<int>(StateError('x'), StackTrace.empty),
      );

      expect(
        find.descendant(
          of: find.byKey(ProfileScreenKeys.status),
          matching: find.text('-'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(ProfileScreenKeys.pendingSyncRow),
          matching: find.text('Unavailable'),
        ),
        findsOneWidget,
      );
      // Unknown is treated as "may have unsynced work": the warning stays,
      // worded so it does not claim work IS queued.
      expect(find.byKey(ProfileScreenKeys.unsyncedFooter), findsOneWidget);
      expect(
        find.text(
          'Pending sync could not be checked. Unsynced work may still be '
          'on this device',
        ),
        findsOneWidget,
      );
      expect(
        find.text('Unsynced drafts remain safely on this device'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'the bell badge shows unread notifications and hides at zero',
    (WidgetTester tester) async {
      await _pumpSignedIn(tester, unread: 3);
      expect(
        tester
            .widget<Badge>(find.byKey(ProfileScreenKeys.notificationsBadge))
            .isLabelVisible,
        isTrue,
      );
    },
  );

  testWidgets(
    'no unread notifications leaves the bell badge hidden',
    (WidgetTester tester) async {
      await _pumpSignedIn(tester);
      expect(
        tester
            .widget<Badge>(find.byKey(ProfileScreenKeys.notificationsBadge))
            .isLabelVisible,
        isFalse,
      );
    },
  );

  testWidgets(
    'the language row opens the three shipped languages and writes the '
    'choice through localeProvider',
    (WidgetTester tester) async {
      final _Pumped p = await _pumpSignedIn(tester);

      await tester.ensureVisible(find.byKey(ProfileScreenKeys.languageRow));
      await tester.pump();
      await tester.tap(find.byKey(ProfileScreenKeys.languageRow));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('profile.language.en')), findsOneWidget);
      expect(find.byKey(const Key('profile.language.ur')), findsOneWidget);
      await tester.tap(find.byKey(const Key('profile.language.ar')));
      await tester.pumpAndSettle();

      expect(p.container.read(localeProvider), const Locale('ar'));
    },
  );

  testWidgets(
    'the theme row offers light, dark and system and writes the choice '
    'through themeModeProvider',
    (WidgetTester tester) async {
      final _Pumped p = await _pumpSignedIn(tester);

      await tester.ensureVisible(find.byKey(ProfileScreenKeys.themeRow));
      await tester.pump();
      await tester.tap(find.byKey(ProfileScreenKeys.themeRow));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('profile.theme.light')), findsOneWidget);
      expect(find.byKey(const Key('profile.theme.system')), findsOneWidget);
      await tester.tap(find.byKey(const Key('profile.theme.dark')));
      await tester.pumpAndSettle();

      expect(p.container.read(themeModeProvider), ThemeMode.dark);
      expect(
        find.descendant(
          of: find.byKey(ProfileScreenKeys.themeRow),
          matching: find.text('Dark'),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'a placeholder build version is not shown as the app version',
    (WidgetTester tester) async {
      await _pumpSignedIn(tester, appVersion: '999.0.0');

      expect(find.byKey(ProfileScreenKeys.appVersionRow), findsNothing);
    },
  );
}
