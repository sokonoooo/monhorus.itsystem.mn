import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/photo_source_sheet.dart';
import '../../data/models/planned_work_model.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../format.dart';
import '../providers/work_providers.dart';
import 'evidence_photo_strip.dart';
import 'work_ui.dart';

/// "Өнөөдрийн гүйцэтгэл оруулах" — the daily entry for one sub-task.
///
/// The two things worth knowing before changing anything here:
///
/// 1. The stepper collects TODAY's increment, but `completedQuantity` on the wire is
///    the CUMULATIVE total. The sheet adds the increment to what was already done and
///    sends the sum, which is why the preview line spells out both numbers — a
///    technician who reads "20" in the stepper and "21/21" in the preview can see
///    which one the system is about to store.
///
/// 2. Reaching DONE is not a matter of quantity. The backend derives a task's status
///    from quantity AND an evidence gate — before photo, after photo, Тайлбар,
///    Зөвлөмж and a 0-100 Үнэлгээ. The note, score and recommendation fields exist
///    here because without them a task can be recorded at 100% and still sit in
///    IN_PROGRESS forever; `missingEvidence` from the server is shown verbatim so the
///    remaining requirements are never guessed at. Дүгнэлт is collected alongside
///    them — not part of the gate, but the field that fills the Дүгнэлт column of
///    Үзлэг ба дүгнэлт once the sub-task's result is fanned out to its equipment.
///
///    That equipment is named at the top of the sheet. One Үнэлгээ is written onto
///    every object the sub-task covers, so the list has to be visible while the
///    number is being chosen rather than discovered afterwards.
///
/// 3. The two photo strips write straight through. A picture goes to
///    `POST .../tasks/:taskId/photos` the moment it is chosen, because that is the
///    only API there is — there is no draft attachment to submit later. The sheet
///    says so above the strips, and the reply is the whole re-read record, so a task
///    can visibly reach DONE while the sheet is still open.
Future<void> showTaskProgressSheet(
  BuildContext context, {
  required String plannedWorkId,
  required PlannedWorkTaskModel task,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    builder: (BuildContext sheetContext) => _TaskProgressSheet(
      plannedWorkId: plannedWorkId,
      task: task,
    ),
  );
}

class _TaskProgressSheet extends ConsumerStatefulWidget {
  const _TaskProgressSheet({required this.plannedWorkId, required this.task});

  final String plannedWorkId;
  final PlannedWorkTaskModel task;

  @override
  ConsumerState<_TaskProgressSheet> createState() => _TaskProgressSheetState();
}

class _TaskProgressSheetState extends ConsumerState<_TaskProgressSheet> {
  late final TextEditingController _note;
  late final TextEditingController _conclusion;
  late final TextEditingController _recommendation;
  late final TextEditingController _score;

  /// Today's increment, not the cumulative total.
  late double _today;

  bool _busy = false;
  String? _noteError;
  String? _scoreError;
  String? _submitError;

  /// Which strip is uploading, so only that tile spins and a second tap on either
  /// strip is refused while a photo is in flight.
  TaskPhotoKind? _uploadingKind;

  /// A capture or upload problem, already phrased for the user. Kept apart from
  /// [_submitError] so a failed photo does not read as a failed progress entry.
  String? _photoError;

  double get _remaining => widget.task.remainingQuantity
      .clamp(0, widget.task.totalQuantity)
      .toDouble();

  @override
  void initState() {
    super.initState();

    // Pre-fills the existing values so a second entry edits the record rather than
    // silently blanking a note the previous session wrote.
    _note = TextEditingController(text: widget.task.note ?? '');
    _conclusion = TextEditingController(text: widget.task.conclusion ?? '');
    _recommendation = TextEditingController(text: widget.task.recommendation ?? '');
    _score = TextEditingController(text: widget.task.score?.toString() ?? '');

    // The prototype opens at half the remainder, minimum one. Anything above the
    // remainder is meaningless, so a finished task opens at zero.
    final double half = (_remaining / 2).roundToDouble();
    _today = _remaining <= 0
        ? 0
        : (half < 1 ? 1.0 : half).clamp(0, _remaining).toDouble();
  }

