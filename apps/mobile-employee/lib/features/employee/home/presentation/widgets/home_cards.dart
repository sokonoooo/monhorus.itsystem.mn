import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/work_models.dart';
import '../format.dart';
import '../providers/home_providers.dart';
import '../theme/home_tones.dart';
import 'home_ui.dart';

/// One row of "Яаралтай анхаарах".
///
/// The prototype's card was tappable and pushed the request detail. Nothing is
/// pushed here: the Ажил tab owns that screen and this tab must not reach into
/// another feature's directory. The card is therefore presentational, and the
/// reference number is printed in the mono face so it can be read out or searched
/// for on the Ажил tab.
class UrgentWorkCard extends StatelessWidget {
  const UrgentWorkCard({super.key, required this.item, this.onTap});

  final HomeUrgentItem item;

  /// Supplied only for a row that can actually be opened. A planned-work row carries
  /// none: that record's screen belongs to the Ажил tab, and a tap that went nowhere
  /// would be worse than no tap at all.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final Tone tone = severityTone(item.band);

    return HomeCard(
      onTap: onTap,
      accent: tone.foreground,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 13),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.cardTitle,
                ),
              ),
              const SizedBox(width: 10),
              if (item.statusLabel.isNotEmpty)
                EmployeePill(label: item.statusLabel, tone: tone, showDot: true),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            item.detail.isEmpty
                ? item.reference
                : '${item.reference} · ${item.detail}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: EmployeeTokens.microNote
                .merge(EmployeeTokens.mono)
                .copyWith(color: EmployeeTokens.muted),
          ),
          if (item.location.isNotEmpty) ...<Widget>[
            const SizedBox(height: 4),
            Text(
              item.location,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: EmployeeTokens.rowSub,
            ),
          ],
          if (item.dueAt != null) ...<Widget>[
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                Icon(
                  item.isOverdue
                      ? Icons.error_outline
                      : Icons.schedule_outlined,
                  size: 13,
                  color: item.isOverdue
                      ? EmployeeTokens.red
                      : EmployeeTokens.muted,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    '${item.isOverdue ? 'Хугацаа хэтэрсэн' : 'Дуусах'}: '
                    '${formatDateTime(item.dueAt)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: EmployeeTokens.rowSub.copyWith(
                      fontWeight: FontWeight.w600,
                      color: item.isOverdue ? EmployeeTokens.red : EmployeeTokens.ink2,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

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
  const OrganisationTodayCard({super.key, required this.due, required this.overdue, required this.urgent, required this.completed});

  final int due;
  final int overdue;
  final int urgent;
  final int completed;

  @override
  Widget build(BuildContext context) {
    return HomeMiniGrid(
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

/// The three-figure "Миний гүйцэтгэл" strip, built from `EmployeeWorkloadDto`.
///
/// Those three counters are the only per-employee performance figures the API
/// exposes. The prototype's "Сард дууссан" and "Нийт хийсэн" pair implies a
/// month-scoped completion count, and no endpoint reports one, so it is not drawn.
class PerformanceStrip extends StatelessWidget {
  const PerformanceStrip({
    super.key,
    required this.total,
    required this.completed,
    required this.active,
  });

  final int total;
  final int completed;
  final int active;

  @override
  Widget build(BuildContext context) {
    return HomeSummaryStrip(
      entries: <HomeSummaryEntry>[
        HomeSummaryEntry(value: '$total', label: 'Нийт'),
        HomeSummaryEntry(
          value: '$completed',
          label: 'Дууссан',
          color: EmployeeTokens.green,
        ),
        HomeSummaryEntry(
          value: '$active',
          label: 'Идэвхтэй',
          color: EmployeeTokens.yellow,
        ),
      ],
    );
  }
}
