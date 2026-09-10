/// Drives the checklist fill screen: loads the template and any resumable
/// draft, applies auto-fill/auto-value prefill once, autosaves every change,
/// and runs submission.
///
/// Mirrors the shape `features/inspections/presentation/controllers/
/// inspection_wizard_controller.dart` establishes for this exact situation
/// (read there, never imported from here): a plain (non-family)
/// [NotifierProvider] whose screen calls [initialiseFromRoute] once, from
/// `initState`, via a microtask - "safe to fire directly here rather than
/// through a family provider this project's Riverpod major cannot be
/// confirmed to support without a resolvable pub cache" is that file's own
/// stated reason, and it applies identically here.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/core/database/database_constants.dart'
    show primarySignatureFieldKey;
import 'package:tyre_pulse/core/sync/sync_workspace_id.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_submission_repository.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_asset_context.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_auto_fill.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_auto_value.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_submit_gate.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/presentation/state/checklist_fill_state.dart';

final NotifierProvider<ChecklistFillController, ChecklistFillState>
    checklistFillControllerProvider =
    NotifierProvider<ChecklistFillController, ChecklistFillState>(
  ChecklistFillController.new,
);

class ChecklistFillController extends Notifier<ChecklistFillState> {
  @override
  ChecklistFillState build() => const ChecklistFillState();

  Timer? _autosaveTimer;

  /// Loads everything the fill screen needs for [route]. Safe to call more
  /// than once (a hot-reload, or a screen re-entered) - it always starts
  /// from a fresh load rather than assuming any prior state is still valid.
  Future<void> initialiseFromRoute(ChecklistFillRoute route) async {
    state = const ChecklistFillState();

    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (workspace == null) {
      state = state.copyWith(
        phase: ChecklistFillPhase.error,
        failure: ChecklistFillFailure.workspaceLoading,
      );
      return;
    }

    final ChecklistRemoteRepository remote = ref.read(
      checklistRemoteRepositoryProvider,
    );
    final ChecklistDraftRepository drafts = ref.read(
      checklistDraftRepositoryProvider,
    );

    final ChecklistTemplateRecord? templateRecord = await remote.getTemplate(
      route.templateId.value,
    );
    if (templateRecord == null) {
      state = state.copyWith(
        phase: ChecklistFillPhase.error,
        failure: ChecklistFillFailure.notFound,
      );
      return;
    }

    final String initialAssetNo = route.assetNo?.value ?? '';
    final String draftKey = route.draftKey?.value ??
        drafts.draftKeyFor(
          userId: workspace.userId,
          templateId: templateRecord.template.id ?? route.templateId.value,
          assetNo: initialAssetNo,
        );

    final ChecklistDraftHeader? existing = await drafts.header(draftKey);

    // The signing identity is owned by the authenticated profile, never by a
    // free-text field or a stale draft header. Prefer the already-verified
    // workspace profile and only fall back to the remote profile lookup when
    // that display value was not hydrated into the workspace.
    String? authenticatedName = workspace.fullName?.trim();
    if (authenticatedName == null || authenticatedName.isEmpty) {
      try {
        authenticatedName =
            (await remote.currentUserDisplayName(workspace.userId))?.trim();
      } on Object {
        authenticatedName = null;
      }
    }
    if (authenticatedName?.isEmpty ?? false) authenticatedName = null;

    Map<String, Object?> answers;
    Map<String, Object?> notes;
    String? site;
    String? assetNo;
    String printedName;
    String readLang;
    Map<String, List<ChecklistDraftPhoto>> photosByField;
    Map<String, String> signaturesByField;
    String? primarySignature;

    if (existing != null) {
      answers = await drafts.answers(draftKey);
      notes = await drafts.notes(draftKey);
      site = existing.site ?? route.siteName?.value;
      assetNo =
          existing.assetNo.isEmpty ? route.assetNo?.value : existing.assetNo;
      printedName = authenticatedName ?? existing.printedName ?? '';
      readLang = existing.readLang ?? kChecklistDefaultLang;
    } else {
      answers = <String, Object?>{};
      notes = <String, Object?>{};
      site = route.siteName?.value;
      assetNo = route.assetNo?.value;
      printedName = '';
      readLang = ref.read(checklistContentLanguageProvider);

      // autoValue: seed 'today' / 'current_user' fields ONCE, at open.
      // Never re-resolved on a later resume - see
      // `checklist_auto_value.dart`'s own library comment on why.
      final ChecklistAutoValueContext autoCtx = ChecklistAutoValueContext(
        userName: authenticatedName,
      );
      for (final field in templateRecord.template.fields) {
        if (isAutoField(field)) {
          answers[field.id] = resolveAutoValue(field, autoCtx);
        }
      }
      printedName = authenticatedName ?? '';
    }

    final List<ChecklistDraftPhoto> photos = await drafts.photosFor(draftKey);
    photosByField = <String, List<ChecklistDraftPhoto>>{};
    for (final ChecklistDraftPhoto p in photos) {
      photosByField
          .putIfAbsent(p.fieldKey, () => <ChecklistDraftPhoto>[])
          .add(p);
    }

    final List<ChecklistDraftSignature> signatures = await drafts.signaturesFor(
      draftKey,
    );
    signaturesByField = <String, String>{};
    for (final ChecklistDraftSignature s in signatures) {
      if (s.fieldKey == primarySignatureFieldKey) {
        primarySignature = s.payload;
      } else {
        signaturesByField[s.fieldKey] = s.payload;
      }
    }

    // autoFrom: register prefill, best-effort, only when an asset is
    // already known. Merged rather than replacing - never overwrites
    // something the operator already typed (autoFillAnswers' own rule),
    // and a readOnly field always takes the register value.
    if (assetNo != null && assetNo.trim().isNotEmpty) {
      final String selectedAssetNo = assetNo.trim();
      for (final field in templateRecord.template.fields) {
        if (field.type == 'asset') {
          answers[field.id] = selectedAssetNo;
        }
      }
      final ChecklistAssetContext? assetContext = await _loadAssetContext(
        selectedAssetNo,
      );
      if (assetContext != null) {
        final Map<String, String> patch = autoFillAnswers(
          templateRecord.template,
          assetContext,
          answers,
        );
        answers = <String, Object?>{...answers, ...patch};
        site ??= assetContext.site;
      }
    }

    final List<String> siteOptions = await remote.listSiteOptions(
      country: workspace.activeCountry,
    );

    ChecklistLastSubmissionInfo? warning;
    if (assetNo != null &&
        assetNo.trim().isNotEmpty &&
        templateRecord.template.id != null) {
      warning = await remote.lastSubmission(
        templateId: templateRecord.template.id!,
        assetNo: assetNo,
      );
    }

    state = state.copyWith(
      phase: ChecklistFillPhase.ready,
      templateRecord: templateRecord,
      draftKey: draftKey,
      assignmentId: route.assignmentId?.value,
      answers: answers,
      notes: notes,
      photosByField: photosByField,
      signaturesByField: signaturesByField,
      primarySignature: primarySignature,
      printedName: printedName,
      siteOptions: siteOptions,
      site: site,
      assetNo: assetNo,
      readLang: readLang,
      lastSubmissionWarning: warning,
    );
    _recomputeGate();
  }

