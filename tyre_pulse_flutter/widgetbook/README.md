# Tyre Pulse Widgetbook

Isolated catalogue of the field app's components (light/dark, English/Arabic/Urdu,
phone sizes, text scale). It depends on `../` as a path package, so it always shows
the real widgets.

```bash
cd tyre_pulse_flutter/widgetbook
flutter pub get
dart run build_runner build -d   # after adding or renaming a use case
flutter run -d chrome            # or -d macos
```

Add a use case: create a file in `lib/components/`, annotate a builder with
`@widgetbook.UseCase(name: ..., type: TheWidget)`, then rerun build_runner.

Use cases are grouped by design-system category with `path: CataloguePath.<x>`
(see `lib/components/catalogue_support.dart`). Give every labelled component the
shared `Long Arabic text` knob via `labelKnob(context, 'English')`.

`flutter test` renders every use case in light/English/1x, dark/Arabic/1x and
light/Arabic/2x and fails on any overflow or exception. Component defects that
cannot be fixed in the catalogue are listed with their reason in
`_knownDefects` in `test/all_use_cases_render_test.dart`; remove the entry when
the component is fixed. Inventory and token proposal:
`docs/flutter-redesign/02_design_system_inventory.md`, `02_design_tokens.md`.
