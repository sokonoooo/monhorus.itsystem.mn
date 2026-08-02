import 'package:flutter/material.dart';

import '../../features/employee/presentation/theme/employee_tokens.dart';

/// Single source of visual truth for the Material layer.
///
/// Everything here is [EmployeeTokens]. This file used to carry its own Tailwind
/// slate palette — `#F1F5F9`, `#CBD5E1`, `#E2E8F0`, `#0F172A` — which meant the auth
/// screens and the shell were two different products wearing the same name. There is
/// one palette; core reads it from the token file rather than restating it, because a
/// second copy of a colour table is exactly the defect this pass exists to remove.
class AppTheme {
  const AppTheme._();

  /// **Never painted directly.** It is the seed `ColorScheme.fromSeed` derives
  /// Material's own focus, selection and ripple affordances from. The colour actually
  /// painted on primary controls, chips, the FAB and the progress indicator is
  /// [EmployeeTokens.accent], a distinct, deliberately-chosen brand colour.
  static const Color primary = EmployeeTokens.materialSeed;

  static const Color danger = EmployeeTokens.red;
  static const Color warning = EmployeeTokens.yellow;
  static const Color success = EmployeeTokens.green;
  static const Color surface = EmployeeTokens.bg;

  static ThemeData get light {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: primary,
      brightness: Brightness.light,
    ).copyWith(
      surface: EmployeeTokens.white,
      onSurface: EmployeeTokens.ink,
      error: EmployeeTokens.red,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: surface,
      appBarTheme: const AppBarTheme(
        backgroundColor: EmployeeTokens.white,
        foregroundColor: EmployeeTokens.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: EmployeeTokens.headerTitle,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: EmployeeTokens.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: EmployeeTokens.gutter,
          vertical: EmployeeTokens.labelGutter,
        ),
        hintStyle: EmployeeTokens.body.copyWith(color: EmployeeTokens.muted),
        helperStyle: EmployeeTokens.rowSub,
        errorStyle: EmployeeTokens.rowSub.copyWith(color: EmployeeTokens.red),
        border: _fieldBorder(EmployeeTokens.line),
        enabledBorder: _fieldBorder(EmployeeTokens.line),
        // Ink, not the accent: the focus ring stays neutral so the brand colour
        // reads as "action" (buttons, active tab, links) and never as "you're
        // typing here" — the same split the customer app makes.
        focusedBorder: _fieldBorder(EmployeeTokens.ink),
        errorBorder: _fieldBorder(EmployeeTokens.red),
        focusedErrorBorder: _fieldBorder(EmployeeTokens.red),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: EmployeeTokens.accent,
          foregroundColor: EmployeeTokens.white,
          disabledBackgroundColor: EmployeeTokens.soft,
          disabledForegroundColor: EmployeeTokens.muted,
          minimumSize: const Size.fromHeight(52),
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          ),
          textStyle: EmployeeTokens.buttonLabel,
        ).copyWith(
          overlayColor: const WidgetStatePropertyAll<Color>(
            EmployeeTokens.accentPressed,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: EmployeeTokens.ink,
          minimumSize: const Size.fromHeight(46),
          side: const BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          ),
          textStyle: EmployeeTokens.rowTitle,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: EmployeeTokens.accent,
          textStyle: EmployeeTokens.rowTitle,
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: EmployeeTokens.faint,
        thickness: EmployeeTokens.hairline,
        space: EmployeeTokens.hairline,
      ),
      cardTheme: CardThemeData(
        color: EmployeeTokens.white,
        surfaceTintColor: Colors.transparent,
        shadowColor: EmployeeTokens.shadowTint,
        elevation: 1,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
          side: const BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: EmployeeTokens.white,
        surfaceTintColor: Colors.transparent,
        shadowColor: EmployeeTokens.shadowTint,
        elevation: 3,
        titleTextStyle: EmployeeTokens.cardTitle,
        contentTextStyle: EmployeeTokens.body,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
          side: const BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: EmployeeTokens.white,
        surfaceTintColor: Colors.transparent,
        shadowColor: EmployeeTokens.shadowTint,
        elevation: 4,
        modalElevation: 4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(EmployeeTokens.radiusSheet),
          ),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: EmployeeTokens.white,
        selectedColor: EmployeeTokens.accent,
        side: const BorderSide(
          color: EmployeeTokens.line,
          width: EmployeeTokens.hairline,
        ),
        labelStyle: EmployeeTokens.rowTitle,
        secondaryLabelStyle: EmployeeTokens.rowTitle.copyWith(
          color: EmployeeTokens.white,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusPill),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: EmployeeTokens.ink,
        contentTextStyle: EmployeeTokens.rowTitle.copyWith(
          color: EmployeeTokens.white,
        ),
        behavior: SnackBarBehavior.floating,
        elevation: 0,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: EmployeeTokens.accent,
        foregroundColor: EmployeeTokens.white,
        elevation: 2,
        focusElevation: 2,
        hoverElevation: 3,
        highlightElevation: 4,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: EmployeeTokens.accent,
        linearTrackColor: EmployeeTokens.soft,
        circularTrackColor: Colors.transparent,
      ),
    );
  }

  static OutlineInputBorder _fieldBorder(Color color) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        borderSide: BorderSide(color: color, width: EmployeeTokens.hairline),
      );
}
