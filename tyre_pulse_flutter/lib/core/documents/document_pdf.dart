/// Lays the spec-driven document models out on A4 with the `pdf` package.
///
/// The models (`charge_document.dart`, `handover_document.dart`) already hold
/// every word and value in spec order; this file only draws them, mirroring
/// the section shapes of the web renderers (`src/lib/driverChargePdf.js`,
/// `src/lib/vehicleHandoverPdf.js`). Like the web, the paper is English: the
/// spec labels and the server statements are English text. Arabic-script
/// values (a driver's name) need a fallback font, passed by the caller.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:tyre_pulse/core/documents/charge_document.dart';
import 'package:tyre_pulse/core/documents/handover_document.dart';

const PdfColor _ink = PdfColor.fromInt(0xFF111827);
const PdfColor _ghost = PdfColor.fromInt(0xFF6B7280);
const PdfColor _silver = PdfColor.fromInt(0xFFD1D5DB);
const PdfColor _offWhite = PdfColor.fromInt(0xFFF8FAFC);
const PdfColor _steel = PdfColor.fromInt(0xFF475569);
const PdfColor _accent = PdfColor.fromInt(0xFF15803D);

/// A signature value as an image widget: a PNG/JPEG `data:` URL or SVG
/// markup. Null when it cannot be drawn.
pw.Widget? signatureImageWidget(
  String? value, {
  double height = 40,
  double? width,
}) {
  final String v = (value ?? '').trim();
  if (v.isEmpty) return null;
  if (v.toLowerCase().startsWith('<svg')) {
    try {
      return pw.SvgImage(svg: v, height: height, width: width);
    } on Object {
      return null;
    }
  }
  final Uri? uri = Uri.tryParse(v);
  final UriData? data = uri?.data;
  if (data == null || !data.mimeType.toLowerCase().startsWith('image/')) {
    return null;
  }
  try {
    final Uint8List bytes = Uint8List.fromList(data.contentAsBytes());
    if (data.mimeType.toLowerCase().contains('svg')) {
      return pw.SvgImage(svg: utf8.decode(bytes), height: height, width: width);
    }
    return pw.Image(pw.MemoryImage(bytes), height: height, width: width);
  } on Object {
    return null;
  }
}

PdfPageFormat _format(Map<String, Object?> page) {
  final double margin =
      ((page['margin'] as num?)?.toDouble() ?? 14) * PdfPageFormat.mm;
  final PdfPageFormat base = PdfPageFormat.a4.copyWith(
    marginLeft: margin,
    marginRight: margin,
    marginTop: margin,
    marginBottom: margin,
  );
  return page['orientation'] == 'landscape' ? base.landscape : base;
}

