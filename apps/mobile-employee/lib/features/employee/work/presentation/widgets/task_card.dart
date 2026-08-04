import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/planned_work_model.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../format.dart';
import 'evidence_photo_strip.dart';
import 'work_ui.dart';

/// One sub-task: the three-up quantity readout, the rail, the evidence state and the
/// button that opens the progress sheet.
///
/// The status pill shows the server's derived status verbatim. In particular a task
/// whose quantity is complete but whose evidence gate still holds is drawn as
/// "Хийгдэж байна" with an explicit list of what is missing, never rounded up to
/// "Дууссан": the technician's next action is to close that gap, and a card that
/// claimed the task was finished would hide the only thing left to do.
class TaskCard extends StatelessWidget {
  const TaskCard({
    super.key,
    required this.task,
    required this.progressBlockedReason,
    required this.onRecordProgress,
  });

  final PlannedWorkTaskModel task;

  /// Why progress cannot be recorded on this task, or null when it can.
  ///
  /// A sentence rather than a boolean, because there is more than one reason and they
  /// are remedied by different people: a missing `planned_work.record_progress` grant
  /// is an administrator's to fix, while a job assigned to somebody else is a
  /// dispatcher's. The caller decides which applies; this widget only prints it.
  final String? progressBlockedReason;

  final VoidCallback onRecordProgress;

  @override
  Widget build(BuildContext context) {
    final Color tone = task.status.tone;

    return WorkCard(
      margin: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        8,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      task.title,
                      style: EmployeeTokens.rowTitle.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (_subtitle.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 3),
                      Text(
                        _subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: EmployeeTokens.microNote,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 9),
              EmployeePill.status(label: _pillLabel, color: tone),
            ],
          ),
          const SizedBox(height: 12),