  Future<ChecklistAssetContext?> _loadAssetContext(String assetNo) async {
    try {
      final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
      final VehicleFleetRepository repository = ref.read(
        vehicleFleetRepositoryProvider,
      );
      final VehicleDetailOutcome outcome = await repository.byAssetNo(
        scope: vehicleCacheScopeFor(workspace),
        assetNo: assetNo,
        country: workspace?.activeCountry,
      );
      final VehicleAsset? asset = switch (outcome) {
        VehicleDetailLoaded(asset: final VehicleAsset loaded) => loaded,
        VehicleDetailFromCache(asset: final VehicleAsset cached) => cached,
        VehicleDetailNotFound() => null,
        VehicleDetailFailed() => null,
      };
      if (asset == null) return null;
      return ChecklistAssetContext(
        site: asset.site,
        fleetNumber: asset.fleetNumber,
        registrationNo: asset.registrationNo,
        currentKm: asset.currentKm,
        vehicleType: asset.vehicleType,
        make: asset.make,
        model: asset.model,
      );
    } on Object {
      // Best-effort - an asset the register cannot resolve fills nothing,
      // silently, exactly like `resolveAutoFill` itself for an unknown
      // token.
      return null;
    }
  }

  // -- Editing ---------------------------------------------------------

  Future<void> setAsset(String rawAssetNo) async {
    final String assetNo = rawAssetNo.trim();
    final ChecklistTemplateRecord? templateRecord = state.templateRecord;
    if (assetNo.isEmpty || templateRecord == null) return;

    Map<String, Object?> answers = <String, Object?>{...state.answers};
    for (final field in templateRecord.template.fields) {
      if (field.type == 'asset') {
        answers[field.id] = assetNo;
      }
    }

    final ChecklistAssetContext? assetContext = await _loadAssetContext(
      assetNo,
    );
    String? site = state.site;
    if (assetContext != null) {
      answers = <String, Object?>{
        ...answers,
        ...autoFillAnswers(templateRecord.template, assetContext, answers),
      };
      site = assetContext.site ?? site;
    }

    ChecklistLastSubmissionInfo? warning;
    final String? templateId = templateRecord.template.id;
    if (templateId != null) {
      warning = await ref
          .read(checklistRemoteRepositoryProvider)
          .lastSubmission(templateId: templateId, assetNo: assetNo);
    }
    state = state.copyWith(
      assetNo: assetNo,
      site: site,
      answers: answers,
      lastSubmissionWarning: warning,
    );
    _recomputeGate();
    _scheduleAutosave();
  }