  @override
  void dispose() {
    _note.dispose();
    _conclusion.dispose();
    _recommendation.dispose();
    _score.dispose();
    super.dispose();
  }

  void _step(double delta) {
    setState(() => _today = (_today + delta).clamp(0, _remaining).toDouble());
  }

  /// The task as the server last described it.
  ///
  /// The sheet opens on a snapshot, but a photo upload replies with the whole record,
  /// so the strips, the counts and the "дутуу байгаа" list must read from the live
  /// one or they would keep showing the state the sheet was opened in. Quantity is
  /// deliberately still taken from the snapshot: an upload cannot change it, and the
  /// stepper must not move under the technician's finger.
  PlannedWorkTaskModel _liveTask(PlannedWorkModel? work) {
    if (work == null) return widget.task;
    return work.tasks.firstWhere(
      (PlannedWorkTaskModel item) => item.id == widget.task.id,
      orElse: () => widget.task,
    );
  }

  /// Captures one evidence photo and uploads it immediately.
  ///
  /// Three outcomes, three behaviours: a cancel is silent, a capture or permission
  /// problem prints the sentence [capturePhoto] produced, and a server refusal prints
  /// the backend's own Mongolian message. No branch surfaces an exception.
  Future<void> _addPhoto(TaskPhotoKind kind) async {
    if (_busy || _uploadingKind != null) return;

    final PhotoSource? source = await showPhotoSourceSheet(context);
    // Dismissing the source sheet is a cancel, not a failure.
    if (source == null || !mounted) return;

    final PhotoCaptureResult picked = await capturePhoto(source: source);
    if (!mounted) return;

    switch (picked) {
      case PhotoCaptureCancelled():
        return;
      case PhotoCaptureFailed(message: final String message):
        setState(() => _photoError = message);
        return;
      case PhotoCaptured(photo: final CapturedPhoto photo):
        setState(() {
          _uploadingKind = kind;
          _photoError = null;
        });

        final ApiResult<PlannedWorkModel> result = await ref
            .read(plannedWorkDetailProvider(widget.plannedWorkId).notifier)
            .attachPhoto(taskId: widget.task.id, kind: kind, photo: photo);

        if (!mounted) return;
        setState(() => _uploadingKind = null);

        result.when(
          success: (PlannedWorkModel work) {
            final PlannedWorkTaskModel updated = _liveTask(work);
            showWorkToast(
              context,
              message: updated.isDone
                  ? '${kind.label} хавсаргагдаж, дэд ажил дууслаа.'
                  : '${kind.label} хавсаргагдлаа.',
              tone: EmployeeTokens.green,
            );
          },
          failure: (Failure failure) =>
              setState(() => _photoError = failure.message),
        );
    }
  }

