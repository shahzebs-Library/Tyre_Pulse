/// The company-assignment lane in the existing My Work screen.
///
/// Status updates work offline: a tap is stored in the durable per-user queue,
/// shown immediately as "Pending sync", delivered automatically (reconnect,
/// app resume, sign-in) and, if the server refuses it, shown with the reason
/// until the person reviews it. See `workforce_sync_engine.dart`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_evidence.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignment_view.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/presentation/workforce_copy.dart';
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
  static Key cause(WorkforceBlockReason reason) =>
      Key('workforce.cause.${reason.wire}');
  static const Key causeRequired = Key('workforce.causeRequired');
  static Key details(String assignmentId) =>
      Key('workforce.details.$assignmentId');
  static Key recordHint(String assignmentId) =>
      Key('workforce.recordHint.$assignmentId');
  static Key evidenceCount(String assignmentId) =>
      Key('workforce.evidenceCount.$assignmentId');
  static Key evidenceAdd(String assignmentId) =>
      Key('workforce.evidenceAdd.$assignmentId');
  static const Key evidenceCamera = Key('workforce.evidence.camera');
  static const Key evidenceGallery = Key('workforce.evidence.gallery');
  static const Key evidencePdf = Key('workforce.evidence.pdf');
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
                          _AssignmentTile(
                            view: view,
                            evidenceCounts: ref
                                .watch(workforceEvidenceCountsProvider)
                                .value,
                            offline: data.offline,
                          ),
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
String _localised(
  TasksCopy copy,
  String prefix,
  String value,
  String fallback,
) {
  final String found = copy('$prefix$value');
  return found == '$prefix$value' ? fallback : found;
}

class _AssignmentTile extends StatelessWidget {
  const _AssignmentTile({
    required this.view,
    required this.evidenceCounts,
    required this.offline,
  });

  final WorkforceAssignmentView view;

  /// `null` = could not count (never shown as zero).
  final Map<String, int>? evidenceCounts;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final String id = view.assignment.id;
    final TasksCopy copy = TasksCopy.of(context);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final WorkforceAssignment a = view.assignment;
    final List<String> details = <String>[
      if (a.assetNo != null) l10n.wfAssetLine(a.assetNo!),
      if (a.tyreSerial != null) l10n.wfTyreLine(a.tyreSerial!),
      if (a.tyrePosition != null) l10n.wfTyrePositionLine(a.tyrePosition!),
    ];
    final String? recordLabel =
        workforceRecordLabel(l10n, a.operationalRecordTable);
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
          if (details.isNotEmpty)
            Text(
              details.join(' · '),
              key: WorkforcePanelKeys.details(id),
            ),
          if (recordLabel != null)
            Text(
              a.needsOperationalRecord
                  ? l10n.wfRecordNeeded(recordLabel)
                  : l10n.wfRecordLinked(recordLabel),
              key: WorkforcePanelKeys.recordHint(id),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          _EvidenceRow(
            assignment: a,
            count: evidenceCounts?[id],
            offline: offline,
          ),
          if (view.hasPending)
            Padding(
              key: WorkforcePanelKeys.pending(id),
              padding: const EdgeInsets.only(top: 4),
              child:
                  const Text('Pending sync: will be sent when you are online.'),
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
    final AppLocalizations l10n = AppLocalizations.of(context);
    if (userId == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Sign in to update assignments.')),
      );
      return;
    }
    String? note;
    WorkforceBlockReason? reason;
    if (action == WorkforceAction.block) {
      final ({WorkforceBlockReason reason, String note})? picked =
          await showDialog<({WorkforceBlockReason reason, String note})>(
        context: context,
        builder: (BuildContext context) =>
            WorkforceBlockDialog(title: action.label),
      );
      if (picked == null) return;
      reason = picked.reason;
      note = picked.note;
    } else if (action.noteRequired) {
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
              reason: reason,
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
        message = workforceRefusalText(
              l10n,
              result.item?.rejectionReason,
              currentStatus: result.item?.serverStatus,
              statusLabel: workforceStatusLabel,
            ) ??
            result.message ??
            l10n.wfRefusedUnknown;
      case WorkforceSubmitOutcome.refused:
        message = result.message ?? 'That update is not available.';
    }
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }
}

/// Evidence count plus the online-only "Add evidence" action.
class _EvidenceRow extends ConsumerStatefulWidget {
  const _EvidenceRow({
    required this.assignment,
    required this.count,
    required this.offline,
  });

  final WorkforceAssignment assignment;
  final int? count;
  final bool offline;

  @override
  ConsumerState<_EvidenceRow> createState() => _EvidenceRowState();
}

