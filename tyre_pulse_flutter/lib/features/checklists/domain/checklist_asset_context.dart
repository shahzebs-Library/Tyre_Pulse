/// A minimal, purpose-built view of an asset for `checklist_auto_fill.dart`
/// to read register values from.
///
/// Mirrors the TypeScript `AssetLike` interface at
/// `mobile/lib/checklistMarks.ts:76-86` - deliberately a SMALL structural
/// type carrying only the 8 fields [kChecklistAutoFillSources] actually
/// reads, not the richer `vehicle_fleet` row a real repository returns.
/// This domain library stays self-contained (per this phase's brief: no
/// Supabase, no cross-feature coupling) by defining its own minimal view
/// here rather than importing `features/assets/domain/vehicle_asset.dart` -
/// a future caller holding a real asset object is responsible for adapting
/// it into one of these, exactly as the TypeScript source's own `AssetLike`
/// is a purpose-built view rather than the full live asset row.
library;

final class ChecklistAssetContext {
  const ChecklistAssetContext({
    this.site,
    this.fleetNumber,
    this.registrationNo,
    this.chassisNo,
    this.serialNo,
    this.currentKm,
    this.vehicleType,
    this.make,
    this.model,
  });

  final String? site;
  final String? fleetNumber;
  final String? registrationNo;
  final String? chassisNo;
  final String? serialNo;

  /// A number or a string, matching the source's `number | string | null` -
  /// resolved to text by [resolveAutoFill] regardless of which it is.
  final Object? currentKm;

  final String? vehicleType;
  final String? make;
  final String? model;

  @override
  String toString() =>
      'ChecklistAssetContext(site: $site, fleetNumber: $fleetNumber)';
}
