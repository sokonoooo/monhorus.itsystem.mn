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
      return Text('Үнэлгээ бүртгэгдээгүй', style: EmployeeTokens.rowSub);
    }

    return Wrap(
      spacing: 5,
      runSpacing: 5,
      children: <Widget>[
        for (final RiskLevel level in riskBandsInUse())
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
          // The bands actually in use, best-first, then the display state for an
          // object that has never been scored — last, and grey: it is not a good
          // result. Not `RiskLevel.values`: three of those are reserved storage keys
          // and listing them would name bands nobody configured.
          for (final RiskLevel? level in <RiskLevel?>[...riskBandsInUse(), null])
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

/// The four counters the prototype puts above a floor plan, widened to the bands the
/// API actually reports plus the unassessed count.
///
/// THE FOUR FIGURES ADD UP TO THE TOTAL, and that is the whole point of the rewrite.
/// Three of the cards were built from five hard-coded band keys while the fourth printed
/// the server's own `total`, so a device graded into a configured spare was in the total
/// and in none of the three cards: on any installation using a sixth band the strip
/// visibly did not sum, with no clue as to where the missing devices went.
///
/// The groups come from [riskBandGroups], which partitions the configured ladder, and
/// each card names the bands it actually rolls up — the administrator's own names for
/// them, so a renamed band reads as itself here too. The notes used to say "Улаан ба хар"
/// and "Шар ба улбар шар", which is the colours of the bands rather than what the reader
/// needs to know, and is unreadable to a colour-blind technician.
///
/// A group with no configured band in it is dropped rather than drawn as a zero: an empty
/// card claims a band exists and holds nothing, and the arithmetic still holds without it.
class RiskMetricGrid extends StatelessWidget {
  const RiskMetricGrid({super.key, required this.summary});

  final RiskSummaryModel summary;

  @override
  Widget build(BuildContext context) {
    final RiskBandGroups groups = riskBandGroups();

    return MetricGrid(
      cards: <Widget>[
        if (groups.critical.isNotEmpty)
          _GroupCard(
            group: groups.critical,
            value: summary.criticalCount,
            tone: EmployeeTokens.red,
          ),
        if (groups.attention.isNotEmpty)
          _GroupCard(
            group: groups.attention,
            value: summary.attentionCount,
            tone: EmployeeTokens.yellow,
          ),
        if (groups.normal.isNotEmpty)
          _GroupCard(
            group: groups.normal,
            value: summary.normalCount,
            tone: EmployeeTokens.green,
            // The one card whose note is a sentence rather than a band list: on the
            // shipped ladder the group is «Хэвийн» alone, and repeating the card's own
            // label underneath it says nothing.
            note: groups.normal.length == 1 ? 'Эрсдэл бүртгэгдээгүй' : null,
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

/// One roll-up card, labelled by the best band it covers and noting all of them.
class _GroupCard extends StatelessWidget {
  const _GroupCard({
    required this.group,
    required this.value,
    required this.tone,
    this.note,
  });

  final List<RiskLevel> group;
  final int value;
  final Color tone;
  final String? note;

  @override
  Widget build(BuildContext context) {
    return MetricCard(
      // The group's best band names the card. On the shipped ladder that is «Ноцтой»,
      // «Анхаарах» and «Хэвийн», exactly as before; on a ladder missing one of the
      // anchors it is whichever band the administrator actually left at that rung.
      label: group.first.shortLabel,
      value: '$value',
      note: note ?? group.map((RiskLevel level) => level.label).join(', '),
      valueColor: value > 0 ? tone : EmployeeTokens.ink,
    );
  }
}
