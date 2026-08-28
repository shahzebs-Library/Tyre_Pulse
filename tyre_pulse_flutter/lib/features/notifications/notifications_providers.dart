/// Riverpod wiring for the signed-in user's live notification inbox.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/notifications/data/notifications_repository.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';

final Provider<NotificationsRepository> notificationsRepositoryProvider =
    Provider<NotificationsRepository>(
  (Ref ref) =>
      SupabaseNotificationsRepository(ref.watch(supabaseClientProvider)),
);

final StreamProvider<List<AppNotification>> notificationsInboxProvider =
    StreamProvider<List<AppNotification>>((Ref ref) {
  final String userId = ref.watch(workspaceContextProvider)?.userId ?? '';
  return ref.watch(notificationsRepositoryProvider).watchInbox(userId);
});

final Provider<AsyncValue<int>> unreadNotificationsCountProvider =
    Provider<AsyncValue<int>>((Ref ref) {
  return ref.watch(notificationsInboxProvider).whenData(
        (List<AppNotification> rows) =>
            rows.where((AppNotification row) => !row.isRead).length,
      );
});
