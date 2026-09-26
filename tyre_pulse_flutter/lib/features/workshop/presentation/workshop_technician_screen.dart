/// Workshop Live Control - the technician's "My Jobs" screen.
///
/// Ported from `mobile/app/(app)/workshop.tsx` (READ-ONLY reference, see
/// `AGENTS.md`). A technician sees their assigned OPEN jobs and, per job,
/// taps large buttons to record activity (Start / Pause / Resume / Complete
/// / Request Parts / Assistance / Waiting for Approval / Vehicle / Tools /
/// Break / Report Problem) plus shift Check In / Check Out. Every tap is one
/// `tech_activity_events` row queued offline-safe (`WORKSHOP_EVENT`,
/// idempotent on `client_uuid`); see `workshop_repository.dart`.
///
/// Rules carried over from mobile, each enforced in [_onAction]:
/// - no job selected -> "Select a job"; not checked in -> "Check in first";
/// - a job split into tasks must name the task for Start / Complete;
/// - Complete asks for confirmation; blocked reasons, a problem and an
///   assistance request collect an optional note.
///
/// A just-recorded event is shown immediately from its local copy and
/// dropped as soon as the synced row (same `client_uuid`) is read back, so
/// the live status never regresses while the queue is still draining.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/workshop/data/workshop_repository.dart';
import 'package:tyre_pulse/features/workshop/domain/workshop_live.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_copy.dart';
import 'package:tyre_pulse/features/workshop/workshop_providers.dart';

abstract final class WorkshopTechnicianKeys {
  static const Key checkToggle = ValueKey<String>('workshop.check-toggle');
  static Key job(String id) => ValueKey<String>('workshop.job.$id');
  static Key task(String id) => ValueKey<String>('workshop.task.$id');
  static Key action(String key) => ValueKey<String>('workshop.action.$key');
  static const Key productivity = ValueKey<String>('workshop.productivity');
}

TpStatus _statusTone(WorkshopStatus s) => switch (s) {
      WorkshopStatus.working => TpStatus.ok,
      WorkshopStatus.available ||
      WorkshopStatus.awaitingInspection ||
      WorkshopStatus.training =>
        TpStatus.info,
      WorkshopStatus.waitingParts ||
      WorkshopStatus.waitingApproval ||
      WorkshopStatus.waitingTools ||
      WorkshopStatus.waitingVehicle =>
        TpStatus.warning,
      WorkshopStatus.absent => TpStatus.critical,
      WorkshopStatus.onBreak || WorkshopStatus.offDuty => TpStatus.neutral,
    };

IconData _actionIcon(String key) => switch (key) {
      'start_job' => Icons.play_circle_outline,
      'pause_job' => Icons.pause_circle_outline,
      'resume_job' => Icons.play_arrow_rounded,
      'complete_task' => Icons.task_alt_rounded,
      'request_parts' => Icons.inventory_2_outlined,
      'request_assistance' => Icons.people_outline,
      'waiting_approval' => Icons.verified_user_outlined,
      'waiting_vehicle' => Icons.directions_car_outlined,
      'waiting_tools' => Icons.construction_outlined,
      'start_break' => Icons.coffee_outlined,
      'end_break' => Icons.directions_walk_outlined,
      'report_problem' => Icons.error_outline,
      _ => Icons.touch_app_outlined,
    };

class WorkshopTechnicianScreen extends ConsumerStatefulWidget {
  const WorkshopTechnicianScreen({super.key});

  @override
  ConsumerState<WorkshopTechnicianScreen> createState() =>
      _WorkshopTechnicianScreenState();
}

