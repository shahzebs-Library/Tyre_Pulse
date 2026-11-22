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
