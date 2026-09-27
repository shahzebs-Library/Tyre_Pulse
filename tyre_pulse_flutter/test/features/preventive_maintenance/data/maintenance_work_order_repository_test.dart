library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/preventive_maintenance/data/maintenance_work_order_repository.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/maintenance_work_order.dart';

void main() {
  late HttpServer server;
  late StreamSubscription<HttpRequest> subscription;
  late SupabaseClient client;
  late SupabaseMaintenanceWorkOrderRepository repository;
  final List<HttpRequest> requests = <HttpRequest>[];
  bool failCounts = false;
  bool failProfiles = false;

  setUp(() async {
    requests.clear();
    failCounts = false;
    failProfiles = false;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    subscription = server.listen((HttpRequest request) async {
      requests.add(request);
      final Map<String, String> params = request.uri.queryParameters;
      final HttpResponse response = request.response;
      response.headers.contentType = ContentType.json;
      if (request.method == 'HEAD') {
        if (failCounts) {
          response.statusCode = HttpStatus.forbidden;
        } else {
          final int total = params['work_type'] == 'eq.Emergency' ? 3 : 41;
          response.headers.set('content-range', '*/$total');
        }
      } else if (request.uri.path == '/rest/v1/profiles') {
        if (failProfiles) {
          response.statusCode = HttpStatus.forbidden;
          response.write(
            jsonEncode(<String, String>{'code': '42501', 'message': 'no'}),
          );
        } else {
          response.write(
            jsonEncode(<Map<String, Object?>>[
              <String, Object?>{'id': 'tech-1', 'full_name': 'Khalid Rahman'},
            ]),
          );
        }
      } else {
        final bool breakdowns = params['work_type'] == 'eq.Emergency';
        response.write(
          jsonEncode(<Map<String, Object?>>[
            <String, Object?>{
              'id': breakdowns ? 'wo-b' : 'wo-r',
              'work_order_no': breakdowns ? 'GCKR/JC/1' : 'GCKR/JC/2',
              'asset_no': breakdowns ? 'MP093' : 'TM400',
              'asset_category': breakdowns ? 'PUMPS' : 'TR-MIXER',
              'work_type': breakdowns ? 'Emergency' : 'Repair',
              'status': 'In Progress',
              'priority': 'High',
              'site': 'NHC',
              'opened_at': '2026-08-27T06:00:00Z',
              'target_completion': null,
              'assigned_owner_id': breakdowns ? 'tech-1' : null,
            },
          ]),
        );
      }
      await response.close();
    });
    client = SupabaseClient(
      'http://127.0.0.1:${server.port}',
      'test-only-key',
    );
    repository = SupabaseMaintenanceWorkOrderRepository(client);
  });

  tearDown(() async {
    await client.dispose();
    await subscription.cancel();
    await server.close(force: true);
  });

  test('open breakdowns is an exact head count scoped like the list', () async {
    final int count = await repository.countOpenBreakdowns(country: 'KSA');
    expect(count, 3);
    final HttpRequest request = requests.single;
    expect(request.method, 'HEAD');
    expect(request.uri.path, '/rest/v1/work_orders');
    expect(request.headers.value('prefer'), contains('count=exact'));
    expect(request.uri.queryParameters['work_type'], 'eq.Emergency');
    expect(
      request.uri.queryParameters['status'],
      'not.in.(Completed,Closed,Cancelled)',
    );
    expect(
      request.uri.queryParameters['or'],
      '(country.eq.KSA,country.is.null)',
    );
  });

  test('active work orders count every unfinished job, all countries',
      () async {
    final int count = await repository.countActiveWorkOrders(country: 'All');
    expect(count, 41);
    final Map<String, String> params = requests.single.uri.queryParameters;
    expect(params['status'], 'not.in.(Completed,Closed,Cancelled)');
    expect(params.containsKey('work_type'), isFalse);
    expect(params.containsKey('or'), isFalse);
  });

  test('a failed count throws instead of reporting zero', () async {
    failCounts = true;
    await expectLater(
      repository.countActiveWorkOrders(country: 'KSA'),
      throwsA(isA<SupabaseFailure>()),
    );
  });

  test('queue reads breakdowns and other open work, and names technicians',
      () async {
    final List<MaintenanceWorkOrder> orders =
        await repository.listOpenForQueue(country: 'UAE', limit: 10);
    expect(orders.map((MaintenanceWorkOrder o) => o.id), <String>[
      'wo-b',
      'wo-r',
    ]);
    expect(orders.first.isBreakdown, isTrue);
    expect(orders.first.technicianName, 'Khalid Rahman');
    expect(orders.first.assetCategory, 'PUMPS');
    expect(orders.first.openedAt, DateTime.utc(2026, 8, 27, 6));
    expect(orders.last.technicianName, isNull);

    final List<Uri> reads = <Uri>[
      for (final HttpRequest request in requests)
        if (request.uri.path == '/rest/v1/work_orders') request.uri,
    ];
    expect(reads, hasLength(2));
    expect(reads.first.queryParameters['work_type'], 'eq.Emergency');
    expect(reads.first.queryParameters['order'], contains('opened_at.asc'));
    expect(reads.last.queryParameters['work_type'], 'neq.Emergency');
    expect(reads.last.queryParameters['order'], contains('opened_at.desc'));
    for (final Uri uri in reads) {
      expect(uri.queryParameters['select'], maintenanceWorkOrderColumns);
      expect(uri.queryParameters['limit'], '10');
      expect(uri.queryParameters['or'], '(country.eq.UAE,country.is.null)');
    }
    final Uri profiles = requests
        .firstWhere((HttpRequest r) => r.uri.path == '/rest/v1/profiles')
        .uri;
    expect(profiles.queryParameters['id'], 'in.("tech-1")');
    expect(profiles.queryParameters['select'], 'id,full_name');
  });

  test('an unreadable technician name leaves it blank, not the queue',
      () async {
    failProfiles = true;
    final List<MaintenanceWorkOrder> orders =
        await repository.listOpenForQueue(country: 'KSA');
    expect(orders, hasLength(2));
    expect(orders.first.technicianName, isNull);
  });

  test('row decoding never invents an id', () {
    expect(maintenanceWorkOrderFromRow(<String, dynamic>{'id': ' '}), isNull);
  });
}
