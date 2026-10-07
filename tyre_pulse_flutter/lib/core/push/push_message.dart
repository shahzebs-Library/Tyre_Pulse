/// One push message, reduced to the fields this app reads.
///
/// The FCM `RemoteMessage` type never leaves `firebase_push_messaging_client
/// .dart`, so every other file (and every test) works with this plain value
/// and never needs Firebase initialised.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/app/router/notification_routing.dart';
import 'package:tyre_pulse/app/router/routes.dart';

@immutable
final class PushMessage {
  const PushMessage({
    this.messageId,
    this.title,
    this.body,
    this.data = const <String, String>{},
  });

  final String? messageId;

  /// The notification title the server sent, when there was one.
  final String? title;

  /// The notification body the server sent, when there was one.
  final String? body;

  /// The FCM data payload. `workflow-notify` sends `type`, `event_type`,
  /// `entity_type`, `entity_id` and `instance_id` (each only when known), and
  /// may send a web `link` such as `/daily-ops/workshop`.
  final Map<String, String> data;

  String? _field(String key) {
    final String? raw = data[key];
    if (raw == null) return null;
    final String trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  /// The narrow view the ONE notification mapping reads
  /// (`notification_routing.dart`). There must never be a second mapping for
  /// pushes: that is exactly how the Expo app's push taps drifted from its
  /// inbox and did nothing.
  TpNotificationTarget get target => TpNotificationTarget(
        type: _field('type') ?? _field('event_type'),
        entityType: _field('entity_type'),
        entityId: _field('entity_id'),
        link: _field('link') ?? _field('url'),
      );

  /// Where a tap on this message goes. A message the mapping does not know
  /// opens the notifications inbox rather than doing nothing.
  TpRoute get destination =>
      notificationDestination(target) ?? const NotificationsRoute();
}
