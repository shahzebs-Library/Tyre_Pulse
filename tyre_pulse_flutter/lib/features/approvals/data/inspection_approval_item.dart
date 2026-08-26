/// One `inspections` row, decoded for the approvals queue and its review
/// screen.
///
/// Ported field-for-field from `mobile/lib/inspectionApprovals.ts`'s own
/// `InspectionApprovalItem` interface (`mobile/` is READ-ONLY reference
/// material - see `AGENTS.md`). That file selects two different column
/// sets for two different reasons - the queue reads
/// [inspectionApprovalListColumns] (lean, so a long pending list stays
/// cheap on a field device), the review screen reads
/// [inspectionApprovalFullColumns] (everything a supervisor needs to
/// decide) - and both are decoded through this SAME
/// [InspectionApprovalItem.fromRow], exactly as the TS source decodes both
/// shapes into the one interface: a column this instance's row never
/// selected simply reads back `null`.
///
/// [tyreConditions] is kept as the RAW value read off the row rather than
/// decoded into a typed shape here. `features/tyre_diagram/domain/
/// tyre_completeness.dart`'s `readTyreEntries`/`classifyEntry` already do
/// that defensively (map, list, JSON-encoded string, or a bare condition
/// value - never throws), and that module is the shared, foundational
/// engine this whole port's tyre-diagram-consuming screens are built to
/// reuse (see `inspection_remote_repository.dart`'s own library comment:
/// "this whole port consumes `features/tyre_diagram`'s widget and engine,
/// rather than re-querying ... a second, possibly-drifting way"). This
/// feature does NOT depend on `features/inspections/domain/
/// tyre_position_reading.dart` - that type belongs to a SIBLING top-level
/// feature's own domain layer, and per this codebase's established
/// convention (see `inspection_approval_signature_pad.dart`'s own library
/// comment on why this feature draws its own signature pad rather than
/// importing `features/inspections`' one), sibling top-level features keep
/// their own domain layers separate even when a decode looks similar.
library;

/// Every column [InspectionApprovalItem.fromRow] can read for the QUEUE
/// list. Kept narrow on purpose - `mobile/lib/inspectionApprovals.ts`'s own
/// `LIST_COLS` comment is "lean columns so the queue stays cheap".
/// #mirror: `LIST_COLS`.
const String inspectionApprovalListColumns =
    'id,title,site,asset_no,vehicle_type,inspector,inspection_date,'
    'created_at,status,approval_status,inspector_signature';

/// Every column [InspectionApprovalItem.fromRow] can read for the REVIEW
/// screen. #mirror: `FULL_COLS`.
const String inspectionApprovalFullColumns =
    'id,title,site,asset_no,vehicle_type,inspector,inspection_date,'
    'created_at,status,approval_status,notes,findings,odometer_km,'
    'hour_meter,tyre_conditions,inspector_signature,approver_signature,'
    'approver_email,approved_at';

String? _asString(Object? raw) {
  if (raw is! String) return null;
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

final class InspectionApprovalItem {
  /// Decodes [row] as read via [inspectionApprovalListColumns] or
  /// [inspectionApprovalFullColumns].
  factory InspectionApprovalItem.fromRow(Map<String, Object?> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException(
        'Inspection approval row has no usable "id".',
      );
    }

    return InspectionApprovalItem(
      id: rawId,
      title: _asString(row['title']),
      site: _asString(row['site']),
      assetNo: _asString(row['asset_no']),
      vehicleType: _asString(row['vehicle_type']),
      inspector: _asString(row['inspector']),
      inspectionDate: _asString(row['inspection_date']),
      createdAt: _asString(row['created_at']),
      status: _asString(row['status']),
      approvalStatus: _asString(row['approval_status']),
      notes: _asString(row['notes']),
      findings: _asString(row['findings']),
      odometerKm: (row['odometer_km'] as num?)?.toInt(),
      hourMeter: (row['hour_meter'] as num?)?.toDouble(),
      tyreConditions: row['tyre_conditions'],
      inspectorSignature: _asString(row['inspector_signature']),
      approverSignature: _asString(row['approver_signature']),
      approverEmail: _asString(row['approver_email']),
      approvedAt: _asString(row['approved_at']),
    );
  }
  const InspectionApprovalItem({
    required this.id,
    this.title,
    this.site,
    this.assetNo,
    this.vehicleType,
    this.inspector,
    this.inspectionDate,
    this.createdAt,
    this.status,
    this.approvalStatus,
    this.notes,
    this.findings,
    this.odometerKm,
    this.hourMeter,
    this.tyreConditions,
    this.inspectorSignature,
    this.approverSignature,
    this.approverEmail,
    this.approvedAt,
  });

  /// The server row id. Never null on a real row - `inspections.id` is the
  /// primary key - so a row this cannot be read from is a genuinely broken
  /// invariant, mirroring `InspectionRecord.fromRow`'s own throwing
  /// convention over the same table.
  final String id;

  final String? title;
  final String? site;
  final String? assetNo;
  final String? vehicleType;
  final String? inspector;
  final String? inspectionDate;
  final String? createdAt;
  final String? status;

  /// `'pending_approval' | 'approved' | 'rejected'` on a well-formed row.
  /// This is a DIFFERENT vocabulary from `checklist_submissions.
  /// approval_status` (`'pending' | 'pending_area_manager' | 'approved' |
  /// 'rejected' | 'not_required'`) - see the TS source's own warning not to
  /// carry tokens across the two tables.
  final String? approvalStatus;

  final String? notes;
  final String? findings;
  final int? odometerKm;
  final double? hourMeter;

  /// Raw `tyre_conditions` jsonb, exactly as PostgREST returned it. See the
  /// library comment on why this is left undecoded here.
  final Object? tyreConditions;

  final String? inspectorSignature;
  final String? approverSignature;
  final String? approverEmail;
  final String? approvedAt;

  /// Whether the queue's own decision on this row has already been made.
  /// `'pending_approval'` is the only outstanding state; anything else -
  /// including an unrecognised or absent value - reads as decided, so a
  /// malformed status can never dress up as something still awaiting
  /// action.
  bool get isPending => approvalStatus == 'pending_approval';

  bool get isApproved => approvalStatus == 'approved';
}
