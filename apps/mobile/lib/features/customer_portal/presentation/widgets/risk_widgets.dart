import 'package:flutter/material.dart';

import '../../data/models/project_model.dart';
import '../../domain/entities/risk_level.dart';
import '../theme/customer_tokens.dart';
import 'customer_ui.dart';
import 'risk_glyph.dart';

/// Per-band device counts for a project, building or floor.
///
/// Counts and never a single rolled-up figure: the backend refuses to publish an
/// aggregate score for a node because requirements section 19.2 leaves the
/// aggregation method unapproved, so the app must not manufacture one either. The
/// prototype's "оноо /100" on a floor row has no counterpart in the API and is
/// replaced by this breakdown.
class RiskSummaryStrip extends StatelessWidget {
  const RiskSummaryStrip({super.key, required this.summary, this.compact = false});

  final RiskSummaryModel summary;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (summary.isEmpty) {
      return const Text('Үнэлгээ бүртгэгдээгүй', style: CustomerTokens.rowSub);
    }

    return Wrap(
      spacing: 5,
      runSpacing: 5,
      children: <Widget>[
        for (final RiskLevel level in RiskLevel.values)
          if (summary.countOf(level) > 0)
            _CountChip(
              level: level,
              count: summary.countOf(level),
              compact: compact,
            ),
        if (summary.unassessedCount > 0)
          _CountChip(level: null, count: summary.unassessedCount, compact: compact),
        if (summary.hasCritical && !compact)
          const StatusPill(label: 'Анхаар', tone: AccentTone.red),
      ],
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip({required this.level, required this.count, required this.compact});

  final RiskLevel? level;
  final int count;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final String label = level?.label ?? unassessedLabel;

    return Semantics(
      label: '$label $count',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        decoration: BoxDecoration(
          color: CustomerTokens.soft2,
          borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
          border: Border.all(color: CustomerTokens.faint),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            RiskGlyph(level: level, size: compact ? 8 : 9),
            const SizedBox(width: 5),
            Text('$count', style: CustomerTokens.monoSub),
          ],
        ),
      ),
    );
  }
}

/// Glyph + short label, optionally with the object's own score.
///
/// The label is `ink` rather than the band colour: `ATTENTION` and `SCHEDULE_REPAIR`
/// do not clear 4.5:1 on a tint, so the band identity is carried by the glyph and
/// the border instead of by coloured text.
class RiskPill extends StatelessWidget {
  const RiskPill({
    super.key,
    required this.level,
    this.score,
    this.flexibleText = false,
  });

  /// Null renders the `unassessed` display state, never a band.
  final RiskLevel? level;
  final int? score;

  /// Lets a long label ellipsise instead of overflowing. Opt-in, because a flex
  /// child needs a bounded main axis and this pill also sits inside a [Wrap].
  final bool flexibleText;

  @override
  Widget build(BuildContext context) {
    final AccentTone tone = level?.tone ?? AccentTone.neutral;
    final String text = level?.shortLabel ?? unassessedLabel;

    final Widget label = Text(
      text,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: CustomerTokens.pillLabel,
    );

    return Semantics(
      label: <String>[
        level?.label ?? unassessedLabel,
        if (score != null) '$score%',
      ].join(' '),
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: tone.background,
          borderRadius: BorderRadius.circular(CustomerTokens.radiusPill),
          border: Border.all(color: tone.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            RiskGlyph(level: level, size: 9),
            const SizedBox(width: 5),
            if (flexibleText) Flexible(child: label) else label,
            if (score != null) ...<Widget>[
              const SizedBox(width: 5),
              Text('$score', style: CustomerTokens.monoLabel),
            ],
          ],
        ),
      ),
    );
  }
}

/// What each band means: glyph, colour swatch and the full label.
///
/// No numeric ranges. The score boundaries are runtime-configurable server-side and
/// mobile cannot read `GET /settings` (403), so any printed range could silently
/// contradict the server. The sixth row is the `unassessed` display state, which is
/// deliberately not green.
class RiskLegend extends StatelessWidget {
  const RiskLegend({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.labelGutter,
        0,
        CustomerTokens.labelGutter,
        10,
      ),
      child: Wrap(
        spacing: 12,
        runSpacing: 5,
        children: <Widget>[
          for (final RiskLevel level in RiskLevel.values) _LegendItem(level: level),
          const _LegendItem(level: null),
        ],
      ),
    );
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.level});

  final RiskLevel? level;

  @override
  Widget build(BuildContext context) {
    final AccentTone tone = level?.tone ?? AccentTone.neutral;
    final String label = level?.label ?? unassessedLabel;

    return Semantics(
      label: label,
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          RiskGlyph(level: level, size: 10),
          const SizedBox(width: 5),
          // A colour key rather than a second square, so it cannot be mistaken for
          // the OUT_OF_SERVICE glyph beside it.
          Container(
            width: 14,
            height: 9,
            decoration: BoxDecoration(
              color: tone.foreground,
              borderRadius: BorderRadius.circular(CustomerTokens.hairline),
              border: Border.all(color: tone.border),
            ),
          ),
          const SizedBox(width: 5),
          Text(label, style: CustomerTokens.rowSub),
        ],
      ),
    );
  }
}

/// The object's own 0-100 score in `mono`, ringed in its band colour.
///
/// Only ever fed a real object үнэлгээ, never a derived aggregate. A missing score
/// renders as a dash and never as a zero, because an unassessed object is not a
/// failing one.
class ScoreRing extends StatelessWidget {
  const ScoreRing({
    super.key,
    required this.score,
    required this.level,
    this.diameter = 74,
  });

  final int? score;
  final RiskLevel? level;
  final double diameter;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = level;

    return Semantics(
      label: <String>[
        band?.label ?? unassessedLabel,
        if (score != null) '$score%',
      ].join(' '),
      excludeSemantics: true,
      child: Container(
        width: diameter,
        height: diameter,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: band?.tone.background ?? CustomerTokens.paper,
          border: Border.all(
            color: band?.solidBackground ?? CustomerTokens.line,
            width: 3,
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(score == null ? '-' : '$score', style: CustomerTokens.monoDisplay),
            const SizedBox(height: 3),
            const Text('ҮНЭЛГЭЭ %', style: CustomerTokens.navLabel),
          ],
        ),
      ),
    );
  }
}

/// The prototype's `.score-wrap`: the ringed figure beside a short explanation.
class ScoreCircleCard extends StatelessWidget {
  const ScoreCircleCard({
    super.key,
    required this.score,
    required this.level,
    required this.title,
    required this.body,
  });

  final int? score;
  final RiskLevel? level;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return PanelCard(
      padding: const EdgeInsets.symmetric(
        horizontal: CustomerTokens.gutter,
        vertical: 13,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          ScoreRing(score: score, level: level),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(title, style: CustomerTokens.cardTitle),
                const SizedBox(height: 4),
                Text(body, style: CustomerTokens.rowSub.copyWith(height: 1.55)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
