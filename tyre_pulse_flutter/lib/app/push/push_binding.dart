/// Connects push notifications to the running app: the signed-in session,
/// the router and the on-screen banner.
///
/// Mounted once, from `MaterialApp.router`'s `builder` in `main.dart`, so it
/// sits below the app's `ScaffoldMessenger` and `Localizations` and above
/// every route.
///
/// A tapped notification goes through the ONE notification mapping
/// (`notification_routing.dart`, via `PushMessage.destination`), falling back
/// to the notifications inbox. It is only acted on once a user is signed in
/// and the profile has loaded, so a tap that cold-starts the app is not lost
/// to the boot and login redirects.
library;

import 'dart:async';
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/app_router.dart';
import 'package:tyre_pulse/core/auth/auth_controller.dart';
import 'package:tyre_pulse/core/auth/auth_state.dart';
import 'package:tyre_pulse/core/push/push_coordinator.dart';
import 'package:tyre_pulse/core/push/push_message.dart';
import 'package:tyre_pulse/core/push/push_providers.dart';

/// How long a foreground banner stays on screen.
const Duration pushBannerDuration = Duration(seconds: 6);

class PushBinding extends ConsumerStatefulWidget {
  const PushBinding({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<PushBinding> createState() => _PushBindingState();
}

class _PushBindingState extends ConsumerState<PushBinding> {
  late final PushCoordinator _coordinator;
  String? _userId;
  Future<void> _receiptWork = Future<void>.value();

  @override
  void initState() {
    super.initState();
    _coordinator = ref.read(pushCoordinatorProvider);
    _coordinator.attach(onOpen: _open, onForeground: _showBanner);
    ref.listenManual<AuthState>(
      authControllerProvider,
      (AuthState? previous, AuthState next) => _onAuth(next),
      fireImmediately: true,
    );
  }

  @override
  void dispose() {
    _coordinator.attach();
    super.dispose();
  }

  void _onAuth(AuthState state) {
    final String? userId = state.userId;
    final bool ready = state.sessionPhase == AuthSessionPhase.authenticated &&
        userId != null &&
        state.profileStatus == ProfileStatus.loaded;
    if (ready) {
      if (_userId != userId) {
        _userId = userId;
        _coordinator.onSignedIn(userId);
        _queueReceiptWork(() => _flushDeviceEvents(userId));
      }
      return;
    }
    if (state.sessionPhase == AuthSessionPhase.signedOut && _userId != null) {
      _userId = null;
      _coordinator.onSignedOut();
    }
  }

  void _open(PushMessage message) {
    unawaited(_logDeviceEvent(message, 'opened_by_user'));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final type = message.target.entityType ?? message.target.type ?? '';
      final id = message.target.id;
      if (id != null && (type == 'broadcast' || type == 'action_item' || type == 'broadcast.sent' || type == 'action.assigned')) {
        final uri = Uri(path: '/notifications', queryParameters: <String, String>{'target_type': type, 'target_id': id});
        ref.read(routerProvider).push(uri.toString());
      } else {
        ref.read(routerProvider).push(message.destination.location);
      }
    });
  }

  /// Queue app-observed FCM events so a temporary network failure does not
  /// silently discard them. Stored per signed-in user; bounded at 100 items.
  void _queueReceiptWork(Future<void> Function() operation) {
    _receiptWork = _receiptWork.then((_) => operation()).catchError((Object _) {});
  }

  Future<void> _logDeviceEvent(PushMessage message, String event) async {
    final uid = Supabase.instance.client.auth.currentUser?.id;
    final fcmId = message.messageId;
    if (uid == null || fcmId == null || fcmId.isEmpty) return;
    final kind = message.target.entityType ?? message.target.type;
    final id = message.target.id;
    _queueReceiptWork(() async {
      final prefs = await SharedPreferences.getInstance();
      final key = 'tp_team_push_pending_$uid';
      final pending = prefs.getStringList(key) ?? <String>[];
      final record = jsonEncode(<String, String?>{
        'user_id': uid,
        'fcm_message_id': fcmId,
        'event_type': event,
        'entity_type': kind,
        'entity_id': id,
      });
      if (!pending.contains(record)) {
        pending.add(record);
        // Prevent unbounded accumulation on devices without connectivity.
        await prefs.setStringList(key, pending.length > 100
            ? pending.sublist(pending.length - 100)
            : pending);
      }
      await _flushDeviceEvents(uid);
    });
  }

  Future<void> _flushDeviceEvents(String userId) async {
    if (Supabase.instance.client.auth.currentUser?.id != userId) return;
    final prefs = await SharedPreferences.getInstance();
    final key = 'tp_team_push_pending_$userId';
    final pending = prefs.getStringList(key) ?? <String>[];
    if (pending.isEmpty) return;
    final remaining = <String>[];
    for (final serialized in pending) {
      if (Supabase.instance.client.auth.currentUser?.id != userId) {
        remaining.add(serialized);
        continue;
      }
      try {
        final record = jsonDecode(serialized) as Map<String, dynamic>;
        await Supabase.instance.client.from('team_push_device_events')
            .upsert(record, onConflict: 'user_id,fcm_message_id,event_type');
      } catch (_) {
        remaining.add(serialized);
      }
    }
    await prefs.setStringList(key, remaining);
  }

  void _showBanner(PushMessage message) {
    unawaited(_logDeviceEvent(message, 'received_foreground'));
    if (!mounted) return;
    final ScaffoldMessengerState? messenger =
        ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String title = (message.title?.trim().isNotEmpty ?? false)
        ? message.title!.trim()
        : l10n.pushNotificationFallbackTitle;
    final String? body = (message.body?.trim().isNotEmpty ?? false)
        ? message.body!.trim()
        : null;
    messenger.showSnackBar(
      SnackBar(
        duration: pushBannerDuration,
        behavior: SnackBarBehavior.floating,
        content: Semantics(
          liveRegion: true,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              if (body != null) Text(body),
            ],
          ),
        ),
        action: SnackBarAction(
          label: l10n.pushNotificationOpen,
          onPressed: () => _open(message),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
