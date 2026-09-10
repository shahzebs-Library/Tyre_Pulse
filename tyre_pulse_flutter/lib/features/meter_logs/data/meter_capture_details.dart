enum MeterEntrySource { manual, photo }

/// A rollback is an anomalous reading, never negative distance travelled.
num? distanceSinceLastReading(num? current, num? previous) {
  if (current == null ||
      previous == null ||
      !current.isFinite ||
      !previous.isFinite ||
      current < previous ||
      previous < 0) {
    return null;
  }
  return current - previous;
}

String meterCaptureNotes(String? notes, MeterEntrySource source) {
  final text = notes?.trim() ?? '';
  final detail = source == MeterEntrySource.manual
      ? 'Odometer entry source: manually read from gauge.'
      : 'Odometer entry source: manually transcribed from photo.';
  return text.isEmpty ? detail : '$text\n$detail';
}
