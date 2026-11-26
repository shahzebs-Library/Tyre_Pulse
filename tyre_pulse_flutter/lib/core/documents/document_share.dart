/// Builds the spec-driven PDFs and opens the platform share sheet.
///
/// Spec labels are English, like the web. The driver notice box and the signed
/// statements are in the driver's language; Arabic script needs a fallback
/// font, fetched once (the PDF still renders without it).
library;

import 'dart:typed_data';

import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/core/documents/charge_document.dart';
import 'package:tyre_pulse/core/documents/document_pdf.dart';
import 'package:tyre_pulse/core/documents/document_spec_support.dart';
import 'package:tyre_pulse/core/documents/handover_document.dart';

Future<List<pw.Font>> _fallbackFonts() async {
  try {
    final pw.Font arabic = await PdfGoogleFonts.notoNaskhArabicRegular()
        .timeout(const Duration(seconds: 10));
    return <pw.Font>[arabic];
  } on Object {
    return const <pw.Font>[];
  }
}

String _fileSafe(String value) =>
    value.replaceAll(RegExp(r'[^A-Za-z0-9 _-]'), ' ').trim();

/// Loads one photo's bytes for the PDF. Null when it cannot be loaded; the
/// paper then says so instead of dropping the photo.
typedef ChargePhotoLoader = Future<Uint8List?> Function(String reference);

/// Renders the Driver Charge Notice for a `driver_charge_detail` payload.
/// [language] is the app language, used for the driver notice box when the
/// driver has not signed yet.
Future<Uint8List> buildChargeNoticePdf(
  Map<String, Object?> detail, {
  DateTime Function() clock = DateTime.now,
  String language = 'en',
  ChargePhotoLoader? loadPhoto,
}) async {
  final Map<String, Object?> spec =
      await loadDocumentSpec(DocumentSpecAssets.driverChargeNotice);
  final ChargeDocumentModel model = buildChargeDocument(
    spec,
    detail,
    generatedAt: clock().toUtc().toIso8601String(),
    language: language,
  );
  final Map<String, Uint8List> photos = <String, Uint8List>{};
  if (loadPhoto != null) {
    for (final ChargeDocumentSection s in model.sections) {
      for (final ChargeDocumentPhoto p
          in s.photos ?? const <ChargeDocumentPhoto>[]) {
        try {
          final Uint8List? bytes =
              await loadPhoto(p.ref).timeout(const Duration(seconds: 15));
          if (bytes != null) photos[p.ref] = bytes;
        } on Object {
          // The paper prints "Photo could not be loaded." for this one.
        }
      }
    }
  }
  return renderChargeNoticePdf(
    model,
    fontFallback: await _fallbackFonts(),
    photoBytes: photos,
  );
}

/// Shares the notice. Throws when it cannot be built; the caller says so.
Future<void> shareChargeNoticePdf(
  Map<String, Object?> detail, {
  String language = 'en',
  ChargePhotoLoader? loadPhoto,
}) async {
  final Uint8List bytes = await buildChargeNoticePdf(
    detail,
    language: language,
    loadPhoto: loadPhoto,
  );
  final Object? charge = detail['charge'];
  final String number = charge is Map ? '${charge['charge_no'] ?? ''}' : '';
  await Printing.sharePdf(
    bytes: bytes,
    filename: '${_fileSafe('Driver Charge $number')}.pdf',
  );
}

/// Renders the Vehicle Handover Authorization for one `handover_reports` row.
Future<Uint8List> buildHandoverAuthorizationPdf(
  Map<String, Object?> row, {
  required int photoCount,
  required List<List<String>> damageRows,
  String? company,
  String? verifyOrigin,
  DateTime Function() clock = DateTime.now,
}) async {
  final Map<String, Object?> spec =
      await loadDocumentSpec(DocumentSpecAssets.handoverAuthorization);
  final HandoverDocumentModel model = buildHandoverDocument(
    spec,
    row,
    generatedAt: clock().toUtc().toIso8601String(),
    damageMarkCount: damageRows.length,
    photoCount: photoCount,
    damageRows: damageRows,
  );
  return renderHandoverPdf(
    model,
    company: company,
    verifyOrigin: verifyOrigin,
    fontFallback: await _fallbackFonts(),
  );
}

/// Shares the handover paper. Throws when it cannot be built.
Future<void> shareHandoverAuthorizationPdf(
  Map<String, Object?> row, {
  required int photoCount,
  required List<List<String>> damageRows,
  String? verifyOrigin,
}) async {
  final Uint8List bytes = await buildHandoverAuthorizationPdf(
    row,
    photoCount: photoCount,
    damageRows: damageRows,
    verifyOrigin: verifyOrigin,
  );
  await Printing.sharePdf(
    bytes: bytes,
    filename:
        '${_fileSafe('TyrePulse Vehicle Handover ${row['asset_no'] ?? ''}')}.pdf',
  );
}
