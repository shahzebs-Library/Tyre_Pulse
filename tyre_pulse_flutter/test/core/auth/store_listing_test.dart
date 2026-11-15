// The update-required screen must open the store of the platform it runs on.
// An iPhone is never sent to Google Play (App Store review: no links to other
// stores), and with no App Store id configured there is no link at all.

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/auth_providers.dart';
import 'package:tyre_pulse/core/auth/store_listing.dart';

void main() {
  group('storeListingFor', () {
    test('Android opens the Play listing of this package', () {
      final StoreListing? listing = storeListingFor(TargetPlatform.android);

      expect(listing, isNotNull);
      expect(
        listing!.primary.toString(),
        'market://details?id=com.shahzebrahman.tyrepulse',
      );
      expect(
        listing.fallback.toString(),
        'https://play.google.com/store/apps/details?id=com.shahzebrahman.tyrepulse',
      );
    });

    test('iOS with a real id opens the App Store, never Google Play', () {
      final StoreListing? listing = storeListingFor(
        TargetPlatform.iOS,
        appStoreId: '1234567890',
      );

      expect(listing, isNotNull);
      expect(
        listing!.primary.toString(),
        'itms-apps://apps.apple.com/app/id1234567890',
      );
      expect(
        listing.fallback.toString(),
        'https://apps.apple.com/app/id1234567890',
      );
      expect(listing.primary.toString(), isNot(contains('google')));
      expect(listing.fallback.toString(), isNot(contains('google')));
    });

    test('iOS with no id has no listing at all', () {
      expect(storeListingFor(TargetPlatform.iOS, appStoreId: ''), isNull);
      expect(storeListingFor(TargetPlatform.iOS, appStoreId: '   '), isNull);
    });

    test('iOS refuses an id that is not a plain number', () {
      for (final String bad in <String>[
        'id1234567890',
        '12345',
        '1234567890/evil',
        'com.shahzebrahman.tyrepulse',
        '1234567890123',
      ]) {
        expect(
          storeListingFor(TargetPlatform.iOS, appStoreId: bad),
          isNull,
          reason: bad,
        );
      }
    });

    test('a surrounding space in the id is tolerated', () {
      expect(
        storeListingFor(TargetPlatform.iOS, appStoreId: ' 1234567890 ')
            ?.fallback
            .toString(),
        'https://apps.apple.com/app/id1234567890',
      );
    });

    test('desktop platforms have no store to open', () {
      for (final TargetPlatform platform in <TargetPlatform>[
        TargetPlatform.macOS,
        TargetPlatform.windows,
        TargetPlatform.linux,
        TargetPlatform.fuchsia,
      ]) {
        expect(storeListingFor(platform), isNull, reason: '$platform');
      }
    });
  });

  group('defaultOpenStoreAction', () {
    test('offers an action on Android', () {
      expect(
        defaultOpenStoreAction(platform: TargetPlatform.android),
        isNotNull,
      );
    });

    test('offers no action on iOS until the App Store id is configured', () {
      expect(
        defaultOpenStoreAction(platform: TargetPlatform.iOS, appStoreId: ''),
        isNull,
      );
      expect(
        defaultOpenStoreAction(
          platform: TargetPlatform.iOS,
          appStoreId: '1234567890',
        ),
        isNotNull,
      );
    });
  });
}
