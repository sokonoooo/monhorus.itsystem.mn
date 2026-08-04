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
        overlay = null;

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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<Uint8List> bytes = ref.watch(fileBytesProvider(fileId));

    return bytes.when(
      data: (Uint8List data) => sizeToImage
          ? _IntrinsicallySizedImage(bytes: data, overlay: overlay)
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
  const _IntrinsicallySizedImage({required this.bytes, this.overlay});

  final Uint8List bytes;
  final Widget? overlay;

  @override
  State<_IntrinsicallySizedImage> createState() => _IntrinsicallySizedImageState();
}

class _IntrinsicallySizedImageState extends State<_IntrinsicallySizedImage> {
  late MemoryImage _provider;
  ImageStream? _stream;
  ImageStreamListener? _listener;
  Size? _size;
  bool _failed = false;

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
      _listen();
    }
  }

  @override
  void dispose() {
    _detach();
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

    // Centred, and through a loosened constraint: a portrait plan would otherwise be
    // stretched to the full width of a list that hands its children a tight one.
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: _planMaxHeight),
        child: AspectRatio(
          aspectRatio: size.width / size.height,
          child: Stack(
            fit: StackFit.expand,
            children: <Widget>[
              Image(
                image: _provider,
                // Fill, not contain: the box is already the image's own ratio, and
                // `contain` would re-letterbox it by whatever the rounding left over.
                fit: BoxFit.fill,
                errorBuilder: (_, __, ___) =>
                    const _ImageNotice(text: 'Зургийг уншиж чадсангүй.'),
              ),
              if (widget.overlay != null) widget.overlay!,
            ],
          ),
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
