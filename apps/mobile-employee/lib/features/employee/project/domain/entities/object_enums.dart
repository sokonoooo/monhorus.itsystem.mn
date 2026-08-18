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
///
/// Every value must be distinguishable from every other AT PLAN SIZE, not merely on a
/// settings row: on a floor plan the glyph is the only thing separating a socket from a
/// sensor, drawn inside a dot a couple of dozen logical pixels across. That rules out
/// two glyphs whose silhouettes differ only in a detail — hence a plug for SOCKET and a
/// radiating arc for SENSOR rather than two near-identical roundels.
///
/// [label] mirrors `OBJECT_ICON_LABELS` and is what a screen reader is given for the
/// glyph, which is otherwise a picture with no name.
enum ObjectIcon {
  panel('PANEL', 'Самбар', Icons.dashboard_outlined),
  breaker('BREAKER', 'Автомат таслуур', Icons.power_settings_new_outlined),
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

  /// The Mongolian name of the icon, as `OBJECT_ICON_LABELS` gives it.
  final String label;

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


/// Mirrors `LoadMeasurementKind` / `LOAD_MEASUREMENT_KIND_LABELS` in
/// packages/shared/src/constants/load-measurement.ts.
///
/// Each kind has exactly one valid unit, carried here so a picker can label itself and
/// so the request body can fill the unit in from the kind rather than asking a
/// technician to choose it. The backend re-checks the pair and refuses a mismatch.
enum LoadMeasurementKind {
  current('CURRENT', 'Гүйдэл', LoadMeasurementUnit.ampere),
  voltage('VOLTAGE', 'Хүчдэл', LoadMeasurementUnit.volt),
  activePower('ACTIVE_POWER', 'Идэвхтэй чадал', LoadMeasurementUnit.kilowatt);

  const LoadMeasurementKind(this.wireValue, this.label, this.unit);

  final String wireValue;
  final String label;
  final LoadMeasurementUnit unit;

  /// Only a current and a voltage are read on a single conductor.
  bool get acceptsPhase => this != LoadMeasurementKind.activePower;

  static LoadMeasurementKind? fromWire(String? value) {
    if (value == null) return null;
    for (final LoadMeasurementKind kind in LoadMeasurementKind.values) {
      if (kind.wireValue == value) return kind;
    }
    return null;
  }
}

/// Mirrors `LoadMeasurementUnit` / `LOAD_MEASUREMENT_UNIT_LABELS`.
enum LoadMeasurementUnit {
  ampere('AMPERE', 'А'),
  volt('VOLT', 'В'),
  kilowatt('KILOWATT', 'кВт');

  const LoadMeasurementUnit(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static LoadMeasurementUnit? fromWire(String? value) {
    if (value == null) return null;
    for (final LoadMeasurementUnit unit in LoadMeasurementUnit.values) {
      if (unit.wireValue == value) return unit;
    }
    return null;
  }
}

/// Mirrors `LoadMeasurementPhase` / `LOAD_MEASUREMENT_PHASE_LABELS`.
///
/// Absent — a null phase — is a valid reading, not a missing one: it means the reading
/// is not phase-specific, which is the normal case on a single-phase supply.
enum LoadMeasurementPhase {
  l1('L1', 'L1 фаз'),
  l2('L2', 'L2 фаз'),
  l3('L3', 'L3 фаз'),
  neutral('N', 'Тэг (N)');

  const LoadMeasurementPhase(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static LoadMeasurementPhase? fromWire(String? value) {
    if (value == null) return null;
    for (final LoadMeasurementPhase phase in LoadMeasurementPhase.values) {
      if (phase.wireValue == value) return phase;
    }
    return null;
  }
}

/// Mirrors `ObjectAttributeType` in
/// packages/shared/src/constants/object-type-attribute.ts.
///
/// What one of an object TYPE's own declared fields holds — the thing an administrator
/// defines in Тоноглолын төрөл and this app asks about on the үнэлгээ sheet. Unrelated to
/// [ObjectCategory], which is structural and fixed.
enum ObjectAttributeType {
  select('SELECT'),
  text('TEXT'),
  number('NUMBER'),
  boolean('BOOLEAN');

  const ObjectAttributeType(this.wireValue);

  final String wireValue;

  /// Tolerant, like every other `fromWire` here: a kind this build has never heard of
  /// falls back to free text rather than dropping the field or throwing. A technician
  /// then still sees the question and can still answer it, and the server has the last
  /// word on whether the answer is acceptable.
  static ObjectAttributeType fromWire(String? value) {
    for (final ObjectAttributeType type in ObjectAttributeType.values) {
      if (type.wireValue == value) return type;
    }
    return ObjectAttributeType.text;
  }
}
