/// Gives photos a server refused (`failed`) one more bounded try when the
/// reason may have cleared: on sign-in and on session restore (the active
/// person appears or changes). The connection coming back is handled by the
/// background pass itself (`background_sync.dart`, one-off task).
///
/// Without this a record that needs its photo (tyre change, checklist, job
/// completion, accident) would sit waiting forever once the photo was
/// marked `failed`. The requeue is bounded: one more try per photo, and a
/// photo still inside its backoff is skipped (`MediaDao.requeueFailedMedia`).
///
/// Mounted once from `MaterialApp.router`'s `builder` in `main.dart`.
library;

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/profile/sync_queue_providers.dart'
    show syncNowRequestProvider;

class PhotoRetryBinding extends ConsumerStatefulWidget {
  const PhotoRetryBinding({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<PhotoRetryBinding> createState() => _PhotoRetryBindingState();
}

class _PhotoRetryBindingState extends ConsumerState<PhotoRetryBinding> {
  @override
  void initState() {
    super.initState();
    ref.listenManual<String?>(
      workspaceContextProvider.select((WorkspaceContext? c) => c?.userId),
      (String? previous, String? next) {
        if (next != null && next != previous) unawaited(_requeue());
      },
      fireImmediately: true,
    );
  }

  Future<void> _requeue() async {
    if (!mounted) return;
    final WorkspaceContext? ctx = ref.read(workspaceContextProvider);
    if (ctx == null) return;
    try {
      final int count =
          await ref.read(appDatabaseProvider).mediaDao.requeueFailedMedia(
                workspaceId: workspaceIdFor(ctx),
                createdBy: ctx.userId,
                now: DateTime.now().toUtc(),
              );
      if (count > 0 && mounted) {
        await ref.read(syncNowRequestProvider)();
      }
    } on Object {
      // Best effort: the photos stay queued and the next pass tries them.
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
