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
import 'package:tyre_pulse/features/accidents/data/accident_capability.dart';
import 'package:tyre_pulse/features/accidents/data/accident_case_docs_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_liability_repository.dart';
import 'package:tyre_pulse/features/accidents/data/accident_photo_capture.dart';
import 'package:tyre_pulse/features/accidents/data/accident_responsibility_draft_store.dart';
import 'package:tyre_pulse/features/accidents/data/accident_workstream_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_mock_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_header.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_mock_kit.dart';

const String _workstreamKey = 'liability';

class AccidentResponsibilityMockWorkspace extends ConsumerStatefulWidget {
  const AccidentResponsibilityMockWorkspace({
    required this.snapshot,
    required this.onNavigate,
    this.showWorkstreamHeader = true,
    this.now,
    super.key,
  });

  final AccidentCaseSnapshot snapshot;
  final void Function(String workspaceKey) onNavigate;

  /// False inside the case screen, which already states "Workstream 4 of 7"
  /// once in its header; the "4 of 7 · Responsibility and payment" eyebrow
  /// is then not repeated.
  final bool showWorkstreamHeader;

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

  /// `profiles.id -> full_name` for document uploaders and verifiers.
  Map<String, String> _names = const <String, String>{};

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
      final Map<String, String> names = await _lookupNames(docs);
      if (!mounted) return;
      setState(() {
        _names = names;
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

  /// Resolves uploader and verifier ids to names. A failed lookup only
  /// costs the names (the row then says "Not set"), never the screen.
  Future<Map<String, String>> _lookupNames(AccidentEvidenceLoad docs) async {
    try {
      return await ref.read(accidentCasePeopleRepositoryProvider).namesFor(
        <String?>[
          for (final AccidentEvidenceDoc doc in docs.docs) ...<String?>[
            doc.uploadedBy,
            doc.verifiedBy,
          ],
        ],
      );
    } on Object {
      return const <String, String>{};
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
      final Map<String, String> names = await _lookupNames(docs);
      if (!mounted) return;
      setState(() {
        _docs = docs;
        _names = names;
      });
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

  static const Map<String, IconData> _faultIcons = <String, IconData>{
    'our_driver_full': Icons.person_outline,
    'third_party_full': Icons.directions_car_outlined,
    'shared': Icons.people_outline,
    'under_investigation': Icons.manage_search_rounded,
    'not_applicable': Icons.remove_circle_outline_rounded,
  };

  static const Map<String, IconData> _payerIcons = <String, IconData>{
    'other_party_insurance': Icons.shield_outlined,
    'our_insurance': Icons.verified_user_outlined,
    'company': Icons.apartment_outlined,
    'driver_recovery': Icons.person_search_outlined,
    'warranty': Icons.workspace_premium_outlined,
    'pending': Icons.schedule_rounded,
  };

  static const Map<String, IconData> _authorityIcons = <String, IconData>{
    'third_party_plate': Icons.pin_outlined,
    'third_party_driver': Icons.person_outline,
    'third_party_phone': Icons.phone_outlined,
    'police_report_no': Icons.local_police_outlined,
    'najm_report': Icons.description_outlined,
    'taqdeer_required': Icons.gavel_outlined,
    'taqdeer_no': Icons.tag_rounded,
  };

  static const Map<String, IconData> _docIcons = <String, IconData>{
    'police_accident_report': Icons.description_outlined,
    'najm_report': Icons.description_outlined,
    'taqdeer_assessment': Icons.gavel_outlined,
    'third_party_registration_card': Icons.badge_outlined,
    'third_party_insurance_policy': Icons.shield_outlined,
    'driver_licence': Icons.credit_card_outlined,
    'company_letter_undertaking': Icons.mail_outline_rounded,
  };

  String _faultLabel(AccidentMockCopy copy, FaultTile tile) =>
      accidentVocabLabel(copy, 'fault', tile.key, tile.label);

  String _payerLabel(AccidentMockCopy copy, String? key) {
    for (final VocabItem tile in payerTiles) {
      if (tile.key == key) {
        return accidentVocabLabel(copy, 'payer', tile.key, tile.label);
      }
    }
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final AccidentMockCopy copy = AccidentMockCopy.of(context);
    final TpPalette palette = TpPalette.of(context);
    final NumberedStep? step = caseFlowStep(_workstreamKey);
    final AccidentCasePeople people =
        ref.watch(accidentCasePeopleProvider(_record.id)).value ??
            AccidentCasePeople.unknown;
    final List<AccidentWorkstream> rows = widget.snapshot.workstreams;
    final String fleetOwner = accidentOwnerDisplay(
      copy,
      people,
      _workstreamKey,
      accidentWorkstreamOwner(copy, rows, _workstreamKey),
    );
    final String insuranceOwner = accidentOwnerDisplay(
      copy,
      people,
      'insurance',
      accidentWorkstreamOwner(copy, rows, 'insurance'),
    );
    final AppError? error = _error;
    final TextTheme text = Theme.of(context).textTheme;
    final String eyebrow = step == null
        ? humaniseAccidentToken(_workstreamKey)
        : copy.fill('stepOfShort', <String, String>{
            't': '${caseFlow.length}',
            's': accidentVocabLabel(copy, 'flow', step.key, step.label),
          });

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Wrap(
          spacing: TpSpace.sm,
          runSpacing: TpSpace.xs,
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            if (widget.showWorkstreamHeader)
              Semantics(
                header: true,
                label: step == null ? eyebrow : '${step.n} $eyebrow',
                excludeSemantics: true,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (step != null) ...<Widget>[
                      CircleAvatar(
                        radius: 12,
                        backgroundColor: palette.primary,
                        child: Text(
                          '${step.n}',
                          style: TextStyle(
                            color: palette.onPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: TpSpace.sm),
                    ],
                    Flexible(
                      child: Text(
                        eyebrow,
                        key: const Key('accident.resp.eyebrow'),
                        style: text.titleSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            if (_draftExists)
              Row(
                key: const Key('accident.resp.draftChip'),
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(
                    Icons.cloud_done_outlined,
                    size: TpSizing.iconMd,
                    color: palette.primary,
                  ),
                  const SizedBox(width: TpSpace.xs),
                  Text(
                    copy('draftSaved'),
                    style: text.bodySmall?.copyWith(color: palette.primary),
                  ),
                ],
              ),
          ],
        ),
        const SizedBox(height: TpSpace.xs),
        Wrap(
          key: const Key('accident.resp.ownersLine'),
          spacing: TpSpace.md,
          runSpacing: TpSpace.xs,
          children: <Widget>[
            _personLine(
              '${copy('ownerLabel')}: $fleetOwner | '
              '${copy('insuranceReview')}: $insuranceOwner',
              const Key('accident.resp.owners'),
              palette,
            ),
          ],
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
            AccidentMockNotice(
              key: const Key('accident.resp.notProvisioned'),
              text: copy('liabilityNotProvisioned'),
              tone: TpStatus.unknown,
            ),
            const SizedBox(height: TpSpace.md),
          ],
          if (_locked) ...<Widget>[
            AccidentMockNotice(
              text: copy('lockedNotice'),
              tone: TpStatus.neutral,
            ),
            const SizedBox(height: TpSpace.md),
          ],
          _faultCard(copy, palette),
          const SizedBox(height: TpSpace.md),
          _payerCard(copy, palette),
          const SizedBox(height: TpSpace.md),
          _authorityCard(copy, palette),
          const SizedBox(height: TpSpace.md),
          _documentsCard(copy, palette),
          const SizedBox(height: TpSpace.lg),
          // The liability decision is written only by a role holding
          // approve_liability (or an elevated role); others are not offered
          // a save that the server would refuse.
          if (ref
                  .watch(
                    accidentCapabilityProvider(
                      AccidentCapability.approveLiability,
                    ),
                  )
                  .value ??
              false) ...<Widget>[
            TpButton.secondary(
              key: const Key('accident.resp.save'),
              label: copy('saveDetails'),
              icon: Icons.bookmark_border_rounded,
              isFullWidth: true,
              isBusy: _saving,
              onPressed: _saving || _locked ? null : () => unawaited(_save()),
            ),
            const SizedBox(height: TpSpace.sm),
          ],
          AccidentMockToneButton(
            key: const Key('accident.resp.requestTaqdeer'),
            label: copy('requestTaqdeer'),
            icon: Icons.note_add_outlined,
            isFullWidth: true,
            isBusy: _requesting,
            onPressed: _requesting || !_taqdeerMissing
                ? null
                : () => unawaited(_requestTaqdeer()),
          ),
          const SizedBox(height: TpSpace.sm),
          TpButton.primary(
            key: const Key('accident.resp.continue'),
            label: copy('continueDamage'),
            icon: Icons.arrow_circle_right_outlined,
            isFullWidth: true,
            onPressed: () => widget.onNavigate('damage_map'),
          ),
        ],
      ],
    );
  }

  Widget _personLine(String value, Key key, TpPalette palette) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(
            Icons.person_outline,
            size: TpSizing.iconMd,
            color: palette.primary,
          ),
          const SizedBox(width: TpSpace.xs),
          Flexible(
            child: Text(
              value,
              key: key,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: palette.textSecondary,
                  ),
            ),
          ),
        ],
      );

  Widget _faultCard(AccidentMockCopy copy, TpPalette palette) {
    final String? type = _assessment.liabilityType;
    final bool shared = type == 'shared';
    final String status = faultStatusFor(type, _assessment.ourLiabilityPct);
    final TpStatus statusTone = switch (status) {
      'Faulty' => TpStatus.critical,
      'Non-faulty' => TpStatus.ok,
      '' => TpStatus.unknown,
      _ => TpStatus.warning,
    };
    return AccidentMockSection(
      number: 1,
      title: copy('whoAtFault'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AccidentMockTileGrid(
            minTileWidth: 92,
            maxColumns: 5,
            children: <Widget>[
              for (final FaultTile tile in faultTiles)
                AccidentMockChoiceTile(
                  key: Key('accident.resp.fault.${tile.key}'),
                  label: _faultLabel(copy, tile),
                  icon: _faultIcons[tile.key] ?? Icons.help_outline,
                  iconColor: tile.key == 'shared'
                      ? palette.warning.base
                      : tile.key == 'not_applicable'
                          ? palette.textSecondary
                          : null,
                  selected: type == tile.key,
                  onTap: _locked ? null : () => _selectFault(tile),
                ),
            ],
          ),
          Divider(height: TpSpace.xl, color: palette.border),
          AccidentMockTileGrid(
            minTileWidth: 130,
            maxColumns: 4,
            children: <Widget>[
              _metric(
                copy('faultStatus'),
                status.isEmpty
                    ? copy('notSet')
                    : accidentFaultStatusText(copy, status),
                palette.forStatus(statusTone).onSoft,
                icon: Icons.verified_user_outlined,
              ),
              if (!shared) ...<Widget>[
                _metric(
                  copy('gccLiability'),
                  _pctOrNotSet(copy, _assessment.ourLiabilityPct),
                  (_assessment.ourLiabilityPct ?? 0) > 0
                      ? palette.critical.base
                      : palette.ok.onSoft,
                ),
                _metric(
                  copy('otherLiability'),
                  _pctOrNotSet(copy, _assessment.thirdPartyPct),
                  (_assessment.thirdPartyPct ?? 0) > 0
                      ? palette.critical.base
                      : palette.ok.onSoft,
                ),
              ],
              _metric(
                copy('auditNote'),
                copy('provisionalNote'),
                palette.text,
                icon: Icons.info_outline_rounded,
                small: true,
              ),
            ],
          ),
          if (shared) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
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
          ],
        ],
      ),
    );
  }

  Widget _metric(
    String label,
    String value,
    Color color, {
    IconData? icon,
    bool small = false,
  }) {
    final TextTheme text = Theme.of(context).textTheme;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (icon != null) ...<Widget>[
          Icon(
            icon,
            size: TpSizing.iconMd,
            color: TpPalette.of(context).textSecondary,
          ),
          const SizedBox(width: TpSpace.xs),
        ],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                label,
                style: text.labelSmall?.copyWith(
                  color: TpPalette.of(context).textSecondary,
                ),
              ),
              Text(
                value,
                style: (small ? text.bodySmall : text.titleMedium)?.copyWith(
                  color: color,
                  fontWeight: small ? FontWeight.w600 : FontWeight.w800,
                ),
              ),
            ],
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
      if (tile.key == _assessment.liabilityType) {
        faultParty = _faultLabel(copy, tile);
      }
    }
    final String payerText = _payerLabel(copy, payer);
    return AccidentMockSection(
      number: 2,
      title: copy('whoWillPay'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AccidentMockTileGrid(
            minTileWidth: 92,
            maxColumns: 6,
            children: <Widget>[
              for (final VocabItem tile in payerTiles)
                AccidentMockChoiceTile(
                  key: Key('accident.resp.payer.${tile.key}'),
                  label:
                      accidentVocabLabel(copy, 'payer', tile.key, tile.label),
                  icon: _payerIcons[tile.key] ?? Icons.help_outline,
                  iconColor: tile.key == 'other_party_insurance'
                      ? palette.warning.base
                      : tile.key == 'pending'
                          ? palette.textSecondary
                          : null,
                  selected: payer == tile.key,
                  onTap: _locked ? null : () => _selectPayer(tile.key),
                ),
            ],
          ),
          Divider(height: TpSpace.xl, color: palette.border),
          _payRow(Icons.person_outline, copy('faultParty'), faultParty),
          _payRow(
            Icons.account_balance_wallet_outlined,
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
          _payRow(
            Icons.currency_exchange_rounded,
            copy('recoveryRequired'),
            '${copy(recovery ? 'yes' : 'no')}'
            '${autoRecovery ? ' · ${copy('auto')}' : ''}',
          ),
          const SizedBox(height: TpSpace.xs),
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
      ),
    );
  }

  Widget _payRow(IconData icon, String label, String value) {
    final TpPalette palette = TpPalette.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: TpSpace.xs),
      child: Row(
        children: <Widget>[
          Icon(icon, size: TpSizing.iconMd, color: palette.primary),
          const SizedBox(width: TpSpace.sm),
          Expanded(
            flex: 4,
            child: Text(label, style: Theme.of(context).textTheme.bodyMedium),
          ),
          Expanded(
            flex: 5,
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: palette.primary,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  static TpStatus _verificationTone(String state) => switch (state) {
        'verified' => TpStatus.ok,
        'missing' => TpStatus.critical,
        _ => TpStatus.warning,
      };

  static IconData _verificationIcon(String state) => switch (state) {
        'verified' => Icons.check_circle_outline_rounded,
        'missing' => Icons.error_outline_rounded,
        'not_required' => Icons.remove_circle_outline_rounded,
        _ => Icons.error_outline_rounded,
      };

  Widget _statusText(String label, TpStatus tone, IconData icon) {
    final Color color = TpPalette.of(context).forStatus(tone).onSoft;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: TpSizing.iconSm, color: color),
        const SizedBox(width: TpSpace.xs),
        Flexible(
          child: Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }

  Widget _authorityCard(AccidentMockCopy copy, TpPalette palette) {
    return AccidentMockSection(
      number: 3,
      title: copy('authorityTitle'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (int i = 0; i < authorityRows.length; i++) ...<Widget>[
            if (i > 0) Divider(height: 1, color: palette.border),
            _authorityRow(copy, palette, authorityRows[i]),
          ],
        ],
      ),
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
    final String who = <String?>[audit.verifiedBy, audit.recordedBy]
        .map((String? v) => v?.trim() ?? '')
        .firstWhere((String v) => v.isNotEmpty, orElse: () => '');
    final String label = accidentVocabLabel(copy, 'auth', row.key, row.label);
    final String value = _rowText(copy, row.key);
    final bool highlight = (row.key == 'najm_report' &&
            (_rowValue(row.key) == 'available' ||
                _rowValue(row.key) == 'received')) ||
        (row.key == 'taqdeer_required' && _rowValue(row.key) == 'yes');
    final Widget status = _statusText(
      copy(verification),
      _verificationTone(verification),
      _verificationIcon(verification),
    );
    final Text valueText = Text(
      value,
      key: Key('accident.resp.value.${row.key}'),
      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            color: highlight
                ? (row.key == 'taqdeer_required'
                    ? palette.warning.onSoft
                    : palette.ok.onSoft)
                : null,
          ),
    );
    final Text whoText = Text(
      who.isEmpty ? copy('notSet') : who,
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: palette.textSecondary,
          ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(
          button: true,
          label: '$label: $value, $who, ${copy(verification)}',
          excludeSemantics: true,
          child: InkWell(
            key: Key('accident.resp.row.${row.key}'),
            onTap: _locked
                ? null
                : () => setState(() {
                      _editingRow = editing ? null : row.key;
                      _rowController.text = _rowValue(row.key) ?? '';
                    }),
            child: ConstrainedBox(
              constraints:
                  const BoxConstraints(minHeight: TpSizing.minTouchTarget),
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints box) {
                  final Widget lead = Row(
                    children: <Widget>[
                      Icon(
                        _authorityIcons[row.key] ?? Icons.notes_rounded,
                        size: TpSizing.iconMd,
                        color: palette.textSecondary,
                      ),
                      const SizedBox(width: TpSpace.sm),
                      Expanded(
                        child: Text(
                          label,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ),
                    ],
                  );
                  if (box.maxWidth >= 520) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(
                        vertical: TpSpace.sm,
                      ),
                      child: Row(
                        children: <Widget>[
                          Expanded(flex: 4, child: lead),
                          Expanded(flex: 4, child: valueText),
                          Expanded(flex: 3, child: whoText),
                          Expanded(flex: 3, child: status),
                        ],
                      ),
                    );
                  }
                  return Padding(
                    padding: const EdgeInsets.symmetric(vertical: TpSpace.sm),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            Expanded(child: lead),
                            status,
                          ],
                        ),
                        Padding(
                          padding: const EdgeInsetsDirectional.only(
                            start: TpSizing.iconMd + TpSpace.sm,
                          ),
                          child: Row(
                            children: <Widget>[
                              Expanded(child: valueText),
                              const SizedBox(width: TpSpace.sm),
                              Flexible(child: whoText),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        ),
        if (editing) ...<Widget>[
          _rowEditor(copy, row.key),
          const SizedBox(height: TpSpace.sm),
          if (audit.recordedAt != null)
            Text(
              '${copy('recordedBy')}: '
              '${audit.recordedBy?.trim().isNotEmpty ?? false ? audit.recordedBy!.trim() : copy('notSet')}'
              ' · ${accidentDayClock(context, audit.recordedAt!)}',
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
          const SizedBox(height: TpSpace.sm),
        ],
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
    return AccidentMockSection(
      number: 4,
      title: copy('docsTitle'),
      sectionKey: const Key('accident.resp.docsSection'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
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
          if (!_docs.provisioned) ...<Widget>[
            const SizedBox(height: TpSpace.sm),
            AccidentMockNotice(
              text: copy('docsNotProvisioned'),
              tone: TpStatus.unknown,
            ),
          ],
          for (final VocabItem doc in responsibilityDocs) ...<Widget>[
            Divider(height: TpSpace.md, color: palette.border),
            _documentRow(copy, palette, doc),
          ],
          if (_taqdeerMissing) ...<Widget>[
            const SizedBox(height: TpSpace.md),
            AccidentMockNotice(
              key: const Key('accident.resp.taqdeerWarning'),
              text: copy('taqdeerWarning'),
            ),
          ],
        ],
      ),
    );
  }

  String _personName(AccidentMockCopy copy, String? id) {
    final String value = id?.trim() ?? '';
    if (value.isEmpty) return copy('notSet');
    final String? name = _names[value];
    if (name != null && name.trim().isNotEmpty) return name.trim();
    return value == _workspace?.userId ? copy('you') : copy('anotherUser');
  }

  Widget _documentRow(AccidentMockCopy copy, TpPalette palette, VocabItem doc) {
    final AccidentEvidenceDoc? stored = _docs.forRequirement(doc.key);
    final bool uploading = _uploadingKey == doc.key;
    final String label = accidentVocabLabel(copy, 'doc', doc.key, doc.label);
    final String verificationToken = stored == null
        ? (doc.required ? 'missing' : 'not_required')
        : switch (stored.verificationStatus) {
            'verified' => 'verified',
            'rejected' => 'rejected',
            _ => 'pending',
          };
    final (String, TpStatus) status = stored != null
        ? stored.verificationStatus == 'verified'
            ? (copy('verified'), TpStatus.ok)
            : (copy('received'), TpStatus.ok)
        : doc.required
            ? (copy('missing'), TpStatus.critical)
            : (copy('optional'), TpStatus.neutral);
    final String verificationLabel = switch (verificationToken) {
      'verified' => copy('verified'),
      'rejected' => copy('rejected'),
      'missing' => copy('missing'),
      'not_required' => copy('notRequired'),
      _ => copy('unverified'),
    };
    final TpStatus verificationTone = switch (verificationToken) {
      'verified' => TpStatus.ok,
      'rejected' || 'missing' => TpStatus.critical,
      'not_required' => TpStatus.neutral,
      _ => TpStatus.warning,
    };
    final String uploader =
        stored == null ? copy('notSet') : _personName(copy, stored.uploadedBy);
    final String time = stored?.uploadedAt == null
        ? copy('notSet')
        : accidentClock(context, stored!.uploadedAt!);
    final TextStyle? small = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: palette.textSecondary,
        );
    final Widget statusText = Text(
      status.$1,
      key: Key('accident.resp.docStatus.${doc.key}'),
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: palette.forStatus(status.$2).onSoft,
            fontWeight: FontWeight.w700,
          ),
    );
    final Widget verification = _statusText(
      verificationLabel,
      verificationTone,
      _verificationIcon(
        verificationToken == 'rejected' ? 'missing' : verificationToken,
      ),
    );
    final Widget action = IconButton(
      key: Key('accident.resp.upload.${doc.key}'),
      tooltip: copy('upload'),
      onPressed: uploading || !_docs.provisioned || _locked
          ? null
          : () => unawaited(_upload(doc.key)),
      icon: uploading
          ? const SizedBox.square(
              dimension: TpSizing.iconMd,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(
              stored == null
                  ? Icons.upload_file_outlined
                  : Icons.chevron_right_rounded,
            ),
    );
    return Semantics(
      container: true,
      label: '$label, ${status.$1}, $uploader, $time, $verificationLabel',
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints box) {
          final Widget lead = Row(
            children: <Widget>[
              Icon(
                _docIcons[doc.key] ?? Icons.description_outlined,
                size: TpSizing.iconMd,
                color: palette.textSecondary,
              ),
              const SizedBox(width: TpSpace.sm),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            ],
          );
          if (box.maxWidth >= 560) {
            return Row(
              children: <Widget>[
                Expanded(flex: 5, child: lead),
                Expanded(flex: 2, child: statusText),
                Expanded(flex: 2, child: Text(uploader, style: small)),
                Expanded(flex: 2, child: Text(time, style: small)),
                Expanded(flex: 3, child: verification),
                action,
              ],
            );
          }
          return Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(child: lead),
                        statusText,
                      ],
                    ),
                    Padding(
                      padding: const EdgeInsetsDirectional.only(
                        start: TpSizing.iconMd + TpSpace.sm,
                        top: TpSpace.xs,
                      ),
                      child: Wrap(
                        spacing: TpSpace.md,
                        runSpacing: TpSpace.xs,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: <Widget>[
                          Text('$uploader · $time', style: small),
                          verification,
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              action,
            ],
          );
        },
      ),
    );
  }
}
