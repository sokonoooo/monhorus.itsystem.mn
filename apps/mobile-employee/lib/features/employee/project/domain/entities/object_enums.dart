import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';

/// Mirrors `ObjectCategory` / `OBJECT_CATEGORY_LABELS` in
/// packages/shared/src/constants/object-master.ts.
enum ObjectCategory {
  panel('PANEL', 'Самбар'),
  circuit('CIRCUIT', 'Хэлхээ/шугам'),
  equipment('EQUIPMENT', 'Тоноглол/төхөөрөмж');

  const ObjectCategory(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static ObjectCategory? fromWire(String? value) {
    if (value == null) return null;
    for (final ObjectCategory category in ObjectCategory.values) {
      if (category.wireValue == value) return category;
    }
    return null;
  }
}

/// Mirrors `ObjectStatus` / `OBJECT_STATUS_LABELS`.
enum ObjectStatus {
  active('ACTIVE', 'Ашиглалтад байгаа', Tone.green),
  inactive('INACTIVE', 'Түр идэвхгүй', Tone.yellow),
  decommissioned('DECOMMISSIONED', 'Ашиглалтаас гарсан', Tone.black);

  const ObjectStatus(this.wireValue, this.label, this.tone);

  final String wireValue;
  final String label;
  final Tone tone;

  static ObjectStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final ObjectStatus status in ObjectStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }
}

/// Mirrors `ObjectIcon` / `OBJECT_ICON_LABELS`.
///
/// The shared package names the icon but ships no artwork, so the glyph beside each
/// value is a local choice. The prototype draws stroked outlines throughout, hence
/// the outlined Material set rather than the filled one.
enum ObjectIcon {
  panel('PANEL', Icons.dashboard_outlined),
  breaker('BREAKER', Icons.power_settings_new_outlined),
  light('LIGHT', Icons.lightbulb_outline),
  socket('SOCKET', Icons.power_outlined),
  switchDevice('SWITCH', Icons.toggle_on_outlined),
  cable('CABLE', Icons.cable_outlined),
  motor('MOTOR', Icons.settings_outlined),
  pump('PUMP', Icons.water_drop_outlined),
  camera('CAMERA', Icons.videocam_outlined),
  sensor('SENSOR', Icons.sensors_outlined),
  ups('UPS', Icons.battery_charging_full_outlined),
  serverRack('SERVER_RACK', Icons.dns_outlined),
  hvac('HVAC', Icons.hvac_outlined),
  other('OTHER', Icons.category_outlined);

  const ObjectIcon(this.wireValue, this.glyph);

  final String wireValue;
  final IconData glyph;

  static ObjectIcon fromWire(String? value) {
    for (final ObjectIcon icon in ObjectIcon.values) {
      if (icon.wireValue == value) return icon;
    }
    return ObjectIcon.other;
  }
}

/// Mirrors `LoadIncompleteReason` / `LOAD_INCOMPLETE_REASON_LABELS`.
enum LoadIncompleteReason {
  missingRatedPower('MISSING_RATED_POWER', 'Чадал бүртгэгдээгүй'),
  missingQuantity('MISSING_QUANTITY', 'Тоо ширхэг бүртгэгдээгүй'),
  missingCapacity('MISSING_CAPACITY', 'Хүчин чадал бүртгэгдээгүй'),
  missingPermittedCapacity('MISSING_PERMITTED_CAPACITY', 'Зөвшөөрөгдөх чадал алга'),
  noEquipment('NO_EQUIPMENT', 'Холбогдсон тоноглол алга');

  const LoadIncompleteReason(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static LoadIncompleteReason? fromWire(String? value) {
    if (value == null) return null;
    for (final LoadIncompleteReason reason in LoadIncompleteReason.values) {
      if (reason.wireValue == value) return reason;
    }
    return null;
  }
}

/// Mirrors `LOAD_INCOMPLETE_LABEL`. An incomplete calculation is never rendered as a
/// zero: on an electrical report a missing input and a genuine zero reading are
/// different facts.
const String loadIncompleteLabel = 'Бүрэн бус';

/// Mirrors `ObjectHistoryEntryDto['kind']`, an inline union in
/// packages/shared/src/types/object-master.types.ts with no named shared type.
enum ObjectHistoryKind {
  assessment('ASSESSMENT', 'Үнэлгээ', Icons.fact_check_outlined),
  measurement('MEASUREMENT', 'Хэмжилт', Icons.straighten_outlined),
  inspection('INSPECTION', 'Үзлэг', Icons.search_outlined),
  repair('REPAIR', 'Засвар', Icons.build_outlined),
  plannedWork('PLANNED_WORK', 'Төлөвлөгөөт ажил', Icons.event_note_outlined),
  audit('AUDIT', 'Бүртгэлийн өөрчлөлт', Icons.history_outlined);

  const ObjectHistoryKind(this.wireValue, this.label, this.glyph);

  final String wireValue;
  final String label;
  final IconData glyph;

  static ObjectHistoryKind? fromWire(String? value) {
    if (value == null) return null;
    for (final ObjectHistoryKind kind in ObjectHistoryKind.values) {
      if (kind.wireValue == value) return kind;
    }
    return null;
  }
}

