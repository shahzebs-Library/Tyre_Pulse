/// Renders and shares the "Accident case summary" PDF.
///
/// Content comes from [AccidentCaseSummary] (real `accidents` and
/// `accident_case_workstreams` rows only). Blanks print "Not recorded", a
/// missing progress figure never becomes 0%, and an unprovisioned workstream
/// model is stated rather than drawn as an empty table. Same contract as the
/// web `src/lib/accidentCasePdf.js`.
///
/// Arabic and Urdu need an Arabic-script font, which the app does not bundle.
/// The share action tries to load Noto Naskh Arabic; when that is not
/// possible (a field device with no signal) the document is rendered in
/// English instead of printing blank boxes, and the caller is told so.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart' show DateFormat, NumberFormat;
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_summary.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart'
    show workstreamLabel;

/// Every string and formatter the renderer needs, resolved for one language.
final class AccidentCaseSummaryText {
  AccidentCaseSummaryText({
    required this.copy,
    required this.l10n,
    required this.localeTag,
  });

  final AccidentCopy copy;
  final AppLocalizations l10n;
  final String localeTag;

  String label(String key) => copy(key);

  String get notRecorded => copy('notRecorded');

  String date(String raw) {
    final DateTime? parsed = DateTime.tryParse(raw.trim());
    if (parsed == null) return raw.trim();
    return _format(() => DateFormat('d MMM y', localeTag).format(parsed), () {
      return _iso(parsed).substring(0, 10);
    });
  }

  String dateTime(DateTime value) => _format(
        () => DateFormat('d MMM y, HH:mm', localeTag).format(value),
        () => _iso(value),
      );

  String money(num value) => _format(
        () => NumberFormat('#,##0.00', localeTag).format(value),
        () => value.toStringAsFixed(2),
      );

  /// Locale symbols are loaded by the Material localizations delegate; when a
  /// document is rendered where they are not (a background isolate, a test),
  /// the value still prints, as a plain ISO date or number.
  static String _format(String Function() localized, String Function() plain) {
    try {
      return localized();
    } on Object {
      return plain();
    }
  }

  static String _iso(DateTime value) {
    String two(int n) => n.toString().padLeft(2, '0');
    return '${value.year}-${two(value.month)}-${two(value.day)} '
        '${two(value.hour)}:${two(value.minute)}';
  }

  String value(AccidentSummaryLine line) {
    if (line.isBlank) return notRecorded;
    return switch (line.kind) {
      AccidentSummaryValueKind.money => money(line.number!),
      AccidentSummaryValueKind.count => '${line.number}',
      AccidentSummaryValueKind.yesNo => line.flag! ? l10n.accYes : l10n.accNo,
      AccidentSummaryValueKind.date => date(line.text!),
      AccidentSummaryValueKind.token => humaniseAccidentToken(line.text),
      AccidentSummaryValueKind.text => line.text!.trim(),
    };
  }

  String chip(AccidentWorkstreamChip chip) => switch (chip) {
        AccidentWorkstreamChip.done => copy('done'),
        AccidentWorkstreamChip.inProgress => copy('inProgress'),
        AccidentWorkstreamChip.pending => copy('pending'),
        AccidentWorkstreamChip.notRequired => copy('notRequired'),
      };

  String percent(num? value) {
    if (value == null) return notRecorded;
    final num clamped = value.clamp(0, 100);
    return '${clamped.round()}%';
  }
}

const PdfColor _ink = PdfColor.fromInt(0xFF0F172A);
const PdfColor _body = PdfColor.fromInt(0xFF334155);
const PdfColor _muted = PdfColor.fromInt(0xFF64748B);
const PdfColor _line = PdfColor.fromInt(0xFFE2E8F0);
const PdfColor _zebra = PdfColor.fromInt(0xFFF8FAFC);
const PdfColor _accent = PdfColor.fromInt(0xFF15803D);

