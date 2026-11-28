/// Sends waiting physical inventory captures and photos from anywhere in the
/// app, not only while the capture screen is open: on sign-in, when the app
/// returns to the foreground, when the network comes back, and every few
/// minutes while something is still waiting.
///
/// Mounted once from `MaterialApp.router`'s `builder` in `main.dart`, next to
/// `WorkforceSyncBinding`. The background worker (`background_sync.dart`)
/// covers the app being closed. The flush itself and the user rule live in
/// `physical_outbox_runner.dart`; this widget only translates platform events.
///
/// Every event goes through [OutboxAutoFlusher], which retries while the
/// network does not answer yet: the connectivity edge fires before the first
/// request can succeed, and a single attempt there is how a Store Keeper's
/// offline counts once never left the phone (field report 2026-11-27).
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/outbox_auto_flusher.dart';
import 'package:tyre_pulse/features/inventory/data/physical_capture_outbox.dart';
import 'package:tyre_pulse/features/inventory/data/physical_outbox_runner.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';

/// How often the foreground app looks again while captures are waiting.
const Duration physicalOutboxPollInterval = Duration(minutes: 2);

class PhysicalOutboxSyncBinding extends ConsumerStatefulWidget {
  const PhysicalOutboxSyncBinding({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<PhysicalOutboxSyncBinding> createState() =>
      _PhysicalOutboxSyncBindingState();
}

class _PhysicalOutboxSyncBindingState
    extends ConsumerState<PhysicalOutboxSyncBinding> {
  late final AppLifecycleListener _lifecycle;
  late final OutboxAutoFlusher _auto = OutboxAutoFlusher(attempt: _flushOnce);
  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(
      onResume: () {
        _startPolling();
        unawaited(_auto.trigger());
      },
      onPause: _stopPolling,
    );
    _connectivity = Connectivity().onConnectivityChanged.listen(
      (List<ConnectivityResult> results) {
        final bool online = results.any(
          (ConnectivityResult r) => r != ConnectivityResult.none,
        );
        // Any online report triggers: the retries in OutboxAutoFlusher cover
        // the seconds before the connection really answers.
        if (online) unawaited(_auto.trigger());
      },
    );
    ref.listenManual<String?>(
      workspaceContextProvider.select((ctx) => ctx?.userId),
      (String? previous, String? next) {
        if (next != null && next != previous) unawaited(_auto.trigger());
      },
      fireImmediately: true,
    );
    _startPolling();
  }

  void _startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(physicalOutboxPollInterval, (_) {
      if (!_auto.running) unawaited(_pollOnce());
    });
  }

  void _stopPolling() {
    _poll?.cancel();
    _poll = null;
  }

  Future<void> _pollOnce() async {
    if (!mounted) return;
    final String? user = ref.read(workspaceContextProvider)?.userId;
    if (user == null) return;
    try {
      final int waiting =
          await ref.read(physicalCaptureOutboxProvider).pendingCount(user);
      if (waiting > 0) await _auto.trigger();
    } on Object {
      // Unreadable now; the next poll or event tries again.
    }
  }

  /// One flush. True when captures still wait because the network did not
  /// answer, so [OutboxAutoFlusher] tries again shortly.
  Future<bool> _flushOnce() async {
    if (!mounted) return false;
    final ctx = ref.read(workspaceContextProvider);
    if (ctx == null) return false;
    final String device = await ref.read(inventoryDeviceIdProvider.future);
    if (!mounted) return false;
    final PhysicalFlushOutcome outcome = await flushPhysicalOutboxFor(
      outbox: ref.read(physicalCaptureOutboxProvider),
      repository: ref.read(physicalInventoryRepositoryProvider),
      signedInUserId: ctx.userId,
      // app_current_org() reads profiles.org_id; the server checks the photo
      // path against it.
      orgId: ctx.tenantId ?? ctx.companyId,
      deviceId: device,
    );
    final OutboxFlushResult? r = outcome.result;
    return r != null && r.stoppedOffline && r.remaining > 0;
  }

  @override
  void dispose() {
    _auto.dispose();
    _stopPolling();
    unawaited(_connectivity?.cancel());
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
