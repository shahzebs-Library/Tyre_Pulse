/// The blind count screen.
///
/// What the counter sees: the audit's locations, the items they are asked to
/// look for at the active location, and their OWN counts. What they never see:
/// how many there should be. The screen only ever reads
/// `inv_audit_counter_view`; it has no code path to an expected quantity.
///
/// Every change is written to the encrypted, per-user draft store before the
/// UI moves on, so a closed app, a dead battery or a lost signal resumes
/// exactly where the counter stopped.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/inventory/data/count_submitter.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/inventory_providers.dart';
import 'package:tyre_pulse/features/inventory/presentation/count_line_sheet.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_copy.dart';
import 'package:tyre_pulse/features/inventory/presentation/inventory_widgets.dart';

class BlindCountScreen extends ConsumerStatefulWidget {
  const BlindCountScreen({required this.auditId, super.key});

  final String auditId;

  static Route<void> route(String auditId) => MaterialPageRoute<void>(
        builder: (_) => BlindCountScreen(auditId: auditId),
        settings: const RouteSettings(name: 'inventory/blind-count'),
      );

  @override
  ConsumerState<BlindCountScreen> createState() => _BlindCountScreenState();
}

class _BlindCountScreenState extends ConsumerState<BlindCountScreen> {
  CountSession? _session;
  Object? _draftError;
  bool _resumed = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    unawaited(_loadDraft());
  }

  Future<void> _loadDraft() async {
    final String? userId = ref.read(workspaceContextProvider)?.userId;
    if (userId == null) return;
    try {
      final CountSession? saved =
          await ref.read(countDraftStoreProvider).load(userId, widget.auditId);
      if (!mounted) return;
      setState(() {
        _resumed = saved != null && saved.lines.isNotEmpty;
        _session = saved ??
            CountSession(
              auditId: widget.auditId,
              userId: userId,
              startedAt: DateTime.now().toUtc(),
            );
      });
    } on Object catch (error) {
      // Refuse to start: a fresh empty session saved over an unreadable
      // slot would destroy the counts that are in it.
      if (mounted) setState(() => _draftError = error);
    }
  }

  Future<void> _commit(CountSession next) async {
    setState(() => _session = next);
    try {
      await ref.read(countDraftStoreProvider).save(next);
    } on Object {
      if (mounted) _snack(InventoryCopy.of(context)('draftSaveFailed'));
    }
  }

  void _snack(String text) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _onScan(String raw, AuditCounterView view) async {
    final CountSession? session = _session;
    if (session == null) return;
    final InventoryCopy copy = InventoryCopy.of(context);
    final ScanResult result = session.applyScan(
      raw: raw,
      view: view,
      newId: ref.read(inventoryIdFactoryProvider),
      now: DateTime.now(),
    );
    switch (result.outcome) {
      case ScanOutcome.ignoredRepeat:
      case ScanOutcome.empty:
        return;
      case ScanOutcome.locationOutOfScope:
      case ScanOutcome.duplicateSerial:
      case ScanOutcome.needsLocation:
        unawaited(HapticFeedback.heavyImpact());
        _snack(copy('scan_${result.outcome.name}'));
        if (result.session != session) await _commit(result.session);
        return;
      case ScanOutcome.locationSelected:
      case ScanOutcome.serialItemSelected:
        unawaited(HapticFeedback.mediumImpact());
        _snack(copy('scan_${result.outcome.name}'));
        await _commit(result.session);
        return;
      case ScanOutcome.lineAdded:
      case ScanOutcome.lineReopened:
        unawaited(HapticFeedback.mediumImpact());
        await _commit(result.session);
        final CountLine? line = result.line;
        // A serial line is complete on scan (qty 1); the counter keeps
        // scanning. A bulk line opens its editor for the quantity.
        if (line != null && line.serialNo == null && mounted) {
          await _edit(line, view);
        } else if (line != null) {
          _snack(copy('serialCounted'));
        }
    }
  }

  Future<void> _edit(CountLine line, AuditCounterView view) async {
    final CountSession? session = _session;
    if (session == null) return;
    final CountLineEdit? edit = await showCountLineSheet(
      context: context,
      line: line,
      view: view,
      auditId: widget.auditId,
    );
    if (edit == null || !mounted) return;
    final CountSession next = edit.remove
        ? session.removeLine(line.clientUuid)
        : session.updateLine(reopenRejected(edit.line));
    await _commit(next);
  }

  Future<void> _submit() async {
    final CountSession? session = _session;
    if (session == null || _submitting) return;
    final InventoryCopy copy = InventoryCopy.of(context);
    setState(() => _submitting = true);
    try {
      final String deviceId = await ref.read(inventoryDeviceIdProvider.future);
      final SubmitOutcome outcome = await ref
          .read(countSubmitterProvider)
          .submit(session, deviceId: deviceId);
      if (!mounted) return;
      setState(() => _session = outcome.session);
      _snack(
        switch (outcome.status) {
          SubmitStatus.done => copy.count('submitDone', outcome.accepted),
          SubmitStatus.nothingToSend => copy('submitNothing'),
          SubmitStatus.offline => copy('submitOffline'),
          SubmitStatus.notProvisioned => copy('notProvisionedBody'),
          SubmitStatus.partial => copy('submitPartial'),
          SubmitStatus.failed =>
            outcome.failure?.error.message ?? copy('submitFailed'),
        },
      );
      ref.invalidate(myInventoryAuditsProvider);
    } on Object {
      if (mounted) _snack(copy('submitFailed'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final InventoryCopy copy = InventoryCopy.of(context);
    final AsyncValue<AuditCounterView> view =
        ref.watch(auditCounterViewProvider(widget.auditId));
    final CountSession? session = _session;
    return TpScaffold(
      appBar: TpAppBar(
        title: copy('countTitle'),
        subtitle: switch (view) {
          AsyncData<AuditCounterView>(:final value) => value.audit.reference,
          _ => null,
        },
      ),
      body: _draftError != null
          ? InventoryFailureView(
              error: _draftError!,
              copy: copy,
              onRetry: () {
                setState(() => _draftError = null);
                unawaited(_loadDraft());
              },
            )
          : session == null
              ? const TpLoadingState()
              : view.when(
                  loading: () => const TpLoadingState(),
                  error: (Object error, StackTrace _) => _OfflineDraftView(
                    error: error,
                    session: session,
                    copy: copy,
                    submitting: _submitting,
                    onRetry: () => ref.invalidate(
                      auditCounterViewProvider(widget.auditId),
                    ),
                    onSubmit: () => unawaited(_submit()),
                  ),
                  data: (AuditCounterView v) {
                    final CountSession reconciled =
                        session.reconcileWithServer(v.submittedClientUuids);
                    if (!identical(reconciled, session)) {
                      scheduleMicrotask(() => unawaited(_commit(reconciled)));
                    }
                    return _content(copy, v, reconciled);
                  },
                ),
    );
  }

  Widget _content(
    InventoryCopy copy,
    AuditCounterView view,
    CountSession session,
  ) {
    final ThemeData theme = Theme.of(context);
    final CountProgress progress = CountProgress.of(session, view);
    final String? active = session.activeLocationId;
    final AuditLocation? activeLocation =
        active == null ? null : view.locationById(active);
    final bool canCount = view.audit.acceptsCounts;
    final List<AuditItemPrompt> prompts =
        active == null ? const <AuditItemPrompt>[] : view.promptsAt(active);
    final List<CountLine> lines = active == null
        ? const <CountLine>[]
        : session.linesAt(active).reversed.toList(growable: false);
    AuditItemPrompt? serialItem;
    for (final AuditItemPrompt p in prompts) {
      if (p.itemId == session.activeSerialItemId) serialItem = p;
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        TpSpace.lg,
        TpSpace.md,
        TpSpace.lg,
        TpSpace.xxxl,
      ),
      children: <Widget>[
        if (_resumed)
          Padding(
            padding: const EdgeInsets.only(bottom: TpSpace.sm),
            child: Text(
              copy.count('resumed', session.lines.length),
              key: const Key('inventory.count.resumed'),
              style: theme.textTheme.bodySmall,
            ),
          ),
        Text(
          progress.fraction == null
              ? copy('noLocations')
              : copy('progress')
                  .replaceAll('%a', '${progress.locationsCounted}')
                  .replaceAll('%b', '${progress.locationsTotal}'),
          key: const Key('inventory.count.progress'),
          style: theme.textTheme.titleSmall,
        ),
        if (progress.fraction != null) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          LinearProgressIndicator(value: progress.fraction),
        ],
        const SizedBox(height: TpSpace.xs),
        Text(
          '${copy.count('linesDone', progress.linesComplete)} · '
          '${copy.count('pendingN', progress.linesPending)} · '
          '${copy.count('unexpectedN', progress.unexpected)}',
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: TpSpace.md),
        if (!canCount)
          Text(copy('notCounting'), style: theme.textTheme.bodyMedium)
        else
          InventoryScanField(
            copy: copy,
            hint: active == null ? copy('scanLocation') : copy('scanItem'),
            onScan: (String raw) => unawaited(_onScan(raw, view)),
          ),
        const SizedBox(height: TpSpace.md),
        Text(copy('locations'), style: theme.textTheme.titleSmall),
        const SizedBox(height: TpSpace.xs),
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final AuditLocation l in view.locations)
              ChoiceChip(
                key: Key('inventory.location.${l.id}'),
                materialTapTargetSize: MaterialTapTargetSize.padded,
                label: Text(l.display),
                avatar: session.countedLocationIds.contains(l.id)
                    ? const Icon(Icons.check_rounded, size: 18)
                    : null,
                selected: l.id == active,
                onSelected: canCount
                    ? (_) => unawaited(_commit(session.selectLocation(l.id)))
                    : null,
              ),
          ],
        ),
        if (activeLocation != null) ...<Widget>[
          const SizedBox(height: TpSpace.lg),
          Text(
            '${copy('atLocation')}: ${activeLocation.display}',
            style: theme.textTheme.titleMedium,
          ),
          if (serialItem != null)
            Padding(
              padding: const EdgeInsets.only(top: TpSpace.xs),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '${copy('scanningSerialsOf')}: '
                      '${serialItem.description ?? serialItem.itemCode ?? ''}',
                    ),
                  ),
                  TextButton(
                    onPressed: () =>
                        unawaited(_commit(session.clearSerialItem())),
                    child: Text(copy('stopSerials')),
                  ),
                ],
              ),
            ),
          const SizedBox(height: TpSpace.sm),
          for (final AuditItemPrompt p in prompts)
            _PromptTile(
              prompt: p,
              copy: copy,
              counted: session
                  .linesAt(p.locationId)
                  .where((CountLine l) => l.itemId == p.itemId)
                  .length,
              onTap: canCount
                  ? () {
                      final ScanResult r = session.pickPrompt(
                        prompt: p,
                        newId: ref.read(inventoryIdFactoryProvider),
                        now: DateTime.now(),
                      );
                      unawaited(() async {
                        await _commit(r.session);
                        if (r.line != null && mounted) {
                          await _edit(r.line!, view);
                        }
                      }());
                    }
                  : null,
            ),
          const SizedBox(height: TpSpace.md),
          Text(copy('myLines'), style: theme.textTheme.titleSmall),
          if (lines.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
              child: Text(copy('noLinesHere')),
            ),
          for (final CountLine line in lines)
            _LineTile(
              line: line,
              copy: copy,
              onTap: line.state == CountLineState.submitted
                  ? null
                  : () => unawaited(_edit(line, view)),
            ),
        ],
        const SizedBox(height: TpSpace.lg),
        SizedBox(
          height: inventoryTouchTarget,
          child: FilledButton.icon(
            key: const Key('inventory.count.submit'),
            onPressed: _submitting || session.submittable.isEmpty
                ? null
                : () => unawaited(_submit()),
            icon: _submitting
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.cloud_upload_outlined),
            label: Text(
              copy.count('submitN', session.submittable.length),
            ),
          ),
        ),
      ],
    );
  }
}

