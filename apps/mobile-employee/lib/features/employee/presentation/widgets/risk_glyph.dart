import 'package:flutter/material.dart';

import '../../project/domain/entities/risk_level.dart';
import '../theme/employee_tokens.dart';

/// The band silhouette that travels with every risk indicator.
///
/// Colour alone cannot carry the band: a technician reads this on a job site in
/// direct sunlight, one in twelve of them is colour-blind, and the inspection sheet
/// this app mirrors is printed in greyscale. So each band also has a distinct shape,
/// and the escalation reads closed → draining → turned → hazard → stopped:
///
/// | Band | Shape |
/// |---|---|
/// | NORMAL | filled circle |
/// | ATTENTION | half-filled circle |
/// | SCHEDULE_REPAIR | filled diamond |
/// | CRITICAL | filled triangle |
/// | OUT_OF_SERVICE | filled square |
/// | _unassessed_ | hollow thin-outline circle |
/// | BAND_6 / 7 / 8 | filled hexagon |
///
/// Drawn with a [CustomPainter] rather than as a Unicode character (◆ ▲ ◼ …): a text
/// glyph depends on system font coverage, renders at a different optical weight on
/// every platform, and falls back to a tofu box when the face is missing. A painted
/// path is the same 8–14px mark everywhere.
///
/// The mark is decorative to a screen reader — the [Semantics] label belongs to the
/// indicator that contains it, which knows the full band name and the count or score
/// beside it.
class RiskGlyph extends StatelessWidget {
  const RiskGlyph({super.key, required this.level, this.size = 10, this.color});

  /// Null is the unassessed state, and is drawn as an absence of data (a hollow
  /// outline) rather than as a low score.
  final RiskLevel? level;

  /// The glyph's edge. Legible from 8 to 14; below 8 the half-circle stops reading.
  final double size;

  /// Overrides the band's own `fg`, for a glyph sitting on a band-filled chip.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RiskGlyphPainter(
          level: level,
          color: color ?? riskTone(level).foreground,
        ),
        isComplex: false,
      ),
    );
  }
}

class _RiskGlyphPainter extends CustomPainter {
  const _RiskGlyphPainter({required this.level, required this.color});

  final RiskLevel? level;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final double edge = size.shortestSide;
    final Offset centre = Offset(size.width / 2, size.height / 2);

    final Paint fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    switch (level) {
      case null:
        // Absence of data: a hollow ring, thin enough that it never reads as a
        // filled NORMAL circle even at 8px.
        final Paint stroke = Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = edge * 0.12
          ..isAntiAlias = true;
        canvas.drawCircle(centre, (edge - stroke.strokeWidth) / 2, stroke);

      case RiskLevel.normal:
        canvas.drawCircle(centre, edge / 2, fill);

      case RiskLevel.attention:
        // The same circle, drained from the bottom: outlined whole, filled top half.
        // "Slipping", not "different".
        final Paint stroke = Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = edge * 0.12
          ..isAntiAlias = true;
        final double radius = (edge - stroke.strokeWidth) / 2;
        canvas.drawCircle(centre, radius, stroke);
        canvas.drawArc(
          Rect.fromCircle(center: centre, radius: radius),
          3.141592653589793, // due west
          3.141592653589793, // sweep the upper half
          true,
          fill,
        );

      case RiskLevel.scheduleRepair:
        // A diamond, deliberately not a mirrored half-circle: at 10px a mirrored
        // form is indistinguishable from ATTENTION, which is the exact confusion
        // this whole system exists to prevent.
        canvas.drawPath(
          Path()
            ..moveTo(centre.dx, centre.dy - edge / 2)
            ..lineTo(centre.dx + edge / 2, centre.dy)
            ..lineTo(centre.dx, centre.dy + edge / 2)
            ..lineTo(centre.dx - edge / 2, centre.dy)
            ..close(),
          fill,
        );

      case RiskLevel.critical:
        // The universal hazard triangle, optically centred: a geometric centroid
        // sits too low against a circle of the same edge.
        final double inset = edge * 0.06;
        canvas.drawPath(
          Path()
            ..moveTo(centre.dx, centre.dy - edge / 2 + inset)
            ..lineTo(centre.dx + edge / 2, centre.dy + edge / 2 - inset)
            ..lineTo(centre.dx - edge / 2, centre.dy + edge / 2 - inset)
            ..close(),
          fill,
        );

      case RiskLevel.outOfService:
        // Terminal. A square reads as "stopped" where a circle reads as "running".
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(center: centre, width: edge, height: edge),
            Radius.circular(edge * 0.08),
          ),
          fill,
        );

      case RiskLevel.band6:
      case RiskLevel.band7:
      case RiskLevel.band8:
        // A generated mark, not a designed one, and that is the honest thing to draw.
        //
        // The five shapes above are a vocabulary: circle → drained circle → diamond →
        // triangle → square spells out an escalation, and each was chosen against the
        // others so the pair a colour-blind reader cannot separate by hue is still
        // separable by outline. A reserved band has no place on that ladder — an
        // administrator decides where it sits and what it means — so there is no
        // position for a sixth shape to encode and nothing for this file to claim.
        //
        // A filled hexagon is what is left: solid like the graded bands rather than
        // hollow like the unassessed ring, six-sided so it is not the diamond and not
        // the square, and still one recognisable silhouette at 8px. For a configured
        // band the meaning is carried by its colour and its name, which come from the
        // administrator; the five documented bands keep the shapes drawn for them.
        canvas.drawPath(_hexagon(centre, edge / 2), fill);
    }
  }

  /// A pointy-top regular hexagon. The literals are cos/sin of the six vertices at
  /// 60° steps from due north, written out for the same reason the triangle's are:
  /// the geometry is fixed and reads clearer than the arithmetic that produces it.
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

  @override
  bool shouldRepaint(_RiskGlyphPainter oldDelegate) =>
      oldDelegate.level != level || oldDelegate.color != color;
}

/// A glyph over the band's tint — the swatch a legend and a count chip carry.
class RiskSwatch extends StatelessWidget {
  const RiskSwatch({super.key, required this.level, this.size = 18});

  final RiskLevel? level;
  final double size;

  @override
  Widget build(BuildContext context) {
    final Tone tone = riskTone(level);

    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(size * 0.28),
        border: Border.all(color: tone.border),
      ),
      child: RiskGlyph(level: level, size: size * 0.55),
    );
  }
}
