import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../domain/entities/work_enums.dart';

/// The Нүүр tab's own additions to the shared token set.
///
/// `AccentTone` used to live here — the same `{foreground, background, border}`
/// triad the Төсөл tab declared again as `ProjectTone`. Both are gone; there is one
/// [Tone] class, in the token file. What is left here is genuinely home-only: the
/// four pastel icon tiles on the mini cards, and the mapping from a severity band to
/// a triad.
class HomeTokens {
  const HomeTokens._();

  // -- The four pastel icon tiles on the mini cards ---------------------------

  static const Color orange = Color(0xFFE09B1B);
  static const Color orangeBg = Color(0xFFFFF2DF);

  static const Color mint = Color(0xFF16A36A);
  static const Color mintBg = Color(0xFFDFF7EF);

  static const Color pink = Color(0xFFEF4565);
  static const Color pinkBg = Color(0xFFFFE7EC);

  static const Tone tileOrange = Tone(
    foreground: orange,
    background: orangeBg,
    border: orangeBg,
  );

  static const Tone tileMint = Tone(
    foreground: mint,
    background: mintBg,
    border: mintBg,
  );

  static const Tone tilePink = Tone(
    foreground: pink,
    background: pinkBg,
    border: pinkBg,
  );

  /// The fourth tile: the prototype overrides its "purple" to white on ink.
  static const Tone tilePlain = Tone(
    foreground: EmployeeTokens.ink,
    background: EmployeeTokens.white,
    border: EmployeeTokens.faint,
  );

  // `cardBorder` and `cardShadow` lived here. The shadow made the home tab the only
  // surface in the app that was not flat, and the border was a lighter grey than
  // every other card's. Both are gone: a home card is now the same white fill,
  // 1.5px `line` hairline and no shadow as a card anywhere else.

  // `mono` lived here too, and again as `monoStyle` in two feature files. It is
  // `EmployeeTokens.mono` now.
}

/// The triad a notification or request severity is drawn in.
///
/// Severity is not risk: these bands are the SLA/notification vocabulary and only
/// borrow the neutral green/yellow/red status colours, never the five-band risk
/// palette, which is reserved for `RiskLevel`.
Tone severityTone(SeverityBand band) {
  return switch (band) {
    SeverityBand.green => Tone.green,
    SeverityBand.yellow => Tone.yellow,
    SeverityBand.red => Tone.red,
    SeverityBand.ink => Tone.ink,
    SeverityBand.neutral => Tone.neutral,
  };
}
