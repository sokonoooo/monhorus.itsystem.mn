import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_DESCRIPTIONS,
  OBJECT_CATEGORY_LABELS,
  PERMISSIONS,
  createObjectAssessmentSchema,
  createObjectSchema,
  updateObjectSchema,
  type FloorDto,
  type ObjectCategory,
  type ObjectListItemDto,
  type ObjectTypeDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../../components/ui/control-styles';
import { useAuth } from '../../../contexts/auth-context';
import { ApiError } from '../../../lib/api-client';
import { objectMasterService, objectTypeService } from '../../../services/object-master.service';
import { projectService } from '../../../services/project.service';
import { Field, SelectInput, TextInput } from '../../employees/FormControls';

/**
 * Object create and edit, always in the context of a floor.
 *
 * The object is a placement, so the floor comes from the route and the customer is read off
 * that floor rather than chosen: an object cannot exist without the floor it sits on, and
 * letting the two be picked independently is what allowed a mismatch before.
 *
 * The form renders only the section 4.2 fields that belong to the chosen category, which
 * is what "do not put every technical field on every Object type" means in practice. The
 * backend enforces the same shape with a strict discriminated union, so a field can never
 * arrive on a category that has no use for it.
 *
 * Category is fixed after creation: changing it would invalidate every stored attribute
 * and every load figure derived from them.
 */
