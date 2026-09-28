/// Which vehicle type an inspection RECORDS, and which one lays out its
/// wheels. They are deliberately two values.
///
/// The recorded type ([InspectionPayload.vehicleType], `inspections.
/// vehicle_type`) is the fleet register's own raw value. The picker used to
/// pass the RESOLVED layout name instead, so tyreless equipment (GENERATOR,
/// PLACING BOOM, STATIONARY PUMP, any PLANT) and any type the resolver does
/// not know were rewritten to `'Pickup'`: the sheet demanded four tyres the
/// machine does not have, and the server row was stamped with a vehicle type
/// nobody recorded.
///
/// The layout type drives the diagram, the position list and the
/// completeness gate, which must all agree. It equals the raw type EXCEPT
/// when the make/model positively identifies a pickup
/// ([resolveVehicleTypeFor]'s only override) - then the layout is that
/// pickup, because a make/model is real evidence of the axle set. A
/// tyreless type stays tyreless ("not applicable", never "0 of 0") and an
/// unknown type stays unknown (the completeness gate then blocks nothing).
library;

import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

String inspectionLayoutVehicleType({
  String? vehicleType,
  String? assetNo,
  String? make,
  String? model,
}) {
  final String raw = (vehicleType ?? '').trim();
  if (isTyrelessEquipment(raw)) return raw;
  final String withIdentity = resolveVehicleTypeFor(
    vehicleType: raw,
    assetNo: assetNo,
    make: make,
    model: model,
  );
  final String plain = resolveVehicleType(raw, assetNo);
  return withIdentity != plain ? withIdentity : raw;
}
