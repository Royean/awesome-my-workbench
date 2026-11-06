// 知衡 v1 主题 —— 可直接放入 lib/theme/zhiheng_theme.dart
import 'package:flutter/material.dart';

class ZhColors {
  static const ink = Color(0xFF263E39);
  static const green = Color(0xFF287360);
  static const greenContainer = Color(0xFFCFE8DE);
  static const bg = Color(0xFFF5F6F3);
  static const card = Color(0xFFFFFFFF);
  static const hint = Color(0xFF5F6F68);
  static const line = Color(0xFFE7ECE8);
  static const outline = Color(0xFF8A9A93);
  static const error = Color(0xFF9F4C3A);
  static const errorContainer = Color(0xFFF6E1DA);
  static const warn = Color(0xFF7A5212);
  static const warnContainer = Color(0xFFFBF0DC);
}

class ZhSpace { static const xs = 4.0, s = 8.0, m = 12.0, l = 16.0, xl = 24.0, xxl = 32.0; static const minTouch = 48.0; }
class ZhRadius { static const field = 4.0, chip = 8.0, banner = 12.0, card = 16.0, sheet = 28.0; }

ThemeData zhihengTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: ZhColors.green, onPrimary: Colors.white,
    primaryContainer: ZhColors.greenContainer, onPrimaryContainer: ZhColors.ink,
    secondary: ZhColors.hint, onSecondary: Colors.white,
    secondaryContainer: ZhColors.greenContainer, onSecondaryContainer: ZhColors.ink,
    tertiary: ZhColors.warn, onTertiary: Colors.white,
    tertiaryContainer: ZhColors.warnContainer, onTertiaryContainer: ZhColors.warn,
    error: ZhColors.error, onError: Colors.white,
    errorContainer: ZhColors.errorContainer, onErrorContainer: ZhColors.error,
    surface: ZhColors.bg, onSurface: ZhColors.ink, onSurfaceVariant: ZhColors.hint,
    surfaceContainerLowest: ZhColors.card, surfaceContainerLow: ZhColors.card,
    surfaceContainer: Color(0xFFEEF1EC), surfaceContainerHigh: Color(0xFFF3F6F2),
    outline: ZhColors.outline, outlineVariant: ZhColors.line,
  );
  const text = TextTheme(
    headlineMedium: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
    titleLarge: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
    titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
    bodyLarge: TextStyle(fontSize: 16, height: 1.5),
    bodyMedium: TextStyle(fontSize: 14, height: 1.5),
    labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
    labelMedium: TextStyle(fontSize: 12),
    bodySmall: TextStyle(fontSize: 12), // 最小字号，勿低于 12
  );
  return ThemeData(
    useMaterial3: true, colorScheme: scheme, scaffoldBackgroundColor: ZhColors.bg,
    textTheme: text.apply(bodyColor: ZhColors.ink, displayColor: ZhColors.ink),
    materialTapTargetSize: MaterialTapTargetSize.padded,
    appBarTheme: const AppBarTheme(backgroundColor: ZhColors.bg, foregroundColor: ZhColors.ink, elevation: 0, scrolledUnderElevation: 2, toolbarHeight: 64),
    cardTheme: const CardThemeData(color: ZhColors.card, elevation: 0, margin: EdgeInsets.only(bottom: ZhSpace.m), shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(ZhRadius.card)))),
    navigationBarTheme: NavigationBarThemeData(height: 80, indicatorColor: ZhColors.greenContainer,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, color: s.contains(WidgetState.selected) ? ZhColors.ink : ZhColors.hint, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w400))),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(backgroundColor: ZhColors.green, foregroundColor: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(ZhRadius.card)))),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(minimumSize: const Size(48, 48))),
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(ZhRadius.field))), filled: true, fillColor: ZhColors.card, helperStyle: TextStyle(fontSize: 12, color: ZhColors.hint), errorStyle: TextStyle(fontSize: 12, color: ZhColors.error)),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: ZhColors.card, showDragHandle: true, shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(ZhRadius.sheet)))),
    dialogTheme: const DialogThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(ZhRadius.sheet)))),
    chipTheme: const ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(ZhRadius.chip)))),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {TargetPlatform.android: PredictiveBackPageTransitionsBuilder()}),
  );
}
