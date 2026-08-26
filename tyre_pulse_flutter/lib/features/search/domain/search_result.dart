import 'package:tyre_pulse/app/router/routes.dart';

/// One matched row from one identifier-type lookup, already carrying enough
/// to render a result tile and to build the [TpRoute] a tap should land on.
///
/// # Why a sealed union instead of one flat class
///
/// The four in-scope identifier types resolve through four DIFFERENT
/// repositories reading four different tables (see
/// `data/global_search_repository.dart`'s own library comment for the exact
/// mapping), and each one's row shape has nothing in common with the
/// others - an asset has a site and a vehicle type, a work order has a
/// status and a priority, none of that transfers. A sealed class lets the
/// presentation layer `switch` on what it actually has instead of reading
/// nullable fields that are meaningful for one subtype and always-null
/// filler for the rest.
///
/// Every subtype still exposes [title]/[subtitle]/[kindLabel] as plain
/// getters so a result LIST can render a uniform row without switching -
/// the switch is only needed for navigation, in
/// `presentation/global_search_controller.dart`.
sealed class SearchResultItem {
  const SearchResultItem();

  /// The primary line a result tile shows - normally the identifier itself
  /// (the asset number, the work order number, the serial).
  String get title;

  /// A secondary line giving context (site, status, brand) - never the
  /// identifier again, and never a fabricated value when the source row did
  /// not carry one; a missing field is simply left out of the string.
  String get subtitle;

  /// The plain-English name of this result's kind, for a leading badge.
  ///
  /// DELIBERATELY NOT LOCALISED. This is a pure Dart domain model with no
  /// `BuildContext` and no dependency on `flutter_localizations` - the
  /// same reason `TyreLookupRecord`, `SerialSearchState` and every other
  /// domain type in this codebase carry no translated text of their own.
  /// The presentation layer (`presentation/global_search_screen.dart`)
  /// renders a real, localised section heading above each result group
  /// (`globalSearchSectionAssets`/`Tyres`/`WorkOrders`/`Inspections`) and
  /// never displays [kindLabel] directly for that purpose. The one place
  /// this raw English string CAN still reach the screen is as the last
  /// -resort fallback inside a subtype's own [subtitle] getter below, for
  /// the rare row that carries its primary identifier but genuinely no
  /// other populated field - a documented, deliberate, low-frequency gap
  /// rather than an oversight, called out explicitly in this feature's own
  /// report rather than left to be found later.
  String get kindLabel;
}

/// A `vehicle_fleet` row matched on asset number, registration, chassis
/// number or fleet number.
final class AssetSearchResult extends SearchResultItem {
  const AssetSearchResult({
    required this.assetNo,
    this.registrationNo,
    this.chassisNo,
    this.fleetNumber,
    this.site,
    this.vehicleType,
  });

  final String assetNo;
  final String? registrationNo;
  final String? chassisNo;
  final String? fleetNumber;
  final String? site;
  final String? vehicleType;

  @override
  String get title => assetNo;

  @override
  String get subtitle {
    final List<String> parts = <String>[
      if (vehicleType != null && vehicleType!.isNotEmpty) vehicleType!,
      if (site != null && site!.isNotEmpty) site!,
    ];
    return parts.isEmpty ? 'Asset' : parts.join(' - ');
  }

  @override
  String get kindLabel => 'Asset';
}

/// A `tyre_records` row matched on serial number.
final class TyreSearchResult extends SearchResultItem {
  const TyreSearchResult({
    required this.serialNo,
    this.assetNo,
    this.position,
    this.brand,
    this.size,
  });

  final String serialNo;
  final String? assetNo;
  final String? position;
  final String? brand;
  final String? size;

  @override
  String get title => serialNo;

  @override
  String get subtitle {
    final List<String> parts = <String>[
      if (brand != null && brand!.isNotEmpty) brand!,
      if (assetNo != null && assetNo!.isNotEmpty) assetNo!,
      if (position != null && position!.isNotEmpty) position!,
    ];
    return parts.isEmpty ? 'Tyre' : parts.join(' - ');
  }

  @override
  String get kindLabel => 'Tyre serial';
}

/// A `work_orders` row matched on `work_order_no`, decoded through the
/// real, verified [WorkOrderItem.fromRow] (imported read-only from the
/// work_orders feature - see the repository's own library comment).
final class WorkOrderSearchResult extends SearchResultItem {
  const WorkOrderSearchResult({
    required this.id,
    this.workOrderNo,
    this.assetNo,
    this.status,
    this.workType,
  });

  /// The server row id - the value [WorkOrderDetailRoute] navigates on.
  final String id;
  final String? workOrderNo;
  final String? assetNo;
  final String? status;
  final String? workType;

  @override
  String get title => workOrderNo ?? id;

  @override
  String get subtitle {
    final List<String> parts = <String>[
      if (assetNo != null && assetNo!.isNotEmpty) assetNo!,
      if (status != null && status!.isNotEmpty) status!,
    ];
    return parts.isEmpty ? 'Work order' : parts.join(' - ');
  }

  @override
  String get kindLabel => 'Work order';
}

/// An `inspections` row matched on its server row id (the only thing
/// "inspection reference" can mean - see
/// `data/global_search_repository.dart`'s library comment for why).
final class InspectionSearchResult extends SearchResultItem {
  const InspectionSearchResult({
    required this.id,
    this.assetNo,
    this.site,
    this.status,
    this.inspectionDate,
  });

  final String id;
  final String? assetNo;
  final String? site;
  final String? status;
  final String? inspectionDate;

  @override
  String get title => id;

  @override
  String get subtitle {
    final List<String> parts = <String>[
      if (assetNo != null && assetNo!.isNotEmpty) assetNo!,
      if (site != null && site!.isNotEmpty) site!,
      if (inspectionDate != null && inspectionDate!.isNotEmpty) inspectionDate!,
    ];
    return parts.isEmpty ? 'Inspection' : parts.join(' - ');
  }

  @override
  String get kindLabel => 'Inspection';
}
