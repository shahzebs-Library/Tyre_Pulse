/// Builds and shares a truthful, field-ready tyre inspection PDF.
///
/// The report reuses the same 13-layout resolver and V1/V2 position mapping as
/// inspection capture. It never prints photo storage references or local file
/// paths. Current fitment identity is clearly separated from the reading that
/// was recorded during the inspection, so a later tyre replacement cannot make
/// the historical measurement look as though it belonged to a different tyre.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

const PdfColor _brand = PdfColor.fromInt(0xff07833d);
const PdfColor _ink = PdfColor.fromInt(0xff0b1f52);
const PdfColor _muted = PdfColor.fromInt(0xff64748b);
const PdfColor _border = PdfColor.fromInt(0xffd8e0ec);
const PdfColor _surface = PdfColor.fromInt(0xfff7f9fc);
const PdfColor _good = PdfColor.fromInt(0xff169447);
const PdfColor _warning = PdfColor.fromInt(0xffff8a00);
const PdfColor _critical = PdfColor.fromInt(0xffd71920);
const PdfColor _unknown = PdfColor.fromInt(0xff94a3b8);

/// Localised words supplied by the presentation layer. Keeping copy outside
/// the generator makes the document testable without a BuildContext and keeps
/// the vehicle coordinate system LTR even when the surrounding report is RTL.
final class InspectionReportCopy {
  const InspectionReportCopy({
    required this.title,
    required this.asset,
    required this.vehicleType,
    required this.site,
    required this.date,
    required this.inspector,
    required this.status,
    required this.odometer,
    required this.hourMeter,
    required this.location,
    required this.summary,
    required this.layout,
    required this.readings,
    required this.position,
    required this.currentFitment,
    required this.condition,
    required this.pressure,
    required this.tread,
    required this.notes,
    required this.notRecorded,
    required this.notAvailable,
    required this.observations,
    required this.generated,
    required this.good,
    required this.worn,
    required this.critical,
    this.rtl = false,
  });

  final String title;
  final String asset;
  final String vehicleType;
  final String site;
  final String date;
  final String inspector;
  final String status;
  final String odometer;
  final String hourMeter;
  final String location;
  final String summary;
  final String layout;
  final String readings;
  final String position;
  final String currentFitment;
  final String condition;
  final String pressure;
  final String tread;
  final String notes;
  final String notRecorded;
  final String notAvailable;
  final String observations;
  final String generated;
  final String good;
  final String worn;
  final String critical;
  final bool rtl;
}

final class InspectionReportData {
  const InspectionReportData({
    required this.id,
    required this.assetNo,
    required this.vehicleType,
    required this.site,
    required this.inspector,
    required this.inspectionDate,
    required this.status,
    required this.tyreConditions,
    required this.installedTyres,
    this.approvalStatus,
    this.odometerKm,
    this.hourMeter,
    this.notes,
    this.findings,
    this.gpsLat,
    this.gpsLng,
  });

  final String id;
  final String assetNo;
  final String vehicleType;
  final String site;
  final String inspector;
  final DateTime inspectionDate;
  final String status;
  final String? approvalStatus;
  final int? odometerKm;
  final double? hourMeter;
  final String? notes;
  final String? findings;
  final double? gpsLat;
  final double? gpsLng;
  final Map<String, Map<String, Object?>> tyreConditions;
  final Map<String, TyreFitment> installedTyres;
}

final class _ReportTyreRow {
  const _ReportTyreRow({
    required this.slot,
    required this.code,
    required this.entry,
    required this.fitment,
  });

  final TyreSlot slot;
  final String code;
  final Map<String, Object?>? entry;
  final TyreFitment? fitment;
}

