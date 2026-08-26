/// A lightweight view of one in-progress inspection draft, for the
/// "resume unfinished work" list on the header step and on My Inspections.
///
/// Deliberately separate from the Drift-generated `InspectionDraft` row
/// type (`lib/core/database/tables/draft_tables.dart`) so the presentation
/// layer never imports `package:drift/drift.dart` or a generated
/// `.g.dart` class - the same boundary
/// `features/assets/domain/vehicle_asset.dart` already draws between a
/// remote row and its domain type.
library;

import 'package:flutter/foundation.dart';

@immutable
class InspectionDraftSummary {
  const InspectionDraftSummary({
    required this.draftKey,
    required this.assetNo,
    required this.filled,
    required this.total,
    required this.updatedAt,
    this.site,
    this.vehicleType,
  });

  final String draftKey;
  final String assetNo;
  final String? site;
  final String? vehicleType;

  /// Progress AS THE SCREEN COUNTED IT - see
  /// `InspectionDrafts.filled`'s own doc comment: never re-derived from
  /// the positions table, because only the screen knows which fields are
  /// currently visible under the wizard's own logic.
  final int filled;
  final int total;

  final DateTime updatedAt;

  bool get hasProgress => filled > 0;
}
