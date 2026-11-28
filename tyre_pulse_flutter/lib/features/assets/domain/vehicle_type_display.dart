/// How a raw `vehicle_type` token reads on screen.
///
/// The register stores machine tokens (`WHEEL_LOADER`, `TR-MIXER`). A title
/// such as "WL049 - WHEEL_LOADER" leaks the storage spelling to the user, so
/// every place that SHOWS a vehicle type goes through [vehicleTypeDisplay].
/// The raw value is still what is recorded and compared - this is display
/// only, never a key.
library;

/// The display form of [raw], or null when [raw] is blank.
///
/// A token that carries underscores is a snake_case storage key: the
/// underscores become spaces and each word is title-cased ("WHEEL_LOADER" ->
/// "Wheel Loader"). Anything else is returned trimmed and otherwise
/// untouched - hyphenated fleet codes such as "TR-MIXER" or "BT-PLANT" are
/// the fleet's own names and are not re-cased.
String? vehicleTypeDisplay(String? raw) {
  final String value = raw?.trim() ?? '';
  if (value.isEmpty) return null;
  if (!value.contains('_')) return value;
  return value
      .split('_')
      .where((String part) => part.trim().isNotEmpty)
      .map((String part) {
    final String word = part.trim().toLowerCase();
    return '${word[0].toUpperCase()}${word.substring(1)}';
  }).join(' ');
}
