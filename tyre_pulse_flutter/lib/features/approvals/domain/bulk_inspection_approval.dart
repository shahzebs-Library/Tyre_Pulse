/// Approving several pending inspections in one press, each signed with the
/// approver's OWN saved signature (V601 `user_signatures`).
///
/// Mirrors the web bulk approve (`Approvals.jsx` `runBulk('approve')`, V602):
/// the same person signing each sheet is what a batch sign-off IS, and with no
/// saved signature nothing is approved at all - the server refuses an unsigned
/// approval anyway (V602), so asking first is honest rather than letting every
/// row fail one by one.
///
/// Bulk approve must never be looser than approving one inspection on its
/// review screen, so every row is re-read in full and put through the SAME
/// tyre-evidence rule ([inspectionTyreEvidenceAllowsApproval]) before it is
/// decided. A row that fails it is SKIPPED and reported, never approved.
library;

import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';

/// The tyre-evidence rule the single-inspection Approve button applies.
///
/// Unknown and foreign legacy layouts stay approvable (the shared engine
/// refuses to invent a wheel count for them); a known, matched layout is
/// approvable only when every expected wheel has deliberate evidence.
bool inspectionTyreEvidenceAllowsApproval(InspectionApprovalItem item) {
  final List<TyreEntryPair> entries = readTyreEntries(item.tyreConditions);
  final TyreCompletenessResult result = tyreCompleteness(
    item.vehicleType,
    item.assetNo,
    <String, Map<String, Object?>>{
      for (final TyreEntryPair pair in entries) pair.key: pair.entry,
    },
    const TyreCompletenessOptions(requireEvidence: true),
  );
  return !result.applicable || !result.known || !result.matched || result.ok;
}

/// What a bulk approve did, per row. Every row lands in exactly one list.
final class BulkInspectionApprovalOutcome {
  const BulkInspectionApprovalOutcome({
    required this.approved,
    required this.skippedIncomplete,
    required this.alreadyDecided,
    required this.failed,
  });

  final List<String> approved;

  /// Tyre evidence incomplete: needs opening and returning for correction.
  final List<String> skippedIncomplete;

  /// No longer pending when re-read (someone else decided it meanwhile).
  final List<String> alreadyDecided;

  /// The read or the decision itself failed.
  final List<String> failed;

  int get total =>
      approved.length +
      skippedIncomplete.length +
      alreadyDecided.length +
      failed.length;
}

/// Approves [inspectionIds] one after another with [signature].
///
/// Sequential on purpose: every decision fires notification triggers, and
/// each row is individually permissioned and individually stateful, so a
/// partial result is the NORMAL case and is reported row by row.
Future<BulkInspectionApprovalOutcome> bulkApproveInspections({
  required InspectionApprovalRepository repository,
  required List<String> inspectionIds,
  required String signature,
  String? approverName,
  void Function(int done, int total)? onProgress,
}) async {
  final List<String> approved = <String>[];
  final List<String> skipped = <String>[];
  final List<String> decided = <String>[];
  final List<String> failed = <String>[];
  final List<String> ids = inspectionIds.toSet().toList(growable: false);

  for (int i = 0; i < ids.length; i++) {
    final String id = ids[i];
    try {
      final InspectionApprovalItem? item = await repository.byId(id);
      if (item == null) {
        failed.add(id);
      } else if (!item.isPending) {
        decided.add(id);
      } else if (!inspectionTyreEvidenceAllowsApproval(item)) {
        skipped.add(id);
      } else {
        await repository.decide(
          InspectionApprovalDecision(
            inspectionId: id,
            approved: true,
            approverSignature: signature,
            approverName: approverName,
            existingNotes: item.notes,
          ),
        );
        approved.add(id);
      }
    } on Object {
      failed.add(id);
    }
    onProgress?.call(i + 1, ids.length);
  }

  return BulkInspectionApprovalOutcome(
    approved: approved,
    skippedIncomplete: skipped,
    alreadyDecided: decided,
    failed: failed,
  );
}
