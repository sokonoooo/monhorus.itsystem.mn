import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/task_material_model.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../providers/work_providers.dart';
import 'work_ui.dart';

/// What this sub-task consumed, inside the progress sheet.
///
/// Kept visually and structurally apart from the equipment the sub-task assesses. The
/// objects are what the visit was ABOUT and receive the finding; these are the resources
/// SPENT doing it. Putting them in one list would land a spool of cable in an equipment
/// history as though it had been inspected.
///
/// Rows are written straight through rather than collected and saved with the rest of the
/// sheet: a usage row is an event the server stamps with who used it and when, so it has
/// its own lifecycle and its own audit entry.
///
/// The catalogue has no stock balances behind it, so nothing here checks availability.
class TaskMaterialsSection extends ConsumerStatefulWidget {
  const TaskMaterialsSection({
    super.key,
    required this.plannedWorkId,
    required this.taskId,
    required this.editable,
  });

  final String plannedWorkId;
  final String taskId;

  /// False once the sub-task is DONE or SKIPPED. The list stays readable; the writes go.
  final bool editable;

  @override
  ConsumerState<TaskMaterialsSection> createState() =>
      _TaskMaterialsSectionState();
}

class _TaskMaterialsSectionState extends ConsumerState<TaskMaterialsSection> {
  final TextEditingController _quantity = TextEditingController();
  MaterialItemModel? _chosen;
  MaterialUnit _unit = MaterialUnit.piece;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }

  TaskRef get _ref =>
      (plannedWorkId: widget.plannedWorkId, taskId: widget.taskId);

  Future<void> _add() async {
    final MaterialItemModel? material = _chosen;
    final double? quantity = double.tryParse(_quantity.text.trim());
    if (material == null || quantity == null || quantity <= 0) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    final String? failure = await ref
        .read(taskMaterialsProvider(_ref).notifier)
        .add(materialItemId: material.id, quantity: quantity, unit: _unit);

    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = failure;
      if (failure == null) {
        _chosen = null;
        _quantity.clear();
      }
    });
  }

  Future<void> _remove(String usageId) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final String? failure =
        await ref.read(taskMaterialsProvider(_ref).notifier).remove(usageId);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = failure;
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppUser? user = ref.watch(currentUserProvider);
    // Read from the effective set, not the role: a control that always 403s is worse than
    // one that is absent.
    if (!(user?.has(PermissionKeys.materialView) ?? false)) {
      return const SizedBox.shrink();
    }

    final AsyncValue<List<TaskMaterialUsageModel>> rows =
        ref.watch(taskMaterialsProvider(_ref));
    final AsyncValue<List<MaterialItemModel>> catalogue =
        ref.watch(materialCatalogueProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        FieldLabel('Ашигласан материал (${rows.value?.length ?? 0})'),
        const SizedBox(height: 6),
        rows.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('Ачааллаж байна…', style: EmployeeTokens.rowSub),
          ),
          error: (Object error, StackTrace _) => const NoticeBanner(
            margin: EdgeInsets.zero,
            tone: EmployeeTokens.red,
            icon: Icons.error_outline,
            text: 'Материалын жагсаалт ачаалж чадсангүй.',
          ),
          data: (List<TaskMaterialUsageModel> used) => used.isEmpty
              ? const Text(
                  'Материал бүртгээгүй байна. Материал зарцуулаагүй ажлыг ч дуусгана.',
                  style: EmployeeTokens.rowSub,
                )
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    for (final TaskMaterialUsageModel row in used)
                      _UsageRow(
                        usage: row,
                        onRemove: widget.editable && !_busy
                            ? () => _remove(row.id)
                            : null,
                      ),
                  ],
                ),
        ),
        if (_error != null) ...<Widget>[
          const SizedBox(height: 8),
          NoticeBanner(
            margin: EdgeInsets.zero,
            tone: EmployeeTokens.red,
            icon: Icons.error_outline,
            text: _error!,
          ),
        ],
        if (widget.editable) ...<Widget>[
          const SizedBox(height: 10),
          catalogue.when(
            loading: () => const SizedBox.shrink(),
            error: (Object _, StackTrace __) => const Text(
              'Материалын жагсаалт ачаалж чадсангүй.',
              style: EmployeeTokens.rowSub,
            ),
            data: (List<MaterialItemModel> items) => Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                DropdownButtonFormField<MaterialItemModel>(
                  initialValue: _chosen,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    hintText: 'Материал сонгоно уу',
                    isDense: true,
                  ),
                  items: items
                      .map(
                        (MaterialItemModel item) =>
                            DropdownMenuItem<MaterialItemModel>(
                          value: item,
                          child:
                              Text(item.label, overflow: TextOverflow.ellipsis),
                        ),
                      )
                      .toList(),
                  onChanged: _busy
                      ? null
                      : (MaterialItemModel? value) => setState(() {
                            _chosen = value;
                            // The catalogue's own unit follows the pick, so a metre of
                            // cable is not recorded as pieces.
                            if (value != null) _unit = value.defaultUnit;
                          }),
                ),
                const SizedBox(height: 8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    Expanded(
                      child: SheetField(
                        controller: _quantity,
                        hint: 'Тоо хэмжээ',
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        enabled: !_busy,
                      ),
                    ),
                    const SizedBox(width: 10),
                    // The unit follows the catalogue pick and is shown rather than chosen:
                    // the item knows what it is measured in.
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(_unit.label, style: EmployeeTokens.rowSub),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                // On its own line: WorkButton is a full-width pill, and a Row gives a
                // non-flexed child unbounded width, which it cannot lay out in.
                WorkButton.secondary(
                  label: 'Материал нэмэх',
                  busy: _busy,
                  onPressed: _chosen == null || _busy ? null : _add,
                ),
              ],
            ),
          ),
        ] else
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              'Дэд ажил дууссан тул материалын бүртгэлийг өөрчлөх боломжгүй.',
              style: EmployeeTokens.rowSub,
            ),
          ),
      ],
    );
  }
}

class _UsageRow extends StatelessWidget {
  const _UsageRow({required this.usage, this.onRemove});

  final TaskMaterialUsageModel usage;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  usage.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.rowTitle,
                ),
                Text(
                  <String>[
                    if (usage.usedByName != null) usage.usedByName!,
                    if (usage.note != null && usage.note!.isNotEmpty)
                      usage.note!,
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.rowSub,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${usage.quantity} ${usage.unit.label}',
            style: EmployeeTokens.rowTitle,
          ),
          if (onRemove != null)
            IconButton(
              onPressed: onRemove,
              icon: const Icon(Icons.close, size: 18),
              tooltip: 'Устгах',
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
    );
  }
}
