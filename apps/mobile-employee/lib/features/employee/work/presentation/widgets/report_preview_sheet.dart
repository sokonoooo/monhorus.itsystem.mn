import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/planned_work_model.dart';
import '../format.dart';
import '../providers/work_providers.dart';
import 'work_async_view.dart';
import 'work_ui.dart';

/// "Тайлангийн урьдчилсан хувилбар" — the write-up as a reviewer will read it.
///
/// `GET /planned-work/:id/report` assembles this on every call from the sub-tasks, the
/// floor roll-up and the materials, WHETHER OR NOT a report row exists yet. That is what
/// makes it worth opening before the work is finished: it shows what the report currently
/// says while there is still time to go and fix what it says. Nothing here is editable —
/// every line is either derived by the server or was entered on the task card the line
/// names.
Future<void> showReportPreviewSheet(
  BuildContext context, {
  required String plannedWorkId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    builder: (BuildContext sheetContext) =>
        _ReportPreviewSheet(plannedWorkId: plannedWorkId),
  );
}

class _ReportPreviewSheet extends ConsumerWidget {
  const _ReportPreviewSheet({required this.plannedWorkId});

  final String plannedWorkId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PlannedWorkReportBundleModel> bundle =
        ref.watch(plannedWorkReportBundleProvider(plannedWorkId));

    return Container(
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
            child: WorkAsyncView<PlannedWorkReportBundleModel>(
              value: bundle,
              onRetry: () =>
                  ref.invalidate(plannedWorkReportBundleProvider(plannedWorkId)),
              builder: (BuildContext context, PlannedWorkReportBundleModel data) {
                final PlannedWorkReportPreviewModel? preview = data.preview;

                // The server returns null only when the record points at a deleted
                // project, building or customer, which is also the case that blocks
                // submission — so it is stated rather than shown as an empty report.
                if (preview == null) {
                  return const WorkEmptyState(
                    icon: Icons.description_outlined,
                    title: 'Тайлан бүрдээгүй',
                    message: 'Ажлын захиалагч, төсөл эсвэл объектын бүртгэл '
                        'дутуу тул тайланг бүрдүүлж чадсангүй. Администратортоо '
                        'хандана уу.',
                  );
                }

                return _PreviewBody(preview: preview);
              },
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(
              16,
              8,
              16,
              12 + MediaQuery.viewPaddingOf(context).bottom,
            ),
            child: WorkButton.secondary(
              label: 'Хаах',
              onPressed: () => Navigator.of(context).pop(),
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewBody extends StatelessWidget {
  const _PreviewBody({required this.preview});

  final PlannedWorkReportPreviewModel preview;

  @override
  Widget build(BuildContext context) {
    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      children: <Widget>[
        const Text(
          'Тайлангийн урьдчилсан хувилбар',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w900,
            color: EmployeeTokens.ink,
            height: 1.3,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          '${preview.workNumber} · ${preview.title}',
          style: const TextStyle(
            fontSize: 12,
            color: EmployeeTokens.muted,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 16),

        _Block(
          children: <Widget>[
            InfoRow(label: 'Захиалагч', value: preview.customerName),
            InfoRow(label: 'Төсөл', value: preview.projectName),
            InfoRow(label: 'Объект', value: preview.buildingName),
            InfoRow(
              label: 'Гүйцэтгэл',
              value: '${formatQuantity(preview.completedQuantity)}/'
                  '${formatQuantity(preview.totalQuantity)} · '
                  '${formatPercent(preview.progressPercent)}',
            ),
            if (preview.totalPausedMinutes > 0)
              InfoRow(
                label: 'Түр зогссон',
                value: formatMinutes(preview.totalPausedMinutes),
              ),
            InfoRow(
              label: 'Хугацаа',
              value: preview.completedLate
                  ? (preview.delayMinutes == null
                      ? 'Хоцорсон'
                      : '${formatMinutes(preview.delayMinutes!)} хоцорсон')
                  : 'Хугацаандаа',
              tone: preview.completedLate
                  ? EmployeeTokens.red
                  : EmployeeTokens.ink,
              divider: false,
            ),
          ],
        ),

        if (preview.floorProgress.isNotEmpty) ...<Widget>[
          const SizedBox(height: 16),
          const FieldLabel('Давхарын гүйцэтгэл'),
          _Block(
            children: <Widget>[
              for (int i = 0; i < preview.floorProgress.length; i++)
                InfoRow(
                  label: preview.floorProgress[i].floorName,
                  value:
                      '${formatQuantity(preview.floorProgress[i].completedQuantity)}/'
                      '${formatQuantity(preview.floorProgress[i].totalQuantity)} · '
                      '${formatPercent(preview.floorProgress[i].progressPercent)}',
                  divider: i < preview.floorProgress.length - 1,
                ),
            ],
          ),
        ],

        const SizedBox(height: 16),
        FieldLabel('Дэд ажлууд (${preview.tasks.length})'),
        for (final PlannedWorkReportTaskLineModel line in preview.tasks)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _TaskLine(line: line),
          ),

        if (preview.materials.isNotEmpty) ...<Widget>[
          const SizedBox(height: 8),
          const FieldLabel('Материал'),
          _Block(
            children: <Widget>[
              for (int i = 0; i < preview.materials.length; i++)
                InfoRow(
                  label: preview.materials[i].name,
                  value: '${formatQuantity(preview.materials[i].quantity)}'
                      ' ${preview.materials[i].unit.label}',
                  divider: i < preview.materials.length - 1,
                ),
            ],
          ),
        ],

        const SizedBox(height: 16),
        const FieldLabel('Нэгдсэн дүгнэлт'),
        _Prose(text: preview.conclusion),
        const SizedBox(height: 12),
        const FieldLabel('Нэгдсэн зөвлөмж'),
        _Prose(text: preview.recommendation),

        if (preview.generatedAt != null) ...<Widget>[
          const SizedBox(height: 14),
          Text(
            'Бүрдүүлсэн: ${formatDateTime(preview.generatedAt)}',
            style: const TextStyle(
              fontSize: 10.5,
              color: EmployeeTokens.muted,
              height: 1.5,
            ),
          ),
        ],
      ],
    );
  }
}

/// One sub-task as the assembled report prints it.
class _TaskLine extends StatelessWidget {
  const _TaskLine({required this.line});

  final PlannedWorkReportTaskLineModel line;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: EmployeeTokens.soft2,
        border: Border.all(color: EmployeeTokens.faint),
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  line.title,
                  style: EmployeeTokens.rowTitle,
                ),
              ),
              const SizedBox(width: 8),
              EmployeePill.status(label: line.status.label, color: line.status.tone),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${line.floorName} · ${formatQuantity(line.completedQuantity)}/'
            '${formatQuantity(line.totalQuantity)} ${line.unit.label} · '
            '${formatPercent(line.progressPercent)}'
            '${line.score == null ? '' : ' · ${line.score} оноо'}'
            '${line.riskLevel == null ? '' : ' · ${line.riskLevel!.label}'}',
            style: EmployeeTokens.rowSub,
          ),
          Text(
            'Зураг: өмнөх ${line.beforePhotoCount} · дараах ${line.afterPhotoCount}',
            style: EmployeeTokens.rowSub,
          ),
          if (line.note != null) ...<Widget>[
            const SizedBox(height: 6),
            _LabelledLine(label: 'Тэмдэглэл', text: line.note!),
          ],
          if (line.recommendation != null) ...<Widget>[
            const SizedBox(height: 4),
            _LabelledLine(label: 'Зөвлөмж', text: line.recommendation!),
          ],
        ],
      ),
    );
  }
}

