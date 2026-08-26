/// The coarse bucket a checklist HISTORY list filters by, and the plain
/// search/filter helpers that list needs.
///
/// Mirrors `historyStateOf` / `matchesHistorySearch` / `filterHistory` /
/// `historyTemplateOptions` at `mobile/lib/checklists.ts:656-736` (`mobile/`
/// is read-only reference material).
///
/// # Why this duplicates a shape [HistoryBucket] in `lib/features/approvals/`
/// # already expresses, instead of importing it
///
/// `lib/features/approvals/domain/checklist_approval_history.dart` already
/// has a `HistoryBucket` enum with the identical four values, computed from
/// the identical `approval_status` string. This file does not import it.
/// `lib/features/approvals/` is a separate, already-complete feature this
/// port's brief is explicit must never be imported from
/// `lib/features/checklists/` - "no other feature's domain (in particular,
/// never `lib/features/checklists/`)" is that file's own stated boundary,
/// and it runs in both directions: this feature does not reach into that one
/// either. So the four-way classification is re-expressed here, narrowly,
/// from the same `approval_status` vocabulary
/// (`not_required`/`pending`/`pending_area_manager`/`approved`/`rejected`)
/// rather than shared - a small, deliberate duplication forced by a hard
/// module boundary, not an oversight.
library;

/// The buckets a checklist HISTORY list filters by - deliberately coarser
/// than `approval_status`: both waiting rungs are one bucket here.
enum ChecklistHistoryState {
  /// `pending` or `pending_area_manager`.
  waiting,

  /// `approved`.
  closed,

  /// `rejected`.
  sentBack,

  /// `not_required`, unset, or anything this engine does not recognise.
  noApproval,
}

/// Which [ChecklistHistoryState] an `approval_status` value falls into.
ChecklistHistoryState checklistHistoryStateOf(String? approvalStatus) {
  final String status = approvalStatus ?? '';
  if (status == 'approved') return ChecklistHistoryState.closed;
  if (status == 'rejected') return ChecklistHistoryState.sentBack;
  if (status == 'pending' || status == 'pending_area_manager') {
    return ChecklistHistoryState.waiting;
  }
  return ChecklistHistoryState.noApproval;
}

/// One row a history list can filter/search over. Kept minimal and
/// presentation-agnostic on purpose - a real repository row adapts into this
/// shape rather than this file depending on that row's own type.
final class ChecklistHistorySearchRow {
  const ChecklistHistorySearchRow({
    this.documentNo,
    this.templateName,
    this.title,
    this.assetNo,
    this.site,
  });

  final String? documentNo;
  final String? templateName;
  final String? title;
  final String? assetNo;
  final String? site;
}

/// Case-insensitive match over the fields a history row actually shows.
/// Mirrors `matchesHistorySearch`.
bool matchesChecklistHistorySearch(
  ChecklistHistorySearchRow row,
  String term,
) {
  final String q = term.trim().toLowerCase();
  if (q.isEmpty) return true;
  for (final String? v in <String?>[
    row.documentNo,
    row.templateName,
    row.title,
    row.assetNo,
    row.site,
  ]) {
    if ((v ?? '').toLowerCase().contains(q)) return true;
  }
  return false;
}
