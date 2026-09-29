/// The Vehicle 360 master-record field list and the "Share" summary PDF.
///
/// The field list lives here, once, so the on-screen Overview card and the
/// shared PDF can never list different fields for the same asset.
///
/// The PDF is English on purpose, the same reason as the single-asset
/// financial report: the default PDF font carries no Arabic-script glyphs and
/// none is bundled, so an Arabic or Urdu PDF would print empty boxes.
library;

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/assets/domain/asset_financials.dart'
    show formatAssetMoney;
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

/// The asset's master-record rows, label then value. A null value is a field
/// that was never recorded; callers print their own placeholder for it.
List<(String, String?)> vehicle360Fields(
  AppLocalizations l10n,
  VehicleAsset asset,
) =>
    <(String, String?)>[
      (l10n.vehiclesFieldFleetNo, asset.fleetNumber),
      (l10n.vehiclesFieldType, asset.vehicleType),
      (
        l10n.vehiclesFieldMakeModel,
        vehicle360Join(<String?>[asset.make, asset.model]),
      ),
      (l10n.vehiclesFieldYear, asset.year?.toString()),
      (
        l10n.vehiclesFieldCurrentKm,
        asset.currentKm == null
            ? null
            : '${formatVehicleOdometer(asset.currentKm!)} km',
      ),
      (l10n.vehiclesFieldOperator, asset.operatorName),
      (l10n.vehiclesFieldDepartment, asset.department),
      (l10n.vehiclesFieldSite, asset.site),
      (l10n.vehiclesFieldRegion, asset.region),
      (l10n.vehiclesFieldCountry, asset.country),
      (l10n.vehiclesFieldTyreSize, asset.tyreSize),
      (l10n.vehiclesFieldRegistration, asset.registrationNo),
      if (vehicle360Present(asset.serialNo) != null)
        (l10n.vehiclesFieldSerialNo, asset.serialNo),
      if (vehicle360Present(asset.engineNo) != null)
        (l10n.vehiclesFieldEngineNo, asset.engineNo),
      if (vehicle360Present(asset.capacity) != null)
        (l10n.vehiclesFieldCapacity, asset.capacity),
      if (vehicle360Present(asset.opsStatus) != null)
        (l10n.vehiclesFieldOperationalStatus, asset.opsStatus),
    ];

/// `8,742 h`, for engine hours, or null.
String? vehicle360HoursLabel(double? hours) =>
    hours == null ? null : '${formatAssetMoney(hours)} h';

/// Joins the present parts with one space, or null when none is present.
String? vehicle360Join(List<String?> parts) {
  final List<String> present = <String>[
    for (final String? part in parts)
      if (vehicle360Present(part) != null) vehicle360Present(part)!,
  ];
  return present.isEmpty ? null : present.join(' ');
}

String? vehicle360Present(String? value) {
  final String trimmed = value?.trim() ?? '';
  return trimmed.isEmpty ? null : trimmed;
}

/// Builds the shared summary. Every value is one the screen prints; a field
/// that was never recorded prints as "-", never as an invented value.
pw.Document buildVehicle360SummaryPdf({
  required VehicleAsset asset,
  required AppLocalizations en,
  double? engineHours,
}) {
  final pw.Document doc = pw.Document();
  final String? hours = vehicle360HoursLabel(engineHours);
  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(32),
      build: (pw.Context _) => <pw.Widget>[
        pw.Text(
          en.vehiclesDetailSubtitle,
          style: const pw.TextStyle(
            fontSize: 20,
            fontWeight: pw.FontWeight.bold,
          ),
        ),
        pw.SizedBox(height: 4),
        pw.Text(
          <String?>[
            asset.displayIdentity,
            vehicle360Join(<String?>[asset.make, asset.model]),
            asset.site,
            vehicle360Present(asset.opsStatus) ?? asset.status,
          ].whereType<String>().where((String v) => v.trim().isNotEmpty).join(
                '  |  ',
              ),
        ),
        if (hours != null) pw.Text(hours),
        pw.SizedBox(height: 12),
        pw.TableHelper.fromTextArray(
          data: <List<String>>[
            for (final (String label, String? value)
                in vehicle360Fields(en, asset))
              <String>[label, vehicle360Present(value) ?? '-'],
          ],
        ),
      ],
    ),
  );
  return doc;
}
