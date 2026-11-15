/// Which store listing the "Update required" screen may open, per platform.
///
/// Apple rejects an app that points an iPhone user at another store, and the
/// first version of this gate opened the Google Play listing everywhere. This
/// file is the one place that decides the link, as a pure function of the
/// platform so it can be tested without a device.
///
/// The App Store id is NOT known to this repository (it is assigned by App
/// Store Connect), so it is read from the `APP_STORE_ID` dart-define. When it
/// is absent or malformed there is no link at all on iOS: the caller hides the
/// button and the screen tells the user to update from the App Store. An
/// invented id would open somebody else's app.
library;

import 'package:flutter/foundation.dart';

/// The numeric App Store id of this app, supplied at build time with
/// `--dart-define=APP_STORE_ID=<digits>`. Empty when not supplied.
const String kAppStoreId = String.fromEnvironment('APP_STORE_ID');

/// The Play Store package of THIS app (the Flutter package, not the retired
/// Expo `...inspector` package).
const String kPlayPackage = 'com.shahzebrahman.tyrepulse';

/// A store listing: the store app's own link, and the web link to fall back
/// to when the store app cannot open it.
@immutable
class StoreListing {
  const StoreListing({required this.primary, required this.fallback});

  final Uri primary;
  final Uri fallback;
}

final RegExp _appStoreIdPattern = RegExp(r'^\d{6,12}$');

/// The listing to open on [platform], or null when there is none to offer.
///
/// - Android: the Play listing (`market://`, then the https page).
/// - iOS: the App Store page, only when [appStoreId] is a real numeric id.
/// - anything else: null. No store is known for it.
StoreListing? storeListingFor(
  TargetPlatform platform, {
  String appStoreId = kAppStoreId,
}) {
  switch (platform) {
    case TargetPlatform.android:
      return StoreListing(
        primary: Uri.parse('market://details?id=$kPlayPackage'),
        fallback: Uri.parse(
          'https://play.google.com/store/apps/details?id=$kPlayPackage',
        ),
      );
    case TargetPlatform.iOS:
      final String id = appStoreId.trim();
      if (!_appStoreIdPattern.hasMatch(id)) return null;
      return StoreListing(
        primary: Uri.parse('itms-apps://apps.apple.com/app/id$id'),
        fallback: Uri.parse('https://apps.apple.com/app/id$id'),
      );
    case TargetPlatform.fuchsia:
    case TargetPlatform.linux:
    case TargetPlatform.macOS:
    case TargetPlatform.windows:
      return null;
  }
}
