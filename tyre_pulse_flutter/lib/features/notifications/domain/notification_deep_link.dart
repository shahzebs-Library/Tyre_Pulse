/// Resolves a push-tap deep link (`/notifications?target_type=..&target_id=..`)
/// against the rows of the signed-in user's inbox.
///
/// Pure and widget-free so the fallback rules can be unit tested. A push can
/// point at a message the user can no longer see (deleted, not addressed to this
/// account, a different tenant, or an unknown record kind). That must end in an
/// honest "unavailable" message, never in silence or an error screen.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';

enum NotificationDeepLinkOutcome {
  /// The link carries no usable target; nothing to do.
  none,

  /// The inbox has not loaded yet; ask again when it has.
  waiting,

  /// A matching inbox row exists; open it.
  open,

  /// The inbox is loaded and the target is missing or of an unknown kind.
  unavailable,
}

@immutable
final class NotificationDeepLinkResult {
  const NotificationDeepLinkResult(this.outcome, [this.row]);

  final NotificationDeepLinkOutcome outcome;
  final AppNotification? row;
}

/// The inbox `type` a push `target_type` refers to, or null for an unknown kind.
String? inboxTypeForDeepLink(String? targetType) {
  switch ((targetType ?? '').trim().toLowerCase()) {
    case 'action_item':
    case 'action.assigned':
      return 'action_assigned';
    case 'broadcast':
    case 'broadcast.sent':
      return 'broadcast';
  }
  return null;
}

NotificationDeepLinkResult resolveNotificationDeepLink({
  required String? targetType,
  required String? targetId,
  required List<AppNotification> rows,
  required bool loaded,
}) {
  final String id = (targetId ?? '').trim();
  if (id.isEmpty) {
    return const NotificationDeepLinkResult(NotificationDeepLinkOutcome.none);
  }
  if (!loaded) {
    return const NotificationDeepLinkResult(
      NotificationDeepLinkOutcome.waiting,
    );
  }
  final String? wantedType = inboxTypeForDeepLink(targetType);
  if (wantedType == null) {
    return const NotificationDeepLinkResult(
      NotificationDeepLinkOutcome.unavailable,
    );
  }
  for (final AppNotification row in rows) {
    if (row.entityId == id && row.type == wantedType) {
      return NotificationDeepLinkResult(NotificationDeepLinkOutcome.open, row);
    }
  }
  return const NotificationDeepLinkResult(
    NotificationDeepLinkOutcome.unavailable,
  );
}
