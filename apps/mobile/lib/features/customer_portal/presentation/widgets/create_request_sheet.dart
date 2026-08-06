import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/media/photo_capture.dart';
import '../../../../core/network/api_result.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/models/object_master_model.dart';
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/service_request_enums.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import 'authenticated_image.dart';
import 'blueprint_ui.dart';
import 'customer_ui.dart';
import 'floor_plan_markers.dart';
import 'photo_source_sheet.dart';

/// The prototype's "Дуудлага илгээх" bottom sheet.
///
/// Only reachable when the signed-in account holds a create permission; see
/// [canCreateServiceRequestProvider]. The customer role holds
/// `portal.service_request.create` by default, so a linked customer reaches it.
///
/// [scope] is passed in rather than read here so there is one path into this sheet:
/// the caller has already taken the resolved scope from the session. The id it puts
/// on `customerId` is therefore the session's, never a choice made on this screen -
/// and the server ignores the field for a customer caller in any case.
///
/// One deliberate departure from the prototype, because the API has no such concept
/// and inventing one would be inventing a business rule: the three-level "Яаралтай
/// байдал" chooser becomes a single urgent switch, since `createServiceRequestSchema`
/// has `isUrgent: boolean` and no priority field.
///
/// The five things a request must carry — байршил, төрөл, холбоо барих хүн, тайлбар
/// and a picture — are all collected here, and the picture is REQUIRED:
///
///   * Attaching one is a two-phase flow. `POST /files/service-request-attachments`
///     mints a file id, then the create call names it in `attachmentIds` and the
///     server transfers ownership of the file to the new request. The same shape the
///     employee app uses for assessment evidence, through the same `capturePhoto`.
///   * The requirement is enforced HERE, not in `createServiceRequestSchema`. The
///     admin web create page and every staff flow post through that same schema and
///     send no attachments at all, so making the field mandatory API-side would break
///     them. This sheet is the one flow the rule is about, so this is where it lives.
///   * An upload that is never followed by a submit leaves a file nobody can read —
///     the server parks it on the uploading account, and an unclaimed attachment
///     resolves to no organisation — so abandoning the sheet leaks nothing.
///
/// Location is a building, a floor, and — when that floor has a drawing — an optional
/// point on it. No zone is collected: the Өрөө/Бүс register is the administrator's own
/// and a customer reporting a fault does not think in it, so `planPosition` is the one
/// thing that narrows the location below the floor, and it does so by pointing at the
/// place rather than by naming a record.
///
/// A request raised from a device page arrives with that device's own registered spot
/// already on the plan, through [initialPlanPosition]. What is sent is a COPY of the
/// coordinate, not a reference to the object: the record says where the fault was
/// reported, and stays true afterwards even if the equipment is moved or re-placed in
/// the register. The inherited pin is left fully editable — the register is a drawing an
/// administrator made and the customer is standing in front of the fault, so the
/// customer wins — and the sheet says which of the two states the reader is in, because
/// a pin that appeared on its own and a pin the reader dropped are different claims.
///
/// This sheet deliberately sends NO `deviceId`. That field names an `ObjectNode` of
/// kind DEVICE, and every device screen in this app is built on the object-master
/// register, which is a different collection — the id it holds resolves to nothing and
/// `validateLocationChain` answers 400 `Төхөөрөмж олдсонгүй.` for it. There is
/// therefore no value this app could correctly put on the field, so the parameter does
/// not exist; a caller that came from a device names it through [deviceName] and
/// [initialDescription], which the reader of the request actually sees.
class CreateRequestSheet extends ConsumerStatefulWidget {
  const CreateRequestSheet({
    super.key,
    required this.scope,
    this.initialBuildingId,
    this.initialFloorId,
    this.initialPlanPosition,
    this.deviceName,
    this.initialDescription,
    this.initialUrgent = false,
    this.pickPhoto = pickServiceRequestPhoto,
  });

  final ResolvedCustomerScope scope;
  final String? initialBuildingId;
  final String? initialFloorId;

  /// The spot the pin starts on, copied from the equipment the request was raised
  /// from. Honoured only alongside an [initialFloorId]: a point means nothing without
  /// the drawing it was measured on. Null for a general request, and null for a device
  /// the register has never placed — which is most of them.
  final PlanPositionModel? initialPlanPosition;

