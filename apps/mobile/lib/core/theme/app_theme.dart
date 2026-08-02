import 'package:flutter/material.dart';

import '../../features/customer_portal/presentation/theme/customer_tokens.dart';

/// A thin `ThemeData` layered over [CustomerTokens].
///
/// The tokens are the single source of truth; this class exists only so Material's
/// own widgets - inputs, buttons, cards, app bars - agree with them instead of
/// contradicting them. It introduces no colour, size or radius of its own.
///
/// `CustomerTokens.materialSeed` seeds [ColorScheme.fromSeed] so Material's focus,
/// selection and cursor affordances stay sane; the colour actually painted on
/// primary controls, chips, the FAB and the progress indicator is
/// `CustomerTokens.accent`, a distinct, deliberately-chosen brand colour.
class AppTheme {
  const AppTheme._();

  static ThemeData get light {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: CustomerTokens.materialSeed,
      brightness: Brightness.light,
    ).copyWith(
      surface: CustomerTokens.white,
      onSurface: CustomerTokens.ink,
      error: CustomerTokens.red,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: CustomerTokens.bg,
      canvasColor: CustomerTokens.white,
      dividerTheme: const DividerThemeData(
        color: CustomerTokens.faint,
        thickness: CustomerTokens.hairline,
        space: CustomerTokens.hairline,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: CustomerTokens.bg,
        foregroundColor: CustomerTokens.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: CustomerTokens.headerTitle,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: CustomerTokens.white,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: CustomerTokens.gutter,
          vertical: CustomerTokens.labelGutter,
        ),
        hintStyle: CustomerTokens.rowSub,
        helperStyle: CustomerTokens.rowSub,
        errorStyle: CustomerTokens.rowSub.copyWith(color: CustomerTokens.red),
        border: _inputBorder(CustomerTokens.line),
        enabledBorder: _inputBorder(CustomerTokens.line),
        disabledBorder: _inputBorder(CustomerTokens.faint),
        focusedBorder: _inputBorder(CustomerTokens.ink),
        errorBorder: _inputBorder(CustomerTokens.red),
        focusedErrorBorder: _inputBorder(CustomerTokens.red),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: CustomerTokens.accent,
          foregroundColor: CustomerTokens.white,
          disabledBackgroundColor: CustomerTokens.soft,
          disabledForegroundColor: CustomerTokens.muted,
          elevation: 0,
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
          ),
          textStyle: CustomerTokens.cardTitle,
        ).copyWith(
          // A flat surface has no elevation to lift on press, so the pressed state
          // is the one the palette names for it.
          overlayColor: const WidgetStatePropertyAll<Color>(
            CustomerTokens.accentPressed,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: CustomerTokens.ink,
          minimumSize: const Size.fromHeight(46),
          side: CustomerTokens.hairlineSide,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
          ),
          textStyle: CustomerTokens.rowTitle,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: CustomerTokens.accent,
          textStyle: CustomerTokens.rowTitle,
        ),
      ),
      cardTheme: CardThemeData(
        color: CustomerTokens.white,
        surfaceTintColor: Colors.transparent,
        shadowColor: CustomerTokens.shadowTint,
        elevation: 1,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CustomerTokens.radiusCard),
          side: CustomerTokens.hairlineSide,
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: CustomerTokens.white,
        surfaceTintColor: Colors.transparent,
        shadowColor: CustomerTokens.shadowTint,
        elevation: 3,
        titleTextStyle: CustomerTokens.cardTitle,
        contentTextStyle: CustomerTokens.body,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CustomerTokens.radiusCard),
          side: CustomerTokens.hairlineSide,
        ),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: CustomerTokens.white,
        surfaceTintColor: Colors.transparent,
        shadowColor: CustomerTokens.shadowTint,
        elevation: 4,
        modalElevation: 4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(CustomerTokens.radiusSheet),
          ),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: CustomerTokens.white,
        selectedColor: CustomerTokens.accent,
        side: CustomerTokens.hairlineSide,
        labelStyle: CustomerTokens.rowTitle,
        secondaryLabelStyle: CustomerTokens.rowTitle.copyWith(
          color: CustomerTokens.white,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(CustomerTokens.radiusPill),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: CustomerTokens.ink,
        contentTextStyle: CustomerTokens.rowTitle.copyWith(
          color: CustomerTokens.white,
        ),
        behavior: SnackBarBehavior.floating,
        elevation: 0,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: CustomerTokens.accent,
        foregroundColor: CustomerTokens.white,
        elevation: 2,
        focusElevation: 2,
        hoverElevation: 3,
        highlightElevation: 4,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: CustomerTokens.accent,
        linearTrackColor: CustomerTokens.soft,
        circularTrackColor: Colors.transparent,
      ),
    );
  }

  static OutlineInputBorder _inputBorder(Color color) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
      borderSide: BorderSide(color: color, width: CustomerTokens.hairline),
    );
  }
}