class _WorkshopTechnicianScreenState
    extends ConsumerState<WorkshopTechnicianScreen> {
  bool _loading = true;
  Object? _error;
  List<WorkshopJob> _jobs = const <WorkshopJob>[];
  List<WorkshopEventRecord> _serverEvents = const <WorkshopEventRecord>[];
  final List<WorkshopEventRecord> _localEvents = <WorkshopEventRecord>[];
  String? _selectedJobId;
  List<WorkshopTask> _tasks = const <WorkshopTask>[];
  String? _selectedTaskId;
  String? _busyKey;
  Timer? _clock;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _clock = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    _clock?.cancel();
    super.dispose();
  }

  String get _userId => ref.read(workspaceContextProvider)?.userId ?? '';

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final WorkshopRepository repo = ref.read(workshopRepositoryProvider);
      final List<WorkshopJob> jobs = await repo.listMyJobs(_userId);
      final List<WorkshopEventRecord> events =
          await repo.listMyRecentEvents(_userId);
      if (!mounted) return;
      final String? keep = jobs.any((WorkshopJob j) => j.id == _selectedJobId)
          ? _selectedJobId
          : (jobs.isEmpty ? null : jobs.first.id);
      setState(() {
        _jobs = jobs;
        _serverEvents = events;
        _loading = false;
      });
      if (keep != _selectedJobId || _tasks.isEmpty) {
        await _selectJob(keep);
      }
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _selectJob(String? jobId) async {
    setState(() {
      _selectedJobId = jobId;
      _selectedTaskId = null;
      _tasks = const <WorkshopTask>[];
    });
    if (jobId == null) return;
    try {
      final List<WorkshopTask> tasks =
          await ref.read(workshopRepositoryProvider).listTasksForJob(jobId);
      if (!mounted || _selectedJobId != jobId) return;
      setState(() => _tasks = tasks);
    } on Object {
      // Tasks refine the job-level flow; a job whose tasks cannot be read
      // still records job-level events, exactly as a job with no tasks.
    }
  }

  List<WorkshopEventRecord> get _events =>
      mergeWorkshopEvents(_serverEvents, _localEvents);

  bool get _checkedIn => workshopIsCheckedIn(
        _events.map((WorkshopEventRecord e) => e.asLike),
      );

  WorkshopJob? get _selectedJob {
    for (final WorkshopJob j in _jobs) {
      if (j.id == _selectedJobId) return j;
    }
    return null;
  }

  Future<void> _record({
    required String eventType,
    required String busyKey,
    String? jobId,
    String? reason,
    String? note,
  }) async {
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null || _busyKey != null) return;
    final WorkshopCopy copy = WorkshopCopy.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final WorkshopJob? job = jobId == null ? null : _selectedJob;
    setState(() => _busyKey = busyKey);
    try {
      final WorkshopEventRecord local =
          await ref.read(workshopRepositoryProvider).recordEvent(
                workspace: workspace,
                input: RecordWorkshopEventInput(
                  eventType: eventType,
                  jobId: jobId,
                  taskId: jobId == null ? null : _selectedTaskId,
                  assetNo: job?.assetNo,
                  reasonCode: reason,
                  note: note,
                  site: job?.site ?? workspace.legacySite,
                  country: workspace.activeCountry,
                  device: 'mobile:${defaultTargetPlatform.name.toLowerCase()}',
                ),
              );
      if (!mounted) return;
      setState(() => _localEvents.add(local));
      messenger.showSnackBar(SnackBar(content: Text(copy('queued'))));
    } on Object {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(copy('saveFailed'))));
    } finally {
      if (mounted) setState(() => _busyKey = null);
    }
  }

  Future<void> _info(String title, String message) {
    final WorkshopCopy copy = WorkshopCopy.of(context);
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(copy('ok')),
          ),
        ],
      ),
    );
  }

  Future<void> _onCheckToggle() async {
    if (_busyKey != null) return;
    await _record(
      eventType: _checkedIn ? 'check_out' : 'check_in',
      busyKey: 'check',
    );
  }

  Future<void> _onAction(WorkshopTechAction action) async {
    if (_busyKey != null) return;
    final WorkshopCopy copy = WorkshopCopy.of(context);
    final WorkshopJob? job = _selectedJob;
    if (job == null) {
      await _info(copy('selectJobTitle'), copy('selectJobMsg'));
      return;
    }
    if (!_checkedIn) {
      await _info(copy('checkInFirstTitle'), copy('checkInHint'));
      return;
    }
    if (action.requiresTask && _tasks.isNotEmpty && _selectedTaskId == null) {
      await _info(copy('selectTaskTitle'), copy('selectTaskMsg'));
      return;
    }
    if (action.confirm) {
      final bool? ok = await showDialog<bool>(
        context: context,
        builder: (BuildContext dialogContext) => AlertDialog(
          title: Text(copy('confirmTitle')),
          content: Text(copy('confirmMsg')),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(copy('cancel')),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(copy('a_${action.key}')),
            ),
          ],
        ),
      );
      if (ok != true) return;
      await _record(
        eventType: action.event,
        busyKey: action.key,
        jobId: job.id,
        reason: action.reason,
      );
      return;
    }
    if (action.needsNote) {
      final String? note = await _askNote(copy, action);
      if (note == null) return; // cancelled
      await _record(
        eventType: action.event,
        busyKey: action.key,
        jobId: job.id,
        reason: action.reason,
        note: note.trim().isEmpty ? null : note.trim(),
      );
      return;
    }
    await _record(
      eventType: action.event,
      busyKey: action.key,
      jobId: job.id,
      reason: action.reason,
    );
  }

  /// Returns the note ('' when left blank), or null when cancelled.
  Future<String?> _askNote(WorkshopCopy copy, WorkshopTechAction action) {
    final TextEditingController controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(copy('a_${action.key}')),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 3,
          maxLength: 500,
          decoration: InputDecoration(hintText: copy('noteHint')),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(copy('cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: Text(copy('record')),
          ),
        ],
      ),
    ).whenComplete(controller.dispose);
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopCopy copy = WorkshopCopy.of(context);
    final String fallback = TpBackFallbacks.forRoute(const WorkshopRoute());
    return TpScaffold(
      backFallback: fallback,
      appBar: TpAppBar(
        title: copy('title'),
        subtitle:
            _loading ? null : (_checkedIn ? copy('onDuty') : copy('offDuty')),
        backFallback: fallback,
      ),
      body: _body(copy),
    );
  }

  Widget _body(WorkshopCopy copy) {
    if (_loading) return const TpLoadingState();
    if (_error != null) {
      final Object error = _error!;
      final AppError appError = switch (error) {
        AppError() => error,
        SupabaseFailure() => error.error,
        _ => AppError(
            kind: AppErrorKind.unknown,
            message: copy('loadError'),
            technical: error.toString(),
            cause: error,
            isRetryable: true,
          ),
      };
      return TpErrorState(error: appError, onRetry: _load);
    }

    final List<WorkshopEventRecord> events = _events;
    final bool checkedIn = _checkedIn;
    final WorkshopJob? job = _selectedJob;
    final WorkshopStatus? jobStatus = job == null
        ? null
        : workshopStatusFromEvents(
            <WorkshopEventLike>[
              for (final WorkshopEventRecord e in events)
                if (e.jobId == job.id) e.asLike,
            ],
            present: checkedIn,
          );
    final DateTime startOfDay = DateTime(_now.year, _now.month, _now.day);
    final WorkshopProductivity productivity = workshopProductivityToday(
      <WorkshopEventLike>[
        for (final WorkshopEventRecord e in events)
          if (e.asLike.at != null && !e.asLike.at!.isBefore(startOfDay))
            e.asLike,
      ],
      now: _now,
    );

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.lg,
          TpSpace.xxl,
        ),
        children: <Widget>[
          _CheckCard(
            copy: copy,
            checkedIn: checkedIn,
            busy: _busyKey == 'check',
            onToggle: _onCheckToggle,
          ),
          const SizedBox(height: TpSpace.md),
          _ProductivityCard(copy: copy, productivity: productivity),
          const SizedBox(height: TpSpace.lg),
          Text(
            copy('myJobs'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: TpSpace.sm),
          if (_jobs.isEmpty)
            TpEmptyState(
              icon: Icons.build_circle_outlined,
              title: copy('emptyTitle'),
              message: copy('emptyMessage'),
            )
          else
            for (final WorkshopJob j in _jobs)
              _JobCard(
                job: j,
                copy: copy,
                selected: j.id == _selectedJobId,
                status: j.id == _selectedJobId ? jobStatus : null,
                onTap: () => unawaited(_selectJob(j.id)),
              ),
          if (job != null && _tasks.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            Text(
              copy('tasks'),
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final WorkshopTask t in _tasks)
                  ChoiceChip(
                    key: WorkshopTechnicianKeys.task(t.id),
                    label: Text(
                      t.seq == null
                          ? (t.title ?? t.id)
                          : '${t.seq}. ${t.title ?? ''}'.trim(),
                    ),
                    selected: t.id == _selectedTaskId,
                    onSelected: (bool on) => setState(
                      () => _selectedTaskId = on ? t.id : null,
                    ),
                  ),
              ],
            ),
          ],
          if (job != null) ...<Widget>[
            const SizedBox(height: TpSpace.lg),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                for (final WorkshopTechAction a in kWorkshopTechActions)
                  TpButton.secondary(
                    key: WorkshopTechnicianKeys.action(a.key),
                    label: copy('a_${a.key}'),
                    icon: _actionIcon(a.key),
                    isBusy: _busyKey == a.key,
                    onPressed:
                        _busyKey == null ? () => unawaited(_onAction(a)) : null,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _CheckCard extends StatelessWidget {
  const _CheckCard({
    required this.copy,
    required this.checkedIn,
    required this.busy,
    required this.onToggle,
  });

  final WorkshopCopy copy;
  final bool checkedIn;
  final bool busy;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return TpCard(
      child: Row(
        children: <Widget>[
          TpStatusChip(
            status: checkedIn ? TpStatus.ok : TpStatus.neutral,
            label: checkedIn ? copy('onDuty') : copy('offDuty'),
          ),
          const Spacer(),
          if (checkedIn)
            TpButton.secondary(
              key: WorkshopTechnicianKeys.checkToggle,
              label: copy('checkOut'),
              icon: Icons.logout_rounded,
              isBusy: busy,
              onPressed: busy ? null : onToggle,
            )
          else
            TpButton.primary(
              key: WorkshopTechnicianKeys.checkToggle,
              label: copy('checkIn'),
              icon: Icons.login_rounded,
              isBusy: busy,
              onPressed: busy ? null : onToggle,
            ),
        ],
      ),
    );
  }
}

class _ProductivityCard extends StatelessWidget {
  const _ProductivityCard({required this.copy, required this.productivity});

  final WorkshopCopy copy;
  final WorkshopProductivity productivity;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    Widget stat(String label, String value) => Expanded(
          child: Column(
            children: <Widget>[
              Text(value, style: text.titleMedium),
              const SizedBox(height: TpSpace.xs),
              Text(
                label,
                style: text.labelSmall,
                textAlign: TextAlign.center,
                maxLines: 2,
              ),
            ],
          ),
        );
    return TpCard(
      key: WorkshopTechnicianKeys.productivity,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(copy('todayTitle'), style: text.titleSmall),
          const SizedBox(height: TpSpace.sm),
          Row(
            children: <Widget>[
              stat(
                copy('productive'),
                formatWorkshopMinutes(productivity.productiveMin),
              ),
              stat(
                copy('blocked'),
                formatWorkshopMinutes(productivity.blockedMin),
              ),
              stat(
                copy('unassigned'),
                formatWorkshopMinutes(productivity.unassignedMin),
              ),
              stat(
                copy('breakTime'),
                formatWorkshopMinutes(productivity.breakMin),
              ),
              stat(copy('completed'), '${productivity.jobsCompleted}'),
            ],
          ),
        ],
      ),
    );
  }
}

class _JobCard extends StatelessWidget {
  const _JobCard({
    required this.job,
    required this.copy,
    required this.selected,
    required this.status,
    required this.onTap,
  });

  final WorkshopJob job;
  final WorkshopCopy copy;
  final bool selected;
  final WorkshopStatus? status;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final TextTheme text = Theme.of(context).textTheme;
    final WorkshopStatus? s = status;
    return TpCard(
      key: WorkshopTechnicianKeys.job(job.id),
      margin: const EdgeInsets.only(bottom: TpSpace.sm),
      borderColor: selected ? palette.primary : palette.border,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  job.workOrderNo ?? job.id,
                  style: text.titleSmall,
                ),
              ),
              if (s != null)
                TpStatusChip(
                  status: _statusTone(s),
                  label: copy('s_${s.token}'),
                  isCompact: true,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.xs),
          Text(
            <String>[
              if (job.assetNo != null) job.assetNo!,
              if (job.site != null) job.site!,
              if (job.priority != null) job.priority!,
              if (job.targetCompletion != null)
                '${copy('due')} ${job.targetCompletion!.split('T').first}',
            ].join(' | '),
            style: text.bodySmall?.copyWith(color: palette.textSecondary),
          ),
        ],
      ),
    );
  }
}
