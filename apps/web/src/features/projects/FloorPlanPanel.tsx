import {
  createObjectSchema,
  floorPlanMetaSchema,
  type FloorPlanDto,
  type ObjectIcon,
  type ObjectListItemDto,
  type ObjectTypeDto,
  type PlanPositionDto,
} from '@monhorus/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { Link } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_INPUT, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { authorisedFileUrl } from '../../lib/file-url';
import { useAuthorisedFileUrls } from '../../lib/use-authorised-file-urls';
import { objectMasterService, objectTypeService } from '../../services/object-master.service';
import { projectService } from '../../services/project.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';
import { FloorPlanCanvas, type PlanFocusRequest, type PlanMarker } from './FloorPlanCanvas';
import { samePlanPosition } from './plan-geometry';
import { ObjectTypeGlyph } from './plan-icons';

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

/**
 * Accepted formats and the real ceiling.
 *
 * The size matches MAX_FILE_BYTES in the storage service rather than the figure in the
 * prototype, so the hint states the limit that is actually enforced.
 */
const ACCEPTED_HINT = 'PNG, JPG, WEBP, PDF - хамгийн ихдээ 10MB';

/**
 * One switchable group of markers: an object type that this floor actually uses.
 *
 * Built from the objects in hand, never from the registry. The registry knows every type
 * the tenant has ever defined, which on a floor holding lights and sockets would be a
 * filter listing a dozen things that are not there; what a user wants to switch off is what
 * they can see.
 */
interface PlanLayer {
  typeId: string;
  name: string;
  icon: ObjectIcon | null;
  /** The type's custom icon as an object url, or null for the built-in glyph. */
  iconUrl: string | null;
  /** Markers of this type currently on the plan — that is, what hiding it takes away. */
  count: number;
}

/**
 * Which layers the user has switched off, per floor.
 *
 * `sessionStorage`, not `localStorage`, and this is the one place in the app that draws the
 * distinction. A hidden column in a table announces itself by the gap it leaves; a hidden
 * layer leaves a plan that simply looks like it has fewer things on it, and carrying that
 * across days would eventually be reported as missing equipment. A tab is the longest a
 * view choice like that should outlive.
 *
 * The HIDDEN ids are stored rather than the shown ones, so a type added to the floor
 * afterwards is visible by default rather than silently absent.
 */
function layerStorageKey(floorId: string): string {
  return `monhorus.plan-layers.${floorId}`;
}

