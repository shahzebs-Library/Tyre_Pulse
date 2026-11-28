# Tyre condition pictures

One PNG per condition, named exactly:

`good.png`, `worn.png`, `damaged.png`, `puncture.png`, `flat.png`, `missing.png`

`*.png` here are the 1x files (256 px); `2.0x/` holds the 512 px versions
Flutter picks on high-density screens. Square, transparent background.

The inspection tyre editor (`tyre_position_editor_sheet.dart`,
`tyreConditionImageAsset`) shows the picture on the condition tile and falls
back to the drawn glyph when a file is missing. The badge colour drawn in
each picture matches `TpConditionColors` (`lib/app/theme/tp_colors.dart`):
Good green, Worn amber, Damaged red, Puncture deep orange, Flat magenta,
Missing grey. Change both together.
