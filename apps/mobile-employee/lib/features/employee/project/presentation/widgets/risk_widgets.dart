import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/risk_glyph.dart';
import '../../data/models/project_models.dart';
import '../../domain/entities/risk_level.dart';
import 'project_ui.dart';

/// Per-band device counts for a project, building or floor.
///
/// Counts, never a single rolled-up figure: the backend refuses to publish an
/// aggregate score for a node because requirements section 19.2 leaves the method
/// unapproved. The prototype's "оноо /100" on a floor row has no counterpart in the
/// API and is replaced by this breakdown.
class RiskCountStrip extends StatelessWidget {
  const RiskCountStrip({super.key, required this.summary});

  final RiskSummaryModel summary;

  @override
  Widget build(BuildContext context) {
    if (summary.isEmpty) {
      return const Text('Үнэлгээ бүртгэгдээгүй', style: EmployeeTokens.rowSub);
    }

    return Wrap(
      spacing: 5,
      runSpacing: 5,
      children: <Widget>[
        for (final RiskLevel level in RiskLevel.values)
          if (summary.countOf(level) > 0)
            _CountChip(level: level, count: summary.countOf(level)),
        if (summary.unassessedCount > 0)
          _CountChip(level: null, count: summary.unassessedCount),
      ],
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.level, required this.count});

  final RiskLevel? level;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${riskSemanticLabel(level)}: $count',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          color: EmployeeTokens.soft2,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: EmployeeTokens.faint),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            RiskGlyph(level: level, size: 9),
            const SizedBox(width: 5),
            Text(
              // The abbreviation, never a colour name: the glyph already says which
              // band it is, and "Улаан 12" tells a colour-blind reader nothing.
              '${riskShortLabel(level)} $count',
              style: EmployeeTokens.pillLabel.copyWith(color: EmployeeTokens.ink),
            ),
          ],
        ),
      ),
    );
  }
}

/// What each band means: its glyph, its swatch and its full name.
///
/// **No score ranges.** The band boundaries are runtime-configurable server-side
/// (`riskBandsOf`) and neither mobile role can read `GET /settings` — `SETTINGS_VIEW`
/// is admin/management/finance only, so the app gets a 403. A printed "21-40%" is
/// therefore a number this app cannot verify and the server can silently contradict.
/// The legend names the bands; a device shows its own score. The scale is not ours to
/// publish, which is also why the old "зааг Тохиргооноос өөрчлөгдөж болно" footnote is
/// gone: it was an admission that the line above it might be wrong.
class RiskLegend extends StatelessWidget {
  const RiskLegend({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        12,
      ),
      child: Wrap(
        spacing: 12,
        runSpacing: 6,
        children: <Widget>[
          // The five bands, best-first, then the display state for an object that has
          // never been scored. Sixth and last, and grey: it is not a good result.
          for (final RiskLevel? level in <RiskLevel?>[...RiskLevel.values, null])
            _LegendEntry(level: level),
        ],
      ),
    );
  }
}

class _LegendEntry extends StatelessWidget {
  const _LegendEntry({required this.level});

  final RiskLevel? level;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: riskSemanticLabel(level),
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          RiskSwatch(level: level, size: 16),
          const SizedBox(width: 6),
          Text(riskSemanticLabel(level), style: EmployeeTokens.rowSub),
        ],
      ),
    );
  }
}

/// The four counters the prototype puts above a floor plan, widened to the five bands
/// the API actually reports plus the unassessed count.
///
/// The notes underneath say which bands each counter rolls up. They used to say
/// "Улаан ба хар" and "Шар ба улбар шар" — the colours of the bands, which is not
/// what the reader needs to know and is unreadable to a colour-blind technician.
class RiskMetricGrid extends StatelessWidget {
  const RiskMetricGrid({super.key, required this.summary});

  final RiskSummaryModel summary;

  @override
  Widget build(BuildContext context) {
    return MetricGrid(
      cards: <Widget>[
        MetricCard(
          label: RiskLevel.critical.shortLabel,
          value: '${summary.criticalCount}',
          note: '${RiskLevel.critical.label}, ${RiskLevel.outOfService.label}',
          valueColor: summary.criticalCount > 0
              ? EmployeeTokens.red
              : EmployeeTokens.ink,
        ),
        MetricCard(
          label: RiskLevel.attention.shortLabel,
          value: '${summary.attentionCount}',
          note: '${RiskLevel.attention.label}, ${RiskLevel.scheduleRepair.label}',
          valueColor: summary.attentionCount > 0
              ? EmployeeTokens.yellow
              : EmployeeTokens.ink,
        ),
        MetricCard(
          label: RiskLevel.normal.shortLabel,
          value: '${summary.normalCount}',
          note: 'Эрсдэл бүртгэгдээгүй',
          valueColor: summary.normalCount > 0
              ? EmployeeTokens.green
              : EmployeeTokens.ink,
        ),
        MetricCard(
          label: unassessedLabel,
          value: '${summary.unassessedCount}',
          note: 'Нийт ${summary.total}',
        ),
      ],
    );
  }
}
