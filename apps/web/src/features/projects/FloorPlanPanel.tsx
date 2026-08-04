import {
  createObjectSchema,
  floorPlanMetaSchema,
  type FloorPlanDto,
  type ObjectListItemDto,
  type ObjectTypeDto,
  type PlanPositionDto,
} from '@monhorus/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Drawer } from '../../components/ui/Drawer';
import { RISK_SURFACE_STYLES } from '../../components/ui/DomainBadges';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { authorisedFileUrl } from '../../lib/file-url';
import { objectMasterService, objectTypeService } from '../../services/object-master.service';
import { projectService } from '../../services/project.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

interface FloorPlanPanelProps {
  floorId: string;
  plan: FloorPlanDto | null;
  canManage: boolean;
  /** Objects linked to this floor, drawn as markers where they carry a position. */
  objects: readonly ObjectListItemDto[];
  /** The floor's tenant. An object belongs to a customer, not to a floor. */
  customerId: string;
  /** object_master.manage on an active floor: may place, move and clear markers. */
  canPlace: boolean;
  onChanged: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How far a press has to travel before it counts as a drag rather than a click.
 *
 * In device pixels, because that is what a hand shaking on a mouse button produces; a
 * fraction of the plan would mean something different on every screen.
 */
const DRAG_THRESHOLD_PX = 4;

/**
 * Turns a pointer position into a plan coordinate.
 *
 * Measured against the rendered image's own box, so the result is the same fraction of the
 * drawing whatever size the image happens to be laid out at — which is the whole reason the
 * stored coordinates are fractions rather than pixels. A zero-sized box means the image has
 * not been laid out yet and there is nothing meaningful to compute.
 */
function positionWithin(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): PlanPositionDto | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/**
 * Accepted formats and the real ceiling.
 *
 * The size matches MAX_FILE_BYTES in the storage service rather than the figure in the
 * prototype, so the hint states the limit that is actually enforced.
 */
const ACCEPTED_HINT = 'PNG, JPG, WEBP, PDF - хамгийн ихдээ 10MB';

/**
 * Floor plan image with object placement (requirements 11.1 and 11.2, rule 17.3).
 *
 * One current image, shown immediately, with the objects on the floor drawn on top of it.
 * There is still no version list and no version switch: section 19.2 leaves the plan editor
 * format unapproved, so the image is stored and displayed and every change is audited.
 *
 * The coordinate model is the smallest one that survives the plan being replaced: a
 * fraction of the image's width and height, resolved from the rendered box, never a pixel
 * pair. Which types may be placed is not decided here either — it is read from the type
 * registry's `showOnPlan` flag, which is what that flag has always meant.
 */
export function FloorPlanPanel({
  floorId,
  plan,
  canManage,
  objects,
  customerId,
  canPlace,
  onChanged,
}: FloorPlanPanelProps): ReactElement {
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  /** Where a marker press started, so a click can be told apart from a drag on release. */
  const dragOriginRef = useRef<{ objectId: string; clientX: number; clientY: number } | null>(null);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // -- Placement -------------------------------------------------------------
  const [placeableTypes, setPlaceableTypes] = useState<ObjectTypeDto[]>([]);
  const [pendingPosition, setPendingPosition] = useState<PlanPositionDto | null>(null);
  const [quickTypeId, setQuickTypeId] = useState('');
  const [quickCode, setQuickCode] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickFieldErrors, setQuickFieldErrors] = useState<Record<string, string>>({});
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null);

  const isPdf = plan?.mimeType === 'application/pdf';
  // PDFs are not rasterised anywhere in this app, so there is no picture to measure a
  // coordinate against. The plan still renders as a link; only placement is withheld.
  const placementAvailable = Boolean(plan) && !isPdf;

  /**
   * Which types may appear on a plan.
   *
   * `ObjectType.showOnPlan` is the registry's own answer to "план дээр объект болгон
   * байрлуулах боломж", so it is read rather than reinvented: a type without it is not
   * offered in the quick-create picker and its objects are not drawn as markers.
   */
  useEffect(() => {
    if (!placementAvailable) return undefined;
    let cancelled = false;
    objectTypeService
      .list({ isActive: true, limit: 100 })
      .then((page) => {
        if (!cancelled) setPlaceableTypes(page.items.filter((type) => type.showOnPlan));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [placementAvailable]);

  const placeableTypeIds = new Set(placeableTypes.map((type) => type.id));
  const markers = objects.filter(
    (object) =>
      object.planPosition !== null &&
      object.objectType !== null &&
      placeableTypeIds.has(object.objectType.id),
  );
  const unplacedCount = objects.filter(
    (object) =>
      object.planPosition === null &&
      object.objectType !== null &&
      placeableTypeIds.has(object.objectType.id),
  ).length;
  const selectedObject = markers.find((object) => object.id === selectedObjectId) ?? null;

  useEffect(() => {
    if (!metaOpen) return;
    setTitle(plan?.title ?? '');
    setDescription(plan?.description ?? '');
  }, [metaOpen, plan]);

  /**
   * The download route is authenticated, so the image cannot be used as a bare `src`.
   * It is fetched with the bearer token and turned into an object URL, which is revoked
   * when the plan changes or the panel unmounts.
   */
  useEffect(() => {
    if (!plan) {
      setPreviewUrl(null);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;

    void authorisedFileUrl(plan.downloadUrl)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch(() => setPreviewUrl(null));

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [plan]);

  async function handleUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await projectService.uploadFloorPlan(floorId, file);
      notify(plan ? 'План зураг солигдлоо.' : 'План зураг хавсаргагдлаа.', 'success');
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'План зураг хуулж чадсангүй.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveMeta(): Promise<void> {
    const parsed = floorPlanMetaSchema.safeParse({
      title: title.trim() || null,
      description: description.trim() || null,
    });
    if (!parsed.success) return;

    setSavingMeta(true);
    setError(null);
    try {
      await projectService.updateFloorPlanMeta(floorId, parsed.data);
      notify('План зургийн мэдээлэл шинэчлэгдлээ.', 'success');
      setMetaOpen(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Хадгалж чадсангүй.');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleRemove(): Promise<void> {
    setError(null);
    try {
      await projectService.removeFloorPlan(floorId);
      notify('План зураг устгагдлаа.', 'success');
      setRemoveOpen(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.');
      setRemoveOpen(false);
    }
  }

  /** A click on bare plan is a request to register something there. */
  function handlePlanClick(event: ReactPointerEvent<HTMLElement>): void {
    if (!canPlace || !placementAvailable || draggingObjectId) return;
    if (!imageRef.current) return;
    const position = positionWithin(imageRef.current, event.clientX, event.clientY);
    if (!position) return;

    setSelectedObjectId(null);
    setQuickError(null);
    setQuickFieldErrors({});
    setQuickTypeId(placeableTypes.length === 1 ? (placeableTypes[0]?.id ?? '') : '');
    setQuickCode('');
    setQuickName('');
    setPendingPosition(position);
  }

  /**
   * Registers the object at the pinned spot.
   *
   * Deliberately three fields. Everything else on the full form is optional at the API, so
   * asking for it here would rebuild the very screen this replaces; the object opens in the
   * full form afterwards for whoever wants to complete it.
   */
  async function handleQuickCreate(): Promise<void> {
    if (!pendingPosition) return;
    setQuickError(null);
    setQuickFieldErrors({});

    const type = placeableTypes.find((entry) => entry.id === quickTypeId) ?? null;
    if (!type) {
      setQuickFieldErrors({ objectTypeId: 'Төрөл сонгоно уу.' });
      return;
    }

    // The create payload is a discriminated union: the block belonging to the type's
    // category has to be present even when every field in it is empty.
    const attributes =
      type.category === 'PANEL'
        ? { panel: {} }
        : type.category === 'CIRCUIT'
          ? { circuit: {} }
          : { equipment: {} };

    const parsed = createObjectSchema.safeParse({
      code: quickCode.trim().toUpperCase(),
      name: quickName.trim(),
      customerId,
      objectTypeId: type.id,
      floorId,
      category: type.category,
      planPosition: pendingPosition,
      ...attributes,
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setQuickFieldErrors(errors);
      setQuickError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setQuickSaving(true);
    try {
      await objectMasterService.create(parsed.data);
      notify('Тоноглол план дээр бүртгэгдлээ.', 'success');
      setPendingPosition(null);
      onChanged();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setQuickError(caught.message);
        setQuickFieldErrors(caught.fieldErrors);
      } else {
        setQuickError('Бүртгэж чадсангүй.');
      }
    } finally {
      setQuickSaving(false);
    }
  }

  async function movePin(objectId: string, position: PlanPositionDto | null): Promise<void> {
    try {
      await objectMasterService.updatePosition(objectId, { planPosition: position });
      notify(position ? 'Байрлал шинэчлэгдлээ.' : 'Байрлал арилгагдлаа.', 'success');
      onChanged();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Байрлал хадгалж чадсангүй.', 'error');
    }
  }

  /**
   * Drag to reposition.
   *
   * Pointer capture keeps the events coming to the marker even when the pointer leaves it,
   * so a drag that overshoots the image still lands — clamped back onto the plan by
   * `positionWithin`. A press that did not travel is a selection rather than a move, which
   * is why the press coordinates are kept: without them a click and a drag are the same
   * pair of events.
   */
  function handleMarkerPointerDown(event: ReactPointerEvent<HTMLElement>, objectId: string): void {
    event.stopPropagation();
    if (!canPlace) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingObjectId(objectId);
    dragOriginRef.current = { objectId, clientX: event.clientX, clientY: event.clientY };
  }

  function handleMarkerPointerUp(event: ReactPointerEvent<HTMLElement>, objectId: string): void {
    event.stopPropagation();
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    setDraggingObjectId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const toggleSelection = (): void =>
      setSelectedObjectId((current) => (current === objectId ? null : objectId));

    if (!origin || origin.objectId !== objectId) {
      toggleSelection();
      return;
    }

    const travelled =
      Math.abs(event.clientX - origin.clientX) + Math.abs(event.clientY - origin.clientY);
    if (travelled < DRAG_THRESHOLD_PX) {
      toggleSelection();
      return;
    }

    const next = imageRef.current
      ? positionWithin(imageRef.current, event.clientX, event.clientY)
      : null;
    if (!next) {
      toggleSelection();
      return;
    }

    void movePin(objectId, next);
  }

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,application/pdf"
      className="hidden"
      aria-label="План зураг сонгох"
      onChange={(event) => {
        void handleUpload(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">План зураг</h2>
        {canManage && plan && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
            >
              Зураг солих
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMetaOpen(true)}>
              Мэдээлэл засах
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoveOpen(true)}>
              Устгах
            </Button>
          </div>
        )}
      </div>

      <div className="p-5">
        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {!plan ? (
          canManage ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void handleUpload(event.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50'
              }`}
            >
              <svg
                className="mb-3 h-10 w-10 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5V18a3 3 0 003 3h12a3 3 0 003-3v-1.5M7.5 9L12 4.5 16.5 9M12 4.5V16"
                />
              </svg>
              <p className="text-sm font-medium text-slate-900">План зураг хавсаргаагүй байна</p>
              {/* The drag target is not discoverable without saying so; the sentence
                  explaining what a plan is for has gone. */}
              <p className="mt-1 text-xs text-slate-500">Файл чирж оруулна уу эсвэл сонгоно уу.</p>
              <p className="mt-1 text-xs text-slate-400">{ACCEPTED_HINT}</p>
              <div className="mt-4">
                <Button onClick={() => fileInputRef.current?.click()} loading={uploading}>
                  План зураг хуулах
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              title="План зураг хавсаргаагүй байна"
              description="Энэ давхарт план зураг хавсаргаагүй байна."
            />
          )
        ) : (
          <div className="space-y-3">
            {plan.title && <p className="text-sm font-medium text-slate-900">{plan.title}</p>}
            {plan.description && <p className="text-xs text-slate-600">{plan.description}</p>}

            <div className="overflow-auto rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
              {isPdf ? (
                <div className="flex flex-col items-start gap-2 p-4">
                  <p className="text-sm text-slate-700">{plan.fileName}</p>
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      PDF нээх
                    </a>
                  )}
                  {/* No rasteriser here, so there is no picture to measure against. The
                      plan stays readable; only placement is withheld, and it is said why. */}
                  <p className="text-xs text-slate-500">
                    PDF план дээр тоноглол байрлуулах боломжгүй. Байрлуулахын тулд PNG, JPG
                    эсвэл WEBP хэлбэрээр хуулна уу.
                  </p>
                </div>
              ) : previewUrl ? (
                /*
                  The positioned container: the image, and a marker layer laid over exactly
                  its box. The layer is sized by the image rather than by the card, so a
                  marker at 0.5, 0.5 sits at the middle of the drawing and not of the panel.
                */
                <div className="relative mx-auto w-fit">
                  <img
                    ref={imageRef}
                    src={previewUrl}
                    alt={plan.title ?? 'Давхарын план зураг'}
                    className="mx-auto block max-h-[520px] w-auto max-w-full"
                    onPointerUp={handlePlanClick}
                    style={canPlace ? { cursor: 'crosshair' } : undefined}
                  />

                  <div
                    role="group"
                    aria-label="План дээрх тоноглол"
                    className="pointer-events-none absolute inset-0"
                  >
                    {markers.map((object) => {
                      const level = object.latestAssessment?.riskLevel ?? 'UNASSESSED';
                      return (
                        <button
                          key={object.id}
                          type="button"
                          aria-label={`${object.code} · ${object.name}`}
                          title={`${object.code} · ${object.name}`}
                          onPointerDown={(event) => handleMarkerPointerDown(event, object.id)}
                          onPointerUp={(event) => handleMarkerPointerUp(event, object.id)}
                          className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-2 ring-inset shadow-sm ${
                            RISK_SURFACE_STYLES[level]
                          } ${selectedObjectId === object.id ? 'outline outline-2 outline-offset-2 outline-blue-500' : ''} ${
                            canPlace ? 'cursor-move' : 'cursor-pointer'
                          }`}
                          style={{
                            left: `${(object.planPosition?.x ?? 0) * 100}%`,
                            top: `${(object.planPosition?.y ?? 0) * 100}%`,
                          }}
                        >
                          {object.code}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="h-48 animate-pulse rounded bg-slate-200" />
              )}
            </div>

            {placementAvailable && (
              <div className="space-y-2">
                {placeableTypes.length === 0 ? (
                  <Alert variant="info">
                    План дээр байрлуулах тоноглолын төрөл тохируулагдаагүй байна. Тоноглолын
                    төрөл дээр "План дээр харуулах" сонголтыг идэвхжүүлнэ үү.
                  </Alert>
                ) : (
                  <p className="text-xs text-slate-500">
                    {canPlace
                      ? 'План дээр дарж тоноглол бүртгэнэ. Тэмдэглэгээг чирж байрлалыг өөрчилнө.'
                      : 'План дээрх тэмдэглэгээ нь тухайн тоноглолын эрсдэлийн түвшнийг харуулна.'}
                    {unplacedCount > 0 && ` Байрлуулаагүй ${unplacedCount} тоноглол байна.`}
                  </p>
                )}

                {selectedObject && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
                    <span className="text-xs font-medium text-slate-900">
                      {selectedObject.code} · {selectedObject.name}
                    </span>
                    <Link
                      to={`/floors/${floorId}/objects/${selectedObject.id}`}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Дэлгэрэнгүй
                    </Link>
                    {canPlace && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedObjectId(null);
                          void movePin(selectedObject.id, null);
                        }}
                      >
                        Байрлал арилгах
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-slate-500">
              {plan.fileName} · {(plan.sizeBytes / 1024).toFixed(0)} KB ·{' '}
              {plan.uploadedByName ?? '-'} · {formatDateTime(plan.uploadedAt)}
            </p>
            {canManage && <p className="text-xs text-slate-400">{ACCEPTED_HINT}</p>}
          </div>
        )}

        {hiddenInput}
      </div>

      <Drawer
        open={metaOpen}
        title="План зургийн мэдээлэл"
        onClose={() => setMetaOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMetaOpen(false)} disabled={savingMeta}>
              Цуцлах
            </Button>
            <Button onClick={() => void handleSaveMeta()} loading={savingMeta}>
              Хадгалах
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Гарчиг">
            <TextInput value={title} onChange={setTitle} disabled={savingMeta} />
          </Field>
          <div>
            <label htmlFor="plan-description" className={FILTER_LABEL}>
              Тайлбар
            </label>
            <textarea
              id="plan-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={savingMeta}
              className={FIELD_TEXTAREA}
            />
          </div>
        </div>
      </Drawer>

      {/*
        Quick registration at the pinned spot.

        A drawer rather than a route to the full object form: the point of clicking the plan
        is that the placement is the context, and pushing a route would throw that away and
        ask for the floor and the customer again. Only the fields the API actually requires
        are here; the rest is optional and can be filled in on the object afterwards.
      */}
      <Drawer
        open={pendingPosition !== null}
        title="План дээр тоноглол бүртгэх"
        onClose={() => setPendingPosition(null)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPendingPosition(null)}
              disabled={quickSaving}
            >
              Цуцлах
            </Button>
            <Button onClick={() => void handleQuickCreate()} loading={quickSaving}>
              Бүртгэх
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {quickError && <Alert variant="error">{quickError}</Alert>}

          <Field label="Тоноглолын төрөл" required error={quickFieldErrors.objectTypeId}>
            <SelectInput
              value={quickTypeId}
              onChange={setQuickTypeId}
              placeholder={
                placeableTypes.length === 0 ? 'План дээр харуулах төрөл алга' : 'Төрөл сонгох'
              }
              options={placeableTypes.map((type) => ({
                value: type.id,
                label: `${type.name} (${type.code})`,
              }))}
              disabled={quickSaving || placeableTypes.length === 0}
            />
          </Field>

          <Field label="Код" required error={quickFieldErrors.code}>
            <TextInput
              value={quickCode}
              onChange={(value) => setQuickCode(value.toUpperCase())}
              disabled={quickSaving}
            />
          </Field>

          <Field label="Нэр" required error={quickFieldErrors.name}>
            <TextInput value={quickName} onChange={setQuickName} disabled={quickSaving} />
          </Field>

          {pendingPosition && (
            <p className="text-xs text-slate-500">
              План дээрх байрлал: {(pendingPosition.x * 100).toFixed(1)}% ·{' '}
              {(pendingPosition.y * 100).toFixed(1)}%
            </p>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={removeOpen}
        title="План зураг устгах"
        message="Давхарын план зургийг устгах уу? Энэ үйлдэл audit log-д бүртгэгдэнэ."
        confirmLabel="Устгах"
        danger
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => handleRemove()}
      />
    </div>
  );
}
