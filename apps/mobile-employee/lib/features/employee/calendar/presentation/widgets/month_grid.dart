import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../domain/entities/calendar_month.dart';
import '../../domain/entities/event_level.dart';

/// `renderMcal` — the month grid.
///
/// Seven columns, square cells, week starting Monday. Leading cells carry the
/// previous month's trailing days in `.other` grey and are inert. Today is an ink
/// pill; the selected day is a 2px ink outline. Up to three status dots sit under
/// the number, worst band first.
///
/// A day's dots come from every event whose span *touches* that day, not only from
/// events that start on it — a planned work commonly runs for a week, and marking
/// only its first day would hide the six days it is actually owed on.
class MonthGrid extends StatelessWidget {
  const MonthGrid({
    super.key,
    required this.month,
    required this.selectedDay,
    required this.today,
    required this.levelsByDay,
    required this.onSelectDay,
  });

  final CalendarMonth month;
  final DateTime selectedDay;
  final DateTime today;

  /// Day (midnight) -> the bands present on it, already sorted worst first.
  final Map<DateTime, List<EventLevel>> levelsByDay;

  final ValueChanged<DateTime> onSelectDay;

  @override
  Widget build(BuildContext context) {
    final int leading = month.leadingBlanks;
    final int days = month.dayCount;
    final int cells = ((leading + days) / 7).ceil() * 7;
    final CalendarMonth previous = month.previous;
    final int previousDayCount = previous.dayCount;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          children: <Widget>[
            for (final String caption in weekdayCaptions)
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    caption,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      color: EmployeeTokens.muted,
                    ),
                  ),
                ),
              ),
          ],
        ),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 7,
            mainAxisSpacing: 2,
            crossAxisSpacing: 2,
          ),
          itemCount: cells,
          itemBuilder: (BuildContext context, int index) {
            if (index < leading) {
              return _OtherMonthCell(
                day: previousDayCount - (leading - index - 1),
              );
            }

            final int dayOfMonth = index - leading + 1;
            if (dayOfMonth > days) return const SizedBox.shrink();

            final DateTime date = month.dayAt(dayOfMonth);
            return _DayCell(
              date: date,
              isToday: date == today,
              isSelected: date == selectedDay,
              levels: levelsByDay[date] ?? const <EventLevel>[],
              onTap: () => onSelectDay(date),
            );
          },
        ),
      ],
    );
  }
}

/// `.mcal-day.other` — a filler day from the neighbouring month.
class _OtherMonthCell extends StatelessWidget {
  const _OtherMonthCell({required this.day});

  final int day;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        '$day',
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: EmployeeTokens.faint,
        ),
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.date,
    required this.isToday,
    required this.isSelected,
    required this.levels,
    required this.onTap,
  });

  final DateTime date;
  final bool isToday;
  final bool isSelected;
  final List<EventLevel> levels;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color background =
        isToday ? EmployeeTokens.ink : Colors.transparent;
    final Color foreground =
        isToday ? EmployeeTokens.white : EmployeeTokens.ink;

    // Three is the prototype's ceiling. A busier day says so with a count instead of
    // a fourth dot, because a row of identical dots stops carrying information.
    final List<EventLevel> shown = levels.take(3).toList(growable: false);

    return Semantics(
      button: true,
      selected: isSelected,
      label: '${date.year} оны ${date.month} сарын ${date.day}, '
          '${levels.length} ажил',
      child: Material(
        color: background,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: isSelected
                  ? Border.all(color: EmployeeTokens.ink, width: 2)
                  : null,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Text(
                  '${date.day}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: isToday ? FontWeight.w800 : FontWeight.w600,
                    color: foreground,
                    height: 1.1,
                  ),
                ),
                const SizedBox(height: 3),
                SizedBox(
                  height: 4,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      for (int i = 0; i < shown.length; i++) ...<Widget>[
                        if (i > 0) const SizedBox(width: 2),
                        Container(
                          width: 4,
                          height: 4,
                          decoration: BoxDecoration(
                            // On the ink-filled today pill a dark dot would vanish,
                            // so the neutral band is lightened there.
                            color: isToday && shown[i] == EventLevel.neutral
                                ? EmployeeTokens.white
                                : shown[i].color,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The `‹ 2026 оны 7-р сар ›` switcher above the grid.
class MonthSwitcher extends StatelessWidget {
  const MonthSwitcher({
    super.key,
    required this.month,
    required this.onPrevious,
    required this.onNext,
    this.onToday,
  });

  final CalendarMonth month;
  final VoidCallback onPrevious;
  final VoidCallback onNext;

  /// Null hides the shortcut, which is what happens when the grid already shows the
  /// current month — a button that changes nothing is worse than no button.
  final VoidCallback? onToday;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        _StepButton(
          icon: Icons.chevron_left,
          onTap: onPrevious,
          tooltip: 'Өмнөх сар',
        ),
        Expanded(
          child: Text(
            month.label,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: EmployeeTokens.ink,
            ),
          ),
        ),
        if (onToday != null) ...<Widget>[
          TextButton(
            onPressed: onToday,
            style: TextButton.styleFrom(
              foregroundColor: EmployeeTokens.muted,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(0, 30),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              textStyle: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
            child: const Text('ӨНӨӨДӨР'),
          ),
          const SizedBox(width: 2),
        ],
        _StepButton(
          icon: Icons.chevron_right,
          onTap: onNext,
          tooltip: 'Дараах сар',
        ),
      ],
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({
    required this.icon,
    required this.onTap,
    required this.tooltip,
  });

  final IconData icon;
  final VoidCallback onTap;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          child: Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: Border.all(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            child: Icon(icon, size: 17, color: EmployeeTokens.ink),
          ),
        ),
      ),
    );
  }
}

/// The legend under the grid, so a dot colour is readable without guessing.
class GridLegend extends StatelessWidget {
  const GridLegend({super.key});

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 12,
      runSpacing: 4,
      children: <Widget>[
        _LegendItem(level: EventLevel.red, label: 'Яаралтай / хэтэрсэн'),
        _LegendItem(level: EventLevel.yellow, label: 'Хийгдэж байгаа'),
        _LegendItem(level: EventLevel.green, label: 'Дууссан'),
        _LegendItem(level: EventLevel.neutral, label: 'Ноорог / цуцлагдсан'),
      ],
    );
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.level, required this.label});

  final EventLevel level;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(color: level.color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(
          label,
          style: EmployeeTokens.mono.copyWith(
            fontSize: 9,
            color: EmployeeTokens.muted,
          ),
        ),
      ],
    );
  }
}