          Row(
            children: <Widget>[
              Expanded(
                child: _QuantityCell(
                  value: formatQuantity(task.totalQuantity),
                  label: 'Нийт ${task.unit.label}',
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: _QuantityCell(
                  value: formatQuantity(task.completedQuantity),
                  label: 'Хийсэн',
                  tone: EmployeeTokens.green,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: _QuantityCell(
                  value: formatQuantity(task.remainingQuantity),
                  label: 'Үлдсэн',
                ),
              ),
            ],
          ),
          const SizedBox(height: 11),

          Row(
            children: <Widget>[
              Expanded(
                child: ProgressRail(
                  percent: task.progressPercent,
                  color: tone == EmployeeTokens.muted ? EmployeeTokens.line : tone,
                ),
              ),
              const SizedBox(width: 9),
              Text(
                formatPercent(task.progressPercent),
                style: EmployeeTokens.rowSub.copyWith(
                  fontWeight: FontWeight.w800,
                  color: EmployeeTokens.ink,
                ),
              ),
            ],
          ),

          // How long the work itself took: first reported start to the instant the quantity
          // was finished, measured and formatted by nobody but the server. Absent while the
          // sub-task is unfinished and on a skipped one, because there is no honest figure
          // to print — a zero here would read as "done instantly".
          if (task.durationMinutes != null) ...<Widget>[
            const SizedBox(height: 9),
            Row(
              children: <Widget>[
                const Icon(
                  Icons.schedule_outlined,
                  size: 13,
                  color: EmployeeTokens.muted,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Гүйцэтгэсэн хугацаа · ${formatMinutes(task.durationMinutes!)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: EmployeeTokens.microNote,
                  ),
                ),
              ],
            ),
          ],

          if (task.score != null) ...<Widget>[
            const SizedBox(height: 11),
            Row(
              children: <Widget>[
                EmployeePill(
                  label: 'Оноо ${task.score}',
                  tone: riskTone(task.riskLevel),
                  showGlyph: true,
                  glyphLevel: task.riskLevel,
                  semanticLabel:
                      'Оноо ${task.score}, ${riskSemanticLabel(task.riskLevel)}',
                ),
                if (task.riskLevel != null) ...<Widget>[
                  const SizedBox(width: 6),
                  Flexible(
                    // Ink, not the band colour: ATTENTION and SCHEDULE_REPAIR do not
                    // reach 4.5:1 on white, and the band is already carried by the
                    // glyph and the tint on the chip to the left.
                    child: Text(
                      task.riskLevel!.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: EmployeeTokens.rowSub.copyWith(
                        fontWeight: FontWeight.w600,
                        color: EmployeeTokens.ink,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],

          const SizedBox(height: 11),
          _RelatedEquipment(objects: task.relatedObjects),

          if (task.note != null) ...<Widget>[
            const SizedBox(height: 11),
            _RecordedText(label: 'Тэмдэглэл', text: task.note!),
          ],
          if (task.conclusion != null) ...<Widget>[
            const SizedBox(height: 8),
            _RecordedText(
              label: 'Дүгнэлт',
              text: task.conclusion!,
              // Attribution belongs inside the block, not beside it: anyone on the job can
              // overwrite this field, so the sentence on its own does not say whose verdict
              // it is — including to the technician deciding whether to change it.
              footnote: _conclusionAuthor,
            ),
          ],
          if (task.recommendation != null) ...<Widget>[
            const SizedBox(height: 8),
            _RecordedText(label: 'Зөвлөмж', text: task.recommendation!),
          ],

          if (task.beforePhotos.isNotEmpty) ...<Widget>[
            const SizedBox(height: 11),
            EvidencePhotoStrip(
              label: 'Ажлын өмнөх зураг',
              photos: task.beforePhotos,
            ),
          ],
          if (task.afterPhotos.isNotEmpty) ...<Widget>[
            const SizedBox(height: 11),
            EvidencePhotoStrip(
              label: 'Ажлын дараах зураг',
              photos: task.afterPhotos,
            ),
          ],

          if (task.missingEvidence.isNotEmpty && !task.isSkipped) ...<Widget>[
            const SizedBox(height: 11),
            NoticeBanner(
              margin: EdgeInsets.zero,
              tone: task.quantityCompleteButBlocked
                  ? EmployeeTokens.yellow
                  : EmployeeTokens.muted,
              icon: Icons.checklist_rtl_outlined,
              title: task.quantityCompleteButBlocked
                  ? 'Тоо хэмжээ бүтэн — нотолгоо дутуу'
                  : 'Дуусгахад дутуу байгаа',
              text: task.missingEvidence.join(' · '),
            ),
          ],

          const SizedBox(height: 12),
          _TaskAction(
            task: task,
            blockedReason: progressBlockedReason,
            onRecordProgress: onRecordProgress,
          ),
        ],
      ),
    );
  }

  String get _subtitle => <String?>[task.floorName, task.description]
      .whereType<String>()
      .join(' · ');

  /// `Батаа Энхтөр · 07.29 14:30`, or just the name when the server sent no stamp.
  /// Null when nobody is on record, so the footnote is omitted rather than printing a dash
  /// under a conclusion carried over from before this was tracked.
  String? get _conclusionAuthor {
    final String? name = task.conclusionByName;
    final DateTime? at = task.conclusionAt;
    if (name == null && at == null) return null;
    if (at == null) return name;
    if (name == null) return formatShortStamp(at);
    return '$name · ${formatShortStamp(at)}';
  }

  String get _pillLabel {
    if (task.isDone) return 'Дууссан';
    if (task.isSkipped) return 'Хийгдээгүй';
    if (task.progressPercent > 0) return formatPercent(task.progressPercent);
    return 'Шинэ';
  }
}

class _TaskAction extends StatelessWidget {
  const _TaskAction({
    required this.task,
    required this.blockedReason,
    required this.onRecordProgress,
  });

  final PlannedWorkTaskModel task;
  final String? blockedReason;
  final VoidCallback onRecordProgress;

  @override
  Widget build(BuildContext context) {
    final String? blocked = blockedReason;

    if (task.isDone) {
      // The done bar stays — it is the status readout — but it used to be the whole of a
      // finished card, which permanently sealed the Тэмдэглэл, Үнэлгээ and Зөвлөмж a
      // technician had typed. `recordTaskProgressSchema` still accepts all three on a
      // completed task, and the consolidated report is assembled from exactly those
      // fields, so a typo in them was otherwise unfixable from the handset.
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const _DoneBar(),
          if (blocked == null) ...<Widget>[
            const SizedBox(height: 8),
            WorkButton.secondary(
              label: 'Тэмдэглэл, үнэлгээ засах',
              icon: Icons.edit_outlined,
              onPressed: onRecordProgress,
            ),
          ],
        ],
      );
    }

    if (blocked != null) {
      // Stating why the control is absent beats an inert button: the technician can
      // act on "ask an administrator for the grant" or "ask to be assigned the job",
      // but not on a tap that 403s.
      return Text(
        blocked,
        style: EmployeeTokens.microNote.copyWith(height: 1.5),
      );
    }

    return WorkButton(
      label: task.progressPercent > 0
          ? 'Гүйцэтгэл шинэчлэх'
          : 'Өнөөдрийн гүйцэтгэл оруулах',
      icon: Icons.add,
      onPressed: onRecordProgress,
    );
  }
}

/// The green outline bar a finished task carries instead of a button.
class _DoneBar extends StatelessWidget {
  const _DoneBar();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: EmployeeTokens.greenBg,
        border: Border.all(color: EmployeeTokens.greenBorder),
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          const Icon(Icons.check, size: 15, color: EmployeeTokens.green),
          const SizedBox(width: 7),
          Text(
            'Дууссан',
            style: EmployeeTokens.detailValue.copyWith(
              fontWeight: FontWeight.w800,
              color: EmployeeTokens.green,
            ),
          ),
        ],
      ),
    );
  }
}

