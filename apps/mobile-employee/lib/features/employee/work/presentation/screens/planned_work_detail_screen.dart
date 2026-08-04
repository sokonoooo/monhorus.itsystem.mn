import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/inspection_report_model.dart';
import '../../data/models/planned_work_model.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../format.dart';
import '../providers/work_providers.dart';
import '../widgets/inspection_report_sheet.dart';
import '../widgets/report_preview_sheet.dart';
import '../widgets/task_card.dart';
import '../widgets/task_progress_sheet.dart';
import '../widgets/work_async_view.dart';
import '../widgets/work_ui.dart';

/// "Төлөвлөгөөт ажлын дэлгэрэнгүй" — the screen a technician actually works from.
///
/// One `GET /planned-work/:id` supplies everything on it: the roll-up, the schedule,
/// the sub-tasks, the floor breakdown, the materials, the report state, the legal
/// lifecycle actions and the reasons completion is blocked. There is no second fetch
/// and nothing is derived locally.
///
/// Three rules govern every control below:
///
///   * A lifecycle button is drawn only when the record's own `availableActions`
///     lists it AND the caller's effective permission set allows it. The record says
///     the move is legal now; the permission set says it is legal for this person.
///   * A write control is offered only when the backend's assignment scope would
///     admit this caller on THIS record — see [resolvePlannedWorkAssignment]. A
///     technician may open any planned work (`planned_work.view` is unscoped) but may
///     only act on the ones assigned to them or to their team, so an unassigned
///     record is shown in full and carries one banner saying why it is read-only.
///     Hiding the buttons is a courtesy, not the boundary: the server refuses
///     regardless, and every refusal below is rendered as its Mongolian message.
///   * A blocker is printed verbatim. `completionBlockers` and `submissionBlockers`
///     name the specific task and the specific thing it is short of, which is
///     precisely what the technician needs in order to go and fix it.
class PlannedWorkDetailScreen extends ConsumerWidget {
  const PlannedWorkDetailScreen({
    super.key,
    required this.plannedWorkId,
    this.workNumber,
  });

  final String plannedWorkId;

  /// Carried from the list so the header reads correctly during the first load.
  final String? workNumber;

