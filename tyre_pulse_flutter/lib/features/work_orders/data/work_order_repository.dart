/// Maintenance job cards over the real `work_orders` table.
///
/// Ported from `mobile/app/(app)/work-orders.tsx` (`mobile/` is READ-ONLY
/// reference material - see `AGENTS.md`). See
/// `domain/work_order_status.dart`'s own library comment for why this is
/// the ONE "work orders" feature this port builds, and not
/// `workorders/index.tsx` (a different screen, over `corrective_actions`,
/// deliberately out of scope here).
///
/// # Reads go direct to Supabase; the write routes through the offline
/// # command queue
///
/// Mirrors `features/washing/data/wash_repository.dart`'s and
/// `features/meter_logs/data/meter_log_repository.dart`'s own established
/// split for exactly the same reason those files give: org/country/site
/// RLS enforces the read boundary server side, and every WRITE goes
/// through `QueuedCommandRepository` (`CommandType.workOrder` for a new
/// job card, `CommandType.workOrderStatus` for an advance) so a job logged
/// or advanced with no signal is never lost. `QueuedCommandRepository
/// .enqueue` never attempts an online write first - see those two files'
/// own library comments - so this port cannot honestly reproduce the
/// reference screen's synchronous online/offline `res.offline` outcome
/// either; both [create] and [advanceStatus] report a single "queued"
/// outcome, matching this codebase's own established convention rather
/// than the reference's dual-path one.
///
/// # No realtime subscription
///
/// `work-orders.tsx` also opens a Postgres realtime channel on
/// `work_orders` and reloads on any change (`useRealtime('work_orders',
/// load)`). No feature anywhere in this Flutter port opens a realtime
/// channel yet - every comparable list/queue screen already built here
/// (`InspectionApprovalsQueueScreen`, `ChecklistApprovalsQueueScreen`)
/// reloads via an initial fetch plus pull-to-refresh
/// (`RefreshIndicator`), with no realtime wiring at all. Building a
/// bespoke realtime channel for this one feature, with no shared
/// connection-lifecycle infrastructure to reuse, would be INVENTING a
/// pattern rather than reusing one - the opposite of this port's own
/// convention. [WorkOrdersListScreen] therefore follows the SAME
/// established pull-to-refresh convention as its closest analogues, and
/// this is a disclosed, deliberate divergence from the reference, not an
/// oversight.
///
/// # `work_order_no` is minted client-side, and NOT the way the reference
/// # does it
///
/// The reference mints `` `WO-${Date.now().toString().slice(-8)}` `` - the
/// last eight digits of the current millisecond epoch timestamp. That
/// value repeats every 10^8 ms (about 27 hours 47 minutes), so any two
/// work orders created anywhere in the whole fleet - on any device, by any
/// user - a whole-number multiple of that interval apart collide exactly.
/// `work_orders.work_order_no` carries a GLOBAL unique constraint
/// (`work_orders_work_order_no_key`, per this repository's own
/// PROJECT_MEMORY), and because this is a QUEUED insert the collision
/// would surface as a permanent 23505 sync failure discovered long after
/// the person who logged the job has moved on, with no way to retry the
/// same payload into success. [_mintWorkOrderNo] instead follows this
/// codebase's own already-established convention for minting a fresh,
/// short, human-readable code -
/// `MeterLogRepository._freshSuffix`/`SupabaseWashRepository`'s own
/// `_uuid.v4().substring(0, 8)` pattern, itself chosen there to match the
/// SHAPE of the reference's own `safeUuid().slice(0, 8)` fallback. Eight
/// hex characters is 32 bits of entropy - collision risk across this
/// fleet's entire lifetime of work orders is negligible next to a value
/// that provably repeats every 27-odd hours. The visible `WO-` prefix
/// convention is kept; only the part after it changes shape, and it is
/// upper-cased to read like this fleet's other short codes (asset numbers
/// such as `TM514`).
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/sync/sync_engine.dart'
    show expectedPriorStatusPayloadKey;
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';
import 'package:tyre_pulse/features/work_orders/domain/work_order_status.dart';
import 'package:uuid/uuid.dart';

/// The `.or(...)` filter that scopes the list to [country], or `null` when
/// the whole list should be read unfiltered.
///
/// #mirror: `work-orders.tsx`'s own `if (profile?.country) q =
/// q.or('country.eq.${profile.country},country.is.null')`. Mirrors
/// `inspectionApprovalCountryFilter`'s own reasoning
/// (`features/approvals/data/inspection_approval_repository.dart`)
/// verbatim: a null row `country` is visible to everyone under the
/// RESTRICTIVE country RLS policy - `core/workspace/workspace_context.dart`'s
/// own library comment records that a strict `.eq` on THIS EXACT TABLE
/// once hid 55,606 country-less job cards from every country view - so a
/// user scoped to no single country (or to several) must see the whole
/// list, never an empty one. `'All'` is also treated as "no filter",
/// matching `inspectionApprovalCountryFilter`'s own defensive check for
/// the same upstream sentinel.
String? workOrderCountryFilter(String? country) {
  final String trimmed = country?.trim() ?? '';
  if (trimmed.isEmpty || trimmed == 'All') return null;
  return 'country.eq.$trimmed,country.is.null';
}

