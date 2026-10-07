/// Workshop Status: one vehicle, and the update form a field user saves.
///
/// Pushed with [Navigator] from the list (no route of its own), the same way
/// the checklist submission detail is opened. Pops `true` after a save so the
/// list re-reads.
///
/// Save goes ONLY through `workshop_status_update_record`, sending the changed
/// fields and the record's `updated_at` exactly as read. Who and when are never
/// sent - the server stamps both. A stale `updated_at` (PT409) is shown as
/// "updated by someone else" with a Reload that re-reads the record; the
/// unsaved edits are not silently overwritten.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/workshop_status/data/workshop_status_repository.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_record.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_vocab.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_copy.dart';
import 'package:tyre_pulse/features/workshop_status/workshop_status_providers.dart';

abstract final class WorkshopStatusDetailKeys {
  static const Key stage = ValueKey<String>('workshopStatus.detail.stage');
  static const Key delay = ValueKey<String>('workshopStatus.detail.delay');
  static const Key parts = ValueKey<String>('workshopStatus.detail.parts');
  static const Key save = ValueKey<String>('workshopStatus.detail.save');
  static const Key assignMe =
      ValueKey<String>('workshopStatus.detail.assignMe');
  static const Key readOnly =
      ValueKey<String>('workshopStatus.detail.readOnly');
  static Key field(String name) =>
      ValueKey<String>('workshopStatus.detail.field.$name');
  static Key date(String name) =>
      ValueKey<String>('workshopStatus.detail.date.$name');
}

const List<String> _textFields = <String>[
  WorkshopStatusFields.detailedReason,
  WorkshopStatusFields.workDone,
  WorkshopStatusFields.actionTaken,
  WorkshopStatusFields.nextAction,
  WorkshopStatusFields.mrNumber,
  WorkshopStatusFields.poNumber,
  WorkshopStatusFields.blocker,
  WorkshopStatusFields.remarks,
];

class WorkshopStatusDetailScreen extends ConsumerStatefulWidget {
  const WorkshopStatusDetailScreen({required this.record, super.key});

  final WorkshopStatusRecord record;

  @override
  ConsumerState<WorkshopStatusDetailScreen> createState() =>
      _WorkshopStatusDetailScreenState();
}