function readHiddenLayers(floorId: string): string[] {
  try {
    const raw = sessionStorage.getItem(layerStorageKey(floorId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    // A corrupt or unavailable store shows everything rather than taking the plan down.
    return [];
  }
}

function writeHiddenLayers(floorId: string, hidden: readonly string[]): void {
  try {
    sessionStorage.setItem(layerStorageKey(floorId), JSON.stringify(hidden));
  } catch {
    // A blocked or full store must not stop the layer from switching off.
  }
}

/** Why a search result cannot be travelled to, if it cannot. */
type SearchResultState =
  /** Drawn on the plan: selecting it centres the view on it. */
  | 'onPlan'
  /** A type that belongs on plans, but this one has never been placed. */
  | 'unplaced'
  /** A type the registry does not draw on plans at all. */
  | 'notDrawn';

interface SearchResult {
  object: ObjectListItemDto;
  state: SearchResultState;
  /** The layer is off. Selecting it switches the layer back on. */
  layerHidden: boolean;
}

/**
 * Enough results to choose from, not enough to bury the drawing.
 *
 * Every object on the floor is in memory, so a two-letter query can match hundreds. The
 * remainder is counted rather than dropped in silence, which is what tells the user to type
 * more instead of scrolling.
 */
const SEARCH_RESULT_LIMIT = 8;

/**
 * Floor plan image with object placement (requirements 11.1 and 11.2, rule 17.3).
 *
 * One current image, shown immediately, with the objects on the floor drawn on top of it.
 * There is still no version list and no version switch: section 19.2 leaves the plan editor
 * format unapproved, so the image is stored and displayed and every change is audited.
 *
 * The coordinate model is the smallest one that survives the plan being replaced: a
 * fraction of the image's width and height, never a pixel pair. Which types may be placed
 * is not decided here either — it is read from `showOnPlan`, which is what that flag has
 * always meant.
 *
 * Moving a marker is an explicit mode rather than something that happens to anyone who
 * drags. Off, the plan is a picture that can be zoomed, panned and read; on, positions are
 * drafted locally and nothing reaches the server until Save, so a mis-drag is undone by
 * Cancel instead of by another drag.
 *
 * Two controls sit above the drawing, and both are views over the same objects and nothing
 * more. The layer filter switches whole types of marker off, so a crowded plan can be read
 * one trade at a time; it changes what is drawn and never what is stored, which is why it
 * is allowed to be on at the same time as the edit mode. The search finds an object on the
 * floor by code or name and sends the view to it, which is the only way to reach a marker
 * on a large plan without hunting for it.
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
  const [typesError, setTypesError] = useState<string | null>(null);

  // -- Position editing ------------------------------------------------------
  const [editing, setEditing] = useState(false);
  /**
   * Positions moved since edit mode was entered, by object id.
   *
   * A `null` entry is a position being taken away. Nothing here has been written: the
   * markers are drawn from this over the top of `objects`, which is what makes Cancel a
   * matter of forgetting rather than of restoring.
   */
  const [draft, setDraft] = useState<Record<string, PlanPositionDto | null>>({});
  const [savingPositions, setSavingPositions] = useState(false);

  // -- View: layers and search -----------------------------------------------
  const [hiddenTypeIds, setHiddenTypeIds] = useState<readonly string[]>(() =>
    readHiddenLayers(floorId),
  );
  const [query, setQuery] = useState('');
  const [focusRequest, setFocusRequest] = useState<PlanFocusRequest | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  /**
   * The panel outlives the floor when the route changes under it, and one floor's hidden
   * layers mean nothing on another's types.
   */
  const loadedFloorRef = useRef(floorId);
  useEffect(() => {
    if (loadedFloorRef.current === floorId) return;
    loadedFloorRef.current = floorId;
    setHiddenTypeIds(readHiddenLayers(floorId));
    setQuery('');
    setFocusRequest(null);
  }, [floorId]);

  const isPdf = plan?.mimeType === 'application/pdf';
  // PDFs are not rasterised anywhere in this app, so there is no picture to measure a
  // coordinate against. The plan still renders as a link; only placement is withheld.
  const placementAvailable = Boolean(plan) && !isPdf;

  /**
   * The catalogue behind the quick-create picker.
   *
   * Only that. Whether an object may be *drawn* is answered by `objectType.showOnPlan` on
   * the row itself, which the list endpoint inlines precisely so a client that already
   * holds the objects need not fetch the registry to draw them. It used to be fetched for
   * both, and a failed request — swallowed — blanked every marker on the plan while
   * reporting nothing. Now a failure costs the picker and says so, and the plan still
   * draws. It is also not fetched at all for a caller who cannot place anything.
   */
  useEffect(() => {
    if (!placementAvailable || !canPlace) return undefined;
    let cancelled = false;
    objectTypeService
      .list({ isActive: true, limit: 100 })
      .then((page) => {
        if (cancelled) return;
        setPlaceableTypes(page.items.filter((type) => type.showOnPlan));
        setTypesError(null);
      })
      .catch(() => {
        if (!cancelled) setTypesError('Тоноглолын төрлийн жагсаалт ачаалж чадсангүй.');
      });
    return () => {
      cancelled = true;
    };
  }, [placementAvailable, canPlace]);

  /** Objects the registry allows on a plan, placed or not. */
  const planObjects = objects.filter((object) => object.objectType?.showOnPlan === true);

  /**
   * The custom type icons this floor uses, fetched once each.
   *
   * `GET /files/:id` wants the bearer token, so an icon cannot be a bare `img src` any more
   * than the plan image can. They are resolved here, at the one place that already holds
   * every object on the floor, rather than inside the marker: forty breakers share one
   * icon file, and that has to be one request and one blob, not forty of each. Keyed by the
   * icon's own path for the same reason — two types pointing at the same file cost one
   * fetch, and a type with no custom icon costs nothing at all.
   *
   * An icon that fails to load simply never appears in the map, and the marker falls back
   * to its built-in glyph. A missing picture must not take a plan down.
   */
  const iconFiles = [
    ...new Set(
      planObjects
        .map((object) => object.objectType?.iconUrl ?? null)
        .filter((url): url is string => url !== null),
    ),
  ].map((url) => ({ id: url, downloadUrl: url }));
  const iconUrls = useAuthorisedFileUrls(iconFiles);

  /** The drawable url for a type's icon path, or null while it is still on its way. */
  function resolvedIconUrl(iconUrl: string | null | undefined): string | null {
    return iconUrl ? (iconUrls[iconUrl] ?? null) : null;
  }

  /** The position a marker is drawn at: the drafted one where there is one. */
  function effectivePosition(object: ObjectListItemDto): PlanPositionDto | null {
    return object.id in draft ? draft[object.id]! : object.planPosition;
  }

  const hidden = new Set(hiddenTypeIds);

  /**
   * The floor's own layer list, in the order a reader would look for a type.
   *
   * Derived every render from the rows already loaded — no request, no hardcoded list, and
   * nothing left over from a floor that had different equipment on it.
   */
  const layers: PlanLayer[] = (() => {
    const byType = new Map<string, PlanLayer>();
    for (const object of planObjects) {
      const type = object.objectType;
      if (!type) continue;
      const existing = byType.get(type.id);
      const drawn = effectivePosition(object) !== null ? 1 : 0;
      if (existing) {
        existing.count += drawn;
      } else {
        byType.set(type.id, {
          typeId: type.id,
          name: type.name,
          icon: type.icon,
          iconUrl: resolvedIconUrl(type.iconUrl),
          count: drawn,
        });
      }
    }
    return [...byType.values()].sort((a, b) => a.name.localeCompare(b.name, 'mn'));
  })();

  const hiddenLayerCount = layers.filter((layer) => hidden.has(layer.typeId)).length;

  /**
   * Filtering is a view, so it happens here and nowhere else.
   *
   * A hidden marker is simply not drawn. It keeps its draft, it keeps its place in
   * `pendingMoves`, and Save writes it like any other: what a layer switch changes is what
   * is on screen, never what is on the record. Hiding a type mid-drag therefore ends the
   * gesture — the node it was dragging is gone — and leaves the position the drag had
   * reached in the draft, where Cancel discards it and Save writes it.
   */
  const visiblePlanObjects = planObjects.filter(
    (object) => !hidden.has(object.objectType?.id ?? ''),
  );

  const markers: PlanMarker[] = visiblePlanObjects.flatMap((object) => {
    const position = effectivePosition(object);
    if (!position) return [];
    return [
      {
        id: object.id,
        code: object.code,
        name: object.name,
        icon: object.objectType?.icon ?? null,
        iconUrl: resolvedIconUrl(object.objectType?.iconUrl),
        typeName: object.objectType?.name ?? null,
        riskLevel: object.latestAssessment?.riskLevel ?? 'UNASSESSED',
        position,
      },
    ];
  });
  const unplacedCount = planObjects.filter((object) => effectivePosition(object) === null).length;
  const selectedObject = planObjects.find((object) => object.id === selectedObjectId) ?? null;

  /** Drafted positions that actually differ from what is stored. */
  const pendingMoves = Object.entries(draft).filter(([objectId, position]) => {
    const stored = objects.find((object) => object.id === objectId)?.planPosition ?? null;
    return !samePlanPosition(position, stored);
  });

  /**
   * Unsaved moves the user cannot currently see.
   *
   * Said out loud rather than prevented. Hiding a layer does not drop its drafts, so the
   * count above the plan would otherwise name changes with no marker to point at.
   */
  const hiddenPendingCount = pendingMoves.filter(([objectId]) => {
    const typeId = objects.find((object) => object.id === objectId)?.objectType?.id;
    return typeId !== undefined && hidden.has(typeId);
  }).length;

  /**
   * The floor's objects by code or name, case-insensitively, over the rows already loaded.
   *
   * Every object on the floor is searched, not just the placeable ones. Someone typing a
   * code is asking where a thing is, and "no results" is a worse answer than "it exists,
   * and here is why it is not on the drawing" — so an object that has never been placed,
   * and one whose type is never drawn on plans at all, are both listed and both say so.
   */
  const trimmedQuery = query.trim().toLowerCase();
  const matches: SearchResult[] =
    trimmedQuery === ''
      ? []
      : objects
          .filter(
            (object) =>
              object.code.toLowerCase().includes(trimmedQuery) ||
              object.name.toLowerCase().includes(trimmedQuery),
          )
          .map((object) => {
            const type = object.objectType;
            const state: SearchResultState =
              type?.showOnPlan !== true
                ? 'notDrawn'
                : effectivePosition(object) === null
                  ? 'unplaced'
                  : 'onPlan';
            return {
              object,
              state,
              layerHidden: state === 'onPlan' && type !== null && hidden.has(type.id),
            };
          });
  const shownMatches = matches.slice(0, SEARCH_RESULT_LIMIT);

  function applyHiddenLayers(next: readonly string[]): void {
    setHiddenTypeIds(next);
    writeHiddenLayers(floorId, next);
  }

  function toggleLayer(typeId: string): void {
    applyHiddenLayers(
      hidden.has(typeId)
        ? hiddenTypeIds.filter((entry) => entry !== typeId)
        : [...hiddenTypeIds, typeId],
    );
  }

  /**
   * Travels to a result.
   *
   * A result whose layer is off switches that layer back on rather than refusing to be
   * selected. The user has just named the object; a view toggle they set earlier is not an
   * answer to that, and the alternative — a result that visibly does nothing when pressed —
   * is the kind of dead end that gets reported as a broken search. The chip lights up in
   * the same gesture, so the change to the view is visible where it was made.
   */
  function focusResult(result: SearchResult): void {
    if (result.state !== 'onPlan') return;
    const typeId = result.object.objectType?.id;
    if (typeId !== undefined && hidden.has(typeId)) {
      applyHiddenLayers(hiddenTypeIds.filter((entry) => entry !== typeId));
    }
    setSelectedObjectId(result.object.id);
    setFocusRequest((current) => ({ objectId: result.object.id, seq: (current?.seq ?? 0) + 1 }));
    setQuery('');
  }

  /**
   * Arrow keys walk the results, Escape gives up on them.
   *
   * The results are ordinary buttons, so Tab and Enter already work; this is the shortcut a
   * search box is expected to have. Focus is moved by walking the rendered buttons rather
   * than by tracking an active index, because the only two things that can change the list
   * under the user are typing and selecting, and both end the walk anyway.
   */
  function focusResultButton(index: number): void {
    const buttons = resultsRef.current?.querySelectorAll<HTMLButtonElement>('[data-result]');
    if (!buttons || buttons.length === 0) return;
    const wrapped = (index + buttons.length) % buttons.length;
    buttons[wrapped]?.focus();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusResultButton(0);
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  }

  function handleResultKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusResultButton(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusResultButton(index - 1);
    } else if (event.key === 'Escape') {
      setQuery('');
    }
  }

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
  function handlePlanClick(position: PlanPositionDto): void {
    if (!canPlace || !placementAvailable) return;

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

  /** A drag in progress. Drafted, never sent. */
  const handleMarkerMove = useCallback((objectId: string, position: PlanPositionDto): void => {
    setDraft((current) => ({ ...current, [objectId]: position }));
  }, []);

  const handleMarkerSelect = useCallback((objectId: string | null): void => {
    setSelectedObjectId((current) => (objectId !== null && current === objectId ? null : objectId));
  }, []);

  function enterEditing(): void {
    setEditing(true);
    setSelectedObjectId(null);
  }

  /** Cancel is a discard: the drafted positions are simply forgotten. */
  function cancelEditing(): void {
    setEditing(false);
    setDraft({});
    setSelectedObjectId(null);
  }

  /**
   * Writes every moved marker, and only those.
   *
   * Sequenced rather than fired off together: there is one endpoint and it takes one
   * object, each call is an audited write, and a floor being retouched produces a handful
   * of moves — not a number worth opening a dozen parallel connections for. A failure does
   * not abandon the rest; the ones that did not land stay in the draft so the mode does not
   * close on a half-saved plan and the retry is one more press of Save.
   */
  async function savePositions(): Promise<void> {
    if (pendingMoves.length === 0) {
      cancelEditing();
      return;
    }

    setSavingPositions(true);
    const failed: Record<string, PlanPositionDto | null> = {};
    let lastError: string | null = null;

    for (const [objectId, position] of pendingMoves) {
      try {
        await objectMasterService.updatePosition(objectId, { planPosition: position });
      } catch (caught) {
        failed[objectId] = position;
        lastError = caught instanceof ApiError ? caught.message : 'Байрлал хадгалж чадсангүй.';
      }
    }

    setSavingPositions(false);
    setDraft(failed);

    const failedCount = Object.keys(failed).length;
    if (failedCount === 0) {
      setEditing(false);
      setSelectedObjectId(null);
      notify(`${pendingMoves.length} байрлал хадгалагдлаа.`, 'success');
    } else {
      notify(lastError ?? `${failedCount} байрлал хадгалагдсангүй.`, 'error');
    }

    onChanged();
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
        {plan && (
          <div className="flex flex-wrap items-center gap-2">
            {/*
              The move-positions mode. Gated on object_master.manage, which is what the
              position endpoint requires, and omitted rather than disabled: a reader is
              never shown a control that would refuse them.
            */}
            {canPlace && placementAvailable && !editing && (
              <Button variant="secondary" size="sm" onClick={enterEditing}>
                Байрлал засах
              </Button>
            )}
            {canPlace && placementAvailable && editing && (
              <>
                {pendingMoves.length > 0 && (
                  <span className="text-xs font-medium text-amber-700">
                    Хадгалаагүй {pendingMoves.length} өөрчлөлт
                  </span>
                )}
                <Button size="sm" onClick={() => void savePositions()} loading={savingPositions}>
                  Байрлал хадгалах
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEditing}
                  disabled={savingPositions}
                >
                  Болих
                </Button>
              </>
            )}
            {canManage && !editing && (
              <>
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
              </>
            )}
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

            {/*
              Finding and filtering, above the drawing and off to its own line.

              Both are view controls over the same population, so they sit together, and both
              are withheld when there is nothing on the plan to find or hide. Kept to one
              compact row on a laptop: the search box is capped rather than stretched, and the
              layer chips wrap into a strip that scrolls rather than pushing the plan down the
              page.
            */}
            {placementAvailable && layers.length > 0 && (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="relative w-full sm:w-64">
                  <label htmlFor="plan-search" className="sr-only">
                    Тоноглол хайх
                  </label>
                  <input
                    id="plan-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Код эсвэл нэрээр хайх"
                    autoComplete="off"
                    className={FILTER_INPUT}
                  />

                  {trimmedQuery !== '' && (
                    <div
                      ref={resultsRef}
                      role="group"
                      aria-label="Хайлтын илэрц"
                      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200"
                    >
                      {matches.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-500">Илэрц олдсонгүй.</p>
                      ) : (
                        <ul>
                          {shownMatches.map((result, index) => (
                            <li key={result.object.id}>
                              {result.state === 'onPlan' ? (
                                <button
                                  type="button"
                                  data-result=""
                                  onClick={() => focusResult(result)}
                                  onKeyDown={(event) => handleResultKeyDown(event, index)}
                                  className="block w-full px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
                                >
                                  <span className="block text-xs font-medium text-slate-900">
                                    {result.object.code} · {result.object.name}
                                  </span>
                                  <span className="block text-xs text-slate-500">
                                    {result.object.objectType?.name ?? '-'}
                                    {result.layerHidden && ' · нуусан давхарга нээгдэнэ'}
                                  </span>
                                </button>
                              ) : (
                                <div className="px-3 py-2">
                                  <span className="block text-xs font-medium text-slate-500">
                                    {result.object.code} · {result.object.name}
                                  </span>
                                  <span className="block text-xs text-slate-400">
                                    {result.state === 'unplaced'
                                      ? 'Энэ тоноглол планд байрлуулаагүй'
                                      : 'Энэ төрлийг план дээр харуулдаггүй'}
                                  </span>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {matches.length > shownMatches.length && (
                        <p className="px-3 py-1 text-xs text-slate-400">
                          Бусад {matches.length - shownMatches.length} илэрц. Хайлтаа
                          нарийвчилна уу.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div
                  className="flex max-h-20 flex-1 flex-wrap items-center gap-1.5 overflow-y-auto sm:justify-end"
                  role="group"
                  aria-label="Харагдах тоноглолын төрөл"
                >
                  {layers.map((layer) => {
                    const isHidden = hidden.has(layer.typeId);
                    return (
                      <button
                        key={layer.typeId}
                        type="button"
                        aria-pressed={!isHidden}
                        onClick={() => toggleLayer(layer.typeId)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset transition-colors ${
                          isHidden
                            ? 'bg-white text-slate-400 ring-slate-200 hover:text-slate-600'
                            : 'bg-slate-100 text-slate-700 ring-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        <ObjectTypeGlyph
                          icon={layer.icon}
                          iconUrl={layer.iconUrl}
                          className="h-3 w-3"
                        />
                        <span>{layer.name}</span>
                        <span className={isHidden ? 'text-slate-400' : 'text-slate-500'}>
                          {layer.count}
                        </span>
                      </button>
                    );
                  })}
                  {layers.length > 1 && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => applyHiddenLayers([])}
                        disabled={hiddenLayerCount === 0}
                      >
                        Бүгдийг харуулах
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => applyHiddenLayers(layers.map((layer) => layer.typeId))}
                        disabled={hiddenLayerCount === layers.length}
                      >
                        Бүгдийг нуух
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
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
                <FloorPlanCanvas
                  imageUrl={previewUrl}
                  imageAlt={plan.title ?? 'Давхарын план зураг'}
                  markers={markers}
                  editing={editing}
                  selectedId={selectedObjectId}
                  onSelect={handleMarkerSelect}
                  onMarkerMove={handleMarkerMove}
                  // Registering something at a spot is not a position edit, so it stays
                  // out of the mode — and out of it while the mode is on, where a click
                  // on bare plan means "deselect" rather than "create".
                  onPlanClick={canPlace && !editing ? handlePlanClick : undefined}
                  focus={focusRequest}
                />
              ) : (
                <div className="h-48 animate-pulse rounded bg-slate-200" />
              )}
            </div>

            {placementAvailable && (
              <div className="space-y-2">
                {typesError && <Alert variant="warning">{typesError}</Alert>}

                {canPlace && !typesError && placeableTypes.length === 0 ? (
                  <Alert variant="info">
                    План дээр байрлуулах тоноглолын төрөл тохируулагдаагүй байна. Тоноглолын
                    төрөл дээр "План дээр харуулах" сонголтыг идэвхжүүлнэ үү.
                  </Alert>
                ) : (
                  <p className="text-xs text-slate-500">
                    {editing
                      ? 'Тэмдэглэгээг чирж байрлалыг өөрчилнө. Хадгалах хүртэл өөрчлөлт хадгалагдахгүй.'
                      : canPlace
                        ? 'План дээр дарж тоноглол бүртгэнэ. Байрлал өөрчлөхийн тулд "Байрлал засах" горимд орно.'
                        : 'План дээрх тэмдэглэгээ нь тухайн тоноглолын эрсдэлийн түвшнийг харуулна.'}
                    {unplacedCount > 0 && ` Байрлуулаагүй ${unplacedCount} тоноглол байна.`}
                    {hiddenLayerCount > 0 && ` ${hiddenLayerCount} төрөл нуугдсан байна.`}
                  </p>
                )}

                {/*
                  A hidden layer keeps its drafts, so the count above the plan can name
                  changes with no marker to point at. Said rather than prevented.
                */}
                {editing && hiddenPendingCount > 0 && (
                  <p className="text-xs font-medium text-amber-700">
                    Нуусан давхаргад хадгалаагүй {hiddenPendingCount} өөрчлөлт байна. Хадгалахад
                    эдгээр нь бас бичигдэнэ.
                  </p>
                )}

                {selectedObject && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
                    <span className="text-xs font-medium text-slate-900">
                      {selectedObject.code} · {selectedObject.name}
                    </span>
                    {(() => {
                      const position = effectivePosition(selectedObject);
                      return position ? (
                        <span className="text-xs text-slate-500">
                          {(position.x * 100).toFixed(1)}% · {(position.y * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Байрлалгүй</span>
                      );
                    })()}
                    <Link
                      to={`/floors/${floorId}/objects/${selectedObject.id}`}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Дэлгэрэнгүй
                    </Link>
                    {/*
                      Taking a position away is a position edit like any other, so it is
                      drafted with the rest and only leaves the plan for good on Save.
                    */}
                    {editing && effectivePosition(selectedObject) !== null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraft((current) => ({ ...current, [selectedObject.id]: null }));
                          setSelectedObjectId(null);
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
