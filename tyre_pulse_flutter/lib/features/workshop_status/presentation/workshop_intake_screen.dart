/// Workshop Status -> Vehicle intake on the phone.
///
/// Two views, each only when the server allows it:
/// - Waiting for me (intake_confirm): vehicles the server routed to me (the
///   on-shift supervisor of the site). Confirm or Return with a reason. My
///   own entries are shown but cannot be confirmed (the database refuses it
///   too).
/// - Add vehicle (intake): one vehicle, auto-filled from the fleet register
///   by the server, routed to the supervisor on shift.
///
/// The list refreshes every 20 s while open (polling, no realtime channel).
/// Same rules and RPCs as the web Vehicle intake tab.
library;

import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_intake.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_intake_copy.dart';
import 'package:tyre_pulse/features/workshop_status/workshop_status_providers.dart';

abstract final class WorkshopIntakeKeys {
  static const Key view = ValueKey<String>('workshopIntake.view');
  static const Key asset = ValueKey<String>('workshopIntake.asset');
  static const Key send = ValueKey<String>('workshopIntake.send');
  static const Key reason = ValueKey<String>('workshopIntake.reason');
  static Key row(String id) => ValueKey<String>('workshopIntake.row.$id');
  static Key confirm(String id) =>
      ValueKey<String>('workshopIntake.confirm.$id');
  static Key returnButton(String id) =>
      ValueKey<String>('workshopIntake.return.$id');
}

enum WorkshopIntakeView { waiting, add }

class WorkshopIntakeScreen extends ConsumerStatefulWidget {
  const WorkshopIntakeScreen({super.key});

  @override
  ConsumerState<WorkshopIntakeScreen> createState() =>
      _WorkshopIntakeScreenState();
}

