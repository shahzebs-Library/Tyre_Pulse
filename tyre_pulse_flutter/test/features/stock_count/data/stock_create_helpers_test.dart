import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/profile/data/account_deletion_repository.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_repository.dart';

/// Pins the Flutter mirrors of the Expo helpers in `mobile/lib/stock.ts`
/// (`composeStockDescription`, `statusFor`) and
/// `mobile/lib/accountDeletion.ts` (the trimmed reason).
void main() {
  group('composeStockDescription', () {
    test('size leads the free text', () {
      expect(
        composeStockDescription('315/80R22.5', 'Double Coin'),
        '315/80R22.5 Double Coin',
      );
    });
    test('does not double a size the user already typed', () {
      expect(
        composeStockDescription('315/80R22.5', '315/80r22.5 Triangle'),
        '315/80r22.5 Triangle',
      );
    });
    test('size alone, or text alone', () {
      expect(composeStockDescription(' 385/65R22.5 ', ''), '385/65R22.5');
      expect(composeStockDescription('', 'Spare'), 'Spare');
    });
  });

  group('stockStatusFor', () {
    test('a missing threshold never marks a row Low or Critical', () {
      expect(stockStatusFor(0, null, null), 'OK');
    });
    test('critical wins over low', () {
      expect(stockStatusFor(2, 5, 3), 'Critical');
      expect(stockStatusFor(4, 5, 3), 'Low');
      expect(stockStatusFor(9, 5, 3), 'OK');
    });
  });

  test('a blank deletion reason is stored as null, not an empty string', () {
    expect(accountDeletionReason('   '), isNull);
    expect(accountDeletionReason(null), isNull);
    expect(accountDeletionReason('  leaving  '), 'leaving');
  });
}
