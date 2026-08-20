import {
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
import {
  COMPACT_SELECT,
  FIELD_TEXTAREA,
  FILTER_INPUT,
  FILTER_LABEL,
} from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { authorisedFileUrl } from '../../lib/file-url';
import { useAuthorisedFileUrls } from '../../lib/use-authorised-file-urls';
import { objectMasterService, objectTypeService } from '../../services/object-master.service';
import { projectService } from '../../services/project.service';
import { Field, TextInput } from '../employees/FormControls';
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

/**
 * One click's worth of placement, kept in the order the clicks were made.
 *
 * The stack is what Undo walks and what the counter counts, and it is ordered by click
 * rather than by response: rapid clicking puts several creates in the air at once and they
 * come back in whatever order the network gives them. Each entry carries its own key so a
 * late answer finds its own row instead of the one that happens to be last.
 *
 * `object` is null until the server has answered. That is the honest part of the optimistic
 * pin: the marker is drawn from `position` the instant the click lands, but nothing counts
 * as placed, and nothing can be undone, until there is a real object to name.
 */
interface PlacedEntry {
  key: number;
  typeId: string;
  position: PlanPositionDto;
  /** The created object once it exists, or null while the create is in flight. */
  object: ObjectListItemDto | null;
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
  /** The type being placed. Non-null is the whole of "placing mode". */
  const [placingTypeId, setPlacingTypeId] = useState<string | null>(null);
  /** This session's clicks, in the order they were made. */
  const [placed, setPlaced] = useState<readonly PlacedEntry[]>([]);
  /** Objects created here that the parent has not reloaded yet. See below. */
  const [created, setCreated] = useState<readonly ObjectListItemDto[]>([]);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  /**
   * Distinguishes one click from the next.
   *
   * Not the server id, because the entry exists before there is one, and not the array
   * index, because concurrent responses land in any order and an index moves under them.
   */
  const placeKeyRef = useRef(0);
  /** Whether anything was actually written, so the exit knows if a reload is owed. */
  const placedAnythingRef = useRef(false);
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
    /*
      Placing belongs to the floor it was started on. Leaving takes the mode with it, along
      with the session's stack — an Undo that survived the move would delete an object from
      a plan the user is no longer looking at.

      No `onChanged` here: the floor changing is already a reload on the caller's side.
    */
    setPlacingTypeId(null);
    setPlaced([]);
    setCreated([]);
    setPlaceError(null);
    setSelectedObjectId(null);
    placedAnythingRef.current = false;
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

  /**
   * The floor's objects, plus the ones just placed that the caller has not reloaded yet.
   *
   * Quick-place answers with the whole object row, so a new pin is drawn from the response
   * rather than from a refetch — which is what lets the plan be clicked ten times in a row
   * without a spinner between clicks. The caller is told once, when placing ends; until its
   * `objects` come back carrying the new rows, they are held here.
   *
   * Self-pruning rather than cleared: an entry drops out the moment the same id turns up in
   * the prop, so the reload never blinks the markers off and never draws them twice.
   */
  const allObjects: readonly ObjectListItemDto[] = [
    ...objects,
    ...created.filter((entry) => !objects.some((object) => object.id === entry.id)),
  ];

  /** Objects the registry allows on a plan, placed or not. */
  const planObjects = allObjects.filter((object) => object.objectType?.showOnPlan === true);

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

  const placedMarkers: PlanMarker[] = visiblePlanObjects.flatMap((object) => {
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

  /**
   * The pin for a click whose create is still in the air.
   *
   * This is the optimistic half, and it is deliberately the only half: the pin appears at
   * the clicked spot immediately, with the type's own icon, so placing feels like drawing
   * rather than like filing a form — but it carries no code, because it has none yet, and
   * it is not counted and cannot be undone. A create that fails takes its pin away with it,
   * so nothing is ever left on the plan that is not on the record.
   */
  const inFlightMarkers: PlanMarker[] = placed.flatMap((entry) => {
    if (entry.object !== null) return [];
    const type = placeableTypes.find((candidate) => candidate.id === entry.typeId) ?? null;
    if (hidden.has(entry.typeId)) return [];
    return [
      {
        id: `placing-${entry.key}`,
        code: '…',
        name: type?.name ?? 'Тоноглол',
        icon: type?.icon ?? null,
        iconUrl: resolvedIconUrl(type?.iconUrl),
        typeName: type?.name ?? null,
        riskLevel: 'UNASSESSED' as const,
        position: entry.position,
      },
    ];
  });

  const markers: PlanMarker[] = [...placedMarkers, ...inFlightMarkers];
  const unplacedCount = planObjects.filter((object) => effectivePosition(object) === null).length;
  const selectedObject = planObjects.find((object) => object.id === selectedObjectId) ?? null;

  /** Drafted positions that actually differ from what is stored. */
  const pendingMoves = Object.entries(draft).filter(([objectId, position]) => {
    const stored = allObjects.find((object) => object.id === objectId)?.planPosition ?? null;
    return !samePlanPosition(position, stored);
  });

  /**
   * Unsaved moves the user cannot currently see.
   *
   * Said out loud rather than prevented. Hiding a layer does not drop its drafts, so the
   * count above the plan would otherwise name changes with no marker to point at.
   */
  const hiddenPendingCount = pendingMoves.filter(([objectId]) => {
    const typeId = allObjects.find((object) => object.id === objectId)?.objectType?.id;
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
      : allObjects
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

  const placing = placingTypeId !== null;
  const placingType = placeableTypes.find((type) => type.id === placingTypeId) ?? null;
  /** What this session has actually written. In-flight clicks are not placed yet. */
  const placedCount = placed.filter((entry) => entry.object !== null).length;
  /**
   * What Undo would take back: the last click made, and only if it has landed.
   *
   * Read off the tail of the click-ordered stack rather than off a "most recent response",
   * which under rapid clicking is a different object from the one the user last pointed at.
   * A tail still in flight has no id to delete and disables the button for the moment it
   * takes to answer, rather than silently reaching past it to the one before — which would
   * delete something other than what the user is looking at.
   */
  const undoTarget = placed.length > 0 ? placed[placed.length - 1] : undefined;
  const undoObject = undoTarget?.object ?? null;

  /**
   * Enters placing mode.
   *
   * The type is asked for once, here, and then every click on the plan is a whole object.
   * A type whose layer is switched off is switched back on in the same gesture: placing
   * pins the user cannot see is not a mode worth being in, and the alternative is a plan
   * that visibly does nothing while the count climbs.
   */
  function startPlacing(typeId: string): void {
    if (typeId === '' || !canPlace || !placementAvailable || editing) return;
    if (hidden.has(typeId)) {
      applyHiddenLayers(hiddenTypeIds.filter((entry) => entry !== typeId));
    }
    setPlacingTypeId(typeId);
    setPlaced([]);
    setPlaceError(null);
    setSelectedObjectId(null);
    placedAnythingRef.current = false;
  }

  /**
   * Leaves placing mode.
   *
   * The caller is told here and nowhere else. Refreshing the floor after every click would
   * put a refetch between one click and the next, which is exactly the pause this flow
   * exists to remove; the markers are drawn from the create responses in the meantime, so
   * the plan is never out of date on screen while it waits.
   */
  function exitPlacing(): void {
    setPlacingTypeId(null);
    setPlaced([]);
    setPlaceError(null);
    if (placedAnythingRef.current) {
      placedAnythingRef.current = false;
      onChanged();
    }
  }

  /**
   * A click on the plan while placing: one object, immediately, with nothing to confirm.
   *
   * The pin is drawn before the request leaves, and the request carries only the four
   * things a click can express — the server allocates the code and the name, which is what
   * makes clicking ten times in a row produce ten correctly numbered objects rather than
   * ten collisions.
   *
   * Failure rolls the pin back rather than leaving it: a marker on the drawing has to mean
   * an object on the record. The mode survives the failure, because losing it after one
   * blip mid-placement is worse than the failure was.
   */
  function handlePlanClick(position: PlanPositionDto): void {
    const objectTypeId = placingTypeId;
    if (objectTypeId === null || !canPlace || !placementAvailable) return;

    const key = placeKeyRef.current++;
    setSelectedObjectId(null);
    setPlaceError(null);
    setPlaced((current) => [...current, { key, typeId: objectTypeId, position, object: null }]);

    void objectMasterService
      .quickPlace({ customerId, objectTypeId, floorId, planPosition: position })
      .then((object) => {
        placedAnythingRef.current = true;
        // Matched by key, so an answer that overtakes an earlier one still finds its own
        // click and the stack keeps the order the user made it in.
        setPlaced((current) =>
          current.map((entry) => (entry.key === key ? { ...entry, object } : entry)),
        );
        setCreated((current) => [...current, object]);
      })
      .catch((caught: unknown) => {
        setPlaced((current) => current.filter((entry) => entry.key !== key));
        setPlaceError(caught instanceof ApiError ? caught.message : 'Тоноглол бүртгэж чадсангүй.');
      });
  }

  /**
   * Takes back the last thing this session placed, and only that.
   *
   * A real delete, because a quick-placed object is a real object. It reaches nothing but
   * the stack above — an object that was already on the floor when the mode was entered is
   * not in it and cannot be reached from here — and the button names the code it will
   * remove, so it is never a guess.
   */
  async function undoLastPlacement(): Promise<void> {
    const entry = undoTarget;
    const object = entry?.object ?? null;
    if (!entry || !object) return;

    setUndoing(true);
    setPlaceError(null);
    try {
      await objectMasterService.remove(object.id);
      setPlaced((current) => current.filter((candidate) => candidate.key !== entry.key));
      setCreated((current) => current.filter((candidate) => candidate.id !== object.id));
      notify(`${object.code} устгагдлаа.`, 'success');
    } catch (caught) {
      setPlaceError(caught instanceof ApiError ? caught.message : 'Буцааж чадсангүй.');
    } finally {
      setUndoing(false);
    }
  }

  /** A drag in progress. Drafted, never sent. */
  const handleMarkerMove = useCallback((objectId: string, position: PlanPositionDto): void => {
    setDraft((current) => ({ ...current, [objectId]: position }));
  }, []);

  const handleMarkerSelect = useCallback((objectId: string | null): void => {
    setSelectedObjectId((current) => (objectId !== null && current === objectId ? null : objectId));
  }, []);

  /**
   * Moving markers and adding them stay two different modes.
   *
   * A click on bare plan cannot mean "register something here" and "deselect" at once, so
   * entering the edit mode ends placing — and ends it properly, which includes telling the
   * caller about whatever was placed before the switch.
   */
  function enterEditing(): void {
    exitPlacing();
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

            {/*
              The placement bar.

              A bar rather than a dialog, and that is the whole design: a dialog per object
              turned "put forty lights on this floor" into forty forms. The type is chosen
              once and stays chosen, the plan is clicked as many times as there are lights,
              and the only things that change while placing are the count and what Undo
              points at.

              Withheld exactly where placement is: no permission, no plan, a PDF plan, an
              inactive floor, or a registry with nothing marked as shown on plans. It is also
              gone in the position-edit mode, because the two are mutually exclusive.
            */}
            {canPlace && placementAvailable && !editing && placeableTypes.length > 0 && (
              <div
                role="group"
                aria-label="Тоноглол байрлуулах"
                className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ring-1 ring-inset ${
                  placing ? 'bg-blue-50 ring-blue-300' : 'bg-slate-50 ring-slate-200'
                }`}
              >
                {!placing ? (
                  <>
                    <label
                      htmlFor="plan-place-type"
                      className="text-xs font-medium text-slate-600"
                    >
                      Түргэн байрлуулах
                    </label>
                    <select
                      id="plan-place-type"
                      className={COMPACT_SELECT}
                      value=""
                      onChange={(event) => startPlacing(event.target.value)}
                    >
                      <option value="">Төрөл сонгох</option>
                      {placeableTypes.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name} ({type.code})
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-slate-500">
                      Төрөл сонгосны дараа план дээр дарах бүрд нэг тоноглол бүртгэгдэнэ.
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-900">
                      <ObjectTypeGlyph
                        icon={placingType?.icon ?? null}
                        iconUrl={resolvedIconUrl(placingType?.iconUrl)}
                        className="h-3.5 w-3.5"
                      />
                      {placingType?.name ?? 'Тоноглол'} байрлуулж байна
                    </span>
                    <span className="text-xs text-blue-800">
                      План дээр дарж нэмнэ · {placedCount} нэмэгдлээ
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {/*
                        Named, not implied. The button says what it will delete, so nobody
                        has to work out what "the last one" meant while the pins are still
                        appearing — and it is inert until the last click has an answer,
                        because until then there is nothing to delete.
                      */}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void undoLastPlacement()}
                        disabled={undoObject === null || undoing}
                        loading={undoing}
                      >
                        {undoObject ? `Буцаах (${undoObject.code})` : 'Буцаах'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={exitPlacing} disabled={undoing}>
                        Болих
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/*
              A failed create says why and stays in the mode. The pin it drew is already
              gone, so the plan and the record still agree.
            */}
            {placeError && <Alert variant="error">{placeError}</Alert>}

            <div
              className={`rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200 ${
                // The pointer says what a click will do. React Flow paints its own grab
                // cursor on the pane, so the override has to reach it.
                placing ? '[&_.react-flow__pane]:cursor-crosshair' : ''
              }`}
            >
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

                {/*
                  Nothing to say when placement is permitted but no type is configured for
                  it: the hint below describes a plan that can be placed on, and there is
                  none. Why no type is offered is explained in the page's help panel.
                */}
                {!(canPlace && !typesError && placeableTypes.length === 0) && (
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