  static Route<void> route({
    required String plannedWorkId,
    String? workNumber,
  }) {
    return MaterialPageRoute<void>(
      builder: (BuildContext _) => PlannedWorkDetailScreen(
        plannedWorkId: plannedWorkId,
        workNumber: workNumber,
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PlannedWorkModel> work =
        ref.watch(plannedWorkDetailProvider(plannedWorkId));

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            _DetailHeader(
              title: work.valueOrNull?.title ?? 'Төлөвлөгөөт ажил',
              subtitle: work.valueOrNull?.workNumber ?? workNumber ?? '',
            ),
            Expanded(
              child: RefreshIndicator(
                color: EmployeeTokens.ink,
                onRefresh: () => ref
                    .read(plannedWorkDetailProvider(plannedWorkId).notifier)
                    .reload(),
                child: WorkAsyncView<PlannedWorkModel>(
                  value: work,
                  onRetry: () =>
                      ref.invalidate(plannedWorkDetailProvider(plannedWorkId)),
                  builder: (BuildContext context, PlannedWorkModel data) =>
                      _DetailBody(work: data),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The `.tnav`: a 34px outlined back square, the title block, no right action.
class _DetailHeader extends StatelessWidget {
  const _DetailHeader({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        12,
        EmployeeTokens.gutter,
        12,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Material(
            color: EmployeeTokens.white,
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
            child: InkWell(
              onTap: () => Navigator.of(context).maybePop(),
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              child: Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
                  border: Border.all(
                    color: EmployeeTokens.line,
                    width: EmployeeTokens.hairline,
                  ),
                ),
                child: const Icon(
                  Icons.chevron_left,
                  size: 21,
                  color: EmployeeTokens.ink,
                ),
              ),
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.headerTitle,
                ),
                if (subtitle.isNotEmpty)
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: EmployeeTokens.rowSub,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailBody extends ConsumerWidget {
  const _DetailBody({required this.work});

  final PlannedWorkModel work;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final WorkGrants grants = ref.watch(workGrantsProvider);

    // Watched, not awaited: the identity is already cached for the session by the
    // time a detail screen opens, and a null here (still resolving) resolves to
    // `unrestricted`, so nothing is ever hidden while the answer is unknown.
    final PlannedWorkAssignment assignment = resolvePlannedWorkAssignment(
      work: work,
      identity: ref.watch(workIdentityProvider).valueOrNull,
      grants: grants,
    );

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: EmployeeTokens.scrollBottomSpacer),
      children: <Widget>[
        _OverallCard(work: work),
        if (assignment.blocksWrites)
          const NoticeBanner(
            tone: EmployeeTokens.yellow,
            icon: Icons.lock_outline,
            title: 'Танд хуваарилагдаагүй ажил',
            text: 'Энэ ажил танд ч, таны багт ч хуваарилагдаагүй байна. Иймд '
                'төлөв өөрчлөх, гүйцэтгэл бүртгэх, зураг хавсаргах, тайлан '
                'илгээх боломжгүй. Ажлыг хүлээж авахын тулд диспетчер эсвэл '
                'ахлахдаа хандана уу.',
          ),
        _LifecycleActions(work: work, grants: grants, assignment: assignment),
        if (work.completionBlockers.isNotEmpty)
          NoticeBanner(
            tone: EmployeeTokens.yellow,
            icon: Icons.report_problem_outlined,
            title: 'Дуусгахад дараах зүйл дутуу',
            text: work.completionBlockers.join('\n'),
          ),
        if (work.currentPauseStartedAt != null)
          NoticeBanner(
            tone: EmployeeTokens.yellow,
            icon: Icons.pause_circle_outline,
            title: 'Ажил түр зогссон',
            text: _pauseReason(work),
          ),
        if (work.cancelReason != null)
          NoticeBanner(
            tone: EmployeeTokens.red,
            icon: Icons.cancel_outlined,
            title: 'Цуцлагдсан',
            text: work.cancelReason!,
          ),

        const SectionHeading('Ажлын мэдээлэл'),
        _InfoCard(work: work),

        if (work.floorProgress.isNotEmpty) ...<Widget>[
          const SectionHeading('Давхарын гүйцэтгэл'),
          _FloorProgressCard(work: work),
        ],

        const SectionHeading('Дүгнэлт тайлан'),
        _ReportCard(work: work, grants: grants, assignment: assignment),

        const SectionHeading('Үзлэгийн нэгдсэн тайлан'),
        _InspectionReportCard(work: work, grants: grants, assignment: assignment),

        SectionHeading(
          'Хийгдэх ажлууд (${work.doneTaskCount}/${work.tasks.length})',
        ),
        if (work.tasks.isEmpty)
          const WorkEmptyState(
            icon: Icons.checklist_outlined,
            message: 'Энэ ажилд дэд ажил бүртгэгдээгүй байна. Дэд ажил нэмэх нь '
                'төлөвлөгчийн эрх тул администратортоо хандана уу.',
          )
        else
          for (final PlannedWorkTaskModel task in work.tasks)
            TaskCard(
              task: task,
              // Two different reasons a card cannot be written to, kept apart: one is
              // fixed by an administrator granting a permission, the other by a
              // dispatcher assigning the job. Sending a technician to the wrong
              // person is worse than saying nothing.
              progressBlockedReason: _progressBlockedReason(grants, assignment),
              onRecordProgress: () => showTaskProgressSheet(
                context,
                plannedWorkId: work.id,
                task: task,
              ),
            ),

        if (work.materials.isNotEmpty) ...<Widget>[
          const SectionHeading('Материал'),
          _MaterialsCard(work: work),
        ],
      ],
    );
  }

  /// Why the progress button is absent, or null when it is not.
  ///
  /// The permission is checked first because it is the broader fact: an account
  /// without `planned_work.record_progress` cannot record progress on any job, and
  /// telling it about this particular assignment would be beside the point.
  static String? _progressBlockedReason(
    WorkGrants grants,
    PlannedWorkAssignment assignment,
  ) {
    if (!grants.canRecordProgress) {
      return 'Гүйцэтгэл бүртгэх эрх (planned_work.record_progress) танд алга байна.';
    }
    if (assignment.blocksWrites) {
      return 'Энэ ажил танд хуваарилагдаагүй тул гүйцэтгэл бүртгэх, зураг '
          'хавсаргах боломжгүй.';
    }
    return null;
  }

  static String _pauseReason(PlannedWorkModel work) {
    final PlannedWorkPauseModel? open = work.pauseHistory
        .where((PlannedWorkPauseModel pause) => pause.isOpen)
        .lastOrNull;

    final String since = formatDateTime(work.currentPauseStartedAt);
    if (open == null) return '$since-с хойш зогссон.';
    return '$since-с хойш зогссон. Шалтгаан: ${open.reason}';
  }
}

/// "Нийт гүйцэтгэл" — the roll-up card.
class _OverallCard extends StatelessWidget {
  const _OverallCard({required this.work});

  final PlannedWorkModel work;

  @override
  Widget build(BuildContext context) {
    final Color tone = work.effectiveStatus.tone;
    final Color railTone =
        tone == EmployeeTokens.muted ? EmployeeTokens.line : tone;

    return WorkCard(
      margin: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        4,
        EmployeeTokens.gutter,
        10,
      ),
      accent: work.effectiveStatus == PlannedWorkEffectiveStatus.overdue
          ? EmployeeTokens.red
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  'Нийт гүйцэтгэл',
                  style: EmployeeTokens.sectionLabel.copyWith(
                    letterSpacing: 0.6,
                  ),
                ),
              ),
              EmployeePill.status(label: work.effectiveStatus.label, color: tone),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            formatPercent(work.progressPercent),
            style: EmployeeTokens.display.copyWith(
              height: 1.15,
            ),
          ),
          // No rail when the answer carried no percentage: an empty rail beside a
          // dash would read as nought per cent, which is the figure the backend
          // declined to state. The quantity line below still says what is known.
          if (work.progressPercent case final double percent) ...<Widget>[
            const SizedBox(height: 8),
            ProgressRail(percent: percent, color: railTone),
          ],
          const SizedBox(height: 9),
          Text(
            '${formatQuantity(work.completedQuantity)}/'
            '${formatQuantity(work.totalQuantity)} нэгж · '
            '${work.doneTaskCount}/${work.tasks.length} дэд ажил дууссан',
            style: EmployeeTokens.rowSub,
          ),
          if (work.completedLate) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              work.delayMinutes == null
                  ? 'Хугацаанаас хоцорч дууссан.'
                  : 'Хугацаанаас ${formatMinutes(work.delayMinutes!)} хоцорсон.',
              style: EmployeeTokens.rowSub.copyWith(
                fontWeight: FontWeight.w600,
                color: EmployeeTokens.red,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The lifecycle buttons.
///
/// Rendered from the intersection of three things: what the record allows, what the
/// caller may do, and whether the record is one the caller may act on at all. An
/// action any of them refuses is dropped silently — showing it would be promising a
/// 403.
///
/// The backend already empties `availableActions` for a scoped caller on a job that
/// is not theirs, so the assignment filter here is usually redundant. It is kept
/// because the list is also published by every write's response, and a screen that
/// depended on the server remembering to blank it would be one deploy away from
/// offering a button that cannot work.
class _LifecycleActions extends ConsumerStatefulWidget {
  const _LifecycleActions({
    required this.work,
    required this.grants,
    required this.assignment,
  });

  final PlannedWorkModel work;
  final WorkGrants grants;
  final PlannedWorkAssignment assignment;

  @override
  ConsumerState<_LifecycleActions> createState() => _LifecycleActionsState();
}

class _LifecycleActionsState extends ConsumerState<_LifecycleActions> {
  PlannedWorkAction? _busyAction;

  Future<void> _run(PlannedWorkAvailableActionModel entry) async {
    final PlannedWorkAction action = entry.action!;

    String? reason;
    if (entry.requiresReason) {
      reason = await _askReason(entry.label);
      // A cancelled prompt is not a reason to fire the transition anyway.
      if (reason == null || !mounted) return;
    }

    setState(() => _busyAction = action);

    final ApiResult<PlannedWorkModel> result = await ref
        .read(plannedWorkDetailProvider(widget.work.id).notifier)
        .transition(action: action, reason: reason);

    if (!mounted) return;
    setState(() => _busyAction = null);

    result.when(
      success: (PlannedWorkModel work) => showWorkToast(
        context,
        message: '${entry.label} — ${work.effectiveStatus.label}',
        tone: EmployeeTokens.green,
      ),
      failure: (Failure failure) => showWorkToast(
        context,
        message: failure.message,
        tone: EmployeeTokens.red,
        icon: Icons.error_outline,
      ),
    );
  }

  Future<String?> _askReason(String actionLabel) {
    return showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => _ReasonDialog(label: actionLabel),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.assignment.blocksWrites) return const SizedBox.shrink();

    final List<PlannedWorkAvailableActionModel> offered = widget
        .work.availableActions
        .where((PlannedWorkAvailableActionModel entry) =>
            entry.action != null && widget.grants.allows(entry.action!))
        .toList(growable: false);

    if (offered.isEmpty) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        10,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final PlannedWorkAvailableActionModel entry in offered)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: entry.action!.isDestructive
                  ? WorkButton.secondary(
                      label: entry.label,
                      icon: Icons.close,
                      tone: EmployeeTokens.red,
                      busy: _busyAction == entry.action,
                      onPressed: _busyAction == null ? () => _run(entry) : null,
                    )
                  : WorkButton(
                      label: entry.label,
                      icon: _iconFor(entry.action!),
                      busy: _busyAction == entry.action,
                      onPressed: _busyAction == null ? () => _run(entry) : null,
                    ),
            ),
        ],
      ),
    );
  }