Future<Uint8List> buildInspectionReportPdf(
  InspectionReportData data,
  InspectionReportCopy copy, {
  DateTime? generatedAt,
}) async {
  final String layoutKey = resolveVehicleType(data.vehicleType, data.assetNo);
  final DiagramLayout layout =
      kTyreDiagramLayouts[layoutKey] ?? kTyreDiagramLayouts['Pickup']!;
  final Map<String, Map<String, Object?>> entries = _entriesByKey(
    data.tyreConditions,
  );
  final List<_ReportTyreRow> rows = <_ReportTyreRow>[
    for (final TyreSlot slot in layout.tyres)
      _ReportTyreRow(
        slot: slot,
        code: legacyPositionCode(layout.key, slot.id),
        entry: entries[keyOf(slot.id)] ??
            entries[keyOf(legacyPositionCode(layout.key, slot.id))],
        fitment: data.installedTyres[slot.id],
      ),
  ];

  final pw.Document document = pw.Document(
    title: '${copy.title} - ${data.assetNo}',
    author: 'Tyre Pulse',
    subject: data.id,
    // Reports are intentionally left uncompressed. This keeps downstream
    // records-management indexing/search reliable for asset numbers and tyre
    // serials without weakening or changing any of the document data.
    compress: false,
  );
  final DateTime created = (generatedAt ?? DateTime.now()).toLocal();
  final int goodCount = rows.where((row) {
    return _condition(row.entry) == TyreCondition.good;
  }).length;
  final int wornCount = rows.where((row) {
    return _condition(row.entry) == TyreCondition.worn;
  }).length;
  final int criticalCount = rows.where((row) {
    final TyreCondition? value = _condition(row.entry);
    return value == TyreCondition.damaged ||
        value == TyreCondition.puncture ||
        value == TyreCondition.flat;
  }).length;
  final int recordedCount = rows.where((row) {
    return row.entry != null &&
        classifyEntry(row.entry!).state != TyreSlotState.blank;
  }).length;

  final bool needsUnicodeFont = copy.rtl || _containsNonLatinReportText(data);
  final pw.ThemeData? reportTheme = needsUnicodeFont
      ? pw.ThemeData.withFont(
          base: await PdfGoogleFonts.notoSansArabicRegular(),
          bold: await PdfGoogleFonts.notoSansArabicBold(),
        )
      : null;

  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.fromLTRB(30, 28, 30, 32),
      theme: reportTheme,
      textDirection: copy.rtl ? pw.TextDirection.rtl : pw.TextDirection.ltr,
      header: (pw.Context context) => _reportHeader(data, copy),
      footer: (pw.Context context) => pw.Row(
        mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
        children: <pw.Widget>[
          pw.Text(
            '${copy.generated}: ${_dateTime(created)}',
            style: const pw.TextStyle(fontSize: 8, color: _muted),
          ),
          pw.Text(
            '${context.pageNumber} / ${context.pagesCount}',
            style: const pw.TextStyle(fontSize: 8, color: _muted),
          ),
        ],
      ),
      build: (pw.Context context) => <pw.Widget>[
        pw.SizedBox(height: 12),
        pw.Wrap(
          spacing: 6,
          runSpacing: 6,
          children: <pw.Widget>[
            _meta(copy.asset, data.assetNo),
            _meta(copy.vehicleType, data.vehicleType),
            _meta(copy.site, _value(data.site, copy.notAvailable)),
            _meta(copy.date, _dateTime(data.inspectionDate.toLocal())),
            _meta(copy.inspector, _value(data.inspector, copy.notAvailable)),
            _meta(
              copy.status,
              _value(data.approvalStatus ?? data.status, copy.notAvailable),
            ),
            if (data.odometerKm != null)
              _meta(copy.odometer, '${data.odometerKm} km'),
            if (data.hourMeter != null)
              _meta(copy.hourMeter, '${_number(data.hourMeter)} h'),
            if (data.gpsLat != null && data.gpsLng != null)
              _meta(
                copy.location,
                '${data.gpsLat!.toStringAsFixed(5)}, '
                '${data.gpsLng!.toStringAsFixed(5)}',
              ),
          ],
        ),
        _section(copy.summary),
        pw.Row(
          children: <pw.Widget>[
            _summaryMetric('${rows.length}', copy.position, _ink),
            pw.SizedBox(width: 6),
            _summaryMetric('$recordedCount', copy.readings, _ink),
            pw.SizedBox(width: 6),
            _summaryMetric('$goodCount', copy.good, _good),
            pw.SizedBox(width: 6),
            _summaryMetric('$wornCount', copy.worn, _warning),
            pw.SizedBox(width: 6),
            _summaryMetric('$criticalCount', copy.critical, _critical),
          ],
        ),
        _section('${copy.layout} - ${layout.key}'),
        _layoutDiagram(layout, rows, copy),
        _section('${copy.readings} ($recordedCount/${rows.length})'),
        _readingsTable(rows, copy),
        if (_observations(data).isNotEmpty) ...<pw.Widget>[
          _section(copy.observations),
          pw.Container(
            width: double.infinity,
            padding: const pw.EdgeInsets.all(10),
            decoration: pw.BoxDecoration(
              border: pw.Border.all(color: _border),
              borderRadius: pw.BorderRadius.circular(6),
            ),
            child: pw.Text(
              _observations(data),
              style: const pw.TextStyle(fontSize: 9.5, color: _ink),
            ),
          ),
        ],
      ],
    ),
  );
  return document.save();
}