  Future<void> _submit() async {
    // A photo upload also answers with the whole record, so letting a save race it
    // would publish two different versions of the same task in either order.
    if (_uploadingKind != null) return;

    final String note = _note.text.trim();
    final String conclusion = _conclusion.text.trim();
    final String recommendation = _recommendation.text.trim();
    final String rawScore = _score.text.trim();

    int? score;
    String? scoreError;
    if (rawScore.isNotEmpty) {
      final int? parsed = int.tryParse(rawScore);
      if (parsed == null || parsed < 0 || parsed > 100) {
        scoreError = 'Оноо 0-100 хооронд бүхэл тоо байна.';
      } else {
        score = parsed;
      }
    }

    setState(() {
      _noteError = note.isEmpty ? 'Тэмдэглэл заавал бичнэ.' : null;
      _scoreError = scoreError;
      _submitError = null;
    });

    if (_noteError != null || _scoreError != null) return;

    if (_today <= 0 && widget.task.completedQuantity <= 0) {
      setState(() => _submitError = 'Өнөөдөр хийсэн тоо хэмжээг оруулна уу.');
      return;
    }

    setState(() => _busy = true);

    final double cumulative =
        (widget.task.completedQuantity + _today).clamp(0, widget.task.totalQuantity);

    final ApiResult<PlannedWorkModel> result = await ref
        .read(plannedWorkDetailProvider(widget.plannedWorkId).notifier)
        .recordProgress(
          taskId: widget.task.id,
          request: RecordTaskProgressRequest(
            completedQuantity: cumulative,
            // Tells the server work has begun even when no quantity landed, which is
            // the difference between PENDING and IN_PROGRESS on a task that is only
            // being annotated.
            started: true,
            note: note,
            conclusion: conclusion.isEmpty ? null : conclusion,
            score: score,
            recommendation: recommendation.isEmpty ? null : recommendation,
          ),
        );

    if (!mounted) return;

    result.when(
      success: (PlannedWorkModel work) {
        // Read the task back from the server's response rather than assuming the
        // arithmetic held: the evidence gate may have moved the status, and the
        // recorded quantity is whatever the backend stored.
        final PlannedWorkTaskModel updated = work.tasks.firstWhere(
          (PlannedWorkTaskModel item) => item.id == widget.task.id,
          orElse: () => widget.task,
        );

        Navigator.of(context).pop();
        showWorkToast(
          context,
          message: 'Гүйцэтгэл нэмэгдлээ — '
              '${formatQuantity(updated.completedQuantity)}/'
              '${formatQuantity(updated.totalQuantity)} · '
              '${formatPercent(updated.progressPercent)}',
          tone: EmployeeTokens.green,
        );
      },
      failure: (Failure failure) {
        setState(() {
          _busy = false;
          _submitError = failure.message;
          if (failure is ServerFailure) {
            _noteError = failure.fieldErrors['note'];
            _scoreError = failure.fieldErrors['score'];
          }
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    // Quantity from the snapshot the sheet opened on; evidence from the live record,
    // which a photo upload rewrites while the sheet is still on screen.
    final PlannedWorkTaskModel task = widget.task;
    final PlannedWorkTaskModel live = _liveTask(
      ref.watch(plannedWorkDetailProvider(widget.plannedWorkId)).valueOrNull,
    );

    final double projected =
        (task.completedQuantity + _today).clamp(0, task.totalQuantity);
    final double projectedPercent =
        task.totalQuantity <= 0 ? 0 : (projected / task.totalQuantity) * 100;

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
                    'Өнөөдрийн гүйцэтгэл оруулах',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                      color: EmployeeTokens.ink,
                      height: 1.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    task.title,
                    style: const TextStyle(
                      fontSize: 12,
                      color: EmployeeTokens.muted,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Named before anything is typed, not after: the single Үнэлгээ below
                  // is copied onto every one of these objects and sets its risk band, so
                  // which ones they are has to be readable while the number is chosen.
                  _CoveredEquipment(objects: task.relatedObjects),
                  const SizedBox(height: 18),

                  const FieldLabel('Өнөөдөр хийсэн тоо хэмжээ'),
                  _Stepper(
                    value: _today,
                    total: task.totalQuantity,
                    unit: task.unit,
                    onStep: _remaining <= 0 ? null : _step,
                  ),
                  const SizedBox(height: 12),

                  _PreviewBox(
                    done: task.completedQuantity,
                    today: _today,
                    total: task.totalQuantity,
                    projected: projected,
                    projectedPercent: projectedPercent,
                    unit: task.unit,
                  ),
                  const SizedBox(height: 18),

                  const FieldLabel('Тэмдэглэл (заавал)'),
                  SheetField(
                    controller: _note,
                    hint: 'Хийсэн ажил, хэмжилт, дүгнэлтээ бичнэ үү...',
                    maxLines: 4,
                    error: _noteError,
                    enabled: !_busy,
                  ),
                  const SizedBox(height: 14),

                  const FieldLabel('Үнэлгээ (0–100)'),
                  SheetField(
                    controller: _score,
                    hint: '0–100',
                    keyboardType: TextInputType.number,
                    inputFormatters: <TextInputFormatter>[
                      FilteringTextInputFormatter.digitsOnly,
                      LengthLimitingTextInputFormatter(3),
                    ],
                    error: _scoreError,
                    enabled: !_busy,
                  ),
                  const Padding(
                    padding: EdgeInsets.only(top: 4, bottom: 10),
                    child: Text(
                      'Эрсдэлийн түвшнийг систем оноогоор тодорхойлно — гараар '
                      'сонгохгүй.',
                      style: TextStyle(
                        fontSize: 10.5,
                        color: EmployeeTokens.muted,
                        height: 1.5,
                      ),
                    ),
                  ),

                  const FieldLabel('Дүгнэлт'),
                  SheetField(
                    // Keyed because a pre-filled field shows no hint, leaving nothing
                    // else in the sheet that identifies this one rather than the note
                    // or the recommendation beside it.
                    key: const Key('task-conclusion-field'),
                    controller: _conclusion,
                    hint: 'Тоноглолын байдалд өгөх дүгнэлт...',
                    maxLines: 3,
                    enabled: !_busy,
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 4, bottom: 10),
                    child: Text(
                      task.relatedObjects.isEmpty
                          ? 'Тоноглол сонгоогүй бол энэ дүгнэлт Үзлэг ба дүгнэлт хэсэгт '
                              'харагдахгүй: тэнд зөвхөн тоноглолд холбогдсон үр дүн жагсдаг.'
                          : 'Энэ дүгнэлт дээрх ${task.relatedObjects.length} тоноглол '
                              'тус бүрд бичигдэнэ.',
                      style: EmployeeTokens.microNote,
                    ),
                  ),

                  const FieldLabel('Зөвлөмж'),
                  SheetField(
                    controller: _recommendation,
                    hint: 'Дараагийн үзлэгт анхаарах зүйл...',
                    maxLines: 3,
                    enabled: !_busy,
                  ),

                  const SizedBox(height: 18),
                  const FieldLabel('Нотлох зураг'),
                  const Padding(
                    padding: EdgeInsets.only(bottom: 10),
                    child: Text(
                      'Сонгосон зураг шууд хадгалагдана — "Болих" дарсан ч '
                      'устахгүй.',
                      style: TextStyle(
                        fontSize: 10.5,
                        color: EmployeeTokens.muted,
                        height: 1.5,
                      ),
                    ),
                  ),
                  EvidencePhotoStrip(
                    label: TaskPhotoKind.before.label,
                    photos: live.beforePhotos,
                    busy: _uploadingKind == TaskPhotoKind.before,
                    onAdd: () => _addPhoto(TaskPhotoKind.before),
                  ),
                  const SizedBox(height: 12),
                  EvidencePhotoStrip(
                    label: TaskPhotoKind.after.label,
                    photos: live.afterPhotos,
                    busy: _uploadingKind == TaskPhotoKind.after,
                    onAdd: () => _addPhoto(TaskPhotoKind.after),
                  ),

                  if (_photoError != null) ...<Widget>[
                    const SizedBox(height: 12),
                    NoticeBanner(
                      margin: EdgeInsets.zero,
                      tone: EmployeeTokens.red,
                      icon: Icons.image_not_supported_outlined,
                      text: _photoError!,
                    ),
                  ],

                  if (live.missingEvidence.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 14),
                    NoticeBanner(
                      margin: EdgeInsets.zero,
                      tone: EmployeeTokens.yellow,
                      icon: Icons.checklist_rtl_outlined,
                      title: 'Дуусгахад дутуу байгаа',
                      text: live.missingEvidence.join(' · '),
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
              saveLabel: 'Гүйцэтгэл хадгалах',
              onCancel: _busy ? null : () => Navigator.of(context).pop(),
              onSave: _submit,
            ),
          ],
        ),
      ),
    );
  }
}