class _WorkshopStatusDetailScreenState
    extends ConsumerState<WorkshopStatusDetailScreen> {
  late WorkshopStatusRecord _record;
  late Map<String, String?> _form;
  final Map<String, TextEditingController> _controllers =
      <String, TextEditingController>{};
  Map<String, WorkshopFieldError> _errors = <String, WorkshopFieldError>{};
  bool _saving = false;
  bool _reloading = false;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    for (final String f in _textFields) {
      _controllers[f] = TextEditingController();
    }
    _reset(widget.record);
  }

  void _reset(WorkshopStatusRecord record) {
    _record = record;
    _form = workshopFormFromRecord(record);
    for (final String f in _textFields) {
      _controllers[f]!.text = _form[f] ?? '';
    }
    _errors = <String, WorkshopFieldError>{};
  }

  @override
  void dispose() {
    for (final TextEditingController c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, String?> get _currentForm => <String, String?>{
        ..._form,
        for (final String f in _textFields) f: _controllers[f]!.text,
      };

  bool get _dirty => workshopDiffPatch(_record, _currentForm).isNotEmpty;

  void _set(String field, String? value) {
    setState(() {
      _form[field] = value;
      _errors.remove(field);
      if (field == WorkshopStatusFields.delayReason) {
        _errors.remove(WorkshopStatusFields.detailedReason);
      }
    });
  }

  Future<void> _pickDate(String field) async {
    final DateTime now = ref.read(workshopStatusClockProvider)();
    final String? current = _form[field];
    final DateTime initial = current != null && workshopIsValidDate(current)
        ? DateTime(
            int.parse(current.substring(0, 4)),
            int.parse(current.substring(5, 7)),
            int.parse(current.substring(8, 10)),
          )
        : now;
    final DateTime? picked = await showDatePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100, 12, 31),
      initialDate: initial,
    );
    if (picked == null || !mounted) return;
    _set(field, workshopDateString(picked));
  }

  Future<void> _save(WorkshopStatusCopy copy) async {
    final Map<String, String?> form = _currentForm;
    final Map<String, WorkshopFieldError> errors = workshopValidateForm(form);
    if (errors.isNotEmpty) {
      setState(() => _errors = errors);
      return;
    }
    final Map<String, String?> patch = workshopDiffPatch(_record, form);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    if (patch.isEmpty) {
      messenger.showSnackBar(SnackBar(content: Text(copy('nothingChanged'))));
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(workshopStatusRepositoryProvider).update(
            recordId: _record.id,
            patch: patch,
            expectedUpdatedAt: _record.updatedAtRaw,
          );
      if (!mounted) return;
      _saved = true;
      messenger.showSnackBar(SnackBar(content: Text(copy('saved'))));
      Navigator.of(context).pop(true);
    } on WorkshopStatusStaleError {
      if (!mounted) return;
      setState(() => _saving = false);
      await _showStale(copy);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text(_errorMessage(error, copy('saveFailed')))),
      );
    }
  }

  Future<void> _showStale(WorkshopStatusCopy copy) async {
    final bool? reload = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(copy('staleTitle')),
        content: Text(copy('staleMessage')),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(copy('cancel')),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(copy('reload')),
          ),
        ],
      ),
    );
    if (reload == true && mounted) await _reload(copy);
  }

  Future<void> _reload(WorkshopStatusCopy copy) async {
    setState(() => _reloading = true);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      final WorkshopStatusRecord? fresh =
          await ref.read(workshopStatusRepositoryProvider).fetch(_record.id);
      if (!mounted) return;
      if (fresh == null) {
        messenger.showSnackBar(SnackBar(content: Text(copy('goneMessage'))));
        setState(() => _reloading = false);
        return;
      }
      setState(() {
        _reset(fresh);
        _reloading = false;
      });
      ref.invalidate(workshopStatusActiveProvider);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _reloading = false);
      messenger.showSnackBar(
        SnackBar(content: Text(_errorMessage(error, copy('loadFailed')))),
      );
    }
  }

  Future<bool> _confirmDiscard(WorkshopStatusCopy copy) async {
    final bool? discard = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(copy('discardTitle')),
        content: Text(copy('discardMessage')),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(copy('keepEditing')),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(copy('discard')),
          ),
        ],
      ),
    );
    return discard ?? false;
  }

  Future<void> _leave(WorkshopStatusCopy copy) async {
    final NavigatorState navigator = Navigator.of(context);
    if (_dirty && !_saved && !await _confirmDiscard(copy)) return;
    if (!mounted) return;
    navigator.pop(_saved);
  }

  @override
  Widget build(BuildContext context) {
    final WorkshopStatusCopy copy = WorkshopStatusCopy.of(context);
    final WorkshopStatusPermissions permissions =
        ref.watch(workshopStatusPermissionsProvider).value ??
            const WorkshopStatusPermissions();
    final bool canEdit = permissions.update && !_saving && !_reloading;
    final String userId = ref.watch(workshopStatusUserIdProvider);
    final DateTime now = ref.watch(workshopStatusClockProvider)();

    return PopScope(
      canPop: _saved || !_dirty,
      onPopInvokedWithResult: (bool didPop, Object? _) {
        if (!didPop) unawaited(_leave(copy));
      },
      child: TpScaffold(
        appBar: TpAppBar(
          title: _record.assetNo ?? copy('noAsset'),
          subtitle: _record.site,
          onBack: () => unawaited(_leave(copy)),
        ),
        body: ListView(
          padding: const EdgeInsets.all(TpSpace.lg),
          children: <Widget>[
            _Summary(record: _record, now: now, copy: copy),
            const SizedBox(height: TpSpace.lg),
            if (!permissions.update) ...<Widget>[
              TpCard(
                key: WorkshopStatusDetailKeys.readOnly,
                child: Text(copy('readOnly')),
              ),
              const SizedBox(height: TpSpace.lg),
            ],
            _responsibleRow(copy, permissions, userId, canEdit),
            const SizedBox(height: TpSpace.lg),
            _vocabDropdown(
              key: WorkshopStatusDetailKeys.stage,
              field: WorkshopStatusFields.currentStage,
              label: copy('stage'),
              options: kWorkshopSelectableStages,
              copy: copy,
              enabled: canEdit,
            ),
            const SizedBox(height: TpSpace.md),
            _vocabDropdown(
              key: WorkshopStatusDetailKeys.delay,
              field: WorkshopStatusFields.delayReason,
              label: copy('delayReason'),
              options: kWorkshopDelayReasons,
              copy: copy,
              enabled: canEdit,
            ),
            const SizedBox(height: TpSpace.md),
            _textField(
              WorkshopStatusFields.detailedReason,
              copy('detailedReason'),
              copy,
              canEdit,
              maxLines: 3,
              required: workshopNeedsDetailedReason(
                _form[WorkshopStatusFields.delayReason],
              ),
            ),
            const SizedBox(height: TpSpace.md),
            _vocabDropdown(
              key: WorkshopStatusDetailKeys.parts,
              field: WorkshopStatusFields.partsStatus,
              label: copy('partsStatus'),
              options: kWorkshopPartsStatuses,
              copy: copy,
              enabled: canEdit,
            ),
            const SizedBox(height: TpSpace.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: _textField(
                    WorkshopStatusFields.mrNumber,
                    copy('mrNumber'),
                    copy,
                    canEdit,
                  ),
                ),
                const SizedBox(width: TpSpace.md),
                Expanded(
                  child: _textField(
                    WorkshopStatusFields.poNumber,
                    copy('poNumber'),
                    copy,
                    canEdit,
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            _dateField(
              WorkshopStatusFields.expectedPartDate,
              copy('expectedPartDate'),
              copy,
              canEdit,
            ),
            const SizedBox(height: TpSpace.md),
            _dateField(
              WorkshopStatusFields.expectedReleaseDate,
              copy('expectedReleaseDate'),
              copy,
              canEdit,
            ),
            const SizedBox(height: TpSpace.md),
            _textField(
              WorkshopStatusFields.workDone,
              copy('workDone'),
              copy,
              canEdit,
              maxLines: 3,
            ),
            const SizedBox(height: TpSpace.md),
            _textField(
              WorkshopStatusFields.actionTaken,
              copy('actionTaken'),
              copy,
              canEdit,
              maxLines: 3,
            ),
            const SizedBox(height: TpSpace.md),
            _textField(
              WorkshopStatusFields.nextAction,
              copy('nextAction'),
              copy,
              canEdit,
              maxLines: 3,
            ),
            const SizedBox(height: TpSpace.md),
            _textField(
              WorkshopStatusFields.blocker,
              copy('blocker'),
              copy,
              canEdit,
              maxLines: 2,
            ),
            const SizedBox(height: TpSpace.md),
            _textField(
              WorkshopStatusFields.remarks,
              copy('remarks'),
              copy,
              canEdit,
              maxLines: 3,
            ),
            const SizedBox(height: TpSpace.xl),
            if (permissions.update)
              TpButton.primary(
                key: WorkshopStatusDetailKeys.save,
                label: copy('save'),
                icon: Icons.save_outlined,
                isBusy: _saving,
                isFullWidth: true,
                onPressed: canEdit ? () => unawaited(_save(copy)) : null,
              ),
            const SizedBox(height: TpSpace.xl),
          ],
        ),
      ),
    );
  }

  Widget _responsibleRow(
    WorkshopStatusCopy copy,
    WorkshopStatusPermissions permissions,
    String userId,
    bool canEdit,
  ) {
    final String? responsible = _form[WorkshopStatusFields.responsibleUserId];
    final bool isMine = userId.isNotEmpty &&
        (responsible ?? '').toLowerCase() == userId.toLowerCase();
    final String label = (responsible ?? '').isEmpty
        ? copy('unassigned')
        : (isMine ? copy('assignedToYou') : copy('assignedToSomeone'));
    return TpCard(
      padding: const EdgeInsets.all(TpSpace.md),
      child: Row(
        children: <Widget>[
          const Icon(Icons.person_outline),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  copy('responsible'),
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                Text(label),
              ],
            ),
          ),
          if (permissions.assign && !isMine && userId.isNotEmpty)
            TpButton.secondary(
              key: WorkshopStatusDetailKeys.assignMe,
              label: copy('assignToMe'),
              isCompact: true,
              onPressed: canEdit
                  ? () => _set(WorkshopStatusFields.responsibleUserId, userId)
                  : null,
            ),
        ],
      ),
    );
  }

  Widget _vocabDropdown({
    required Key key,
    required String field,
    required String label,
    required List<String> options,
    required WorkshopStatusCopy copy,
    required bool enabled,
  }) {
    final String? current = _form[field];
    // A stored value outside the pickable list (the released stage, or a
    // legacy value) cannot be a dropdown value: it is shown as the hint.
    final bool inList = current != null && options.contains(current);
    return TpDropdown<String>(
      key: key,
      label: label,
      value: inList ? current : null,
      hint: current == null ? copy('notSet') : copy.vocabLabel(current),
      errorText: _errorText(field, copy),
      enabled: enabled,
      items: <TpDropdownItem<String>>[
        for (final String option in options)
          TpDropdownItem<String>(value: option, label: copy.vocabLabel(option)),
      ],
      onChanged: enabled ? (String? v) => _set(field, v) : null,
    );
  }

  Widget _textField(
    String field,
    String label,
    WorkshopStatusCopy copy,
    bool enabled, {
    int maxLines = 1,
    bool required = false,
  }) {
    final bool isRef = WorkshopStatusFields.refs.contains(field);
    return TpInput(
      key: WorkshopStatusDetailKeys.field(field),
      label: label,
      controller: _controllers[field],
      enabled: enabled,
      isRequired: required,
      maxLines: maxLines,
      maxLength:
          isRef ? WorkshopStatusFields.maxRef : WorkshopStatusFields.maxText,
      errorText: _errorText(field, copy),
      onChanged: (String _) {
        if (_errors.containsKey(field)) {
          setState(() => _errors.remove(field));
        } else {
          setState(() {});
        }
      },
    );
  }

  Widget _dateField(
    String field,
    String label,
    WorkshopStatusCopy copy,
    bool enabled,
  ) {
    final String? value = _form[field];
    final String? error = _errorText(field, copy);
    final TpPalette palette = TpPalette.of(context);
    return TpCard(
      key: WorkshopStatusDetailKeys.date(field),
      onTap: enabled ? () => unawaited(_pickDate(field)) : null,
      padding: const EdgeInsets.all(TpSpace.md),
      borderColor:
          error == null ? null : palette.forStatus(TpStatus.critical).base,
      child: Row(
        children: <Widget>[
          const Icon(Icons.event_outlined),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(label, style: Theme.of(context).textTheme.labelMedium),
                Text(
                  value ?? copy('notSet'),
                  textDirection: value == null ? null : TextDirection.ltr,
                ),
                if (error != null)
                  Text(
                    error,
                    style: TextStyle(
                      color: palette.forStatus(TpStatus.critical).base,
                    ),
                  ),
              ],
            ),
          ),
          if (value != null && enabled)
            IconButton(
              tooltip: copy('clearDate'),
              icon: const Icon(Icons.close),
              onPressed: () => _set(field, null),
            ),
        ],
      ),
    );
  }

  String? _errorText(String field, WorkshopStatusCopy copy) {
    final WorkshopFieldError? e = _errors[field];
    if (e == null) return null;
    return copy('err_${e.name}');
  }
}

