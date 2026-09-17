/// M6 Fleet validation, matched to the owner's mock screen.
///
/// Every figure on this screen is either read from the case snapshot the
/// parent already holds or from `accident_fleet_validation_items`,
/// `accident_evidence` and `accident_sla_instances`. A checklist row that has
/// no stored row is shown as PENDING with what the record can honestly say
/// about it (photo count, missing authority documents, the assessment
/// workstream's own status); it is never shown as ticked.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_docs_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_fleet_validation_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';

const String _workstreamKey = 'fleet_validation';

/// Which workspace a checklist row's chevron opens. Keys are `caseFlow`
/// keys the parent's `onNavigate` understands.
const Map<String, String> fleetValidationRelatedWorkspace = <String, String>{
  'asset_driver_confirmed': 'damage_map',
  'incident_facts_confirmed': 'damage_map',
  'damage_map_reviewed': 'damage_map',
  'required_photographs': 'damage_map',
  'police_najm_documents': 'liability',
  'workshop_assessment_requested': 'assessment',
};

class AccidentFleetValidationMockWorkspace extends ConsumerStatefulWidget {
  const AccidentFleetValidationMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    this.onOpenIncident,
    this.now,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  /// Opens the incident record. When null the widget pushes the existing
  /// accident detail route itself.
  final VoidCallback? onOpenIncident;

  /// Injected clock for deterministic tests.
  final DateTime? now;

  @override
  ConsumerState<AccidentFleetValidationMockWorkspace> createState() =>
      _AccidentFleetValidationMockWorkspaceState();
}

