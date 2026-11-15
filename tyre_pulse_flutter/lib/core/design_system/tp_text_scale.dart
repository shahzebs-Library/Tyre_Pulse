/// Growing a fixed-size tile with the person's text size.
///
/// Several tiles in the approved mocks have a fixed height (a stat card in a
/// grid, a wash-type tile, a maintenance action tile). A fixed height is
/// correct at the default text size and wrong at a large one: Android's
/// "Font size" setting goes to 2.0, the label grows and the tile does not, so
/// the content overflows its box. Measured at 360 dp wide with text scale 2.0:
/// 70 px on the tyre stat cards, 28 px on the maintenance tiles and 24 px on
/// the wash-type tiles.
///
/// These helpers keep the mock's size exactly at the default scale (so the
/// pixel goldens do not move) and add room only as the text grows.
library;

import 'package:flutter/widgets.dart';

/// The ambient text scale as a plain factor, clamped to `1.0 .. 2.5`.
///
/// Never below 1: a person who shrinks their text does not need a tile to
/// shrink below the size the layout was designed at.
double tpTextScaleFactor(BuildContext context) {
  final double factor = MediaQuery.textScalerOf(context).scale(100) / 100;
  if (factor.isNaN || factor < 1) {
    return 1;
  }
  return factor > 2.5 ? 2.5 : factor;
}

/// [base] plus the extra height [textHeight] logical pixels of text need at
/// the ambient text scale.
///
/// [textHeight] is how much of the tile's height is TEXT at the default
/// scale (its line heights added up). Only that part grows; icons, padding
/// and gaps stay as designed. At scale 1.0 the result is exactly [base].
double tpTextScaledExtent(
  BuildContext context, {
  required double base,
  required double textHeight,
}) =>
    base + (tpTextScaleFactor(context) - 1) * textHeight;