pw.Widget _gridTable(
  List<List<String>> rows, {
  List<String>? head,
  double labelWidth = 0,
  double fontSize = 8,
}) {
  final pw.TextStyle body = pw.TextStyle(fontSize: fontSize, color: _ink);
  return pw.Table(
    border: pw.TableBorder.all(color: _silver, width: 0.4),
    columnWidths: labelWidth > 0
        ? <int, pw.TableColumnWidth>{
            0: pw.FixedColumnWidth(labelWidth),
            1: const pw.FlexColumnWidth(),
          }
        : null,
    children: <pw.TableRow>[
      if (head != null)
        pw.TableRow(
          decoration: const pw.BoxDecoration(color: _steel),
          children: <pw.Widget>[
            for (final String h in head)
              pw.Padding(
                padding: const pw.EdgeInsets.all(4),
                child: pw.Text(
                  h,
                  style: pw.TextStyle(
                    fontSize: fontSize,
                    color: PdfColors.white,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              ),
          ],
        ),
      for (final List<String> row in rows)
        pw.TableRow(
          children: <pw.Widget>[
            for (int i = 0; i < row.length; i++)
              pw.Padding(
                padding: const pw.EdgeInsets.all(4),
                child: pw.Text(
                  row[i],
                  style: labelWidth > 0 && i == 0
                      ? body.copyWith(fontWeight: pw.FontWeight.bold)
                      : body,
                ),
              ),
          ],
        ),
    ],
  );
}

pw.Widget _title(String text, {double size = 11}) => pw.Padding(
      padding: const pw.EdgeInsets.only(top: 10, bottom: 4),
      child: pw.Text(
        text,
        style: pw.TextStyle(
          fontSize: size,
          fontWeight: pw.FontWeight.bold,
          color: _ink,
        ),
      ),
    );

/// The Driver Charge Notice, laid out like `renderDriverChargePdf`.
Future<Uint8List> renderChargeNoticePdf(
  ChargeDocumentModel model, {
  List<pw.Font> fontFallback = const <pw.Font>[],
}) {
  final pw.Document doc = pw.Document(
    title: model.title,
    theme: pw.ThemeData.withFont(fontFallback: fontFallback),
  );
  final String footerText = model.footerLines.join(' ');
  doc.addPage(
    pw.MultiPage(
      pageFormat: _format(model.page),
      footer: (pw.Context context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: <pw.Widget>[
          pw.Text(
            footerText,
            style: const pw.TextStyle(fontSize: 7, color: _ghost),
          ),
          pw.SizedBox(height: 3),
          pw.Row(
            mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
            children: <pw.Widget>[
              pw.Text(
                model.documentNumber,
                style: const pw.TextStyle(fontSize: 7),
              ),
              pw.Text(
                model.pageNumber
                    .replaceAll('{page}', '${context.pageNumber}')
                    .replaceAll('{pages}', '${context.pagesCount}'),
                style: const pw.TextStyle(fontSize: 7),
              ),
            ],
          ),
        ],
      ),
      build: (pw.Context context) => <pw.Widget>[
        pw.Text(
          model.title,
          style: const pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold),
        ),
        pw.SizedBox(height: 4),
        for (final String line in model.headerLines)
          pw.Text(line, style: const pw.TextStyle(fontSize: 9)),
        for (final ChargeDocumentSection s in model.sections) ...<pw.Widget>[
          _title(s.title),
          if (s.type == 'text')
            pw.Text(s.text ?? '', style: const pw.TextStyle(fontSize: 9))
          else if (s.type == 'fields')
            _gridTable(s.rows ?? const <List<String>>[], labelWidth: 150)
          else if (s.empty != null)
            pw.Text(s.empty!, style: const pw.TextStyle(fontSize: 9))
          else
            _gridTable(
              s.body ?? const <List<String>>[],
              head: s.head,
              fontSize: 7.5,
            ),
        ],
        _title(model.signatureTitle),
        if (model.signatures.isEmpty)
          pw.Text(model.signatureEmpty, style: const pw.TextStyle(fontSize: 9)),
        for (final ChargeDocumentSignature s in model.signatures)
          pw.Container(
            margin: const pw.EdgeInsets.only(top: 6),
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: <pw.Widget>[
                pw.Text(
                  s.heading,
                  style: const pw.TextStyle(
                    fontSize: 9,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.SizedBox(height: 2),
                pw.Text(
                  '${s.statement} (${s.statementVersion})',
                  style: const pw.TextStyle(fontSize: 8),
                ),
                pw.SizedBox(height: 4),
                signatureImageWidget(s.image, height: 55, width: 180) ??
                    pw.Text(
                      s.imageMissing,
                      style: const pw.TextStyle(fontSize: 8),
                    ),
                pw.SizedBox(height: 4),
                _gridTable(s.rows, labelWidth: 150, fontSize: 7.5),
              ],
            ),
          ),
      ],
    ),
  );
  return doc.save();
}

/// The Vehicle Handover Authorization, laid out like `exportHandoverPdf`.
/// [verifyOrigin] prefixes the QR target (`https://host`); no QR without it.
Future<Uint8List> renderHandoverPdf(
  HandoverDocumentModel model, {
  String? company,
  String? verifyOrigin,
  List<pw.Font> fontFallback = const <pw.Font>[],
}) {
  final pw.Document doc = pw.Document(
    title: model.title,
    theme: pw.ThemeData.withFont(fontFallback: fontFallback),
  );
  final String? qr = verifyOrigin != null && model.qrTarget != null
      ? '$verifyOrigin${model.qrTarget}'
      : null;

  pw.Widget sectionBar(String title) => pw.Container(
        margin: const pw.EdgeInsets.only(top: 12, bottom: 5),
        padding: const pw.EdgeInsets.only(left: 6),
        decoration: const pw.BoxDecoration(
          border: pw.Border(left: pw.BorderSide(color: _accent, width: 2.5)),
        ),
        child: pw.Text(
          title,
          style: const pw.TextStyle(
            fontSize: 10.5,
            fontWeight: pw.FontWeight.bold,
            color: _ink,
          ),
        ),
      );

  pw.Widget card(pw.Widget child) => pw.Container(
        width: double.infinity,
        padding: const pw.EdgeInsets.all(6),
        decoration: pw.BoxDecoration(
          color: _offWhite,
          border: pw.Border.all(color: _silver, width: 0.4),
          borderRadius: pw.BorderRadius.circular(4),
        ),
        child: child,
      );

  List<pw.Widget> section(HandoverDocumentSection s) {
    switch (s.type) {
      case 'fields':
        return <pw.Widget>[
          sectionBar(s.title),
          card(_gridTable(s.rows, labelWidth: 110)),
        ];
      case 'tiles':
        return <pw.Widget>[
          sectionBar(s.title),
          pw.Row(
            children: <pw.Widget>[
              for (int i = 0; i < s.rows.length; i++) ...<pw.Widget>[
                if (i > 0) pw.SizedBox(width: 6),
                pw.Expanded(
                  child: card(
                    pw.Column(
                      children: <pw.Widget>[
                        pw.Text(
                          s.rows[i][1],
                          style: const pw.TextStyle(
                            fontSize: 12,
                            fontWeight: pw.FontWeight.bold,
                          ),
                        ),
                        pw.Text(
                          s.rows[i][0],
                          style: const pw.TextStyle(fontSize: 7),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ];
      case 'damage_views':
        return <pw.Widget>[
          sectionBar('${s.title}  (${s.rows.length} marked)'),
          if (s.rows.isEmpty)
            pw.Text(s.emptyText ?? '', style: const pw.TextStyle(fontSize: 9))
          else
            _gridTable(s.rows, head: s.tableHead, fontSize: 8),
        ];
      case 'photos':
        // The app keeps photos as private storage references; the paper
        // states how many are attached (the web embeds them).
        if (s.count == 0) return const <pw.Widget>[];
        return <pw.Widget>[
          sectionBar('${s.title} (${s.count})'),
          pw.Text(
            '${s.count} attached. Open the handover in the app to view them.',
            style: const pw.TextStyle(fontSize: 8, color: _ghost),
          ),
        ];
      case 'location':
        return <pw.Widget>[
          sectionBar(s.title),
          card(
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: <pw.Widget>[
                for (int i = 0; i < s.lines.length; i++)
                  i == s.lines.length - 1 && s.link != null
                      ? pw.UrlLink(
                          destination: s.link!,
                          child: pw.Text(
                            s.lines[i],
                            style: const pw.TextStyle(
                              fontSize: 7.5,
                              color: PdfColors.blue800,
                            ),
                          ),
                        )
                      : pw.Text(
                          s.lines[i],
                          style: pw.TextStyle(
                            fontSize: i == 0 ? 8.5 : 7.5,
                            fontWeight: i == 0 ? pw.FontWeight.bold : null,
                          ),
                        ),
              ],
            ),
          ),
        ];
      case 'signatures':
        return <pw.Widget>[
          sectionBar(s.title),
          if (s.note != null)
            pw.Text(
              s.note!,
              style: const pw.TextStyle(
                fontSize: 6.8,
                color: _ghost,
                fontStyle: pw.FontStyle.italic,
              ),
            ),
          pw.SizedBox(height: 4),
          pw.Row(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: <pw.Widget>[
              for (int i = 0; i < s.blocks.length; i++) ...<pw.Widget>[
                if (i > 0) pw.SizedBox(width: 8),
                pw.Expanded(
                  child: card(
                    pw.Column(
                      crossAxisAlignment: pw.CrossAxisAlignment.start,
                      children: <pw.Widget>[
                        pw.Text(
                          s.blocks[i].title,
                          style: const pw.TextStyle(
                            fontSize: 8,
                            fontWeight: pw.FontWeight.bold,
                          ),
                        ),
                        pw.Container(
                          height: 38,
                          margin: const pw.EdgeInsets.symmetric(vertical: 3),
                          color: PdfColors.white,
                          alignment: pw.Alignment.center,
                          child: signatureImageWidget(
                                s.blocks[i].signature,
                                height: 34,
                              ) ??
                              pw.Text(
                                s.blocks[i].sub,
                                style: const pw.TextStyle(
                                  fontSize: 7,
                                  color: _ghost,
                                ),
                              ),
                        ),
                        pw.Text(
                          s.blocks[i].name ?? 'Not recorded',
                          style: const pw.TextStyle(
                            fontSize: 8,
                            fontWeight: pw.FontWeight.bold,
                          ),
                        ),
                        pw.Text(
                          s.blocks[i].sub,
                          style: const pw.TextStyle(fontSize: 7, color: _ghost),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ];
    }
    return const <pw.Widget>[];
  }

  doc.addPage(
    pw.MultiPage(
      pageFormat: _format(model.page),
      header: (pw.Context context) => pw.Container(
        padding: const pw.EdgeInsets.only(bottom: 4),
        margin: const pw.EdgeInsets.only(bottom: 6),
        decoration: const pw.BoxDecoration(
          border: pw.Border(bottom: pw.BorderSide(color: _accent, width: 1.5)),
        ),
        child: pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: <pw.Widget>[
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: <pw.Widget>[
                pw.Text(
                  model.title,
                  style: const pw.TextStyle(
                    fontSize: 16,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                if ((company ?? '').isNotEmpty)
                  pw.Text(
                    company!,
                    style: const pw.TextStyle(fontSize: 7.5, color: _ghost),
                  ),
              ],
            ),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: <pw.Widget>[
                for (final String line in model.headerLines)
                  pw.Text(
                    line,
                    style: const pw.TextStyle(fontSize: 7, color: _ghost),
                  ),
                pw.SizedBox(height: 2),
                pw.Text(
                  model.statusWord,
                  style: const pw.TextStyle(
                    fontSize: 7.5,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
      footer: (pw.Context context) => pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.end,
        children: <pw.Widget>[
          pw.Expanded(
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: <pw.Widget>[
                pw.Text(
                  '${model.title}${(company ?? '').isEmpty ? '' : '  |  $company'}',
                  style: const pw.TextStyle(fontSize: 6.8, color: _ghost),
                ),
                if (model.lockedNote != null)
                  pw.Text(
                    model.lockedNote!,
                    style: const pw.TextStyle(fontSize: 6.8, color: _ghost),
                  ),
              ],
            ),
          ),
          pw.Text(
            'Page ${context.pageNumber} of ${context.pagesCount}',
            style: const pw.TextStyle(fontSize: 6.8, color: _ghost),
          ),
          if (qr != null) ...<pw.Widget>[
            pw.SizedBox(width: 8),
            pw.BarcodeWidget(
              barcode: pw.Barcode.qrCode(),
              data: qr,
              width: 30,
              height: 30,
            ),
            pw.SizedBox(width: 4),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: <pw.Widget>[
                for (final String c in model.qrCaption)
                  pw.Text(
                    c,
                    style: const pw.TextStyle(fontSize: 5.8, color: _ghost),
                  ),
              ],
            ),
          ],
        ],
      ),
      build: (pw.Context context) => <pw.Widget>[
        for (final HandoverDocumentSection s in model.sections) ...section(s),
      ],
    ),
  );
  return doc.save();
}
