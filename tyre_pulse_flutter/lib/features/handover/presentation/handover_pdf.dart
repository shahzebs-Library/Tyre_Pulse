/// Renders and shares the "Vehicle Handover Report" PDF.
///
/// Content comes only from a real [HandoverRecord]. Blanks print "Not
/// recorded", a missing reading never becomes 0, and the three sign-off marks
/// (driver, fleet supervisor, fleet incharge) each print the captured
/// signature when there is one and an explicit "Pending" otherwise, so an
/// unsigned rung is never drawn as a blank box that reads like a signature.
///
/// Arabic and Urdu need an Arabic-script font, which the app does not bundle.
/// The share action tries to load Noto Naskh Arabic; when that cannot be
/// fetched (a field device with no signal) the document is rendered in English
/// rather than printing empty boxes, and the caller is told so. Mirrors the
/// contract of `accident_case_pdf.dart`.
library;

import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_record.dart';
import 'package:tyre_pulse/features/handover/presentation/handover_copy.dart';

const PdfColor _ink = PdfColor.fromInt(0xFF0F172A);
const PdfColor _body = PdfColor.fromInt(0xFF334155);
const PdfColor _muted = PdfColor.fromInt(0xFF64748B);
const PdfColor _line = PdfColor.fromInt(0xFFE2E8F0);
const PdfColor _zebra = PdfColor.fromInt(0xFFF8FAFC);
const PdfColor _accent = PdfColor.fromInt(0xFF15803D);

