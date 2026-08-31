/// Regression coverage for submitted photo evidence on inspection approval.
///
/// Approval is a read-only projection of the submitted inspection row: tyre
/// position photos and row-level photos must stay visible, and an inaccessible
/// local/private reference must be shown honestly instead of disappearing.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/storage/private_storage_reference_resolver.dart';
import 'package:tyre_pulse/core/storage/storage_providers.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/inspection_approvals_providers.dart';
import 'package:tyre_pulse/features/approvals/presentation/inspection_approval_review_screen.dart';

const String _dataImage =
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const String _missingLocal = 'file:///definitely-missing/F1R.jpg';
const String _privateReference =
    'tp-storage://tyre-photos/inspection-42/private-evidence.jpg';

InspectionApprovalItem _submittedInspection() => const InspectionApprovalItem(
      id: 'inspection-evidence-42',
      assetNo: 'MP083',
      vehicleType: 'Concrete pump',
      site: 'North Yard',
      inspector: 'Inspector',
      createdAt: '2026-08-28T08:30:00.000Z',
      approvalStatus: 'approved',
      photoEvidence: <InspectionApprovalPhotoEvidence>[
        InspectionApprovalPhotoEvidence(
          reference: _dataImage,
          source: 'tyre_conditions',
          position: 'F1L',
          condition: 'Flat',
        ),
        InspectionApprovalPhotoEvidence(
          reference: _missingLocal,
          source: 'tyre_conditions',
          position: 'F1R',
          condition: 'Puncture',
        ),
        InspectionApprovalPhotoEvidence(
          reference: _privateReference,
          source: 'photos',
        ),
      ],
    );

