import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';

/// The box a plan occupies while its bytes are in flight, and the ceiling a very tall
/// plan is allowed to grow to. The first matches the fixed height every image on this
/// screen used before intrinsic sizing existed, so the card does not jump as it loads.
const double _planPlaceholderHeight = 210;
const double _planMaxHeight = 460;

/// The floor is drawn at "fits the card" and may not be shrunk below it.
///
/// The web canvas takes the same position for the same reason: a plan smaller than its
/// own frame is a drawing floating in empty space, and there is nothing a reader can do
/// with it that the fitted view does not already show. Zoom only ever goes up from here.
const double kPlanMinScale = 1;

/// The ceiling on magnification.
///
/// Five is roughly the point at which a phone-width plan stops gaining detail: the
/// source drawings are a few hundred pixels tall and the image is already being
/// upscaled well before this, so a higher cap would only let a reader zoom into
/// interpolation. It is comfortably enough to separate two markers that overlap when
/// the whole floor is in view, which is the crowding the zoom exists to solve.
const double kPlanMaxScale = 5;

/// Renders a stored file that lives behind `GET /files/:fileId`.
///
/// That endpoint returns raw bytes and still requires the Bearer header, so the
/// `downloadUrl` on an attachment or floor plan cannot be handed to
/// `Image.network`; the bytes are fetched through the authenticated Dio client and
/// decoded from memory instead.
class AuthenticatedImage extends ConsumerWidget {
  /// A fixed-height box with the picture letterboxed inside it. Every caller that
  /// only shows a picture uses this.
  const AuthenticatedImage({
    super.key,
    required this.fileId,
    this.height,
    this.fit = BoxFit.contain,
  })  : sizeToImage = false,
        overlay = null,
        zoomable = false;

  /// A box that takes the image's own aspect ratio, with [overlay] laid over exactly
  /// the painted picture.
  ///
  /// Opt-in, and used by the floor plan alone. The default constructor letterboxes
  /// the picture inside a fixed-height box, so the painted rectangle is *smaller*
  /// than the widget's - anything positioned from a fraction of the widget would land
  /// off the drawing by the size of the letterbox bars. Sizing the box from the
  /// image's intrinsic dimensions makes the two rectangles the same rectangle, and a
  /// marker at `x, y` then needs no letterbox arithmetic to be correct.
  const AuthenticatedImage.sizedToImage({
    super.key,
    required this.fileId,
    this.overlay,
    this.zoomable = false,
  })  : sizeToImage = true,
        height = null,
        fit = BoxFit.contain;

  final String fileId;
  final double? height;
  final BoxFit fit;

  /// True only for [AuthenticatedImage.sizedToImage].
  final bool sizeToImage;

  /// Stacked over the painted image, given exactly its rectangle. Null draws nothing.
  final Widget? overlay;

  /// Whether the picture and its [overlay] can be pinched and dragged.
  ///
  /// Opt-in, and off by default, because a zoom is not free on a surface that also
  /// takes taps: a pinch and a drag are gestures the surrounding page and any tap
  /// handler on the overlay have to share. It is turned on for the floor plan a reader
  /// only looks at, and left OFF for the plan in the request sheet, whose whole overlay
  /// is a tap target that drops a pin — a pan that ended in a tap there would record
  /// the fault wherever the reader happened to stop dragging.
  final bool zoomable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Uint8List> bytes = ref.watch(fileBytesProvider(fileId));

    return bytes.when(
      data: (Uint8List data) => sizeToImage
          ? _IntrinsicallySizedImage(
              bytes: data,
              overlay: overlay,
              zoomable: zoomable,
            )
          : SizedBox(
              height: height,
              width: double.infinity,
              child: Image.memory(
                data,
                fit: fit,
                errorBuilder: (_, __, ___) =>
                    const _ImageNotice(text: 'Зургийг уншиж чадсангүй.'),
              ),
            ),
      loading: () => SizedBox(
        height: height ?? (sizeToImage ? _planPlaceholderHeight : null),
        width: double.infinity,
        child: const Center(child: CircularProgressIndicator()),
      ),
      error: (Object error, StackTrace _) => SizedBox(
        height: height ?? (sizeToImage ? _planPlaceholderHeight : null),
        width: double.infinity,
        child: _ImageNotice(
          text: error is Failure ? error.message : 'Зураг татаж чадсангүй.',
        ),
      ),
    );
  }
}

/// Sizes itself to the decoded image's aspect ratio and stacks [overlay] on top.
///
/// The intrinsic size is read from the bytes already in hand rather than by asking the
/// server again, and through the same [MemoryImage] the picture is then painted from,
/// so the plan is decoded once and not twice.
class _IntrinsicallySizedImage extends StatefulWidget {
  const _IntrinsicallySizedImage({
    required this.bytes,
    this.overlay,
    this.zoomable = false,
  });

  final Uint8List bytes;
  final Widget? overlay;
  final bool zoomable;

  @override
  State<_IntrinsicallySizedImage> createState() => _IntrinsicallySizedImageState();
}

