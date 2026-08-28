/// Parsing boundary for verified `notifications` rows.
library;

import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';

final class AppNotificationDto {
  const AppNotificationDto({
    required this.id,
    required this.userId,
    required this.read,
    required this.createdAt,
    this.type,
    this.title,
    this.body,
    this.entityType,
    this.entityId,
  });

  factory AppNotificationDto.fromRow(Map<String, dynamic> row) {
    return AppNotificationDto(
      id: _text(row['id']) ?? '',
      userId: _text(row['user_id']) ?? '',
      type: _text(row['type']),
      title: _text(row['title']),
      body: _text(row['body']),
      entityType: _text(row['entity_type']),
      entityId: _text(row['entity_id']),
      read: row['read'] == true,
      createdAt: DateTime.tryParse(_text(row['created_at']) ?? '')?.toUtc() ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  final String id;
  final String userId;
  final String? type;
  final String? title;
  final String? body;
  final String? entityType;
  final String? entityId;
  final bool read;
  final DateTime createdAt;

  AppNotification toDomain() => AppNotification(
        id: id,
        userId: userId,
        type: type,
        title: title,
        body: body,
        entityType: entityType,
        entityId: entityId,
        isRead: read,
        createdAt: createdAt,
      );
}

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}