  /// The device the request is about, for the subtitle. Display only — see the class
  /// note on why no id travels with it.
  final String? deviceName;
  final String? initialDescription;
  final bool initialUrgent;

  /// How the sheet obtains a picture. Overridden in tests only; `image_picker` has no
  /// test binding, so a widget test would otherwise be unable to reach the submit path
  /// at all now that a photo is mandatory.
  final PortalPhotoPicker pickPhoto;

  /// Returns the id of the created request, or null when the sheet was dismissed.
  static Future<String?> show(
    BuildContext context, {
    required ResolvedCustomerScope scope,
    String? initialBuildingId,
    String? initialFloorId,
    PlanPositionModel? initialPlanPosition,
    String? deviceName,
    String? initialDescription,
    bool initialUrgent = false,
    PortalPhotoPicker pickPhoto = pickServiceRequestPhoto,
  }) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: CustomerTokens.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(CustomerTokens.radiusSheet),
        ),
      ),
      builder: (BuildContext ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: CreateRequestSheet(
          scope: scope,
          initialBuildingId: initialBuildingId,
          initialFloorId: initialFloorId,
          initialPlanPosition: initialPlanPosition,
          deviceName: deviceName,
          initialDescription: initialDescription,
          initialUrgent: initialUrgent,
          pickPhoto: pickPhoto,
        ),
      ),
    );
  }

  @override
  ConsumerState<CreateRequestSheet> createState() => _CreateRequestSheetState();
}

