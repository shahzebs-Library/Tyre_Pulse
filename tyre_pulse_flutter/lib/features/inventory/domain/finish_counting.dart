/// When the counter may end counting on an audit.
///
/// Mirrors the server rule in `inv_audit_complete_counting`
/// (docs/inventory/10 section 4): counting can only end while the audit is
/// `in_progress` or `recount`. The phone adds one rule the server cannot
/// know: lines still on THIS phone. Ending counting with unsent lines would
/// strand them - a late line is accepted only when it was counted before
/// `counting_completed_at`, and nothing would send it afterwards - so the
/// phone refuses until every line is on the server.
library;

import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';

/// Audit statuses in which counting can be ended.
const Set<String> finishableAuditStatuses = <String>{'in_progress', 'recount'};

enum FinishGate {
  /// Counting can be ended now (still needs a connection).
  allowed,

  /// The audit is not in a counting status (assigned, already completed...).
  notOpen,

  /// Lines on this phone have not reached the server yet.
  unsentLines,
}

/// True when the screen should offer "Finish counting" at all.
bool offersFinishCounting(InventoryAuditSummary audit) =>
    finishableAuditStatuses.contains(audit.status);

/// Whether [session] on [audit] may end counting right now.
FinishGate finishCountingGate({
  required InventoryAuditSummary audit,
  required CountSession? session,
}) {
  if (!offersFinishCounting(audit)) return FinishGate.notOpen;
  if (session != null && session.pending.isNotEmpty) {
    return FinishGate.unsentLines;
  }
  return FinishGate.allowed;
}