  void updateAnswer(String fieldId, Object? value) {
    final Map<String, Object?> next = <String, Object?>{...state.answers};
    next[fieldId] = value;
    state = state.copyWith(answers: next);
    _recomputeGate();
    _scheduleAutosave();
  }

  void updateNote(String fieldId, String note) {
    final Map<String, Object?> next = <String, Object?>{...state.notes};
    next[fieldId] = note;
    state = state.copyWith(notes: next);
    _recomputeGate();
    _scheduleAutosave();
  }

  void setSite(String? site) {
    state = state.copyWith(site: site);
    _scheduleAutosave();
  }

  void setPrintedName(String value) {
    state = state.copyWith(printedName: value);
    _scheduleAutosave();
  }

  void setReadLang(String lang) {
    state = state.copyWith(readLang: normalizeLang(lang));
    _scheduleAutosave();
  }

  Future<void> capturePhoto({
    required String fieldId,
    required Future<ChecklistDraftPhotoCaptureResult?> Function() capture,
  }) async {
    final String? draftKey = state.draftKey;
    if (draftKey == null) return;
    final ChecklistDraftPhotoCaptureResult? captured = await capture();
    if (captured == null) return;

    final ChecklistDraftRepository drafts = ref.read(
      checklistDraftRepositoryProvider,
    );
    await drafts.addPhoto(
      draftKey: draftKey,
      fieldKey: fieldId,
      localPath: captured.localPath,
      capturedAt: captured.capturedAt,
      sizeBytes: captured.sizeBytes,
    );

    final List<ChecklistDraftPhoto> updated = await drafts.photosFor(draftKey);
    final Map<String, List<ChecklistDraftPhoto>> byField =
        <String, List<ChecklistDraftPhoto>>{};
    for (final ChecklistDraftPhoto p in updated) {
      byField.putIfAbsent(p.fieldKey, () => <ChecklistDraftPhoto>[]).add(p);
    }
    state = state.copyWith(photosByField: byField);
    _recomputeGate();
    await _saveHeader();
  }

  Future<void> saveSignature(String fieldId, String? svgOrDataUrl) async {
    final String? draftKey = state.draftKey;
    if (draftKey == null) return;
    final ChecklistDraftRepository drafts = ref.read(
      checklistDraftRepositoryProvider,
    );
    if (svgOrDataUrl == null) {
      await drafts.clearSignature(draftKey: draftKey, fieldKey: fieldId);
      final Map<String, String> next = <String, String>{
        ...state.signaturesByField,
      }..remove(fieldId);
      state = state.copyWith(signaturesByField: next);
      _recomputeGate();
      return;
    }
    await drafts.saveSignature(
      draftKey: draftKey,
      fieldKey: fieldId,
      payload: svgOrDataUrl,
      source: 'drawn',
      signerUserId: ref.read(workspaceContextProvider)?.userId,
      signerName: ref.read(workspaceContextProvider)?.fullName,
      signerRole: ref.read(workspaceContextProvider)?.role.displayName,
    );
    final Map<String, String> next = <String, String>{
      ...state.signaturesByField,
    };
    next[fieldId] = svgOrDataUrl;
    state = state.copyWith(signaturesByField: next);
    _recomputeGate();
  }

  Future<void> savePrimarySignature(String? svgOrDataUrl) async {
    final String? draftKey = state.draftKey;
    if (draftKey == null) return;
    final ChecklistDraftRepository drafts = ref.read(
      checklistDraftRepositoryProvider,
    );
    if (svgOrDataUrl == null) {
      await drafts.clearSignature(
        draftKey: draftKey,
        fieldKey: primarySignatureFieldKey,
      );
      state = state.copyWith(primarySignature: null);
      _recomputeGate();
      return;
    }
    await drafts.saveSignature(
      draftKey: draftKey,
      fieldKey: primarySignatureFieldKey,
      payload: svgOrDataUrl,
      source: 'drawn',
      signerUserId: ref.read(workspaceContextProvider)?.userId,
      signerName: ref.read(workspaceContextProvider)?.fullName,
      signerRole: ref.read(workspaceContextProvider)?.role.displayName,
    );
    state = state.copyWith(primarySignature: svgOrDataUrl);
    _recomputeGate();
  }

