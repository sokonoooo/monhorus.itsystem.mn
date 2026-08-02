import '../../../../../core/util/json_parse.dart';
import '../../domain/entities/planned_work_enums.dart';

/// One item from the material catalogue.
///
/// Staff master data with no customer of its own: the company stocks one list and issues
/// it to whichever site the work is on. Tenancy is enforced where a material is USED — a
/// usage row belongs to a sub-task, and that sub-task's planned work names the customer.
///
/// There are no stock balances behind it, so nothing here carries a quantity on hand and
/// the app never claims to check availability.
class MaterialItemModel {
  const MaterialItemModel({
    required this.id,
    required this.code,
    required this.name,
    required this.defaultUnit,
  });

  final String id;
  final String code;
  final String name;

  /// What a new usage row starts with, so a metre of cable is not typed as pieces.
  final MaterialUnit defaultUnit;

  /// `CBL-3X2.5 · Кабель 3x2.5` — the code first, because that is what is on the reel.
  String get label => code.isEmpty ? name : '$code · $name';

  static MaterialItemModel fromJson(Map<String, dynamic> json) {
    return MaterialItemModel(
      id: parseString(json['id']) ?? '',
      code: parseString(json['code']) ?? '',
      name: parseString(json['name']) ?? '',
      defaultUnit: MaterialUnit.fromWire(parseString(json['defaultUnit'])),
    );
  }
}

/// What one sub-task consumed.
///
/// Deliberately NOT the equipment the sub-task assesses. The objects are what the visit
/// was about and receive the finding; these are the resources spent doing it. The two are
/// never merged into one list, because a spool of cable appearing in an equipment history
/// as though it had been inspected is exactly the confusion the separation prevents.
class TaskMaterialUsageModel {
  const TaskMaterialUsageModel({
    required this.id,
    required this.materialItemId,
    required this.materialCode,
    required this.materialName,
    required this.quantity,
    required this.unit,
    required this.usedAt,
    this.note,
    this.usedByName,
  });

  final String id;
  final String materialItemId;
  final String materialCode;
  final String materialName;
  final double quantity;
  final MaterialUnit unit;
  final DateTime? usedAt;
  final String? note;
  final String? usedByName;

  String get label => materialCode.isEmpty ? materialName : '$materialCode · $materialName';

  static TaskMaterialUsageModel fromJson(Map<String, dynamic> json) {
    return TaskMaterialUsageModel(
      id: parseString(json['id']) ?? '',
      materialItemId: parseString(json['materialItemId']) ?? '',
      materialCode: parseString(json['materialCode']) ?? '',
      materialName: parseString(json['materialName']) ?? '',
      quantity: parseDouble(json['quantity']) ?? 0,
      unit: MaterialUnit.fromWire(parseString(json['unit'])),
      usedAt: parseDate(json['usedAt']),
      note: parseString(json['note']),
      usedByName: parseString(json['usedByName']),
    );
  }
}
