/// Forwards the platform events that should deliver queued assignment updates:
/// sign-in, the app returning to the foreground, and connectivity coming back.
///
/// Mounted once from `MaterialApp.router`'s `builder` in `main.dart`, next to
/// `PushBinding`. All decisions live in `WorkforceSyncCoordinator`; this widget
/// only translates platform callbacks.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/my_work/workforce_sync_providers.dart';

class WorkforceSyncBinding extends ConsumerStatefulWidget {
  const WorkforceSyncBinding({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<WorkforceSyncBinding> createState() =>
      _WorkforceSyncBindingState();
}

class _WorkforceSyncBindingState extends ConsumerState<WorkforceSyncBinding> {
  late final WorkforceSyncCoordinator _coordinator;
  late final AppLifecycleListener _lifecycle;
  StreamSubscription<List<ConnectivityResult>>? _connectivity;

  @override
  void initState() {
    super.initState();
    _coordinator = WorkforceSyncCoordinator(
      engine: ref.read(workforceTransitionEngineProvider),
      onSettled: _refreshScreens,
    );
    _lifecycle = AppLifecycleListener(
      onResume: () => unawaited(_coordinator.resumed()),
    );
    _connectivity = Connectivity().onConnectivityChanged.listen(
      (List<ConnectivityResult> results) {
        final bool online = results.any(
          (ConnectivityResult r) => r != ConnectivityResult.none,
        );
        unawaited(_coordinator.connectivityChanged(online: online));
      },
    );
    ref.listenManual<String?>(
      workforceUserIdProvider,
      (String? previous, String? next) {
        if (next == null) {
          _coordinator.signedOut();
        } else {
          unawaited(_coordinator.signedIn(next));
        }
      },
      fireImmediately: true,
    );
  }

  void _refreshScreens() {
    if (!mounted) return;
    ref
      ..invalidate(workforceAssignmentsProvider)
      ..invalidate(workforceQueuedProvider);
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
