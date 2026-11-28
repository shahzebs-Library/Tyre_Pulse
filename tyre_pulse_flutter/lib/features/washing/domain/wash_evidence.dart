/// Audit evidence for one wash photo: which stage it belongs to, when it
/// was taken on the device and, when the phone could tell, where.
///
/// # Where this is stored
///
/// `wash_records.photos` stays the ordered list of photo references (before
/// first, then after). The matching evidence goes inside the existing
/// `wash_details` jsonb as `photo_evidence`, one entry per photo with the
/// same `index` as its position in `photos`. The live CHECK
/// `valid_wash_details` does not refuse extra keys, so no migration is
/// needed. The time and place are metadata next to the photo, not text
/// burned into the pixels.
library;

/// Before or after the wash.
enum WashShotStage { before, after }

/// One captured photo plus its stamp.
final class WashShot {
  const WashShot({
    required this.path,
    required this.stage,
    required this.takenAt,
    this.latitude,
    this.longitude,
    this.accuracyMeters,
  });

  /// Local file path while drafting; a storage reference once read back.
  final String path;
  final WashShotStage stage;

  /// Device time the photo was taken, UTC.
  final DateTime takenAt;
  final double? latitude;
  final double? longitude;
  final double? accuracyMeters;

  bool get hasGps => latitude != null && longitude != null;

  Map<String, Object?> toJson(int index) => <String, Object?>{
        'index': index,
        'stage': stage.name,
        'taken_at': takenAt.toUtc().toIso8601String(),
        if (hasGps) 'lat': _round(latitude!),
        if (hasGps) 'lng': _round(longitude!),
        if (hasGps && accuracyMeters != null)
          'accuracy_m': accuracyMeters!.round(),
      };

  static double _round(double v) => (v * 1e6).roundToDouble() / 1e6;
}

/// The `photo_evidence` list for [before] then [after], indexed the same as
/// the saved `photos` list.
List<Map<String, Object?>> washPhotoEvidence(
  List<WashShot> before,
  List<WashShot> after,
) {
  final List<WashShot> all = <WashShot>[...before, ...after];
  return <Map<String, Object?>>[
    for (int i = 0; i < all.length; i++) all[i].toJson(i),
  ];
}

/// True when the wash has at least one before and one after photo, the
/// minimum the audit team accepts.
bool washPhotosComplete(List<WashShot> before, List<WashShot> after) =>
    before.isNotEmpty && after.isNotEmpty;

/// Reads the saved evidence back, pairing each entry with its photo
/// reference. Photos with no evidence entry (older records) get none.
List<({String ref, WashShot? shot})> washShotsFromRecord(
  List<String>? photos,
  Map<String, dynamic>? details,
) {
  final Map<int, Map<String, dynamic>> byIndex = <int, Map<String, dynamic>>{};
  final Object? raw = details?['photo_evidence'];
  if (raw is List) {
    for (final Object? e in raw) {
      if (e is Map<String, dynamic> && e['index'] is int) {
        byIndex[e['index'] as int] = e;
      }
    }
  }
  final List<String> refs = photos ?? const <String>[];
  return <({String ref, WashShot? shot})>[
    for (int i = 0; i < refs.length; i++)
      (ref: refs[i], shot: _shotFrom(refs[i], byIndex[i])),
  ];
}

WashShot? _shotFrom(String ref, Map<String, dynamic>? e) {
  if (e == null) return null;
  final DateTime? at = DateTime.tryParse(e['taken_at'] as String? ?? '');
  if (at == null) return null;
  return WashShot(
    path: ref,
    stage: e['stage'] == 'after' ? WashShotStage.after : WashShotStage.before,
    takenAt: at,
    latitude: (e['lat'] as num?)?.toDouble(),
    longitude: (e['lng'] as num?)?.toDouble(),
    accuracyMeters: (e['accuracy_m'] as num?)?.toDouble(),
  );
}

/// `24.71360, 46.67530` style, five decimals (about a metre). Wrapped in a
/// left-to-right isolate so Arabic and Urdu layouts keep latitude first.
String washGpsLabel(WashShot shot) =>
    '\u2066${shot.latitude!.toStringAsFixed(5)}, '
    '${shot.longitude!.toStringAsFixed(5)}\u2069';

/// Local `YYYY-MM-DD HH:MM` for a stamp.
String washStampTime(DateTime t) {
  final DateTime l = t.toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '\u2066${l.year}-${two(l.month)}-${two(l.day)} '
      '${two(l.hour)}:${two(l.minute)}\u2069';
}
