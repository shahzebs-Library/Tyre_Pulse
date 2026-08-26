/// The fill screen's state: what is loaded, what has been answered, and
/// whether it may be submitted right now.
library;

import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_repository.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_submit_gate.dart';

enum ChecklistFillPhase { loading, ready, error, submitting, submitted }

class ChecklistFillState {
  const ChecklistFillState({
    this.phase = ChecklistFillPhase.loading,
    this.templateRecord,
    this.draftKey,
    this.assignmentId,
    this.assignmentPriorStatus,
    this.answers = const <String, Object?>{},
    this.notes = const <String, Object?>{},
    this.photosByField = const <String, List<ChecklistDraftPhoto>>{},
    this.signaturesByField = const <String, String>{},
    this.primarySignature,
    this.printedName = '',
    this.siteOptions = const <String>[],
    this.site,
    this.assetNo,
    this.readLang = 'en',
    this.lastSubmissionWarning,
    this.errorMessage,
    this.submitGate,
    this.submissionId,
  });

  final ChecklistFillPhase phase;
  final ChecklistTemplateRecord? templateRecord;

  /// The device-local draft key this session is saving to. `null` only
  /// before the very first load completes.
  final String? draftKey;

  final String? assignmentId;

  /// The assignment's status as read at LOAD time - carried through to the
  /// submission repository's optimistic-match payload. See
  /// `checklist_submission_repository.dart`'s own library comment on why
  /// this is currently unable to reach the server, and why that must never
  /// be allowed to affect submission itself.
  final String? assignmentPriorStatus;

  final Map<String, Object?> answers;
  final Map<String, Object?> notes;

  /// Photos currently attached, keyed by field id.
  final Map<String, List<ChecklistDraftPhoto>> photosByField;

  /// Captured signatures, keyed by field id (never the template-level pad -
  /// see [primarySignature]).
  final Map<String, String> signaturesByField;

  /// The template-level pad's signature, if this template requires one and
  /// it has been drawn.
  final String? primarySignature;

  final String printedName;
  final List<String> siteOptions;
  final String? site;
  final String? assetNo;

  /// The checklist CONTENT language currently selected for display - a
  /// different axis from the app's own UI language. See
  /// `checklist_i18n.dart`'s library comment.
  final String readLang;

  final ChecklistLastSubmissionInfo? lastSubmissionWarning;
  final String? errorMessage;
  final ChecklistSubmitGate? submitGate;

  /// Set once [phase] reaches [ChecklistFillPhase.submitted].
  final String? submissionId;

  bool get isLoading => phase == ChecklistFillPhase.loading;

  bool get canSubmit =>
      phase == ChecklistFillPhase.ready && (submitGate?.canSubmit ?? false);

  ChecklistFillState copyWith({
    ChecklistFillPhase? phase,
    ChecklistTemplateRecord? templateRecord,
    String? draftKey,
    String? assignmentId,
    String? assignmentPriorStatus,
    Map<String, Object?>? answers,
    Map<String, Object?>? notes,
    Map<String, List<ChecklistDraftPhoto>>? photosByField,
    Map<String, String>? signaturesByField,
    Object? primarySignature = _unset,
    String? printedName,
    List<String>? siteOptions,
    Object? site = _unset,
    Object? assetNo = _unset,
    String? readLang,
    Object? lastSubmissionWarning = _unset,
    Object? errorMessage = _unset,
    Object? submitGate = _unset,
    Object? submissionId = _unset,
  }) {
    return ChecklistFillState(
      phase: phase ?? this.phase,
      templateRecord: templateRecord ?? this.templateRecord,
      draftKey: draftKey ?? this.draftKey,
      assignmentId: assignmentId ?? this.assignmentId,
      assignmentPriorStatus: assignmentPriorStatus ?? this.assignmentPriorStatus,
      answers: answers ?? this.answers,
      notes: notes ?? this.notes,
      photosByField: photosByField ?? this.photosByField,
      signaturesByField: signaturesByField ?? this.signaturesByField,
      primarySignature: identical(primarySignature, _unset)
          ? this.primarySignature
          : primarySignature as String?,
      printedName: printedName ?? this.printedName,
      siteOptions: siteOptions ?? this.siteOptions,
      site: identical(site, _unset) ? this.site : site as String?,
      assetNo: identical(assetNo, _unset) ? this.assetNo : assetNo as String?,
      readLang: readLang ?? this.readLang,
      lastSubmissionWarning: identical(lastSubmissionWarning, _unset)
          ? this.lastSubmissionWarning
          : lastSubmissionWarning as ChecklistLastSubmissionInfo?,
      errorMessage: identical(errorMessage, _unset)
          ? this.errorMessage
          : errorMessage as String?,
      submitGate: identical(submitGate, _unset)
          ? this.submitGate
          : submitGate as ChecklistSubmitGate?,
      submissionId: identical(submissionId, _unset)
          ? this.submissionId
          : submissionId as String?,
    );
  }
}

/// Sentinel distinguishing "not supplied" from "explicitly set to null" on
/// [ChecklistFillState.copyWith]'s nullable fields.
const Object _unset = Object();
