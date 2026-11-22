/// Sends waiting physical inventory captures and photos from anywhere in the
/// app, not only while the capture screen is open: on sign-in, when the app
/// returns to the foreground and when the network comes back.
///
/// Mounted once from `MaterialApp.router`'s `builder` in `main.dart`, next to
/// `WorkforceSyncBinding`. The background worker (`background_sync.dart`)
/// covers the app being closed. The flush itself and the user rule live in
/// `physical_outbox_runner.dart`; this widget only translates platform events.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/physical_outbox_runner.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/physical_inventory_providers.dart';

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
  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  bool _wasOffline = false;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: () => unawaited(_flush()));
    _connectivity = Connectivity().onConnectivityChanged.listen(
      (List<ConnectivityResult> results) {
        final bool online = results.any(
          (ConnectivityResult r) => r != ConnectivityResult.none,
        );
        if (online && _wasOffline) unawaited(_flush());
        _wasOffline = !online;
      },
    );
    ref.listenManual<String?>(
      workspaceContextProvider.select((ctx) => ctx?.userId),
      (String? previous, String? next) {
        if (next != null && next != previous) unawaited(_flush());
      },
      fireImmediately: true,
    );
  }

  Future<void> _flush() async {
    if (!mounted) return;
    final ctx = ref.read(workspaceContextProvider);
    if (ctx == null) return;
    try {
      final String device = await ref.read(inventoryDeviceIdProvider.future);
      if (!mounted) return;
      await flushPhysicalOutboxFor(
        outbox: ref.read(physicalCaptureOutboxProvider),
        repository: ref.read(physicalInventoryRepositoryProvider),
        signedInUserId: ctx.userId,
        // app_current_org() reads profiles.org_id; the server checks the photo
        // path against it.
        orgId: ctx.tenantId ?? ctx.companyId,
        deviceId: device,
      );
    } on Object {
      // Everything unconfirmed stays in the encrypted outbox; the capture
      // screen shows what is waiting and why.
    }
  }

  @override
  void dispose() {
    unawaited(_connectivity?.cancel());
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
