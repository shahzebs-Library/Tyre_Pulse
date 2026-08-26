/// Layout scale.
///
/// Spec section 53 asks for two things that pull against each other: compact
/// information density and large enough touch targets for gloved, dusty hands.
/// The resolution used here is a tight 4pt SPACING scale with a generous
/// minimum HIT target - dense layout, big hit boxes. Padding shrinks; the
/// tappable area does not.
library;

/// The 4pt spacing scale. Do not introduce a value between these.
abstract final class TpSpace {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;
  static const double huge = 40;
}

/// Corner radii.
abstract final class TpRadius {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double pill = 999;
}

/// Border widths. Spec section 53: elevation is expressed with a hairline
/// border because shadow is invisible in direct sun.
abstract final class TpBorderWidth {
  static const double hairline = 1;
  static const double strong = 2;
}

/// Interaction sizing.
abstract final class TpSizing {
  /// The minimum comfortable touch target. Ported from `HIT` in
  /// `mobile/lib/theme.ts`. Material's own minimum is 48 and this must never
  /// drop below it.
  static const double minTouchTarget = 48;

  /// Height of the standard primary control.
  static const double controlHeight = 52;

  /// Height of the compact control used inside dense rows.
  static const double controlHeightCompact = 40;

  /// Icon size used inside controls and chips.
  static const double iconSm = 16;
  static const double iconMd = 20;
  static const double iconLg = 24;

  /// Icon size used by full-screen state views.
  static const double iconState = 44;

  /// The width a state view's prose is allowed to reach. Long measures are
  /// hard to scan at arm's length.
  static const double stateMaxWidth = 420;
}