/// The equipment this entry will be written onto, named before anything is typed.
///
/// The empty case is drawn as loudly as the populated one. A sub-task covering no
/// equipment still accepts a score, but that score reaches no equipment record and the
/// entry never appears in Үзлэг ба дүгнэлт — a technician who is not told that is
/// scoring into nothing, which is precisely what this readout exists to prevent.
class _CoveredEquipment extends StatelessWidget {
  const _CoveredEquipment({required this.objects});

  final List<NamedRefModel> objects;

  @override
  Widget build(BuildContext context) {
    if (objects.isEmpty) {
      return const NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.yellow,
        icon: Icons.link_off_outlined,
        title: 'Тоноглол холбоогүй',
        text: 'Энэ дэд ажилд тоноглол холбоогүй тул оруулсан үнэлгээ ямар ч '
            'тоноглолын түүхэнд бичигдэхгүй.',
      );
    }

    return Container(
      width: double.infinity,
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
          Text(
            'ҮНЭЛГЭЭ БИЧИГДЭХ ТОНОГЛОЛ (${objects.length})',
            style: EmployeeTokens.microLabel,
          ),
          const SizedBox(height: 4),
          // Plain wrapping text rather than the status pill, which upper-cases its
          // label and clips it to a single line.
          for (final NamedRefModel object in objects)
            Text(
              '· ${object.name}',
              style: EmployeeTokens.rowSub.copyWith(
                color: EmployeeTokens.ink2,
                height: 1.6,
              ),
            ),
        ],
      ),
    );
  }
}