/// The counter view could not load (offline, not provisioned, error). Any
/// counts already on the phone are still shown and can still be sent.
class _OfflineDraftView extends StatelessWidget {
  const _OfflineDraftView({
    required this.error,
    required this.session,
    required this.copy,
    required this.submitting,
    required this.onRetry,
    required this.onSubmit,
  });

  final Object error;
  final CountSession session;
  final InventoryCopy copy;
  final bool submitting;
  final VoidCallback onRetry;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    if (session.pending.isEmpty) {
      return InventoryFailureView(error: error, copy: copy, onRetry: onRetry);
    }
    return ListView(
      padding: const EdgeInsets.all(TpSpace.lg),
      children: <Widget>[
        SizedBox(
          height: 260,
          child: InventoryFailureView(
            error: error,
            copy: copy,
            onRetry: onRetry,
          ),
        ),
        Text(copy.count('unsyncedLines', session.pending.length)),
        const SizedBox(height: TpSpace.md),
        SizedBox(
          height: inventoryTouchTarget,
          child: FilledButton(
            onPressed:
                submitting || session.submittable.isEmpty ? null : onSubmit,
            child: Text(copy.count('submitN', session.submittable.length)),
          ),
        ),
      ],
    );
  }
}

class _PromptTile extends StatelessWidget {
  const _PromptTile({
    required this.prompt,
    required this.copy,
    required this.counted,
    required this.onTap,
  });