/// What a caller supplies to [WorkOrderRepository.create].
final class CreateWorkOrderInput {
  const CreateWorkOrderInput({
    required this.assetNo,
    this.workType,
    this.priority,
    this.description,
  });

  final String assetNo;

  /// One of [kWorkOrderWorkTypes]. Falls back to
  /// [kWorkOrderDefaultWorkType] when blank, mirroring the reference
  /// form's own `useState('Tyre Change')` default.
  final String? workType;

  /// One of [kWorkOrderPriorities]. Falls back to
  /// [kWorkOrderDefaultPriority] when blank, mirroring the reference form's
  /// own `useState('Medium')` default.
  final String? priority;

  final String? description;
}

String? _trimmedOrNull(String? raw) {
  final String trimmed = raw?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}

/// The narrow surface this feature needs from Supabase. Abstract so both
/// screens can be tested against a fake, mirroring every other feature's
/// own `XRepository`/`SupabaseXRepository` split in this codebase.
abstract interface class WorkOrderRepository {
  /// Work orders, newest first, bounded to [limit] (matches the reference's
  /// own `.limit(300)` - a live shift board, never an unbounded fleet-wide
  /// read).
  Future<List<WorkOrderItem>> listRecent({String? country, int limit = 300});

  /// One work order in full, for the detail screen. `null` when the id
  /// does not exist, or is not readable under RLS - see
  /// `routes.dart`'s own [WorkOrderDetailRoute] doc comment on why this
  /// screen must be able to stand alone: a notification can push straight
  /// to it with no list ever having been loaded first.
  Future<WorkOrderItem?> byId(String id);

  /// Logs a new work order for [workspace]. Never throws for an ordinary
  /// offline condition, for the same reason
  /// `WashRepository.submitWash`/`MeterLogRepository.submitMeterReading`
  /// do not - the write is queued locally, not attempted online first.
  /// Returns the set of payload keys this command's field allow-list
  /// dropped (see `EnqueueResult.droppedFields`'s own doc comment) - empty
  /// on an ordinary submission.
  Future<Set<String>> create({
    required WorkspaceContext workspace,
    required CreateWorkOrderInput input,
  });

  /// Advances [current] one step along the status ladder
  /// (`domain/work_order_status.dart`'s [nextWorkOrderStatus]). Returns
  /// `null` when [current] has nothing further to advance to - the caller
  /// should not have offered the action in that case, and this is the
  /// honest "there was nothing to do" answer rather than an empty set that
  /// would read as "advanced, and nothing was dropped".
  ///
  /// # A known, disclosed gap in shared infrastructure
  ///
  /// This queues `CommandType.workOrderStatus`, which
  /// `core/sync/command_registry.dart` marks
  /// `requiresOptimisticStatusMatch: true` precisely so a status change
  /// made elsewhere while this device was offline can never be silently
  /// overwritten - the sync engine is meant to add `.eq('status',
  /// expectedPriorStatus)` to the push and treat a zero-row result as a
  /// stale conflict. That mechanism reads the expected prior status back
  /// out of the CLAIMED command's payload under the key
  /// [expectedPriorStatusPayloadKey] (`'_expectedPriorStatus'`,
  /// `core/sync/sync_engine.dart`) - but
  /// `CommandRegistry.specFor(CommandType.workOrderStatus).fieldAllowList`
  /// is `{'id','status','started_at','completed_at'}`, which does NOT
  /// include that key. `QueuedCommandRepository.enqueue` filters every
  /// payload down to a command's own allow-list before it is stored, so
  /// this key is silently dropped at enqueue time, and every later attempt
  /// to push the command fails PERMANENTLY with "This update is missing
  /// the information needed to avoid overwriting a change made elsewhere".
  ///
  /// This is the EXACT gap
  /// `features/checklists/data/checklist_submission_repository.dart`
  /// already discloses, in identical terms, for the sibling command
  /// `CommandType.checklistAssignmentStatus` - whose field allow-list has
  /// the same shape of omission. That file's own resolution is the
  /// precedent this method follows: send the payload with
  /// [expectedPriorStatusPayloadKey] populated CORRECTLY, per the intended
  /// contract, so the day `command_registry.dart` gains the missing entry
  /// this call starts succeeding with no further change here - rather than
  /// omitting the key (which would be wrong regardless of the registry
  /// bug) or inventing a second, non-standard way to carry it. Unlike the
  /// checklist case, this write is NOT a best-effort side effect of an
  /// already-successful primary action - advancing a work order's status
  /// IS the whole point of calling this method - so [WorkOrderDetailScreen]
  /// and [WorkOrdersListScreen] present the queued state honestly (a
  /// device-local "saved offline" outcome, exactly like every other queued
  /// write in this codebase) rather than a false claim that the server has
  /// accepted the new status. Fixing `command_registry.dart` itself is
  /// outside this feature's remit - that file's own header states it is
  /// the ONE place a table name/allow-list may be declared, shared by
  /// every feature, and changing it correctly needs the same
  /// cross-cutting verification `checklist_submission_repository.dart`'s
  /// library comment says it was out of scope for that phase to do either.
  Future<Set<String>?> advanceStatus({
    required WorkspaceContext workspace,
    required WorkOrderItem current,
  });