  static IconData _iconFor(PlannedWorkAction action) {
    switch (action) {
      case PlannedWorkAction.plan:
        return Icons.event_outlined;
      case PlannedWorkAction.start:
        return Icons.play_arrow_outlined;
      case PlannedWorkAction.pause:
        return Icons.pause_outlined;
      case PlannedWorkAction.resume:
        return Icons.play_arrow_outlined;
      case PlannedWorkAction.complete:
        return Icons.check;
      case PlannedWorkAction.cancel:
        return Icons.close;
    }
  }
}

/// The reason prompt for a transition that demands one.
///
/// A widget rather than a bare `builder:` closure over a controller held by
/// [_LifecycleActionsState], because the controller's life has to end when the DIALOG
/// does and nothing else marks that moment. `showDialog`'s future completes the instant
/// `Navigator.pop` is called — the route is still on screen, still animating out and
/// still rebuilding — so disposing from `.whenComplete` killed a controller two live
/// [TextField]s were using. See the note on [_ReportEditorSheet]; this dialog autofocuses
/// its field, which is exactly the condition that guarantees a rebuild after the pop.
class _ReasonDialog extends StatefulWidget {
  const _ReasonDialog({required this.label});

  final String label;

  @override
  State<_ReasonDialog> createState() => _ReasonDialogState();
}

