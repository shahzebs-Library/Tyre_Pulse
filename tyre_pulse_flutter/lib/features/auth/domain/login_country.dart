/// The country presentation selected for the signed-out login experience.
///
/// This value is deliberately NOT a workspace country. It must never be used
/// for RLS filters, permission checks, profile selection, authentication, or
/// any other business-data scope. The authenticated workspace continues to be
/// resolved exclusively from the signed-in user's profile and permissions.
enum LoginCountry {
  saudiArabia('saudi_arabia'),
  unitedArabEmirates('united_arab_emirates'),
  egypt('egypt');

  const LoginCountry(this.storageValue);

  /// Stable device-storage value. Enum names are not persisted so a harmless
  /// Dart rename cannot silently lose a user's selection.
  final String storageValue;

  /// Decodes a stored value, returning null for absent or future values.
  ///
  /// Treating an unknown value as "not selected" makes upgrades and
  /// downgrades safe: the UI can ask again instead of guessing a country.
  static LoginCountry? fromStorageValue(String? value) {
    for (final LoginCountry country in LoginCountry.values) {
      if (country.storageValue == value) {
        return country;
      }
    }
    return null;
  }
}