  /// The signed-in user's display name (`full_name` else `username`),
  /// stored as `work_orders.technician_name` on create - mirroring the
  /// reference's own `profile?.full_name ?? profile?.username ?? null`.
  /// Best-effort: returns `null` on any failure or when nothing is found,
  /// the SAME contract every sibling feature's own copy of this method
  /// already establishes (`InspectionApprovalRepository`,
  /// `SupabaseWashRepository`) over the same `profiles` columns - a
  /// missing display name must never block logging a job.
  Future<String?> currentUserDisplayName(String userId);
}

final class SupabaseWorkOrderRepository
    with SupabaseGateway
    implements WorkOrderRepository {
  SupabaseWorkOrderRepository(this._client, this._commands);

  final SupabaseClient _client;
  final QueuedCommandRepository _commands;

  static const Uuid _uuid = Uuid();

  @override
  Future<List<WorkOrderItem>> listRecent({
    String? country,
    int limit = 300,
  }) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(() async {
      var query =
          _client.from(SupabaseTables.workOrders).select(workOrderListColumns);
      final String? filter = workOrderCountryFilter(country);
      if (filter != null) {
        query = query.or(filter);
      }
      return await query.order('opened_at', ascending: false).limit(limit)
          as List<Map<String, dynamic>>;
    });
    return <WorkOrderItem>[
      for (final Map<String, dynamic> row in rows) WorkOrderItem.fromRow(row),
    ];
  }

  @override
  Future<WorkOrderItem?> byId(String id) async {
    final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
      () => _client
          .from(SupabaseTables.workOrders)
          .select(workOrderDetailColumns)
          .eq('id', id)
          .maybeSingle(),
    );
    if (row == null) return null;
    return WorkOrderItem.fromRow(row);
  }

  @override
  Future<Set<String>> create({
    required WorkspaceContext workspace,
    required CreateWorkOrderInput input,
  }) async {
    final String asset = input.assetNo.trim();
    final String workType =
        _trimmedOrNull(input.workType) ?? kWorkOrderDefaultWorkType;
    final String priority =
        _trimmedOrNull(input.priority) ?? kWorkOrderDefaultPriority;
    final DateTime now = DateTime.now();

    final String? technicianName = await currentUserDisplayName(
      workspace.userId,
    );

    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.workOrder,
      payload: <String, Object?>{
        'work_order_no': _mintWorkOrderNo(),
        'asset_no': asset,
        'work_type': workType,
        'priority': priority,
        'description': _trimmedOrNull(input.description),
        'status': kWorkOrderInitialStatus,
        'site': workspace.legacySite,
        'country': workspace.activeCountry,
        'technician_name': technicianName,
        'opened_at': now.toIso8601String(),
        'created_by': workspace.userId,
      },
      workspace: workspace,
      now: now,
      country: workspace.activeCountry,
    );

    return result.droppedFields;
  }

  @override
  Future<Set<String>?> advanceStatus({
    required WorkspaceContext workspace,
    required WorkOrderItem current,
  }) async {
    final String? next = nextWorkOrderStatus(current.status);
    if (next == null) return null;

    final DateTime now = DateTime.now();
    final String nowIso = now.toIso8601String();
    final Map<String, Object?> payload = <String, Object?>{
      'id': current.id,
      'status': next,
      if (next == kWorkOrderStatusInProgress) 'started_at': nowIso,
      if (next == kWorkOrderStatusCompleted) 'completed_at': nowIso,
      // See [advanceStatus]'s own doc comment: this key is correct per the
      // command's intended contract even though the shared registry
      // currently drops it before it can reach the sync engine.
      expectedPriorStatusPayloadKey:
          _trimmedOrNull(current.status) ?? kWorkOrderInitialStatus,
    };

    final EnqueueResult result = await _commands.enqueue(
      type: CommandType.workOrderStatus,
      payload: payload,
      workspace: workspace,
      now: now,
      entityId: current.id,
      country: workspace.activeCountry ?? current.country,
    );

    return result.droppedFields;
  }

  @override
  Future<String?> currentUserDisplayName(String userId) async {
    if (userId.isEmpty) return null;
    try {
      final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
        () => _client
            .from(SupabaseTables.profiles)
            .select('full_name,username')
            .eq('id', userId)
            .maybeSingle(),
      );
      if (row == null) return null;
      final String full =
          (row['full_name'] as Object?)?.toString().trim() ?? '';
      if (full.isNotEmpty) return full;
      final String username =
          (row['username'] as Object?)?.toString().trim() ?? '';
      return username.isEmpty ? null : username;
    } on Object {
      return null;
    }
  }

  /// See the library comment on why this replaces the reference's own
  /// millisecond-timestamp scheme.
  static String _mintWorkOrderNo() =>
      'WO-${_uuid.v4().substring(0, 8).toUpperCase()}';
}
