/// Who is signed in, as far as crash reporting is allowed to know.
///
/// Deliberately only an opaque user id and two coarse tags. No email, no
/// name, no username, no phone: spec section 59 limits telemetry to what is
/// needed to find the person's reports again, and the id is enough - the
/// Console joins it to the profile under its own access rules.
library;

final class TelemetryUser {
  const TelemetryUser({required this.id, this.role, this.country});

  /// `auth.users.id` / `profiles.id`.
  final String id;

  /// The role token (e.g. `tyre_man`), or the stored role name for a custom
  /// role. Null when none.
  final String? role;

  /// `all`, a single country, or a comma-joined list. Null when none.
  final String? country;

  @override
  bool operator ==(Object other) =>
      other is TelemetryUser &&
      other.id == id &&
      other.role == role &&
      other.country == country;

  @override
  int get hashCode => Object.hash(id, role, country);
}
