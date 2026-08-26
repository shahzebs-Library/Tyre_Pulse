/// [historyBucket] and [submissionReference] - the coarse "which pile does
/// this submission belong in" and "how do I refer to it" facts a checklist
/// HISTORY list needs, alongside the ladder in `checklist_approval.dart`.
///
/// Ported from `mobile/lib/checklists.ts` (`historyStateOf` and
/// `submissionReference`) - a DIFFERENT source file in the read-only
/// `mobile/` tree than `checklistApproval.ts`, called out separately here
/// (and kept in its own file) so a reader checking this port against its
/// source knows exactly which one to open, rather than assuming everything
/// in this folder mirrors the one approval-ladder file. Both functions are
/// exercised by parity artifact 08 section 10 group M, cases M3-M5.
///
/// Pure Dart only. The only import is the sibling mirror file, for
/// [ApprovalStage] and [ApprovalSubmissionLike] - see
/// `checklist_approval.dart`'s library comment for why nothing else is
/// pulled in.
library;

import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

/// The buckets a checklist HISTORY list filters by - deliberately coarser
/// than `approval_status`: both waiting rungs are one bucket here, because
/// "is this sheet waiting on somebody" is the useful FILTER, while
/// [statusSummary]'s text is the useful LABEL naming which rung it is
/// waiting on. #mirror: `HistoryState` (TS union type).
enum HistoryBucket {
  /// Waiting on either rung - [ApprovalStage.supervisor] or
  /// [ApprovalStage.areaManager].
  waiting,

  /// `'approved'`.
  closed,

  /// `'rejected'`.
  sentBack,

  /// `'not_required'`, unset, or any value this engine does not
  /// recognise. An unrecognised status must never read as [closed] - it is
  /// exactly as safe to treat it as "no approval outstanding" as it is to
  /// treat a genuinely blank one that way.
  noApproval,
}

/// Which [HistoryBucket] [submission] falls into, for a filter chip.
/// #mirror: `historyStateOf`.
HistoryBucket historyBucket(ApprovalSubmissionLike? submission) {
  final String status = submission?.approvalStatus ?? '';
  if (status == 'approved') return HistoryBucket.closed;
  if (status == 'rejected') return HistoryBucket.sentBack;
  if (status == 'pending' || status == 'pending_area_manager') {
    return HistoryBucket.waiting;
  }
  return HistoryBucket.noApproval;
}

/// The sheet's human-facing reference, or `null` when none has ever been
/// minted (or when the stored value is blank/whitespace-only).
///
/// This ONLY reads an already-stored `document_no` and normalises a blank
/// string to `null`, so a caller can say "not numbered" instead of
/// rendering empty text where an identity should be - it never generates,
/// guesses, or sends a document number. Minting one is exclusively a
/// server-side concern (`stamp_checklist_document_no`, a `BEFORE INSERT`
/// trigger keyed on a per-organisation/prefix/asset/year counter) and has
/// no business in this library at all. #mirror: `submissionReference`.
String? submissionReference(String? documentNo) {
  final String value = (documentNo ?? '').trim();
  return value.isEmpty ? null : value;
}
