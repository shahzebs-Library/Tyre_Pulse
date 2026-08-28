/// Authenticated notification inbox over the verified `notifications` table.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/notifications/data/app_notification_dto.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';

abstract interface class NotificationsRepository {
  /// Initial read plus realtime changes, scoped to the authenticated user.
  Stream<List<AppNotification>> watchInbox(String userId, {int limit = 100});

  Future<void> markRead(String notificationId);

  Future<void> markAllRead(String userId);
}

final class SupabaseNotificationsRepository
    with SupabaseGateway
    implements NotificationsRepository {
  SupabaseNotificationsRepository(this._client);

  final SupabaseClient _client;

  @override
  Stream<List<AppNotification>> watchInbox(
    String userId, {
    int limit = 100,
  }) {
    final String owner = userId.trim();
    if (owner.isEmpty) return Stream<List<AppNotification>>.value(const []);

    return _client
        .from(SupabaseTables.notifications)
        .stream(primaryKey: const <String>['id'])
        .eq('user_id', owner)
        .order('created_at', ascending: false)
        .limit(limit)
        .map(
          (List<Map<String, dynamic>> rows) => rows
              .map(AppNotificationDto.fromRow)
              .where((AppNotificationDto dto) => dto.id.isNotEmpty)
              .map((AppNotificationDto dto) => dto.toDomain())
              .toList(growable: false),
        );
  }

  @override
  Future<void> markRead(String notificationId) {
    final String id = notificationId.trim();
    if (id.isEmpty) return Future<void>.value();
    return guard<void>(() async {
      await _client
          .from(SupabaseTables.notifications)
          .update(const <String, dynamic>{'read': true}).eq('id', id);
    });
  }

  @override
  Future<void> markAllRead(String userId) {
    final String owner = userId.trim();
    if (owner.isEmpty) return Future<void>.value();
    return guard<void>(() async {
      await _client
          .from(SupabaseTables.notifications)
          .update(const <String, dynamic>{'read': true})
          .eq('user_id', owner)
          .eq('read', false);
    });
  }
}
