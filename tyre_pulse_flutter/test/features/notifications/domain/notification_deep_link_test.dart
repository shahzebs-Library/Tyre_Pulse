library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';
import 'package:tyre_pulse/features/notifications/domain/notification_deep_link.dart';

AppNotification _row(String type, String? entityId) => AppNotification(
      id: 'n-$type-$entityId',
      userId: 'u1',
      type: type,
      entityId: entityId,
      isRead: false,
      createdAt: DateTime(2026, 10, 22),
    );

void main() {
  final List<AppNotification> rows = <AppNotification>[
    _row('broadcast', 'b1'),
    _row('action_assigned', 'a1'),
  ];

  test('opens the exact matching broadcast or task', () {
    final NotificationDeepLinkResult b = resolveNotificationDeepLink(
        targetType: 'broadcast', targetId: 'b1', rows: rows, loaded: true);
    expect(b.outcome, NotificationDeepLinkOutcome.open);
    expect(b.row?.entityId, 'b1');
    final NotificationDeepLinkResult a = resolveNotificationDeepLink(
        targetType: 'action.assigned',
        targetId: 'a1',
        rows: rows,
        loaded: true);
    expect(a.outcome, NotificationDeepLinkOutcome.open);
    expect(a.row?.type, 'action_assigned');
  });

  test('missing message is reported unavailable once the inbox has loaded', () {
    expect(
      resolveNotificationDeepLink(
              targetType: 'broadcast',
              targetId: 'gone',
              rows: rows,
              loaded: true)
          .outcome,
      NotificationDeepLinkOutcome.unavailable,
    );
    expect(
      resolveNotificationDeepLink(
              targetType: 'broadcast',
              targetId: 'gone',
              rows: const <AppNotification>[],
              loaded: true)
          .outcome,
      NotificationDeepLinkOutcome.unavailable,
    );
  });

  test('right id but wrong kind does not open a different record', () {
    expect(
      resolveNotificationDeepLink(
              targetType: 'action_item',
              targetId: 'b1',
              rows: rows,
              loaded: true)
          .outcome,
      NotificationDeepLinkOutcome.unavailable,
    );
  });

  test('unknown target kind is unavailable, not silently ignored', () {
    expect(inboxTypeForDeepLink('mystery'), isNull);
    expect(
      resolveNotificationDeepLink(
              targetType: 'mystery', targetId: 'b1', rows: rows, loaded: true)
          .outcome,
      NotificationDeepLinkOutcome.unavailable,
    );
    expect(
      resolveNotificationDeepLink(
              targetType: null, targetId: 'b1', rows: rows, loaded: true)
          .outcome,
      NotificationDeepLinkOutcome.unavailable,
    );
  });

  test('waits while the inbox is loading and ignores links without an id', () {
    expect(
      resolveNotificationDeepLink(
              targetType: 'broadcast',
              targetId: 'b1',
              rows: const <AppNotification>[],
              loaded: false)
          .outcome,
      NotificationDeepLinkOutcome.waiting,
    );
    expect(
      resolveNotificationDeepLink(
              targetType: 'broadcast', targetId: '  ', rows: rows, loaded: true)
          .outcome,
      NotificationDeepLinkOutcome.none,
    );
    expect(
      resolveNotificationDeepLink(
              targetType: 'broadcast', targetId: null, rows: rows, loaded: true)
          .outcome,
      NotificationDeepLinkOutcome.none,
    );
  });
}