class _EvidenceRowState extends ConsumerState<_EvidenceRow> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String id = widget.assignment.id;
    // Uploading is allowed only in the statuses the server accepts, judged on
    // the last server-confirmed status (a queued "accept" has not reached the
    // server, so the upload would be refused there).
    final bool allowed =
        workforceEvidenceStatuses.contains(widget.assignment.status);
    final int? count = widget.count;
    if (!allowed && (count == null || count == 0)) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsetsDirectional.only(top: 4),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: 8,
        children: <Widget>[
          Text(
            count == null
                ? l10n.wfEvidenceCountUnavailable
                : l10n.wfEvidenceCount(count),
            key: WorkforcePanelKeys.evidenceCount(id),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (allowed)
            TextButton.icon(
              key: WorkforcePanelKeys.evidenceAdd(id),
              onPressed: _busy || widget.offline ? null : _add,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.attach_file),
              label: Text(l10n.wfEvidenceAdd),
            ),
        ],
      ),
    );
  }

  Future<void> _add() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final ProviderContainer container = ProviderScope.containerOf(context);
    final _EvidenceChoice? choice = await showModalBottomSheet<_EvidenceChoice>(
      context: context,
      builder: (BuildContext context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(16, 16, 16, 8),
              child: Text(l10n.wfEvidenceOnlineOnly),
            ),
            ListTile(
              key: WorkforcePanelKeys.evidenceCamera,
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(l10n.wfEvidenceTakePhoto),
              onTap: () => Navigator.of(context).pop(_EvidenceChoice.camera),
            ),
            ListTile(
              key: WorkforcePanelKeys.evidenceGallery,
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(l10n.wfEvidenceChoosePhoto),
              onTap: () => Navigator.of(context).pop(_EvidenceChoice.gallery),
            ),
            ListTile(
              key: WorkforcePanelKeys.evidencePdf,
              leading: const Icon(Icons.picture_as_pdf_outlined),
              title: Text(l10n.wfEvidenceChoosePdf),
              onTap: () => Navigator.of(context).pop(_EvidenceChoice.pdf),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final WorkforceEvidencePicker picker =
          container.read(workforceEvidencePickerProvider);
      final WorkforceEvidenceFile? file = switch (choice) {
        _EvidenceChoice.camera => await picker.pickPhoto(fromCamera: true),
        _EvidenceChoice.gallery => await picker.pickPhoto(fromCamera: false),
        _EvidenceChoice.pdf => await picker.pickPdf(),
      };
      if (file == null) return;
      messenger.showSnackBar(SnackBar(content: Text(l10n.wfEvidenceUploading)));
      await container
          .read(workforceEvidenceSourceProvider)
          .upload(widget.assignment, file);
      container.invalidate(workforceEvidenceCountsProvider);
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l10n.wfEvidenceUploaded)));
    } on WorkforceEvidenceException catch (error) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              workforceEvidenceProblemText(l10n, error.problem),
            ),
          ),
        );
    } on Object {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(l10n.wfEvidenceFailed)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

enum _EvidenceChoice { camera, gallery, pdf }

/// The localised sentence for a local evidence rule.
String workforceEvidenceProblemText(
  AppLocalizations l10n,
  WorkforceEvidenceProblem problem,
) {
  return switch (problem) {
    WorkforceEvidenceProblem.size => l10n.wfEvidenceTooLarge,
    WorkforceEvidenceProblem.type => l10n.wfEvidenceUnsupported,
    WorkforceEvidenceProblem.status => l10n.wfEvidenceNotAllowed,
    WorkforceEvidenceProblem.unavailable => l10n.wfEvidenceUnavailable,
  };
}

class _RejectedNotice extends StatelessWidget {
  const _RejectedNotice({required this.entry, required this.assignmentId});

  final QueuedWorkforceTransition entry;
  final String assignmentId;

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String explanation = workforceRefusalText(
          l10n,
          entry.rejectionReason,
          currentStatus: entry.serverStatus,
          statusLabel: workforceStatusLabel,
        ) ??
        entry.error ??
        l10n.wfRefusedUnknown;
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
            '${entry.action == WorkforceAction.block ? ' (${workforceBlockCauseLabel(l10n, entry.reasonCode)})' : ''}'
            '${entry.note == null ? '' : ' ("${entry.note}")'}',
            style: TextStyle(color: colors.error, fontWeight: FontWeight.w600),
          ),
          Text(explanation),
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
              if (!workforceTerminalRefusals.contains(entry.rejectionReason))
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

/// Blocking needs a cause AND details. Returns both, or `null` on cancel.
/// Public so it can be widget-tested on its own.
class WorkforceBlockDialog extends StatefulWidget {
  const WorkforceBlockDialog({super.key, required this.title});

  final String title;

  @override
  State<WorkforceBlockDialog> createState() => _WorkforceBlockDialogState();
}

class _WorkforceBlockDialogState extends State<WorkforceBlockDialog> {
  final TextEditingController _controller = TextEditingController();
  WorkforceBlockReason? _reason;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool ready = _reason != null && _controller.text.trim().isNotEmpty;
    return AlertDialog(
      title: Text(widget.title),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              l10n.wfBlockCauseTitle,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: <Widget>[
                for (final WorkforceBlockReason reason
                    in WorkforceBlockReason.values)
                  ChoiceChip(
                    key: WorkforcePanelKeys.cause(reason),
                    label: Text(workforceBlockCauseLabel(l10n, reason)),
                    selected: _reason == reason,
                    onSelected: (bool selected) =>
                        setState(() => _reason = selected ? reason : null),
                  ),
              ],
            ),
            if (_reason == null)
              Padding(
                key: WorkforcePanelKeys.causeRequired,
                padding: const EdgeInsetsDirectional.only(top: 6),
                child: Text(
                  l10n.wfBlockCauseRequired,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            const SizedBox(height: 8),
            TextField(
              key: WorkforcePanelKeys.noteField,
              controller: _controller,
              maxLength: 2000,
              maxLines: 3,
              decoration: InputDecoration(labelText: l10n.wfBlockNoteLabel),
              onChanged: (_) => setState(() {}),
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.wfDialogCancel),
        ),
        FilledButton(
          key: WorkforcePanelKeys.noteConfirm,
          onPressed: ready
              ? () => Navigator.of(context).pop(
                    (reason: _reason!, note: _controller.text.trim()),
                  )
              : null,
          child: Text(widget.title),
        ),
      ],
    );
  }
}
