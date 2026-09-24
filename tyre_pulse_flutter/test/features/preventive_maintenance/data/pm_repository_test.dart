library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/preventive_maintenance/data/pm_repository.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

void main() {
  late HttpServer server;
  late StreamSubscription<HttpRequest> subscription;
  late SupabaseClient client;
  late SupabasePmRepository repository;
  final List<Uri> requests = <Uri>[];
  bool failSecondPage = false;

  setUp(() async {
    requests.clear();
    failSecondPage = false;
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    subscription = server.listen((HttpRequest request) async {
      requests.add(request.uri);
      final int offset =
          int.parse(request.uri.queryParameters['offset'] ?? '0');
      final int limit =
          int.parse(request.uri.queryParameters['limit'] ?? '1000');
      request.response.headers.contentType = ContentType.json;
      if (failSecondPage && offset > 0) {
        request.response.statusCode = HttpStatus.forbidden;
        request.response.write(jsonEncode(<String, String>{
          'code': '42501',
          'message': 'Read denied',
        }));
      } else {
        final int end = offset + limit < 1001 ? offset + limit : 1001;
        request.response.write(jsonEncode(<Map<String, Object?>>[
          for (int index = offset; index < end; index++)
            <String, Object?>{
              'id': 'plan-$index',
              'name': 'Maintenance $index',
              'status': 'active',
              'next_due': '2026-09-24',
            },
        ]));
      }
      await request.response.close();
    });
    client = SupabaseClient(
      'http://127.0.0.1:${server.port}',
      'test-only-key',
    );
    repository = SupabasePmRepository(client);
  });

  tearDown(() async {
    await client.dispose();
    await subscription.cancel();
    await server.close(force: true);
  });

  test('loads all active plans beyond 300 and the server page size', () async {
    final List<PmPlan> plans = await repository.listActive(country: 'KSA');
    expect(plans, hasLength(1001));
    expect(plans.last.id, 'plan-1000');
    expect(requests, hasLength(2));
    for (final Uri request in requests) {
      expect(request.path, '/rest/v1/pm_programs');
      expect(request.queryParameters['status'], 'eq.active');
      expect(request.queryParameters['or'], '(country.eq.KSA,country.is.null)');
      expect(request.queryParameters['order'], contains('id.asc'));
    }
  });

  test('a failed later page cannot become a successful partial register', () async {
    failSecondPage = true;
    await expectLater(
      repository.listActive(country: 'KSA'),
      throwsA(isA<SupabaseFailure>()),
    );
  });
}