class _ReasonDialogState extends State<_ReasonDialog> {
  final TextEditingController _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: EmployeeTokens.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
      ),
      title: Text(
        widget.label,
        style: EmployeeTokens.cardTitle,
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Шалтгаанаа бичнэ үү. Энэ тэмдэглэл ажлын түүхэд үлдэнэ.',
            style: EmployeeTokens.noticeBody.copyWith(fontWeight: FontWeight.w400),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            autofocus: true,
            maxLines: 3,
            style: EmployeeTokens.body.copyWith(color: EmployeeTokens.ink),
            decoration: InputDecoration(
              hintText: 'Шалтгаан...',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              ),
            ),
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text(
            'Болих',
            style: TextStyle(color: EmployeeTokens.muted),
          ),
        ),
        TextButton(
          onPressed: () {
            final String value = _reason.text.trim();
            // The backend rejects a short reason on CANCEL with a 400; refusing
            // here keeps that round trip out of a field connection.
            if (value.length < 5) return;
            Navigator.of(context).pop(value);
          },
          child: const Text(
            'Үргэлжлүүлэх',
            style: TextStyle(
              color: EmployeeTokens.ink,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ],
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.work});

  final PlannedWorkModel work;

  @override
  Widget build(BuildContext context) {
    final String assignees = work.assignedEmployees.isEmpty
        ? '-'
        : work.assignedEmployees
            .map((NamedRefModel ref) => ref.name)
            .join(', ');

    return WorkCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          InfoRow(label: 'Дугаар', value: work.workNumber),
          InfoRow(label: 'Захиалагч', value: work.customer?.name ?? '-'),
          InfoRow(label: 'Төсөл', value: work.project?.name ?? '-'),
          InfoRow(label: 'Объект', value: work.building?.name ?? '-'),
          InfoRow(
            label: 'Хугацаа',
            value: formatWindow(work.plannedStartDate, work.plannedEndDate),
            tone: work.effectiveStatus == PlannedWorkEffectiveStatus.overdue
                ? EmployeeTokens.red
                : EmployeeTokens.ink,
          ),
          if (work.wasRescheduled)
            InfoRow(
              label: 'Анхны дуусах',
              value: formatDateTime(work.originalPlannedEndDate),
            ),
          if (work.actualStartDate != null)
            InfoRow(
              label: 'Эхэлсэн',
              value: formatDateTime(work.actualStartDate),
            ),
          if (work.actualEndDate != null)
            InfoRow(
              label: 'Дууссан',
              value: formatDateTime(work.actualEndDate),
            ),
          if (work.totalPausedMinutes > 0)
            InfoRow(
              label: 'Түр зогссон',
              value: formatMinutes(work.totalPausedMinutes),
            ),
          InfoRow(label: 'Хариуцагч', value: assignees),
          if (work.assignedTeam != null)
            InfoRow(label: 'Баг', value: work.assignedTeam!.name),
          InfoRow(
            label: 'Даалгавар',
            value: work.description ?? '-',
            divider: false,
          ),
        ],
      ),
    );
  }
}

class _FloorProgressCard extends StatelessWidget {
  const _FloorProgressCard({required this.work});

  final PlannedWorkModel work;

  @override
  Widget build(BuildContext context) {
    return WorkCard(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (int i = 0; i < work.floorProgress.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(height: 12),
            _FloorRow(floor: work.floorProgress[i]),
          ],
        ],
      ),
    );
  }
}

class _FloorRow extends StatelessWidget {
  const _FloorRow({required this.floor});

  final PlannedWorkFloorProgressModel floor;

  @override
  Widget build(BuildContext context) {
    // A floor the answer gave no percentage for takes the neutral hairline: there is
    // no reading to colour, and green or yellow would each be a claim of its own.
    final double? percent = floor.progressPercent;
    final Color tone = percent == null
        ? EmployeeTokens.line
        : (percent >= 100
            ? EmployeeTokens.green
            : (percent > 0 ? EmployeeTokens.yellow : EmployeeTokens.line));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                floor.floorName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EmployeeTokens.rowTitle,
              ),
            ),
            Text(
              formatPercent(floor.progressPercent),
              style: EmployeeTokens.rowSub.copyWith(
                fontWeight: FontWeight.w800,
                color: EmployeeTokens.ink,
              ),
            ),
          ],
        ),
        if (percent != null) ...<Widget>[
          const SizedBox(height: 5),
          ProgressRail(percent: percent, color: tone),
        ],
        const SizedBox(height: 5),
        Text(
          '${floor.taskCount} дэд ажил · '
          '${formatQuantity(floor.completedQuantity)}/'
          '${formatQuantity(floor.totalQuantity)}',
          style: EmployeeTokens.rowSub,
        ),
      ],
    );
  }
}

/// The consolidated report: its state, its narrative, and the two writes a performer
/// may make on it.
///
/// The prototype's "Өмнөх гүйцэтгэгчийн тайлан" block has no counterpart in this API
/// — there is one report per planned work, not a chain of past performers' reports —
/// so this shows the real thing instead: the record's own report, who wrote it, why
/// it was returned when it was, and what still blocks submission. The previous
/// performer's own words on each sub-task appear on the task card, which is where
/// the backend actually stores them.
class _ReportCard extends ConsumerStatefulWidget {
  const _ReportCard({
    required this.work,
    required this.grants,
    required this.assignment,
  });

  final PlannedWorkModel work;
  final WorkGrants grants;
  final PlannedWorkAssignment assignment;

  @override
  ConsumerState<_ReportCard> createState() => _ReportCardState();
}

class _ReportCardState extends ConsumerState<_ReportCard> {
  bool _busy = false;

  String? get _blockedReason =>
      _reportWriteBlockedReason(widget.grants, widget.assignment);

