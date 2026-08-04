import '../../../../../core/util/json_parse.dart';
import '../../domain/entities/planned_work_enums.dart';

/// One item from the material catalogue.
///
/// Staff master data with no customer of its own: the company stocks one list and issues
/// it to whichever site the work is on.
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

  /// What a quantity field starts on, so a metre of cable is not typed as pieces.
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
