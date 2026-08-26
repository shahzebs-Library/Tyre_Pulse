library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_records_page.dart';

TyreRecord _r(String id) => TyreRecord(id: id);

void main() {
  group('TyreRecordsPage.empty', () {
    test('has no items and reports no further page', () {
      expect(TyreRecordsPage.empty.items, isEmpty);
      expect(TyreRecordsPage.empty.hasMore, isFalse);
    });
  });

  group('equality', () {
    test('two pages with the same items and hasMore are equal', () {
      final TyreRecordsPage a = TyreRecordsPage(
        items: <TyreRecord>[_r('1'), _r('2')],
        hasMore: true,
      );
      final TyreRecordsPage b = TyreRecordsPage(
        items: <TyreRecord>[_r('1'), _r('2')],
        hasMore: true,
      );
      expect(a, b);
    });

    test('a different hasMore makes two otherwise-identical pages unequal', () {
      final TyreRecordsPage a = TyreRecordsPage(
        items: <TyreRecord>[_r('1')],
        hasMore: true,
      );
      final TyreRecordsPage b = TyreRecordsPage(
        items: <TyreRecord>[_r('1')],
        hasMore: false,
      );
      expect(a, isNot(equals(b)));
    });

    test('a different item order makes two pages unequal - order is part '
        'of what this type represents', () {
      final TyreRecordsPage a = TyreRecordsPage(
        items: <TyreRecord>[_r('1'), _r('2')],
        hasMore: false,
      );
      final TyreRecordsPage b = TyreRecordsPage(
        items: <TyreRecord>[_r('2'), _r('1')],
        hasMore: false,
      );
      expect(a, isNot(equals(b)));
    });
  });
}
