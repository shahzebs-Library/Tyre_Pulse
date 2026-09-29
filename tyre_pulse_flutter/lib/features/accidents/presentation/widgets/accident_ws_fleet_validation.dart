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
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_docs_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_fleet_validation_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_sla_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_pdf.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_mock_kit.dart';

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
    this.showWorkstreamHeader = true,
    this.onOpenIncident,
    this.now,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  /// False when the case screen already shows the single workstream header
  /// above this workspace, so the step is never stated twice.
  final bool showWorkstreamHeader;

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

  /// "Send when required documents complete". While ticked, completing the
  /// workstream (and so notifying Insurance) waits for the Police / Najm
  /// documents; unticked, completion notifies with what is available and
  /// lists what is still missing.
  bool _sendWhenComplete = true;
  bool _completing = false;
  bool _savingAll = false;
  bool _notifying = false;
  bool _sharing = false;

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

  /// Server-side (English vocab) labels of the missing authority documents,
  /// as written into the case timeline note.
  List<String> get _missingDocLabels => <String>[
        if (_policeMissing) responsibilityDocs[0].label,
        if (_najmMissing) responsibilityDocs[1].label,
      ];

  /// Completion is allowed once every checklist row is satisfied and, while
  /// "Send when required documents complete" is ticked, the authority
  /// documents are on file.
  bool get _canComplete =>
      _allSatisfied && (!_sendWhenComplete || _missingAuthorityDocs == 0);

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
        'done' => Icons.check_circle_outline_rounded,
        'attention' => Icons.error_outline_rounded,
        'not_applicable' => Icons.remove_circle_outline_rounded,
        _ => Icons.schedule_rounded,
      };

  String get _insuranceOwner => accidentWorkstreamOwner(
        AccidentMockCopy.of(context),
        widget.snapshot.workstreams,
        'insurance',
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
      final List<String> missing = _missingDocLabels;
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
      final List<String> missing = _missingDocLabels;
      await _logCommunication(
        subject: copy('completeSubject'),
        body: missing.isEmpty
            ? copy('packageList')
            : '${copy('packageList')}. ${copy('missing')}: '
                '${missing.join(', ')}',
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

  Future<void> _shareSummary() async {
    if (_sharing) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() => _sharing = true);
    final AccidentCaseSummaryShareResult result =
        await shareAccidentCaseSummaryPdf(context, widget.snapshot);
    if (!mounted) return;
    setState(() => _sharing = false);
    switch (result) {
      case AccidentCaseSummaryShareResult.shared:
        break;
      case AccidentCaseSummaryShareResult.sharedInEnglish:
        _toast(l10n.accCaseSummarySharedInEnglish);
      case AccidentCaseSummaryShareResult.failed:
        _toast(l10n.accCaseSummaryShareFailed);
    }
  }

  // --- Build -------------------------------------------------------------

  String _itemLabel(AccidentMockCopy copy, VocabItem item) =>
      accidentVocabLabel(copy, 'fv', item.key, item.label);

  /// A running SLA clock on this workstream is what makes "monitoring" true;
  /// without one the note is not shown.
  bool _slaRunning(AccidentSlaLoad? load) {
    if (load == null || !load.provisioned) return false;
    final AccidentSlaInstance? clock = load.forWorkstream(_workstreamKey);
    return clock != null && clock.state == 'running';
  }

  @override
  Widget build(BuildContext context) {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final bool closed = accidentIsClosed(_record);
    final AccidentSlaLoad? sla =
        ref.watch(accidentSlaLoadProvider(_record.id)).value;
    final bool canComplete =
        !_loading && _canComplete && !_completing && !closed;
    final String completeHint =
        !_allSatisfied ? copy('completeLockedHint') : copy('completeDocsHint');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (widget.showWorkstreamHeader) ...<Widget>[
          Wrap(
            spacing: TpSpace.md,
            runSpacing: TpSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              AccidentMockDotStatus(
                key: const Key('accident.fleet.severity'),
                label: accidentSeverityBadge(copy, _record.severity),
                tone: accidentTone(_record.severity),
              ),
              AccidentMockDotStatus(
                key: const Key('accident.fleet.openState'),
                label: copy(closed ? 'closed' : 'open'),
                tone: closed ? TpStatus.neutral : TpStatus.warning,
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
        ],
        _summaryCard(copy, palette),
        const SizedBox(height: TpSpace.md),
        _checklistCard(copy, palette),
        const SizedBox(height: TpSpace.md),
        _notifyCard(copy, palette),
        if (_slaRunning(sla)) ...<Widget>[
          const SizedBox(height: TpSpace.md),
          _notice(
            copy('monitoringSlaTeam'),
            TpStatus.info,
            palette,
            icon: Icons.account_circle_outlined,
            key: const Key('accident.fleet.monitoring'),
          ),
        ],
        const SizedBox(height: TpSpace.lg),
        TpButton.primary(
          key: const Key('accident.fleet.complete'),
          label: copy.fill('completeAndNotify', <String, String>{
            'owner': _insuranceOwner,
          }),
          icon: canComplete ? Icons.task_alt_rounded : Icons.lock_outline,
          isFullWidth: true,
          isBusy: _completing,
          onPressed: canComplete ? () => unawaited(_complete()) : null,
        ),
        if (!canComplete && !_loading && !closed && !_completing) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          Text(
            completeHint,
            key: const Key('accident.fleet.completeHint'),
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: palette.textSecondary,
                ),
          ),
        ],
        const SizedBox(height: TpSpace.sm),
        TpButton.secondary(
          key: const Key('accident.fleet.save'),
          label: copy('saveProgress'),
          icon: Icons.bookmark_border_rounded,
          isFullWidth: true,
          isBusy: _savingAll,
          onPressed:
              _loading || _savingAll ? null : () => unawaited(_saveProgress()),
        ),
      ],
    );
  }

  Widget _summaryCard(AccidentMockCopy copy, TpPalette palette) {
    final String siteLocation = <String?>[_record.site, _record.location]
        .map((String? value) => value?.trim() ?? '')
        .where((String value) => value.isNotEmpty)
        .join(' · ');
    // The stored event type prints in the reader's language; an unknown
    // token keeps the humanised fallback.
    final Map<String, String> typeLabels =
        accidentTypeOptions(AppLocalizations.of(context));
    final String type = typeLabels[_record.accidentType?.trim() ?? ''] ??
        humaniseAccidentToken(_record.accidentType);
    final String driver = _record.driverName?.trim() ?? '';
    final List<_SummaryFact> facts = <_SummaryFact>[
      _SummaryFact(Icons.car_crash_outlined, copy('type'), type),
      _SummaryFact(Icons.location_on_outlined, copy('location'), siteLocation),
      _SummaryFact(
        Icons.person_outline,
        copy('driver'),
        driver.isEmpty ? '' : '${copy('driver')} $driver',
      ),
      _SummaryFact(
        Icons.photo_camera_outlined,
        '',
        copy.fill('damageAndPhotos', <String, String>{
          'a': '$_damageMarkCount',
          'b': '${_record.photos.length}',
        }),
      ),
      _SummaryFact(
        Icons.health_and_safety_outlined,
        '',
        switch (_record.injuries) {
          true => copy('injuriesReported'),
          false => copy('noInjuries'),
          null => copy('injuriesNotSet'),
        },
      ),
      _SummaryFact(
        Icons.groups_outlined,
        '',
        switch (_record.thirdPartyInvolved) {
          true => copy('thirdPartyInvolved'),
          false => copy('noThirdParty'),
          null => copy('thirdPartyNotSet'),
        },
      ),
    ];
    return AccidentSection(
      title: copy('incidentSummary'),
      icon: Icons.car_crash_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              final int columns = constraints.maxWidth >= 480 ? 2 : 1;
              final double width =
                  (constraints.maxWidth - (columns - 1) * TpSpace.lg) / columns;
              return Wrap(
                spacing: TpSpace.lg,
                children: <Widget>[
                  for (final _SummaryFact fact in facts)
                    SizedBox(width: width, child: _factLine(copy, fact)),
                ],
              );
            },
          ),
          Divider(height: TpSpace.xl, color: palette.border),
          InkWell(
            key: const Key('accident.fleet.viewReport'),
            onTap: _sharing ? null : _shareSummary,
            borderRadius: BorderRadius.circular(TpRadius.sm),
            child: ConstrainedBox(
              constraints:
                  const BoxConstraints(minHeight: TpSizing.minTouchTarget),
              child: Row(
                children: <Widget>[
                  Icon(
                    Icons.picture_as_pdf_outlined,
                    color: palette.critical.base,
                  ),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(
                    child: Text(
                      copy('viewReport'),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: palette.primary,
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                  ),
                  if (_sharing)
                    const SizedBox.square(
                      dimension: TpSizing.iconMd,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  else
                    const Icon(Icons.chevron_right_rounded),
                ],
              ),
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TpButton.text(
              key: const Key('accident.fleet.openIncident'),
              label: copy('openIncidentRecord'),
              icon: Icons.article_outlined,
              isCompact: true,
              onPressed: _openIncident,
            ),
          ),
        ],
      ),
    );
  }

  Widget _factLine(AccidentMockCopy copy, _SummaryFact fact) {
    final String shown =
        fact.value.trim().isEmpty ? copy('notSet') : fact.value;
    return Semantics(
      label: fact.label.isEmpty ? shown : '${fact.label}: $shown',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsetsDirectional.symmetric(vertical: TpSpace.xs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              fact.icon,
              size: TpSizing.iconMd,
              color: TpPalette.of(context).primary,
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              child: Text(
                shown,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          ],
        ),
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
              : LayoutBuilder(
                  builder: (BuildContext context, BoxConstraints box) {
                    final bool wide = box.maxWidth >= 440;
                    return Column(
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
                        for (int i = 0;
                            i < fleetValidationItems.length;
                            i++) ...<Widget>[
                          if (i > 0) Divider(height: 1, color: palette.border),
                          _itemRow(
                            copy,
                            palette,
                            fleetValidationItems[i],
                            wide: wide,
                          ),
                        ],
                      ],
                    );
                  },
                ),
    );
  }

  Widget _itemRow(
    AccidentMockCopy copy,
    TpPalette palette,
    VocabItem vocab, {
    required bool wide,
  }) {
    final AccidentFleetValidationItem item = _effective(vocab.key);
    final TpStatusColors colors = palette.forStatus(_stateTone(item.state));
    final bool busy = _busy.contains(vocab.key);
    final String label = _itemLabel(copy, vocab);
    final String count = _countText(copy, item);
    final String time =
        item.checkedAt == null ? '' : accidentClock(context, item.checkedAt!);
    final String checker = item.checkedByName?.trim() ?? '';
    final bool hasNote = item.note?.trim().isNotEmpty ?? false;
    final TextStyle? countStyle =
        Theme.of(context).textTheme.bodySmall?.copyWith(
              color: item.state == 'attention'
                  ? palette.warning.onSoft
                  : palette.textSecondary,
              fontWeight: item.state == 'attention' ? FontWeight.w700 : null,
            );
    final Widget statusIcon = busy
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
          );
    final Widget detail = Text(
      <String>[
        count,
        if (!wide && time.isNotEmpty) time,
        if (checker.isNotEmpty) checker,
      ].join(' · '),
      key: Key('accident.fleet.count.${vocab.key}'),
      style: countStyle,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Semantics(
                button: true,
                toggled: item.isSatisfied,
                label: '$label, ${_stateLabel(copy, item.state)}, $count',
                excludeSemantics: true,
                child: InkWell(
                  key: Key('accident.fleet.item.${vocab.key}'),
                  onTap: busy ? null : () => unawaited(_toggle(vocab.key)),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                      minHeight: TpSizing.minTouchTarget,
                    ),
                    child: Padding(
                      padding: const EdgeInsetsDirectional.symmetric(
                        vertical: TpSpace.xs,
                      ),
                      child: Row(
                        children: <Widget>[
                          statusIcon,
                          const SizedBox(width: TpSpace.sm),
                          Expanded(
                            flex: 5,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(
                                  label,
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodyMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                                if (!wide) detail,
                                if (hasNote)
                                  Text(
                                    item.note!.trim(),
                                    style:
                                        Theme.of(context).textTheme.bodySmall,
                                  ),
                              ],
                            ),
                          ),
                          if (wide) ...<Widget>[
                            const SizedBox(width: TpSpace.sm),
                            Expanded(flex: 3, child: detail),
                            SizedBox(
                              width: 52,
                              child: Text(
                                time,
                                textAlign: TextAlign.end,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            IconButton(
              key: Key('accident.fleet.note.${vocab.key}'),
              tooltip: copy(hasNote ? 'editNote' : 'addNote'),
              onPressed: () => _openNote(vocab.key),
              icon: Icon(
                hasNote
                    ? Icons.description_rounded
                    : Icons.description_outlined,
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
    final TpStatus priorityTone = accidentTone(_record.severity);
    return AccidentSection(
      title: copy('notifyTitle'),
      icon: Icons.forward_to_inbox_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _notifyRow(
            Icons.person_outline,
            copy('assignedRecipient'),
            Text(_insuranceOwner),
          ),
          _notifyRow(
            Icons.groups_outlined,
            copy('packageIncludes'),
            Text(copy('packageList')),
          ),
          _notifyRow(
            Icons.flag_outlined,
            copy('priority'),
            AccidentMockDotStatus(
              label: accidentSeverityLevel(copy, _record.severity),
              tone: priorityTone,
            ),
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
            AccidentMockNotice(
              key: const Key('accident.fleet.docWarning'),
              text: warning,
            ),
            const SizedBox(height: TpSpace.md),
          ],
          LayoutBuilder(
            builder: (BuildContext context, BoxConstraints box) {
              final Widget request = AccidentMockToneButton(
                key: const Key('accident.fleet.requestDoc'),
                label: copy('requestMissingDocument'),
                icon: Icons.note_add_outlined,
                isFullWidth: true,
                onPressed: _notifying || _missingAuthorityDocs == 0
                    ? null
                    : () => unawaited(_notify(requestMissing: true)),
              );
              final Widget send = AccidentMockToneButton(
                key: const Key('accident.fleet.sendNow'),
                label: copy('sendAvailableNow'),
                icon: Icons.send_outlined,
                tone: TpStatus.ok,
                isFullWidth: true,
                onPressed: _notifying
                    ? null
                    : () => unawaited(_notify(requestMissing: false)),
              );
              if (box.maxWidth < 360) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    request,
                    const SizedBox(height: TpSpace.sm),
                    send,
                  ],
                );
              }
              return Row(
                children: <Widget>[
                  Expanded(child: request),
                  const SizedBox(width: TpSpace.sm),
                  Expanded(child: send),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _notifyRow(IconData icon, String label, Widget value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
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
              flex: 4,
              child: Text(
                label,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            const SizedBox(width: TpSpace.sm),
            Expanded(
              flex: 5,
              child: DefaultTextStyle.merge(
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(fontWeight: FontWeight.w600),
                child: value,
              ),
            ),
          ],
        ),
      );

  Widget _notice(
    String text,
    TpStatus tone,
    TpPalette palette, {
    IconData icon = Icons.info_outline_rounded,
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
            Icon(icon, color: colors.onSoft),
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

@immutable
final class _SummaryFact {
  const _SummaryFact(this.icon, this.label, this.value);
  final IconData icon;
  final String label;
  final String value;
}
