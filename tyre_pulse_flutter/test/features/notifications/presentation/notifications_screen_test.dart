library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/notifications/data/notifications_repository.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/notifications/presentation/notifications_screen.dart';

final class _FakeNotificationsRepository implements NotificationsRepository {
  _FakeNotificationsRepository(this.rows);

  final List<AppNotification> rows;
  int watches = 0;
  final List<String> marked = <String>[];
  String? markedAllFor;

  @override
  Stream<List<AppNotification>> watchInbox(String userId, {int limit = 100}) {
    watches += 1;
    return Stream<List<AppNotification>>.value(rows);
  }

  @override
  Future<void> markRead(String notificationId) async {
    marked.add(notificationId);
  }

  @override
  Future<void> markAllRead(String userId) async {
    markedAllFor = userId;
  }
}

const AccessState _access = AccessState(role: UserRole.known(RoleId.admin));
const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: _access,
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
);

final List<AppNotification> _rows = <AppNotification>[
  AppNotification(
    id: 'unread',
    userId: 'user-1',
    type: 'broadcast',
    title: 'Workshop shift update',
    body: 'Bay 3 is available.',
    isRead: false,
    createdAt: DateTime(2026, 8, 28, 8, 30),
  ),
  AppNotification(
    id: 'read',
    userId: 'user-1',
    type: 'closure_request',
    title: 'Accident closure requested',
    entityType: 'accident',
    entityId: 'accident-2',
    isRead: true,
    createdAt: DateTime(2026, 8, 27, 8, 30),
  ),
];

Future<void> _pump(
  WidgetTester tester,
  _FakeNotificationsRepository repository, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        notificationsRepositoryProvider.overrideWithValue(repository),
        workspaceContextProvider.overrideWithValue(_workspace),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const NotificationsScreen(backFallback: '/'),
      ),
    ),
  );
}

void main() {
  testWidgets('renders live inbox hierarchy and unread state', (
    WidgetTester tester,
  ) async {
    final repository = _FakeNotificationsRepository(_rows);
    await _pump(tester, repository);
    await tester.pumpAndSettle();

    expect(find.text('Notifications'), findsOneWidget);
    expect(find.byKey(const Key('notifications.list')), findsOneWidget);
    expect(find.text('Workshop shift update'), findsOneWidget);
    expect(find.text('Accident closure requested'), findsOneWidget);
    expect(
      find.byKey(const Key('notifications.unread.unread')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('notifications.unread.read')), findsNothing);
    expect(find.byKey(const Key('notifications.markAll')), findsOneWidget);
  });

  testWidgets('an unroutable row is still marked read on tap', (
    WidgetTester tester,
  ) async {
    final repository = _FakeNotificationsRepository(_rows);
    await _pump(tester, repository);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('notifications.row.unread')));
    await tester.pump();

    expect(repository.marked, <String>['unread']);
    expect(find.byKey(const Key('notifications.unread.unread')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('mark all updates immediately and persists for this user', (
    WidgetTester tester,
  ) async {
    final repository = _FakeNotificationsRepository(_rows);
    await _pump(tester, repository);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('notifications.markAll')));
    await tester.pump();

    expect(repository.markedAllFor, 'user-1');
    expect(find.byKey(const Key('notifications.unread.unread')), findsNothing);
  });

  testWidgets('empty state and Arabic RTL copy are localized', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      _FakeNotificationsRepository(const <AppNotification>[]),
      locale: const Locale('ar'),
    );
    await tester.pumpAndSettle();

    final Finder title = find.text('الإشعارات');
    expect(title, findsOneWidget);
    expect(Directionality.of(tester.element(title)), TextDirection.rtl);
    expect(find.byKey(const Key('notifications.empty')), findsOneWidget);
    expect(find.text('اطلعت على كل المستجدات'), findsOneWidget);
  });
}