class _LabelledLine extends StatelessWidget {
  const _LabelledLine({required this.label, required this.text});

  final String label;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        style: const TextStyle(
          fontSize: 11.5,
          color: EmployeeTokens.ink2,
          height: 1.6,
        ),
        children: <InlineSpan>[
          TextSpan(
            text: '$label: ',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          TextSpan(text: text),
        ],
      ),
    );
  }
}

/// A narrative field, or the reason it is empty.
class _Prose extends StatelessWidget {
  const _Prose({required this.text});

  final String? text;

  @override
  Widget build(BuildContext context) {
    final String? value = text;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: EmployeeTokens.soft2,
        border: Border.all(color: EmployeeTokens.faint),
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      ),
      child: Text(
        value ?? 'Хараахан бичигдээгүй.',
        style: TextStyle(
          fontSize: 11.5,
          color: value == null ? EmployeeTokens.muted : EmployeeTokens.ink2,
          fontStyle: value == null ? FontStyle.italic : FontStyle.normal,
          height: 1.6,
        ),
      ),
    );
  }
}

/// The hairline-divided box the information rows sit in.
class _Block extends StatelessWidget {
  const _Block({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11),
      decoration: BoxDecoration(
        color: EmployeeTokens.soft2,
        border: Border.all(color: EmployeeTokens.faint),
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: children,
      ),
    );
  }
}
