import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/calendar_event_model.dart';
import '../../domain/entities/event_level.dart';
import '../calendar_format.dart';
import 'calendar_ui.dart';

/// `renderMcalAgenda`'s item: an outlined card with a 3px full-height coloured bar
/// down its left edge, a 12px/700 name and a mono metadata line.
///
/// Everything on it comes from `CalendarEventDto` and nothing is inferred. In
/// particular the progress rail is drawn only for planned work, because the calendar
/// service reports `progressPercent: null` for a service request — a request has no
/// quantity to be a percentage of, and rendering 0% would state a fact the backend
/// declined to state.
///
/// [onTap] opens the record the entry projects. It is nullable because an entry whose
/// source carries no id has nothing to open, and such a row must draw without an ink
/// response rather than look tappable and swallow the tap.
class AgendaCard extends StatelessWidget {
  const AgendaCard({
    super.key,
    required this.event,
    required this.onTap,
  });

  final CalendarEventModel event;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final EventLevel level = event.level;
    final String? location = event.buildingName ?? event.customerName;
    final int? progress = event.progressPercent;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        8,
      ),
      child: Material(
        color: EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
              border: Border.all(
                color: level == EventLevel.red
                    ? EmployeeTokens.redBorder
                    : EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Container(width: 3, color: level.color),
                  Expanded(
                    child: Padding(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Expanded(
                                child: Text(
                                  event.title.isEmpty ? '(Гарчиггүй)' : event.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: EmployeeTokens.detailValue,
                                ),
                              ),
                              const SizedBox(width: 8),
                              EmployeePill(
                                label: event.isOverdue
                                    ? 'Хэтэрсэн'
                                    : event.statusLabel,
                                tone: level.tone,
                                showDot: level == EventLevel.red,
                              ),
                            ],
                          ),
                          const SizedBox(height: 5),
                          Text(
                            <String>[
                              formatSpan(event.start, event.end),
                              if (location != null) location,
                            ].join(' · '),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: EmployeeTokens.microNote.merge(EmployeeTokens.mono),
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: <Widget>[
                              EmployeePill.outline(label: event.source.shortLabel),
                              Text(
                                event.reference,
                                style: EmployeeTokens.microNote
                                    .merge(EmployeeTokens.mono)
                                    .copyWith(color: EmployeeTokens.ink2),
                              ),
                              if (event.isUrgent)
                                const EmployeePill(
                                  label: 'Яаралтай',
                                  tone: Tone.red,
                                ),
                            ],
                          ),
                          if (progress != null) ...<Widget>[
                            const SizedBox(height: 8),
                            Row(
                              children: <Widget>[
                                Expanded(
                                  child: ProgressRail(
                                    percent: progress.toDouble(),
                                    color: progress >= 100
                                        ? EmployeeTokens.green
                                        : (progress > 0
                                            ? EmployeeTokens.yellow
                                            : EmployeeTokens.line),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  '$progress%',
                                  style: EmployeeTokens.microNote
                                      .merge(EmployeeTokens.mono)
                                      .copyWith(color: EmployeeTokens.ink2),
                                ),
                              ],
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
        ),
      ),
    );
  }
}
