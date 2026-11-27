# Tyre condition pictures

Drop one PNG per condition here, named exactly:

`good.png`, `worn.png`, `damaged.png`, `puncture.png`, `flat.png`, `missing.png`

The inspection tyre editor (`tyre_position_editor_sheet.dart`,
`tyreConditionImageAsset`) shows the picture on the condition tile as soon as
the file exists, and falls back to the drawn glyph when it does not. Square,
transparent background, at least 144x144 px.
