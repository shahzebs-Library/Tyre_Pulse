/// One logged damage on a vehicle at handover, and the JSON shape it is stored
/// under inside `handover_reports.damages` (a jsonb array).
///
/// The backend contract fixes the per-marker shape as `view / x / y / type /
/// level / note / photo_url`. This value object carries exactly those fields.
/// `x` and `y` are the fractional position (0..1) of a marker placed on a
/// vehicle outline and are OPTIONAL: a marker captured from the list editor
/// (type / level / note, no tap coordinates) leaves them null rather than
/// inventing a position, and a reader must treat a null coordinate as "logged,
/// but not placed on the diagram", never as (0, 0). `photo_url` holds a durable
/// `tp-storage://bucket/path` reference once its photo has uploaded, or a local
/// device path until then.
///
/// Pure value type, no Flutter, so the modifier is `final class` rather than
/// `@immutable` - the same choice `handover_approval.dart` makes for the same
/// reason.
library;

/// The vehicle faces a marker can sit on. The key is what is written to
/// `damages[].view`; the label is localised in the UI through a `handover*`
/// l10n key, never from this string.
enum HandoverDamageView {
  front('front'),
  rear('rear'),
  left('left'),
  right('right'),
  top('top');

  const HandoverDamageView(this.key);

  /// The value stored in `damages[].view`.
  final String key;

  /// Parses a stored value back to a view, or null when it is not one this app
  /// version models. A reader never guesses - an unknown view is dropped from
  /// the picker but PRESERVED on the raw marker so a round trip loses nothing.
  static HandoverDamageView? fromKey(String? raw) {
    final String value = raw?.trim().toLowerCase() ?? '';
    for (final HandoverDamageView view in HandoverDamageView.values) {
      if (view.key == value) return view;
    }
    return null;
  }
}

/// The kind of damage. `other` is the honest bucket for anything the picker
/// does not name; it is not a placeholder.
enum HandoverDamageType {
  scratch('scratch'),
  dent('dent'),
  crack('crack'),
  chip('chip'),
  broken('broken'),
  missing('missing'),
  rust('rust'),
  other('other');

  const HandoverDamageType(this.key);

  final String key;

  static HandoverDamageType? fromKey(String? raw) {
    final String value = raw?.trim().toLowerCase() ?? '';
    for (final HandoverDamageType type in HandoverDamageType.values) {
      if (type.key == value) return type;
    }
    return null;
  }
}

/// How bad the damage is. Drives the marker's colour on the diagram and the
/// severity chip in the list.
enum HandoverDamageLevel {
  minor('minor'),
  moderate('moderate'),
  severe('severe');

  const HandoverDamageLevel(this.key);

  final String key;

  static HandoverDamageLevel? fromKey(String? raw) {
    final String value = raw?.trim().toLowerCase() ?? '';
    for (final HandoverDamageLevel level in HandoverDamageLevel.values) {
      if (level.key == value) return level;
    }
    return null;
  }
}

/// One logged damage.
final class HandoverDamageMarker {
  const HandoverDamageMarker({
    required this.view,
    required this.type,
    required this.level,
    this.x,
    this.y,
    this.note,
    this.photoUrl,
    this.photoLocalPath,
  });

  final HandoverDamageView view;
  final HandoverDamageType type;
  final HandoverDamageLevel level;

  /// Fractional 0..1 position on the vehicle outline for [view], or null when
  /// this marker was logged from the list editor rather than placed by tap.
  final double? x;
  final double? y;

  final String? note;

  /// A durable `tp-storage://bucket/path` reference once uploaded. Null when
  /// there is no photo for this marker.
  final String? photoUrl;

  /// A device path to a still-local photo not yet uploaded. Never written to
  /// the server row - the sync engine swaps it for [photoUrl] first. Kept out
  /// of [toJson]'s `photo_url` so a local path can never reach `damages`.
  final String? photoLocalPath;

  HandoverDamageMarker copyWith({
    HandoverDamageView? view,
    HandoverDamageType? type,
    HandoverDamageLevel? level,
    double? x,
    bool clearX = false,
    double? y,
    bool clearY = false,
    String? note,
    bool clearNote = false,
    String? photoUrl,
    bool clearPhotoUrl = false,
    String? photoLocalPath,
    bool clearPhotoLocalPath = false,
  }) {
    return HandoverDamageMarker(
      view: view ?? this.view,
      type: type ?? this.type,
      level: level ?? this.level,
      x: clearX ? null : (x ?? this.x),
      y: clearY ? null : (y ?? this.y),
      note: clearNote ? null : (note ?? this.note),
      photoUrl: clearPhotoUrl ? null : (photoUrl ?? this.photoUrl),
      photoLocalPath:
          clearPhotoLocalPath ? null : (photoLocalPath ?? this.photoLocalPath),
    );
  }

  /// The `damages[]` entry, in the contract shape. [photoLocalPath] is
  /// deliberately NOT written: only a durable [photoUrl] belongs on the server.
  Map<String, Object?> toJson() => <String, Object?>{
        'view': view.key,
        'x': x,
        'y': y,
        'type': type.key,
        'level': level.key,
        'note': (note == null || note!.trim().isEmpty) ? null : note!.trim(),
        'photo_url': photoUrl,
      };

  /// Reads one `damages[]` entry. An unparseable view/type/level falls back to
  /// a safe default (front / other / minor) rather than throwing, so one bad
  /// marker cannot make a whole handover unreadable.
  static HandoverDamageMarker fromJson(Map<String, Object?> json) {
    return HandoverDamageMarker(
      view: HandoverDamageView.fromKey(json['view'] as String?) ??
          HandoverDamageView.front,
      type: HandoverDamageType.fromKey(json['type'] as String?) ??
          HandoverDamageType.other,
      level: HandoverDamageLevel.fromKey(json['level'] as String?) ??
          HandoverDamageLevel.minor,
      x: (json['x'] as num?)?.toDouble(),
      y: (json['y'] as num?)?.toDouble(),
      note: json['note']?.toString(),
      photoUrl: json['photo_url']?.toString(),
    );
  }

  /// Reads a whole `damages` jsonb value (expected to be a list). Anything that
  /// is not a list yields an empty set - a handover with no `damages` and a
  /// handover with a malformed one both honestly read as "no damage logged".
  static List<HandoverDamageMarker> listFromJson(Object? raw) {
    if (raw is! List) return const <HandoverDamageMarker>[];
    final List<HandoverDamageMarker> markers = <HandoverDamageMarker>[];
    for (final Object? item in raw) {
      if (item is Map) {
        markers
            .add(HandoverDamageMarker.fromJson(item.cast<String, Object?>()));
      }
    }
    return markers;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is HandoverDamageMarker &&
          other.view == view &&
          other.type == type &&
          other.level == level &&
          other.x == x &&
          other.y == y &&
          other.note == note &&
          other.photoUrl == photoUrl &&
          other.photoLocalPath == photoLocalPath);

  @override
  int get hashCode =>
      Object.hash(view, type, level, x, y, note, photoUrl, photoLocalPath);

  @override
  String toString() =>
      'HandoverDamageMarker(${view.key}/${type.key}/${level.key})';
}
