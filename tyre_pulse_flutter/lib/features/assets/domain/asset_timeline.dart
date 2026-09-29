/// The Vehicle 360 timeline: one asset's recorded history, newest first.
///
/// Pure. Every event is decoded from a real row of a real table:
///
/// | kind | table | date column |
/// |---|---|---|
/// | [AssetTimelineKind.workOrder] | `work_orders` | `opened_at` |
/// | [AssetTimelineKind.inspection] | `inspections` | `inspection_date` |
/// | [AssetTimelineKind.wash] | `wash_records` | `wash_date` |
/// | [AssetTimelineKind.tyreFitted] | `tyre_records` | `issue_date` |
/// | [AssetTimelineKind.tyreRemoved] | `tyre_records` | `removal_date` |
/// | [AssetTimelineKind.accident] | `accidents` | `incident_date` |
///
/// A row without a usable date is dropped rather than dated "today".
library;

import 'package:flutter/foundation.dart' show immutable;
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart';

enum AssetTimelineKind {
  workOrder,
  inspection,
  wash,
  tyreFitted,
  tyreRemoved,
  accident,
}

/// The "All events" filter's other choices. Tyre fitted and removed share
/// one filter.
enum AssetTimelineFilter {
  all,
  workOrders,
  inspections,
  washes,
  tyres,
  accidents
}

@immutable
class AssetTimelineEvent {
  const AssetTimelineEvent({
    required this.kind,
    required this.date,
    this.recordId,
    this.reference,
    this.status,
    this.detail,
    this.person,
    this.photoCount,
    this.description,
    this.hours,
  });

  final AssetTimelineKind kind;
  final DateTime date;

  /// The row id, when the event opens a detail screen.
  final String? recordId;

  /// Work order no., inspection document no., accident reference, tyre
  /// serial.
  final String? reference;
  final String? status;

  /// Work type, wash type, tyre position, accident type.
  final String? detail;

  /// Inspector, washed by, technician.
  final String? person;
  final int? photoCount;

  /// The work order's own free-text description, used as the row title when
  /// present ("High-priority hydraulic issue reported"). Null otherwise.
  final String? description;

  /// `work_orders.breakdown_hours`, positive values only.
  final double? hours;

  bool matches(AssetTimelineFilter filter) => switch (filter) {
        AssetTimelineFilter.all => true,
        AssetTimelineFilter.workOrders => kind == AssetTimelineKind.workOrder,
        AssetTimelineFilter.inspections => kind == AssetTimelineKind.inspection,
        AssetTimelineFilter.washes => kind == AssetTimelineKind.wash,
        AssetTimelineFilter.tyres => kind == AssetTimelineKind.tyreFitted ||
            kind == AssetTimelineKind.tyreRemoved,
        AssetTimelineFilter.accidents => kind == AssetTimelineKind.accident,
      };

  static AssetTimelineEvent? workOrder(Map<String, dynamic> row) {
    final DateTime? date =
        parseAssetDate(row['opened_at']) ?? parseAssetDate(row['created_at']);
    if (date == null) return null;
    return AssetTimelineEvent(
      kind: AssetTimelineKind.workOrder,
      date: date,
      recordId: _s(row['id']),
      reference: _s(row['work_order_no']),
      status: _s(row['status']),
      detail: _s(row['work_type']),
      description: _s(row['description']),
      person: _s(row['technician_name']),
      hours: _positive(row['breakdown_hours']),
    );
  }

  static AssetTimelineEvent? inspection(Map<String, dynamic> row) {
    final DateTime? date = parseAssetDate(row['inspection_date']) ??
        parseAssetDate(row['created_at']);
    if (date == null) return null;
    return AssetTimelineEvent(
      kind: AssetTimelineKind.inspection,
      date: date,
      recordId: _s(row['id']),
      reference: _s(row['document_no']),
      status: _s(row['approval_status']) ?? _s(row['status']),
      person: _s(row['inspector']),
    );
  }

  static AssetTimelineEvent? wash(Map<String, dynamic> row) {
    final DateTime? date = parseAssetDate(row['wash_date']);
    if (date == null) return null;
    final Object? photos = row['photos'];
    return AssetTimelineEvent(
      kind: AssetTimelineKind.wash,
      date: date,
      recordId: _s(row['id']),
      status: _s(row['status']),
      detail: _s(row['wash_type']),
      person: _s(row['washed_by']),
      photoCount: photos is List && photos.isNotEmpty ? photos.length : null,
    );
  }

  /// A tyre row yields up to two events: the fitment and, when recorded, the
  /// removal.
  static List<AssetTimelineEvent> tyre(Map<String, dynamic> row) {
    final String? position = _s(row['tyre_position']) ?? _s(row['position']);
    final String? serial = _s(row['serial_no']);
    final DateTime? fitted = parseAssetDate(row['issue_date']);
    final DateTime? removed = parseAssetDate(row['removal_date']);
    return <AssetTimelineEvent>[
      if (fitted != null)
        AssetTimelineEvent(
          kind: AssetTimelineKind.tyreFitted,
          date: fitted,
          reference: serial,
          detail: position,
          status: _s(row['brand']),
        ),
      if (removed != null)
        AssetTimelineEvent(
          kind: AssetTimelineKind.tyreRemoved,
          date: removed,
          reference: serial,
          detail: position,
          status: _s(row['removal_reason']),
        ),
    ];
  }

  static AssetTimelineEvent? accident(Map<String, dynamic> row) {
    final DateTime? date = parseAssetDate(row['incident_date']);
    if (date == null) return null;
    return AssetTimelineEvent(
      kind: AssetTimelineKind.accident,
      date: date,
      recordId: _s(row['id']),
      reference: _s(row['reference_no']),
      status: _s(row['workflow_stage']) ?? _s(row['status']),
      detail: _s(row['accident_type']),
    );
  }

  static double? _positive(Object? raw) {
    final double? v = raw is num
        ? raw.toDouble()
        : (raw is String ? double.tryParse(raw.trim()) : null);
    return v != null && v > 0 ? v : null;
  }

  static String? _s(Object? raw) {
    if (raw == null) return null;
    final String t = raw.toString().trim();
    return t.isEmpty ? null : t;
  }
}

/// Newest first; ties keep a stable kind order so the list never reshuffles
/// between two reads of the same data.
List<AssetTimelineEvent> sortTimeline(Iterable<AssetTimelineEvent> events) {
  final List<AssetTimelineEvent> out = events.toList();
  out.sort((AssetTimelineEvent a, AssetTimelineEvent b) {
    final int byDate = b.date.compareTo(a.date);
    return byDate != 0 ? byDate : a.kind.index.compareTo(b.kind.index);
  });
  return out;
}

/// "Work order status looks open": used to paint the status dot. Unknown
/// words are neither open nor closed.
bool? assetStatusIsOpen(String? status) {
  final String s = status?.trim().toLowerCase() ?? '';
  if (s.isEmpty) return null;
  const Set<String> closed = <String>{
    'completed',
    'closed',
    'cancelled',
    'done',
    'approved',
    'legacy_closed',
  };
  const Set<String> open = <String>{
    'open',
    'new',
    'in progress',
    'in_progress',
    'assigned',
    'on hold',
    'waiting for parts',
    'quality inspection',
    'overdue',
    'pending_approval',
    'reported',
  };
  if (closed.contains(s)) return false;
  if (open.contains(s)) return true;
  return null;
}
