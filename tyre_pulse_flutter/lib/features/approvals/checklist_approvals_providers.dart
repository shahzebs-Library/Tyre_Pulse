/// Riverpod wiring for the checklist-approvals data layer.
///
/// This mirrors two existing precedents at once, because this feature sits
/// between them: `inspection_approvals_providers.dart`'s single plain
/// [Provider] over a `SupabaseClient`-backed repository (this feature needs
/// the same repository provider, for the same reason - the two screens in
/// `presentation/` hold their own local state and call the repository
/// directly, with no `Notifier` on top), and
/// `features/inspections/inspections_providers.dart`'s queue-plus-sync-
/// engine pair (this feature ALSO needs that shape, because unlike the
/// single-stage inspection approval flow - which decides synchronously
/// against `decide_inspection_approval` and never queues - a checklist
/// approval decision is written by a raw `.update()` through an
/// offline-safe queue, exactly as `mobile/lib/checklists.ts`'s own
/// `decideApproval` enqueues a `CHECKLIST_APPROVAL` command rather than
/// writing straight through).
///
/// [checklistApprovalDecisionQueueProvider] is real by default - like
/// [inspectionSubmissionQueueProvider], nothing needs overriding for it to
/// work on a real device, because `path_provider` resolves the same app
/// documents directory either way.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/core/network/supabase_client_provider.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_decision_queue.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_sync_engine.dart';

final Provider<ChecklistApprovalRepository>
checklistApprovalRepositoryProvider = Provider<ChecklistApprovalRepository>(
  (ref) =>
      SupabaseChecklistApprovalRepository(ref.watch(supabaseClientProvider)),
);

final Provider<ChecklistApprovalDecisionQueue>
checklistApprovalDecisionQueueProvider =
    Provider<ChecklistApprovalDecisionQueue>(
      (ref) => FileChecklistApprovalDecisionQueue(),
    );

final Provider<ChecklistApprovalSyncEngine>
checklistApprovalSyncEngineProvider = Provider<ChecklistApprovalSyncEngine>(
  (ref) => ChecklistApprovalSyncEngine(
    queue: ref.watch(checklistApprovalDecisionQueueProvider),
    repository: ref.watch(checklistApprovalRepositoryProvider),
  ),
);

/// Live count of not-yet-delivered queued checklist-approval decisions
/// (both `pending` and `blocked` count as "not yet synced" - see
/// [ChecklistApprovalDecisionQueue.pendingCount]'s own doc comment), for a
/// badge. Refreshed by whoever calls `ref.invalidate` after a queue
/// mutation, matching [inspectionPendingCountProvider]'s own polling-over-
/// watching choice.
final FutureProvider<int> checklistApprovalPendingCountProvider =
    FutureProvider<int>(
      (ref) => ref.watch(checklistApprovalDecisionQueueProvider).pendingCount(),
    );
