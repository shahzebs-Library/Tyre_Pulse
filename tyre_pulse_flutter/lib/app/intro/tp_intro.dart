/// The six-second first-run intro: the TP mark builds block by block, the
/// TYRE PULSE wordmark rises, a heartbeat line draws, then the tagline.
///
/// A native reproduction of the owner-approved HTML animation (dark #161616
/// stage, signal yellow #FFC629). No video file and no animation package:
/// one [AnimationController] and one [CustomPainter].
///
/// [TpIntroGate] sits in `MaterialApp.router`'s `builder`, ABOVE the router,
/// and lays the intro over whatever the router is showing. So the intro never
/// decides where the app goes: sign-in, a deep link or Home all resolve
/// underneath as they always do, and the intro simply lifts off them.
library;

import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tyre_pulse/app/intro/intro_seen_store.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// Stable keys for tests.
abstract final class TpIntroKeys {
  static const Key overlay = Key('intro.overlay');
  static const Key skip = Key('intro.skip');
}

/// Lays [TpIntro] over [child] while [introVisibleProvider] is true.
class TpIntroGate extends ConsumerWidget {
  const TpIntroGate({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool visible = ref.watch(introVisibleProvider);
    return Stack(
      textDirection: TextDirection.ltr,
      children: <Widget>[
        // The screen underneath stays built (routing carries on), but is
        // hidden from screen readers while the intro covers it.
        ExcludeSemantics(excluding: visible, child: child),
        if (visible)
          Positioned.fill(
            child: TpIntro(
              onFinished: () =>
                  ref.read(introVisibleProvider.notifier).finish(),
            ),
          ),
      ],
    );
  }
}

/// The intro itself. Calls [onFinished] exactly once.
class TpIntro extends StatefulWidget {
  const TpIntro({required this.onFinished, super.key});

  final VoidCallback onFinished;

  /// Full length of the animation.
  static const Duration duration = Duration(seconds: 6);

  /// How long the finished logo holds when reduce motion is on.
  static const Duration reducedMotionHold = Duration(seconds: 1);

