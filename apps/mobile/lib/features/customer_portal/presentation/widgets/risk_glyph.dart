import 'package:flutter/material.dart';

import '../../domain/entities/risk_level.dart';
import '../theme/customer_tokens.dart';

/// The band silhouette, drawn rather than typed.
///
/// Every band carries a distinct shape so risk survives colour-blindness, greyscale
/// printing and direct sunlight on a job site. Painted with a [CustomPainter] and
/// never as a Unicode character, which would depend on system font coverage:
///
///   * `NORMAL` - filled circle. Calm, closed, complete.
///   * `ATTENTION` - half-filled circle. The same circle, partly drained.
///   * `SCHEDULE_REPAIR` - filled diamond. A distinct silhouette, deliberately not a
///     mirrored half-circle.
///   * `CRITICAL` - filled triangle. The universal hazard shape.
///   * `OUT_OF_SERVICE` - filled square. Terminal, blocked, stopped.
///   * `unassessed` (null) - hollow thin-outline circle. The absence of data, not a
///     low score.
///   * `BAND_6` / `BAND_7` / `BAND_8` - filled hexagon. A generated mark for a band an
///     administrator configured; see the painter.
///
/// Escalation reads as: closed -> draining -> turned -> hazard -> stopped.
class RiskGlyph extends StatelessWidget {
  const RiskGlyph({super.key, required this.level, this.size = 12, this.label});

  /// Nullable: null is the `unassessed` display state, not a band.
  final RiskLevel? level;

  /// The edge of the square the glyph is painted into. Legible from 8 to 14.
  final double size;

  /// Overrides the announced text. Defaults to the full band name, so a screen
  /// reader announces meaning rather than a colour.
  final String? label;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label ?? level?.label ?? unassessedLabel,
      child: SizedBox(
        width: size,
        height: size,
        child: CustomPaint(
          painter: RiskGlyphPainter(
            level: level,
            colour: level?.tone.foreground ?? CustomerTokens.muted,
          ),
        ),
      ),
    );
  }
}

/// Paints one [RiskLevel] silhouette into the given square.
@visibleForTesting
class RiskGlyphPainter extends CustomPainter {
  const RiskGlyphPainter({required this.level, required this.colour});

  final RiskLevel? level;
  final Color colour;

  @override
  void paint(Canvas canvas, Size size) {
    // Square the box and centre it, so a non-square constraint cannot skew a shape
    // whose whole job is to be recognised by its outline.
    final double edge = size.shortestSide;
    final Offset centre = Offset(size.width / 2, size.height / 2);
    final double radius = edge / 2;

    final Paint fill = Paint()
      ..color = colour
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    switch (level) {
      case RiskLevel.normal:
        canvas.drawCircle(centre, radius, fill);

      case RiskLevel.attention:
        // The same circle, drained from the top: the lower half is solid, the whole
        // outline stays drawn so the shape still reads as a circle at 8px.
        final Rect box = Rect.fromCircle(center: centre, radius: radius);
        // startAngle 0 is 3 o'clock, sweeping clockwise, so 0 -> pi is the bottom.
        canvas.drawArc(box, 0, 3.14159265, true, fill);
        canvas.drawCircle(
          centre,
          radius - _stroke(edge) / 2,
          Paint()
            ..color = colour
            ..style = PaintingStyle.stroke
            ..strokeWidth = _stroke(edge)
            ..isAntiAlias = true,
        );

      case RiskLevel.scheduleRepair:
        canvas.drawPath(
          Path()
            ..moveTo(centre.dx, centre.dy - radius)
            ..lineTo(centre.dx + radius, centre.dy)
            ..lineTo(centre.dx, centre.dy + radius)
            ..lineTo(centre.dx - radius, centre.dy)
            ..close(),
          fill,
        );

      case RiskLevel.critical:
        // Sat on the same optical centre as the circle: an equilateral triangle
        // inscribed in the square reads as floating otherwise.
        canvas.drawPath(
          Path()
            ..moveTo(centre.dx, centre.dy - radius)
            ..lineTo(centre.dx + radius, centre.dy + radius * 0.86)
            ..lineTo(centre.dx - radius, centre.dy + radius * 0.86)
            ..close(),
          fill,
        );

      case RiskLevel.outOfService:
        // Slightly inset so a square does not out-weigh the circle beside it.
        final double half = radius * 0.88;
        canvas.drawRect(
          Rect.fromCenter(center: centre, width: half * 2, height: half * 2),
          fill,
        );

      case null:
        canvas.drawCircle(
          centre,
          radius - _stroke(edge) / 2,
          Paint()
            ..color = colour
            ..style = PaintingStyle.stroke
            ..strokeWidth = _stroke(edge)
            ..isAntiAlias = true,
        );

      case RiskLevel.band6:
      case RiskLevel.band7:
      case RiskLevel.band8:
        // A generated mark, not a designed one, and that is the honest thing to draw.
        //
        // The five shapes above are a vocabulary: circle -> drained circle -> diamond
        // -> triangle -> square spells out an escalation, and each was chosen against
        // the others so the pair a colour-blind reader cannot separate by hue is still
        // separable by outline. A reserved band has no place on that ladder - an
        // administrator decides where it sits and what it means - so there is no
        // position for a sixth shape to encode and nothing for this file to claim.
        //
        // A filled hexagon is what is left: solid like the graded bands rather than
        // hollow like the unassessed ring, six-sided so it is neither the diamond nor
        // the square, and still one recognisable silhouette at 8px. For a configured
        // band the meaning is carried by its colour and its name, both of which come
        // from the administrator; the five documented bands keep the shapes drawn for
        // them.
        canvas.drawPath(_hexagon(centre, radius), fill);
    }
  }

  /// A pointy-top regular hexagon. The literals are cos/sin of the six vertices at 60
  /// degree steps from due north, written out for the same reason the triangle's are:
  /// the geometry is fixed and reads clearer than the arithmetic behind it.
  static Path _hexagon(Offset centre, double radius) {
    final double wide = radius * 0.866;
    final double tall = radius * 0.5;
    return Path()
      ..moveTo(centre.dx, centre.dy - radius)
      ..lineTo(centre.dx + wide, centre.dy - tall)
      ..lineTo(centre.dx + wide, centre.dy + tall)
      ..lineTo(centre.dx, centre.dy + radius)
      ..lineTo(centre.dx - wide, centre.dy + tall)
      ..lineTo(centre.dx - wide, centre.dy - tall)
      ..close();
  }

  /// A hairline that stays visible at 8px and does not become a blob at 14px.
  static double _stroke(double edge) => (edge / 9).clamp(1.0, 1.6);

  @override
  bool shouldRepaint(RiskGlyphPainter oldDelegate) =>
      oldDelegate.level != level || oldDelegate.colour != colour;
}
