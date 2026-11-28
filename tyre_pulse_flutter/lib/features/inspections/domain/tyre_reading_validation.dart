/// Input rules for the per-wheel pressure and tread fields.
///
/// Two levels, deliberately separate:
///
/// * a HARD range ([kTyrePressureMaxPsi], [kTyreTreadMaxMm]) outside which
///   the value cannot be a tyre reading at all (a typo such as `1100`), so
///   it is refused and not stored;
/// * a TYPICAL range, outside which the value is accepted and stored but the
///   inspector is warned to check it (a flat tyre really can read 0 psi).
///
/// There is no stored target pressure per vehicle in the schema, so the
/// typical bands are generic tyre bounds, never a fleet "recommended"
/// figure.
library;

const double kTyrePressureMaxPsi = 200;
const double kTyreTreadMaxMm = 30;
const double kTyrePressureTypicalMinPsi = 20;
const double kTyrePressureTypicalMaxPsi = 150;
const double kTyreTreadTypicalMinMm = 1;
const double kTyreTreadTypicalMaxMm = 25;

enum TyreReadingInputState { empty, ok, unusual, invalidNumber, outOfRange }

/// The parsed value plus how the editor should treat it. [value] is set
/// for [TyreReadingInputState.ok] and [TyreReadingInputState.unusual] only.
class TyreReadingInput {
  const TyreReadingInput(this.state, [this.value]);

  final TyreReadingInputState state;
  final double? value;

  bool get isStorable =>
      state == TyreReadingInputState.ok ||
      state == TyreReadingInputState.unusual;
}

TyreReadingInput checkTyrePressure(String raw) => _check(
      raw,
      max: kTyrePressureMaxPsi,
      typicalMin: kTyrePressureTypicalMinPsi,
      typicalMax: kTyrePressureTypicalMaxPsi,
    );

TyreReadingInput checkTyreTread(String raw) => _check(
      raw,
      max: kTyreTreadMaxMm,
      typicalMin: kTyreTreadTypicalMinMm,
      typicalMax: kTyreTreadTypicalMaxMm,
    );

TyreReadingInput _check(
  String raw, {
  required double max,
  required double typicalMin,
  required double typicalMax,
}) {
  // A comma decimal (8,5) is how many phones in the region type it.
  final String text = raw.trim().replaceAll(',', '.');
  if (text.isEmpty) return const TyreReadingInput(TyreReadingInputState.empty);
  final double? value = double.tryParse(text);
  if (value == null || value.isNaN || value.isInfinite) {
    return const TyreReadingInput(TyreReadingInputState.invalidNumber);
  }
  if (value < 0 || value > max) {
    return const TyreReadingInput(TyreReadingInputState.outOfRange);
  }
  if (value < typicalMin || value > typicalMax) {
    return TyreReadingInput(TyreReadingInputState.unusual, value);
  }
  return TyreReadingInput(TyreReadingInputState.ok, value);
}

/// Serial numbers compare without case or spacing: `ym a55312` is the same
/// tyre as `YMA55312`.
String normaliseTyreSerial(String? serial) =>
    (serial ?? '').toUpperCase().replaceAll(RegExp(r'\s+'), '');

/// True when [typed] names a different tyre from [onRecord]. Empty on
/// either side is never a difference (nothing typed, or nothing on record).
bool serialDiffersFromRecord(String? typed, String? onRecord) {
  final String a = normaliseTyreSerial(typed);
  final String b = normaliseTyreSerial(onRecord);
  return a.isNotEmpty && b.isNotEmpty && a != b;
}

/// Km run since fitment, from recorded values only. `null` unless both are
/// known and the current reading is not below the fitment reading.
double? kmRunSinceFitment({double? currentOdometerKm, double? kmAtFitment}) {
  if (currentOdometerKm == null || kmAtFitment == null) return null;
  final double run = currentOdometerKm - kmAtFitment;
  return run < 0 ? null : run;
}