bool _containsNonLatinReportText(InspectionReportData data) {
  final Iterable<String> values = <String>[
    data.assetNo,
    data.vehicleType,
    data.site,
    data.inspector,
    data.status,
    data.approvalStatus ?? '',
    data.notes ?? '',
    data.findings ?? '',
    for (final TyreFitment fitment in data.installedTyres.values) ...<String>[
      fitment.serialNo ?? '',
      fitment.brand ?? '',
      fitment.size ?? '',
    ],
    for (final Map<String, Object?> entry in data.tyreConditions.values)
      ...entry.values.whereType<String>(),
  ];
  return values.any(
    (String value) => value.runes.any((int rune) => rune > 0xff),
  );
}

Future<void> shareInspectionReportPdf(
  InspectionReportData data,
  InspectionReportCopy copy,
) async {
  final Uint8List bytes = await buildInspectionReportPdf(data, copy);
  await Printing.sharePdf(
    bytes: bytes,
    filename: inspectionReportFileName(data),
  );
}

String inspectionReportFileName(InspectionReportData data) {
  final String safeAsset = data.assetNo
      .replaceAll(RegExp('[^A-Za-z0-9_-]+'), '-')
      .replaceAll(RegExp('-+'), '-')
      .replaceAll(RegExp(r'^-|-$'), '');
  final DateTime date = data.inspectionDate.toLocal();
  final String stamp = '${date.year.toString().padLeft(4, '0')}'
      '${date.month.toString().padLeft(2, '0')}'
      '${date.day.toString().padLeft(2, '0')}';
  return 'tyre-inspection-${safeAsset.isEmpty ? 'asset' : safeAsset}-$stamp.pdf';
}

Map<String, Map<String, Object?>> _entriesByKey(
  Map<String, Map<String, Object?>> raw,
) {
  return <String, Map<String, Object?>>{
    for (final MapEntry<String, Map<String, Object?>> entry in raw.entries)
      keyOf(entry.key): entry.value,
  };
}

TyreCondition? _condition(Map<String, Object?>? entry) {
  if (entry == null || classifyEntry(entry).state == TyreSlotState.blank) {
    return null;
  }
  return normaliseCondition(entry['condition']?.toString());
}

PdfColor _conditionColor(Map<String, Object?>? entry) {
  return switch (_condition(entry)) {
    TyreCondition.good => _good,
    TyreCondition.worn => _warning,
    TyreCondition.damaged ||
    TyreCondition.puncture ||
    TyreCondition.flat =>
      _critical,
    _ => _unknown,
  };
}

pw.Widget _reportHeader(InspectionReportData data, InspectionReportCopy copy) {
  final String shortId = data.id.length > 8
      ? data.id.substring(0, 8).toUpperCase()
      : data.id.toUpperCase();
  return pw.Container(
    padding: const pw.EdgeInsets.only(bottom: 10),
    decoration: const pw.BoxDecoration(
      border: pw.Border(bottom: pw.BorderSide(color: _brand, width: 2.5)),
    ),
    child: pw.Row(
      mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: <pw.Widget>[
        pw.Row(
          children: <pw.Widget>[
            pw.Container(
              width: 34,
              height: 34,
              alignment: pw.Alignment.center,
              decoration: pw.BoxDecoration(
                color: _brand,
                borderRadius: pw.BorderRadius.circular(7),
              ),
              child: pw.Text(
                'TP',
                style: const pw.TextStyle(
                  color: PdfColors.white,
                  fontSize: 15,
                  fontWeight: pw.FontWeight.bold,
                ),
              ),
            ),
            pw.SizedBox(width: 8),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: <pw.Widget>[
                pw.Text(
                  'TYRE PULSE',
                  style: const pw.TextStyle(
                    color: _ink,
                    fontSize: 16,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.Text(
                  data.assetNo,
                  style: const pw.TextStyle(fontSize: 9, color: _muted),
                ),
              ],
            ),
          ],
        ),
        pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.end,
          children: <pw.Widget>[
            pw.Text(
              copy.title,
              style: const pw.TextStyle(
                color: _ink,
                fontSize: 15,
                fontWeight: pw.FontWeight.bold,
              ),
            ),
            pw.Text(
              shortId,
              style: const pw.TextStyle(fontSize: 8, color: _muted),
            ),
          ],
        ),
      ],
    ),
  );
}