  Future<void> _edit() async {
    // Nullable: the report row no longer has to exist before it can be written to. The
    // first PATCH opens it in DRAFT server-side, which is what makes this reachable for
    // a job that is merely PLANNED or STARTED.
    final PlannedWorkReportModel? report = widget.work.report;
    final _ReportDraft? draft = await _showReportEditor(
      context,
      conclusion: report?.conclusion ?? '',
      recommendation: report?.recommendation ?? '',
    );
    if (draft == null || !mounted) return;

    setState(() => _busy = true);
    final ApiResult<PlannedWorkModel> result = await ref
        .read(plannedWorkDetailProvider(widget.work.id).notifier)
        .saveReport(
          conclusion: draft.conclusion.isEmpty ? null : draft.conclusion,
          recommendation:
              draft.recommendation.isEmpty ? null : draft.recommendation,
        );

    if (!mounted) return;
    setState(() => _busy = false);
    _report(result, 'Тайлан хадгалагдлаа.');
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final ApiResult<PlannedWorkModel> result = await ref
        .read(plannedWorkDetailProvider(widget.work.id).notifier)
        .submitReport();

    if (!mounted) return;
    setState(() => _busy = false);
    _report(result, 'Тайлан хянуулахаар илгээгдлээ.');
  }

  void _report(ApiResult<PlannedWorkModel> result, String successMessage) {
    result.when(
      success: (_) => showWorkToast(
        context,
        message: successMessage,
        tone: EmployeeTokens.green,
      ),
      failure: (Failure failure) => showWorkToast(
        context,
        message: failure.message,
        tone: EmployeeTokens.red,
        icon: Icons.error_outline,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final PlannedWorkReportModel? report = widget.work.report;
    final String? blocked = _blockedReason;

    // Not yet written. Until the backend opened the report row on first PATCH this branch
    // was prose and nothing else, so the Дүгнэлт and Зөвлөмж had no input anywhere in the
    // app for the whole of DRAFT, PLANNED, STARTED, PAUSED and OVERDUE — that is, for the
    // entire time the technician is on site. The same button as the written state is
    // therefore offered here, on the same two conditions.
    if (report == null) {
      return WorkCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              'Тайлан хараахан бичигдээгүй',
              style: EmployeeTokens.rowTitle.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              'Дүгнэлт, зөвлөмжөө ажлын явцад бичиж болно — ноорог болж '
              'хадгалагдана. Хянуулахаар илгээхийн тулд дэд ажил бүрийн тэмдэглэл, '
              'үнэлгээ, зөвлөмж, нотлох зураг бүрэн байж, ажил дуусах шаардлагатай.',
              style: EmployeeTokens.rowSub.copyWith(color: EmployeeTokens.ink2, height: 1.6),
            ),
            if (blocked != null) ...<Widget>[
              const SizedBox(height: 12),
              Text(
                blocked,
                style: EmployeeTokens.microNote.copyWith(height: 1.5),
              ),
            ] else ...<Widget>[
              const SizedBox(height: 12),
              WorkButton.secondary(
                label: 'Дүгнэлт, зөвлөмж бичих',
                icon: Icons.edit_outlined,
                busy: _busy,
                onPressed: _busy ? null : _edit,
              ),
            ],
            const SizedBox(height: 8),
            _PreviewButton(plannedWorkId: widget.work.id),
          ],
        ),
      );
    }

    return WorkCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  'Нэгдсэн тайлан',
                  style: EmployeeTokens.rowTitle.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              EmployeePill.status(label: report.status.label, color: report.status.tone),
            ],
          ),

          if (report.returnReason != null) ...<Widget>[
            const SizedBox(height: 10),
            NoticeBanner(
              margin: EdgeInsets.zero,
              tone: EmployeeTokens.red,
              icon: Icons.undo_outlined,
              title: 'Засварлахаар буцаагдсан',
              text: report.returnReason!,
            ),
          ],

          const SizedBox(height: 12),
          _ReportText(label: 'Дүгнэлт', text: report.conclusion),
          const SizedBox(height: 8),
          _ReportText(label: 'Зөвлөмж', text: report.recommendation),

          if (!report.submittedBy.isEmpty) ...<Widget>[
            const SizedBox(height: 10),
            _ActorLine(label: 'Илгээсэн', stamp: report.submittedBy),
          ],
          if (!report.approvedBy.isEmpty) ...<Widget>[
            const SizedBox(height: 6),
            _ActorLine(label: 'Баталсан', stamp: report.approvedBy),
          ],

          if (report.submissionBlockers.isNotEmpty) ...<Widget>[
            const SizedBox(height: 12),
            NoticeBanner(
              margin: EdgeInsets.zero,
              tone: EmployeeTokens.yellow,
              icon: Icons.rule_outlined,
              title: 'Илгээхэд дутуу байгаа',
              text: report.submissionBlockers.join('\n'),
            ),
          ],

          if (blocked != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              blocked,
              style: EmployeeTokens.microNote.copyWith(height: 1.5),
            ),
          ] else ...<Widget>[
            const SizedBox(height: 12),
            WorkButton.secondary(
              label: 'Дүгнэлт, зөвлөмж бичих',
              icon: Icons.edit_outlined,
              onPressed: _busy ? null : _edit,
            ),
            if (report.canSubmit) ...<Widget>[
              const SizedBox(height: 8),
              WorkButton(
                label: 'Хянуулахаар илгээх',
                icon: Icons.send_outlined,
                busy: _busy,
                onPressed: _busy ? null : _submit,
              ),
            ],
          ],

          const SizedBox(height: 8),
          _PreviewButton(plannedWorkId: widget.work.id),
        ],
      ),
    );
  }
}

