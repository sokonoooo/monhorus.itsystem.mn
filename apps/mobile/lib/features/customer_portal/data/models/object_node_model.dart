import '../../domain/entities/risk_level.dart';
import '../../domain/entities/service_request_enums.dart';
import 'json_utils.dart';

/// Mirrors `ObjectNodeDto` in packages/shared/src/types/object.types.ts.
///
/// A node of the customer hierarchy — Харилцагч → Төсөл → Барилга → Давхар →
/// Өрөө/Бүс → Самбар → Хэлхээ → Төхөөрөмж — as `GET /objects/nodes` returns it.
///
/// Deliberately NOT the same thing as [ObjectListItemModel], which mirrors the object
/// *master* register. The two live in different collections and their ids are not
/// interchangeable: a service request's `roomId`, `floorId` and `deviceId` name nodes
/// from THIS type, and the backend resolves them with `ObjectNode.findById`. Passing a
/// master-register id into one of those fields is refused with a 400, which is exactly
/// the defect this model exists to make hard to repeat.
///
/// [name] is what the picker shows; [code] is the administrator's own identifier and
/// is appended when it adds something, because two zones on a floor are often named
/// alike and the code is what tells them apart.
class ObjectNodeModel {
  const ObjectNodeModel({
    required this.id,
    required this.kind,
    required this.code,
    required this.name,
    required this.parentId,
    required this.customerId,
    required this.riskScore,
    required this.riskLevel,
    required this.hasChildren,
    required this.isActive,
  });

  final String id;
  final ObjectNodeKind? kind;
  final String code;
  final String name;

  /// Null only for a root-level node. For a zone this is its floor.
  final String? parentId;
  final String customerId;

  /// Latest valid assessment. Null when the node has never been assessed, which is a
  /// distinct state from a low score and must never render as a zero.
  final int? riskScore;
  final RiskLevel? riskLevel;
  final bool hasChildren;
  final bool isActive;

  factory ObjectNodeModel.fromJson(Map<String, dynamic> json) {
    return ObjectNodeModel(
      id: json['id'] as String,
      kind: ObjectNodeKind.fromWire(json['kind'] as String?),
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      parentId: emptyToNull(json['parentId']),
      customerId: json['customerId'] as String? ?? '',
      riskScore: parseInt(json['riskScore']),
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      hasChildren: json['hasChildren'] as bool? ?? false,
      isActive: json['isActive'] as bool? ?? true,
    );
  }

  /// "Сервер өрөө А · ZONE-1" — what a picker row reads.
  ///
  /// The code is only added when there is one: a node registered without one would
  /// otherwise render a dangling separator.
  String get pickerLabel => code.isEmpty ? name : '$name · $code';
}