pw.Widget _meta(String label, String value) {
  return pw.Container(
    width: 155,
    padding: const pw.EdgeInsets.symmetric(horizontal: 9, vertical: 7),
    decoration: pw.BoxDecoration(
      color: _surface,
      border: pw.Border.all(color: _border),
      borderRadius: pw.BorderRadius.circular(6),
    ),
    child: pw.Column(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: <pw.Widget>[
        pw.Text(
          label.toUpperCase(),
          style: const pw.TextStyle(fontSize: 7.5, color: _muted),
        ),
        pw.SizedBox(height: 2),
        pw.Text(
          value,
          maxLines: 2,
          style: const pw.TextStyle(
            fontSize: 10,
            color: _ink,
            fontWeight: pw.FontWeight.bold,
          ),
        ),
      ],
    ),
  );
}

pw.Widget _section(String title) => pw.Container(
      margin: const pw.EdgeInsets.only(top: 16, bottom: 7),
      padding: const pw.EdgeInsets.only(bottom: 4),
      decoration: const pw.BoxDecoration(
        border: pw.Border(bottom: pw.BorderSide(color: _border)),
      ),
      child: pw.Text(
        title,
        style: const pw.TextStyle(
          fontSize: 11,
          color: _brand,
          fontWeight: pw.FontWeight.bold,
        ),
      ),
    );

pw.Widget _summaryMetric(String value, String label, PdfColor color) {
  return pw.Expanded(
    child: pw.Container(
      padding: const pw.EdgeInsets.symmetric(vertical: 7, horizontal: 4),
      decoration: pw.BoxDecoration(
        border: pw.Border.all(color: _border),
        borderRadius: pw.BorderRadius.circular(6),
      ),
      child: pw.Column(
        children: <pw.Widget>[
          pw.Text(
            value,
            style: pw.TextStyle(
              fontSize: 16,
              color: color,
              fontWeight: pw.FontWeight.bold,
            ),
          ),
          pw.Text(
            label,
            textAlign: pw.TextAlign.center,
            maxLines: 2,
            style: const pw.TextStyle(fontSize: 7, color: _muted),
          ),
        ],
      ),
    ),
  );
}