/// Why the report writes are not offered, or null when they are.
///
/// Both refusals are the server's, and both are 403; they are phrased apart because they
/// are fixed by different people — one by an administrator granting a permission, the
/// other by a dispatcher assigning the job. `updateReport`, `submitReport` and all three
/// inspection-report writes ride on `planned_work.submit_report` and pass through
/// `assertPlannedWorkAssignmentScope`, so one pair of sentences covers both report cards.
String? _reportWriteBlockedReason(
  WorkGrants grants,
  PlannedWorkAssignment assignment,
) {
  if (!grants.canSubmitReport) {
    return 'Тайлан бичих эрх (planned_work.submit_report) танд алга байна.';
  }
  if (assignment.blocksWrites) {
    return 'Энэ ажил танд хуваарилагдаагүй тул тайлан бичих, илгээх боломжгүй.';
  }
  return null;
}

/// Opens the server's assembled write-up.
///
/// Offered in both states of the card and without any permission of its own: the read is
/// on `planned_work.view`, which anyone looking at this screen already holds, and the
/// preview is exactly what a reviewer will see — which is most useful to a technician
/// BEFORE the work is finished, while there is still time to fix what it says.
class _PreviewButton extends StatelessWidget {
  const _PreviewButton({required this.plannedWorkId});

  final String plannedWorkId;

  @override
  Widget build(BuildContext context) {
    return WorkButton.secondary(
      label: 'Тайланг бүтнээр харах',
      icon: Icons.description_outlined,
      onPressed: () => showReportPreviewSheet(
        context,
        plannedWorkId: plannedWorkId,
      ),
    );
  }
}

/// The consolidated inspection report — the printed Ил ба далд ажлын акт.
///
/// A different workflow from the card above, not a second view of it. Its gate is
/// READINESS, not completion: the server composes it as soon as every non-skipped
/// sub-task is DONE, which is normally well before anyone presses "Дуусгах". Everything it
/// shows about the work — the зөрчил list, the ерөнхий түвшин, the floor sections — is
/// re-derived from the sub-tasks on every read, so only the narrative is editable here and
/// a wrong finding is corrected on the task card that produced it.
class _InspectionReportCard extends ConsumerStatefulWidget {
  const _InspectionReportCard({
    required this.work,
    required this.grants,
    required this.assignment,
  });

  final PlannedWorkModel work;
  final WorkGrants grants;
  final PlannedWorkAssignment assignment;

  @override
  ConsumerState<_InspectionReportCard> createState() =>
      _InspectionReportCardState();
}

class _InspectionReportCardState extends ConsumerState<_InspectionReportCard> {
  bool _busy = false;

  String? get _blockedReason =>
      _reportWriteBlockedReason(widget.grants, widget.assignment);

  Future<void> _generate() async {
    setState(() => _busy = true);
    final ApiResult<InspectionReportModel> result = await ref
        .read(inspectionReportProvider(widget.work.id).notifier)
        .generate();

    if (!mounted) return;
    setState(() => _busy = false);
    _announce(result, 'Үзлэгийн тайлан үүслээ.');
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final ApiResult<InspectionReportModel> result = await ref
        .read(inspectionReportProvider(widget.work.id).notifier)
        .submit();

    if (!mounted) return;
    setState(() => _busy = false);
    _announce(result, 'Үзлэгийн тайлан хянуулахаар илгээгдлээ.');
  }