/// The 44px −/+ stepper with the value between it.
class _Stepper extends StatelessWidget {
  const _Stepper({
    required this.value,
    required this.total,
    required this.unit,
    required this.onStep,
  });

  final double value;
  final double total;
  final MaterialUnit unit;
  final ValueChanged<double>? onStep;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        _StepButton(
          icon: Icons.remove,
          onTap: onStep == null ? null : () => onStep!(-1),
        ),
        Expanded(
          child: Column(
            children: <Widget>[
              Text(
                formatQuantity(value),
                style: const TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w900,
                  color: EmployeeTokens.ink,
                  height: 1.1,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'нийт ${formatQuantity(total)} ${unit.label}-с',
                style: const TextStyle(
                  fontSize: 10.5,
                  color: EmployeeTokens.muted,
                ),
              ),
            ],
          ),
        ),
        _StepButton(
          icon: Icons.add,
          onTap: onStep == null ? null : () => onStep!(1),
        ),
      ],
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onTap != null;

    return Material(
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
              color: enabled ? EmployeeTokens.line : EmployeeTokens.faint,
              width: EmployeeTokens.hairline,
            ),
          ),
          child: Icon(
            icon,
            size: 19,
            color: enabled ? EmployeeTokens.ink : EmployeeTokens.muted,
          ),
        ),
      ),
    );
  }
}

/// The live "before / after" line, spelling out the cumulative figure that is about
/// to be sent so the increment is never mistaken for the total.
class _PreviewBox extends StatelessWidget {
  const _PreviewBox({
    required this.done,
    required this.today,
    required this.total,
    required this.projected,
    required this.projectedPercent,
    required this.unit,
  });

  final double done;
  final double today;
  final double total;
  final double projected;
  final double projectedPercent;
  final MaterialUnit unit;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: EmployeeTokens.soft2,
        border: Border.all(color: EmployeeTokens.faint),
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      ),
      child: Text.rich(
        TextSpan(
          style: const TextStyle(
            fontSize: 11.5,
            color: EmployeeTokens.ink2,
            height: 1.6,
          ),
          children: <InlineSpan>[
            const TextSpan(text: 'Өмнө нь '),
            TextSpan(
              text: formatQuantity(done),
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            const TextSpan(text: ' хийсэн. Өнөөдөр '),
            TextSpan(
              text: formatQuantity(today),
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            const TextSpan(text: ' нэмбэл нийт гүйцэтгэл '),
            TextSpan(
              text: '${formatQuantity(projected)}/${formatQuantity(total)} '
                  '${unit.label} · ${formatPercent(projectedPercent)}',
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: EmployeeTokens.ink,
              ),
            ),
            const TextSpan(text: ' болно.'),
          ],
        ),
      ),
    );
  }
}