export function ObjectFormPage(): ReactElement {
  const { floorId, objectId } = useParams<{ floorId: string; objectId: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(objectId);
  const navigate = useNavigate();
  const { notify } = useToast();
  const { can } = useAuth();

  const canAssess = can(PERMISSIONS.OBJECT_MASTER_ASSESS);

  const [floor, setFloor] = useState<FloorDto | null>(null);
  const [types, setTypes] = useState<ObjectTypeDto[]>([]);
  const [panels, setPanels] = useState<ObjectListItemDto[]>([]);
  const [circuits, setCircuits] = useState<ObjectListItemDto[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [category, setCategory] = useState<ObjectCategory>(
    (searchParams.get('category') as ObjectCategory | null) ?? 'EQUIPMENT',
  );
  const [objectTypeId, setObjectTypeId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');

  // Initial assessment, create only. Section 10.1: the score is a 0-100 figure and the
  // backend resolves the band, so nothing about the banding is decided here.
  const [initialScore, setInitialScore] = useState('');
  const [initialConclusion, setInitialConclusion] = useState('');
  const [initialRecommendation, setInitialRecommendation] = useState('');
  // Every assessment needs photographic evidence, this one included. The object does not
  // exist yet, so the file is held here and uploaded on save.
  const [initialPhoto, setInitialPhoto] = useState<File | null>(null);

  // Panel
  const [capacityKw, setCapacityKw] = useState('');
  const [location, setLocation] = useState('');
  const [protection, setProtection] = useState('');

  // Circuit
  const [panelId, setPanelId] = useState('');
  const [breakerRating, setBreakerRating] = useState('');
  const [cableType, setCableType] = useState('');
  const [cableSectionMm2, setCableSectionMm2] = useState('');
  const [cableLengthM, setCableLengthM] = useState('');
  const [permittedCapacityKw, setPermittedCapacityKw] = useState('');

  // Equipment
  const [circuitId, setCircuitId] = useState('');
  const [ratedPowerKw, setRatedPowerKw] = useState('');
  const [quantity, setQuantity] = useState('');
  const [usageCoefficient, setUsageCoefficient] = useState('');
  const [installedAt, setInstalledAt] = useState('');
  const [warrantyUntil, setWarrantyUntil] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      setLoading(true);
      try {
        if (!floorId) {
          setLoadError('Давхар олдсонгүй.');
          return;
        }

        // The floor is the anchor: it supplies the customer and the breadcrumb trail.
        const floorDetail = await projectService.getFloor(floorId);
        if (cancelled) return;
        setFloor(floorDetail);
        setCustomerId(floorDetail.customerId);

        if (objectId) {
          const object = await objectMasterService.getById(objectId);
          if (cancelled) return;
          setCustomerId(object.customerId);
          setCategory(object.category);
          setObjectTypeId(object.objectType?.id ?? '');
          setCode(object.code);
          setName(object.name);
          setDescription(object.description ?? '');
          setNotes(object.notes ?? '');

          setCapacityKw(object.panel?.capacityKw?.toString() ?? '');
          setLocation(object.panel?.location ?? '');
          setProtection(object.panel?.protection ?? '');

          setPanelId(object.circuit?.panel?.id ?? '');
          setBreakerRating(object.circuit?.breakerRating ?? '');
          setCableType(object.circuit?.cableType ?? '');
          setCableSectionMm2(object.circuit?.cableSectionMm2?.toString() ?? '');
          setCableLengthM(object.circuit?.cableLengthM?.toString() ?? '');
          setPermittedCapacityKw(object.circuit?.permittedCapacityKw?.toString() ?? '');

          setCircuitId(object.equipment?.circuit?.id ?? '');
          setRatedPowerKw(object.equipment?.ratedPowerKw?.toString() ?? '');
          setQuantity(object.equipment?.quantity?.toString() ?? '');
          setUsageCoefficient(object.equipment?.usageCoefficient?.toString() ?? '');
          setInstalledAt(object.equipment?.installedAt?.slice(0, 10) ?? '');
          setWarrantyUntil(object.equipment?.warrantyUntil?.slice(0, 10) ?? '');
        }
      } catch (caught) {
        if (!cancelled) {
          setLoadError(caught instanceof ApiError ? caught.message : 'Мэдээлэл ачаалж чадсангүй.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [objectId, floorId]);

  // Only active types of the chosen category are offered.
  useEffect(() => {
    let cancelled = false;
    objectTypeService
      .list({ category, isActive: true, limit: 100 })
      .then((page) => {
        if (!cancelled) setTypes(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [category]);

  // Related objects are scoped to the same customer, matching the backend rule.
  useEffect(() => {
    if (!customerId) {
      setPanels([]);
      setCircuits([]);
      return undefined;
    }
    let cancelled = false;
    void Promise.all([
      objectMasterService.list({ customerId, category: 'PANEL', limit: 100 }),
      objectMasterService.list({ customerId, category: 'CIRCUIT', limit: 100 }),
    ]).then(([panelPage, circuitPage]) => {
      if (cancelled) return;
      setPanels(panelPage.items);
      setCircuits(circuitPage.items);
    });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  function numberOrNull(value: string): number | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : Number(trimmed);
  }

  const floorPath = `/floors/${floorId ?? ''}`;
  const selectedType = types.find((type) => type.id === objectTypeId) ?? null;
  // Section 4.1: only a type flagged as generating a conclusion may carry an assessment,
  // so the score field appears exactly where the backend would accept one.
  const showInitialScore = !isEdit && canAssess && (selectedType?.generatesConclusion ?? false);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const attributes =
      category === 'PANEL'
        ? {
            panel: {
              capacityKw: numberOrNull(capacityKw),
              location: location.trim() || null,
              protection: protection.trim() || null,
            },
          }
        : category === 'CIRCUIT'
          ? {
              circuit: {
                panelId: panelId || null,
                startPointObjectId: null,
                endPointObjectId: null,
                breakerRating: breakerRating.trim() || null,
                cableType: cableType.trim() || null,
                cableSectionMm2: numberOrNull(cableSectionMm2),
                cableLengthM: numberOrNull(cableLengthM),
                permittedCapacityKw: numberOrNull(permittedCapacityKw),
              },
            }
          : {
              equipment: {
                circuitId: circuitId || null,
                ratedPowerKw: numberOrNull(ratedPowerKw),
                quantity: numberOrNull(quantity),
                usageCoefficient: numberOrNull(usageCoefficient),
                installedAt: installedAt ? `${installedAt}T00:00:00.000Z` : null,
                warrantyUntil: warrantyUntil ? `${warrantyUntil}T00:00:00.000Z` : null,
              },
            };

    const parsed = isEdit
      ? updateObjectSchema.safeParse({
          name: name.trim(),
          objectTypeId,
          floorId: floorId ?? null,
          description: description.trim() || null,
          notes: notes.trim() || null,
          ...attributes,
        })
      : createObjectSchema.safeParse({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          customerId,
          objectTypeId,
          floorId: floorId ?? null,
          description: description.trim() || null,
          notes: notes.trim() || null,
          category,
          ...attributes,
        });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    const wantsAssessment = !isEdit && showInitialScore && initialScore.trim() !== '';

    // Evidence is checked before anything is written at all, so a score with no picture
    // behind it never reaches the upload, let alone the create.
    if (wantsAssessment && !initialPhoto) {
      setFieldErrors({
        'assessment.photoIds': 'Нотлох зураг заавал: дор хаяж нэг зураг хавсаргана уу.',
      });
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      /**
       * The initial score, when one was typed, is validated before the object is written so
       * a rejected score does not leave a created object behind. Its photo is uploaded
       * first because the schema needs a real file id: the file is parked on the uploader
       * and claimed by the assessment, exactly as a service-request attachment is.
       */
      let assessment: ReturnType<typeof createObjectAssessmentSchema.safeParse> | null = null;
      if (wantsAssessment && initialPhoto) {
        let photoId: string;
        try {
          photoId = (await objectMasterService.uploadAssessmentPhoto(initialPhoto)).id;
        } catch (caught) {
          setFormError(caught instanceof ApiError ? caught.message : 'Зураг хуулж чадсангүй.');
          setSubmitting(false);
          return;
        }

        assessment = createObjectAssessmentSchema.safeParse({
          newScore: Number(initialScore.trim()),
          conclusion: initialConclusion.trim() || null,
          recommendation: initialRecommendation.trim() || null,
          photoIds: [photoId],
        });
        if (!assessment.success) {
          const errors: Record<string, string> = {};
          for (const issue of assessment.error.issues) {
            const key = `assessment.${issue.path.join('.') || '_'}`;
            if (!errors[key]) errors[key] = issue.message;
          }
          setFieldErrors(errors);
          setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
          setSubmitting(false);
          return;
        }
      }

      if (isEdit && objectId) {
        await objectMasterService.update(
          objectId,
          parsed.data as Parameters<typeof objectMasterService.update>[1],
        );
        notify('Объект шинэчлэгдлээ.', 'success');
        navigate(`${floorPath}/objects/${objectId}`);
      } else {
        const created = await objectMasterService.create(
          parsed.data as Parameters<typeof objectMasterService.create>[0],
        );

        if (assessment?.success) {
          // A rejected assessment must not read as a failed create: the object exists either
          // way, so the failure is reported on its own and the user lands on the object.
          try {
            await objectMasterService.recordAssessment(created.id, assessment.data);
            notify('Объект болон үнэлгээ бүртгэгдлээ.', 'success');
          } catch (caught) {
            notify(
              caught instanceof ApiError
                ? `Объект үүслээ. Үнэлгээ бүртгэгдсэнгүй: ${caught.message}`
                : 'Объект үүслээ. Үнэлгээ бүртгэгдсэнгүй.',
              'error',
            );
          }
        } else {
          notify('Объект үүслээ.', 'success');
        }

        navigate(`${floorPath}/objects/${created.id}`);
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (loadError) return <ErrorState description={loadError} />;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Объект засах' : 'Шинэ объект'}
        description={
          floor
            ? `${floor.buildingName ?? '-'} · ${floor.name}`
            : undefined
        }
        backTo={{ to: floorPath, label: 'Давхар руу буцах' }}
        breadcrumbs={[
          { label: 'Төсөл', to: '/projects' },
          ...(floor
            ? [
                { label: floor.projectName ?? '-', to: `/projects/${floor.projectId}` },
                { label: floor.buildingName ?? '-', to: `/buildings/${floor.buildingId}` },
                { label: floor.name, to: floorPath },
              ]
            : []),
          { label: isEdit ? 'Засах' : 'Шинэ объект' },
        ]}
      />

      <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {formError && <Alert variant="error">{formError}</Alert>}

        {isEdit ? (
          <Alert variant="info">
            Код болон ангиллыг өөрчлөхгүй. Ангилал өөрчлөгдвөл хадгалагдсан техникийн
            талбарууд болон ачааллын тооцоо хүчингүй болно.
          </Alert>
        ) : (
          <Alert variant="info">{OBJECT_CATEGORY_DESCRIPTIONS[category]}</Alert>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Давхар" hint="Маршрутаас тодорхойлогдоно">
            <TextInput
              value={
                floor ? `${floor.projectName ?? '-'} · ${floor.buildingName ?? '-'} · ${floor.name}` : ''
              }
              onChange={() => undefined}
              disabled
            />
          </Field>

          <Field label="Ангилал" required error={fieldErrors.category}>
            <SelectInput
              value={category}
              onChange={(value) => {
                setCategory(value as ObjectCategory);
                setObjectTypeId('');
              }}
              options={OBJECT_CATEGORIES.map((entry) => ({
                value: entry,
                label: OBJECT_CATEGORY_LABELS[entry],
              }))}
              disabled={submitting || isEdit}
            />
          </Field>

          <Field label="Тоноглолын төрөл" required error={fieldErrors.objectTypeId}>
            <SelectInput
              value={objectTypeId}
              onChange={setObjectTypeId}
              placeholder={types.length === 0 ? 'Энэ ангилалд төрөл алга' : 'Төрөл сонгох'}
              options={types.map((type) => ({ value: type.id, label: `${type.name} (${type.code})` }))}
              disabled={submitting || types.length === 0}
            />
          </Field>

          <Field label="Код" required={!isEdit} error={fieldErrors.code}>
            <TextInput
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              disabled={submitting || isEdit}
            />
          </Field>

          <Field label="Нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={submitting} />
          </Field>
        </div>

        {/* Only the block belonging to the chosen category is rendered. */}
        {category === 'PANEL' && (
          <fieldset aria-label="Самбарын мэдээлэл">
            <legend className="mb-3 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
              Самбарын мэдээлэл
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Хүчин чадал (kW)" error={fieldErrors['panel.capacityKw']}>
                <TextInput type="number" value={capacityKw} onChange={setCapacityKw} disabled={submitting} />
              </Field>
              <Field label="Байрлал" error={fieldErrors['panel.location']}>
                <TextInput value={location} onChange={setLocation} disabled={submitting} />
              </Field>
              <Field label="Хамгаалалт" error={fieldErrors['panel.protection']}>
                <TextInput value={protection} onChange={setProtection} disabled={submitting} />
              </Field>
            </div>
          </fieldset>
        )}

        {category === 'CIRCUIT' && (
          <fieldset aria-label="Хэлхээний мэдээлэл">
            <legend className="mb-3 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
              Хэлхээний мэдээлэл
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Харьяалагдах самбар" error={fieldErrors['circuit.panelId']}>
                <SelectInput
                  value={panelId}
                  onChange={setPanelId}
                  placeholder="Самбар сонгох"
                  options={panels.map((panel) => ({
                    value: panel.id,
                    label: `${panel.name} (${panel.code})`,
                  }))}
                  disabled={submitting || !customerId}
                />
              </Field>
              <Field label="Хамгаалах автомат" error={fieldErrors['circuit.breakerRating']}>
                <TextInput value={breakerRating} onChange={setBreakerRating} disabled={submitting} />
              </Field>
              <Field label="Зөвшөөрөгдөх чадал (kW)" error={fieldErrors['circuit.permittedCapacityKw']}>
                <TextInput
                  type="number"
                  value={permittedCapacityKw}
                  onChange={setPermittedCapacityKw}
                  disabled={submitting}
                />
              </Field>
              <Field label="Кабелийн төрөл" error={fieldErrors['circuit.cableType']}>
                <TextInput value={cableType} onChange={setCableType} disabled={submitting} />
              </Field>
              <Field label="Огтлол (мм²)" error={fieldErrors['circuit.cableSectionMm2']}>
                <TextInput
                  type="number"
                  value={cableSectionMm2}
                  onChange={setCableSectionMm2}
                  disabled={submitting}
                />
              </Field>
              <Field label="Урт (м)" error={fieldErrors['circuit.cableLengthM']}>
                <TextInput type="number" value={cableLengthM} onChange={setCableLengthM} disabled={submitting} />
              </Field>
            </div>
          </fieldset>
        )}

        {category === 'EQUIPMENT' && (
          <fieldset aria-label="Тоноглолын мэдээлэл">
            <legend className="mb-3 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
              Тоноглолын мэдээлэл
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Тэжээх хэлхээ" error={fieldErrors['equipment.circuitId']}>
                <SelectInput
                  value={circuitId}
                  onChange={setCircuitId}
                  placeholder="Хэлхээнд холбохгүй"
                  options={circuits.map((circuit) => ({
                    value: circuit.id,
                    label: `${circuit.name} (${circuit.code})`,
                  }))}
                  disabled={submitting || !customerId}
                />
              </Field>
              <Field
                label="Нэрлэсэн чадал (kW)"
                error={fieldErrors['equipment.ratedPowerKw']}
                hint="Ачааллын тооцоонд ашиглана"
              >
                <TextInput type="number" value={ratedPowerKw} onChange={setRatedPowerKw} disabled={submitting} />
              </Field>
              <Field label="Тоо ширхэг" error={fieldErrors['equipment.quantity']}>
                <TextInput type="number" value={quantity} onChange={setQuantity} disabled={submitting} />
              </Field>
              <Field
                label="Ашиглалтын коэффициент"
                error={fieldErrors['equipment.usageCoefficient']}
                hint="Хоосон бол 1.0 гэж тооцно"
              >
                <TextInput
                  type="number"
                  value={usageCoefficient}
                  onChange={setUsageCoefficient}
                  disabled={submitting}
                />
              </Field>
              <Field label="Суурилуулсан огноо" error={fieldErrors['equipment.installedAt']}>
                <TextInput type="date" value={installedAt} onChange={setInstalledAt} disabled={submitting} />
              </Field>
              <Field label="Баталгаат хугацаа" error={fieldErrors['equipment.warrantyUntil']}>
                <TextInput type="date" value={warrantyUntil} onChange={setWarrantyUntil} disabled={submitting} />
              </Field>
            </div>
          </fieldset>
        )}

        {showInitialScore && (
          <fieldset aria-label="Анхны үнэлгээ">
            <legend className="mb-3 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
              Анхны үнэлгээ
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field
                label="Үнэлгээ (0-100)"
                error={fieldErrors['assessment.newScore']}
                hint="Хоосон бол үнэлгээгүй хэвээр үлдэнэ"
              >
                <TextInput
                  type="number"
                  value={initialScore}
                  onChange={setInitialScore}
                  disabled={submitting}
                />
              </Field>
              <Field label="Дүгнэлт" error={fieldErrors['assessment.conclusion']}>
                <TextInput
                  value={initialConclusion}
                  onChange={setInitialConclusion}
                  disabled={submitting}
                />
              </Field>
              <Field label="Зөвлөмж" error={fieldErrors['assessment.recommendation']}>
                <TextInput
                  value={initialRecommendation}
                  onChange={setInitialRecommendation}
                  disabled={submitting}
                />
              </Field>
            </div>

            {/* An assessment is only recorded with evidence behind it, so the photo sits
                with the score rather than being asked for afterwards. */}
            <div className="mt-3">
              <label
                htmlFor="object-initial-photo"
                className={FILTER_LABEL}
              >
                Нотлох зураг
              </label>
              <input
                id="object-initial-photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={submitting}
                onChange={(event) => setInitialPhoto(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:text-slate-700"
              />
              <p className="mt-1 text-xs text-slate-500">
                Үнэлгээ оруулсан бол зураг заавал хавсаргана.
              </p>
              {fieldErrors['assessment.photoIds'] && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors['assessment.photoIds']}</p>
              )}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor="object-description" className={FILTER_LABEL}>
            Тайлбар
          </label>
          <textarea
            id="object-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
          {fieldErrors.description && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
          )}
        </div>

        <div>
          <label htmlFor="object-notes" className={FILTER_LABEL}>
            Тэмдэглэл
          </label>
          <textarea
            id="object-notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
          {fieldErrors.notes && <p className="mt-1 text-xs text-red-600">{fieldErrors.notes}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={() => navigate(-1)} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </div>
      </div>
    </>
  );
}
