import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/service_request_enums.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import 'customer_ui.dart';

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
/// Two deliberate departures from the prototype, both because the API has no such
/// concept and inventing one would be inventing a business rule:
///
///   * The three-level "Яаралтай байдал" chooser becomes a single urgent switch.
///     `createServiceRequestSchema` has `isUrgent: boolean` and no priority field.
///   * The photo grid is omitted. Attaching a file is a two-phase flow - upload to
///     `POST /files/service-request-attachments` first, then pass the returned ids
///     as `attachmentIds` - and the upload needs an image picker plugin that this
///     app does not carry. The request model keeps the `attachmentIds` field so the
///     flow can be completed without a contract change.
class CreateRequestSheet extends ConsumerStatefulWidget {
  const CreateRequestSheet({
    super.key,
    required this.scope,
    this.initialBuildingId,
    this.initialFloorId,
    this.deviceId,
    this.deviceName,
    this.initialDescription,
    this.initialUrgent = false,
  });

  final ResolvedCustomerScope scope;
  final String? initialBuildingId;
  final String? initialFloorId;
  final String? deviceId;
  final String? deviceName;
  final String? initialDescription;
  final bool initialUrgent;

  /// Returns the id of the created request, or null when the sheet was dismissed.
  static Future<String?> show(
    BuildContext context, {
    required ResolvedCustomerScope scope,
    String? initialBuildingId,
    String? initialFloorId,
    String? deviceId,
    String? deviceName,
    String? initialDescription,
    bool initialUrgent = false,
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
          deviceId: deviceId,
          deviceName: deviceName,
          initialDescription: initialDescription,
          initialUrgent: initialUrgent,
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
  ServiceRequestType _requestType = ServiceRequestType.standardCall;
  late bool _isUrgent;

  bool _submitting = false;
  String? _submitError;
  String? _createdId;

  @override
  void initState() {
    super.initState();
    final AppUser? user = ref.read(currentUserProvider);
    _description = TextEditingController(text: widget.initialDescription ?? '');
    _contactName = TextEditingController(text: user?.fullName ?? '');
    _contactPhone = TextEditingController(text: user?.phone ?? '');
    _buildingId = widget.initialBuildingId;
    _floorId = widget.initialFloorId;
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
                      const Text(
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
                          onChanged: (String? value) =>
                              setState(() => _floorId = value),
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
                        subtitle: const Text(
                          'Яаралтай дуудлагын SLA 6 цаг, энгийн дуудлагынх 24 цаг.',
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
                      onPressed: _submitting
                          ? null
                          : () => Navigator.of(context).maybePop(),
                      child: const Text('Болих'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: FilledButton(
                      onPressed: _submitting ? null : _submit,
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
                const Text(
                  'Хүсэлт илгээгдлээ',
                  style: CustomerTokens.screenTitle,
                ),
                const SizedBox(height: 8),
                const Text(
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
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() {
      _submitting = true;
      _submitError = null;
    });

    final CreateServiceRequestRequestModel request =
        CreateServiceRequestRequestModel(
      customerId: widget.scope.customerId,
      buildingId: _buildingId!,
      floorId: _floorId,
      deviceId: widget.deviceId,
      requestType: _requestType,
      isUrgent: _isUrgent,
      description: _description.text.trim(),
      contactName: _contactName.text.trim(),
      contactPhone: _contactPhone.text.trim(),
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