Future<void> _pumpReview(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
  Size size = const Size(360, 1800),
  PrivateStorageReferenceResolver? evidenceResolver,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        inspectionApprovalRepositoryProvider.overrideWithValue(
          _FakeInspectionApprovalRepository(_submittedInspection()),
        ),
        privateStorageReferenceResolverProvider.overrideWithValue(
          evidenceResolver ??
              PrivateStorageReferenceResolver(
                (bucket, path, expiresIn) async => throw StateError(
                  'Private evidence is unavailable in this test.',
                ),
              ),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const InspectionApprovalReviewScreen(
          route: InspectionApprovalReviewRoute(
            inspectionId: InspectionId('inspection-evidence-42'),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
  await tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 100)),
  );
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  testWidgets(
    'shows exact position and row-level evidence without hiding unusable refs',
    (WidgetTester tester) async {
      await _pumpReview(tester);

      expect(
        find.byKey(const Key('inspection-approval-evidence-gallery')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('inspection-approval-evidence-0')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('inspection-approval-evidence-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('inspection-approval-evidence-2')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('inspection-approval-evidence-image-0')),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const Key('inspection-approval-evidence-position-0'),
        ),
        findsOneWidget,
      );
      expect(find.text('Flat'), findsOneWidget);
      expect(
        find.byKey(
          const Key('inspection-approval-evidence-position-1'),
        ),
        findsOneWidget,
      );
      expect(find.text('Puncture'), findsOneWidget);

      final Finder flatCard = find.byKey(
        const Key('inspection-approval-evidence-0'),
      );
      final Finder punctureCard = find.byKey(
        const Key('inspection-approval-evidence-1'),
      );
      expect(
        tester
            .widget<TpStatusChip>(
              find.descendant(
                of: flatCard,
                matching: find.byType(TpStatusChip),
              ),
            )
            .status,
        TpStatus.warning,
      );
      expect(
        tester.widget<TpCard>(flatCard).borderColor,
        TpPalette.of(tester.element(flatCard)).warning.base,
      );
      expect(
        tester
            .widget<TpStatusChip>(
              find.descendant(
                of: punctureCard,
                matching: find.byType(TpStatusChip),
              ),
            )
            .status,
        TpStatus.critical,
      );
      expect(
        tester.widget<TpCard>(punctureCard).borderColor,
        TpPalette.of(tester.element(punctureCard)).critical.base,
      );

      // Both a missing local file and a private/non-resolvable stored ref stay
      // visible verbatim, so a reviewer knows evidence exists but cannot be
      // opened on this device.
      expect(find.text(_missingLocal), findsOneWidget);
      expect(find.text(_privateReference), findsOneWidget);
      expect(
        find.byKey(const Key('inspection-approval-evidence-unavailable-1')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('inspection-approval-evidence-unavailable-2')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'resolves a private reference through authenticated storage with loading',
    (WidgetTester tester) async {
      final Completer<String> signedUrl = Completer<String>();
      String? signedBucket;
      String? signedPath;
      int? signedTtl;
      await _pumpReview(
        tester,
        evidenceResolver: PrivateStorageReferenceResolver(
          (String bucket, String path, int expiresIn) {
            signedBucket = bucket;
            signedPath = path;
            signedTtl = expiresIn;
            return signedUrl.future;
          },
        ),
      );

      expect(signedBucket, 'tyre-photos');
      expect(signedPath, 'inspection-42/private-evidence.jpg');
      expect(signedTtl, privateStorageSignedUrlTtlSeconds);
      expect(
        find.byKey(const Key('inspection-approval-evidence-unavailable-2')),
        findsOneWidget,
      );
      expect(
        find.byIcon(Icons.cloud_download_outlined),
        findsOneWidget,
      );

      signedUrl.complete(_dataImage);
      await tester.pump(const Duration(milliseconds: 100));

      expect(
        find.byKey(const Key('inspection-approval-evidence-image-2')),
        findsOneWidget,
      );
      expect(find.text(_privateReference), findsNothing);
    },
  );

  testWidgets('failed private resolution stays identified and can retry',
      (WidgetTester tester) async {
    var calls = 0;
    await _pumpReview(
      tester,
      evidenceResolver: PrivateStorageReferenceResolver(
        (String bucket, String path, int expiresIn) async {
          calls += 1;
          throw StateError('denied');
        },
      ),
    );
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    expect(find.text(_privateReference), findsOneWidget);
    final Finder retry = find.byKey(
      const Key('inspection-approval-evidence-retry-2'),
    );
    expect(retry, findsOneWidget);
    expect(calls, 1);

    await tester.tap(retry);
    await tester.pump();
    await tester.pump();
    expect(calls, 2);
    expect(find.text(_privateReference), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'compact Arabic layout keeps two dense columns and technical ids LTR',
    (WidgetTester tester) async {
      await _pumpReview(
        tester,
        locale: const Locale('ar'),
        size: const Size(320, 1800),
      );

      final Size first = tester.getSize(
        find.byKey(const Key('inspection-approval-evidence-0')),
      );
      final Size second = tester.getSize(
        find.byKey(const Key('inspection-approval-evidence-1')),
      );
      expect(first.width, lessThan(160));
      expect(second.width, lessThan(160));
      final double galleryWidth = tester
          .getSize(
            find.byKey(const Key('inspection-approval-evidence-gallery')),
          )
          .width;
      expect(
        first.width + second.width + TpSpace.sm,
        closeTo(galleryWidth, 0.01),
      );

      final Finder position = find.byKey(
        const Key('inspection-approval-evidence-position-0'),
      );
      final Directionality technicalDirection = tester.widget<Directionality>(
        find.descendant(
          of: position,
          matching: find.byType(Directionality),
        ),
      );
      expect(technicalDirection.textDirection, TextDirection.ltr);

      final Directionality referenceDirection = tester.widget<Directionality>(
        find
            .ancestor(
              of: find.byKey(
                const Key('inspection-approval-evidence-reference-2'),
              ),
              matching: find.byType(Directionality),
            )
            .first,
      );
      expect(referenceDirection.textDirection, TextDirection.ltr);
      expect(tester.takeException(), isNull);
    },
  );
}

final class _FakeInspectionApprovalRepository
    implements InspectionApprovalRepository {
  const _FakeInspectionApprovalRepository(this.item);

  final InspectionApprovalItem item;

  @override
  Future<InspectionApprovalItem?> byId(String id) async =>
      id == item.id ? item : null;

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<void> decide(InspectionApprovalDecision input) async {}

  @override
  Future<List<InspectionApprovalItem>> listPending({String? country}) async =>
      <InspectionApprovalItem>[item];

  @override
  Future<List<InspectionApprovalItem>> listByStatus(
    String status, {
    String? country,
  }) async =>
      const <InspectionApprovalItem>[];
}
