# Flutter physical inventory capture screenshots

Rendered by a widget test (not a device), 390 x 844 at 2x, with sample data from the
test's fake repository: Store 1 · Warehouse A, bin Rack 03 · Bin 04 scanned, an approved
genuine material picked, quantity 4.

| File | Theme | Language | Part |
|---|---|---|---|
| `capture_light_en_top.png` / `_bottom.png` | light | English | top / scrolled |
| `capture_light_ar_top.png` / `_bottom.png` | light | Arabic (RTL) | top / scrolled |
| `capture_dark_en_top.png` / `_bottom.png` | dark | English | top / scrolled |
| `capture_dark_ar_top.png` / `_bottom.png` | dark | Arabic (RTL) | top / scrolled |

Regenerate (macOS, uses the host font "Arial Unicode" for Latin and Arabic, or set
`TP_SCREENSHOT_FONT=/path/font.ttf`):

```
cd tyre_pulse_flutter
TP_INVENTORY_SCREENSHOTS=1 flutter test \
  test/features/inventory/presentation/physical_inventory_screenshots_test.dart
```

Without the variable the test is skipped, so CI never depends on host fonts. Text uses a
stand-in font, so letter shapes differ slightly from the app's real font on a phone.
