import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_summary.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_pdf.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_copy.dart';

void main() {
  late AccidentCaseSummaryText text;

  setUpAll(() async {
    await initializeDateFormatting('en');
    final AppLocalizations l10n =
        await AppLocalizations.delegate.load(const Locale('en'));
    text = AccidentCaseSummaryText(
      copy: AccidentCopy.forLocalizations(l10n, 'en'),
      l10n: l10n,
      localeTag: 'en',
    );
  });

  test('blank lines read Not recorded, never 0', () {
    const AccidentSummaryLine money = AccidentSummaryLine(
      labelKey: 'claimed',
      kind: AccidentSummaryValueKind.money,
    );
    const AccidentSummaryLine flag = AccidentSummaryLine(
      labelKey: 'injuries',
      kind: AccidentSummaryValueKind.yesNo,
    );
    expect(text.value(money), text.notRecorded);
    expect(text.value(flag), text.notRecorded);
    expect(text.percent(null), text.notRecorded);
    expect(text.notRecorded, 'Not recorded');
  });

  test('recorded values are formatted, including a recorded zero', () {
    expect(
      text.value(
        const AccidentSummaryLine(
          labelKey: 'claimed',
          kind: AccidentSummaryValueKind.money,
          number: 0,
        ),
      ),
      '0.00',
    );
    expect(
      text.value(
        const AccidentSummaryLine(
          labelKey: 'injuries',
          kind: AccidentSummaryValueKind.yesNo,
          flag: false,
        ),
      ),
      'No',
    );
    expect(
      text.value(
        const AccidentSummaryLine(
          labelKey: 'severity',
          kind: AccidentSummaryValueKind.token,
          text: 'tyre_failure',
        ),
      ),
      'Tyre Failure',
    );
  });

  test('formats without loaded locale data instead of throwing', () {
    final AccidentCaseSummaryText bare = AccidentCaseSummaryText(
      copy: text.copy,
      l10n: text.l10n,
      localeTag: 'xx-unloaded',
    );
    expect(bare.dateTime(DateTime(2026, 9, 28, 7, 5)), isNotEmpty);
    expect(bare.money(12.5), isNotEmpty);
  });

  test('renders a real PDF document for a case', () async {
    final AccidentCaseSummary summary = AccidentCaseSummary.fromSnapshot(
      const AccidentCaseSnapshot(
        accident: AccidentRecord(
          id: 'acc-9',
          assetNo: 'TM-9',
          site: 'Dammam',
          incidentDate: '2026-09-04',
          referenceNo: 'ACC-2026-0199',
          insurer: 'Recorded insurer',
          claimAmount: 1500.5,
        ),
        provisioned: true,
        workstreams: <AccidentWorkstream>[
          AccidentWorkstream(id: 'w', key: 'insurance', status: 'in_progress'),
        ],
      ),
    );
    final Uint8List bytes = await buildAccidentCaseSummaryPdf(
      summary: summary,
      text: text,
      generatedAt: DateTime(2026, 9, 28, 10, 30),
    );
    expect(bytes.length, greaterThan(1000));
    expect(ascii.decode(bytes.sublist(0, 5)), '%PDF-');
  });
}