  void _announce(ApiResult<InspectionReportModel> result, String success) {
    result.when(
      success: (_) => showWorkToast(
        context,
        message: success,
        tone: EmployeeTokens.green,
      ),
      failure: (Failure failure) => showWorkToast(
        context,
        message: failure.message,
        tone: EmployeeTokens.red,
        icon: Icons.error_outline,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<InspectionReportState> state =
        ref.watch(inspectionReportProvider(widget.work.id));

    return WorkAsyncView<InspectionReportState>(
      value: state,
      loading: const WorkLoading(height: 110),
      onRetry: () => ref.invalidate(inspectionReportProvider(widget.work.id)),
      builder: (BuildContext context, InspectionReportState data) {
        final InspectionReportModel? report = data.report;
        if (report == null) return _notGenerated(data.readiness);
        return _written(report);
      },
    );
  }

  /// No report yet: either say what is missing, or offer to compose it.
  Widget _notGenerated(InspectionReportReadinessModel readiness) {
    if (!readiness.canGenerate) {
      // The outstanding sub-tasks are named because that is the actionable form of the
      // blocker; when there are none the work simply has no sub-tasks, and the blocker
      // codes carry their own sentences.
      final List<String> lines = readiness.outstandingTaskTitles.isNotEmpty
          ? readiness.outstandingTaskTitles
          : readiness.blockers
              .map((InspectionReportBlocker blocker) => blocker.label)
              .toList(growable: false);

      return NoticeBanner(
        tone: EmployeeTokens.yellow,
        icon: Icons.rule_outlined,
        title: 'Үзлэгийн тайлан үүсгэхэд дутуу байгаа',
        text: lines.isEmpty
            ? 'Дэд ажлууд дуусаагүй байна.'
            : 'Дараах дэд ажил дуусаагүй байна:\n${lines.join('\n')}',
      );
    }

    final String? blocked = _blockedReason;

    return WorkCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            'Үзлэгийн тайлан үүсгэхэд бэлэн',
            style: EmployeeTokens.rowTitle.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            'Дэд ажлууд дууссан тул систем зөрчлийн жагсаалт, ерөнхий түвшин, '
            'дүгнэлт, зөвлөмжийг үнэлгээнээс бүрдүүлж ноорог тайлан гаргана. '
            'Дараа нь бичвэрийг өөрөө засна.',
            style: EmployeeTokens.rowSub.copyWith(color: EmployeeTokens.ink2, height: 1.6),
          ),
          if (readiness.blockers.contains(InspectionReportBlocker.scoresMissing))
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Үнэлгээ оруулаагүй дэд ажил байна — эдгээр ажил зөрчлийн '
                'жагсаалтад орохгүй.',
                style: EmployeeTokens.microNote.copyWith(height: 1.5),
              ),
            ),
          if (blocked != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              blocked,
              style: EmployeeTokens.microNote.copyWith(height: 1.5),
            ),
          ] else ...<Widget>[
            const SizedBox(height: 12),
            WorkButton(
              label: 'Үзлэгийн тайлан үүсгэх',
              icon: Icons.auto_awesome_outlined,
              busy: _busy,
              onPressed: _busy ? null : _generate,
            ),
          ],
        ],
      ),
    );
  }

  Widget _written(InspectionReportModel report) {
    final String? blocked = _blockedReason;

    return WorkCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  report.actName ?? 'Үзлэгийн нэгдсэн тайлан',
                  style: EmployeeTokens.rowTitle.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              EmployeePill.status(label: report.status.label, color: report.status.tone),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${report.version}-р хувилбар'
            '${report.isAutoDraft ? ' · системээс бүрдүүлсэн' : ''}'
            '${report.createdByName == null ? '' : ' · ${report.createdByName}'}',
            style: EmployeeTokens.microNote.copyWith(height: 1.5),
          ),

          if (report.overallLabel != null) ...<Widget>[
            const SizedBox(height: 10),
            // A Wrap rather than a Row: the longest band label is "Ашиглах боломжгүй"
            // uppercased, which does not fit beside the caption on a 390pt handset, and a
            // truncated safety verdict is worse than one on its own line.
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                Text('Ерөнхий түвшин', style: EmployeeTokens.rowSub),
                EmployeePill(
                  label: report.overallLabel!,
                  tone: riskTone(report.overallLevel),
                  showGlyph: true,
                  glyphLevel: report.overallLevel,
                  semanticLabel:
                      'Ерөнхий түвшин: ${riskSemanticLabel(report.overallLevel)}',
                ),
              ],
            ),
          ],

          if (report.returnReason != null) ...<Widget>[
            const SizedBox(height: 10),
            NoticeBanner(
              margin: EdgeInsets.zero,
              tone: EmployeeTokens.red,
              icon: Icons.undo_outlined,
              title: 'Засварлахаар буцаагдсан',
              text: report.returnReason!,
            ),
          ],

          const SizedBox(height: 12),
          _ReportText(label: 'Үзлэгээр шалгасан', text: report.inspectedScope),
          const SizedBox(height: 8),
          _ReportText(label: 'Илэрсэн зөрчил', text: report.issueSummary),
          const SizedBox(height: 8),
          _ReportText(label: 'Дүгнэлт', text: report.conclusion),
          const SizedBox(height: 8),
          _ReportText(label: 'Зөвлөмж', text: report.recommendation),
          const SizedBox(height: 8),
          _ReportText(
            label: 'Шинэчлэх самбарууд',
            text: report.replacementPanels.isEmpty
                ? null
                : report.replacementPanels.join('\n'),
          ),
          const SizedBox(height: 8),
          _ReportText(
            label: 'Шинэчлэх холболтууд',
            text: report.replacementConnections.isEmpty
                ? null
                : report.replacementConnections.join('\n'),
          ),

          if (blocked != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              blocked,
              style: EmployeeTokens.microNote.copyWith(height: 1.5),
            ),
          ] else if (report.status.isLocked) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              '"${report.status.label}" төлөвт байгаа тайланг засах боломжгүй.',
              style: EmployeeTokens.microNote.copyWith(height: 1.5),
            ),
          ] else ...<Widget>[
            const SizedBox(height: 12),
            WorkButton.secondary(
              label: 'Тайлан бичих',
              icon: Icons.edit_outlined,
              onPressed: _busy
                  ? null
                  : () => showInspectionReportSheet(
                        context,
                        plannedWorkId: widget.work.id,
                        report: report,
                      ),
            ),
            if (report.canSubmit) ...<Widget>[
              const SizedBox(height: 8),
              WorkButton(
                label: 'Хянуулахаар илгээх',
                icon: Icons.send_outlined,
                busy: _busy,
                onPressed: _busy ? null : _submit,
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _ReportText extends StatelessWidget {
  const _ReportText({required this.label, required this.text});

  final String label;
  final String? text;

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
            style: EmployeeTokens.microLabel.copyWith(
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            text ?? 'Хараахан бичигдээгүй.',
            style: EmployeeTokens.rowSub.copyWith(
              color: text == null ? EmployeeTokens.muted : EmployeeTokens.ink2,
              fontStyle: text == null ? FontStyle.italic : FontStyle.normal,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActorLine extends StatelessWidget {
  const _ActorLine({required this.label, required this.stamp});

  final String label;
  final ActorStampModel stamp;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        InitialsAvatar(initials: initialsOf(stamp.name), size: 24),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            '$label: ${stamp.name ?? '-'}'
            '${stamp.at == null ? '' : ' · ${formatDateTime(stamp.at)}'}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: EmployeeTokens.microNote,
          ),
        ),
      ],
    );
  }
}

class _MaterialsCard extends StatelessWidget {
  const _MaterialsCard({required this.work});

  final PlannedWorkModel work;

  @override
  Widget build(BuildContext context) {
    return WorkCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          for (int i = 0; i < work.materials.length; i++)
            InfoRow(
              label: work.materials[i].name,
              value: '${formatQuantity(work.materials[i].quantity)}'
                  ' ${work.materials[i].unit.label}',
              divider: i < work.materials.length - 1,
            ),
        ],
      ),
    );
  }
}

