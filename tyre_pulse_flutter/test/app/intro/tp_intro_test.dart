import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/intro/intro_seen_store.dart';
import 'package:tyre_pulse/app/intro/tp_intro.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

const Key _underneath = Key('intro.test.underneath');

Widget _app(
  IntroSeenStore store, {
  bool reduceMotion = false,
  Locale locale = const Locale('en'),
}) {
  return ProviderScope(
    overrides: [introSeenStoreProvider.overrideWithValue(store)],
    child: MaterialApp(
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
        child: TpIntroGate(child: child!),
      ),
      home: const Scaffold(body: Text('signed out', key: _underneath)),
    ),
  );
}

void main() {
  testWidgets('first launch: the intro plays over the app, then lifts',
      (WidgetTester tester) async {
    final InMemoryIntroSeenStore store = InMemoryIntroSeenStore(seen: false);
    await tester.pumpWidget(_app(store));

    expect(find.byKey(TpIntroKeys.overlay), findsOneWidget);
    // The app underneath is already built (routing carries on).
    expect(find.byKey(_underneath), findsOneWidget);
    expect(find.text('FLEET TYRE OPERATIONS'), findsOneWidget);
    expect(store.readSeen(), isFalse);

    await tester.pump(const Duration(seconds: 3));
    expect(find.byKey(TpIntroKeys.overlay), findsOneWidget);

    await tester.pump(const Duration(seconds: 3, milliseconds: 100));
    await tester.pump();
    expect(find.byKey(TpIntroKeys.overlay), findsNothing);
    expect(find.byKey(_underneath), findsOneWidget);
    expect(store.readSeen(), isTrue);
  });

  testWidgets('second launch: the intro does not play',
      (WidgetTester tester) async {
    await tester.pumpWidget(_app(InMemoryIntroSeenStore()));
    expect(find.byKey(TpIntroKeys.overlay), findsNothing);
    expect(find.byKey(_underneath), findsOneWidget);
  });

  testWidgets('a tap on the stage does not skip; the Skip button does',
      (WidgetTester tester) async {
    final InMemoryIntroSeenStore store = InMemoryIntroSeenStore(seen: false);
    await tester.pumpWidget(_app(store));
    await tester.pump(const Duration(milliseconds: 500));

    await tester.tapAt(const Offset(200, 400));
    await tester.pump();
    expect(find.byKey(TpIntroKeys.overlay), findsOneWidget);

    final Size skip = tester.getSize(find.byKey(TpIntroKeys.skip));
    expect(skip.height, greaterThanOrEqualTo(48));
    expect(find.bySemanticsLabel('Skip the intro'), findsOneWidget);

    await tester.tap(find.byKey(TpIntroKeys.skip));
    await tester.pump();
    expect(find.byKey(TpIntroKeys.overlay), findsNothing);
    expect(store.readSeen(), isTrue);
  });

  testWidgets('Skip sits top-left in Arabic and the tagline is localised',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _app(InMemoryIntroSeenStore(seen: false), locale: const Locale('ar')),
    );
    await tester.pump();
    expect(find.text('إدارة إطارات الأسطول'), findsOneWidget);
    final Offset skip = tester.getCenter(find.byKey(TpIntroKeys.skip));
    expect(skip.dx, lessThan(400));
    await tester.pump(const Duration(seconds: 7));
  });

  testWidgets('reduce motion: the finished logo holds 1 second, then ends',
      (WidgetTester tester) async {
    final InMemoryIntroSeenStore store = InMemoryIntroSeenStore(seen: false);
    await tester.pumpWidget(_app(store, reduceMotion: true));
    expect(find.byKey(TpIntroKeys.overlay), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 900));
    expect(find.byKey(TpIntroKeys.overlay), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 200));
    await tester.pump();
    expect(find.byKey(TpIntroKeys.overlay), findsNothing);
    expect(store.readSeen(), isTrue);
  });

  testWidgets('replay shows the intro again after it was seen',
      (WidgetTester tester) async {
    await tester.pumpWidget(_app(InMemoryIntroSeenStore()));
    expect(find.byKey(TpIntroKeys.overlay), findsNothing);

    final ProviderContainer container = ProviderScope.containerOf(
      tester.element(find.byKey(_underneath)),
    );
    container.read(introVisibleProvider.notifier).replay();
    await tester.pump();
    expect(find.byKey(TpIntroKeys.overlay), findsOneWidget);

    await tester.pump(const Duration(seconds: 6, milliseconds: 100));
    await tester.pump();
    expect(find.byKey(TpIntroKeys.overlay), findsNothing);
    expect(find.byKey(_underneath), findsOneWidget);
  });
}
