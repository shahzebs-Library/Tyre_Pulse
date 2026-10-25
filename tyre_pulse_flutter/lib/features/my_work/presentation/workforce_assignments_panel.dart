/// The company-assignment lane in the existing My Work screen.
///
/// Status updates work offline: a tap is stored in the durable per-user queue,
/// shown immediately as "Pending sync", delivered automatically (reconnect,
/// app resume, sign-in) and, if the server refuses it, shown with the reason
/// until the person reviews it. See `workforce_sync_engine.dart`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_view.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/workforce_sync_providers.dart';
import 'package:tyre_pulse/features/tasks/presentation/tasks_copy.dart';

// The read providers live with the sync providers; re-exported so existing
// importers of this file keep working.
export 'package:tyre_pulse/features/my_work/workforce_sync_providers.dart'
    show
        workforceAssignmentCacheProvider,
        workforceAssignmentsProvider,
        workforceAssignmentsRepositoryProvider;

/// Stable keys for the lane's honest states (loading, error, empty, offline).
abstract final class WorkforceAssignmentsPanelKeys {
  static const Key loading = Key('workforce.loading');
  static const Key error = Key('workforce.error');
  static const Key retry = Key('workforce.retry');
  static const Key empty = Key('workforce.empty');
  static const Key offline = Key('workforce.offlineBanner');
}

/// Stable keys for widget tests.
abstract final class WorkforcePanelKeys {
  static Key action(String assignmentId, WorkforceAction action) =>
      Key('workforce.action.$assignmentId.${action.wire}');
  static Key pending(String assignmentId) =>
      Key('workforce.pending.$assignmentId');
  static Key rejected(String assignmentId) =>
      Key('workforce.rejected.$assignmentId');
  static Key dismiss(String queueId) => Key('workforce.dismiss.$queueId');
  static Key retry(String queueId) => Key('workforce.retry.$queueId');
  static const Key offlineBanner = Key('workforce.offlineBanner');
  static const Key noteField = Key('workforce.noteField');
  static const Key noteConfirm = Key('workforce.noteConfirm');
}

