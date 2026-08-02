import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/planned_work_model.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../format.dart';
import 'work_ui.dart';

/// The `.pw-card` from the prototype: a planned work as it appears in the list.
///
/// Shows only figures the server sent. The progress bar reads `progressPercent`,
/// which is quantity-weighted server-side, so a twenty-point circuit survey cannot
/// be outweighed by a one-item panel check the way a task-count average would allow.
class PlannedWorkCard extends StatelessWidget {
  const PlannedWorkCard({super.key, required this.work, required this.onTap});

  final PlannedWorkListItemModel work;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color tone = work.effectiveStatus.tone;
    final bool isOverdue =
        work.effectiveStatus == PlannedWorkEffectiveStatus.overdue;

    return WorkCard(
      onTap: onTap,
      accent: isOverdue ? EmployeeTokens.red : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  work.workNumber,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: EmployeeTokens.muted,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              EmployeePill.status(
                label: work.effectiveStatus.label,
                color: tone,
                showDot: isOverdue,
              ),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            work.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w800,
              color: EmployeeTokens.ink,
              height: 1.35,
            ),
          ),
          if (work.objectPath.isNotEmpty) ...<Widget>[
            const SizedBox(height: 4),
            Text(
              work.objectPath,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: EmployeeTokens.rowSub,
            ),
          ],
          const SizedBox(height: 11),
          Row(
            children: <Widget>[
              Expanded(
                child: _MetaCell(
                  label: 'Хугацаа',
                  value: formatDeadline(work.plannedEndDate),
                  tone: isOverdue ? EmployeeTokens.red : EmployeeTokens.ink,
                ),
              ),
              const SizedBox(width: 7),
              Expanded(
                child: _MetaCell(
                  label: 'Дуусах',
                  value: formatShortStamp(work.plannedEndDate),
                ),
              ),
            ],
          ),
          const SizedBox(height: 11),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: Text(
                  'Явц · ${work.taskCount} дэд ажил',
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: EmployeeTokens.muted,
                  ),
                ),
              ),
              Text(
                formatPercent(work.progressPercent),
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w900,
                  color: tone == EmployeeTokens.muted ? EmployeeTokens.ink : tone,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ProgressRail(percent: work.progressPercent, color: _railTone(tone)),
          if (work.assignedEmployees.isNotEmpty ||
              work.assignedTeam != null) ...<Widget>[
            const SizedBox(height: 11),
            Row(
              children: <Widget>[
                InitialsAvatar(
                  initials: initialsOf(
                    work.assignedEmployees.isNotEmpty
                        ? work.assignedEmployees.first.name
                        : work.assignedTeam?.name,
                  ),
                  size: 26,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _assignmentLine(work),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 10.5,
                      color: EmployeeTokens.muted,
                      height: 1.4,
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

  /// A neutral status never colours the rail — an untouched bar reads as "nothing
  /// recorded", which is exactly what it means before work begins.
  static Color _railTone(Color statusTone) =>
      statusTone == EmployeeTokens.muted ? EmployeeTokens.line : statusTone;

  static String _assignmentLine(PlannedWorkListItemModel work) {
    final List<String> names =
        work.assignedEmployees.map((NamedRefModel ref) => ref.name).toList();
    final String team = work.assignedTeam?.name ?? '';

    if (names.isEmpty && team.isEmpty) return 'Хариуцагч тодорхойгүй';
    if (names.isEmpty) return 'Баг: $team';

    final String people =
        names.length == 1 ? names.first : '${names.first} +${names.length - 1}';
    return team.isEmpty ? people : '$people · Баг: $team';
  }
}

/// A `.meta` cell: a tiny uppercase caption over its value.
class _MetaCell extends StatelessWidget {
  const _MetaCell({
    required this.label,
    required this.value,
    this.tone = EmployeeTokens.ink,
  });

  final String label;
  final String value;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
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
            style: const TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: EmployeeTokens.muted,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: tone,
            ),
          ),
        ],
      ),
    );
  }
}
