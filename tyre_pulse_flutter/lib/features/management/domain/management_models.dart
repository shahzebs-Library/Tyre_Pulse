library;

import 'package:flutter/foundation.dart';

@immutable
final class MetricSlice {
  const MetricSlice({required this.label, required this.count, this.cost});
  final String label;
  final num count;
  final num? cost;
}

@immutable
final class FleetAnalytics {
  const FleetAnalytics({
    required this.tyresTotal,
    required this.tyresCritical,
    required this.tyresHigh,
    required this.vehiclesTotal,
    required this.inspections30d,
    required this.openActions,
    required this.byRisk,
    required this.bySite,
    required this.byBrand,
    required this.sites,
    this.country,
    this.site,
    this.tyreSpend,
    this.generatedAt,
  });
  final String? country;
  final String? site;
  final num tyresTotal;
  final num tyresCritical;
  final num tyresHigh;
  final num? tyreSpend;
  final num vehiclesTotal;
  final num inspections30d;
  final num openActions;
  final List<MetricSlice> byRisk;
  final List<MetricSlice> bySite;
  final List<MetricSlice> byBrand;
  final List<String> sites;
  final DateTime? generatedAt;
}

@immutable
final class TeamMember {
  const TeamMember({
    required this.id,
    this.fullName,
    this.username,
    this.role,
    this.site,
    this.country,
    this.phone,
    this.email,
    this.approved,
    this.lastLoginAt,
  });
  final String id;
  final String? fullName;
  final String? username;
  final String? role;
  final String? site;
  final String? country;
  final String? phone;
  final String? email;
  final bool? approved;
  final DateTime? lastLoginAt;

  String get displayName => fullName ?? username ?? 'Unknown';
  String get initials {
    final List<String> words = displayName
        .split(RegExp(r'\s+'))
        .where((String word) => word.isNotEmpty)
        .take(2)
        .toList(growable: false);
    return words.isEmpty
        ? '?'
        : words.map((String word) => word[0]).join().toUpperCase();
  }
}

@immutable
final class ExecutiveSnapshot {
  const ExecutiveSnapshot({
    required this.available,
    required this.company,
    required this.kpis,
    required this.cost,
    required this.breakdowns,
    this.generatedAt,
    this.reason,
  });
  final bool available;
  final String company;
  final Map<String, num> kpis;
  final Map<String, num?> cost;
  final Map<String, List<MetricSlice>> breakdowns;
  final DateTime? generatedAt;
  final String? reason;
}