class WorkforceAssignmentsPanel extends ConsumerWidget {
  const WorkforceAssignmentsPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<WorkforceAssignmentViewState> state =
        ref.watch(workforceAssignmentViewsProvider);
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
            state.when(
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
                    onPressed: () {
                      ref
                        ..invalidate(workforceAssignmentsProvider)
                        ..invalidate(workforceQueuedProvider);
                    },
                    child: Text(copy('retry')),
                  ),
                ],
              ),
              data: (WorkforceAssignmentViewState data) => data.views.isEmpty
                  ? Column(
                      key: WorkforceAssignmentsPanelKeys.empty,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (data.offline) _offlineNote(),
                        Text(copy('wfEmpty')),
                      ],
                    )
                  : Column(
                      children: <Widget>[
                        if (data.offline) _offlineNote(),
                        for (final WorkforceAssignmentView view in data.views)
                          _AssignmentTile(view: view),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _offlineNote() => const Padding(
        key: WorkforcePanelKeys.offlineBanner,
        padding: EdgeInsetsDirectional.only(bottom: 8),
        child: Text(
          'Offline: showing saved assignments. Updates '
          'you make are kept and sent when you reconnect.',
        ),
      );
}

String workforceStatusLabel(String status) {
  switch (status) {
    case 'assigned':
      return 'Assigned';
    case 'acknowledged':
      return 'Accepted';
    case 'in_progress':
      return 'In progress';
    case 'blocked':
      return 'Blocked';
    case 'submitted':
      return 'Awaiting review';
    case 'verified':
      return 'Verified';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status.replaceAll('_', ' ');
  }
}

/// Translated label for [value], falling back to [fallback] when the copy has
/// no entry (TasksCopy returns the key itself for a missing one).
String _localised(TasksCopy copy, String prefix, String value, String fallback) {
  final String found = copy('$prefix$value');
  return found == '$prefix$value' ? fallback : found;
}

class _AssignmentTile extends StatelessWidget {
  const _AssignmentTile({required this.view});

  final WorkforceAssignmentView view;

  @override
  Widget build(BuildContext context) {
    final String id = view.assignment.id;
    final TasksCopy copy = TasksCopy.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            view.assignment.title,
            style: Theme.of(context).textTheme.titleSmall,
          ),
          Text(
            '${view.assignment.site ?? copy('wfSiteUnspecified')} · '
            '${_localised(copy, 'wfS_', view.displayStatus, workforceStatusLabel(view.displayStatus))} · '
            '${_localised(copy, 'wfP_', view.assignment.priority, view.assignment.priority)}',
          ),
          if (view.hasPending)
            Padding(
              key: WorkforcePanelKeys.pending(id),
              padding: const EdgeInsets.only(top: 4),
              child: const Text('Pending sync: will be sent when you are online.'),
            ),
          for (final QueuedWorkforceTransition entry in view.rejected)
            _RejectedNotice(entry: entry, assignmentId: id),
          if (view.actions.isNotEmpty)
            Wrap(
              spacing: 8,
              children: <Widget>[
                for (final WorkforceAction action in view.actions)
                  TextButton(
                    key: WorkforcePanelKeys.action(id, action),
                    onPressed: () => _submit(context, view, action),
                    child: Text(action.label),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  Future<void> _submit(
    BuildContext context,
    WorkforceAssignmentView view,
    WorkforceAction action,
  ) async {
    // Captured before any await: the tile may be rebuilt or disposed while a
    // dialog is open or the update is in flight.
    final ProviderContainer container = ProviderScope.containerOf(context);
    final String? userId = container.read(workforceUserIdProvider);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    if (userId == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Sign in to update assignments.')),
      );
      return;
    }
    String? note;
    if (action.noteRequired) {
      note = await showDialog<String>(
        context: context,
        builder: (BuildContext context) => _NoteDialog(title: action.label),
      );
      if (note == null) return;
    }
    final WorkforceSubmitResult result =
        await container.read(workforceTransitionEngineProvider).submit(
              userId: userId,
              assignmentId: view.assignment.id,
              serverStatus: view.assignment.status,
              action: action,
              note: note,
            );
    container.invalidate(workforceQueuedProvider);
    if (result.outcome == WorkforceSubmitOutcome.deliveredNow ||
        result.outcome == WorkforceSubmitOutcome.rejected) {
      container.invalidate(workforceAssignmentsProvider);
    }
    final String message;
    switch (result.outcome) {
      case WorkforceSubmitOutcome.deliveredNow:
        message = 'Updated.';
      case WorkforceSubmitOutcome.queued:
        message = 'Saved on this device. It will be sent when you are online.';
      case WorkforceSubmitOutcome.rejected:
        message = result.message ?? 'The update was not accepted.';
      case WorkforceSubmitOutcome.refused:
        message = result.message ?? 'That update is not available.';
    }
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }
}

class _RejectedNotice extends StatelessWidget {
  const _RejectedNotice({required this.entry, required this.assignmentId});

  final QueuedWorkforceTransition entry;
  final String assignmentId;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Container(
      key: WorkforcePanelKeys.rejected(assignmentId),
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        border: Border.all(color: colors.error),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Not accepted: ${entry.action.label}'
            '${entry.note == null ? '' : ' ("${entry.note}")'}',
            style: TextStyle(color: colors.error, fontWeight: FontWeight.w600),
          ),
          Text(entry.error ?? 'The server did not accept this update.'),
          Wrap(
            spacing: 8,
            children: <Widget>[
              TextButton(
                key: WorkforcePanelKeys.dismiss(entry.id),
                onPressed: () async {
                  final ProviderContainer container =
                      ProviderScope.containerOf(context);
                  await container
                      .read(workforceTransitionEngineProvider)
                      .dismiss(entry.userId, entry.id);
                  container
                    ..invalidate(workforceQueuedProvider)
                    ..invalidate(workforceAssignmentsProvider);
                },
                child: const Text('Dismiss'),
              ),
              if (entry.rejectionReason != 'invalid_transition' &&
                  entry.rejectionReason != 'not_found' &&
                  entry.rejectionReason != 'forbidden')
                TextButton(
                  key: WorkforcePanelKeys.retry(entry.id),
                  onPressed: () async {
                    final ProviderContainer container =
                        ProviderScope.containerOf(context);
                    await container
                        .read(workforceTransitionEngineProvider)
                        .retry(entry.userId, entry.id);
                    container
                      ..invalidate(workforceQueuedProvider)
                      ..invalidate(workforceAssignmentsProvider);
                  },
                  child: const Text('Try again'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _NoteDialog extends StatefulWidget {
  const _NoteDialog({required this.title});

  final String title;

  @override
  State<_NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<_NoteDialog> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        key: WorkforcePanelKeys.noteField,
        controller: _controller,
        autofocus: true,
        maxLength: 2000,
        maxLines: 3,
        decoration: const InputDecoration(labelText: 'Reason (required)'),
        onChanged: (_) => setState(() {}),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: WorkforcePanelKeys.noteConfirm,
          onPressed: _controller.text.trim().isEmpty
              ? null
              : () => Navigator.of(context).pop(_controller.text.trim()),
          child: Text(widget.title),
        ),
      ],
    );
  }
}
