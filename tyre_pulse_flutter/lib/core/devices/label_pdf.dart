/// The PDF route for labels: used when no thermal printer is set up, or the
/// label carries Arabic/Urdu text a printer font cannot draw. Opens the
/// system print dialog (AirPrint, Android print services, or save as PDF).
library;

import 'dart:typed_data';

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:tyre_pulse/core/devices/label_encoder.dart';

Future<Uint8List> buildLabelPdf(
  LabelData label, {
  LabelSize size = LabelSize.mm50x25,
  List<pw.Font> fallbackFonts = const <pw.Font>[],
}) async {
  final pw.Document doc = pw.Document();
  final PdfPageFormat format = PdfPageFormat(
    size.widthMm * PdfPageFormat.mm,
    size.heightMm * PdfPageFormat.mm,
    marginAll: 2 * PdfPageFormat.mm,
  );
  final double qr = (size.heightMm - 6) * PdfPageFormat.mm;
  doc.addPage(
    pw.Page(
      pageFormat: format,
      theme: pw.ThemeData.withFont(fontFallback: fallbackFonts),
      build: (pw.Context context) => pw.Row(
        children: <pw.Widget>[
          pw.BarcodeWidget(
            barcode: pw.Barcode.qrCode(),
            data: label.code,
            width: qr,
            height: qr,
          ),
          pw.SizedBox(width: 2 * PdfPageFormat.mm),
          pw.Expanded(
            child: pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              mainAxisAlignment: pw.MainAxisAlignment.center,
              children: <pw.Widget>[
                pw.Text(
                  label.code,
                  maxLines: 1,
                  style: const pw.TextStyle(fontSize: 10),
                ),
                pw.SizedBox(height: 1),
                pw.Text(
                  label.name,
                  maxLines: 3,
                  style: const pw.TextStyle(fontSize: 7),
                ),
                if (label.caption != null && label.caption!.trim().isNotEmpty)
                  pw.Text(
                    label.caption!,
                    maxLines: 1,
                    style: const pw.TextStyle(fontSize: 6),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  return doc.save();
}

/// Opens the system print dialog for [label]. Returns false if cancelled.
Future<bool> printLabelPdf(LabelData label, {LabelSize? size}) async {
  final LabelSize s = size ?? LabelSize.mm50x25;
  List<pw.Font> fonts = const <pw.Font>[];
  if (labelNeedsUnicodeFont(label)) {
    try {
      fonts = <pw.Font>[await PdfGoogleFonts.notoNaskhArabicRegular()];
    } on Object {
      // Prints without the fallback font.
    }
  }
  final Uint8List bytes =
      await buildLabelPdf(label, size: s, fallbackFonts: fonts);
  return Printing.layoutPdf(
    name: 'label-${label.code}',
    format: PdfPageFormat(
      s.widthMm * PdfPageFormat.mm,
      s.heightMm * PdfPageFormat.mm,
    ),
    onLayout: (_) async => bytes,
  );
}
