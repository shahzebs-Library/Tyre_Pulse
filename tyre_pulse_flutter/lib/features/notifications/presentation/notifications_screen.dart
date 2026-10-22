library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/app/router/notification_routing.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';
import 'package:tyre_pulse/features/notifications/domain/notification_deep_link.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/notifications/presentation/notifications_copy.dart';
import 'package:tyre_pulse/features/notifications/presentation/team_action_dialog.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({required this.backFallback, super.key});

  final String backFallback;

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final Set<String> _optimisticallyRead = <String>{};
  bool _allOptimisticallyRead = false;
  bool _markingAll = false;
  String? _handledDeepLink;
  String? _deepLinkRefreshed;

  @override
  Widget build(BuildContext context) {
    final NotificationsCopy copy = NotificationsCopy.of(context);
    final AsyncValue<List<AppNotification>> inbox =
        ref.watch(notificationsInboxProvider);
    final List<AppNotification> currentRows = switch (inbox) {
      AsyncData<List<AppNotification>>(:final value) => value,
      _ => const <AppNotification>[],
    };
    _handleDeepLink(
      GoRouterState.of(context).uri.queryParameters,
      inbox is AsyncData<List<AppNotification>>,
      currentRows,
      copy,
    );
    final int unread =
        currentRows.where((AppNotification row) => !_isRead(row)).length;

    return TpScaffold(
      backFallback: widget.backFallback,
      appBar: TpAppBar(
        title: copy('title'),
        backFallback: widget.backFallback,
        actions: <Widget>[
          if (unread > 0)
            TextButton(
              key: const Key('notifications.markAll'),
              onPressed: _markingAll ? null : () => unawaited(_markAll(copy)),
              child: Text(copy('markAll')),
            ),
          const SizedBox(width: TpSpace.xs),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: inbox.when(
            loading: () => const TpLoadingState(),
            error: (Object error, StackTrace stackTrace) =>
                _NotificationsFailure(
              error: error,
              copy: copy,
              onRetry: _refresh,
            ),
            data: (List<AppNotification> rows) => _NotificationsList(
              rows: rows,
              copy: copy,
              isRead: _isRead,
              onRefresh: _refresh,
              onOpen: (AppNotification row) => _open(row, copy),
            ),
          ),
        ),
      ),
    );
  }

  /// Opens the exact message/task a push pointed at. If the inbox is loaded and
  /// the target is not in it (deleted, not this account's, unknown kind) the user
  /// is told so instead of nothing happening. One refresh is tried first because a
  /// push can arrive just before the inbox stream has seen the new row.
  void _handleDeepLink(
    Map<String, String> params,
    bool loaded,
    List<AppNotification> rows,
    NotificationsCopy copy,
  ) {
    final String? targetId = params['target_id'];
    final String? targetType = params['target_type'];
    final String key = '$targetType:$targetId';
    if (key == _handledDeepLink) return;
    final NotificationDeepLinkResult result = resolveNotificationDeepLink(
      targetType: targetType,
      targetId: targetId,
      rows: rows,
      loaded: loaded,
    );
    switch (result.outcome) {
      case NotificationDeepLinkOutcome.none:
      case NotificationDeepLinkOutcome.waiting:
        return;
      case NotificationDeepLinkOutcome.open:
        _handledDeepLink = key;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _open(result.row!, copy);
        });
      case NotificationDeepLinkOutcome.unavailable:
        if (_deepLinkRefreshed != key &&
            inboxTypeForDeepLink(targetType) != null) {
          _deepLinkRefreshed = key;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) ref.invalidate(notificationsInboxProvider);
          });
          return;
        }
        _handledDeepLink = key;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) _showFailure(copy('messageUnavailable'));
        });
    }
  }

  bool _isRead(AppNotification row) =>
      row.isRead ||
      _allOptimisticallyRead ||
      _optimisticallyRead.contains(row.id);

  Future<void> _refresh() async {
    setState(() {
      _optimisticallyRead.clear();
      _allOptimisticallyRead = false;
    });
    ref.invalidate(notificationsInboxProvider);
    await ref.read(notificationsInboxProvider.future);
  }

  void _open(AppNotification row, NotificationsCopy copy) {
    if (row.type == 'action_assigned' && row.entityId != null) {
      if (!_isRead(row)) {
        setState(() => _optimisticallyRead.add(row.id));
        unawaited(_persistRead(row.id, copy));
      }
      unawaited(showDialog<void>(
          context: context,
          builder: (BuildContext context) =>
              TeamActionDialog(actionId: row.entityId!)));
      return;
    }
    if (row.type == 'broadcast' && row.entityId != null) {
      if (!_isRead(row)) {
        setState(() => _optimisticallyRead.add(row.id));
        unawaited(_persistRead(row.id, copy));
      }
      unawaited(showDialog<void>(
          context: context,
          builder: (BuildContext context) =>
              _TeamMessageDialog(notification: row)));
      return;
    }
    if (!_isRead(row)) {
      setState(() => _optimisticallyRead.add(row.id));
      unawaited(_persistRead(row.id, copy));
    }
    final TpRoute? destination = notificationDestination(row.target);
    if (destination != null) context.push(destination.location);
  }

  Future<void> _persistRead(String id, NotificationsCopy copy) async {
    try {
      await ref.read(notificationsRepositoryProvider).markRead(id);
    } on Object {
      if (!mounted) return;
      setState(() => _optimisticallyRead.remove(id));
      _showFailure(copy('markFailed'));
    }
  }

  Future<void> _markAll(NotificationsCopy copy) async {
    final String userId = ref.read(workspaceContextProvider)?.userId ?? '';
    if (userId.isEmpty) return;
    setState(() {
      _markingAll = true;
      _allOptimisticallyRead = true;
    });
    try {
      await ref.read(notificationsRepositoryProvider).markAllRead(userId);
    } on Object {
      if (!mounted) return;
      setState(() => _allOptimisticallyRead = false);
      _showFailure(copy('markAllFailed'));
    } finally {
      if (mounted) setState(() => _markingAll = false);
    }
  }

  void _showFailure(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

class _NotificationsList extends StatelessWidget {
  const _NotificationsList({
    required this.rows,
    required this.copy,
    required this.isRead,
    required this.onRefresh,
    required this.onOpen,
  });

  final List<AppNotification> rows;
  final NotificationsCopy copy;
  final bool Function(AppNotification) isRead;
  final Future<void> Function() onRefresh;
  final ValueChanged<AppNotification> onOpen;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          key: const Key('notifications.empty'),
          physics: const AlwaysScrollableScrollPhysics(),
          children: <Widget>[
            SizedBox(
              height: MediaQuery.sizeOf(context).height * 0.58,
              child: TpEmptyState(
                icon: Icons.notifications_none_rounded,
                title: copy('emptyTitle'),
                message: copy('emptyBody'),
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.separated(
        key: const Key('notifications.list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.md,
          TpSpace.md,
          TpSpace.md,
          TpSpace.xxxl,
        ),
        itemCount: rows.length,
        separatorBuilder: (_, __) => const SizedBox(height: TpSpace.sm),
        itemBuilder: (BuildContext context, int index) {
          final AppNotification row = rows[index];
          return _NotificationCard(
            row: row,
            copy: copy,
            isRead: isRead(row),
            onTap: () => onOpen(row),
          );
        },
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({
    required this.row,
    required this.copy,
    required this.isRead,
    required this.onTap,
  });

  final AppNotification row;
  final NotificationsCopy copy;
  final bool isRead;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TpRoute? destination = notificationDestination(row.target);
    return Semantics(
      container: true,
      button: true,
      label: row.title ?? copy('fallbackTitle'),
      child: TpCard(
        key: Key('notifications.row.${row.id}'),
        onTap: onTap,
        background: isRead ? palette.surface : palette.surfaceAlt,
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: <Widget>[
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: isRead
                    ? palette.surfaceSunken
                    : palette.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(TpRadius.sm),
              ),
              alignment: Alignment.center,
              child: Icon(
                row.icon,
                size: 21,
                color: isRead ? palette.textMuted : palette.primary,
              ),
            ),
            const SizedBox(width: TpSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          row.title ?? copy('fallbackTitle'),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context)
                              .textTheme
                              .titleSmall
                              ?.copyWith(
                                fontWeight:
                                    isRead ? FontWeight.w600 : FontWeight.w800,
                              ),
                        ),
                      ),
                      if (!isRead) ...<Widget>[
                        const SizedBox(width: TpSpace.sm),
                        Container(
                          key: Key('notifications.unread.${row.id}'),
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: palette.primary,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (row.body != null) ...<Widget>[
                    const SizedBox(height: TpSpace.xs),
                    Text(
                      row.body!,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: palette.textSecondary,
                          ),
                    ),
                  ],
                  const SizedBox(height: TpSpace.xs),
                  Text(
                    _timeLabel(context, row.createdAt, copy),
                    textDirection: TextDirection.ltr,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: palette.textMuted,
                        ),
                  ),
                ],
              ),
            ),
            if (destination != null) ...<Widget>[
              const SizedBox(width: TpSpace.xs),
              Icon(
                Icons.chevron_right_rounded,
                color: palette.textMuted,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _timeLabel(
  BuildContext context,
  DateTime timestamp,
  NotificationsCopy copy,
) {
  final DateTime now = DateTime.now().toUtc();
  final Duration age = now.difference(timestamp.toUtc());
  if (age.isNegative || age.inMinutes < 1) return copy('justNow');
  if (age.inMinutes < 60) return copy('minutesAgo', count: age.inMinutes);
  if (age.inHours < 24) return copy('hoursAgo', count: age.inHours);
  if (age.inDays < 7) return copy('daysAgo', count: age.inDays);
  return DateFormat.yMMMd(Localizations.localeOf(context).toLanguageTag())
      .format(timestamp.toLocal());
}

class _NotificationsFailure extends StatelessWidget {
  const _NotificationsFailure({
    required this.error,
    required this.copy,
    required this.onRetry,
  });

  final Object error;
  final NotificationsCopy copy;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final AppError? source = switch (error) {
      final SupabaseFailure failure => failure.error,
      final AppError appError => appError,
      _ => null,
    };
    if (source?.kind == AppErrorKind.network ||
        (source?.kind == AppErrorKind.server && source!.isRetryable)) {
      return TpBackendUnavailableState(
        detail: copy('loadFailed'),
        onRetry: () => unawaited(onRetry()),
      );
    }
    return TpErrorState(
      error: AppError(
        kind: source?.kind ?? AppErrorKind.unknown,
        message: copy('loadFailed'),
        technical: source?.technical,
        cause: source?.cause ?? error,
        isRetryable: true,
      ),
      onRetry: () => unawaited(onRetry()),
    );
  }
}

/// In-app broadcast detail. Only the signed-in recipient can acknowledge or reply,
/// subject to Supabase RLS on the receipt/reply tables.
class _TeamMessageDialog extends StatefulWidget {
  const _TeamMessageDialog({required this.notification});
  final AppNotification notification;

  @override
  State<_TeamMessageDialog> createState() => _TeamMessageDialogState();
}

class _TeamMessageDialogState extends State<_TeamMessageDialog> {
  final TextEditingController _reply = TextEditingController();
  bool _busy = false;
  bool _acknowledged = false;
  String? _error;
  List<Map<String, dynamic>> _thread = <Map<String, dynamic>>[];

  SupabaseClient get _db => Supabase.instance.client;
  String get _messageId => widget.notification.entityId ?? '';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final String? uid = _db.auth.currentUser?.id;
      if (uid == null || _messageId.isEmpty)
        throw StateError('Sign in to view this message.');
      final List<Map<String, dynamic>> receipt = await _db
          .from('broadcast_recipient_receipts')
          .select('read_at,acknowledged_at')
          .eq('broadcast_id', _messageId)
          .eq('recipient_id', uid)
          .limit(1);
      if (receipt.isEmpty)
        throw StateError('Message is not available to this account.');
      if (receipt.first['read_at'] == null) {
        await _db
            .from('broadcast_recipient_receipts')
            .update(<String, dynamic>{
              'read_at': DateTime.now().toUtc().toIso8601String()
            })
            .eq('broadcast_id', _messageId)
            .eq('recipient_id', uid)
            .isFilter('read_at', null);
      }
      final List<Map<String, dynamic>> replies = await _db
          .from('broadcast_replies')
          .select('id,body,author_id,created_at')
          .eq('broadcast_id', _messageId)
          .order('created_at', ascending: true)
          .limit(250);
      if (mounted)
        setState(() {
          _acknowledged = receipt.first['acknowledged_at'] != null;
          _thread = replies;
          _error = null;
        });
    } catch (error) {
      // A missing receipt (deleted message, other account/tenant) is shown as a
      // plain sentence, never as a raw exception string.
      if (mounted)
        setState(() => _error = error is StateError
            ? error.message
            : 'Could not load this message. Please try again.');
    }
  }

  Future<void> _ack() async {
    if (_busy || _acknowledged) return;
    setState(() => _busy = true);
    try {
      final uid = _db.auth.currentUser?.id;
      if (uid == null) throw StateError('Not signed in.');
      final at = DateTime.now().toUtc().toIso8601String();
      await _db
          .from('broadcast_recipient_receipts')
          .update(<String, dynamic>{'acknowledged_at': at, 'read_at': at})
          .eq('broadcast_id', _messageId)
          .eq('recipient_id', uid)
          .isFilter('acknowledged_at', null);
      if (mounted) setState(() => _acknowledged = true);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send() async {
    final body = _reply.text.trim();
    if (_busy || body.isEmpty || body.length > 4000) return;
    setState(() => _busy = true);
    try {
      final uid = _db.auth.currentUser?.id;
      if (uid == null) throw StateError('Not signed in.');
      await _db.from('broadcast_replies').insert(<String, dynamic>{
        'broadcast_id': _messageId,
        'author_id': uid,
        'body': body,
      });
      _reply.clear();
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.notification.title ?? 'Team message'),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(widget.notification.body ?? ''),
                  const SizedBox(height: 16),
                  if (_error != null)
                    Text(_error!,
                        style: TextStyle(
                            color: Theme.of(context).colorScheme.error)),
                  Text(_acknowledged
                      ? 'Acknowledged'
                      : 'Acknowledgement required'),
                  const SizedBox(height: 12),
                  for (final row in _thread)
                    Padding(
                        padding: const EdgeInsets.only(bottom: 9),
                        child: Text(row['body']?.toString() ?? '')),
                  TextField(
                      controller: _reply,
                      maxLength: 4000,
                      maxLines: 3,
                      decoration: const InputDecoration(
                          labelText: 'Reply to team',
                          border: OutlineInputBorder())),
                ]),
          ),
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close')),
          TextButton(
              onPressed: _busy || _acknowledged ? null : _ack,
              child: Text(_acknowledged ? 'Acknowledged' : 'Acknowledge')),
          FilledButton(
              onPressed: _busy ? null : _send, child: const Text('Send reply')),
        ],
      );
}
