/// Which picture the signed-out login screen shows for each login country.
///
/// An administrator chooses this on the web console (Console -> Mobile App ->
/// Login pictures). The choice is stored in `system_config.mobile_login_hero`
/// as a JSON object `{"saudi_arabia": "fleet_machines", ...}` and read before
/// sign-in through the anon-safe `get_public_config` RPC.
///
/// Only artwork BUNDLED in the app can be chosen: the login screen has no
/// guaranteed network. An absent, unknown or malformed value always falls
/// back to each country's own landmark, so a bad setting can never blank the
/// screen.
///
/// MIRROR: `src/lib/mobileLoginArt.js` on the web carries the same keys.
/// Change both together.
library;

import 'dart:convert';

import 'package:flutter/painting.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';

/// The `system_config` key the administrator writes.
const String loginArtworkConfigKey = 'mobile_login_hero';

/// A login artwork bundled in `assets/login/`.
enum LoginArtwork {
  saudiLandmark(
    'saudi_landmark',
    'assets/login/saudi_arabia_hero.png',
    Alignment(0, 0.86),
  ),
  uaeLandmark(
    'uae_landmark',
    'assets/login/united_arab_emirates_hero.png',
    Alignment(0, 0.66),
  ),
  egyptLandmark(
    'egypt_landmark',
    'assets/login/egypt_hero.png',
    Alignment(0, 0.84),
  ),
  fleetMachines(
    'fleet_machines',
    'assets/login/united_arab_emirates_pmv_hero.webp',
    Alignment(0.2, 0.3),
  );

  const LoginArtwork(this.configValue, this.assetPath, this.compactAlignment);

  /// Stable value stored by the web console.
  final String configValue;

  /// Bundled asset drawn for this artwork.
  final String assetPath;

  /// Where the composition is anchored inside the compact (phone) hero so the
  /// subject sits above the form's curved edge.
  final Alignment compactAlignment;

  /// Decodes a stored value; null for absent or unknown values.
  static LoginArtwork? fromConfigValue(Object? value) {
    for (final LoginArtwork art in LoginArtwork.values) {
      if (art.configValue == value) return art;
    }
    return null;
  }

  /// Each country's own landmark, used whenever nothing valid is configured.
  static LoginArtwork defaultFor(LoginCountry country) => switch (country) {
        LoginCountry.saudiArabia => LoginArtwork.saudiLandmark,
        LoginCountry.unitedArabEmirates => LoginArtwork.uaeLandmark,
        LoginCountry.egypt => LoginArtwork.egyptLandmark,
      };
}

/// The resolved per-country choice. Immutable; unknown countries fall back.
final class LoginArtworkChoice {
  const LoginArtworkChoice(this._byCountry);

  /// Every country on its own landmark.
  static const LoginArtworkChoice defaults =
      LoginArtworkChoice(<LoginCountry, LoginArtwork>{});

  final Map<LoginCountry, LoginArtwork> _byCountry;

  /// The artwork to draw for [country].
  LoginArtwork forCountry(LoginCountry country) =>
      _byCountry[country] ?? LoginArtwork.defaultFor(country);

  /// Parses the raw `system_config.value`. Accepts a decoded map, a JSON
  /// string, or a JSON string that was itself JSON-quoted (the table stores
  /// text, and both shapes exist in this codebase). Anything unreadable
  /// yields [defaults]; an unknown artwork key for one country only resets
  /// that country.
  static LoginArtworkChoice parse(Object? raw) {
    Object? value = raw;
    for (int i = 0; i < 2 && value is String; i++) {
      try {
        value = jsonDecode(value);
      } on FormatException {
        return defaults;
      }
    }
    if (value is! Map) return defaults;
    final Map<LoginCountry, LoginArtwork> out = <LoginCountry, LoginArtwork>{};
    for (final LoginCountry country in LoginCountry.values) {
      final LoginArtwork? art =
          LoginArtwork.fromConfigValue(value[country.storageValue]);
      if (art != null) out[country] = art;
    }
    return LoginArtworkChoice(
      Map<LoginCountry, LoginArtwork>.unmodifiable(out),
    );
  }

  /// Stable JSON for the local cache.
  String toJson() => jsonEncode(<String, String>{
        for (final MapEntry<LoginCountry, LoginArtwork> e in _byCountry.entries)
          e.key.storageValue: e.value.configValue,
      });

  @override
  bool operator ==(Object other) =>
      other is LoginArtworkChoice &&
      LoginCountry.values.every(
        (LoginCountry c) => other.forCountry(c) == forCountry(c),
      );

  @override
  int get hashCode => Object.hashAll(LoginCountry.values.map(forCountry));
}