  @override
  State<TpIntro> createState() => _TpIntroState();
}

class _TpIntroState extends State<TpIntro> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _finished = false;
  bool _started = false;
  Timer? _holdTimer;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: TpIntro.duration)
      ..addStatusListener((AnimationStatus status) {
        if (status == AnimationStatus.completed) _finish();
      });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (MediaQuery.maybeDisableAnimationsOf(context) ?? false) {
      // Reduce motion: show the finished logo, still, then continue.
      _controller.value = _IntroTimeline.settled / 6;
      _holdTimer = Timer(TpIntro.reducedMotionHold, _finish);
    } else {
      _controller.forward();
    }
  }

  void _finish() {
    if (_finished || !mounted) return;
    _finished = true;
    widget.onFinished();
  }

  @override
  void dispose() {
    _holdTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool rtl = Directionality.of(context) == TextDirection.rtl;
    final String tagline = l10n.introTagline;
    // Letter spacing breaks Arabic script joining; only Latin is tracked.
    final bool latinTagline = RegExp(r'^[\x00-\x7F]*$').hasMatch(tagline);
    // Second line in the other script, same as the website intro: Arabic
    // under English or Urdu, English under Arabic.
    final String secondary =
        Localizations.localeOf(context).languageCode == 'ar'
            ? _taglineEnglish
            : _taglineArabic;

    return Material(
      key: TpIntroKeys.overlay,
      color: _IntroColors.background,
      // Taps on the stage are swallowed: only the Skip button skips.
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {},
        child: AnimatedBuilder(
          animation: _controller,
          builder: (BuildContext context, _) {
            final double t = _controller.value * 6;
            final _IntroFrame f = _IntroFrame(t);
            return Opacity(
              opacity: f.stageOpacity,
              child: Stack(
                children: <Widget>[
                  Positioned.fill(
                    child: FittedBox(
                      child: MediaQuery.withNoTextScaling(
                        child: SizedBox(
                          width: 1080,
                          height: 1920,
                          child: _Stage(
                            frame: f,
                            tagline: tagline,
                            latinTagline: latinTagline,
                            secondary: secondary,
                          ),
                        ),
                      ),
                    ),
                  ),
                  SafeArea(
                    child: Align(
                      alignment: rtl ? Alignment.topLeft : Alignment.topRight,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: _SkipButton(
                          label: l10n.introSkip,
                          semanticsLabel: l10n.introSkipSemantics,
                          onPressed: _finish,
                        ),
                      ),
                    ),
                  ),
                  SafeArea(
                    child: Align(
                      alignment: Alignment.bottomCenter,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
                        child: _ProgressBar(value: f.progress, rtl: rtl),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

abstract final class _IntroColors {
  static const Color background = Color(0xFF161616);
  static const Color yellow = Color(0xFFFFC629);
  static const Color white = Color(0xFFFFFFFF);
  static const Color muted = Color(0xFF9A9A9A);
}

/// The timings of the approved HTML, in seconds.
abstract final class _IntroTimeline {
  /// A moment when everything is drawn and the stage has not begun to fade.
  static const double settled = 5;
}

double _clamp01(double x) => x.isNaN ? 0 : x.clamp(0.0, 1.0);

/// Cubic ease-out, the HTML's `ease`.
double _ease(double x) => 1 - math.pow(1 - _clamp01(x), 3).toDouble();

/// Every animated value at time [t] (0..6 s), exactly as the HTML computes it.
class _IntroFrame {
  _IntroFrame(this.t);

  final double t;

  /// Block k (0..8) appears from 0.15 + 0.11k over 0.35 s.
  double block(int k) => _ease((t - (0.15 + k * 0.11)) / 0.35);

  double get bowl => _ease((t - 1.25) / 0.5);
  double get word => _ease((t - 1.9) / 0.6);
  double get pulse => _clamp01((t - 2.4) / 0.9);
  double get tagline => _ease((t - 3.1) / 0.6);

  /// A single gentle heartbeat of the mark once it has settled.
  double get beat {
    if (t <= 3.6 || t >= 4.8) return 1;
    return 1 + 0.035 * math.max(0, math.sin((t - 3.6) * math.pi / 0.6));
  }

  double get stageOpacity => 1 - _clamp01((t - 5.4) / 0.6) * 0.85;
  double get progress => _clamp01(t / 6);
}

// Brand tagline lines shown together (not translations of each other's UI).
const String _taglineEnglish = 'FLEET TYRE OPERATIONS';
const String _taglineArabic = 'إدارة إطارات الأسطول';

/// The 1080x1920 design canvas, scaled to the screen by a [FittedBox].
class _Stage extends StatelessWidget {
  const _Stage({
    required this.frame,
    required this.tagline,
    required this.latinTagline,
    required this.secondary,
  });

  final _IntroFrame frame;
  final String tagline;
  final bool latinTagline;
  final String secondary;

  @override
  Widget build(BuildContext context) {
    final _IntroFrame f = frame;
    return Stack(
      children: <Widget>[
        Positioned(
          left: 290,
          top: 560,
          width: 500,
          height: 470,
          child: Transform.scale(
            scale: f.beat,
            child: CustomPaint(painter: _MarkPainter(f)),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          top: 1090,
          child: Opacity(
            opacity: f.word,
            child: Transform.translate(
              offset: Offset(0, 40 * (1 - f.word)),
              child: const Directionality(
                // The wordmark is Latin in every language.
                textDirection: TextDirection.ltr,
                child: Text.rich(
                  TextSpan(
                    children: <InlineSpan>[
                      TextSpan(
                        text: 'TYRE ',
                        style: TextStyle(color: _IntroColors.white),
                      ),
                      TextSpan(
                        text: 'PULSE',
                        style: TextStyle(color: _IntroColors.yellow),
                      ),
                    ],
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  style: TextStyle(
                    fontSize: 120,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 2,
                    height: 1.15,
                  ),
                ),
              ),
            ),
          ),
        ),
        Positioned(
          left: 140,
          top: 1250,
          width: 800,
          height: 120,
          child: CustomPaint(painter: _PulsePainter(f.pulse)),
        ),
        Positioned(
          left: 40,
          right: 40,
          top: 1400,
          child: Opacity(
            opacity: f.tagline,
            child: Text(
              tagline,
              textAlign: TextAlign.center,
              maxLines: 2,
              style: TextStyle(
                color: _IntroColors.muted,
                fontSize: latinTagline ? 40 : 48,
                fontWeight: FontWeight.w600,
                letterSpacing: latinTagline ? 14 : 0,
              ),
            ),
          ),
        ),
        Positioned(
          left: 40,
          right: 40,
          top: 1480,
          child: Opacity(
            opacity: f.tagline,
            child: Text(
              secondary,
              textAlign: TextAlign.center,
              maxLines: 1,
              style: TextStyle(
                color: _IntroColors.muted,
                fontSize: secondary == _taglineEnglish ? 34 : 44,
                letterSpacing: secondary == _taglineEnglish ? 10 : 0,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The TP mark: nine skewed blocks and the P bowl, in the SVG's own units.
class _MarkPainter extends CustomPainter {
  _MarkPainter(this.frame);

  final _IntroFrame frame;

  /// The SVG viewBox is `-4 -4 92 80`, drawn "meet" into the paint box.
  static const Rect _viewBox = Rect.fromLTWH(-4, -4, 92, 80);

  static const List<Rect> _blocks = <Rect>[
    Rect.fromLTWH(0, 0, 14, 13),
    Rect.fromLTWH(18, 0, 14, 13),
    Rect.fromLTWH(36, 0, 14, 13),
    Rect.fromLTWH(18, 17, 14, 16),
    Rect.fromLTWH(36, 17, 14, 16),
    Rect.fromLTWH(18, 37, 14, 16),
    Rect.fromLTWH(36, 37, 14, 16),
    Rect.fromLTWH(18, 57, 14, 13),
    Rect.fromLTWH(36, 57, 14, 13),
  ];

  static final Path _bowl = Path()
    ..moveTo(54, 1.6)
    ..arcToPoint(const Offset(55.6, 0), radius: const Radius.circular(1.6))
    ..lineTo(60, 0)
    ..arcToPoint(const Offset(60, 33), radius: const Radius.circular(16.5))
    ..lineTo(55.6, 33)
    ..arcToPoint(const Offset(54, 31.4), radius: const Radius.circular(1.6))
    ..lineTo(54, 22.1)
    ..arcToPoint(const Offset(55.6, 20.5), radius: const Radius.circular(1.6))
    ..lineTo(60, 20.5)
    ..arcToPoint(
      const Offset(60, 12.5),
      radius: const Radius.circular(4),
      clockwise: false,
    )
    ..lineTo(55.6, 12.5)
    ..arcToPoint(const Offset(54, 10.9), radius: const Radius.circular(1.6))
    ..close();

  @override
  void paint(Canvas canvas, Size size) {
    final double scale = math.min(
      size.width / _viewBox.width,
      size.height / _viewBox.height,
    );
    canvas
      ..save()
      ..translate(
        (size.width - _viewBox.width * scale) / 2,
        (size.height - _viewBox.height * scale) / 2,
      )
      ..scale(scale)
      ..translate(-_viewBox.left, -_viewBox.top)
      // <g transform="translate(11.0869 0) skewX(-9)">
      ..translate(11.0869, 0)
      ..skew(math.tan(-9 * math.pi / 180), 0);

    for (int k = 0; k < _blocks.length; k++) {
      final double p = frame.block(k);
      if (p <= 0) continue;
      canvas
        ..save()
        ..translate(0, -14 * (1 - p))
        ..drawRRect(
          RRect.fromRectAndRadius(_blocks[k], const Radius.circular(1.6)),
          _fill(p),
        )
        ..restore();
    }

    final double pb = frame.bowl;
    if (pb > 0) {
      canvas
        ..save()
        ..translate(60, 16.5)
        ..rotate(-90 * (1 - pb) * math.pi / 180)
        ..translate(-60, -16.5)
        ..drawPath(_bowl, _fill(pb))
        ..restore();
    }
    canvas.restore();
  }

  Paint _fill(double opacity) =>
      Paint()..color = _IntroColors.yellow.withValues(alpha: _clamp01(opacity));

  @override
  bool shouldRepaint(_MarkPainter old) => old.frame.t != frame.t;
}

/// The heartbeat line, drawn left to right by [progress].
class _PulsePainter extends CustomPainter {
  _PulsePainter(this.progress);

  final double progress;

  static final Path _line = Path()
    ..moveTo(0, 60)
    ..lineTo(330, 60)
    ..lineTo(355, 10)
    ..lineTo(385, 110)
    ..lineTo(410, 30)
    ..lineTo(430, 60)
    ..lineTo(800, 60);

  @override
  void paint(Canvas canvas, Size size) {
    if (progress <= 0) return;
    canvas
      ..save()
      ..scale(size.width / 800, size.height / 120);
    final Paint stroke = Paint()
      ..color = _IntroColors.yellow
      ..style = PaintingStyle.stroke
      ..strokeWidth = 8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    for (final PathMetric metric in _line.computeMetrics()) {
      canvas.drawPath(
        metric.extractPath(0, metric.length * progress),
        stroke,
      );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_PulsePainter old) => old.progress != progress;
}

/// The outlined Skip pill. 48dp minimum touch target.
class _SkipButton extends StatelessWidget {
  const _SkipButton({
    required this.label,
    required this.semanticsLabel,
    required this.onPressed,
  });

  final String label;
  final String semanticsLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticsLabel,
      // excludeSemantics drops the button's own tap action, so give the
      // replacement node one: TalkBack / VoiceOver users must be able to skip.
      onTap: onPressed,
      excludeSemantics: true,
      child: OutlinedButton(
        key: TpIntroKeys.skip,
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: _IntroColors.white,
          minimumSize: const Size(64, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
          padding: const EdgeInsets.symmetric(horizontal: 22),
          shape: const StadiumBorder(),
          side: BorderSide(
            color: _IntroColors.white.withValues(alpha: 0.35),
            width: 1.5,
          ),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        child: Text(label),
      ),
    );
  }
}

/// The thin progress bar along the bottom; fills from the reading start.
class _ProgressBar extends StatelessWidget {
  const _ProgressBar({required this.value, required this.rtl});

  final double value;
  final bool rtl;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(2),
        child: SizedBox(
          height: 3,
          width: double.infinity,
          child: ColoredBox(
            color: _IntroColors.white.withValues(alpha: 0.12),
            child: FractionallySizedBox(
              alignment: rtl ? Alignment.centerRight : Alignment.centerLeft,
              widthFactor: value,
              child: const ColoredBox(color: _IntroColors.yellow),
            ),
          ),
        ),
      ),
    );
  }
}
