/// Builds the spec-driven PDFs and opens the platform share sheet.
///
/// The paper is English, like the web (the spec labels and the server's legal
/// statements are English). Arabic-script values such as a driver name need a
/// fallback font; it is fetched once and the PDF still renders without it.
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

/// Renders the Driver Charge Notice for a `driver_charge_detail` payload.
Future<Uint8List> buildChargeNoticePdf(
  Map<String, Object?> detail, {
  DateTime Function() clock = DateTime.now,
}) async {
  final Map<String, Object?> spec =
      await loadDocumentSpec(DocumentSpecAssets.driverChargeNotice);
  final ChargeDocumentModel model = buildChargeDocument(
    spec,
    detail,
    generatedAt: clock().toUtc().toIso8601String(),
  );
  return renderChargeNoticePdf(model, fontFallback: await _fallbackFonts());
}

/// Shares the notice. Throws when it cannot be built; the caller says so.
Future<void> shareChargeNoticePdf(Map<String, Object?> detail) async {
  final Uint8List bytes = await buildChargeNoticePdf(detail);
  final Object? charge = detail['charge'];
  final String number =
      charge is Map ? '${charge['charge_no'] ?? ''}' : '';
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