class _QuantityCell extends StatelessWidget {
  const _QuantityCell({
    required this.value,
    required this.label,
    this.tone = EmployeeTokens.ink,
  });

  final String value;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: EmployeeTokens.soft2,
        border: Border.all(color: EmployeeTokens.faint),
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            value,
            style: EmployeeTokens.cardTitle.copyWith(
              fontWeight: FontWeight.w900,
              color: tone,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: EmployeeTokens.microLabel.copyWith(fontWeight: FontWeight.w400),
          ),
        ],
      ),
    );
  }
}

/// The equipment this sub-task's score will be written onto.
///
/// Present on every card, including when the list is empty, because both answers matter
/// and neither is guessable from the rest of the card. The one Үнэлгээ a technician types
/// is copied to each of these objects and becomes its risk band, so working the list out
/// afterwards from the job title is not a reasonable thing to ask. An empty list is the
/// louder case: the entry is still recorded against the job, but it reaches no equipment
/// record and never appears in Үзлэг ба дүгнэлт.
class _RelatedEquipment extends StatelessWidget {
  const _RelatedEquipment({required this.objects});

  final List<NamedRefModel> objects;

  @override
  Widget build(BuildContext context) {
    if (objects.isEmpty) {
      return const NoticeBanner(
        margin: EdgeInsets.zero,
        tone: EmployeeTokens.muted,
        icon: Icons.link_off_outlined,
        title: 'Тоноглол холбоогүй',
        text: 'Энэ дэд ажлын үнэлгээ ямар ч тоноглолын түүхэнд бичигдэхгүй. '
            'Тоноглол холбохыг төлөвлөгчөөс хүснэ үү.',
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
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
            'ХАМРАХ ТОНОГЛОЛ (${objects.length})',
            style: EmployeeTokens.microLabel,
          ),
          const SizedBox(height: 4),
          // Plain wrapping text, not the status pill: a pill upper-cases its label and
          // clips it to one line, which would shout an equipment code and then truncate
          // the name that identifies it.
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

/// A previously recorded free-text field, shown so the next entry builds on it
/// rather than overwriting something the technician cannot see.
class _RecordedText extends StatelessWidget {
  const _RecordedText({required this.label, required this.text, this.footnote});

  final String label;
  final String text;

  /// An attribution line under the text. Omitted entirely when null, so a field with
  /// nothing on record is not padded with an empty row.
  final String? footnote;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
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
            label.toUpperCase(),
            style: EmployeeTokens.microLabel,
          ),
          const SizedBox(height: 4),
          Text(
            text,
            style: EmployeeTokens.rowSub.copyWith(color: EmployeeTokens.ink2, height: 1.6),
          ),
          if (footnote != null) ...<Widget>[
            const SizedBox(height: 4),
            Text(footnote!, style: EmployeeTokens.microNote),
          ],
        ],
      ),
    );
  }
}
