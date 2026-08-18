import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_DESCRIPTIONS,
  OBJECT_CATEGORY_LABELS,
  PERMISSIONS,
  createObjectAssessmentSchema,
  createObjectSchema,
  riskLevelFor,
  updateObjectSchema,
  validateAttributeValues,
  type CustomerDto,
  type FloorDto,
  type ObjectCategory,
  type ObjectListItemDto,
  type ObjectTypeDto,
} from '@monhorus/shared';
import { useEffect, useId, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../../components/ui/control-styles';
import { useAuth } from '../../../contexts/auth-context';
import { useRiskBands } from '../../../hooks/use-risk-bands';
import { ApiError } from '../../../lib/api-client';
import { objectService } from '../../../services/object.service';
import { objectMasterService, objectTypeService } from '../../../services/object-master.service';
import { projectService } from '../../../services/project.service';
import { Field, SelectInput, TextInput } from '../../employees/FormControls';
import {
  ObjectAttributeFields,
  toAttributeDrafts,
  toAttributePayload,
} from './ObjectAttributeFields';

/** The name each category's own attribute block goes by, shown beside the section header. */
const ELECTRICAL_BLOCK_LABELS: Record<ObjectCategory, string> = {
  PANEL: 'Самбарын мэдээлэл',
  CIRCUIT: 'Хэлхээний мэдээлэл',
  EQUIPMENT: 'Тоноглолын мэдээлэл',
};

/** The `fieldErrors` prefix the schema and the backend key each category's attributes under. */
const ELECTRICAL_ERROR_PREFIXES: Record<ObjectCategory, string> = {
  PANEL: 'panel.',
  CIRCUIT: 'circuit.',
  EQUIPMENT: 'equipment.',
};

/**
 * Object create and edit.
 *
 * Two entry points share this form. Under `/floors/:floorId/objects/...` the floor comes
 * from the route and supplies the customer, which is how an object reached from a floor is
 * registered. Under `/objects/new` there is no floor in the route: the API has always
 * accepted a floorless object — `floorId` is nullish in the create schema and the service
 * skips the floor when it is absent — and forcing everybody through four screens to reach a
 * specific floor first was the reason registration felt heavy. In that mode the customer is
 * picked and the floor becomes an optional selection.
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
  /** No floor in the route: the customer and the floor are chosen on the form instead. */
  const isFloorless = !floorId;
  const navigate = useNavigate();
  const { notify } = useToast();
  const { can } = useAuth();
  /**
   * The bands currently in force, read from Тохиргоо. The red/black conditional fields are
   * decided against these rather than against a threshold written into this file, so a
   * re-banding in settings moves the requirement with it — exactly as the backend does.
   *
   * Null when they could not be read; see `requiresFindings` for what this form does then.
   */
  const bands = useRiskBands();

  const canAssess = can(PERMISSIONS.OBJECT_MASTER_ASSESS);

  const [floor, setFloor] = useState<FloorDto | null>(null);
  const [types, setTypes] = useState<ObjectTypeDto[]>([]);
  const [panels, setPanels] = useState<ObjectListItemDto[]>([]);
  const [circuits, setCircuits] = useState<ObjectListItemDto[]>([]);
  // Floorless mode only: the tenant and the floors it owns, both chosen on the form.
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [floors, setFloors] = useState<FloorDto[]>([]);
  const [chosenFloorId, setChosenFloorId] = useState('');

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
  // Section 10.1 requires this alongside the conclusion and the recommendation once the
  // score lands in the red or black band. It was missing entirely, so every red score
  // created the object and then lost the assessment.
  const [initialActionTaken, setInitialActionTaken] = useState('');
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
  /**
   * The enclosure the device is mounted in.
   *
   * Pre-filled from `?panelId=` when the form was opened by the "register on this panel"
   * action, which is the whole point of that action: the panel, its customer and its floor
   * all arrive with the route, leaving the user with a type and a name to supply. Kept
   * apart from the circuit's `panelId` above — a device may name both a mount and a feed,
   * and they are different panels as often as not.
   */
  const [equipmentPanelId, setEquipmentPanelId] = useState(
    isEdit ? '' : (searchParams.get('panelId') ?? ''),
  );
  /** The panel code a suggested object code was derived from, for the hint beside it. */
  const [codeBasedOn, setCodeBasedOn] = useState<string | null>(null);
  const [ratedPowerKw, setRatedPowerKw] = useState('');
  const [quantity, setQuantity] = useState('');
  const [usageCoefficient, setUsageCoefficient] = useState('');
  const [installedAt, setInstalledAt] = useState('');
  const [warrantyUntil, setWarrantyUntil] = useState('');

  /**
   * The user's own choice about the electrical section, or null while they have made none.
   *
   * Null is the interesting value: with nothing said either way the section decides for
   * itself from what it holds, which is what opens an edit of a panel that already has a
   * capacity and leaves a blank registration folded. Once the header is clicked the choice
   * is theirs and stays theirs. See `electricalExpanded` for the one thing that overrides it.
   */
  /**
   * The answers to whatever the chosen TYPE declares (requirements 4.1), keyed by attribute.
   *
   * Strings whatever the attribute's declared type is, exactly as every other box on this
   * form; `toAttributePayload` parses them once, on submit. Keyed by attribute rather than
   * held per field because the fields are not known until a type is chosen — that is the
   * whole point of the feature.
   */
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, string>>({});

  const [electricalToggled, setElectricalToggled] = useState<boolean | null>(null);
  const electricalPanelId = useId();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /**
   * Set when the object was written but its assessment was not.
   *
   * The two are separate calls and only the first one is undoable-by-nobody, so a failed
   * assessment used to be a toast the page navigated away from before anybody read it. The
   * id parks the half-finished state on screen instead, with a way through to the object.
   */
  const [orphanedAssessment, setOrphanedAssessment] = useState<{
    objectId: string;
    floorId: string | null;
    message: string;
  } | null>(null);
  /** Confirmation of the last floorless registration, which has no detail page to land on. */
  const [lastCreated, setLastCreated] = useState<{ code: string; name: string } | null>(null);

  /** An object is only reachable through the floor it sits on; a floorless one has no page. */
  function objectPathOf(id: string, placedOn: string | null): string | null {
    return placedOn ? `/floors/${placedOn}/objects/${id}` : null;
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      setLoading(true);
      try {
        if (floorId) {
          // The floor is the anchor: it supplies the customer and the breadcrumb trail.
          const floorDetail = await projectService.getFloor(floorId);
          if (cancelled) return;
          setFloor(floorDetail);
          setCustomerId(floorDetail.customerId);
        } else {
          // Floorless: nothing anchors the customer, so it is offered as a choice.
          const list = await objectService.customers();
          if (cancelled) return;
          setCustomers(list);
        }

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
          setEquipmentPanelId(object.equipment?.panel?.id ?? '');
          setRatedPowerKw(object.equipment?.ratedPowerKw?.toString() ?? '');
          setQuantity(object.equipment?.quantity?.toString() ?? '');
          setUsageCoefficient(object.equipment?.usageCoefficient?.toString() ?? '');
          setInstalledAt(object.equipment?.installedAt?.slice(0, 10) ?? '');
          setWarrantyUntil(object.equipment?.warrantyUntil?.slice(0, 10) ?? '');

          // Hydrated from the definitions the detail response carries rather than from the
          // type list, which has not loaded yet at this point. They are the same definitions
          // — this is the type's own list, travelling with the object that uses it.
          setAttributeDrafts(
            toAttributeDrafts(object.objectType?.attributes ?? [], object.attributeValues),
          );
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

  /**
   * The building the object will stand in, or null while it has no floor.
   *
   * Read off the floor rather than tracked separately: in route mode the anchor floor DTO
   * carries `buildingId`, and in floorless mode the picked floor is one of the DTOs already
   * loaded for the selector. Null means "not placed yet", which is exactly the case the
   * backend leaves unconstrained.
   */
  const effectiveBuildingId =
    (floorId
      ? floor?.buildingId
      : floors.find((entry) => entry.id === chosenFloorId)?.buildingId) ?? null;

  /**
   * Related objects, scoped to the same customer AND the same building.
   *
   * The backend refuses a connection whose two ends stand in different buildings, so
   * offering a panel from across the site was offering a choice that could only ever come
   * back as a field error. `buildingId` is dropped while the object is floorless, because
   * a floorless object has no building and the backend constrains nothing.
   */
  useEffect(() => {
    if (!customerId) {
      setPanels([]);
      setCircuits([]);
      return undefined;
    }
    let cancelled = false;
    const query = {
      customerId,
      limit: 100,
      ...(effectiveBuildingId ? { buildingId: effectiveBuildingId } : {}),
    };
    void Promise.all([
      objectMasterService.list({ ...query, category: 'PANEL' }),
      objectMasterService.list({ ...query, category: 'CIRCUIT' }),
    ]).then(([panelPage, circuitPage]) => {
      if (cancelled) return;
      setPanels(panelPage.items);
      setCircuits(circuitPage.items);
      // Moving the object to another building leaves any earlier pick unofferable. Dropping
      // it here is what keeps the visible value and the list in step; the backend treats an
      // omitted reference as "leave it alone", so nothing stored is destroyed by the clear.
      setPanelId((current) =>
        current && !panelPage.items.some((item) => item.id === current) ? '' : current,
      );
      setEquipmentPanelId((current) =>
        current && !panelPage.items.some((item) => item.id === current) ? '' : current,
      );
      setCircuitId((current) =>
        current && !circuitPage.items.some((item) => item.id === current) ? '' : current,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [customerId, effectiveBuildingId]);

  /**
   * Floors to offer in floorless mode.
   *
   * The floor list endpoint filters by project and building but not by customer, so the
   * tenant filter is applied here against each floor's own `customerId`. Only active floors
   * are offered, because the backend refuses to place an object on an archived one.
   */
  useEffect(() => {
    if (!isFloorless || isEdit || !customerId) {
      setFloors([]);
      return undefined;
    }
    let cancelled = false;
    projectService
      .listFloors({ isActive: true, limit: 100 })
      .then((page) => {
        if (cancelled) return;
        setFloors(page.items.filter((entry) => entry.customerId === customerId));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isFloorless, isEdit, customerId]);

  // Changing the tenant invalidates a floor picked under the previous one.
  useEffect(() => {
    setChosenFloorId('');
  }, [customerId]);

  /**
   * A code proposed for a device being registered into a panel.
   *
   * Asked of the backend, never guessed here: codes are unique per customer and this page
   * has only ever seen a page of them, so a locally invented `-03` would collide with a
   * device on a floor nobody opened. `CT-LDB-1` becomes `CT-LDB-1-01`, `-02`, and so on
   * past whatever is already taken.
   *
   * A SUGGESTION, NOT A LOCK. It is written into the field only while the field is still
   * empty — the functional update is what guarantees a code the user has begun typing is
   * never overwritten by an answer arriving late — and the field stays editable afterwards.
   */
  useEffect(() => {
    if (isEdit || category !== 'EQUIPMENT' || !equipmentPanelId) {
      setCodeBasedOn(null);
      return undefined;
    }
    let cancelled = false;
    objectMasterService
      .codeSuggestion(equipmentPanelId)
      .then((suggestion) => {
        if (cancelled) return;
        setCode((current) => (current.trim() === '' ? suggestion.code : current));
        setCodeBasedOn(suggestion.basedOn);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isEdit, category, equipmentPanelId]);

  function numberOrNull(value: string): number | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : Number(trimmed);
  }

  /** The floor the object will be written against: from the route, or from the picker. */
  const effectiveFloorId = floorId ?? (chosenFloorId || null);
  const floorPath = floorId ? `/floors/${floorId}` : '/projects';
  const selectedType = types.find((type) => type.id === objectTypeId) ?? null;
  /**
   * What the chosen type demands beyond its category's own fields (requirements 4.1).
   *
   * Empty until a type is chosen, and empty for every type that declares nothing — which is
   * the case this form behaved as before the feature existed, so that path renders and
   * submits exactly as it always did.
   */
  const typeAttributes = selectedType?.attributes ?? [];
  // Section 4.1: only a type flagged as generating a conclusion may carry an assessment,
  // so the score field appears exactly where the backend would accept one.
  const showInitialScore = !isEdit && canAssess && (selectedType?.generatesConclusion ?? false);

  /**
   * The band the typed score falls into, or null when no score was typed.
   *
   * Resolved with the shared `riskLevelFor` against the configured bands, the same call the
   * backend makes, so the form asks for exactly the fields the backend is about to demand.
   */
  const parsedScore = initialScore.trim() === '' ? Number.NaN : Number(initialScore.trim());
  const scoreTyped = Number.isFinite(parsedScore);
  const initialRiskLevel = scoreTyped && bands !== null ? riskLevelFor(parsedScore, bands) : null;
  // Section 10.1: the red and black bands require a conclusion, a recommendation and the
  // action taken. Nothing here decides where those bands start.
  const redOrBlack = initialRiskLevel === 'CRITICAL' || initialRiskLevel === 'OUT_OF_SERVICE';
  /**
   * Whether the three section 10.1 findings are demanded before anything is written.
   *
   * `bands === null` means the thresholds could not be read, so this form cannot tell
   * which side of the line a typed score falls on. It asks for all three rather than
   * guess: the object and the assessment are two calls, and skipping the check would let
   * the second one fail after the object is already on record with its score thrown away.
   * The form still states no threshold — it only asks for more.
   */
  const bandsUnknown = bands === null;
  const requiresFindings = bandsUnknown ? scoreTyped : redOrBlack;

  /**
   * Whether the chosen category's attribute fields already carry anything.
   *
   * Only the chosen category is consulted, because only its block is rendered and only its
   * values are ever sent: a figure left behind in a category the user tried and moved off
   * is not detail worth opening the section for.
   */
  const electricalValues =
    category === 'PANEL'
      ? [capacityKw, location, protection]
      : category === 'CIRCUIT'
        ? [panelId, breakerRating, permittedCapacityKw, cableType, cableSectionMm2, cableLengthM]
        : [
            circuitId,
            equipmentPanelId,
            ratedPowerKw,
            quantity,
            usageCoefficient,
            installedAt,
            warrantyUntil,
          ];
  const electricalFilled = electricalValues.some((value) => value.trim() !== '');
  const electricalHasError = Object.keys(fieldErrors).some((key) =>
    key.startsWith(ELECTRICAL_ERROR_PREFIXES[category]),
  );
  /**
   * A field error inside the section outranks everything, the user's own collapse included.
   *
   * Refusing a save over a message that is folded out of sight is a dead end with nothing on
   * screen to explain it, so an error opens the section and holds it open until the next
   * save clears it. Short of that the user's choice wins, and with no choice made the
   * section opens exactly when it has something to show.
   */
  const electricalExpanded = electricalHasError || (electricalToggled ?? electricalFilled);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});
    setOrphanedAssessment(null);
    setLastCreated(null);

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
                panelId: equipmentPanelId || null,
                ratedPowerKw: numberOrNull(ratedPowerKw),
                quantity: numberOrNull(quantity),
                usageCoefficient: numberOrNull(usageCoefficient),
                installedAt: installedAt ? `${installedAt}T00:00:00.000Z` : null,
                warrantyUntil: warrantyUntil ? `${warrantyUntil}T00:00:00.000Z` : null,
              },
            };

    const attributeValues = toAttributePayload(typeAttributes, attributeDrafts);

    /**
     * The attribute bag is sent only once the chosen type is actually in hand.
     *
     * The type registry loads in its own request, so there is a window in which `selectedType`
     * is null and this form cannot know what the type declares. Sending `{}` in that window
     * would be a statement — a declared attribute absent from an update is a declared
     * attribute cleared — and it would wipe values off an object over a race. Omitting the key
     * says nothing instead, and the backend leaves what is stored exactly as it is.
     */
    const attributePayload = selectedType ? { attributeValues } : {};

    const parsed = isEdit
      ? updateObjectSchema.safeParse({
          name: name.trim(),
          objectTypeId,
          floorId: floorId ?? null,
          description: description.trim() || null,
          notes: notes.trim() || null,
          ...attributePayload,
          ...attributes,
        })
      : createObjectSchema.safeParse({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          customerId,
          objectTypeId,
          floorId: effectiveFloorId,
          description: description.trim() || null,
          notes: notes.trim() || null,
          category,
          ...attributePayload,
          ...attributes,
        });

    /**
     * The type's own rules, which zod cannot state.
     *
     * Whether a key is legal, whether it is required and whether a SELECT value is one of its
     * options all depend on definitions held in the database, so they come from the same
     * shared function the backend enforces with — checked here purely so the user is told
     * without a round trip. The backend does not assume this ran.
     */
    const attributeIssues = validateAttributeValues(typeAttributes, attributeValues);

    if (!parsed.success || attributeIssues.length > 0) {
      const errors: Record<string, string> = {};
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.') || '_';
          if (!errors[key]) errors[key] = issue.message;
        }
      }
      // Already keyed `attributeValues.<key>`, the same path the backend returns, so the two
      // sources land on the same input without either knowing about the other.
      for (const issue of attributeIssues) {
        if (!errors[issue.field]) errors[issue.field] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    const wantsAssessment = !isEdit && showInitialScore && initialScore.trim() !== '';

    /**
     * Section 10.1 conditional fields, checked before anything is written.
     *
     * The bands are configurable, so the requirement is keyed on the resolved level rather
     * than on a number written here. Checking it up front is the point: the object and the
     * assessment are two calls, and letting the second one fail leaves an object on record
     * whose score was thrown away.
     */
    if (wantsAssessment && requiresFindings) {
      const because = bandsUnknown ? 'Үнэлгээний түвшин тодорхойгүй тул' : 'Улаан/хар төлөвт';
      const missing: Record<string, string> = {};
      if (!initialConclusion.trim()) {
        missing['assessment.conclusion'] = `${because} дүгнэлт заавал.`;
      }
      if (!initialRecommendation.trim()) {
        missing['assessment.recommendation'] = `${because} зөвлөмж заавал.`;
      }
      if (!initialActionTaken.trim()) {
        missing['assessment.actionTaken'] = `${because} авах арга хэмжээ заавал.`;
      }
      if (Object.keys(missing).length > 0) {
        setFieldErrors(missing);
        setFormError('Үнэлгээний түвшинд шаардагдах мэдээлэл дутуу байна.');
        return;
      }
    }

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
          actionTaken: initialActionTaken.trim() || null,
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
          /**
           * A rejected assessment must not read as a failed create: the object exists
           * either way. It must not read as a success either, which is what navigating
           * away on a toast amounted to — the page was gone before the message could be
           * read, and the score was silently lost. The failure is kept on screen instead,
           * with the offending fields marked and a way through to the object.
           */
          try {
            await objectMasterService.recordAssessment(created.id, assessment.data);
            notify('Объект болон үнэлгээ бүртгэгдлээ.', 'success');
          } catch (caught) {
            const message =
              caught instanceof ApiError ? caught.message : 'Үнэлгээг бүртгэж чадсангүй.';
            if (caught instanceof ApiError) {
              setFieldErrors(
                Object.fromEntries(
                  Object.entries(caught.fieldErrors).map(([key, value]) => [
                    `assessment.${key}`,
                    value,
                  ]),
                ),
              );
            }
            setOrphanedAssessment({
              objectId: created.id,
              floorId: created.floorId,
              message,
            });
            notify('Үнэлгээ бүртгэгдсэнгүй.', 'error');
            setSubmitting(false);
            return;
          }
        } else {
          notify('Объект үүслээ.', 'success');
        }

        /**
         * An object detail page only exists under a floor. A floorless registration
         * therefore stays on the form: the entry is confirmed above the fields and the
         * code and name are cleared for the next one, which is what registering a batch of
         * equipment actually looks like.
         */
        const path = objectPathOf(created.id, created.floorId);
        if (path) {
          navigate(path);
        } else {
          setLastCreated({ code: created.code, name: created.name });
          setCode('');
          setName('');
          setDescription('');
          setNotes('');
          setInitialScore('');
          setInitialConclusion('');
          setInitialRecommendation('');
          setInitialActionTaken('');
          setInitialPhoto(null);
        }
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
        backTo={{
          to: floorPath,
          label: floorId ? 'Давхар руу буцах' : 'Төсөл рүү буцах',
        }}
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

        {/*
          The object was written and its assessment was not. Both halves are said plainly,
          because the object cannot be created again — a second attempt would only collide
          on the code — and the score has to be recorded on the object itself.
        */}
        {orphanedAssessment && (
          <Alert variant="error" title="Объект үүслээ, үнэлгээ бүртгэгдсэнгүй">
            {orphanedAssessment.message}
            {orphanedAssessment.floorId && (
              <>
                {' '}
                <Link
                  to={`/floors/${orphanedAssessment.floorId}/objects/${orphanedAssessment.objectId}`}
                  className="font-medium underline"
                >
                  Объект дээр үнэлгээг дахин бүртгэнэ үү.
                </Link>
              </>
            )}
          </Alert>
        )}

        {lastCreated && (
          <Alert variant="success" title="Объект бүртгэгдлээ">
            {lastCreated.code} · {lastCreated.name}. Дараагийн тоноглолыг шууд бүртгэнэ үү.
          </Alert>
        )}

        {isEdit ? (
          <Alert variant="info">
            Код болон ангиллыг өөрчлөхгүй. Ангилал өөрчлөгдвөл хадгалагдсан техникийн
            талбарууд болон ачааллын тооцоо хүчингүй болно.
          </Alert>
        ) : (
          <Alert variant="info">{OBJECT_CATEGORY_DESCRIPTIONS[category]}</Alert>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {isFloorless && !isEdit ? (
            <>
              {/*
                Floorless registration. The customer is what an object actually belongs to —
                codes are unique per customer and every related-object check compares against
                it — so it is asked for first, and the floor stays optional underneath.
              */}
              <Field label="Харилцагч" required error={fieldErrors.customerId}>
                <SelectInput
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="Харилцагч сонгох"
                  options={customers.map((entry) => ({
                    value: entry.id,
                    label: `${entry.name} (${entry.code})`,
                  }))}
                  disabled={submitting}
                />
              </Field>

              <Field
                label="Давхар"
                error={fieldErrors.floorId}
                hint="Заавал биш. Дараа нь давхарт холбож болно."
              >
                <SelectInput
                  value={chosenFloorId}
                  onChange={setChosenFloorId}
                  placeholder={
                    customerId === ''
                      ? 'Эхлээд харилцагч сонгоно уу'
                      : floors.length === 0
                        ? 'Идэвхтэй давхар алга'
                        : 'Давхарт холбохгүй'
                  }
                  options={floors.map((entry) => ({
                    value: entry.id,
                    label: `${entry.projectName ?? '-'} · ${entry.buildingName ?? '-'} · ${entry.name}`,
                  }))}
                  disabled={submitting || !customerId || floors.length === 0}
                />
              </Field>
            </>
          ) : (
            <Field label="Давхар" hint="Маршрутаас тодорхойлогдоно">
              <TextInput
                value={
                  floor
                    ? `${floor.projectName ?? '-'} · ${floor.buildingName ?? '-'} · ${floor.name}`
                    : ''
                }
                onChange={() => undefined}
                disabled
              />
            </Field>
          )}

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

          <Field
            label="Код"
            required={!isEdit}
            error={fieldErrors.code}
            // Said out loud that the value is only a proposal: it is editable like any
            // other, and nothing has been reserved under it.
            hint={codeBasedOn ? `${codeBasedOn} самбараас санал болгов. Засаж болно.` : undefined}
          >
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

        {/*
          The electrical detail, folded away.

          Registering an asset is a code, a name and a type. Everything below is optional at
          the API — nullish in the schema, null by default in the store — and putting two
          dozen of them on screen at once is what made a simple registration feel heavy.
          Nothing is removed and nothing about what is sent has changed: the same fields, one
          click away.

          It is never folded over anything that matters, which `electricalExpanded` above is
          the whole of: a block that already holds a value opens itself, and so does one
          holding a field error.
        */}
        <section className="rounded-lg ring-1 ring-slate-200">
          {/* The accordion as the ARIA pattern describes it, and as the planned-work floor
              sections already do it: a heading carrying the level, with the button that
              opens the panel inside it. */}
          <h3 className="text-sm font-semibold text-slate-900">
            <button
              type="button"
              onClick={() => setElectricalToggled(!electricalExpanded)}
              aria-expanded={electricalExpanded}
              aria-controls={electricalPanelId}
              className="flex w-full flex-wrap items-center gap-2 rounded-lg px-4 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <svg
                className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${
                  electricalExpanded ? 'rotate-90' : ''
                }`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Цахилгааны мэдээлэл</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600">
                {ELECTRICAL_BLOCK_LABELS[category]}
              </span>
              {/* Folded away by the user's own hand over values they typed: said plainly, so
                  nothing they entered is hidden without a word. */}
              {!electricalExpanded && electricalFilled && (
                <span className="text-[11px] font-normal text-slate-500">
                  Бөглөсөн мэдээлэлтэй
                </span>
              )}
            </button>
          </h3>

          <div
            id={electricalPanelId}
            hidden={!electricalExpanded}
            className="border-t border-slate-200 px-4 py-4"
          >
            {/* Only the block belonging to the chosen category is rendered. */}
            {category === 'PANEL' && (
              <fieldset aria-label="Самбарын мэдээлэл">
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Field
                    label="Харьяалагдах самбар"
                    error={fieldErrors['circuit.panelId']}
                    hint={
                      effectiveBuildingId ? 'Зөвхөн энэ барилгын самбарууд.' : undefined
                    }
                  >
                    <SelectInput
                      value={panelId}
                      onChange={setPanelId}
                      placeholder={
                        panels.length === 0 && effectiveBuildingId
                          ? 'Энэ барилгад самбар алга'
                          : 'Самбар сонгох'
                      }
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Field
                    label="Тэжээх хэлхээ"
                    error={fieldErrors['equipment.circuitId']}
                    hint={
                      effectiveBuildingId ? 'Зөвхөн энэ барилгын хэлхээнүүд.' : undefined
                    }
                  >
                    <SelectInput
                      value={circuitId}
                      onChange={setCircuitId}
                      placeholder={
                        circuits.length === 0 && effectiveBuildingId
                          ? 'Энэ барилгад хэлхээ алга'
                          : 'Хэлхээнд холбохгүй'
                      }
                      options={circuits.map((circuit) => ({
                        value: circuit.id,
                        label: `${circuit.name} (${circuit.code})`,
                      }))}
                      disabled={submitting || !customerId}
                    />
                  </Field>
                  {/*
                    Where the device is mounted, offered beside what feeds it.

                    Scoped to the same customer and building as the circuit picker above, and
                    for the same reason: the backend refuses a reference whose two ends stand in
                    different buildings, so anything wider would be offering a choice that can
                    only come back as a field error.

                    Independent of the circuit. Both may be set — a sub-panel's main breaker is
                    mounted in one panel and fed from another — and a mount carries no load
                    whatsoever; only the circuit does.
                  */}
                  <Field
                    label="Байрлах самбар"
                    error={fieldErrors['equipment.panelId']}
                    hint={
                      effectiveBuildingId
                        ? 'Самбарын дотор суурилуулсан бол сонгоно. Ачаалалд нөлөөлөхгүй.'
                        : 'Самбарын дотор суурилуулсан бол сонгоно.'
                    }
                  >
                    <SelectInput
                      value={equipmentPanelId}
                      onChange={setEquipmentPanelId}
                      placeholder={
                        panels.length === 0 && effectiveBuildingId
                          ? 'Энэ барилгад самбар алга'
                          : 'Самбарт байрлуулахгүй'
                      }
                      options={panels.map((panel) => ({
                        value: panel.id,
                        label: `${panel.name} (${panel.code})`,
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
          </div>
        </section>

        {/*
          The chosen type's own fields, rendered entirely from its definitions.

          Nothing here names an attribute, a category or a type — adding a field to Автомат
          таслуур is an edit in Тоноглолын төрөл, not a change to this file. The section is
          absent altogether for a type that declares nothing, which is every type registered
          before this existed.

          The Үнэлгээ бүртгэх form asks the same questions from the same renderer, and both
          write to the object: these are facts about the kit, not about a visit.
        */}
        {typeAttributes.length > 0 && (
          <fieldset aria-label={`${selectedType?.name ?? ''} үзүүлэлт`.trim()}>
            <legend className="mb-3 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
              {selectedType?.name ?? 'Төрлийн'} үзүүлэлт
            </legend>
            <div className="grid grid-cols-1 gap-x-5 gap-y-3.5 md:grid-cols-2 xl:grid-cols-3">
              <ObjectAttributeFields
                attributes={typeAttributes}
                drafts={attributeDrafts}
                onChange={(key, next) =>
                  setAttributeDrafts((current) => ({ ...current, [key]: next }))
                }
                disabled={submitting}
                fieldErrors={fieldErrors}
              />
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
              <Field
                label="Дүгнэлт"
                required={requiresFindings}
                error={fieldErrors['assessment.conclusion']}
              >
                <TextInput
                  value={initialConclusion}
                  onChange={setInitialConclusion}
                  disabled={submitting}
                />
              </Field>
              <Field
                label="Зөвлөмж"
                required={requiresFindings}
                error={fieldErrors['assessment.recommendation']}
              >
                <TextInput
                  value={initialRecommendation}
                  onChange={setInitialRecommendation}
                  disabled={submitting}
                />
              </Field>
              {/*
                Section 10.1 asks for the action taken alongside the conclusion and the
                recommendation once the score is red or black. It is always available, and
                only required in those bands, which is the same rule the backend applies.
              */}
              <Field
                label="Авах арга хэмжээ"
                required={requiresFindings}
                error={fieldErrors['assessment.actionTaken']}
                hint={
                  redOrBlack
                    ? 'Улаан/хар төлөвт заавал'
                    : requiresFindings
                      ? 'Заавал'
                      : 'Газар дээр нь хийсэн ажил'
                }
              >
                <TextInput
                  value={initialActionTaken}
                  onChange={setInitialActionTaken}
                  disabled={submitting}
                />
              </Field>
            </div>

            {redOrBlack && (
              <p className="mt-2 text-xs text-amber-700">
                Оруулсан оноо улаан/хар түвшинд байна: дүгнэлт, зөвлөмж, авах арга хэмжээ
                гурвуулаа заавал.
              </p>
            )}

            {/* No threshold is stated here — none is known. The form only says why it is
                asking for all three. */}
            {bandsUnknown && scoreTyped && (
              <p className="mt-2 text-xs text-amber-700">
                Үнэлгээний түвшний тохиргоог уншиж чадсангүй. Аль түвшинд байгааг
                тодорхойлох боломжгүй тул дүгнэлт, зөвлөмж, авах арга хэмжээ гурвуулаа
                заавал.
              </p>
            )}

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
