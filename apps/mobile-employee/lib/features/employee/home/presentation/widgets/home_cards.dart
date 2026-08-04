import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/work_models.dart';
import '../format.dart';
import '../theme/home_tones.dart';
import 'home_ui.dart';

// `UrgentWorkCard` — the boxed "Яаралтай анхаарах" card — lived here. The Нүүр tab
// was its only caller and the steel direction replaced it with `BlueprintRow`: four
// bordered cards stacked with gaps read as four unrelated objects, where one ruled
// list with a severity band per row reads as a schedule. It is deleted rather than
// left unreachable, so there is one urgent row in the app rather than two that can
// drift apart.

/// One entry of today's agenda: a coloured left bar, a name and a mono meta line.
class AgendaEventCard extends StatelessWidget {
  const AgendaEventCard({super.key, required this.event});

  final CalendarEventModel event;

  @override
  Widget build(BuildContext context) {
    final Tone tone = event.isOverdue
        ? Tone.red
        : (event.isUrgent ? Tone.red : Tone.neutral);

    return Padding(
      padding: const EdgeInsets.fromLTRB(kHomeGutter, 0, kHomeGutter, 7),
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: EmployeeTokens.white,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusHomeCard),
          border: Border.all(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Container(width: 3, color: tone.foreground),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(11, 10, 11, 11),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              event.title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: EmployeeTokens.detailValue,
                            ),
                          ),
                          const SizedBox(width: 8),
                          EmployeePill(
                            label: event.statusLabel.isEmpty
                                ? (event.source?.label ?? '')
                                : event.statusLabel,
                            tone: event.isOverdue
                                ? Tone.red
                                : Tone.outline,
                          ),
                        ],
                      ),
                      const SizedBox(height: 5),
                      Text(
                        <String>[
                          formatAgendaSpan(event.start, event.end),
                          event.reference,
                          if (event.locationLabel.isNotEmpty) event.locationLabel,
                        ].join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: EmployeeTokens.microNote
                            .merge(EmployeeTokens.mono)
                            .copyWith(color: EmployeeTokens.muted, height: 1.5),
                      ),
                      if (event.progressPercent != null) ...<Widget>[
                        const SizedBox(height: 8),
                        ProgressRail(
                          percent: event.progressPercent!,
                          color: _progressColour(event.progressPercent!),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Явц ${formatPercent(event.progressPercent)}',
                          style: EmployeeTokens.microNote,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Green once complete, yellow while under way, the neutral rail before anything
  /// has been recorded — the same three states the prototype's bars carry.
  static Color _progressColour(double percent) {
    if (percent >= 100) return EmployeeTokens.green;
    if (percent > 0) return EmployeeTokens.yellow;
    return EmployeeTokens.line;
  }
}

/// One row of the organisation's day, shown only when the account could not be
/// linked to an employee record and the personal figures are therefore unavailable.
class OrganisationTodayCard extends StatelessWidget {
  const OrganisationTodayCard({
    super.key,
    required this.due,
    required this.overdue,
    required this.urgent,
    required this.completed,
    this.padding,
  });

  final int due;
  final int overdue;
  final int urgent;
  final int completed;

  /// Forwarded to the grid. Supplied when the card is drawn inside a
  /// `BlueprintFrame`, which already owns the page gutter.
  final EdgeInsets? padding;

  @override
  Widget build(BuildContext context) {
    return HomeMiniGrid(
      padding: padding ??
          const EdgeInsets.fromLTRB(kHomeGutter, 0, kHomeGutter, 10),
      cards: <Widget>[
        HomeMiniCard(
          icon: Icons.today_outlined,
          tone: HomeTokens.tileOrange,
          value: '$due',
          label: 'Өнөөдөр дуусах',
        ),
        HomeMiniCard(
          icon: Icons.error_outline,
          tone: HomeTokens.tilePink,
          value: '$overdue',
          label: 'Хугацаа хэтэрсэн',
        ),
        HomeMiniCard(
          icon: Icons.priority_high,
          tone: HomeTokens.tilePlain,
          value: '$urgent',
          label: 'Яаралтай',
        ),
        HomeMiniCard(
          icon: Icons.check_circle_outline,
          tone: HomeTokens.tileMint,
          value: '$completed',
          label: 'Өнөөдөр дууссан',
        ),
      ],
    );
  }
}

// `PerformanceStrip` — the three-figure "Миний гүйцэтгэл" strip — stood here. The
// Нүүр tab was its only caller, and that section was removed, so the widget went
// with it. The same three counters are still shown on Профайл, which builds its own
// `_WorkloadStrip` from `EmployeeWorkloadModel`.