/// Pure renderer: returns the PDF bytes. [base]/[bold] are required for Arabic
/// or Urdu; [fallback] lets an English document still draw Arabic-script
/// values (driver names, sites) when the font is available.
Future<Uint8List> buildHandoverPdf({
  required HandoverRecord record,
  required AppLocalizations l10n,
  required DateTime generatedAt,
  pw.Font? base,
  pw.Font? bold,
  List<pw.Font> fallback = const <pw.Font>[],
  bool rtl = false,
}) async {
  final pw.ThemeData theme = pw.ThemeData.withFont(
    base: base,
    bold: bold,
    fontFallback: fallback,
  );
  final pw.Document document =
      pw.Document(title: l10n.handoverPdfTitle, theme: theme);
  final pw.TextDirection direction =
      rtl ? pw.TextDirection.rtl : pw.TextDirection.ltr;
  final String notRecorded = l10n.valueUnavailable;

  pw.Widget sectionTitle(String title) => pw.Padding(
        padding: const pw.EdgeInsets.only(top: 14, bottom: 6),
        child: pw.Text(
          title,
          style: const pw.TextStyle(
            fontSize: 12,
            fontWeight: pw.FontWeight.bold,
            color: _ink,
          ),
        ),
      );

  pw.Widget factTable(List<List<String>> rows) => pw.Table(
        border: const pw.TableBorder(
          horizontalInside: pw.BorderSide(color: _line, width: 0.5),
          bottom: pw.BorderSide(color: _line, width: 0.5),
          top: pw.BorderSide(color: _line, width: 0.5),
        ),
        columnWidths: const <int, pw.TableColumnWidth>{
          0: pw.FlexColumnWidth(2),
          1: pw.FlexColumnWidth(3),
        },
        children: <pw.TableRow>[
          for (int i = 0; i < rows.length; i++)
            pw.TableRow(
              decoration:
                  i.isOdd ? const pw.BoxDecoration(color: _zebra) : null,
              children: <pw.Widget>[
                pw.Padding(
                  padding: const pw.EdgeInsets.all(5),
                  child: pw.Text(
                    rows[i][0],
                    style: const pw.TextStyle(fontSize: 9, color: _muted),
                  ),
                ),
                pw.Padding(
                  padding: const pw.EdgeInsets.all(5),
                  child: pw.Text(
                    rows[i][1],
                    style: const pw.TextStyle(fontSize: 9.5, color: _body),
                  ),
                ),
              ],
            ),
        ],
      );

  String num2(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

  final List<List<String>> details = <List<String>>[
    <String>[
      l10n.handoverTypeLabel,
      record.handoverType == null
          ? notRecorded
          : handoverTypeLabel(l10n, record.handoverType!),
    ],
    <String>[
      l10n.handoverFromDriverLabel,
      (record.fromDriver ?? '').trim().isEmpty
          ? notRecorded
          : record.fromDriver!.trim(),
    ],
    <String>[
      l10n.handoverToDriverLabel,
      (record.toDriver ?? '').trim().isEmpty
          ? notRecorded
          : record.toDriver!.trim(),
    ],
    <String>[
      l10n.handoverOdometerLabel,
      record.odometerKm == null
          ? notRecorded
          : '${num2(record.odometerKm!)} km',
    ],
    <String>[
      l10n.handoverFuelLabel,
      record.fuelLevelPct == null
          ? notRecorded
          : '${num2(record.fuelLevelPct!)}%',
    ],
    <String>[
      l10n.handoverConditionLabel,
      record.conditionRating == null
          ? notRecorded
          : handoverConditionLabel(l10n, record.conditionRating!),
    ],
    <String>[
      l10n.handoverCleanlinessLabel,
      record.cleanliness == null
          ? notRecorded
          : handoverCleanlinessLabel(l10n, record.cleanliness!),
    ],
    <String>[
      l10n.handoverCapturedLabel,
      _formatDateTime(record.handoverAt ?? record.createdAt) ?? notRecorded,
    ],
    <String>[
      l10n.handoverStatusColumn,
      handoverStatusText(l10n, record.approvalStatus),
    ],
  ];

  final List<pw.Widget> damageBlock = <pw.Widget>[];
  if (record.damages.isNotEmpty) {
    damageBlock
      ..add(
        sectionTitle(
          '${l10n.handoverDamageSectionTitle} (${record.effectiveDamageCount})',
        ),
      )
      ..add(
        pw.TableHelper.fromTextArray(
          headers: <String>[
            l10n.handoverViewColumn,
            l10n.handoverDamageColumn,
            l10n.handoverLevelColumn,
            l10n.handoverNotesLabel,
          ],
          data: <List<String>>[
            for (final HandoverDamageMarker m in record.damages)
              <String>[
                handoverDamageViewLabel(l10n, m.view),
                handoverDamageTypeLabel(l10n, m.type),
                handoverDamageLevelLabel(l10n, m.level),
                (m.note ?? '').trim().isEmpty ? notRecorded : m.note!.trim(),
              ],
          ],
          headerStyle: const pw.TextStyle(
            fontSize: 9,
            fontWeight: pw.FontWeight.bold,
            color: _ink,
          ),
          cellStyle: const pw.TextStyle(fontSize: 9, color: _body),
          headerDecoration: const pw.BoxDecoration(color: _zebra),
          border: const pw.TableBorder(
            horizontalInside: pw.BorderSide(color: _line, width: 0.5),
            bottom: pw.BorderSide(color: _line, width: 0.5),
            top: pw.BorderSide(color: _line, width: 0.5),
          ),
          cellAlignment:
              rtl ? pw.Alignment.centerRight : pw.Alignment.centerLeft,
        ),
      );
  }

  pw.Widget signatureCard(String role, String? name, String? signature) {
    final Uint8List? bytes = _signatureBytes(signature);
    return pw.Expanded(
      child: pw.Container(
        margin: const pw.EdgeInsets.only(right: 6),
        padding: const pw.EdgeInsets.all(8),
        decoration: pw.BoxDecoration(
          border: pw.Border.all(color: _line, width: 0.5),
          borderRadius: pw.BorderRadius.circular(4),
        ),
        child: pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: <pw.Widget>[
            pw.Container(
              height: 44,
              alignment: pw.Alignment.center,
              child: bytes == null
                  ? pw.Text(
                      l10n.handoverPdfSignaturePending,
                      style: const pw.TextStyle(fontSize: 8, color: _muted),
                    )
                  : pw.Image(pw.MemoryImage(bytes), height: 40),
            ),
            pw.Divider(color: _line, height: 6),
            pw.Text(
              role,
              style: const pw.TextStyle(
                fontSize: 8,
                fontWeight: pw.FontWeight.bold,
                color: _ink,
              ),
            ),
            if ((name ?? '').trim().isNotEmpty)
              pw.Text(
                name!.trim(),
                style: const pw.TextStyle(fontSize: 8, color: _body),
              ),
          ],
        ),
      ),
    );
  }

  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(32),
      textDirection: direction,
      footer: (pw.Context context) => pw.Container(
        alignment: rtl ? pw.Alignment.centerLeft : pw.Alignment.centerRight,
        child: pw.Text(
          '${context.pageNumber} / ${context.pagesCount}',
          style: const pw.TextStyle(fontSize: 8, color: _muted),
        ),
      ),
      build: (pw.Context context) => <pw.Widget>[
        pw.Container(
          padding: const pw.EdgeInsets.only(bottom: 10),
          decoration: const pw.BoxDecoration(
            border: pw.Border(bottom: pw.BorderSide(color: _accent, width: 2)),
          ),
          child: pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: <pw.Widget>[
              pw.Text(
                l10n.handoverPdfTitle,
                style: const pw.TextStyle(
                  fontSize: 18,
                  fontWeight: pw.FontWeight.bold,
                  color: _ink,
                ),
              ),
              pw.SizedBox(height: 4),
              pw.Text(
                '${l10n.handoverDocumentNoLabel}: '
                '${record.documentNo ?? notRecorded}',
                style: const pw.TextStyle(fontSize: 10, color: _body),
              ),
              pw.Text(
                record.assetNo.isEmpty ? notRecorded : record.assetNo,
                style: const pw.TextStyle(fontSize: 10, color: _body),
              ),
              pw.Text(
                l10n.handoverPdfGenerated(
                  _formatDateTime(generatedAt) ?? '',
                ),
                style: const pw.TextStyle(fontSize: 9, color: _muted),
              ),
            ],
          ),
        ),
        pw.SizedBox(height: 6),
        sectionTitle(l10n.handoverPdfDetailsTitle),
        factTable(details),
        ...damageBlock,
        if ((record.notes ?? '').trim().isNotEmpty) ...<pw.Widget>[
          sectionTitle(l10n.handoverNotesLabel),
          pw.Text(
            record.notes!.trim(),
            style: const pw.TextStyle(fontSize: 9.5, color: _body),
          ),
        ],
        if (record.photos.isNotEmpty) ...<pw.Widget>[
          pw.SizedBox(height: 10),
          pw.Text(
            '${l10n.handoverPhotosLabel}: ${record.photos.length}',
            style: const pw.TextStyle(fontSize: 9, color: _muted),
          ),
        ],
        sectionTitle(l10n.handoverPdfSignaturesTitle),
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: <pw.Widget>[
            signatureCard(
              l10n.handoverRungDriver,
              record.fromDriver,
              record.signatureUrl,
            ),
            signatureCard(
              l10n.handoverRungSupervisor,
              record.supervisorName,
              record.supervisorSignature,
            ),
            signatureCard(
              l10n.handoverRungIncharge,
              record.inchargeName,
              record.inchargeSignature,
            ),
          ],
        ),
      ],
    ),
  );
  return document.save();
}

