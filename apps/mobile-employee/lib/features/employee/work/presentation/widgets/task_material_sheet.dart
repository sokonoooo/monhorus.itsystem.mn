import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/planned_work_model.dart';
import '../format.dart';
import '../providers/work_providers.dart';
import 'work_ui.dart';

/// "Материалын зарцуулалт" — what one sub-task drew from the work's materials.
///
/// Three things govern everything below:
///
/// 1. Only materials REGISTERED ON THIS WORK may be drawn. The catalogue is not
///    offered here: a material with no registration on the work has no pool behind it
///    and the server refuses the write, so listing it would be an invitation to a 400.
///
/// 2. The quantity is ABSOLUTE for the (sub-task, material) pair, not an increment.
///    Sending 50 twice leaves 50 consumed, which is what makes a retry on a bad
///    connection safe — and it is why the field is PRE-FILLED with what this sub-task
///    already recorded for the chosen material. The write is a correction of the whole
///    figure. Zero deletes the entry and returns the material to the pool, which is
///    stated on screen rather than left to be discovered.
///
/// 3. Бүртгэсэн / Зарцуулсан / Үлдсэн are printed exactly as the server sent them and
///    none of them is checked against the typed quantity here. The remainder is a
///    shared pool that another sub-task can move while this sheet is open, so the only
///    honest arbiter of "too much" is the server — which refuses with a Mongolian
///    message naming what is left, and that message is what appears under the field.
Future<void> showTaskMaterialSheet(
  BuildContext context, {
  required String plannedWorkId,
  required PlannedWorkTaskModel task,
  required List<PlannedWorkMaterialModel> materials,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    builder: (BuildContext sheetContext) => _TaskMaterialSheet(
      plannedWorkId: plannedWorkId,
      task: task,
      materials: materials,
    ),
  );
}

class _TaskMaterialSheet extends ConsumerStatefulWidget {
  const _TaskMaterialSheet({
    required this.plannedWorkId,
    required this.task,
    required this.materials,
  });

  final String plannedWorkId;
  final PlannedWorkTaskModel task;
  final List<PlannedWorkMaterialModel> materials;

  @override
  ConsumerState<_TaskMaterialSheet> createState() => _TaskMaterialSheetState();
}

class _TaskMaterialSheetState extends ConsumerState<_TaskMaterialSheet> {
  late final TextEditingController _quantity;

  /// The catalogue id of the chosen material, or null while nothing is chosen.
  String? _materialItemId;

  bool _busy = false;
  String? _materialError;
  String? _quantityError;
  String? _submitError;

