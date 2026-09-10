import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_profile_repository.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_screen.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';

import '../../../core/auth/auth_test_support.dart';

final class _Pumped {
  const _Pumped(this.auth, this.container);
  final FakeAuthRepository auth;
  final ProviderContainer container;
}

Future<_Pumped> _pump(
  WidgetTester tester, {
  Size size = const Size(853, 1844),
  Locale locale = const Locale('en'),
  String? fullName = 'Ibrahim Noor',
  List<String> countries = const <String>['UAE'],
  List<String> sites = const <String>['Dubai Industrial City'],
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final auth = FakeAuthRepository();
  final profiles = FakeProfileRepository();
  profiles.outcomeByUserId['user-1'] = ProfileFetchSucceeded(
    WorkspaceProfile.fromRow(<String, Object?>{
      'id': 'user-1',
      'role': 'Operator',
      'country': countries,
      'sites': sites,
      'org_id': 'org-1',
      'organisation_id': 'org-1',
      'approved': true,
      'locked': false,
      'site': 'Dubai Industrial City',
      'full_name': fullName,
      'employee_id': 'EMP-1048',
      'email': 'ibrahim.noor@pmv.ae',
    }),
  );
  final overrides = <Override>[
    ...authTestOverrides(
      auth: auth,
      profiles: profiles,
      versionGate: FakeVersionGateRepository(),
      secureStore: FakeSecureStore(),
      foreground: FakeForegroundSignal(),
      restoreTimeout: const Duration(seconds: 5),
    ),
    homePendingSyncCountProvider.overrideWith((ref) async => 2),
    homeTaskPreviewProvider.overrideWith(
      (ref) async => const <TaskItem>[
        TaskItem(id: 'task-1', title: 'Inspect asset'),
        TaskItem(id: 'task-2', title: 'Review tyre'),
      ],
    ),
    unreadNotificationsCountProvider.overrideWith(
      (ref) => const AsyncData<int>(3),
    ),
  ];
  final container = ProviderContainer(overrides: overrides);
  addTearDown(container.dispose);
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
  return _Pumped(auth, container);
}

void main() {
  testWidgets('matches the Profile reference content and section order',
      (tester) async {
    await _pump(tester);

    expect(find.text('Ibrahim Noor'), findsOneWidget);
    expect(find.text('IN'), findsOneWidget);
    expect(find.textContaining('EMP-1048'), findsOneWidget);
    expect(find.textContaining('Operator'), findsWidgets);
    expect(find.text('Edit profile'), findsOneWidget);
    expect(find.text('My activity'), findsOneWidget);
    expect(find.byKey(ProfileScreenKeys.status), findsOneWidget);
    expect(find.text('Workspace'), findsOneWidget);
    expect(find.text('Language & display'), findsOneWidget);
    expect(find.text('Notifications'), findsWidgets);
    expect(find.text('Security & identity'), findsOneWidget);
    expect(find.text('Offline & data'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('renders the approved 853 by 1844 Profile reference viewport',
      (tester) async {
    await _pump(tester);
    await tester.runAsync(() async {
      await precacheImage(
        const AssetImage('assets/login/figma_brand_pulse.png'),
        tester.element(find.byType(ProfileScreen)),
      );
    });
    await tester.pumpAndSettle();
    await expectLater(
      find.byType(ProfileScreen),
      matchesGoldenFile('goldens/profile_screen_853x1844.png'),
    );
  });

  testWidgets('content scrolls on a phone without overflow', (tester) async {
    await _pump(tester, size: const Size(390, 844));
    await tester.ensureVisible(find.byKey(ProfileScreenKeys.account));
    await tester.pumpAndSettle();
    expect(find.text('Sign out'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('missing identity values remain honest', (tester) async {
    await _pump(tester, fullName: null);
    expect(find.text('Unavailable'), findsWidgets);
    expect(find.text('Ibrahim Noor'), findsNothing);
  });

  testWidgets('Arabic preserves RTL and the responsive structure',
      (tester) async {
    await _pump(
      tester,
      size: const Size(390, 844),
      locale: const Locale('ar'),
    );
    expect(
      Directionality.of(tester.element(find.byKey(ProfileScreenKeys.hero))),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('sign out remains confirmed and cancellable', (tester) async {
    final pumped = await _pump(tester, size: const Size(390, 844));
    await tester.ensureVisible(find.byKey(ProfileScreenKeys.account));
    await tester.pumpAndSettle();
    await tester.tap(
      find.descendant(
        of: find.byKey(ProfileScreenKeys.account),
        matching: find.byType(OutlinedButton),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Sign out?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(pumped.auth.calls, isNot(contains('signOut')));
    expect(
      pumped.container.read(authControllerProvider).sessionPhase,
      AuthSessionPhase.authenticated,
    );
  });
}
