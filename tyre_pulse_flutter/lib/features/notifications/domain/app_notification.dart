/// One row from the authenticated user's notification inbox.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/notification_routing.dart';

@immutable
final class AppNotification {
  const AppNotification({
    required this.id,
    required this.userId,
    required this.isRead,
    required this.createdAt,
    this.type,
    this.title,
    this.body,
    this.entityType,
    this.entityId,
  });

  final String id;
  final String userId;
  final String? type;
  final String? title;
  final String? body;
  final String? entityType;
  final String? entityId;
  final bool isRead;
  final DateTime createdAt;

  TpNotificationTarget get target => TpNotificationTarget(
        type: type,
        entityType: entityType,
        entityId: entityId,
      );

  IconData get icon {
    final String key = (entityType ?? type ?? '').toLowerCase();
    if (key.contains('assign') || key.contains('job') || key.contains('work')) {
      return Icons.handyman_outlined;
    }
    if (key.contains('approval') || key.contains('approve')) {
      return Icons.task_alt_rounded;
    }
    if (key.contains('parts')) return Icons.inventory_2_outlined;
    if (key.contains('inspection') || key.contains('checklist')) {
      return Icons.fact_check_outlined;
    }
    if (key.contains('accident') ||
        key.contains('incident') ||
        key.contains('claim')) {
      return Icons.car_crash_outlined;
    }
    if (key.contains('broadcast')) return Icons.campaign_outlined;
    if (key.contains('alert')) return Icons.warning_amber_rounded;
    return Icons.notifications_none_rounded;
  }
}