/// The outcome of a share attempt, so the screen can tell the user plainly.
enum HandoverShareResult { shared, sharedInEnglish, failed }

/// Loads fonts, renders [record] and opens the platform share sheet. Never
/// throws; returns what actually happened.
Future<HandoverShareResult> shareHandoverPdf({
  required BuildContext context,
  required HandoverRecord record,
  DateTime Function() clock = DateTime.now,
}) async {
  final String language = Localizations.localeOf(context).languageCode;
  AppLocalizations l10n = AppLocalizations.of(context);
  final bool wantsArabicScript = language == 'ar' || language == 'ur';
  try {
    pw.Font? arabic;
    pw.Font? arabicBold;
    try {
      arabic = await PdfGoogleFonts.notoNaskhArabicRegular()
          .timeout(const Duration(seconds: 10));
      arabicBold = await PdfGoogleFonts.notoNaskhArabicBold()
          .timeout(const Duration(seconds: 10));
    } on Object {
      arabic = null;
      arabicBold = null;
    }
    final bool rtl = wantsArabicScript && arabic != null;
    if (wantsArabicScript && arabic == null) {
      l10n = await AppLocalizations.delegate.load(const Locale('en'));
    }
    final Uint8List bytes = await buildHandoverPdf(
      record: record,
      l10n: l10n,
      generatedAt: clock(),
      base: rtl ? arabic : null,
      bold: rtl ? arabicBold : null,
      fallback: !rtl && arabic != null ? <pw.Font>[arabic] : const <pw.Font>[],
      rtl: rtl,
    );
    final String fileName =
        'handover_${record.documentNo ?? record.id}.pdf'.replaceAll(' ', '_');
    await Printing.sharePdf(bytes: bytes, filename: fileName);
    return wantsArabicScript && !rtl
        ? HandoverShareResult.sharedInEnglish
        : HandoverShareResult.shared;
  } on Object {
    return HandoverShareResult.failed;
  }
}

/// Decodes a `data:image/...;base64,...` signature to bytes, or null when the
/// value is absent, not a data URL, or not an image (a `tp-storage://` ref is
/// not fetched here - a signature is always captured as a local data URL).
Uint8List? _signatureBytes(String? value) {
  final String v = (value ?? '').trim();
  if (v.isEmpty) return null;
  final Uri? uri = Uri.tryParse(v);
  if (uri == null || uri.scheme.toLowerCase() != 'data') return null;
  try {
    final UriData? data = uri.data;
    if (data == null || !data.mimeType.toLowerCase().startsWith('image/')) {
      return null;
    }
    return Uint8List.fromList(data.contentAsBytes());
  } on FormatException {
    return null;
  }
}

String? _formatDateTime(Object? value) {
  final DateTime? parsed = switch (value) {
    final DateTime d => d,
    final String s when s.isNotEmpty => DateTime.tryParse(s),
    _ => null,
  };
  if (parsed == null) return null;
  final DateTime local = parsed.toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${local.year.toString().padLeft(4, '0')}-${two(local.month)}-'
      '${two(local.day)} ${two(local.hour)}:${two(local.minute)}';
}
