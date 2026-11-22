import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:widgetbook/widgetbook.dart';

/// Category paths. Square brackets make a Widgetbook category, so the
/// catalogue reads as the design system's own sections rather than as the
/// app's folder tree.
abstract final class CataloguePath {
  static const String foundations = '[Foundations]';
  static const String buttons = '[Buttons]';
  static const String cards = '[Cards and tiles]';
  static const String inputs = '[Inputs]';
  static const String lists = '[Lists and rows]';
  static const String status = '[Status indicators]';
  static const String states = '[Loading, empty, error and offline states]';
  static const String sync = '[Sync and connectivity]';
  static const String navigation = '[Navigation and chrome]';
  static const String overlays = '[Dialogs and bottom sheets]';
  static const String capture = '[Capture]';
  static const String tyres = '[Tyres]';
}

/// Sample copy only for the catalogue. Nothing here reaches the app.
abstract final class SampleText {
  /// A long Arabic sentence, used to check wrapping, truncation and RTL
  /// mirroring in a control that is usually given one or two words.
  static const String longArabic =
      'تم حفظ الفحص على هذا الجهاز وستتم مزامنته تلقائيا عند عودة الاتصال '
      'بالشبكة، يرجى عدم حذف التطبيق قبل اكتمال المزامنة';

  static const String shortArabic = 'حفظ الفحص';
}

/// A `Long Arabic text` knob shared by every use case that has a label.
String labelKnob(BuildContext context, String english) {
  final bool arabic = context.knobs.boolean(
    label: 'Long Arabic text',
    initialValue: false,
  );
  return arabic ? SampleText.longArabic : english;
}

/// Standard frame for a single component: the screen background, a scroll
/// view, and the page gutter the app uses.
class CatalogueFrame extends StatelessWidget {
  const CatalogueFrame({required this.children, this.title, super.key});

  final String? title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return ColoredBox(
      color: palette.background,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(TpSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            if (title != null) ...<Widget>[
              Text(title!, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: TpSpace.md),
            ],
            for (int i = 0; i < children.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(height: TpSpace.lg),
              children[i],
            ],
          ],
        ),
      ),
    );
  }
}

/// A caption above one example, so a reviewer knows which state is which.
class Labelled extends StatelessWidget {
  const Labelled(this.label, this.child, {super.key});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(label, style: Theme.of(context).textTheme.labelSmall),
        const SizedBox(height: TpSpace.sm),
        child,
      ],
    );
  }
}

/// Gives a full-screen state a bounded box so several fit on one page.
class StateBox extends StatelessWidget {
  const StateBox({required this.child, this.height = 360, super.key});

  final Widget child;
  final double height;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: palette.surface,
        border: Border.all(color: palette.border),
        borderRadius: BorderRadius.circular(TpRadius.md),
      ),
      child: child,
    );
  }
}

void noop() {}