  void _recomputeGate() {
    final ChecklistTemplate? template = state.templateRecord?.template;
    final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
      template: template,
      answers: state.answers,
      notes: state.notes,
      signatures: state.signaturesByField,
      photoCounts: <String, int>{
        for (final MapEntry<String, List<ChecklistDraftPhoto>> entry
            in state.photosByField.entries)
          entry.key: entry.value.length,
      },
      templateRequiresSignature: state.templateRecord?.requireSignature,
      primarySignature: state.primarySignature,
      labelFor: (field) => fieldLabel(field, state.readLang),
      optionsFor: (field) => fieldOptionValues(field, template),
    );
    state = state.copyWith(submitGate: gate);
  }

  void _scheduleAutosave() {
    _autosaveTimer?.cancel();
    _autosaveTimer = Timer(const Duration(milliseconds: 400), () {
      unawaited(_saveHeader());
    });
  }

  Future<void> _saveHeader() async {
    final ChecklistFillState s = state;
    final String? draftKey = s.draftKey;
    final ChecklistTemplateRecord? templateRecord = s.templateRecord;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (draftKey == null || templateRecord == null || workspace == null) {
      return;
    }
    final ChecklistDraftRepository drafts = ref.read(
      checklistDraftRepositoryProvider,
    );
    final int total =
        templateRecord.template.fields.where((f) => f.type != 'section').length;
    final int filled = _countFilled(templateRecord, s.answers);
    final String workspaceId;
    try {
      workspaceId = workspaceIdFor(workspace);
    } on ArgumentError {
      // No resolvable workspace yet - an autosave tick must not crash the
      // screen over this; the next tick tries again.
      return;
    }
    await drafts.saveHeader(
      userId: workspace.userId,
      workspaceId: workspaceId,
      templateId: templateRecord.template.id ?? '',
      templateName: templateRecord.template.name ?? '',
      templateVersion: templateRecord.version,
      assetNo: s.assetNo ?? '',
      answers: s.answers,
      notes: s.notes,
      filled: filled,
      total: total,
      assignmentId: s.assignmentId,
      site: s.site,
      readLang: s.readLang,
      printedName: s.printedName,
    );
  }

  int _countFilled(
    ChecklistTemplateRecord templateRecord,
    Map<String, Object?> answers,
  ) {
    int count = 0;
    for (final field in templateRecord.template.fields) {
      if (field.type == 'section') continue;
      final Object? v = answers[field.id];
      final bool isFilled = v != null && v != '' && !(v is List && v.isEmpty);
      if (isFilled) count += 1;
    }
    return count;
  }

  // -- Submit ------------------------------------------------------------

  Future<bool> submit() async {
    final ChecklistFillState s = state;
    final ChecklistTemplateRecord? templateRecord = s.templateRecord;
    final String? draftKey = s.draftKey;
    final WorkspaceContext? workspace = ref.read(workspaceContextProvider);
    if (templateRecord == null || draftKey == null || workspace == null) {
      return false;
    }
    if (!(s.submitGate?.canSubmit ?? false)) return false;

    _autosaveTimer?.cancel();
    await _saveHeader();

    state = state.copyWith(phase: ChecklistFillPhase.submitting);

    final ChecklistSubmissionRepository submissions = ref.read(
      checklistSubmissionRepositoryProvider,
    );
    final int total =
        templateRecord.template.fields.where((f) => f.type != 'section').length;
    final int filled = _countFilled(templateRecord, s.answers);
    final int? scorePct = templateRecord.scored
        ? (total == 0 ? null : ((filled / total) * 100).round())
        : null;

    try {
      final ChecklistSubmissionResult result = await submissions.submit(
        workspace: workspace,
        templateRecord: templateRecord,
        draftKey: draftKey,
        answers: s.answers,
        notes: s.notes,
        assignmentId: s.assignmentId,
        assignmentPriorStatus: s.assignmentPriorStatus,
        site: s.site,
        assetNo: s.assetNo,
        title: templateRecord.template.name,
        printedName: s.printedName.trim().isEmpty ? null : s.printedName.trim(),
        scorePct: scorePct,
        scorePassed: templateRecord.passThreshold != null && scorePct != null
            ? scorePct >= templateRecord.passThreshold!
            : null,
      );
      state = state.copyWith(
        phase: ChecklistFillPhase.submitted,
        submissionId: result.submissionId,
      );
      return true;
    } on Object {
      state = state.copyWith(
        phase: ChecklistFillPhase.ready,
        failure: ChecklistFillFailure.saveFailed,
      );
      return false;
    }
  }
}

/// The narrow shape [ChecklistFillController.capturePhoto] needs back from
/// whatever capture mechanism the screen supplies - decoupling this
/// controller from `data/checklist_photo_capture.dart`'s concrete
/// `image_picker` dependency, matching the same seam
/// `ChecklistFieldAnswerTile.onCapturePhoto` establishes on the
/// presentation side.
class ChecklistDraftPhotoCaptureResult {
  const ChecklistDraftPhotoCaptureResult({
    required this.localPath,
    required this.capturedAt,
    this.sizeBytes,
  });

  final String localPath;
  final DateTime capturedAt;
  final int? sizeBytes;
}
