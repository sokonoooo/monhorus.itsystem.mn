import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/inspection_report_model.dart';
import '../providers/work_providers.dart';
import 'work_ui.dart';

/// "Үзлэгийн тайлан бичих" — the narrative of the consolidated inspection report.
///
/// Three facts govern this sheet:
///
/// 1. **Only the narrative is writable.** `updateInspectionReportSchema` accepts exactly
///    the six fields below and is `.strict()`, so anything else — the ерөнхий түвшин, the
///    зөрчил list, the floor sections, the version — is a 400 rather than a silent no-op.
///    Those are all derived from the sub-tasks on every read, which is why the sheet
///    cannot offer them: correcting one means correcting the sub-task it came from.
///
/// 2. **Writing takes the report out of auto-draft.** While `isAutoDraft` holds, pressing
///    "үүсгэх" again recomposes every one of these fields from the sub-tasks. The first
///    save clears the flag and the text is then preserved verbatim through any later
///    regeneration — so the note at the top says which of the two states the user is in.
///
/// 3. **A refusal is printed against the field the server named.** The per-field messages
///    from `ServerFailure.fieldErrors` are the only place a caller learns that, say, a
///    replacement line exceeded 500 characters, so they are surfaced rather than replaced
///    by one generic sentence.
Future<void> showInspectionReportSheet(
  BuildContext context, {
  required String plannedWorkId,
  required InspectionReportModel report,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    // A part-written report is worth a deliberate dismissal rather than a stray tap on
    // the scrim: nothing here is saved until the footer is pressed.
    isDismissible: false,
    enableDrag: false,
    builder: (BuildContext sheetContext) => _InspectionReportSheet(
      plannedWorkId: plannedWorkId,
      report: report,
    ),
  );
}

class _InspectionReportSheet extends ConsumerStatefulWidget {
  const _InspectionReportSheet({
    required this.plannedWorkId,
    required this.report,
  });

  final String plannedWorkId;
  final InspectionReportModel report;

  @override
  ConsumerState<_InspectionReportSheet> createState() =>
      _InspectionReportSheetState();
}