class _CreateRequestSheetState extends ConsumerState<CreateRequestSheet> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _description;
  late final TextEditingController _contactName;
  late final TextEditingController _contactPhone;

  String? _buildingId;
  String? _floorId;

  /// The spot on the floor's drawing, normalised 0..1. Cleared whenever the floor
  /// beneath it changes: a point on one plan means nothing on another.
  PlanPositionModel? _planPosition;

  /// True while [_planPosition] is still the equipment's own registered spot, untouched.
  /// Goes false the moment the customer moves or clears it, because from then on the pin
  /// is their claim rather than the register's — and the sentence beside it must stop
  /// saying otherwise.
  bool _pinInherited = false;

  ServiceRequestType _requestType = ServiceRequestType.standardCall;
  late bool _isUrgent;

  /// Files already uploaded and parked on this account, in the order they were added.
  /// Their ids are what `attachmentIds` carries.
  final List<ServiceRequestAttachmentModel> _photos =
      <ServiceRequestAttachmentModel>[];

  /// The captured bytes, kept per file id so the grid can draw a thumbnail without
  /// downloading back the picture it just sent — and without hitting `GET /files/:id`,
  /// which refuses an attachment no request has claimed yet.
  final Map<String, Uint8List> _thumbnails = <String, Uint8List>{};

  bool _uploading = false;
  bool _submitting = false;
  String? _photoError;
  String? _submitError;
  String? _createdId;

  /// `createServiceRequestSchema` caps `attachmentIds` at 20. Enforced before the
  /// picker opens so the twenty-first picture is never uploaded: it would be stored,
  /// orphaned, and then rejected along with the rest of the form.
  static const int _maxPhotos = 20;

  bool get _busy => _uploading || _submitting;

  bool get _canAddPhoto => !_busy && _photos.length < _maxPhotos;

  @override
  void initState() {
    super.initState();
    final AppUser? user = ref.read(currentUserProvider);
    _description = TextEditingController(text: widget.initialDescription ?? '');
    _contactName = TextEditingController(text: user?.fullName ?? '');
    _contactPhone = TextEditingController(text: user?.phone ?? '');
    _buildingId = widget.initialBuildingId;
    _floorId = widget.initialFloorId;
    // Guarded on the floor here rather than at the call site, so no caller can hand the
    // sheet a coordinate with no drawing to measure it against — the same rule `_submit`
    // enforces on the way out.
    _planPosition = _floorId == null ? null : widget.initialPlanPosition;
    _pinInherited = _planPosition != null;
    _isUrgent = widget.initialUrgent;
    _requestType = widget.initialUrgent
        ? ServiceRequestType.urgentCall
        : ServiceRequestType.standardCall;
  }

  @override
  void dispose() {
    _description.dispose();
    _contactName.dispose();
    _contactPhone.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_createdId != null) return _buildConfirmation(_createdId!);

    final AsyncValue<List<BuildingModel>> buildings =
        ref.watch(customerBuildingsProvider);
    final AsyncValue<List<FloorModel>> floors = _buildingId == null
        ? const AsyncValue<List<FloorModel>>.data(<FloorModel>[])
        : ref.watch(buildingFloorsProvider(_buildingId!));

    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.92,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SheetHandle(),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        'Дуудлага илгээх',
                        style: CustomerTokens.screenTitle,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        widget.deviceName == null
                            ? 'Барилга, давхар, асуудлын төрлөө сонгон засварын '
                                'дуудлага илгээнэ.'
                            : '${widget.deviceName} төхөөрөмж дээр дуудлага илгээнэ.',
                        style: CustomerTokens.rowSub.copyWith(height: 1.55),
                      ),
                      const SizedBox(height: 16),

                      const FieldLabel('Барилга'),
                      buildings.when(
                        data: (List<BuildingModel> items) =>
                            DropdownButtonFormField<String>(
                          initialValue: items.any((BuildingModel b) => b.id == _buildingId)
                              ? _buildingId
                              : null,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            hintText: 'Барилга сонгоно уу',
                          ),
                          items: <DropdownMenuItem<String>>[
                            for (final BuildingModel building in items)
                              DropdownMenuItem<String>(
                                value: building.id,
                                child: Text(
                                  building.name,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          validator: (String? value) =>
                              value == null ? 'Барилга заавал сонгоно.' : null,
                          onChanged: (String? value) => setState(() {
                            _buildingId = value;
                            _floorId = null;
                            _clearFloorPin();
                          }),
                        ),
                        loading: () => const LinearProgressIndicator(),
                        error: (Object error, StackTrace _) => Text(
                          error is Failure
                              ? error.message
                              : 'Барилгын жагсаалт ачаалж чадсангүй.',
                          style: CustomerTokens.rowSub.copyWith(
                            color: CustomerTokens.red,
                          ),
                        ),
                      ),
                      const SizedBox(height: 13),

                      const FieldLabel('Давхар (сонголтоор)'),
                      floors.when(
                        data: (List<FloorModel> items) =>
                            DropdownButtonFormField<String>(
                          initialValue: items.any((FloorModel f) => f.id == _floorId)
                              ? _floorId
                              : null,
                          isExpanded: true,
                          decoration: InputDecoration(
                            hintText: _buildingId == null
                                ? 'Эхлээд барилгаа сонгоно уу'
                                : 'Давхар сонгоно уу',
                          ),
                          items: <DropdownMenuItem<String>>[
                            for (final FloorModel floor in items)
                              DropdownMenuItem<String>(
                                value: floor.id,
                                child: Text(
                                  floor.purpose == null
                                      ? floor.name
                                      : '${floor.name} · ${floor.purpose}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: (String? value) => setState(() {
                            _floorId = value;
                            _clearFloorPin();
                          }),
                        ),
                        loading: () => const LinearProgressIndicator(),
                        error: (Object _, StackTrace __) => Text(
                          'Давхрын жагсаалт ачаалж чадсангүй.',
                          style: CustomerTokens.rowSub.copyWith(
                            color: CustomerTokens.red,
                          ),
                        ),
                      ),
                      const SizedBox(height: 13),

                      // The pin is the chosen floor's, so it is not rendered before one
                      // exists. A floor with no drawing is an ordinary state and says so
                      // in a sentence rather than as a control that cannot be used.
                      if (_floorId != null) ...<Widget>[
                        _buildPinSection(_floorId!),
                        const SizedBox(height: 13),
                      ],

                      const FieldLabel('Хүсэлтийн төрөл'),
                      DropdownButtonFormField<ServiceRequestType>(
                        initialValue: _requestType,
                        isExpanded: true,
                        items: <DropdownMenuItem<ServiceRequestType>>[
                          for (final ServiceRequestType type
                              in ServiceRequestType.values)
                            DropdownMenuItem<ServiceRequestType>(
                              value: type,
                              child: Text(type.label, overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (ServiceRequestType? value) => setState(() {
                          if (value != null) _requestType = value;
                        }),
                      ),
                      const SizedBox(height: 6),

                      SwitchListTile.adaptive(
                        value: _isUrgent,
                        onChanged: (bool value) => setState(() => _isUrgent = value),
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          'Яаралтай',
                          style: CustomerTokens.rowTitle.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        // No hours are named here on purpose. The window is the
                        // `sla.urgent_hours` / `sla.standard_hours` setting (1-720),
                        // the backend is the sole authority for the deadline, and the
                        // customer role holds portal keys only - no `settings.view` -
                        // so this app cannot read the values in force. Printing 6/24
                        // would be a promise the server may not honour.
                        subtitle: Text(
                          'Яаралтай дуудлагыг эхэнд авч үзнэ. Гүйцэтгэх эцсийн '
                          'хугацааг хүсэлтийг хүлээн авах үед тогтооно.',
                          style: CustomerTokens.rowSub,
                        ),
                      ),
                      const SizedBox(height: 8),

                      const FieldLabel('Холбогдох хүн'),
                      TextFormField(
                        controller: _contactName,
                        decoration: const InputDecoration(hintText: 'Нэр'),
                        validator: (String? value) {
                          final String text = value?.trim() ?? '';
                          if (text.isEmpty) return 'Холбогдох хүний нэр заавал.';
                          if (text.length > 200) {
                            return 'Нэр 200 тэмдэгтээс урт байж болохгүй.';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 13),

                      const FieldLabel('Утасны дугаар'),
                      TextFormField(
                        controller: _contactPhone,
                        keyboardType: TextInputType.phone,
                        decoration: const InputDecoration(hintText: '9911-2233'),
                        validator: (String? value) {
                          final String text = value?.trim() ?? '';
                          if (text.isEmpty) return 'Утасны дугаар заавал.';
                          if (!CreateServiceRequestRequestModel.phonePattern
                              .hasMatch(text)) {
                            return 'Утасны дугаар буруу форматтай байна.';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 13),

                      const FieldLabel('Тайлбар'),
                      TextFormField(
                        controller: _description,
                        maxLines: 4,
                        maxLength: CreateServiceRequestRequestModel.descriptionMaxLength,
                        decoration: const InputDecoration(
                          hintText: 'Жишээ: 2-р давхрын коридорт гэрэл анивчаад '
                              'байна, шаталтын үнэр мэдрэгдсэн.',
                        ),
                        validator: (String? value) {
                          final String text = value?.trim() ?? '';
                          if (text.length <
                              CreateServiceRequestRequestModel.descriptionMinLength) {
                            return 'Тайлбар дор хаяж '
                                '${CreateServiceRequestRequestModel.descriptionMinLength} '
                                'тэмдэгттэй байна.';
                          }
                          return null;
                        },
                      ),

                      const SizedBox(height: 4),
                      _buildPhotoSection(),

                      if (_submitError != null) ...<Widget>[
                        const SizedBox(height: 4),
                        NoticeBanner.alert(text: _submitError!),
                      ],
                      const SizedBox(height: 8),
                    ],
                  ),
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
              decoration: const BoxDecoration(
                border: Border(top: CustomerTokens.hairlineFaintSide),
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => Navigator.of(context).maybePop(),
                      child: const Text('Болих'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    // Deliberately still tappable with no picture, rather than
                    // disabled. A greyed-out button states that something is wrong and
                    // refuses to say what; tapping it prints the sentence and scrolls
                    // the reason into view. The rule is stated in the section above in
                    // any case, so this is the second telling, not the first.
                    child: FilledButton(
                      onPressed: _busy ? null : _submit,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Илгээх'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Drops the pin, which only meant something under the previous floor.
  ///
  /// Called from both selectors, because changing the BUILDING changes the floor too.
  /// Not folded into the setters: a pin is a point on a drawing that is no longer on
  /// screen, and carrying it across would put the fault at an arbitrary spot on the new
  /// floor's plan.
  void _clearFloorPin() {
    _planPosition = null;
    _pinInherited = false;
  }

  /// True when the request came from a device the register has never placed on a plan.
  ///
  /// Two of the thirty-five objects carry a position today, so this is the ordinary case
  /// on the device page rather than an edge of it, and it gets a sentence of its own: an
  /// empty plan where a pin was expected reads as a drawing that failed to load.
  bool get _equipmentUnplaced =>
      widget.deviceName != null && widget.initialPlanPosition == null;

  /// The line above the drawing, which must always describe the state actually on screen.
  String get _pinHint {
    if (_pinInherited) {
      return 'Төхөөрөмжийн бүртгэлтэй байршлыг тэмдэглэлээ. Асуудал өөр газар '
          'гарсан бол дарж шилжүүлнэ үү.';
    }
    if (_planPosition != null) return 'Өөр газар дарвал тэмдэглэгээ шилжинэ.';
    if (_equipmentUnplaced) {
      return 'Энэ төхөөрөмжийн байршил планд бүртгэгдээгүй байна. Асуудал гарсан '
          'газар дээр дарж тэмдэглэнэ үү.';
    }
    return 'Асуудал гарсан газар дээр дарж тэмдэглэнэ үү.';
  }

  /// The optional pin on [floorId]'s drawing.
  ///
  /// Rendered through `AuthenticatedImage.sizedToImage` and [FloorPlanPinLayer], the
  /// same pair the floor's read-only plan uses, so the coordinate this sheet sends and
  /// the coordinate that screen draws are read off the same rectangle by the same
  /// arithmetic. A floor with no drawing, or one whose plan is not an image, gets a
  /// sentence and no control: there is nothing to point at.
  Widget _buildPinSection(String floorId) {
    final AsyncValue<FloorPlanModel?> plan = ref.watch(floorPlanProvider(floorId));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        const FieldLabel('Планд тэмдэглэх (сонголтоор)'),
        plan.when(
          data: (FloorPlanModel? data) {
            if (data == null || !data.isImage) {
              return Text(
                'Энэ давхарт план зураг ачаалагдаагүй тул байршил тэмдэглэх '
                'боломжгүй байна.',
                style: CustomerTokens.rowSub.copyWith(height: 1.45),
              );
            }

            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  _pinHint,
                  style: CustomerTokens.rowSub.copyWith(height: 1.45),
                ),
                const SizedBox(height: 8),
                DecoratedBox(
                  decoration: const BoxDecoration(
                    border: Border.fromBorderSide(CustomerTokens.hairlineSide),
                  ),
                  child: AuthenticatedImage.sizedToImage(
                    fileId: data.fileId,
                    // An inherited pin is placed, not locked: the register records
                    // where the equipment was installed and the customer is looking at
                    // where it failed, so the same tap that places a first pin moves
                    // this one.
                    overlay: FloorPlanPinLayer(
                      pin: _planPosition,
                      onTapAt: (PlanPositionModel position) => setState(() {
                        _planPosition = position;
                        _pinInherited = false;
                      }),
                    ),
                  ),
                ),
                if (_planPosition != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => setState(_clearFloorPin),
                      icon: const Icon(Icons.close, size: 16),
                      label: const Text('Тэмдэглэгээг арилгах'),
                    ),
                  ),
              ],
            );
          },
          loading: () => const LinearProgressIndicator(),
          error: (Object _, StackTrace __) => Text(
            'План зураг ачаалж чадсангүй.',
            style: CustomerTokens.rowSub.copyWith(color: CustomerTokens.red),
          ),
        ),
      ],
    );
  }

  /// What the user is told when they try to send a request with no picture.
  ///
  /// A sentence rather than a label: the rule is not obvious from the form, and the
  /// dispatcher who receives the request cannot see the fault without it.
  static const String _photoRequiredMessage =
      'Асуудлыг харуулсан дор хаяж нэг зураг заавал хавсаргана.';

  /// The mandatory photo grid.
  ///
  /// The requirement is stated up front by the section's own subtitle rather than only
  /// on refusal, so the rule is visible before the submit button is reached. Framed as
  /// a [BlueprintFrame] like every other panel in the flow.
  Widget _buildPhotoSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: <Widget>[
            const FieldLabel('Зураг (заавал)'),
            Text('${_photos.length}/$_maxPhotos', style: CustomerTokens.rowSub),
          ],
        ),
        BlueprintFrame(
          padding: const EdgeInsets.fromLTRB(13, 12, 13, 13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                'Асуудлыг харуулсан зураг хавсаргана. Зурагтай дуудлагыг '
                'ажилтан хурдан оношилно.',
                style: CustomerTokens.rowSub.copyWith(height: 1.45),
              ),
              if (_photos.isNotEmpty) ...<Widget>[
                const SizedBox(height: 11),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: <Widget>[
                    for (final ServiceRequestAttachmentModel photo in _photos)
                      _PhotoThumb(
                        bytes: _thumbnails[photo.id],
                        label: photo.name,
                        onRemove: _busy ? null : () => _removePhoto(photo.id),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 11),
              OutlinedButton.icon(
                onPressed: _canAddPhoto ? _addPhoto : null,
                icon: _uploading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add_a_photo_outlined, size: 18),
                label: Text(
                  _photos.isEmpty ? 'Зураг нэмэх' : 'Өөр зураг нэмэх',
                ),
              ),
            ],
          ),
        ),
        if (_photoError != null) ...<Widget>[
          const SizedBox(height: 8),
          NoticeBanner.alert(text: _photoError!),
        ],
      ],
    );
  }

  /// Picks one picture and uploads it immediately.
  ///
  /// Uploading on add rather than on submit is what lets the create call be a single
  /// atomic POST carrying ids: the server needs the file to exist before a request can
  /// claim it. It also means a slow upload is paid for while the user is still typing
  /// rather than after they press Илгээх.
  Future<void> _addPhoto() async {
    if (!_canAddPhoto) return;

    final PhotoCaptureResult picked = await widget.pickPhoto(context);
    if (!mounted) return;

    switch (picked) {
      case PhotoCaptureCancelled():
        // Backing out of the camera is the normal case, not a problem to report.
        return;
      case PhotoCaptureFailed(message: final String message):
        setState(() => _photoError = message);
        return;
      case PhotoCaptured(photo: final CapturedPhoto photo):
        setState(() {
          _uploading = true;
          _photoError = null;
        });

        final ApiResult<ServiceRequestAttachmentModel> result = await ref
            .read(customerPortalRepositoryProvider)
            .uploadServiceRequestAttachment(photo);

        if (!mounted) return;

        result.when(
          success: (ServiceRequestAttachmentModel stored) => setState(() {
            _uploading = false;
            _photos.add(stored);
            _thumbnails[stored.id] = photo.bytes;
            // A refusal that was about the missing picture is now stale.
            _submitError = null;
          }),
          failure: (Failure failure) => setState(() {
            _uploading = false;
            _photoError = failure.message;
          }),
        );
    }
  }

  /// Drops a picture from the request being composed.
  ///
  /// The uploaded file is deliberately not deleted server-side: there is no delete
  /// route for a parked attachment, and an unclaimed file is readable by nobody — not
  /// even its uploader — so leaving it costs a row and leaks nothing.
  void _removePhoto(String fileId) {
    setState(() {
      _photos.removeWhere((ServiceRequestAttachmentModel p) => p.id == fileId);
      _thumbnails.remove(fileId);
    });
  }

  Widget _buildConfirmation(String requestId) {
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const SheetHandle(),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Container(
                  width: 68,
                  height: 68,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: CustomerTokens.greenBg,
                    shape: BoxShape.circle,
                    border: Border.all(color: CustomerTokens.greenBorder, width: 2),
                  ),
                  child: const Icon(Icons.check, size: 32, color: CustomerTokens.green),
                ),
                const SizedBox(height: 14),
                Text(
                  'Хүсэлт илгээгдлээ',
                  style: CustomerTokens.screenTitle,
                ),
                const SizedBox(height: 8),
                Text(
                  'Таны хүсэлтийг систем бүртгэж, диспетчер ажилтанд хуваарилах '
                  'болно.',
                  textAlign: TextAlign.center,
                  style: CustomerTokens.emptyText,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: FilledButton(
              onPressed: () => Navigator.of(context).pop(requestId),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
              child: const Text('Хүсэлт харах'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    if (_busy) return;

    // Both halves are evaluated before returning, so a form with a short description
    // AND no picture reports both faults at once rather than one per attempt.
    final bool formValid = _formKey.currentState?.validate() ?? false;
    final bool hasPhoto = _photos.isNotEmpty;

    if (!hasPhoto) {
      setState(() => _photoError = _photoRequiredMessage);
    }
    if (!formValid || !hasPhoto) return;

    setState(() {
      _submitting = true;
      _submitError = null;
      _photoError = null;
    });

    final CreateServiceRequestRequestModel request =
        CreateServiceRequestRequestModel(
      customerId: widget.scope.customerId,
      buildingId: _buildingId!,
      floorId: _floorId,
      // The pin is the floor's. Guarded on it here as well as cleared with it, so no
      // rearrangement of the widget tree above can put a point on the wire without the
      // floor that gives it meaning — the server refuses a floorless pin outright.
      planPosition: _floorId == null ? null : _planPosition,
      requestType: _requestType,
      isUrgent: _isUrgent,
      description: _description.text.trim(),
      contactName: _contactName.text.trim(),
      contactPhone: _contactPhone.text.trim(),
      // The ids the server parked on this account; creating the request is what
      // transfers their ownership to it.
      attachmentIds: _photos
          .map((ServiceRequestAttachmentModel photo) => photo.id)
          .toList(growable: false),
    );

    final ApiResult<ServiceRequestDetailModel> result = await ref
        .read(customerPortalRepositoryProvider)
        .createServiceRequest(request);

    if (!mounted) return;

    result.when(
      success: (ServiceRequestDetailModel created) {
        ref
          ..invalidate(customerServiceRequestsProvider)
          ..invalidate(customerHomeSummaryProvider);
        setState(() {
          _submitting = false;
          _createdId = created.id;
        });
      },
      failure: (Failure failure) {
        setState(() {
          _submitting = false;
          _submitError = failure.message;
        });
      },
    );
  }
}

/// One uploaded picture in the grid, with the control that drops it.
///
/// Drawn from the bytes the picker returned rather than from `downloadUrl`: the file
/// is parked on the uploading account until the request claims it, and `GET /files/:id`
/// resolves a service-request attachment through the request that owns it — so an
/// unclaimed one answers 404 to everybody, its uploader included. There is nothing to
/// fetch back yet, and nothing worth fetching: these are the exact bytes that were sent.
class _PhotoThumb extends StatelessWidget {
  const _PhotoThumb({
    required this.bytes,
    required this.label,
    required this.onRemove,
  });

  final Uint8List? bytes;
  final String label;
  final VoidCallback? onRemove;

  static const double _size = 76;

  @override
  Widget build(BuildContext context) {
    final Uint8List? data = bytes;

    return SizedBox(
      width: _size,
      height: _size,
      child: Stack(
        children: <Widget>[
          Positioned.fill(
            child: Container(
              decoration: const BoxDecoration(
                color: CustomerTokens.soft2,
                border: Border.fromBorderSide(CustomerTokens.hairlineSide),
              ),
              child: data == null
                  // Only reachable if the bytes were dropped from memory while the
                  // upload survived; the name still identifies which picture it is.
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(4),
                        child: Text(
                          label,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: CustomerTokens.rowSub,
                        ),
                      ),
                    )
                  : Image.memory(
                      data,
                      fit: BoxFit.cover,
                      // Decoded down to the box it is drawn in: a full-resolution
                      // frame per thumbnail is megabytes of raster for 76 logical
                      // pixels, and twenty of them would be felt.
                      cacheWidth: (_size * MediaQuery.devicePixelRatioOf(context))
                          .round(),
                      semanticLabel: label,
                    ),
            ),
          ),
          if (onRemove != null)
            Positioned(
              top: 0,
              right: 0,
              child: Material(
                color: CustomerTokens.ink,
                child: InkWell(
                  onTap: onRemove,
                  child: const Padding(
                    padding: EdgeInsets.all(3),
                    child: Icon(
                      Icons.close,
                      size: 13,
                      color: CustomerTokens.onHero,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