  @override
  void initState() {
    super.initState();
    _quantity = TextEditingController();

    // One registered material is no choice at all, so it is made and the sheet opens
    // on the figure that material already carries for this sub-task.
    if (widget.materials.length == 1) {
      _select(widget.materials.first);
    }
  }

  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }

  /// What this sub-task has already recorded against [materialItemId], or null when it
  /// has recorded nothing.
  TaskMaterialUsageModel? _usageFor(String materialItemId) {
    for (final TaskMaterialUsageModel usage in widget.task.materialUsage) {
      if (usage.materialItemId == materialItemId) return usage;
    }
    return null;
  }

  /// Chooses a material and pre-fills the field with the sub-task's existing entry for
  /// it. The pre-fill is safe here — and required — precisely because the quantity is
  /// absolute: opening on an empty field and saving would silently rewrite a recorded
  /// 50 to whatever was typed instead of correcting it.
  void _select(PlannedWorkMaterialModel material) {
    final TaskMaterialUsageModel? existing = _usageFor(material.materialItemId);
    _materialItemId = material.materialItemId;
    _materialError = null;
    _quantityError = null;
    _quantity.text =
        existing == null ? '' : formatQuantity(existing.quantity);
  }

  PlannedWorkMaterialModel? get _selected {
    final String? id = _materialItemId;
    if (id == null) return null;
    for (final PlannedWorkMaterialModel material in widget.materials) {
      if (material.materialItemId == id) return material;
    }
    return null;
  }

  Future<void> _submit() async {
    final PlannedWorkMaterialModel? material = _selected;
    final String raw = _quantity.text.trim().replaceAll(',', '.');
    final double? typed = double.tryParse(raw);

    setState(() {
      _materialError = material == null ? 'Материал сонгоно уу.' : null;
      if (raw.isEmpty) {
        _quantityError = 'Зарцуулсан тоо хэмжээг оруулна уу.';
      } else if (typed == null || typed < 0) {
        _quantityError = 'Тоо хэмжээг эерэг тоогоор оруулна уу.';
      } else {
        _quantityError = null;
      }
      _submitError = null;
    });

    if (material == null || typed == null || _quantityError != null) return;

    setState(() => _busy = true);

    final ApiResult<PlannedWorkModel> result = await ref
        .read(plannedWorkDetailProvider(widget.plannedWorkId).notifier)
        .recordMaterialUsage(
          taskId: widget.task.id,
          request: RecordTaskMaterialUsageRequest(
            materialItemId: material.materialItemId,
            quantity: typed,
          ),
        );

    if (!mounted) return;

    result.when(
      success: (PlannedWorkModel work) {
        // Read the stored figures back out of the answer rather than reporting what
        // was typed: the server owns both the entry and the pool it came out of.
        final PlannedWorkMaterialModel updated = work.materials.firstWhere(
          (PlannedWorkMaterialModel item) =>
              item.materialItemId == material.materialItemId,
          orElse: () => material,
        );

        Navigator.of(context).pop();
        showWorkToast(
          context,
          message: typed <= 0
              ? '${updated.name}-н зарцуулалт устлаа — үлдэгдэл '
                  '${formatQuantity(updated.remainingQuantity)} '
                  '${updated.unit.label}'
              : '${updated.name} · ${formatQuantity(typed)} '
                  '${updated.unit.label} бүртгэгдлээ — үлдэгдэл '
                  '${formatQuantity(updated.remainingQuantity)} '
                  '${updated.unit.label}',
          tone: EmployeeTokens.green,
        );
      },
      failure: (Failure failure) {
        // The sheet stays open. A refusal here is nearly always "үлдэгдэл хүрэхгүй",
        // which is answered by typing a smaller number — closing the sheet would make
        // the technician find their way back to it first.
        setState(() {
          _busy = false;
          _submitError = failure.message;
          if (failure is ServerFailure) {
            _quantityError = failure.fieldErrors['quantity'];
          }
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final PlannedWorkMaterialModel? selected = _selected;
    final TaskMaterialUsageModel? existing = selected == null
        ? null
        : _usageFor(selected.materialItemId);

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.92,
        ),
        decoration: const BoxDecoration(
          color: EmployeeTokens.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(EmployeeTokens.radiusSheet),
          ),
          border: Border(
            top: BorderSide(
              color: EmployeeTokens.line,
              width: EmployeeTokens.hairline,
            ),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SheetHandle(),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                children: <Widget>[
                  const Text(
                    'Материалын зарцуулалт',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      color: EmployeeTokens.ink,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    widget.task.title,
                    style: const TextStyle(
                      fontSize: 12,
                      color: EmployeeTokens.muted,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 14),

                  if (widget.materials.isEmpty)
                    const NoticeBanner(
                      margin: EdgeInsets.zero,
                      tone: EmployeeTokens.yellow,
                      icon: Icons.inventory_2_outlined,
                      title: 'Материал бүртгэгдээгүй',
                      text: 'Энэ ажилд материал бүртгэгдээгүй тул зарцуулалт '
                          'бүртгэх боломжгүй. Материал нэмэхийг төлөвлөгчөөс '
                          'хүснэ үү.',
                    )
                  else ...<Widget>[
                    const FieldLabel('Материал сонгох'),
                    for (final PlannedWorkMaterialModel material
                        in widget.materials)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _MaterialOption(
                          material: material,
                          usage: _usageFor(material.materialItemId),
                          selected:
                              material.materialItemId == _materialItemId,
                          onTap: _busy
                              ? null
                              : () => setState(() => _select(material)),
                        ),
                      ),
                    if (_materialError != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          _materialError!,
                          style: EmployeeTokens.rowSub.copyWith(
                            fontWeight: FontWeight.w600,
                            color: EmployeeTokens.red,
                          ),
                        ),
                      ),
                    const SizedBox(height: 6),

                    FieldLabel(
                      selected == null
                          ? 'Зарцуулсан тоо хэмжээ'
                          : 'Зарцуулсан тоо хэмжээ (${selected.unit.label})',
                    ),
                    SheetField(
                      // Keyed because a pre-filled field shows no hint, leaving
                      // nothing else on screen that identifies this one.
                      key: const Key('material-quantity-field'),
                      controller: _quantity,
                      hint: 'Жишээ нь 50',
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: <TextInputFormatter>[
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                        LengthLimitingTextInputFormatter(12),
                      ],
                      error: _quantityError,
                      enabled: !_busy && selected != null,
                    ),
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(
                        existing == null
                            ? 'Энэ тоо энэ дэд ажлын НИЙТ зарцуулалт болж '
                                'хадгалагдана — өмнөх дээр нэмэгдэхгүй. 0 бол '
                                'бүртгэл устаж, материал үлдэгдэлд буцна.'
                            : 'Энэ дэд ажил ${selected?.name ?? ''} материалаас '
                                '${formatQuantity(existing.quantity)} '
                                '${existing.unit.label} бүртгүүлсэн байна. '
                                'Оруулсан тоо түүнийг ЗАСНА — дээр нь '
                                'нэмэгдэхгүй. 0 бол бүртгэл устаж, материал '
                                'үлдэгдэлд буцна.',
                        style: EmployeeTokens.microNote,
                      ),
                    ),
                  ],

                  if (_submitError != null) ...<Widget>[
                    const SizedBox(height: 12),
                    NoticeBanner(
                      margin: EdgeInsets.zero,
                      tone: EmployeeTokens.red,
                      icon: Icons.error_outline,
                      text: _submitError!,
                    ),
                  ],
                ],
              ),
            ),
            SheetFooter(
              busy: _busy,
              saveLabel: 'Зарцуулалт хадгалах',
              onCancel: _busy ? null : () => Navigator.of(context).pop(),
              onSave: _submit,
            ),
          ],
        ),
      ),
    );
  }
}

