import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/calendar_event_model.dart';
import '../../domain/entities/calendar_source.dart';
import '../../domain/entities/event_level.dart';
import '../calendar_format.dart';
import 'calendar_ui.dart';

/// Read-only detail for one calendar entry.
///
/// The prototype opens the planned-work screen from an agenda row. That screen is
/// owned by the Ажил tab, so this sheet does the honest thing instead of a
/// half-built copy: it shows everything `CalendarEventDto` already carries — which
/// is the reference, the title, the status, the span, the location, who it is
/// assigned to and the progress figure — and says plainly that the full record and
/// its actions live in the Ажил tab.
///
/// Deliberately no extra fetch. Opening `GET /planned-work/:id` here would duplicate
/// the other tab's model, and `GET /service-requests/:id/report` must never be
/// touched speculatively: that read creates a draft conclusion attributed to the
/// caller.
Future<void> showCalendarEventSheet(
  BuildContext context,
  CalendarEventModel event,
) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (BuildContext context) => _EventDetailSheet(event: event),
  );
}

class _EventDetailSheet extends StatelessWidget {
  const _EventDetailSheet({required this.event});

  final CalendarEventModel event;

  @override
  Widget build(BuildContext context) {
    final EventLevel level = event.level;
    final int? progress = event.progressPercent;

    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.92,
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
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.only(top: 10, bottom: 6),
              child: _SheetHandle(),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 6, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            event.reference,
                            style: EmployeeTokens.mono.copyWith(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: EmployeeTokens.muted,
                            ),
                          ),
                        ),
                        EmployeePill(
                          label: event.statusLabel,
                          tone: level.tone,
                          showDot: level == EventLevel.red,
                          flexibleText: true,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      event.title.isEmpty ? '(Гарчиггүй)' : event.title,
                      style: EmployeeTokens.headerTitle,
                    ),
                    const SizedBox(height: 12),
                    if (event.isOverdue)
                      const _InlineNotice(
                        level: EventLevel.red,
                        icon: Icons.schedule_outlined,
                        text: 'Энэ ажлын хугацаа хэтэрсэн байна.',
                      ),
                    if (event.isUrgent)
                      const _InlineNotice(
                        level: EventLevel.red,
                        icon: Icons.priority_high,
                        text: 'Яаралтай ангилалтай хүсэлт.',
                      ),
                    _DetailRow(
                      label: 'Төрөл',
                      value: event.source.label,
                    ),
                    _DetailRow(
                      label: 'Хугацаа',
                      value: formatSpan(event.start, event.end),
                      mono: true,
                    ),
                    if (event.spansMultipleDays)
                      _DetailRow(
                        label: 'Үргэлжлэх',
                        value: formatDayCount(
                          event.end.difference(event.start).inDays + 1,
                        ),
                      ),
                    _DetailRow(
                      label: 'Харилцагч',
                      value: event.customerName ?? '—',
                    ),
                    _DetailRow(
                      label: 'Барилга',
                      value: event.buildingName ?? '—',
                    ),
                    _DetailRow(
                      label: 'Хариуцсан',
                      value: event.assignedNames.isEmpty
                          ? 'Хуваарилагдаагүй'
                          : event.assignedNames.join(', '),
                    ),
                    if (progress != null) ...<Widget>[
                      const SizedBox(height: 12),
                      const Text(
                        'ГҮЙЦЭТГЭЛ',
                        style: EmployeeTokens.sectionLabel,
                      ),
                      const SizedBox(height: 6),
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
                          const SizedBox(width: 10),
                          Text(
                            '$progress%',
                            style: EmployeeTokens.mono.copyWith(
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                              color: EmployeeTokens.ink,
                            ),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 14),
                    NoticeBanner.info(
                      text: event.source == CalendarSource.plannedWork
                          ? 'Гүйцэтгэл бүртгэх, тайлан бичих үйлдлүүд "Ажил" '
                              'таб дотор байрлана. Хуваарь нь зөвхөн '
                              'төлөвлөгөөг харуулна.'
                          : 'Хүсэлтийн дэлгэрэнгүй, төлөв өөрчлөх үйлдэл "Ажил" '
                              'таб дотор байрлана. Хуваарь нь зөвхөн '
                              'төлөвлөгөөг харуулна.',
                    ),
                    const SizedBox(height: 4),
                    SizedBox(
                      width: double.infinity,
                      child: TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        style: TextButton.styleFrom(
                          backgroundColor: EmployeeTokens.soft,
                          foregroundColor: EmployeeTokens.ink2,
                          padding: const EdgeInsets.symmetric(vertical: 13),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(
                              EmployeeTokens.radiusRow,
                            ),
                          ),
                          textStyle: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        child: const Text('Хаах'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 4,
      decoration: BoxDecoration(
        color: EmployeeTokens.line,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}

/// A label/value line, muted label on the left and ink value on the right.
class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.label,
    required this.value,
    this.mono = false,
  });

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: EmployeeTokens.faint)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 96,
            child: Text(
              label,
              style: const TextStyle(fontSize: 11, color: EmployeeTokens.muted),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: mono
                  ? EmployeeTokens.mono.copyWith(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: EmployeeTokens.ink,
                    )
                  : const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      height: 1.4,
                      color: EmployeeTokens.ink,
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({
    required this.level,
    required this.icon,
    required this.text,
  });

  final EventLevel level;
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: level.background,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        border: Border.all(color: level.border, width: EmployeeTokens.hairline),
      ),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 15, color: level.foreground),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                height: 1.4,
                color: level.foreground,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
