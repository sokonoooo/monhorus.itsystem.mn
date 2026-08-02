import 'package:flutter/material.dart';

import '../../presentation/theme/customer_tokens.dart';

/// Mirrors `ObjectCategory` / `OBJECT_CATEGORY_LABELS` in
/// packages/shared/src/constants/object-master.ts.
enum ObjectCategory {
  panel('PANEL', 'Самбар', AccentTone.purple),
  circuit('CIRCUIT', 'Хэлхээ/шугам', AccentTone.blue),
  equipment('EQUIPMENT', 'Тоноглол/төхөөрөмж', AccentTone.neutral);

  const ObjectCategory(this.wireValue, this.label, this.tone);

  final String wireValue;
  final String label;
  final AccentTone tone;

  static ObjectCategory? fromWire(String? value) {
    if (value == null) return null;
    for (final ObjectCategory category in ObjectCategory.values) {
      if (category.wireValue == value) return category;
    }
    return null;
  }
}

/// Mirrors `ObjectStatus` / `OBJECT_STATUS_LABELS` in
/// packages/shared/src/constants/object-master.ts.
enum ObjectStatus {
  active('ACTIVE', 'Ашиглалтад байгаа', AccentTone.green),
  inactive('INACTIVE', 'Түр идэвхгүй', AccentTone.yellow),
  decommissioned('DECOMMISSIONED', 'Ашиглалтаас гарсан', AccentTone.black);

  const ObjectStatus(this.wireValue, this.label, this.tone);

  final String wireValue;
  final String label;
  final AccentTone tone;

  static ObjectStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final ObjectStatus status in ObjectStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }
}

/// Mirrors `ObjectIcon` / `OBJECT_ICON_LABELS` in
/// packages/shared/src/constants/object-master.ts.
///
/// The Material glyph beside each value is a local presentation choice; the shared
/// package names the icon but does not supply artwork.
enum ObjectIcon {
  panel('PANEL', 'Самбар', Icons.dashboard_outlined),
  breaker('BREAKER', 'Автомат таслуур', Icons.power_settings_new),
  light('LIGHT', 'Гэрэл', Icons.lightbulb_outline),
  socket('SOCKET', 'Залгуур', Icons.power_outlined),
  switchDevice('SWITCH', 'Унтраалга', Icons.toggle_on_outlined),
  cable('CABLE', 'Кабель', Icons.cable_outlined),
  motor('MOTOR', 'Мотор', Icons.settings_outlined),
  pump('PUMP', 'Насос', Icons.water_drop_outlined),
  camera('CAMERA', 'Камер', Icons.videocam_outlined),
  sensor('SENSOR', 'Мэдрэгч', Icons.sensors_outlined),
  ups('UPS', 'UPS', Icons.battery_charging_full_outlined),
  serverRack('SERVER_RACK', 'Server rack', Icons.dns_outlined),
  hvac('HVAC', 'Агааржуулалт', Icons.hvac_outlined),
  other('OTHER', 'Бусад', Icons.category_outlined);

  const ObjectIcon(this.wireValue, this.label, this.glyph);

  final String wireValue;
  final String label;
  final IconData glyph;

  static ObjectIcon fromWire(String? value) {
    for (final ObjectIcon icon in ObjectIcon.values) {
      if (icon.wireValue == value) return icon;
    }
    return ObjectIcon.other;
  }
}

/// Mirrors `LoadIncompleteReason` / `LOAD_INCOMPLETE_REASON_LABELS` in
/// packages/shared/src/constants/object-master.ts.
enum LoadIncompleteReason {
  missingRatedPower('MISSING_RATED_POWER'),
  missingQuantity('MISSING_QUANTITY'),
  missingCapacity('MISSING_CAPACITY'),
  missingPermittedCapacity('MISSING_PERMITTED_CAPACITY'),
  noEquipment('NO_EQUIPMENT');

  const LoadIncompleteReason(this.wireValue);

  final String wireValue;

  static LoadIncompleteReason? fromWire(String? value) {
    if (value == null) return null;
    for (final LoadIncompleteReason reason in LoadIncompleteReason.values) {
      if (reason.wireValue == value) return reason;
    }
    return null;
  }
}

/// Mirrors `LOAD_INCOMPLETE_LABEL`. An incomplete calculation is never rendered as a
/// zero, so a missing technical field cannot be mistaken for a real reading.
const String loadIncompleteLabel = 'Бүрэн бус';

/// Mirrors `ObjectHistoryEntryDto['kind']`, an inline union in
/// packages/shared/src/types/object-master.types.ts with no named shared type.
enum ObjectHistoryKind {
  assessment('ASSESSMENT', 'Үнэлгээ'),
  measurement('MEASUREMENT', 'Хэмжилт'),
  inspection('INSPECTION', 'Үзлэг'),
  repair('REPAIR', 'Засвар'),
  plannedWork('PLANNED_WORK', 'Төлөвлөгөөт ажил'),
  audit('AUDIT', 'Бүртгэлийн өөрчлөлт');

  const ObjectHistoryKind(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static ObjectHistoryKind? fromWire(String? value) {
    if (value == null) return null;
    for (final ObjectHistoryKind kind in ObjectHistoryKind.values) {
      if (kind.wireValue == value) return kind;
    }
    return null;
  }
}