class _InspectionReportSheetState
    extends ConsumerState<_InspectionReportSheet> {
  late final TextEditingController _inspectedScope;
  late final TextEditingController _issueSummary;
  late final TextEditingController _conclusion;
  late final TextEditingController _recommendation;

  /// One controller per line of the two replacement lists.
  ///
  /// The lists are free text on the wire — `replacementPanels` and
  /// `replacementConnections` are arrays of strings, seeded from the worst findings — so
  /// rows are added and removed here rather than picked from anything.
  final List<TextEditingController> _panels = <TextEditingController>[];
  final List<TextEditingController> _connections = <TextEditingController>[];

  bool _busy = false;
  String? _submitError;
  Map<String, String> _fieldErrors = const <String, String>{};

  @override
  void initState() {
    super.initState();

    _inspectedScope =
        TextEditingController(text: widget.report.inspectedScope ?? '');
    _issueSummary = TextEditingController(text: widget.report.issueSummary ?? '');
    _conclusion = TextEditingController(text: widget.report.conclusion ?? '');
    _recommendation =
        TextEditingController(text: widget.report.recommendation ?? '');

    _panels.addAll(
      widget.report.replacementPanels
          .map((String line) => TextEditingController(text: line)),
    );
    _connections.addAll(
      widget.report.replacementConnections
          .map((String line) => TextEditingController(text: line)),
    );
  }

  @override
  void dispose() {
    _inspectedScope.dispose();
    _issueSummary.dispose();
    _conclusion.dispose();
    _recommendation.dispose();
    for (final TextEditingController controller in <TextEditingController>[
      ..._panels,
      ..._connections,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _addLine(List<TextEditingController> lines) {
    setState(() => lines.add(TextEditingController()));
  }

  void _removeLine(List<TextEditingController> lines, int index) {
    setState(() => lines.removeAt(index).dispose());
  }

  /// `replacementLineSchema` refuses an empty string, so a blank row is dropped rather
  /// than sent — a user who clears a line means to delete it.
  static List<String> _linesOf(List<TextEditingController> lines) {
    return lines
        .map((TextEditingController controller) => controller.text.trim())
        .where((String line) => line.isNotEmpty)
        .toList(growable: false);
  }

  Future<void> _save() async {
    if (_busy) return;

    setState(() {
      _busy = true;
      _submitError = null;
      _fieldErrors = const <String, String>{};
    });

    // Every field the sheet shows is sent, because every field the sheet shows was
    // editable. An emptied box goes as '' rather than being omitted: omitting it would
    // leave the old text in place, which is the opposite of what clearing it means.
    final ApiResult<InspectionReportModel> result = await ref
        .read(inspectionReportProvider(widget.plannedWorkId).notifier)
        .save(
          UpdateInspectionReportRequest(
            inspectedScope: _inspectedScope.text.trim(),
            issueSummary: _issueSummary.text.trim(),
            conclusion: _conclusion.text.trim(),
            recommendation: _recommendation.text.trim(),
            replacementPanels: _linesOf(_panels),
            replacementConnections: _linesOf(_connections),
          ),
        );

    if (!mounted) return;

    result.when(
      success: (InspectionReportModel saved) {
        Navigator.of(context).pop();
        showWorkToast(
          context,
          message: 'Үзлэгийн тайлан хадгалагдлаа — ${saved.status.label}',
          tone: EmployeeTokens.green,
        );
      },
      failure: (Failure failure) {
        setState(() {
          _busy = false;
          _submitError = failure.message;
          _fieldErrors = failure is ServerFailure
              ? failure.fieldErrors
              : const <String, String>{};
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
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
                    'Үзлэгийн тайлан бичих',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      color: EmployeeTokens.ink,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    widget.report.actName ?? 'Ил ба далд ажлын акт',
                    style: const TextStyle(
                      fontSize: 12,
                      color: EmployeeTokens.muted,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 12),

                  NoticeBanner(
                    margin: EdgeInsets.zero,
                    tone: EmployeeTokens.muted,
                    icon: Icons.auto_awesome_outlined,
                    text: widget.report.isAutoDraft
                        ? 'Доорх бичвэрийг систем дэд ажлуудаас бүрдүүлсэн. Хадгалсны '
                            'дараа тайланг дахин үүсгэсэн ч таны бичсэн үг хадгалагдана.'
                        : 'Тайланг та засварласан тул дахин үүсгэхэд доорх бичвэр '
                            'дарагдахгүй.',
                  ),
                  const SizedBox(height: 16),

                  const FieldLabel('Үзлэгээр шалгасан'),
                  SheetField(
                    controller: _inspectedScope,
                    hint: 'Ямар самбар, шугам, тоног төхөөрөмжийг хамруулснаа '
                        'бичнэ үү...',
                    maxLines: 3,
                    error: _fieldErrors['inspectedScope'],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 14),

                  const FieldLabel('Илэрсэн зөрчил'),
                  SheetField(
                    controller: _issueSummary,
                    hint: 'Илэрсэн зөрчлүүдийн хураангуй...',
                    maxLines: 5,
                    error: _fieldErrors['issueSummary'],
                    enabled: !_busy,
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 4, bottom: 10),
                    child: Text(
                      'Зөрчлийн жагсаалтыг дэд ажлын үнэлгээнээс систем гаргана — '
                      'шинэ зөрчил нэмэхийн тулд дэд ажлын оноог засна.',
                      style: TextStyle(
                        fontSize: 10.5,
                        color: EmployeeTokens.muted,
                        height: 1.5,
                      ),
                    ),
                  ),

                  const FieldLabel('Дүгнэлт'),
                  SheetField(
                    controller: _conclusion,
                    hint: 'Үзлэгийн нэгдсэн дүгнэлт...',
                    maxLines: 5,
                    error: _fieldErrors['conclusion'],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 14),

                  const FieldLabel('Зөвлөмж'),
                  SheetField(
                    controller: _recommendation,
                    hint: 'Авах арга хэмжээ, зөвлөмж...',
                    maxLines: 5,
                    error: _fieldErrors['recommendation'],
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 18),

                  _LineList(
                    label: 'Шинэчлэх шаардлагатай самбарууд',
                    hint: 'Жишээ нь: 2-р давхар — DB-2A самбар',
                    lines: _panels,
                    enabled: !_busy,
                    error: _fieldErrors['replacementPanels'],
                    onAdd: () => _addLine(_panels),
                    onRemove: (int index) => _removeLine(_panels, index),
                  ),
                  const SizedBox(height: 16),

                  _LineList(
                    label: 'Шинэчлэх шаардлагатай холболтууд',
                    hint: 'Жишээ нь: 1-р давхар — гол шугамын холболт',
                    lines: _connections,
                    enabled: !_busy,
                    error: _fieldErrors['replacementConnections'],
                    onAdd: () => _addLine(_connections),
                    onRemove: (int index) => _removeLine(_connections, index),
                  ),

                  if (_submitError != null) ...<Widget>[
                    const SizedBox(height: 14),
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
              saveLabel: 'Тайлан хадгалах',
              onCancel: _busy ? null : () => Navigator.of(context).pop(),
              onSave: _save,
            ),
          ],
        ),
      ),
    );
  }
}

/// One of the two replacement lists: a row per line, plus an add button.
class _LineList extends StatelessWidget {
  const _LineList({
    required this.label,
    required this.hint,
    required this.lines,
    required this.enabled,
    required this.error,
    required this.onAdd,
    required this.onRemove,
  });

  final String label;
  final String hint;
  final List<TextEditingController> lines;
  final bool enabled;
  final String? error;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        FieldLabel(label),
        if (lines.isEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text(
              'Одоогоор мөр байхгүй.',
              style: TextStyle(
                fontSize: 11.5,
                fontStyle: FontStyle.italic,
                color: EmployeeTokens.muted,
                height: 1.5,
              ),
            ),
          )
        else
          for (int i = 0; i < lines.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: SheetField(
                      controller: lines[i],
                      hint: hint,
                      maxLines: 2,
                      enabled: enabled,
                    ),
                  ),
                  const SizedBox(width: 8),
                  _RemoveButton(onTap: enabled ? () => onRemove(i) : null),
                ],
              ),
            ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              error!,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: EmployeeTokens.red,
              ),
            ),
          ),
        WorkButton.secondary(
          label: 'Мөр нэмэх',
          icon: Icons.add,
          onPressed: enabled ? onAdd : null,
        ),
      ],
    );
  }
}

class _RemoveButton extends StatelessWidget {
  const _RemoveButton({required this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final bool active = onTap != null;

    return Semantics(
      button: true,
      label: 'Мөр устгах',
      child: Material(
        color: EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: Border.all(
                color: active ? EmployeeTokens.line : EmployeeTokens.faint,
                width: EmployeeTokens.hairline,
              ),
            ),
            child: Icon(
              Icons.close,
              size: 17,
              color: active ? EmployeeTokens.red : EmployeeTokens.muted,
            ),
          ),
        ),
      ),
    );
  }
}