pw.Widget _layoutDiagram(
  DiagramLayout layout,
  List<_ReportTyreRow> rows,
  InspectionReportCopy copy,
) {
  const double sourceWidth = 200;
  const double maximumDiagramWidth = 250;
  const double maximumDiagramHeight = 300;
  final double scale = math.min(
    maximumDiagramWidth / sourceWidth,
    maximumDiagramHeight / layout.viewH,
  );
  final double diagramWidth = sourceWidth * scale;
  final double diagramHeight = layout.viewH * scale;
  final double bodyTop = rows.isEmpty
      ? 18
      : rows.map((row) => row.slot.y).reduce((a, b) => a < b ? a : b) - 12;
  final double bodyBottom = rows.isEmpty
      ? layout.viewH - 18
      : rows
              .map((row) => row.slot.y + row.slot.h)
              .reduce((a, b) => a > b ? a : b) +
          12;

  return pw.Center(
    child: pw.Container(
      width: diagramWidth,
      height: diagramHeight,
      child: pw.Stack(
        children: <pw.Widget>[
          pw.Positioned(
            left: 58 * scale,
            top: bodyTop * scale,
            child: pw.Container(
              width: 84 * scale,
              height: (bodyBottom - bodyTop) * scale,
              alignment: pw.Alignment.topCenter,
              padding: const pw.EdgeInsets.only(top: 6),
              decoration: pw.BoxDecoration(
                color: _surface,
                border: pw.Border.all(color: _border),
                borderRadius: pw.BorderRadius.circular(10),
              ),
              child: pw.Text(
                layout.key.toUpperCase(),
                textAlign: pw.TextAlign.center,
                style: const pw.TextStyle(fontSize: 7, color: _muted),
              ),
            ),
          ),
          for (final _ReportTyreRow row in rows)
            pw.Positioned(
              left: row.slot.x * scale,
              top: row.slot.y * scale,
              child: pw.Container(
                width: (row.slot.w * scale).clamp(24, 42).toDouble(),
                height: (row.slot.h * scale).clamp(28, 54).toDouble(),
                padding: const pw.EdgeInsets.all(2),
                decoration: pw.BoxDecoration(
                  color: _conditionColor(row.entry),
                  border: pw.Border.all(color: _ink, width: 0.5),
                  borderRadius: pw.BorderRadius.circular(4),
                ),
                child: pw.Column(
                  mainAxisAlignment: pw.MainAxisAlignment.center,
                  children: <pw.Widget>[
                    pw.Text(
                      row.code,
                      textAlign: pw.TextAlign.center,
                      style: const pw.TextStyle(
                        fontSize: 5.5,
                        color: PdfColors.white,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    if (row.fitment?.serialNo != null)
                      pw.Text(
                        row.fitment!.serialNo!,
                        textAlign: pw.TextAlign.center,
                        maxLines: 1,
                        style: const pw.TextStyle(
                          fontSize: 4.5,
                          color: PdfColors.white,
                        ),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

pw.Widget _readingsTable(
  List<_ReportTyreRow> rows,
  InspectionReportCopy copy,
) {
  return pw.TableHelper.fromTextArray(
    headers: <String>[
      copy.position,
      copy.currentFitment,
      copy.condition,
      copy.pressure,
      copy.tread,
      copy.notes,
    ],
    data: <List<String>>[
      for (final _ReportTyreRow row in rows)
        <String>[
          row.code,
          _fitmentText(row.fitment, copy.notAvailable),
          _conditionText(row.entry, copy),
          _reading(
            row.entry,
            const <String>['pressure_psi', 'pressure'],
            'psi',
            copy.notRecorded,
          ),
          _reading(
            row.entry,
            const <String>['tread_depth_mm', 'tread_depth'],
            'mm',
            copy.notRecorded,
          ),
          _text(row.entry, const <String>['notes']) ?? copy.notRecorded,
        ],
    ],
    headerDecoration: const pw.BoxDecoration(color: _ink),
    headerStyle: const pw.TextStyle(
      color: PdfColors.white,
      fontSize: 7,
      fontWeight: pw.FontWeight.bold,
    ),
    cellStyle: const pw.TextStyle(fontSize: 6.8, color: _ink),
    cellPadding: const pw.EdgeInsets.symmetric(horizontal: 4, vertical: 4),
    border: pw.TableBorder.all(color: _border, width: 0.5),
    columnWidths: const <int, pw.TableColumnWidth>{
      0: pw.FixedColumnWidth(48),
      1: pw.FlexColumnWidth(1.8),
      2: pw.FlexColumnWidth(1.1),
      3: pw.FixedColumnWidth(45),
      4: pw.FixedColumnWidth(42),
      5: pw.FlexColumnWidth(1.5),
    },
  );
}

String _fitmentText(TyreFitment? fitment, String fallback) {
  if (fitment == null) return fallback;
  final List<String> values = <String>[
    if (fitment.serialNo?.trim().isNotEmpty == true) fitment.serialNo!.trim(),
    if (fitment.brand?.trim().isNotEmpty == true) fitment.brand!.trim(),
    if (fitment.size?.trim().isNotEmpty == true) fitment.size!.trim(),
  ];
  return values.isEmpty ? fallback : values.join(' | ');
}

String _conditionText(
  Map<String, Object?>? entry,
  InspectionReportCopy copy,
) {
  return switch (_condition(entry)) {
    TyreCondition.good => copy.good,
    TyreCondition.worn => copy.worn,
    TyreCondition.damaged ||
    TyreCondition.puncture ||
    TyreCondition.flat =>
      _text(entry, const <String>['condition']) ?? copy.critical,
    TyreCondition.missing => copy.notAvailable,
    _ => copy.notRecorded,
  };
}

String _reading(
  Map<String, Object?>? entry,
  List<String> keys,
  String unit,
  String fallback,
) {
  final String? value = _text(entry, keys);
  return value == null ? fallback : '$value $unit';
}

String? _text(Map<String, Object?>? entry, List<String> keys) {
  if (entry == null) return null;
  for (final String key in keys) {
    final String value = entry[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  return null;
}

String _observations(InspectionReportData data) {
  final String findings = data.findings?.trim() ?? '';
  if (findings.isNotEmpty) return findings;
  return data.notes?.trim() ?? '';
}

String _number(num? value) {
  if (value == null) return '-';
  return value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toString();
}

String _value(String value, String fallback) {
  final String trimmed = value.trim();
  return trimmed.isEmpty ? fallback : trimmed;
}

String _dateTime(DateTime value) {
  return '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')} '
      '${value.hour.toString().padLeft(2, '0')}:'
      '${value.minute.toString().padLeft(2, '0')}';
}