/// One registered material, with the pool it is drawn from spelled out.
///
/// Бүртгэсэн / Зарцуулсан / Үлдсэн are on the row itself rather than behind the
/// selection, because what is available is exactly what a technician needs in order to
/// decide which material to pick and what to type. All three come from the server; the
/// row does no arithmetic of its own.
class _MaterialOption extends StatelessWidget {
  const _MaterialOption({
    required this.material,
    required this.usage,
    required this.selected,
    required this.onTap,
  });

  final PlannedWorkMaterialModel material;

  /// What THIS sub-task already drew of it, or null when it drew nothing.
  final TaskMaterialUsageModel? usage;

  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final TaskMaterialUsageModel? recorded = usage;

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: selected ? EmployeeTokens.greenBg : EmployeeTokens.soft2,
          border: Border.all(
            color: selected ? EmployeeTokens.green : EmployeeTokens.faint,
          ),
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  size: 16,
                  color:
                      selected ? EmployeeTokens.green : EmployeeTokens.muted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    material.name,
                    style: EmployeeTokens.rowTitle.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Expanded(
                  child: _Figure(
                    value: formatQuantity(material.quantity),
                    label: 'Бүртгэсэн',
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: _Figure(
                    value: formatQuantity(material.consumedQuantity),
                    label: 'Зарцуулсан',
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: _Figure(
                    // Server-sent, never `quantity - consumedQuantity`.
                    value: formatQuantity(material.remainingQuantity),
                    label: 'Үлдсэн',
                    tone: EmployeeTokens.green,
                  ),
                ),
              ],
            ),
            if (recorded != null) ...<Widget>[
              const SizedBox(height: 6),
              Text(
                'Энэ дэд ажлаас: ${formatQuantity(recorded.quantity)} '
                '${recorded.unit.label}'
                '${recorded.recordedByName == null ? '' : ' · ${recorded.recordedByName}'}',
                style: EmployeeTokens.microNote,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({
    required this.value,
    required this.label,
    this.tone = EmployeeTokens.ink,
  });

  final String value;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: EmployeeTokens.detailValue.copyWith(
            fontWeight: FontWeight.w900,
            color: tone,
          ),
        ),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: EmployeeTokens.microLabel.copyWith(
            fontWeight: FontWeight.w400,
          ),
        ),
      ],
    );
  }
}
