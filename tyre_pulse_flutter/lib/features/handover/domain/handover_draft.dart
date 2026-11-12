/// An in-progress (not yet submitted) handover, and its on-device JSON shape.
///
/// The wizard auto-saves this so a half-filled handover survives the app being
/// killed - unsynced work is the only copy (AGENTS.md offline rule). It is NOT
/// the submission queue: a draft is work still being filled, a `QueuedHandover`
/// is work already submitted and awaiting delivery. Photos are kept as local
/// paths (the image files live in the durable `handover_draft_photos` folder);
/// the driver signature is an embedded `data:` URL.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';

@immutable
class HandoverDraft {
  const HandoverDraft({
    this.assetNo = '',
    this.handoverType = HandoverType.checkout,
    this.fromDriver = '',
    this.toDriver = '',
    this.odometerText = '',
    this.fuelText = '',
    this.conditionRating,
    this.cleanliness,
    this.damages = const <HandoverDamageMarker>[],
    this.photos = const <String>[],
    this.signatureDataUrl,
    this.notes = '',
  });

  final String assetNo;
  final HandoverType handoverType;
  final String fromDriver;
  final String toDriver;

  /// Typed text, parsed to a number only at submit time.
  final String odometerText;
  final String fuelText;

  final HandoverConditionRating? conditionRating;
  final HandoverCleanliness? cleanliness;
  final List<HandoverDamageMarker> damages;

  /// Local device paths (and/or already-uploaded refs) of general photos.
  final List<String> photos;
  final String? signatureDataUrl;
  final String notes;

  bool get isEmpty =>
      assetNo.trim().isEmpty &&
      fromDriver.trim().isEmpty &&
      toDriver.trim().isEmpty &&
      odometerText.trim().isEmpty &&
      fuelText.trim().isEmpty &&
      conditionRating == null &&
      cleanliness == null &&
      damages.isEmpty &&
      photos.isEmpty &&
      (signatureDataUrl == null || signatureDataUrl!.isEmpty) &&
      notes.trim().isEmpty;

  HandoverDraft copyWith({
    String? assetNo,
    HandoverType? handoverType,
    String? fromDriver,
    String? toDriver,
    String? odometerText,
    String? fuelText,
    HandoverConditionRating? conditionRating,
    bool clearConditionRating = false,
    HandoverCleanliness? cleanliness,
    bool clearCleanliness = false,
    List<HandoverDamageMarker>? damages,
    List<String>? photos,
    String? signatureDataUrl,
    bool clearSignature = false,
    String? notes,
  }) {
    return HandoverDraft(
      assetNo: assetNo ?? this.assetNo,
      handoverType: handoverType ?? this.handoverType,
      fromDriver: fromDriver ?? this.fromDriver,
      toDriver: toDriver ?? this.toDriver,
      odometerText: odometerText ?? this.odometerText,
      fuelText: fuelText ?? this.fuelText,
      conditionRating: clearConditionRating
          ? null
          : (conditionRating ?? this.conditionRating),
      cleanliness: clearCleanliness ? null : (cleanliness ?? this.cleanliness),
      damages: damages ?? this.damages,
      photos: photos ?? this.photos,
      signatureDataUrl:
          clearSignature ? null : (signatureDataUrl ?? this.signatureDataUrl),
      notes: notes ?? this.notes,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'schemaVersion': 1,
        'assetNo': assetNo,
        'handoverType': handoverType.key,
        'fromDriver': fromDriver,
        'toDriver': toDriver,
        'odometerText': odometerText,
        'fuelText': fuelText,
        'conditionRating': conditionRating?.key,
        'cleanliness': cleanliness?.key,
        'damages': <Map<String, Object?>>[
          for (final HandoverDamageMarker m in damages)
            <String, Object?>{
              'view': m.view.key,
              'x': m.x,
              'y': m.y,
              'type': m.type.key,
              'level': m.level.key,
              'note': m.note,
              'photo_url': m.photoUrl,
              'photoLocalPath': m.photoLocalPath,
            },
        ],
        'photos': List<String>.of(photos),
        'signatureDataUrl': signatureDataUrl,
        'notes': notes,
      };

  String toJsonString() => jsonEncode(toJson());

  static HandoverDraft fromJson(Map<String, Object?> json) {
    final List<HandoverDamageMarker> damages = <HandoverDamageMarker>[];
    final Object? rawDamages = json['damages'];
    if (rawDamages is List) {
      for (final Object? item in rawDamages) {
        if (item is Map) {
          final Map<String, Object?> m = item.cast<String, Object?>();
          damages.add(
            HandoverDamageMarker(
              view: HandoverDamageView.fromKey(m['view'] as String?) ??
                  HandoverDamageView.front,
              type: HandoverDamageType.fromKey(m['type'] as String?) ??
                  HandoverDamageType.other,
              level: HandoverDamageLevel.fromKey(m['level'] as String?) ??
                  HandoverDamageLevel.minor,
              x: (m['x'] as num?)?.toDouble(),
              y: (m['y'] as num?)?.toDouble(),
              note: (m['note'] as Object?)?.toString(),
              photoUrl: (m['photo_url'] as Object?)?.toString(),
              photoLocalPath: (m['photoLocalPath'] as Object?)?.toString(),
            ),
          );
        }
      }
    }
    final List<String> photos = <String>[];
    final Object? rawPhotos = json['photos'];
    if (rawPhotos is List) {
      for (final Object? item in rawPhotos) {
        if (item is String && item.trim().isNotEmpty) photos.add(item);
      }
    }
    return HandoverDraft(
      assetNo: json['assetNo'] as String? ?? '',
      handoverType: HandoverType.fromKey(json['handoverType'] as String?) ??
          HandoverType.checkout,
      fromDriver: json['fromDriver'] as String? ?? '',
      toDriver: json['toDriver'] as String? ?? '',
      odometerText: json['odometerText'] as String? ?? '',
      fuelText: json['fuelText'] as String? ?? '',
      conditionRating:
          HandoverConditionRating.fromKey(json['conditionRating'] as String?),
      cleanliness: HandoverCleanliness.fromKey(json['cleanliness'] as String?),
      damages: damages,
      photos: photos,
      signatureDataUrl: json['signatureDataUrl'] as String?,
      notes: json['notes'] as String? ?? '',
    );
  }

  static HandoverDraft fromJsonString(String raw) =>
      fromJson((jsonDecode(raw) as Map).cast<String, Object?>());
}
