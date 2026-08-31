library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';

const String _privateReference =
    'tp-storage://accident-photos/accidents/user-42/accident_1.jpg';
const String _dataImage =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

Future<void> _pumpStrip(
  WidgetTester tester, {
  required PrivateStorageReferenceResolver resolver,
  List<String> photos = const <String>[_privateReference],
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        privateStorageReferenceResolverProvider.overrideWithValue(resolver),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 360,
              child: AccidentEvidenceStrip(
                photos: photos,
                emptyLabel: 'No evidence',
                evidenceLabel: 'Evidence photo',
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void _expectPrivateReferenceHidden(WidgetTester tester) {
  expect(find.text(_privateReference), findsNothing);
  for (final Semantics semantics
      in tester.widgetList<Semantics>(find.byType(Semantics))) {
    expect(semantics.properties.label, isNot(contains(_privateReference)));
  }
}

void main() {
  testWidgets('keeps a private reference opaque while its URL is loading',
      (WidgetTester tester) async {
    final Completer<String> signedUrl = Completer<String>();
    String? bucket;
    String? path;
    int? ttl;

    await _pumpStrip(
      tester,
      resolver: PrivateStorageReferenceResolver(
        (String valueBucket, String valuePath, int expiresIn) {
          bucket = valueBucket;
          path = valuePath;
          ttl = expiresIn;
          return signedUrl.future;
        },
      ),
    );

    expect(bucket, 'accident-photos');
    expect(path, 'accidents/user-42/accident_1.jpg');
    expect(ttl, privateStorageSignedUrlTtlSeconds);
    expect(
      find.byKey(const Key('accident.evidence.loading.0')),
      findsOneWidget,
    );
    _expectPrivateReferenceHidden(tester);

    signedUrl.complete(_dataImage);
    await tester.pumpAndSettle();
  });

  testWidgets('renders a successfully resolved private reference as an image',
      (WidgetTester tester) async {
    await _pumpStrip(
      tester,
      resolver: PrivateStorageReferenceResolver(
        (String bucket, String path, int expiresIn) async => _dataImage,
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.byKey(const Key('accident.evidence.image.0')),
      findsOneWidget,
    );
    expect(find.byType(Image), findsOneWidget);
    expect(
      find.byKey(const Key('accident.evidence.loading.0')),
      findsNothing,
    );
    expect(
      find.byKey(const Key('accident.evidence.error.0')),
      findsNothing,
    );
    _expectPrivateReferenceHidden(tester);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shows a private resolution failure and retries explicitly',
      (WidgetTester tester) async {
    var calls = 0;

    await _pumpStrip(
      tester,
      resolver: PrivateStorageReferenceResolver(
        (String bucket, String path, int expiresIn) async {
          calls += 1;
          if (calls == 1) throw StateError('Storage RLS denied the reference.');
          return _dataImage;
        },
      ),
    );
    await tester.pumpAndSettle();

    expect(calls, 1);
    expect(
      find.byKey(const Key('accident.evidence.error.0')),
      findsOneWidget,
    );
    final Finder retry = find.byKey(const Key('accident.evidence.retry.0'));
    expect(retry, findsOneWidget);
    _expectPrivateReferenceHidden(tester);

    await tester.tap(retry);
    await tester.pump();
    await tester.pumpAndSettle();

    expect(calls, 2);
    expect(
      find.byKey(const Key('accident.evidence.image.0')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('accident.evidence.error.0')),
      findsNothing,
    );
    _expectPrivateReferenceHidden(tester);
    expect(tester.takeException(), isNull);
  });

  testWidgets('preserves HTTP rendering and non-image fallback behavior',
      (WidgetTester tester) async {
    var resolverCalls = 0;
    const String httpReference = 'https://example.test/evidence.jpg';
    await _pumpStrip(
      tester,
      photos: const <String>[httpReference, 'not-an-image-reference'],
      resolver: PrivateStorageReferenceResolver(
        (String bucket, String path, int expiresIn) async {
          resolverCalls += 1;
          return _dataImage;
        },
      ),
    );

    final Image image = tester.widget<Image>(
      find.byKey(const Key('accident.evidence.image.0')),
    );
    expect(image.image, isA<NetworkImage>());
    expect((image.image as NetworkImage).url, httpReference);
    expect(find.byIcon(Icons.image_outlined), findsWidgets);
    expect(resolverCalls, 0);
  });
}