class _Summary extends StatelessWidget {
  const _Summary({required this.record, required this.now, required this.copy});

  final WorkshopStatusRecord record;
  final DateTime now;
  final WorkshopStatusCopy copy;

  @override
  Widget build(BuildContext context) {
    final TextTheme text = Theme.of(context).textTheme;
    final TpPalette palette = TpPalette.of(context);
    final int? days = record.daysDown(now);
    final WorkshopFreshness fresh = record.freshness(now);
    final String lastBy = record.lastUpdatedByName ?? copy('nobody');
    final String lastAt = record.lastManualUpdateAt == null
        ? ''
        : ' · ${_formatTimestamp(record.lastManualUpdateAt!)}';
    return TpCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (record.isReleased) ...<Widget>[
            TpStatusChip(status: TpStatus.ok, label: copy('released')),
            const SizedBox(height: TpSpace.sm),
          ],
          Text(copy('complaint'), style: text.labelMedium),
          Text(record.complaint ?? copy('notSet')),
          const SizedBox(height: TpSpace.sm),
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.xs,
            children: <Widget>[
              TpStatusChip(
                status: days == null ? TpStatus.unknown : TpStatus.neutral,
                label: days == null
                    ? copy('daysUnknown')
                    : '$days ${copy('daysDown')}',
                isCompact: true,
              ),
              if (fresh != WorkshopFreshness.today)
                TpStatusChip(
                  status: TpStatus.warning,
                  label: fresh == WorkshopFreshness.never
                      ? copy('neverUpdated')
                      : copy('notUpdatedToday'),
                  isCompact: true,
                ),
            ],
          ),
          const SizedBox(height: TpSpace.sm),
          Text(
            '${copy('lastUpdatedBy')}: $lastBy$lastAt',
            style: text.bodySmall?.copyWith(color: palette.textSecondary),
          ),
        ],
      ),
    );
  }
}

/// `2026-10-07T09:42:00Z` -> `2026-10-07 12:42` in device-local time.
String _formatTimestamp(String raw) {
  final DateTime? parsed = DateTime.tryParse(raw);
  if (parsed == null) return raw;
  final DateTime l = parsed.toLocal();
  return '${workshopDateString(l)} '
      '${l.hour.toString().padLeft(2, '0')}:'
      '${l.minute.toString().padLeft(2, '0')}';
}

String _errorMessage(Object error, String fallback) {
  if (error is SupabaseFailure) return error.error.message;
  if (error is AppError) return error.message;
  return fallback;
}
