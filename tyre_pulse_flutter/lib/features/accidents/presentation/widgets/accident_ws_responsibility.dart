/// M3 Responsibility and payment, matched to the owner's mock screen.
///
/// Reads and writes `accident_liability_assessments` (base columns live,
/// extended columns behind the authored migration), the three
/// `accident_authority_reports` rows and the `accident_evidence` documents.
/// Unsaved edits are kept in an encrypted device draft, and "Draft saved on
/// device" is shown only while such a draft exists.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_docs_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_liability_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/data/accident_responsibility_draft_store.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

const String _workstreamKey = 'liability';

class AccidentResponsibilityMockWorkspace extends ConsumerStatefulWidget {
  const AccidentResponsibilityMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    this.now,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  /// Injected clock for deterministic tests.
  final DateTime? now;

  @override
  ConsumerState<AccidentResponsibilityMockWorkspace> createState() =>
      _AccidentResponsibilityMockWorkspaceState();
}

class _AccidentResponsibilityMockWorkspaceState
    extends ConsumerState<AccidentResponsibilityMockWorkspace> {
  bool _loading = true;
  AppError? _error;
  bool _extended = false;
  AccidentLiabilityAssessment _assessment = const AccidentLiabilityAssessment();
  final Map<String, AccidentAuthorityReport> _authority =
      <String, AccidentAuthorityReport>{};
  AccidentEvidenceLoad _docs = const AccidentEvidenceLoad(provisioned: false);
  bool _draftExists = false;
  String? _editingRow;
  final TextEditingController _rowController = TextEditingController();
  final TextEditingController _companyController = TextEditingController();
  final TextEditingController _ourPctController = TextEditingController();
  final TextEditingController _otherPctController = TextEditingController();
  bool _saving = false;
  bool _requesting = false;
  String? _uploadingKey;

  AccidentRecord get _record => widget.snapshot.accident;
  WorkspaceContext? get _workspace => ref.read(workspaceContextProvider);
  DateTime get _now => widget.now ?? DateTime.now();

  String get _draftScope => AccidentResponsibilityDraftStore.scopeKey(
        userId: _workspace?.userId ?? '',
        accidentId: _record.id,
      );

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _rowController.dispose();
    _companyController.dispose();
    _ourPctController.dispose();
    _otherPctController.dispose();
    super.dispose();
  }

  // --- Loading -----------------------------------------------------------

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AccidentLiabilityLoad load =
          await ref.read(accidentLiabilityRepositoryProvider).load(_record.id);
      final AccidentEvidenceLoad docs = await ref
          .read(accidentCaseDocsRepositoryProvider)
          .listEvidence(_record.id);
      final AccidentResponsibilityDraft? draft = await ref
          .read(accidentResponsibilityDraftStoreProvider)
          .load(_draftScope);
      if (!mounted) return;
      setState(() {
        _extended = load.extendedProvisioned;
        _assessment = load.assessment ?? const AccidentLiabilityAssessment();
        _authority
          ..clear()
          ..addEntries(
            load.authorityReports.map(
              (AccidentAuthorityReport row) =>
                  MapEntry<String, AccidentAuthorityReport>(
                row.authorityType,
                row,
              ),
            ),
          );
        _docs = docs;
        _draftExists = draft != null;
        if (draft != null) _applyDraft(draft);
        _companyController.text = _assessment.responsibleCompany ?? '';
        _ourPctController.text = _pctInput(_assessment.ourLiabilityPct);
        _otherPctController.text = _pctInput(_assessment.thirdPartyPct);
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

  void _applyDraft(AccidentResponsibilityDraft draft) {
    _assessment = _assessment.copyWith(
      liabilityType: draft.liabilityType ?? _assessment.liabilityType,
      ourLiabilityPct: draft.ourPct ?? _assessment.ourLiabilityPct,
      thirdPartyPct: draft.otherPct ?? _assessment.thirdPartyPct,
      payer: draft.payer ?? _assessment.payer,
      responsibleCompany:
          draft.responsibleCompany ?? _assessment.responsibleCompany,
      recoveryRequired: draft.recoveryRequired ?? _assessment.recoveryRequired,
      thirdPartyPlate: draft.thirdPartyPlate ?? _assessment.thirdPartyPlate,
      thirdPartyDriver: draft.thirdPartyDriver ?? _assessment.thirdPartyDriver,
      thirdPartyPhone: draft.thirdPartyPhone ?? _assessment.thirdPartyPhone,
      taqdeerRequired: draft.taqdeerRequired ?? _assessment.taqdeerRequired,
    );
    if (draft.policeReportNo != null) {
      _setAuthority('police', reportNo: draft.policeReportNo);
    }
    if (draft.najmStatus != null) {
      _setAuthority('najm', reportStatus: draft.najmStatus);
    }
    if (draft.taqdeerNo != null) {
      _setAuthority('taqdeer', reportNo: draft.taqdeerNo);
    }
  }

  static String _pctInput(num? value) {
    if (value == null || !value.isFinite) return '';
    return value == value.roundToDouble() ? '${value.round()}' : '$value';
  }

  // --- Local edits + draft -------------------------------------------------

  void _setAuthority(String type, {String? reportNo, String? reportStatus}) {
    final AccidentAuthorityReport current =
        _authority[type] ?? AccidentAuthorityReport(authorityType: type);
    _authority[type] = AccidentAuthorityReport(
      id: current.id,
      authorityType: type,
      reportNo: reportNo ?? current.reportNo,
      reportStatus: reportStatus ?? current.reportStatus,
      reportDate: current.reportDate,
    );
  }

  void _markDirty() {
    setState(() => _draftExists = true);
    final AccidentResponsibilityDraft draft = AccidentResponsibilityDraft(
      liabilityType: _assessment.liabilityType,
      ourPct: _assessment.ourLiabilityPct,
      otherPct: _assessment.thirdPartyPct,
      payer: _assessment.payer,
      responsibleCompany: _assessment.responsibleCompany,
      recoveryRequired: _assessment.recoveryRequired,
      thirdPartyPlate: _assessment.thirdPartyPlate,
      thirdPartyDriver: _assessment.thirdPartyDriver,
      thirdPartyPhone: _assessment.thirdPartyPhone,
      taqdeerRequired: _assessment.taqdeerRequired,
      policeReportNo: _authority['police']?.reportNo,
      najmStatus: _authority['najm']?.reportStatus,
      taqdeerNo: _authority['taqdeer']?.reportNo,
      savedAt: _now,
    );
    unawaited(
      ref
          .read(accidentResponsibilityDraftStoreProvider)
          .save(_draftScope, draft)
          .catchError((Object _) {}),
    );
  }

  AccidentFieldAudit _audit(String key) =>
      _assessment.fieldAudit[key] ?? const AccidentFieldAudit();

  void _recordField(String key) {
    final Map<String, AccidentFieldAudit> next =
        Map<String, AccidentFieldAudit>.of(_assessment.fieldAudit);
    final AccidentFieldAudit existing = _audit(key);
    next[key] = existing.copyWith(
      recordedBy: _workspace?.fullName,
      recordedAt: _now,
      verification: existing.verification == 'missing'
          ? 'pending'
          : existing.verification,
    );
    _assessment = _assessment.copyWith(fieldAudit: next);
  }

  void _setVerification(String key, String state) {
    final Map<String, AccidentFieldAudit> next =
        Map<String, AccidentFieldAudit>.of(_assessment.fieldAudit);
    next[key] = _audit(key).copyWith(
      verification: state,
      verifiedBy: _workspace?.fullName,
      verifiedAt: _now,
    );
    _assessment = _assessment.copyWith(fieldAudit: next);
    _markDirty();
  }

  void _selectFault(FaultTile tile) {
    _assessment = _assessment.copyWith(
      liabilityType: tile.key,
      ourLiabilityPct: tile.ourPct,
      thirdPartyPct: tile.otherPct,
    );
    _ourPctController.text = _pctInput(tile.ourPct);
    _otherPctController.text = _pctInput(tile.otherPct);
    _markDirty();
  }

  void _selectPayer(String key) {
    _assessment = _assessment.copyWith(payer: key);
    _markDirty();
  }

  void _setPct({required bool ours, required String raw}) {
    final num? value = num.tryParse(raw.trim());
    final num? clamped = value?.clamp(0, 100);
    _assessment = ours
        ? _assessment.copyWith(ourLiabilityPct: clamped)
        : _assessment.copyWith(thirdPartyPct: clamped);
    _markDirty();
  }

  String? _rowValue(String key) => switch (key) {
        'third_party_plate' => _assessment.thirdPartyPlate,
        'third_party_driver' => _assessment.thirdPartyDriver,
        'third_party_phone' => _assessment.thirdPartyPhone,
        'police_report_no' =>
          _authority['police']?.reportNo ?? _record.policeReportNo,
        'najm_report' => _authority['najm']?.reportStatus ??
            _record.najmStatus?.trim().toLowerCase(),
        'taqdeer_required' => switch (_assessment.taqdeerRequired) {
            true => 'yes',
            false => 'no',
            null => null,
          },
        'taqdeer_no' => _authority['taqdeer']?.reportNo ?? _record.taqdeerNo,
        _ => null,
      };

  String _rowText(AccidentMockCopy copy, String key) {
    final String value = _rowValue(key)?.trim() ?? '';
    if (value.isEmpty) return copy('notSet');
    return switch (key) {
      'najm_report' => switch (value) {
          'available' || 'received' => copy('received'),
          'pending' => copy('pending'),
          'none' => copy('none'),
          _ => humaniseAccidentToken(value),
        },
      'taqdeer_required' => copy(value == 'yes' ? 'yes' : 'no'),
      _ => value,
    };
  }

  String _verificationOf(String key) {
    final String? stored = _audit(key).verification;
    if (stored != null && verificationStates.contains(stored)) return stored;
    return (_rowValue(key)?.trim().isEmpty ?? true) ? 'missing' : 'pending';
  }

  void _commitRow(String key, String raw) {
    final String value = raw.trim();
    final String? text = value.isEmpty ? null : value;
    switch (key) {
      case 'third_party_plate':
        _assessment = _assessment.copyWith(thirdPartyPlate: text);
      case 'third_party_driver':
        _assessment = _assessment.copyWith(thirdPartyDriver: text);
      case 'third_party_phone':
        _assessment = _assessment.copyWith(thirdPartyPhone: text);
      case 'police_report_no':
        _setAuthority('police', reportNo: text);
      case 'najm_report':
        _setAuthority('najm', reportStatus: text);
      case 'taqdeer_required':
        _assessment = _assessment.copyWith(
          taqdeerRequired: text == null ? null : text == 'yes',
        );
      case 'taqdeer_no':
        _setAuthority('taqdeer', reportNo: text);
    }
    _recordField(key);
    setState(() => _editingRow = null);
    _markDirty();
  }

  // --- Server writes -------------------------------------------------------

  void _toast(String message) {
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(message)));
  }

  void _toastError(Object error) {
    _toast(accidentAppError(error, AccidentCopy.of(context)).message);
  }

  Future<void> _save() async {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    setState(() => _saving = true);
    try {
      final AccidentLiabilityRepository repo =
          ref.read(accidentLiabilityRepositoryProvider);
      final AccidentLiabilityAssessment saved = await repo.save(
        accidentId: _record.id,
        assessment: _assessment.copyWith(
          responsibleCompany: _companyController.text.trim().isEmpty
              ? null
              : _companyController.text.trim(),
        ),
        includeExtended: _extended,
        country: _workspace?.activeCountry,
        site: _record.site,
      );
      for (final String type in accidentAuthorityTypes) {
        final AccidentAuthorityReport? report = _authority[type];
        if (report == null ||
            (report.reportNo == null && report.reportStatus == null)) {
          continue;
        }
        final AccidentAuthorityReport stored = await repo.saveAuthorityReport(
          accidentId: _record.id,
          report: AccidentAuthorityReport(
            id: report.id,
            authorityType: type,
            reportNo: report.reportNo,
            reportStatus: report.reportStatus ??
                (report.reportNo == null ? 'pending' : 'available'),
            reportDate: report.reportDate,
          ),
          country: _workspace?.activeCountry,
          site: _record.site,
        );
        _authority[type] = stored;
      }
      await ref
          .read(accidentResponsibilityDraftStoreProvider)
          .clear(_draftScope);
      if (!mounted) return;
      setState(() {
        _assessment = _extended
            ? saved
            : saved.copyWith(fieldAudit: _assessment.fieldAudit);
        _draftExists = false;
      });
      _toast(copy('saved'));
    } on Object catch (error) {
      if (!mounted) return;
      _toastError(error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _requestTaqdeer() async {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final String owner = accidentWorkstreamOwner(
      copy,
      widget.snapshot.workstreams,
      'insurance',
    );
    setState(() => _requesting = true);
    try {
      await ref.read(accidentCaseDocsRepositoryProvider).logCommunication(
            accidentId: _record.id,
            workstreamKey: _workstreamKey,
            subject: copy('taqdeerRequestSubject'),
            body: responsibilityDocs[2].label,
            toParty: owner,
            authorName: _workspace?.fullName,
            country: _workspace?.activeCountry,
            site: _record.site,
          );
      if (!mounted) return;
      _toast(copy('loggedOnTimeline'));
    } on Object catch (error) {
      if (!mounted) return;
      _toastError(error);
    } finally {
      if (mounted) setState(() => _requesting = false);
    }
  }

  Future<void> _upload(String requirementKey) async {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final AccidentPhotoSource? source =
        await TpBottomSheet.show<AccidentPhotoSource>(
      context: context,
      title: copy('upload'),
      builder: (BuildContext sheetContext) => Padding(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            TpButton.secondary(
              key: const Key('accident.resp.upload.camera'),
              label: copy('takePhoto'),
              icon: Icons.photo_camera_outlined,
              onPressed: () =>
                  Navigator.of(sheetContext).pop(AccidentPhotoSource.camera),
            ),
            const SizedBox(height: TpSpace.sm),
            TpButton.secondary(
              key: const Key('accident.resp.upload.gallery'),
              label: copy('chooseFile'),
              icon: Icons.photo_library_outlined,
              onPressed: () =>
                  Navigator.of(sheetContext).pop(AccidentPhotoSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    setState(() => _uploadingKey = requirementKey);
    try {
      final String? path = await ref.read(accidentPhotoCaptureProvider).capture(
            sessionKey: 'case_${_record.id}',
            source: source,
          );
      if (path == null) return;
      await ref.read(accidentCaseDocsRepositoryProvider).upload(
            accidentId: _record.id,
            workstreamKey: _workstreamKey,
            requirementKey: requirementKey,
            localPath: path,
            country: _workspace?.activeCountry,
            site: _record.site,
          );
      final AccidentEvidenceLoad docs = await ref
          .read(accidentCaseDocsRepositoryProvider)
          .listEvidence(_record.id);
      if (!mounted) return;
      setState(() => _docs = docs);
    } on UnsupportedError catch (error) {
      if (!mounted) return;
      _toast(error.message ?? copy('uploadFailed'));
    } on Object catch (error) {
      if (!mounted) return;
      _toastError(error);
    } finally {
      if (mounted) setState(() => _uploadingKey = null);
    }
  }

  // --- Build -------------------------------------------------------------

  bool get _locked => _assessment.locked == true;

  bool get _taqdeerMissing =>
      _assessment.taqdeerRequired == true && !_docs.has('taqdeer_assessment');

  @override
  Widget build(BuildContext context) {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final NumberedStep? step = caseFlowStep(_workstreamKey);
    final String fleetOwner = accidentWorkstreamOwner(
      copy,
      widget.snapshot.workstreams,
      _workstreamKey,
    );
    final String insuranceOwner = accidentWorkstreamOwner(
      copy,
      widget.snapshot.workstreams,
      'insurance',
    );
    final AppError? error = _error;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.xs,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Text(
              step == null
                  ? humaniseAccidentToken(_workstreamKey)
                  : '${step.n} of ${caseFlow.length} · ${step.label}',
              key: const Key('accident.resp.eyebrow'),
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: palette.primary,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            if (_draftExists)
              TpStatusChip(
                key: const Key('accident.resp.draftChip'),
                status: TpStatus.info,
                label: copy('draftSaved'),
                icon: Icons.save_outlined,
                isCompact: true,
              ),
          ],
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          '${copy('ownerLabel')}: $fleetOwner | '
          '${copy('insuranceReview')}: $insuranceOwner',
          key: const Key('accident.resp.owners'),
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
        const SizedBox(height: TpSpace.md),
        if (_loading)
          Row(
            children: <Widget>[
              const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(child: Text(copy('loading'))),
            ],
          )
        else if (error != null)
          TpErrorState(error: error, onRetry: _load)
        else ...<Widget>[
          if (!_extended) ...<Widget>[
            _notice(
              copy('liabilityNotProvisioned'),
              TpStatus.unknown,
              palette,
              key: const Key('accident.resp.notProvisioned'),
            ),
            const SizedBox(height: TpSpace.md),
          ],
          if (_locked) ...<Widget>[
            _notice(copy('lockedNotice'), TpStatus.neutral, palette),
            const SizedBox(height: TpSpace.md),
          ],
          _faultCard(copy, palette),
          const SizedBox(height: TpSpace.md),
          _payerCard(copy, palette),
          const SizedBox(height: TpSpace.md),
          _authorityCard(copy, palette),
          const SizedBox(height: TpSpace.md),
          _documentsCard(copy, palette),
          if (_taqdeerMissing) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            _notice(
              copy('taqdeerWarning'),
              TpStatus.warning,
              palette,
              key: const Key('accident.resp.taqdeerWarning'),
            ),
          ],
          const SizedBox(height: TpSpace.lg),
          TpButton.primary(
            key: const Key('accident.resp.save'),
            label: copy('saveDetails'),
            icon: Icons.save_outlined,
            isFullWidth: true,
            isBusy: _saving,
            onPressed: _saving || _locked ? null : () => unawaited(_save()),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.secondary(
            key: const Key('accident.resp.requestTaqdeer'),
            label: copy('requestTaqdeer'),
            icon: Icons.request_page_outlined,
            isFullWidth: true,
            isBusy: _requesting,
            onPressed: _requesting || !_taqdeerMissing
                ? null
                : () => unawaited(_requestTaqdeer()),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.text(
            key: const Key('accident.resp.continue'),
            label: copy('continueDamage'),
            icon: Icons.arrow_forward_rounded,
            isFullWidth: true,
            onPressed: () => widget.onNavigate('damage_map'),
          ),
        ],
      ],
    );
  }

  Widget _faultCard(AccidentMockCopy copy, TpPalette palette) {
    final String? type = _assessment.liabilityType;
    final bool shared = type == 'shared';
    final String status = faultStatusFor(type, _assessment.ourLiabilityPct);
    return _numbered(
      1,
      copy('whoAtFault'),
      <Widget>[
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final FaultTile tile in faultTiles)
              ChoiceChip(
                key: Key('accident.resp.fault.${tile.key}'),
                label: Text(tile.label),
                selected: type == tile.key,
                onSelected: _locked
                    ? null
                    : (bool selected) {
                        if (selected) _selectFault(tile);
                      },
              ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        AccidentInfoRow(
          copy('faultStatus'),
          status.isEmpty ? copy('notSet') : status,
        ),
        if (shared) ...<Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: TpInput(
                  key: const Key('accident.resp.ourPct'),
                  label: copy('gccLiability'),
                  controller: _ourPctController,
                  keyboardType: TextInputType.number,
                  enabled: !_locked,
                  onChanged: (String raw) => _setPct(ours: true, raw: raw),
                ),
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: TpInput(
                  key: const Key('accident.resp.otherPct'),
                  label: copy('otherLiability'),
                  controller: _otherPctController,
                  keyboardType: TextInputType.number,
                  enabled: !_locked,
                  onChanged: (String raw) => _setPct(ours: false, raw: raw),
                ),
              ),
            ],
          ),
        ] else ...<Widget>[
          AccidentInfoRow(
            copy('gccLiability'),
            _pctOrNotSet(copy, _assessment.ourLiabilityPct),
          ),
          AccidentInfoRow(
            copy('otherLiability'),
            _pctOrNotSet(copy, _assessment.thirdPartyPct),
          ),
        ],
        const SizedBox(height: TpSpace.xs),
        Text(
          copy('provisionalNote'),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textMuted,
              ),
        ),
      ],
    );
  }

  static String _pctOrNotSet(AccidentMockCopy copy, num? value) {
    final String text = accidentPctText(value);
    return text.isEmpty ? copy('notSet') : text;
  }

  Widget _payerCard(AccidentMockCopy copy, TpPalette palette) {
    final String? payer = _assessment.payer;
    final bool autoRecovery = _assessment.recoveryRequired == null;
    final bool recovery =
        _assessment.recoveryRequired ?? recoveryRequiredFor(payer);
    String faultParty = copy('notSet');
    for (final FaultTile tile in faultTiles) {
      if (tile.key == _assessment.liabilityType) faultParty = tile.label;
    }
    final String payerText = payerLabel(payer);
    return _numbered(
      2,
      copy('whoWillPay'),
      <Widget>[
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.sm,
          children: <Widget>[
            for (final VocabItem tile in payerTiles)
              ChoiceChip(
                key: Key('accident.resp.payer.${tile.key}'),
                label: Text(tile.label),
                selected: payer == tile.key,
                onSelected: _locked
                    ? null
                    : (bool selected) {
                        if (selected) _selectPayer(tile.key);
                      },
              ),
          ],
        ),
        const SizedBox(height: TpSpace.md),
        AccidentInfoRow(copy('faultParty'), faultParty),
        AccidentInfoRow(
          copy('payer'),
          payerText.isEmpty ? copy('notSet') : payerText,
        ),
        const SizedBox(height: TpSpace.xs),
        TpInput(
          key: const Key('accident.resp.company'),
          label: copy('responsibleCompany'),
          controller: _companyController,
          enabled: !_locked,
          textCapitalization: TextCapitalization.words,
          onChanged: (String raw) {
            _assessment = _assessment.copyWith(
              responsibleCompany: raw.trim().isEmpty ? null : raw.trim(),
            );
            _markDirty();
          },
        ),
        const SizedBox(height: TpSpace.sm),
        AccidentInfoRow(
          copy('recoveryRequired'),
          '${copy(recovery ? 'yes' : 'no')}'
          '${autoRecovery ? ' · ${copy('auto')}' : ''}',
        ),
        TpSegmented<String>(
          key: const Key('accident.resp.recovery'),
          expanded: true,
          value: autoRecovery ? 'auto' : (recovery ? 'yes' : 'no'),
          options: <TpSegmentedOption<String>>[
            TpSegmentedOption<String>(value: 'auto', label: copy('auto')),
            TpSegmentedOption<String>(value: 'yes', label: copy('yes')),
            TpSegmentedOption<String>(value: 'no', label: copy('no')),
          ],
          onChanged: _locked
              ? null
              : (String value) {
                  _assessment = _assessment.copyWith(
                    recoveryRequired: value == 'auto' ? null : value == 'yes',
                  );
                  _markDirty();
                },
        ),
      ],
    );
  }

  Widget _authorityCard(AccidentMockCopy copy, TpPalette palette) {
    return _numbered(
      3,
      copy('authorityTitle'),
      <Widget>[
        Text(
          '${copy('value')} | ${copy('recordedBy')} | ${copy('verification')}',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textSecondary,
                fontWeight: FontWeight.w700,
              ),
        ),
        for (final VocabItem row in authorityRows) ...<Widget>[
          Divider(height: TpSpace.lg, color: palette.border),
          _authorityRow(copy, palette, row),
        ],
      ],
    );
  }

  Widget _authorityRow(
    AccidentMockCopy copy,
    TpPalette palette,
    VocabItem row,
  ) {
    final AccidentFieldAudit audit = _audit(row.key);
    final String verification = _verificationOf(row.key);
    final bool editing = _editingRow == row.key;
    final String recordedBy = audit.recordedBy?.trim().isNotEmpty ?? false
        ? audit.recordedBy!.trim()
        : copy('notSet');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          row.label,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ),
        const SizedBox(height: TpSpace.xs),
        InkWell(
          key: Key('accident.resp.row.${row.key}'),
          onTap: _locked
              ? null
              : () => setState(() {
                    _editingRow = editing ? null : row.key;
                    _rowController.text = _rowValue(row.key) ?? '';
                  }),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  _rowText(copy, row.key),
                  key: Key('accident.resp.value.${row.key}'),
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
              Icon(
                Icons.edit_outlined,
                size: TpSizing.iconSm,
                color: palette.textMuted,
              ),
            ],
          ),
        ),
        if (editing) ...<Widget>[
          const SizedBox(height: TpSpace.xs),
          _rowEditor(copy, row.key),
        ],
        const SizedBox(height: TpSpace.xs),
        Text(
          '${copy('recordedBy')}: $recordedBy'
          '${audit.recordedAt == null ? '' : ' · '
              '${accidentDayClock(context, audit.recordedAt!)}'}',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textSecondary,
              ),
        ),
        const SizedBox(height: TpSpace.xs),
        TpSegmented<String>(
          key: Key('accident.resp.verify.${row.key}'),
          expanded: true,
          value: verification,
          options: <TpSegmentedOption<String>>[
            for (final String state in verificationStates)
              TpSegmentedOption<String>(
                value: state,
                label: copy(state),
              ),
          ],
          onChanged: _locked || !_extended
              ? null
              : (String state) => _setVerification(row.key, state),
        ),
      ],
    );
  }

  Widget _rowEditor(AccidentMockCopy copy, String key) {
    if (key == 'najm_report') {
      final String current = _rowValue(key) ?? '';
      return TpSegmented<String>(
        key: const Key('accident.resp.editor.najm'),
        expanded: true,
        value: accidentAuthorityStatuses.contains(current)
            ? current
            : current == 'received'
                ? 'available'
                : 'pending',
        options: <TpSegmentedOption<String>>[
          TpSegmentedOption<String>(
            value: 'available',
            label: copy('received'),
          ),
          TpSegmentedOption<String>(value: 'pending', label: copy('pending')),
          TpSegmentedOption<String>(value: 'none', label: copy('none')),
        ],
        onChanged: (String value) => _commitRow(key, value),
      );
    }
    if (key == 'taqdeer_required') {
      return TpSegmented<String>(
        key: const Key('accident.resp.editor.taqdeerRequired'),
        expanded: true,
        value: _rowValue(key) ?? 'no',
        options: <TpSegmentedOption<String>>[
          TpSegmentedOption<String>(value: 'yes', label: copy('yes')),
          TpSegmentedOption<String>(value: 'no', label: copy('no')),
        ],
        onChanged: (String value) => _commitRow(key, value),
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: <Widget>[
        Expanded(
          child: TpInput(
            key: Key('accident.resp.editor.$key'),
            label: copy('value'),
            controller: _rowController,
            autofocus: true,
            keyboardType: key == 'third_party_phone'
                ? TextInputType.phone
                : TextInputType.text,
            onSubmitted: (String raw) => _commitRow(key, raw),
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        TpButton.secondary(
          key: Key('accident.resp.done.$key'),
          label: copy('done'),
          isCompact: true,
          onPressed: () => _commitRow(key, _rowController.text),
        ),
      ],
    );
  }

  Widget _documentsCard(AccidentMockCopy copy, TpPalette palette) {
    final List<VocabItem> required = responsibilityDocs
        .where((VocabItem doc) => doc.required)
        .toList(growable: false);
    final int have =
        required.where((VocabItem doc) => _docs.has(doc.key)).length;
    return _numbered(
      4,
      copy('docsTitle'),
      <Widget>[
        Text(
          copy.fill('requiredDocs', <String, String>{
            'a': '$have',
            'b': '${required.length}',
          }),
          key: const Key('accident.resp.docCount'),
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: palette.textSecondary,
                fontWeight: FontWeight.w700,
              ),
        ),
        const SizedBox(height: TpSpace.xs),
        Text(
          '${copy('document')} | ${copy('status')} | ${copy('uploader')} | '
          '${copy('time')} | ${copy('verification')}',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: palette.textSecondary,
                fontWeight: FontWeight.w700,
              ),
        ),
        if (!_docs.provisioned) ...<Widget>[
          const SizedBox(height: TpSpace.sm),
          _notice(copy('docsNotProvisioned'), TpStatus.unknown, palette),
        ],
        for (final VocabItem doc in responsibilityDocs) ...<Widget>[
          Divider(height: TpSpace.lg, color: palette.border),
          _documentRow(copy, palette, doc),
        ],
      ],
    );
  }

  Widget _documentRow(AccidentMockCopy copy, TpPalette palette, VocabItem doc) {
    final AccidentEvidenceDoc? stored = _docs.forRequirement(doc.key);
    final bool uploading = _uploadingKey == doc.key;
    final TpStatus statusTone = stored != null
        ? TpStatus.ok
        : doc.required
            ? TpStatus.warning
            : TpStatus.neutral;
    final String statusLabel = stored != null
        ? copy('uploaded')
        : doc.required
            ? copy('missing')
            : copy('optional');
    final String uploader = stored == null
        ? copy('notSet')
        : stored.uploadedBy != null && stored.uploadedBy == _workspace?.userId
            ? copy('you')
            : stored.uploadedBy == null
                ? copy('notSet')
                : copy('anotherUser');
    final String time = stored?.uploadedAt == null
        ? copy('notSet')
        : accidentDayClock(context, stored!.uploadedAt!);
    final String verification = switch (stored?.verificationStatus) {
      'verified' => copy('verified'),
      'rejected' => copy('rejected'),
      null => copy('notSet'),
      _ => copy('unverified'),
    };
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                doc.required ? doc.label : '${doc.label} (${copy('optional')})',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: TpSpace.xs),
              Wrap(
                spacing: TpSpace.sm,
                runSpacing: TpSpace.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: <Widget>[
                  TpStatusChip(
                    key: Key('accident.resp.docStatus.${doc.key}'),
                    status: statusTone,
                    label: statusLabel,
                    isCompact: true,
                  ),
                  Text(
                    '$uploader · $time · $verification',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: palette.textSecondary,
                        ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: TpSpace.sm),
        IconButton(
          key: Key('accident.resp.upload.${doc.key}'),
          tooltip: copy('upload'),
          onPressed: uploading || !_docs.provisioned
              ? null
              : () => unawaited(_upload(doc.key)),
          icon: uploading
              ? const SizedBox.square(
                  dimension: TpSizing.iconMd,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.upload_file_outlined),
        ),
      ],
    );
  }

  Widget _numbered(int number, String title, List<Widget> children) => TpCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                CircleAvatar(
                  radius: 13,
                  backgroundColor: TpPalette.of(context).primary,
                  foregroundColor: TpPalette.of(context).onPrimary,
                  child: Text('$number', style: const TextStyle(fontSize: 13)),
                ),
                const SizedBox(width: TpSpace.sm),
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: TpSpace.md),
            ...children,
          ],
        ),
      );

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
