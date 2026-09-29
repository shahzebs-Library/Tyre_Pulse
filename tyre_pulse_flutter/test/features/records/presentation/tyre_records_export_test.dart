import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/presentation/tyre_records_export.dart';

import '../records_test_support.dart';

void main() {
  late AppLocalizations l10n;

  setUpAll(() async {
    l10n = await AppLocalizations.delegate.load(const Locale('en'));
  });

  test('headers follow the row order', () {
    expect(tyreRecordsExportHeaders(l10n), <String>[
      'Serial number',
      'Brand',
      'Size',
      'Asset',
      'Position',
      'Site',
      'Status',
      'Issue date',
    ]);
  });

  test('a missing value stays blank, never invented', () {
    final List<List<String>> rows = tyreRecordsExportRows(<TyreRecord>[
      buildTyreRecord(
        id: '1',
        assetNo: 'TM514',
        serialNo: 'YMA55312',
        brand: 'TRIANGLE',
        tyrePosition: 'LHF1',
        status: 'Active',
      ),
      buildTyreRecord(id: '2', assetNo: null),
    ]);
    expect(rows.first, <String>[
      'YMA55312',
      'TRIANGLE',
      '',
      'TM514',
      'LHF1',
      '',
      'Active',
      '',
    ]);
    expect(rows.last.every((String cell) => cell.isEmpty), isTrue);
  });

  test('the note states loaded rows against the server total', () {
    expect(
      l10n.tyreRecordsExportNote(20, 1284),
      '20 of 1284 tyre records loaded on this device',
    );
  });
}