  final AuditItemPrompt prompt;
  final InventoryCopy copy;
  final int counted;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      key: Key('inventory.prompt.${prompt.locationId}.${prompt.itemId}'),
      minTileHeight: inventoryTouchTarget,
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        counted > 0 ? Icons.check_circle_rounded : Icons.radio_button_off,
      ),
      title: Text(prompt.description ?? prompt.itemCode ?? prompt.itemId),
      subtitle: Text(
        <String>[
          if (prompt.itemCode != null) prompt.itemCode!,
          if (prompt.serialTracked) copy('serialTracked'),
          if (counted > 0) copy.count('linesN', counted),
        ].join(' · '),
      ),
      onTap: onTap,
    );
  }
}

class _LineTile extends StatelessWidget {
  const _LineTile({required this.line, required this.copy, this.onTap});

  final CountLine line;
  final InventoryCopy copy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String qty = line.confirmedZero
        ? copy('confirmedZero')
        : line.countedQty == null
            ? copy('notCountedYet')
            : '${line.countedQty}';
    return ListTile(
      key: Key('inventory.line.${line.clientUuid}'),
      minTileHeight: inventoryTouchTarget,
      contentPadding: EdgeInsets.zero,
      title: Text(line.serialNo ?? line.scannedCode),
      subtitle: Text(
        <String>[
          qty,
          copy('condition_${line.condition.wire}'),
          if (line.unexpected) copy('unexpected'),
          if (line.photoPaths.isNotEmpty || line.photoRefs.isNotEmpty)
            copy.count(
              'photosN',
              line.photoPaths.length + line.photoRefs.length,
            ),
          if (line.rejectReason != null) line.rejectReason!,
        ].join(' · '),
      ),
      trailing: Text(
        copy('state_${line.state.name}'),
        style: theme.textTheme.labelSmall?.copyWith(
          color: line.state == CountLineState.rejected
              ? theme.colorScheme.error
              : null,
        ),
      ),
      onTap: onTap,
    );
  }
}