/// Pure renderer: returns the PDF bytes. [base]/[bold] are required for
/// Arabic or Urdu text; [fallback] lets an English document still draw
/// Arabic-script values (driver names, sites) when the font is available.
Future<Uint8List> buildAccidentCaseSummaryPdf({
  required AccidentCaseSummary summary,
  required AccidentCaseSummaryText text,
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
  final pw.Document document = pw.Document(
    title: text.l10n.accCaseSummaryTitle,
    theme: theme,
  );
  final pw.TextDirection direction =
      rtl ? pw.TextDirection.rtl : pw.TextDirection.ltr;

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

  final List<pw.Widget> workstreamBlock = <pw.Widget>[
    sectionTitle(text.l10n.accCaseSummaryWorkstreams),
  ];
  if (!summary.workstreamsProvisioned) {
    workstreamBlock.add(
      pw.Text(
        text.label('notActivatedMessage'),
        style: const pw.TextStyle(fontSize: 9.5, color: _muted),
      ),
    );
  } else if (summary.workstreams.isEmpty) {
    workstreamBlock.add(
      pw.Text(
        text.label('noWorkstreamsMessage'),
        style: const pw.TextStyle(fontSize: 9.5, color: _muted),
      ),
    );
  } else {
    workstreamBlock.add(
      pw.TableHelper.fromTextArray(
        headers: <String>[
          text.l10n.accCaseSummaryWorkstreamColumn,
          text.l10n.accCaseSummaryTeamColumn,
          text.l10n.accCaseSummaryStatusColumn,
          text.l10n.accCaseSummaryProgressColumn,
        ],
        data: <List<String>>[
          for (final AccidentSummaryWorkstream ws in summary.workstreams)
            <String>[
              workstreamLabel(text.copy, ws.key),
              (ws.team?.trim().isEmpty ?? true)
                  ? text.notRecorded
                  : humaniseAccidentToken(ws.team),
              ws.chip == AccidentWorkstreamChip.notRequired &&
                      (ws.naReason?.trim().isNotEmpty ?? false)
                  ? '${text.chip(ws.chip)}: ${ws.naReason!.trim()}'
                  : text.chip(ws.chip),
              text.percent(ws.progressPct),
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
        cellAlignment: rtl ? pw.Alignment.centerRight : pw.Alignment.centerLeft,
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
                text.l10n.accCaseSummaryTitle,
                style: const pw.TextStyle(
                  fontSize: 18,
                  fontWeight: pw.FontWeight.bold,
                  color: _ink,
                ),
              ),
              pw.SizedBox(height: 4),
              pw.Text(
                '${text.label('caseId')}: ${summary.reference}',
                style: const pw.TextStyle(fontSize: 10, color: _body),
              ),
              pw.Text(
                text.l10n.accCaseSummaryGenerated(text.dateTime(generatedAt)),
                style: const pw.TextStyle(fontSize: 9, color: _muted),
              ),
            ],
          ),
        ),
        pw.SizedBox(height: 6),
        factTable(<List<String>>[
          <String>[
            text.l10n.accCaseSummaryOverallCompletion,
            text.percent(summary.completionOverall),
          ],
          <String>[
            text.l10n.accCaseSummaryEvidencePhotos,
            '${summary.photoCount}',
          ],
        ]),
        for (final AccidentSummarySection section
            in summary.sections) ...<pw.Widget>[
          sectionTitle(text.label(section.titleKey)),
          factTable(<List<String>>[
            for (final AccidentSummaryLine line in section.lines)
              <String>[text.label(line.labelKey), text.value(line)],
          ]),
        ],
        ...workstreamBlock,
      ],
    ),
  );
  return document.save();
}

/// The outcome of a share attempt, so the screen can tell the user plainly.
enum AccidentCaseSummaryShareResult { shared, sharedInEnglish, failed }

/// Loads fonts, renders the summary for [snapshot] and opens the platform
/// share sheet. Never throws; returns what actually happened.
Future<AccidentCaseSummaryShareResult> shareAccidentCaseSummaryPdf(
  BuildContext context,
  AccidentCaseSnapshot snapshot, {
  DateTime Function() clock = DateTime.now,
}) async {
  final String language = Localizations.localeOf(context).languageCode;
  final String localeTag = Localizations.localeOf(context).toLanguageTag();
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
    String textLanguage = language;
    String textLocale = localeTag;
    if (wantsArabicScript && arabic == null) {
      l10n = await AppLocalizations.delegate.load(const Locale('en'));
      textLanguage = 'en';
      textLocale = 'en';
    }
    final AccidentCaseSummaryText text = AccidentCaseSummaryText(
      copy: AccidentCopy.forLocalizations(l10n, textLanguage),
      l10n: l10n,
      localeTag: textLocale,
    );
    final AccidentCaseSummary summary =
        AccidentCaseSummary.fromSnapshot(snapshot);
    final Uint8List bytes = await buildAccidentCaseSummaryPdf(
      summary: summary,
      text: text,
      generatedAt: clock(),
      base: rtl ? arabic : null,
      bold: rtl ? arabicBold : null,
      fallback: !rtl && arabic != null ? <pw.Font>[arabic] : const <pw.Font>[],
      rtl: rtl,
    );
    await Printing.sharePdf(bytes: bytes, filename: summary.fileName);
    return wantsArabicScript && !rtl
        ? AccidentCaseSummaryShareResult.sharedInEnglish
        : AccidentCaseSummaryShareResult.shared;
  } on Object {
    return AccidentCaseSummaryShareResult.failed;
  }
}