class _AccidentFleetValidationMockWorkspaceState
    extends ConsumerState<AccidentFleetValidationMockWorkspace> {
  bool _loading = true;
  AppError? _error;
  bool _provisioned = false;
  AccidentEvidenceLoad _docs = const AccidentEvidenceLoad(provisioned: false);
  final Map<String, AccidentFleetValidationItem> _stored =
      <String, AccidentFleetValidationItem>{};
  final Set<String> _busy = <String>{};
  String? _noteKey;
  final TextEditingController _noteController = TextEditingController();
  bool _sendWhenComplete = false;
  bool _completing = false;
  bool _savingAll = false;
  bool _notifying = false;

  AccidentRecord get _record => widget.snapshot.accident;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AccidentFleetValidationLoad items = await ref
          .read(accidentFleetValidationRepositoryProvider)
          .list(_record.id);
      final AccidentEvidenceLoad docs = await ref
          .read(accidentCaseDocsRepositoryProvider)
          .listEvidence(_record.id);
      if (!mounted) return;
      setState(() {
        _provisioned = items.provisioned;
        _stored
          ..clear()
          ..addEntries(
            items.items.map(
              (AccidentFleetValidationItem item) =>
                  MapEntry<String, AccidentFleetValidationItem>(
                item.itemKey,
                item,
              ),
            ),
          );
        _docs = docs;
        _loading = false;
      });
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _error = accidentAppError(error, AccidentCopy.of(context));
        _loading = false;
      });
    }
  }

  // --- Derivations -------------------------------------------------------

  int get _damageMarkCount {
    final String raw = _record.damageDescription?.trim() ?? '';
    if (raw.isEmpty) return 0;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<Object?, Object?>) return 0;
      return AccidentDamageMap.fromJson(<String, Object?>{
        for (final MapEntry<Object?, Object?> entry in decoded.entries)
          if (entry.key is String) entry.key! as String: entry.value,
      }).count;
    } on FormatException {
      return 0;
    }
  }

  bool get _policeMissing =>
      (_record.policeReportNo?.trim().isEmpty ?? true) &&
      !_docs.has('police_accident_report');

  bool get _najmMissing {
    final String status = _record.najmStatus?.trim().toLowerCase() ?? '';
    const Set<String> present = <String>{'received', 'available', 'done'};
    return !present.contains(status) && !_docs.has('najm_report');
  }

  int get _missingAuthorityDocs =>
      (_policeMissing ? 1 : 0) + (_najmMissing ? 1 : 0);

  AccidentWorkstreamChip get _assessmentChip =>
      accidentWorkstreamRow(widget.snapshot.workstreams, 'assessment')?.chip ??
      AccidentWorkstreamChip.pending;

  /// The stored row when there is one, else what the record can say.
  AccidentFleetValidationItem _effective(String key) {
    final AccidentFleetValidationItem? stored = _stored[key];
    if (stored != null) return stored;
    return switch (key) {
      'required_photographs' => AccidentFleetValidationItem(
          itemKey: key,
          countDone: _record.photos.length,
        ),
      'police_najm_documents' => AccidentFleetValidationItem(
          itemKey: key,
          state: _missingAuthorityDocs > 0 ? 'attention' : 'pending',
          countDone: 2 - _missingAuthorityDocs,
          countRequired: 2,
        ),
      'workshop_assessment_requested' => AccidentFleetValidationItem(
          itemKey: key,
          state: _assessmentChip == AccidentWorkstreamChip.done
              ? 'done'
              : _assessmentChip == AccidentWorkstreamChip.notRequired
                  ? 'not_applicable'
                  : 'pending',
        ),
      _ => AccidentFleetValidationItem(itemKey: key),
    };
  }

  bool get _allSatisfied => fleetValidationItems
      .every((VocabItem item) => _effective(item.key).isSatisfied);

  String _countText(AccidentMockCopy copy, AccidentFleetValidationItem item) {
    final int? done = item.countDone;
    final int? required = item.countRequired;
    switch (item.itemKey) {
      case 'required_photographs':
        if (done != null && required != null) {
          return copy.fill('countOf', <String, String>{
            'a': '$done',
            'b': '$required',
          });
        }
        return copy.fill('photosOnRecord', <String, String>{
          'n': '${done ?? _record.photos.length}',
        });
      case 'police_najm_documents':
        final int missing = done != null && required != null
            ? required - done
            : _missingAuthorityDocs;
        return missing > 0
            ? copy.fill('missingCount', <String, String>{'n': '$missing'})
            : copy('complete');
      default:
        return _stateLabel(copy, item.state);
    }
  }

  static String _stateLabel(AccidentMockCopy copy, String state) =>
      switch (state) {
        'done' => copy('stateDone'),
        'attention' => copy('stateAttention'),
        'not_applicable' => copy('stateNotApplicable'),
        _ => copy('statePending'),
      };

  static TpStatus _stateTone(String state) => switch (state) {
        'done' => TpStatus.ok,
        'attention' => TpStatus.warning,
        'not_applicable' => TpStatus.neutral,
        _ => TpStatus.unknown,
      };

  static IconData _stateIcon(String state) => switch (state) {
        'done' => Icons.check_circle_rounded,
        'attention' => Icons.error_outline_rounded,
        'not_applicable' => Icons.remove_circle_outline_rounded,
        _ => Icons.radio_button_unchecked_rounded,
      };

  String get _insuranceOwner => accidentWorkstreamOwner(
        AccidentMockCopy.of(context),
        widget.snapshot.workstreams,
        'insurance',
      );

  String get _monitoringOwner => accidentWorkstreamOwner(
        AccidentMockCopy.of(context),
        widget.snapshot.workstreams,
        'timeline',
      );

  WorkspaceContext? get _workspace => ref.read(workspaceContextProvider);

  // --- Actions -----------------------------------------------------------

  void _toast(String message) {
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(message)));
  }

  void _toastError(Object error) {
    _toast(accidentAppError(error, AccidentCopy.of(context)).message);
  }

  Future<void> _persist(AccidentFleetValidationItem item) async {
    final AccidentFleetValidationItem saved =
        await ref.read(accidentFleetValidationRepositoryProvider).save(
              accidentId: _record.id,
              item: item,
              country: _workspace?.activeCountry,
              site: _record.site,
            );
    if (!mounted) return;
    setState(() => _stored[saved.itemKey] = saved);
  }

  Future<void> _toggle(String key) async {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    if (!_provisioned) {
      _toast(copy('checklistNotProvisioned'));
      return;
    }
    if (_busy.contains(key)) return;
    final AccidentFleetValidationItem current = _effective(key);
    final AccidentFleetValidationItem next = current.copyWith(
      state: current.isSatisfied ? 'pending' : 'done',
      checkedByName: _workspace?.fullName,
      checkedAt: widget.now ?? DateTime.now(),
    );
    final AccidentFleetValidationItem? before = _stored[key];
    setState(() {
      _busy.add(key);
      _stored[key] = next;
    });
    try {
      await _persist(next);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        if (before == null) {
          _stored.remove(key);
        } else {
          _stored[key] = before;
        }
      });
      _toastError(error);
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  void _openNote(String key) {
    setState(() {
      _noteKey = key;
      _noteController.text = _effective(key).note ?? '';
    });
  }

  Future<void> _saveNote() async {
    final String? key = _noteKey;
    if (key == null) return;
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    if (!_provisioned) {
      _toast(copy('checklistNotProvisioned'));
      return;
    }
    final String note = _noteController.text.trim();
    final AccidentFleetValidationItem next = _effective(key).copyWith(
      note: note,
      checkedByName: _workspace?.fullName,
    );
    setState(() => _busy.add(key));
    try {
      await _persist(next);
      if (mounted) setState(() => _noteKey = null);
    } on Object catch (error) {
      if (!mounted) return;
      _toastError(error);
    } finally {
      if (mounted) setState(() => _busy.remove(key));
    }
  }

  Future<void> _saveProgress() async {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    if (!_provisioned) {
      _toast(copy('checklistNotProvisioned'));
      return;
    }
    setState(() => _savingAll = true);
    try {
      for (final VocabItem item in fleetValidationItems) {
        await _persist(_effective(item.key));
      }
      if (!mounted) return;
      _toast(copy('progressSaved'));
    } on Object catch (error) {
      if (!mounted) return;
      _toastError(error);
    } finally {
      if (mounted) setState(() => _savingAll = false);
    }
  }

  Future<void> _logCommunication({
    required String subject,
    required String body,
  }) async {
    await ref.read(accidentCaseDocsRepositoryProvider).logCommunication(
          accidentId: _record.id,
          workstreamKey: _workstreamKey,
          subject: subject,
          body: body,
          toParty: _insuranceOwner,
          authorName: _workspace?.fullName,
          country: _workspace?.activeCountry,
          site: _record.site,
        );
  }

  Future<void> _notify({required bool requestMissing}) async {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    setState(() => _notifying = true);
    try {
      final List<String> missing = <String>[
        if (_policeMissing) responsibilityDocs[0].label,
        if (_najmMissing) responsibilityDocs[1].label,
      ];
      await _logCommunication(
        subject: copy(requestMissing ? 'requestSubject' : 'sendSubject'),
        body: requestMissing
            ? missing.join(', ')
            : '${copy('packageList')}. ${copy('priority')}: '
                '${accidentSeverityBadge(copy, _record.severity)}',
      );
      if (!mounted) return;
      _toast(copy('loggedOnTimeline'));
    } on Object catch (error) {
      if (!mounted) return;
      _toastError(error);
    } finally {
      if (mounted) setState(() => _notifying = false);
    }
  }

  Future<void> _complete() async {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    setState(() => _completing = true);
    try {
      await ref.read(accidentWorkstreamRepositoryProvider).update(
            accidentId: _record.id,
            workstreamKey: _workstreamKey,
            status: 'completed',
          );
      await _logCommunication(
        subject: copy('completeSubject'),
        body: copy('packageList'),
      );
      if (!mounted) return;
      _toast(copy('validationCompleted'));
    } on Object catch (error) {
      if (!mounted) return;
      _toastError(error);
    } finally {
      if (mounted) setState(() => _completing = false);
    }
  }

  void _openIncident() {
    final VoidCallback? handler = widget.onOpenIncident;
    if (handler != null) {
      handler();
      return;
    }
    context.push(
      AccidentDetailRoute(accidentId: AccidentId(_record.id)).location,
    );
  }

  // --- Build -------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool closed = accidentIsClosed(_record);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.xs,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            TpStatusChip(
              key: const Key('accident.fleet.severity'),
              status: accidentTone(_record.severity),
              label: accidentSeverityBadge(copy, _record.severity),
              isCompact: true,
            ),
            TpStatusChip(
              key: const Key('accident.fleet.openState'),
              status: closed ? TpStatus.neutral : TpStatus.info,
              label: copy(closed ? 'closed' : 'open'),
              isCompact: true,
            ),
          ],
        ),
        const SizedBox(height: TpSpace.sm),
        AccidentWorkstreamHeader(
          snapshot: widget.snapshot,
          workstreamKey: _workstreamKey,
          now: widget.now,
        ),
        const SizedBox(height: TpSpace.md),
        _summaryCard(copy),
        const SizedBox(height: TpSpace.md),
        _checklistCard(copy, palette),
        const SizedBox(height: TpSpace.md),
        _notifyCard(copy, palette),
        const SizedBox(height: TpSpace.lg),
        Text(
          copy.fill('monitoringSla', <String, String>{
            'owner': _monitoringOwner,
          }),
          key: const Key('accident.fleet.monitoring'),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
        const SizedBox(height: TpSpace.sm),
        TpButton.primary(
          key: const Key('accident.fleet.complete'),
          label: copy.fill('completeAndNotify', <String, String>{
            'owner': _insuranceOwner,
          }),
          icon: Icons.task_alt_rounded,
          isFullWidth: true,
          isBusy: _completing,
          onPressed: !_loading && _allSatisfied && !_completing && !closed
              ? () => unawaited(_complete())
              : null,
        ),
        const SizedBox(height: TpSpace.sm),
        TpButton.secondary(
          key: const Key('accident.fleet.save'),
          label: copy('saveProgress'),
          icon: Icons.save_outlined,
          isFullWidth: true,
          isBusy: _savingAll,
          onPressed:
              _loading || _savingAll ? null : () => unawaited(_saveProgress()),
        ),
      ],
    );
  }

  Widget _summaryCard(AccidentMockCopy copy) {
    final String siteLocation = <String?>[_record.site, _record.location]
        .map((String? value) => value?.trim() ?? '')
        .where((String value) => value.isNotEmpty)
        .join(' · ');
    return AccidentSection(
      title: copy('incidentSummary'),
      icon: Icons.car_crash_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _line(
            Icons.category_outlined,
            copy('type'),
            humaniseAccidentToken(_record.accidentType),
            copy,
          ),
          _line(
            Icons.location_on_outlined,
            copy('location'),
            siteLocation,
            copy,
          ),
          _line(
            Icons.person_outline,
            copy('driver'),
            _record.driverName,
            copy,
          ),
          _line(
            Icons.photo_library_outlined,
            '',
            copy.fill('damageAndPhotos', <String, String>{
              'a': '$_damageMarkCount',
              'b': '${_record.photos.length}',
            }),
            copy,
          ),
          _line(
            Icons.health_and_safety_outlined,
            '',
            switch (_record.injuries) {
              true => copy('injuriesReported'),
              false => copy('noInjuries'),
              null => copy('injuriesNotSet'),
            },
            copy,
          ),
          _line(
            Icons.groups_outlined,
            '',
            switch (_record.thirdPartyInvolved) {
              true => copy('thirdPartyInvolved'),
              false => copy('noThirdParty'),
              null => copy('thirdPartyNotSet'),
            },
            copy,
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            key: const Key('accident.fleet.viewReport'),
            label: copy('viewReport'),
            icon: Icons.article_outlined,
            onPressed: _openIncident,
          ),
          Text(
            copy('viewReportNote'),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: TpPalette.of(context).textMuted,
                ),
          ),
        ],
      ),
    );
  }

  Widget _line(
    IconData icon,
    String label,
    String? value,
    AccidentMockCopy copy,
  ) {
    final String shown = value?.trim() ?? '';
    return Padding(
      padding: const EdgeInsetsDirectional.symmetric(vertical: TpSpace.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            icon,
            size: TpSizing.iconMd,
            color: TpPalette.of(context).primary,
          ),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            child: Text(
              label.isEmpty
                  ? (shown.isEmpty ? copy('notSet') : shown)
                  : '$label: ${shown.isEmpty ? copy('notSet') : shown}',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }

  Widget _checklistCard(AccidentMockCopy copy, TpPalette palette) {
    final AppError? error = _error;
    return AccidentSection(
      title: copy('checklist'),
      icon: Icons.fact_check_outlined,
      child: _loading
          ? Row(
              children: <Widget>[
                const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(child: Text(copy('loading'))),
              ],
            )
          : error != null
              ? TpErrorState(error: error, onRetry: _load)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    if (!_provisioned) ...<Widget>[
                      _notice(
                        copy('checklistNotProvisioned'),
                        TpStatus.unknown,
                        palette,
                        key: const Key('accident.fleet.notProvisioned'),
                      ),
                      const SizedBox(height: TpSpace.sm),
                    ],
                    for (int i = 0; i < fleetValidationItems.length; i++)
                      ...<Widget>[
                        if (i > 0) Divider(height: 1, color: palette.border),
                        _itemRow(copy, palette, fleetValidationItems[i]),
                      ],
                  ],
                ),
    );
  }

  Widget _itemRow(AccidentMockCopy copy, TpPalette palette, VocabItem vocab) {
    final AccidentFleetValidationItem item = _effective(vocab.key);
    final TpStatusColors colors = palette.forStatus(_stateTone(item.state));
    final bool busy = _busy.contains(vocab.key);
    final String subtitle = <String>[
      _countText(copy, item),
      if (item.checkedAt != null) accidentClock(context, item.checkedAt!),
      if (item.checkedByName?.trim().isNotEmpty ?? false)
        item.checkedByName!.trim(),
    ].join(' · ');
    final bool hasNote = item.note?.trim().isNotEmpty ?? false;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        InkWell(
          key: Key('accident.fleet.item.${vocab.key}'),
          onTap: busy ? null : () => unawaited(_toggle(vocab.key)),
          child: Padding(
            padding: const EdgeInsetsDirectional.symmetric(
              vertical: TpSpace.sm,
            ),
            child: Row(
              children: <Widget>[
                busy
                    ? const SizedBox.square(
                        dimension: TpSizing.iconLg,
                        child: Padding(
                          padding: EdgeInsets.all(2),
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : Icon(
                        _stateIcon(item.state),
                        color: colors.base,
                        size: TpSizing.iconLg,
                        semanticLabel: _stateLabel(copy, item.state),
                      ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        vocab.label,
                        style:
                            Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                      ),
                      Text(
                        subtitle,
                        key: Key('accident.fleet.count.${vocab.key}'),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: palette.textSecondary,
                            ),
                      ),
                      if (hasNote)
                        Text(
                          item.note!.trim(),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
                IconButton(
                  key: Key('accident.fleet.note.${vocab.key}'),
                  tooltip: copy(hasNote ? 'editNote' : 'addNote'),
                  onPressed: () => _openNote(vocab.key),
                  icon: Icon(
                    hasNote
                        ? Icons.sticky_note_2
                        : Icons.sticky_note_2_outlined,
                    size: TpSizing.iconMd,
                  ),
                ),
                IconButton(
                  key: Key('accident.fleet.open.${vocab.key}'),
                  tooltip: copy('openRelated'),
                  onPressed: () => widget.onNavigate(
                    fleetValidationRelatedWorkspace[vocab.key] ?? 'damage_map',
                  ),
                  icon: const Icon(Icons.chevron_right_rounded),
                ),
              ],
            ),
          ),
        ),
        if (_noteKey == vocab.key)
          Padding(
            padding: const EdgeInsetsDirectional.only(
              start: TpSpace.xxxl,
              bottom: TpSpace.sm,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TpInput(
                  key: Key('accident.fleet.noteField.${vocab.key}'),
                  label: copy('note'),
                  controller: _noteController,
                  maxLines: 3,
                  maxLength: 500,
                ),
                const SizedBox(height: TpSpace.xs),
                Row(
                  children: <Widget>[
                    TpButton.text(
                      label: copy('cancel'),
                      onPressed: () => setState(() => _noteKey = null),
                      isCompact: true,
                    ),
                    const SizedBox(width: TpSpace.sm),
                    TpButton.secondary(
                      key: Key('accident.fleet.saveNote.${vocab.key}'),
                      label: copy('saveNote'),
                      onPressed: busy ? null : () => unawaited(_saveNote()),
                      isCompact: true,
                    ),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _notifyCard(AccidentMockCopy copy, TpPalette palette) {
    final String? warning = _najmMissing
        ? copy('najmMissingWarning')
        : _policeMissing
            ? copy('policeMissingWarning')
            : null;
    return AccidentSection(
      title: copy('notifyTitle'),
      icon: Icons.forward_to_inbox_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AccidentInfoRow(copy('assignedRecipient'), _insuranceOwner),
          AccidentInfoRow(copy('packageIncludes'), copy('packageList')),
          AccidentInfoRow(
            copy('priority'),
            accidentSeverityBadge(copy, _record.severity),
          ),
          CheckboxListTile(
            key: const Key('accident.fleet.sendWhenComplete'),
            value: _sendWhenComplete,
            onChanged: (bool? value) =>
                setState(() => _sendWhenComplete = value ?? false),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(
              copy('sendWhenComplete'),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          if (warning != null) ...<Widget>[
            _notice(
              warning,
              TpStatus.warning,
              palette,
              key: const Key('accident.fleet.docWarning'),
            ),
            const SizedBox(height: TpSpace.sm),
          ],
          Wrap(
            spacing: TpSpace.sm,
            runSpacing: TpSpace.sm,
            children: <Widget>[
              TpButton.secondary(
                key: const Key('accident.fleet.requestDoc'),
                label: copy('requestMissingDocument'),
                icon: Icons.request_page_outlined,
                isCompact: true,
                onPressed: _notifying || _missingAuthorityDocs == 0
                    ? null
                    : () => unawaited(_notify(requestMissing: true)),
              ),
              TpButton.secondary(
                key: const Key('accident.fleet.sendNow'),
                label: copy('sendAvailableNow'),
                icon: Icons.send_outlined,
                isCompact: true,
                onPressed: _notifying
                    ? null
                    : () => unawaited(_notify(requestMissing: false)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _notice(
    String text,
    TpStatus tone,
    TpPalette palette, {
    Key? key,
  }) {
    final TpStatusColors colors = palette.forStatus(tone);
    return DecoratedBox(
      key: key,
      decoration: BoxDecoration(
        color: colors.soft,
        border: Border.all(color: colors.base),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: Padding(
        padding: const EdgeInsets.all(TpSpace.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.info_outline_rounded, color: colors.onSoft),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                text,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.onSoft,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