class _IntrinsicallySizedImageState extends State<_IntrinsicallySizedImage> {
  late MemoryImage _provider;
  ImageStream? _stream;
  ImageStreamListener? _listener;
  Size? _size;
  bool _failed = false;

  /// The pan-and-zoom transform, owned here so a rebuild of the screen above does not
  /// throw away a magnification the reader chose.
  final TransformationController _transform = TransformationController();

  /// True while [_listen] is running. The decoded image is often already in the cache,
  /// in which case the listener fires synchronously - inside `initState`, where
  /// `setState` would be a `markNeedsBuild` during a build. The value is simply
  /// assigned then; the build that follows picks it up.
  bool _listening = false;

  @override
  void initState() {
    super.initState();
    _listen();
  }

  @override
  void didUpdateWidget(_IntrinsicallySizedImage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.bytes, widget.bytes)) {
      _detach();
      _size = null;
      _failed = false;
      // A different drawing at a different shape: a transform chosen against the old
      // one names a place on a picture that is no longer there.
      _transform.value = Matrix4.identity();
      _listen();
    }
  }

  @override
  void dispose() {
    _detach();
    _transform.dispose();
    super.dispose();
  }

  void _detach() {
    final ImageStreamListener? listener = _listener;
    if (listener != null) _stream?.removeListener(listener);
    _stream = null;
    _listener = null;
  }

  void _listen() {
    _listening = true;
    _provider = MemoryImage(widget.bytes);
    final ImageStream stream = _provider.resolve(ImageConfiguration.empty);
    final ImageStreamListener listener = ImageStreamListener(
      (ImageInfo info, bool _) {
        final Size size = Size(
          info.image.width.toDouble(),
          info.image.height.toDouble(),
        );
        if (_listening) {
          _size = size;
          return;
        }
        if (mounted) setState(() => _size = size);
      },
      // A plan the decoder cannot read must cost the markers, never the screen.
      onError: (Object error, StackTrace? _) {
        if (_listening) {
          _failed = true;
          return;
        }
        if (mounted) setState(() => _failed = true);
      },
    );
    stream.addListener(listener);
    _stream = stream;
    _listener = listener;
    _listening = false;
  }

  @override
  Widget build(BuildContext context) {
    final Size? size = _size;

    if (_failed || (size != null && (size.width <= 0 || size.height <= 0))) {
      return const SizedBox(
        height: _planPlaceholderHeight,
        width: double.infinity,
        child: _ImageNotice(text: 'Зургийг уншиж чадсангүй.'),
      );
    }

    if (size == null) {
      return const SizedBox(
        height: _planPlaceholderHeight,
        width: double.infinity,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    // The picture and anything laid over it, as one unit. Everything below zooms this
    // whole stack rather than the image alone, which is what makes the magnified
    // markers land on the magnified drawing without a line of arithmetic: the overlay
    // is still measured against a box that is exactly the picture, and the transform
    // that grows the picture grows the overlay through the same matrix.
    final Widget plan = Stack(
      fit: StackFit.expand,
      children: <Widget>[
        Image(
          image: _provider,
          // Fill, not contain: the box is already the image's own ratio, and
          // `contain` would re-letterbox it by whatever the rounding left over.
          fit: BoxFit.fill,
          // Magnified pixels rather than a blur. A floor plan is line work, and the
          // reader zooms in to follow a line to a marker; smoothing it away is worse
          // than showing the pixels it is actually made of.
          filterQuality: FilterQuality.medium,
          errorBuilder: (_, __, ___) =>
              const _ImageNotice(text: 'Зургийг уншиж чадсангүй.'),
        ),
        if (widget.overlay != null) widget.overlay!,
      ],
    );

    // Centred, and through a loosened constraint: a portrait plan would otherwise be
    // stretched to the full width of a list that hands its children a tight one.
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: _planMaxHeight),
        child: AspectRatio(
          aspectRatio: size.width / size.height,
          child: widget.zoomable
              ? InteractiveViewer(
                  transformationController: _transform,
                  minScale: kPlanMinScale,
                  maxScale: kPlanMaxScale,
                  // Zero, so the drawing can never be dragged off its own frame and
                  // parked against a corner: at rest it exactly fills the box, and at
                  // any magnification the clamp keeps some of it under every edge.
                  boundaryMargin: EdgeInsets.zero,
                  // Without this a magnified plan paints over the caption below it and
                  // over the card's own rounded edge.
                  clipBehavior: Clip.hardEdge,
                  child: plan,
                )
              : plan,
        ),
      ),
    );
  }
}

class _ImageNotice extends StatelessWidget {
  const _ImageNotice({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      padding: const EdgeInsets.all(16),
      color: CustomerTokens.soft2,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.image_not_supported_outlined,
              size: 28, color: CustomerTokens.line),
          const SizedBox(height: 8),
          Text(
            text,
            textAlign: TextAlign.center,
            style: CustomerTokens.rowSub,
          ),
        ],
      ),
    );
  }
}
