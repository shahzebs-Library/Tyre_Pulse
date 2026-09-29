/// The tyre records register's Export action (the share icon in the owner's
/// "Tyre records" mock).
///
/// # What it exports, and what it says it exports
///
/// The register is PAGED: the device holds only the pages already loaded, not
/// every `tyre_records` row the server counted. Exporting the loaded rows
/// while calling the file "all tyres" would be a silent truncation, so the PDF
/// states "N of M tyre records loaded on this device" under its title
/// whenever the server total is known, and the rows are exactly the ones on
/// screen under the active filters.
///
/// # English only
///
/// The bundled PDF font carries no Arabic or Urdu glyphs, so the file is
/// written from the English catalog - the same choice the management report
/// share makes. The on-screen labels stay localized.
///
/// # No invented values
///
/// A blank column in the source stays blank in the file; nothing is filled in.
library;

import 'package:pdf/widgets.dart' as pw;
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';

/// The column headers, in order. Built from [l10n] so a relabel in the ARB
/// catalog reaches the file too.
List<String> tyreRecordsExportHeaders(AppLocalizations l10n) => <String>[
      l10n.recordsSerialNo,
      l10n.serialSearchBrand,
      l10n.serialSearchSize,
      l10n.serialSearchAsset,
      l10n.serialSearchPosition,
      l10n.serialSearchSite,
      l10n.tyreRecordsExportStatus,
      l10n.recordsIssueDate,
    ];

/// One PDF row per loaded record. A missing value is an empty cell.
List<List<String>> tyreRecordsExportRows(List<TyreRecord> records) =>
    <List<String>>[
      for (final TyreRecord record in records)
        <String>[
          record.serialNo ?? '',
          record.brand ?? '',
          record.size ?? '',
          record.assetNo ?? '',
          record.bestPosition ?? '',
          record.site ?? '',
          record.status ?? '',
          record.issueDate ?? '',
        ],
    ];

/// Builds the register PDF for [records]. [totalCount] is the server's count
/// for the active query, or null when it was not returned.
pw.Document buildTyreRecordsPdf({
  required List<TyreRecord> records,
  required int? totalCount,
  required AppLocalizations l10n,
}) {
  final pw.Document document = pw.Document();
  final int total = totalCount ?? records.length;
  document.addPage(
    pw.MultiPage(
      build: (pw.Context context) => <pw.Widget>[
        pw.Header(level: 0, text: l10n.recordsTitle),
        pw.Text(l10n.tyreRecordsExportNote(records.length, total)),
        pw.SizedBox(height: 12),
        pw.TableHelper.fromTextArray(
          headers: tyreRecordsExportHeaders(l10n),
          data: tyreRecordsExportRows(records),
        ),
      ],
    ),
  );
  return document;
}