/// The two narrative fields of the consolidated report.
class _ReportDraft {
  const _ReportDraft({required this.conclusion, required this.recommendation});

  final String conclusion;
  final String recommendation;
}

Future<_ReportDraft?> _showReportEditor(
  BuildContext context, {
  required String conclusion,
  required String recommendation,
}) {
  return showModalBottomSheet<_ReportDraft>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    builder: (BuildContext sheetContext) => _ReportEditorSheet(
      conclusion: conclusion,
      recommendation: recommendation,
    ),
  );
}

/// Дүгнэлт тайлан — the two narrative fields, and the two controllers behind them.
///
/// THE CONTROLLERS BELONG TO THIS STATE AND NOWHERE ELSE.
///
/// `showModalBottomSheet` hands back a future that completes the moment `Navigator.pop`
/// runs, NOT when the sheet leaves the screen: the route is still mounted, still playing
/// its exit animation, and still rebuilding for another few hundred milliseconds. This
/// sheet used to be a plain `builder:` closure over two controllers owned by the caller
/// and disposed from `.whenComplete`, which therefore killed them mid-flight, while both
/// [TextField]s were still live.
///
/// The failure was not hypothetical and not quiet. Dismissing the keyboard as the sheet
/// popped rebuilt the field — `_AnimatedState.didUpdateWidget` re-subscribing to the
/// controller it merges with the focus node — and threw "A TextEditingController was
/// used after being disposed". The thrown build left the route half-torn-down, and the
/// Overlay's teardown then tripped `InheritedElement.debugDeactivated`'s
/// `_dependents.isEmpty`: the red screen, whose assertion named the framework rather
/// than this file. Typing into a field was enough to make it certain, because a focused
/// field is one the pop is guaranteed to rebuild.
///
/// A [State] fixes the ordering by construction. `dispose()` runs when the element is
/// unmounted — after the animation, after the last rebuild — which is the only moment at
/// which nothing can still read the controllers.
class _ReportEditorSheet extends StatefulWidget {
  const _ReportEditorSheet({
    required this.conclusion,
    required this.recommendation,
  });

  final String conclusion;
  final String recommendation;

  @override
  State<_ReportEditorSheet> createState() => _ReportEditorSheetState();
}

class _ReportEditorSheetState extends State<_ReportEditorSheet> {
  late final TextEditingController _conclusion;
  late final TextEditingController _recommendation;

  @override
  void initState() {
    super.initState();
    _conclusion = TextEditingController(text: widget.conclusion);
    _recommendation = TextEditingController(text: widget.recommendation);
  }

  @override
  void dispose() {
    _conclusion.dispose();
    _recommendation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Container(
        decoration: const BoxDecoration(
          color: EmployeeTokens.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(EmployeeTokens.radiusSheet),
          ),
        ),
        padding: EdgeInsets.fromLTRB(
          16,
          16,
          16,
          16 + MediaQuery.viewPaddingOf(context).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              'Дүгнэлт тайлан',
              style: EmployeeTokens.screenTitle,
            ),
            const SizedBox(height: 16),
            _EditorField(
              label: 'Дүгнэлт',
              controller: _conclusion,
              hint: 'Хийсэн ажлын нэгдсэн дүгнэлт...',
            ),
            const SizedBox(height: 14),
            _EditorField(
              label: 'Зөвлөмж',
              controller: _recommendation,
              hint: 'Эрсдэлийг бууруулах зөвлөмж...',
            ),
            const SizedBox(height: 18),
            Row(
              children: <Widget>[
                Expanded(
                  child: WorkButton.secondary(
                    label: 'Болих',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  flex: 2,
                  child: WorkButton(
                    label: 'Тайлан хадгалах',
                    icon: Icons.check,
                    onPressed: () => Navigator.of(context).pop(
                      _ReportDraft(
                        conclusion: _conclusion.text.trim(),
                        recommendation: _recommendation.text.trim(),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EditorField extends StatelessWidget {
  const _EditorField({
    required this.label,
    required this.controller,
    required this.hint,
  });

  final String label;
  final TextEditingController controller;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label.toUpperCase(),
          style: EmployeeTokens.sectionLabel.copyWith(letterSpacing: 0.6),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          maxLines: 4,
          style: EmployeeTokens.body.copyWith(color: EmployeeTokens.ink),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: EmployeeTokens.body.copyWith(color: EmployeeTokens.muted),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: const BorderSide(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: const BorderSide(
                color: EmployeeTokens.ink,
                width: EmployeeTokens.hairline,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
