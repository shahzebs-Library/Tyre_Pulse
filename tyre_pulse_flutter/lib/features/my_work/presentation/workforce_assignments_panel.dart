/// The new company-assignment lane in the existing My Work screen.
///
/// Server-dependent status decisions are online-only and never silently
/// queued. The lane has four honest states: loading, error (with Retry),
/// empty, and offline (cached, read-only). A status change the server
/// refuses is explained in plain words and offers a way forward.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_cache.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/tasks/presentation/tasks_copy.dart';

final workforceAssignmentCacheProvider =
    Provider<WorkforceAssignmentCache>((ref) {
  return WorkforceAssignmentCache(ref.watch(secureStoreProvider));
});

final workforceAssignmentsRepositoryProvider =
    Provider<WorkforceAssignmentsSource>((ref) {
  return WorkforceAssignmentsRepository(
    ref.watch(supabaseClientProvider),
    ref.watch(workforceAssignmentCacheProvider),
  );
});

final workforceAssignmentsProvider =
    FutureProvider.autoDispose<WorkforceAssignmentSnapshot>(
  (ref) async {
    return ref.read(workforceAssignmentsRepositoryProvider).listMine();
  },
  // A failed read shows an honest error with an explicit Retry button instead
  // of silently re-querying in the background.
  retry: (int retryCount, Object error) => null,
);

/// Stable keys so tests can find each state.
abstract final class WorkforceAssignmentsPanelKeys {
  static const Key loading = Key('workforce.loading');
  static const Key error = Key('workforce.error');
  static const Key retry = Key('workforce.retry');
  static const Key empty = Key('workforce.empty');
  static const Key offline = Key('workforce.offline');
  static Key action(String id) => Key('workforce.action.$id');
}

class WorkforceAssignmentsPanel extends ConsumerStatefulWidget {
  const WorkforceAssignmentsPanel({super.key});

  @override
  ConsumerState<WorkforceAssignmentsPanel> createState() =>
      _WorkforceAssignmentsPanelState();
}

class _WorkforceAssignmentsPanelState
    extends ConsumerState<WorkforceAssignmentsPanel> {
  final Set<String> _busy = <String>{};

  String _label(TasksCopy copy, String prefix, String value) {
    final String found = copy('$prefix$value');
    return found == '$prefix$value' ? value : found;
  }

  String _failureMessage(TasksCopy copy, WorkforceTransitionFailure failure) {
    return switch (failure) {
      WorkforceTransitionFailure.rejected => copy('wfRejected'),
      WorkforceTransitionFailure.conflict => copy('wfConflict'),
      WorkforceTransitionFailure.denied => copy('wfDenied'),
      WorkforceTransitionFailure.network => copy('wfNetwork'),
    };
  }

  Future<void> _advance(WorkforceAssignment item, TasksCopy copy) async {
    if (_busy.contains(item.id)) return;
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    setState(() => _busy.add(item.id));
    try {
      await ref.read(workforceAssignmentsRepositoryProvider).advance(item);
      ref.invalidate(workforceAssignmentsProvider);
    } on Object catch (error) {
      final WorkforceTransitionFailure failure =
          classifyWorkforceTransitionError(error);
      final bool sameRequestCanSucceed =
          failure == WorkforceTransitionFailure.network;
      // Anything other than "never reached the server" means what is on
      // screen may be out of date, so reload it.
      if (!sameRequestCanSucceed) {
        ref.invalidate(workforceAssignmentsProvider);
      }
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(_failureMessage(copy, failure)),
            action: SnackBarAction(
              label: sameRequestCanSucceed ? copy('retry') : copy('wfRefresh'),
              onPressed: () {
                if (sameRequestCanSucceed) {
                  unawaited(_advance(item, copy));
                } else {
                  ref.invalidate(workforceAssignmentsProvider);
                }
              },
            ),
          ),
        );
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<WorkforceAssignmentSnapshot> snapshot =
        ref.watch(workforceAssignmentsProvider);
    final TasksCopy copy = TasksCopy.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsetsDirectional.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              copy('wfTitle'),
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            snapshot.when(
              loading: () => const Center(
                child: CircularProgressIndicator(
                  key: WorkforceAssignmentsPanelKeys.loading,
                ),
              ),
              error: (Object error, StackTrace stack) => Column(
                key: WorkforceAssignmentsPanelKeys.error,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(copy('wfLoadError')),
                  TextButton(
                    key: WorkforceAssignmentsPanelKeys.retry,
                    onPressed: () =>
                        ref.invalidate(workforceAssignmentsProvider),
                    child: Text(copy('retry')),
                  ),
                ],
              ),
              data: (WorkforceAssignmentSnapshot data) =>
                  _body(context, copy, data),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    TasksCopy copy,
    WorkforceAssignmentSnapshot data,
  ) {
    if (data.items.isEmpty) {
      return Column(
        key: WorkforceAssignmentsPanelKeys.empty,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (data.offline) _offlineNote(copy),
          Text(copy('wfEmpty')),
        ],
      );
    }
    return Column(
      children: <Widget>[
        if (data.offline) _offlineNote(copy),
        for (final WorkforceAssignment item in data.items)
          _row(copy, item, offline: data.offline),
      ],
    );
  }

  Widget _offlineNote(TasksCopy copy) {
    return Padding(
      key: WorkforceAssignmentsPanelKeys.offline,
      padding: const EdgeInsetsDirectional.only(bottom: 8),
      child: Text(copy('wfOffline')),
    );
  }

  Widget _row(
    TasksCopy copy,
    WorkforceAssignment item, {
    required bool offline,
  }) {
    final String? next = item.nextAction;
    final String actionLabel = switch (next) {
      'acknowledged' => copy('wfAcknowledge'),
      'submitted' => copy('wfSubmit'),
      _ => copy('wfStart'),
    };
    final bool busy = _busy.contains(item.id);
    return ListTile(
      title: Text(item.title),
      subtitle: Text(
        '${item.site ?? copy('wfSiteUnspecified')} · '
        '${_label(copy, 'wfS_', item.status)} · '
        '${_label(copy, 'wfP_', item.priority)}',
      ),
      trailing: busy
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : (next == null || offline)
              ? null
              : TextButton(
                  key: WorkforceAssignmentsPanelKeys.action(item.id),
                  onPressed: () => unawaited(_advance(item, copy)),
                  child: Text(actionLabel),
                ),
    );
  }
}