class _WorkshopIntakeScreenState extends ConsumerState<WorkshopIntakeScreen> {
  WorkshopIntakeView? _view;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mounted) ref.invalidate(workshopIntakeWaitingProvider);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopIntakeCopy copy = WorkshopIntakeCopy.of(context);
    final AsyncValue<WorkshopIntakePermissions> perms =
        ref.watch(workshopIntakePermissionsProvider);
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('title'),
        subtitle: copy('subtitle'),
        backFallback: TpRoutePaths.home,
      ),
      backFallback: TpRoutePaths.home,
      body: perms.when(
        loading: () => const TpLoadingState(),
        error: (Object _, StackTrace __) =>
            TpPermissionDeniedState(reason: copy('noAccess')),
        data: (WorkshopIntakePermissions p) {
          if (!p.any) return TpPermissionDeniedState(reason: copy('noAccess'));
          final List<WorkshopIntakeView> views = <WorkshopIntakeView>[
            if (p.intakeConfirm) WorkshopIntakeView.waiting,
            if (p.intake) WorkshopIntakeView.add,
          ];
          final WorkshopIntakeView view =
              views.contains(_view) ? _view! : views.first;
          return Column(
            children: <Widget>[
              if (views.length > 1)
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    TpSpace.lg,
                    TpSpace.md,
                    TpSpace.lg,
                    0,
                  ),
                  child: TpSegmented<WorkshopIntakeView>(
                    key: WorkshopIntakeKeys.view,
                    expanded: true,
                    value: view,
                    onChanged: (WorkshopIntakeView v) =>
                        setState(() => _view = v),
                    options: <TpSegmentedOption<WorkshopIntakeView>>[
                      TpSegmentedOption<WorkshopIntakeView>(
                        value: WorkshopIntakeView.waiting,
                        label: copy('tabWaiting'),
                        icon: Icons.inbox_outlined,
                      ),
                      TpSegmentedOption<WorkshopIntakeView>(
                        value: WorkshopIntakeView.add,
                        label: copy('tabAdd'),
                        icon: Icons.add_circle_outline,
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: view == WorkshopIntakeView.waiting
                    ? _WaitingList(copy: copy)
                    : _AddVehicleForm(copy: copy),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _WaitingList extends ConsumerStatefulWidget {
  const _WaitingList({required this.copy});
  final WorkshopIntakeCopy copy;

  @override
  ConsumerState<_WaitingList> createState() => _WaitingListState();
}

class _WaitingListState extends ConsumerState<_WaitingList> {
  final Set<String> _busy = <String>{};

  WorkshopIntakeCopy get copy => widget.copy;

  void _toast(String text) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _refresh() async {
    ref.invalidate(workshopIntakeWaitingProvider);
    try {
      await ref.read(workshopIntakeWaitingProvider.future);
    } on Object {
      // Shown by the error state.
    }
  }

  Future<void> _confirm(WorkshopIntakeRecord r) async {
    setState(() => _busy.add(r.id));
    try {
      final Object? res = await ref
          .read(workshopIntakeRepositoryProvider)
          .confirm(<String>[r.id]);
      final String outcome = intakeConfirmOutcome(res, r.id);
      final String message = switch (outcome) {
        'confirmed' => copy('confirmed'),
        'already_confirmed' => copy('alreadyConfirmed'),
        'not_routed_to_you' => copy('notRouted'),
        'refused' => copy('refused'),
        _ => copy('confirmFailed'),
      };
      _toast(message);
      ref.invalidate(workshopIntakeWaitingProvider);
    } on Object {
      if (mounted) _toast(copy('confirmFailed'));
    } finally {
      if (mounted) setState(() => _busy.remove(r.id));
    }
  }

  Future<void> _return(WorkshopIntakeRecord r) async {
    final String? reason = await showDialog<String>(
      context: context,
      builder: (BuildContext ctx) => _ReasonDialog(copy: copy),
    );
    if (reason == null || !mounted) return;
    setState(() => _busy.add(r.id));
    try {
      await ref
          .read(workshopIntakeRepositoryProvider)
          .returnToSender(id: r.id, reason: reason);
      _toast(copy('returned'));
      ref.invalidate(workshopIntakeWaitingProvider);
    } on Object {
      if (mounted) _toast(copy('returnFailed'));
    } finally {
      if (mounted) setState(() => _busy.remove(r.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<WorkshopIntakeRecord>> data =
        ref.watch(workshopIntakeWaitingProvider);
    final String me = ref.watch(workshopStatusUserIdProvider);
    return data.when(
      loading: () => TpLoadingState(message: copy('loading')),
      error: (Object e, StackTrace _) => TpErrorState(
        error: _asAppError(e, copy('loadFailed')),
        onRetry: () => unawaited(_refresh()),
      ),
      data: (List<WorkshopIntakeRecord> rows) => RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(TpSpace.lg),
          children: <Widget>[
            if (rows.isEmpty)
              TpEmptyState(
                icon: Icons.inbox_outlined,
                title: copy('emptyTitle'),
                message: copy('emptyMessage'),
              )
            else ...<Widget>[
              Text(
                copy.waiting(rows.length),
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: TpSpace.md),
              for (final WorkshopIntakeRecord r in rows)
                Padding(
                  padding: const EdgeInsets.only(bottom: TpSpace.sm),
                  child: _WaitingTile(
                    record: r,
                    copy: copy,
                    busy: _busy.contains(r.id),
                    canConfirm: r.canConfirm(me),
                    own: r.isOwnEntry(me),
                    onConfirm: () => unawaited(_confirm(r)),
                    onReturn: () => unawaited(_return(r)),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WaitingTile extends StatelessWidget {
  const _WaitingTile({
    required this.record,
    required this.copy,
    required this.busy,
    required this.canConfirm,
    required this.own,
    required this.onConfirm,
    required this.onReturn,
  });

  final WorkshopIntakeRecord record;
  final WorkshopIntakeCopy copy;
  final bool busy;
  final bool canConfirm;
  final bool own;
  final VoidCallback onConfirm;
  final VoidCallback onReturn;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final String meta = <String>[
      if ((record.site ?? '').isNotEmpty) record.site!,
      if ((record.regNo ?? '').isNotEmpty) record.regNo!,
      if ((record.jobCardRef ?? '').isNotEmpty)
        '${copy('jobCard')}: ${record.jobCardRef}',
    ].join(' · ');
    return TpCard(
      key: WorkshopIntakeKeys.row(record.id),
      padding: const EdgeInsets.all(TpSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              Text(
                record.assetNo,
                textDirection: TextDirection.ltr,
                style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
              TpStatusChip(
                status: TpStatus.info,
                label: copy.source(record.source),
                isCompact: true,
              ),
              if (record.priority != null)
                TpStatusChip(
                  status: record.priority == 'Critical'
                      ? TpStatus.critical
                      : record.priority == 'High'
                          ? TpStatus.warning
                          : TpStatus.neutral,
                  label: copy.priority(record.priority!),
                  isCompact: true,
                ),
            ],
          ),
          if (meta.isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              meta,
              style: text.bodySmall?.copyWith(color: palette.textSecondary),
            ),
          ],
          if ((record.complaint ?? '').isNotEmpty) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(record.complaint!, style: text.bodyMedium),
          ],
          const SizedBox(height: TpSpace.xs),
          Text(
            copy.enteredBy(record.submittedByName ?? copy('system')),
            style: text.bodySmall?.copyWith(color: palette.textMuted),
          ),
          if (own) ...<Widget>[
            const SizedBox(height: TpSpace.xs),
            Text(
              copy('ownEntry'),
              style: text.bodySmall?.copyWith(
                color: palette.forStatus(TpStatus.warning).base,
              ),
            ),
          ],
          if (!own) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            Wrap(
              spacing: TpSpace.sm,
              runSpacing: TpSpace.sm,
              children: <Widget>[
                TpButton.primary(
                  key: WorkshopIntakeKeys.confirm(record.id),
                  label: copy('confirm'),
                  icon: Icons.check_circle_outline,
                  isBusy: busy,
                  isCompact: true,
                  onPressed: canConfirm && !busy ? onConfirm : null,
                ),
                TpButton.secondary(
                  key: WorkshopIntakeKeys.returnButton(record.id),
                  label: copy('return'),
                  icon: Icons.undo,
                  isCompact: true,
                  onPressed: busy ? null : onReturn,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.copy});
  final WorkshopIntakeCopy copy;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final TextEditingController _reason = TextEditingController();
  bool _tried = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopIntakeCopy copy = widget.copy;
    final bool ok = intakeReasonOk(_reason.text);
    return AlertDialog(
      title: Text(copy('returnTitle')),
      content: TpInput(
        key: WorkshopIntakeKeys.reason,
        label: copy('reason'),
        hint: copy('reasonHint'),
        controller: _reason,
        maxLines: 3,
        isRequired: true,
        errorText: _tried && !ok ? copy('reasonShort') : null,
        onChanged: (_) => setState(() {}),
      ),
      actions: <Widget>[
        TpButton.text(
          label: copy('cancel'),
          onPressed: () => Navigator.of(context).pop(),
        ),
        TpButton.primary(
          label: copy('return'),
          onPressed: () {
            if (!ok) {
              setState(() => _tried = true);
              return;
            }
            Navigator.of(context).pop(_reason.text.trim());
          },
        ),
      ],
    );
  }
}

class _AddVehicleForm extends ConsumerStatefulWidget {
  const _AddVehicleForm({required this.copy});
  final WorkshopIntakeCopy copy;

  @override
  ConsumerState<_AddVehicleForm> createState() => _AddVehicleFormState();
}

class _AddVehicleFormState extends ConsumerState<_AddVehicleForm> {
  final TextEditingController _asset = TextEditingController();
  final TextEditingController _site = TextEditingController();
  final TextEditingController _complaint = TextEditingController();
  final TextEditingController _jobCard = TextEditingController();
  String? _workType;
  String? _priority;
  bool _busy = false;
  bool _tried = false;
  // One key per entry: a retry after a lost reply updates instead of duplicating.
  String _clientKey = _newKey();

  static String _newKey() {
    final Random r = Random.secure();
    return List<String>.generate(16, (_) => r.nextInt(16).toRadixString(16))
        .join();
  }

  WorkshopIntakeCopy get copy => widget.copy;

  @override
  void dispose() {
    _asset.dispose();
    _site.dispose();
    _complaint.dispose();
    _jobCard.dispose();
    super.dispose();
  }

  Future<void> _send(String country) async {
    setState(() => _tried = true);
    if (intakeAssetKey(_asset.text).isEmpty) return;
    setState(() => _busy = true);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      final Object? res =
          await ref.read(workshopIntakeRepositoryProvider).addVehicle(
        country: country,
        clientKey: 'phone-$_clientKey',
        fields: <String, String>{
          'asset_no': intakeAssetKey(_asset.text),
          if (_site.text.trim().isNotEmpty) 'site': _site.text.trim(),
          if (_complaint.text.trim().isNotEmpty)
            'complaint': _complaint.text.trim(),
          if (_jobCard.text.trim().isNotEmpty)
            'job_card_ref': _jobCard.text.trim(),
          if (_workType != null) 'work_type': _workType!,
          if (_priority != null) 'priority': _priority!,
        },
      );
      final IntakeOutcome outcome = intakeOutcomeOf(res);
      final String message = switch (outcome) {
        IntakeOutcome.added => copy('sent'),
        IntakeOutcome.updated => copy('updatedRow'),
        IntakeOutcome.unchanged => copy('sameRow'),
        IntakeOutcome.alreadyListed => copy('listedRow'),
        IntakeOutcome.invalid => copy('invalidRow'),
        IntakeOutcome.released => copy('releasedRow'),
        IntakeOutcome.unknown => copy('sendFailed'),
      };
      messenger.showSnackBar(SnackBar(content: Text(message)));
      if (outcome == IntakeOutcome.added || outcome == IntakeOutcome.updated) {
        _asset.clear();
        _site.clear();
        _complaint.clear();
        _jobCard.clear();
        setState(() {
          _workType = null;
          _priority = null;
          _tried = false;
          _clientKey = _newKey();
        });
        ref.invalidate(workshopIntakeWaitingProvider);
      }
    } on Object {
      messenger.showSnackBar(SnackBar(content: Text(copy('sendFailed'))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final String country = (ref.watch(activeCountryProvider) ?? '').trim();
    if (country.isEmpty || country == 'All') {
      return TpEmptyState(
        icon: Icons.public,
        title: copy('pickCountry'),
        message: '',
      );
    }
    final bool assetMissing = _tried && intakeAssetKey(_asset.text).isEmpty;
    return ListView(
      padding: const EdgeInsets.all(TpSpace.lg),
      children: <Widget>[
        TpInput(
          key: WorkshopIntakeKeys.asset,
          label: copy('assetCode'),
          controller: _asset,
          isRequired: true,
          textCapitalization: TextCapitalization.characters,
          textDirection: TextDirection.ltr,
          errorText: assetMissing ? copy('assetRequired') : null,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: TpSpace.md),
        TpInput(label: copy('site'), hint: copy('siteHint'), controller: _site),
        const SizedBox(height: TpSpace.md),
        TpInput(label: copy('complaint'), controller: _complaint, maxLines: 3),
        const SizedBox(height: TpSpace.md),
        TpInput(
          label: copy('jobCardNo'),
          controller: _jobCard,
          textDirection: TextDirection.ltr,
        ),
        const SizedBox(height: TpSpace.md),
        TpDropdown<String>(
          label: copy('workType'),
          value: _workType,
          hint: copy('notSet'),
          items: <TpDropdownItem<String>>[
            for (final String w in kIntakeWorkTypes)
              TpDropdownItem<String>(value: w, label: copy.workType(w)),
          ],
          onChanged: (String? v) => setState(() => _workType = v),
        ),
        const SizedBox(height: TpSpace.md),
        TpDropdown<String>(
          label: copy('priority'),
          value: _priority,
          hint: copy('notSet'),
          items: <TpDropdownItem<String>>[
            for (final String p in kIntakePriorities)
              TpDropdownItem<String>(value: p, label: copy.priority(p)),
          ],
          onChanged: (String? v) => setState(() => _priority = v),
        ),
        const SizedBox(height: TpSpace.lg),
        TpButton.primary(
          key: WorkshopIntakeKeys.send,
          label: copy('send'),
          icon: Icons.send,
          isBusy: _busy,
          isFullWidth: true,
          onPressed: _busy ? null : () => unawaited(_send(country)),
        ),
      ],
    );
  }
}

AppError _asAppError(Object error, String fallback) {
  if (error is AppError) return error;
  if (error is SupabaseFailure) return error.error;
  return AppError(
    kind: AppErrorKind.unknown,
    message: fallback,
    technical: error.toString(),
    cause: error,
    isRetryable: true,
  );
}
