/// One row on the "My Inspections" scoped history surface: the unified
/// view over three genuinely different sources of truth this feature has
/// to merge, because a field worker fundamentally needs one list that
/// answers "what have I done and what is still waiting", not three.
///
/// # Why this exists, and what it deliberately does not do
///
/// `docs/flutter-migration/01-feature-inventory.md` section 2.11 records
/// `app/(app)/history.tsx` as "Merged view of queued and synced
/// inspections... Admin-only" and nests `InspectionDetailRoute` under
/// `/history` because "History is the only screen that opens it" -
/// production's own generic history screen. This port's own task brief is
/// explicit that a GENERIC, multi-feature activity history (spanning
/// checklists, work orders, accidents - not just inspections) is a LATER
/// phase's job, reached through `RouteModule.history` /
/// `TpRouteId.activityHistory`, which nothing in this feature registers a
/// screen for. What IS in scope here, and what this type models, is
/// narrower: an inspector's own inspections - completed and still
/// syncing - so they can see what has and has not reached the server
/// regardless of whether the generic cross-feature screen exists yet.
/// [InspectionHistorySource] is what lets a single list mix rows from
/// both origins without either origin's repository knowing about the
/// other.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';

/// Where one row came from.
enum InspectionHistorySource {
  /// Sitting in [InspectionSubmissionQueue], not yet confirmed by the
  /// server.
  queued,

  /// A confirmed `inspections` row, read from Supabase.
  synced,
}

@immutable
class InspectionHistoryEntry {
  const InspectionHistoryEntry({
    required this.source,
    required this.id,
    required this.assetNo,
    required this.site,
    required this.inspectionDate,
    required this.updatedAt,
    this.approvalStatus,
    this.queueStatus,
    this.queueError,
    this.recordId,
  });

  factory InspectionHistoryEntry.fromQueued(QueuedInspection q) {
    return InspectionHistoryEntry(
      source: InspectionHistorySource.queued,
      id: q.id,
      assetNo: q.payload.assetNo,
      site: q.payload.site,
      inspectionDate: q.payload.inspectionDate,
      updatedAt: q.syncedAt ?? q.createdAt,
      approvalStatus: q.payload.approvalStatus,
      queueStatus: q.status,
      queueError: q.error,
    );
  }

  final InspectionHistorySource source;

  /// For [InspectionHistorySource.queued], the queue entry's own id
  /// (the client-generated idempotency key). For
  /// [InspectionHistorySource.synced], the server row's `id`. This is
  /// deliberately the SAME field with two different meanings by source,
  /// rather than two nullable fields, because exactly one is ever
  /// populated and every caller already has to branch on [source] to
  /// interpret the row at all.
  final String id;

  /// For a synced row, the underlying server row id - kept SEPARATE from
  /// [id] only so a caller that already has [source] == synced never has
  /// to remember that [id] doubles as it. Null for a queued row.
  final String? recordId;

  final String assetNo;
  final String site;
  final DateTime inspectionDate;

  /// Newest-activity timestamp, for sorting: `syncedAt` when a queued item
  /// has one, else its `createdAt`; the server's own timestamp for a
  /// synced row.
  final DateTime updatedAt;

  final String? approvalStatus;

  /// Set only for [InspectionHistorySource.queued].
  final InspectionQueueStatus? queueStatus;
  final String? queueError;

  bool get isLocalOnly => source == InspectionHistorySource.queued;

  bool get needsAttention =>
      source == InspectionHistorySource.queued &&
      queueStatus == InspectionQueueStatus.failed;
}

/// Sorts newest-activity-first. The one place this ordering is decided, so
/// the presentation layer never re-derives it.
List<InspectionHistoryEntry> sortInspectionHistory(
  List<InspectionHistoryEntry> entries,
) {
  final List<InspectionHistoryEntry> sorted = List<InspectionHistoryEntry>.of(
    entries,
  );
  sorted.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  return sorted;
}
