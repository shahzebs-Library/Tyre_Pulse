/// Sends waiting on-site verifications from anywhere in the app, not only
/// while the verify screen is open: on sign-in, when the app returns to the
/// foreground and when the network comes back. Mounted once in `main.dart`
/// next to `PhysicalOutboxSyncBinding`, whose shape this copies.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/fleet_verification/data/fleet_verification_repository.dart';
import 'package:tyre_pulse/features/fleet_verification/fleet_verification_providers.dart';

class FleetVerificationSyncBinding extends ConsumerStatefulWidget {
  const FleetVerificationSyncBinding({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<FleetVerificationSyncBinding> createState() =>
      _FleetVerificationSyncBindingState();
}

class _FleetVerificationSyncBindingState
    extends ConsumerState<FleetVerificationSyncBinding> {
  late final AppLifecycleListener _lifecycle;
  StreamSubscription<List<ConnectivityResult>>? _connectivity;
  bool _wasOffline = false;
  bool _flushing = false;

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
    if (!mounted || _flushing) return;
    _flushing = true;
    try {
      final List<ConnectivityResult> net =
          await Connectivity().checkConnectivity();
      if (net.every((ConnectivityResult r) => r == ConnectivityResult.none)) {
        return; // Offline: nothing to try; reconnect triggers the next flush.
      }
      final FleetVerificationService? service =
          await ref.read(fleetVerificationServiceProvider.future);
      if (service != null) await service.flush();
    } on Object {
      // Everything unsent stays on the phone; the verify screen shows it.
    } finally {
      _flushing = false;
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
