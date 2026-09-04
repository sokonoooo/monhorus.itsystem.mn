import { RISK_LEVEL_LABELS, type RiskBand, type RiskLevel } from '@monhorus/shared';

/**
 * The name to print for a risk band.
 *
 * WHY THIS IS NOT `RISK_LEVEL_LABELS[level]`. That map is the *shipped* ladder — «Түвшин 1»
 * through «Түвшин 5» — and section 16.1 makes the ladder configuration: an administrator
 * may rename a band or name one of the spares. Reading the compiled map prints the name the
 * build was made with, not the name the installation uses.
 *
 * The visible symptom was a printed inspection report disagreeing with itself on one page:
 * the conclusion block resolved the administrator's wording through `overallSafetyLabelOf`
 * while the sub-task and зөрчил tables under it still printed «Түвшин 6» from the compiled
 * map. Same document, two vocabularies, and only the tables were wrong.
 *
 * WHY THE FALLBACK. A band with no configured wording — blank, or absent from the
 * configuration entirely — keeps the shipped name, so an installation that has never opened
 * the settings screen renders exactly as before. This is deliberately simpler than
 * `overallSafetyLabelOf`, which arbitrates between two *different* vocabularies (the
 * verdict wording and the band wording) and so has to detect whether a label was actually
 * changed. Here there is only one vocabulary: the band's name. The configured name is the
 * band's name whenever there is one.
 */
export function riskBandLabelOf(level: RiskLevel, bands?: readonly RiskBand[] | null): string {
  const configured = bands?.find((band) => band.level === level)?.labelMn.trim() ?? '';
  return configured.length > 0 ? configured : RISK_LEVEL_LABELS[level];
}
