import {
  MATERIAL_UNITS,
  MATERIAL_UNIT_LABELS,
  PERMISSIONS,
  WORK_REPORT_MATERIALS_NOTE,
  WORK_REPORT_REQUIREMENT_LABELS,
  WORK_REPORT_STATUS_LABELS,
  saveWorkReportSchema,
  validateAttributeValues,
  type MaterialUnit,
  type ObjectListItemDto,
  type ObjectTypeAttributeDto,
  type ObjectNodeDto,
  type WorkReportDto,
  type WorkReportPhotoDto,
  type WorkReportStatus,
} from '@monhorus/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import {
  FIELD_INPUT,
  FIELD_SELECT,
  FIELD_TEXTAREA,
  FILTER_LABEL,
} from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { useAuthorisedFileUrls } from '../../lib/use-authorised-file-urls';
import { objectMasterService } from '../../services/object-master.service';
import { objectService } from '../../services/object.service';
import { workReportService } from '../../services/service-request.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';
import {
  ObjectAttributeFields,
  toAttributeDrafts,
  toAttributePayload,
} from '../projects/objects/ObjectAttributeFields';
import { ScoreBar } from '../projects/objects/ObjectBadges';

const STATUS_STYLES: Record<WorkReportStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  SUBMITTED: 'bg-blue-50 text-blue-700 ring-blue-200',
  APPROVED: 'bg-green-50 text-green-700 ring-green-200',
  RETURNED: 'bg-amber-50 text-amber-700 ring-amber-200',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * A material row while it is being edited.
 *
 * The quantity is held as a string so a half-typed number does not become NaN under the
 * user's fingers; it is converted once, on save.
 */
interface MaterialRow {
  name: string;
  quantity: string;
  unit: MaterialUnit;
}

/**
 * What was used on the job, typed by hand.
 *
 * Requirements 19.2 keeps V1 at "нэр/тоо": there is no stock balance to draw down, so a
 * row is a name, a quantity and a unit.
 *
 * The name is free text. A catalogue does exist — `/materials` is mounted on the backend
 * and `services/material.service.ts` is a complete client — but nothing on this screen
 * calls it, so every name typed here is un-normalised and two spellings of one item do
 * not reconcile. Wiring the picker is a decision, not a defect fix.
 */
function MaterialEditor({
  rows,
  disabled,
  onChange,
}: {
  rows: readonly MaterialRow[];
  disabled: boolean;
  onChange: (next: MaterialRow[]) => void;
}): ReactElement {
  function updateRow(index: number, patch: Partial<MaterialRow>): void {
    onChange(rows.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)));
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">
          Ашигласан материал ({rows.length})
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...rows, { name: '', quantity: '', unit: 'PIECE' }])}
          disabled={disabled}
        >
          Материал нэмэх
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
          {WORK_REPORT_MATERIALS_NOTE}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            // Rows carry no identifier, so the position is the key.
            <li key={`report-material-${index}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <input
                type="text"
                value={row.name}
                onChange={(event) => updateRow(index, { name: event.target.value })}
                disabled={disabled}
                placeholder="Материалын нэр"
                aria-label={`Материал ${index + 1} нэр`}
                className={FIELD_INPUT}
              />
              <input
                type="number"
                min="0"
                value={row.quantity}
                onChange={(event) => updateRow(index, { quantity: event.target.value })}
                disabled={disabled}
                placeholder="Тоо"
                aria-label={`Материал ${index + 1} тоо`}
                className={FIELD_INPUT}
              />
              <select
                value={row.unit}
                onChange={(event) => updateRow(index, { unit: event.target.value as MaterialUnit })}
                disabled={disabled}
                aria-label={`Материал ${index + 1} нэгж`}
                className={FIELD_SELECT}
              >
                {MATERIAL_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {MATERIAL_UNIT_LABELS[unit]}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(rows.filter((_entry, position) => position !== index))}
                disabled={disabled}
              >
                Хасах
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Matches the mime types the storage service accepts for an image. */
const ACCEPTED_PHOTO_TYPES = 'image/png,image/jpeg,image/webp';


/**
 * Thumbnail grid for one evidence set.
 *
 * `onRemove` is omitted in the read view, where the conclusion is already saved and the
 * photographs are part of the record rather than a draft.
 */
function PhotoGrid({
  photos,
  urls,
  onRemove,
  onPreview,
}: {
  photos: readonly WorkReportPhotoDto[];
  urls: Record<string, string>;
  onRemove?: (photoId: string) => void;
  onPreview: (photo: WorkReportPhotoDto) => void;
}): ReactElement {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {photos.map((photo) => {
        const url = urls[photo.id] ?? null;
        return (
          <li
            key={photo.id}
            className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
          >
            <button
              type="button"
              onClick={() => onPreview(photo)}
              disabled={url === null}
              aria-label={`${photo.name} томруулж харах`}
              className="block w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
            >
              {url ? (
                <img src={url} alt={photo.name} className="h-24 w-full object-cover" />
              ) : (
                <div className="h-24 w-full animate-pulse bg-slate-200" />
              )}
            </button>
            <div className="flex items-center gap-1 px-2 py-1">
              <p className="min-w-0 flex-1 truncate text-[11px] text-slate-600" title={photo.name}>
                {photo.name}
              </p>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(photo.id)}
                  aria-label={`${photo.name} хасах`}
                  className="shrink-0 rounded px-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                >
                  Хасах
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The section 9.2 work conclusion for a request.
 *
 * Follows the prototype's "Дүгнэлт тайлан гаргах" drawer, with one difference: the
 * prototype offers a risk-level dropdown, and section 10.1 makes the band a function of
 * the score, so it is shown derived rather than chosen. Hand-setting it would allow a 92
 * to be labelled critical.
 */

/**
 * A finding being written about one piece of equipment.
 *
 * Scores are held as strings for the same reason a material quantity is: a half-typed
 * number must not become NaN under the user's fingers. Converted once, on save.
 */
interface AssessmentRow {
  objectId: string;
  code: string | null;
  name: string;
  score: string;
  observation: string;
  conclusion: string;
  recommendation: string;
  /**
   * The equipment type's own declared fields (4.1), or null while they are still loading.
   *
   * NULL IS LOAD-BEARING, NOT A PLACEHOLDER. A declared attribute missing from a saved row
   * is a declared attribute CLEARED, so a row that does not yet know what the type asks — or
   * what the equipment already answered — must send nothing at all rather than an empty set.
   * `toAssessmentPayload` omits the key entirely while this is null, which the API reads as
   * "not asked" and leaves the equipment untouched.
   */
  attributes: readonly ObjectTypeAttributeDto[] | null;
  /** The answers as their controls hold them; parsed once, on save. */
  attributeDrafts: Record<string, string>;
}

/**
 * Choose the equipment a visit looked at, then write up each piece.
 *
 * Follows the location down — the request names a building, the building has floors, a
 * floor has equipment — because the request itself records only where the call was, and
 * WHAT was actually inspected is discovered on site. Selection is therefore made here
 * rather than assumed from the request.
 *
 * Each selected object gets its own score and narrative and becomes its own ReportItem, so
 * a healthy panel and a failing one inspected on the same call read differently. An object
 * left un-scored still reaches the report — the server falls back to the visit's own
 * figures for it — which is what makes "named but not yet written up" a usable draft state
 * rather than a validation error.
 */
function EquipmentAssessments({
  buildingId,
  rows,
  disabled,
  onChange,
  showAttributeErrors,
}: {
  buildingId: string | null;
  rows: readonly AssessmentRow[];
  disabled: boolean;
  /**
   * The state setter itself, not a plain callback.
   *
   * Adding a piece of equipment fires a fetch for its type's fields, and the row has to be
   * patched when that lands — by which time `rows` in this closure is stale. A functional
   * update is what makes that patch safe against anything the user changed in between.
   */
  onChange: Dispatch<SetStateAction<AssessmentRow[]>>;
  /**
   * Whether a save has already been refused over these fields.
   *
   * A report names several pieces of equipment, so opening the drawer with every required
   * attribute already in red would be a wall of complaint about work nobody has started. The
   * messages appear once a save has actually been attempted, and from then on they update as
   * the technician types.
   */
  showAttributeErrors: boolean;
}): ReactElement {
  const [floors, setFloors] = useState<ObjectNodeDto[]>([]);
  const [floorId, setFloorId] = useState('');
  const [objects, setObjects] = useState<ObjectListItemDto[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!buildingId) {
      setFloors([]);
      return;
    }
    objectService
      .children(buildingId)
      .then((nodes) => setFloors(nodes.filter((node) => node.kind === 'FLOOR')))
      .catch(() => setFloors([]));
  }, [buildingId]);

  useEffect(() => {
    if (!floorId) {
      setObjects([]);
      return;
    }
    setLoading(true);
    objectMasterService
      // 100 is the cap `objectListQuerySchema` enforces; more is a 400, not a bigger page.
      .list({ floorId, limit: 100 })
      .then((page) => setObjects(page.items))
      .catch(() => setObjects([]))
      .finally(() => setLoading(false));
  }, [floorId]);

  const selected = new Set(rows.map((row) => row.objectId));

  function add(object: ObjectListItemDto): void {
    if (selected.has(object.id)) return;
    onChange([
      ...rows,
      {
        objectId: object.id,
        code: object.code,
        name: object.name,
        score: '',
        observation: '',
        conclusion: '',
        recommendation: '',
        /*
          Both come off the picked row itself — the list carries what the type declares and
          what this equipment has already answered, so adding equipment costs no round trip.

          Starting the fields from the STORED answers is what makes them safe to send back: a
          declared attribute missing from a saved row is a declared attribute cleared, so a
          blank draft would wipe what somebody recorded on an earlier visit.
        */
        attributes: object.objectType?.attributes ?? [],
        attributeDrafts: toAttributeDrafts(
          object.objectType?.attributes ?? [],
          object.attributeValues,
        ),
      },
    ]);
  }

  /**
   * The type's own refusals for one row, keyed as `ObjectAttributeFields` reads them.
   *
   * Computed rather than stored: the same shared function the backend enforces with, run
   * against what the row currently holds, so a message appears and clears as the technician
   * types instead of only after a rejected save. `showAttributeErrors` is what keeps them
   * out of sight until a save has actually been attempted.
   */
  function attributeErrorsOf(row: AssessmentRow): Record<string, string> {
    if (!showAttributeErrors || !row.attributes) return {};
    const errors: Record<string, string> = {};
    for (const issue of validateAttributeValues(
      row.attributes,
      toAttributePayload(row.attributes, row.attributeDrafts),
    )) {
      errors[issue.field] = issue.message;
    }
    return errors;
  }

  function patchAttribute(objectId: string, key: string, value: string): void {
    onChange(
      rows.map((row) =>
        row.objectId === objectId
          ? { ...row, attributeDrafts: { ...row.attributeDrafts, [key]: value } }
          : row,
      ),
    );
  }

  function patch(objectId: string, changes: Partial<AssessmentRow>): void {
    onChange(rows.map((row) => (row.objectId === objectId ? { ...row, ...changes } : row)));
  }

  return (
    <div className="space-y-3">
      {buildingId ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Давхар">
            <SelectInput
              value={floorId}
              onChange={setFloorId}
              placeholder="Давхар сонгоно уу"
              options={floors.map((floor) => ({ value: floor.id, label: floor.name }))}
              disabled={disabled}
            />
          </Field>
          <Field label="Тоноглол нэмэх" hint={loading ? 'Ачааллаж байна…' : undefined}>
            <SelectInput
              value=""
              onChange={(value) => {
                const object = objects.find((entry) => entry.id === value);
                if (object) add(object);
              }}
              placeholder={floorId ? 'Тоноглол сонгоно уу' : 'Эхлээд давхар сонгоно'}
              options={objects
                .filter((object) => !selected.has(object.id))
                .map((object) => ({
                  value: object.id,
                  label: object.code ? `${object.code} · ${object.name}` : object.name,
                }))}
              disabled={disabled || !floorId}
            />
          </Field>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          Тоноглол сонгоогүй бол энэ дүгнэлт Үзлэг ба дүгнэлт хэсэгт харагдахгүй: тэнд зөвхөн
          тоноглолд холбогдсон үр дүн жагсдаг.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.objectId} className="rounded-lg p-3 ring-1 ring-inset ring-slate-200">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{row.name}</p>
                  {row.code && <p className="text-xs text-slate-500">{row.code}</p>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    onChange(rows.filter((entry) => entry.objectId !== row.objectId))
                  }
                >
                  Хасах
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Үнэлгээ" hint="0-100. Хоосон бол ажлын нийт оноог хэрэглэнэ.">
                  <TextInput
                    type="number"
                    value={row.score}
                    onChange={(value) => patch(row.objectId, { score: value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Ажиглалт">
                  <TextInput
                    value={row.observation}
                    onChange={(value) => patch(row.objectId, { observation: value })}
                    disabled={disabled}
                  />
                </Field>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Дүгнэлт">
                  <TextInput
                    value={row.conclusion}
                    onChange={(value) => patch(row.objectId, { conclusion: value })}
                    disabled={disabled}
                  />
                </Field>
                <Field label="Зөвлөмж">
                  <TextInput
                    value={row.recommendation}
                    onChange={(value) => patch(row.objectId, { recommendation: value })}
                    disabled={disabled}
                  />
                </Field>
              </div>

              {/*
                What this equipment's TYPE asks about it (requirements 4.1).

                Per row, because a report may name a panel and a breaker and they declare
                different things. Rendered from the definitions that arrived with the row, so
                nothing here names a field. Absent for a type that declares none, and absent
                while the definitions are still loading.

                The answers are saved onto the EQUIPMENT rather than onto this finding: the
                score and the narrative above are what this visit observed, while "this
                breaker is fused" is true between visits.
              */}
              {row.attributes && row.attributes.length > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <ObjectAttributeFields
                      attributes={row.attributes}
                      drafts={row.attributeDrafts}
                      onChange={(key, next) => patchAttribute(row.objectId, key, next)}
                      disabled={disabled}
                      fieldErrors={attributeErrorsOf(row)}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportDrawer({
  requestId,
  report,
  buildingId,
  open,
  onClose,
  onSaved,
}: {
  requestId: string;
  report: WorkReportDto;
  /** The request's building, which the equipment picker walks down from. */
  buildingId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (next: WorkReportDto) => void;
}): ReactElement {
  const { notify } = useToast();

  const [score, setScore] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [repairRequired, setRepairRequired] = useState(false);
  const [revisitRequired, setRevisitRequired] = useState(false);
  const [revisitDate, setRevisitDate] = useState('');
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  /** Set once a save has been refused over a type's required fields. See the editor prop. */
  const [attributesRefused, setAttributesRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);
  const [beforePhotos, setBeforePhotos] = useState<readonly WorkReportPhotoDto[]>([]);
  const [afterPhotos, setAfterPhotos] = useState<readonly WorkReportPhotoDto[]>([]);
  const [uploading, setUploading] = useState<'BEFORE' | 'AFTER' | null>(null);
  const [preview, setPreview] = useState<WorkReportPhotoDto | null>(null);

  const beforeUrls = useAuthorisedFileUrls(beforePhotos);
  const afterUrls = useAuthorisedFileUrls(afterPhotos);

  useEffect(() => {
    if (!open) return;
    setScore(report.score === null ? '' : String(report.score));
    setConclusion(report.conclusion ?? '');
    setRecommendation(report.recommendation ?? '');
    setActionTaken(report.actionTaken ?? '');
    setRepairRequired(report.repairRequired);
    setRevisitRequired(report.revisitRequired);
    setRevisitDate(report.revisitDate?.slice(0, 10) ?? '');
    setMaterials(
      report.materials.map((entry) => ({
        name: entry.name,
        quantity: String(entry.quantity),
        unit: entry.unit,
      })),
    );
    // Both lists rehydrate from the report: an object assessed earlier keeps its finding,
    // and one merely named keeps its place with empty fields to fill in.
    setAssessments([
      ...report.objectAssessments.map((entry) => ({
        objectId: entry.objectId,
        code: entry.code,
        name: entry.name ?? entry.objectId,
        score: entry.score === null ? '' : String(entry.score),
        observation: entry.observation ?? '',
        conclusion: entry.conclusion ?? '',
        recommendation: entry.recommendation ?? '',
        attributes: entry.objectTypeAttributes,
        attributeDrafts: toAttributeDrafts(entry.objectTypeAttributes, entry.attributeValues),
      })),
      ...report.objects
        .filter(
          (object) =>
            !report.objectAssessments.some((entry) => entry.objectId === object.id),
        )
        .map((object) => ({
          objectId: object.id,
          code: object.code,
          name: object.name ?? object.id,
          score: '',
          observation: '',
          conclusion: '',
          recommendation: '',
          /*
            Named in an earlier draft but never written up, so the report carries no
            definitions for it. Left null rather than guessed at: the row asks nothing and,
            crucially, sends nothing, so re-saving a draft cannot clear answers it never
            showed. Removing and re-adding the equipment loads them.
          */
          attributes: null,
          attributeDrafts: {},
        })),
    ]);
    setBeforePhotos(report.beforePhotos);
    setAfterPhotos(report.afterPhotos);
    setPreview(null);
    setFormError(null);
    setFieldErrors({});
  }, [open, report]);

  /**
   * Uploads immediately and holds the returned file in draft state.
   *
   * The photo is only bound to the conclusion when the form is saved, so closing the drawer
   * without saving leaves it parked on the uploader rather than silently attached.
   */
  async function handleUpload(slot: 'BEFORE' | 'AFTER', file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(slot);
    setFormError(null);

    try {
      const photo = await workReportService.uploadPhoto(file);
      const append = (current: readonly WorkReportPhotoDto[]): readonly WorkReportPhotoDto[] => [
        ...current,
        photo,
      ];
      if (slot === 'BEFORE') setBeforePhotos(append);
      else setAfterPhotos(append);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Зураг хуулж чадсангүй.');
    } finally {
      setUploading(null);
    }
  }

  async function handleSave(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    /**
     * The type's own required fields, checked before anything is sent.
     *
     * The same shared function the backend enforces with, run per row because each piece of
     * equipment declares its own. A row whose definitions never loaded is skipped: it sends
     * no attributes at all, so there is nothing to be required about.
     *
     * Refused here rather than round-tripped so the technician is told which equipment is
     * short, on a form that may be listing four of them.
     */
    const shortRow = assessments.find(
      (row) =>
        row.attributes !== null &&
        validateAttributeValues(row.attributes, toAttributePayload(row.attributes, row.attributeDrafts))
          .length > 0,
    );
    if (shortRow) {
      setAttributesRefused(true);
      setFormError(
        `"${shortRow.name}" тоноглолын шаардлагатай үзүүлэлт дутуу байна.`,
      );
      return;
    }
    setAttributesRefused(false);

    const parsed = saveWorkReportSchema.safeParse({
      score: score.trim() === '' ? null : Number(score),
      conclusion: conclusion.trim() || null,
      recommendation: recommendation.trim() || null,
      actionTaken: actionTaken.trim() || null,
      repairRequired,
      revisitRequired,
      revisitDate: revisitDate ? `${revisitDate}T00:00:00.000Z` : null,
      // The save replaces both sets outright, so these must be the drawer's working copies
      // and not the report's: sending the stored ids back would discard anything just
      // attached and resurrect anything just removed.
      beforePhotoIds: beforePhotos.map((photo) => photo.id),
      afterPhotoIds: afterPhotos.map((photo) => photo.id),
      // Replaced outright for the same reason as the photo sets: the drawer's copy is the
      // whole truth about the list.
      // Every selected object goes in `objectIds` as well, so an object named but not yet
      // written up still reaches the report and can be filled in later.
      objectIds: assessments.map((row) => row.objectId),
      objectAssessments: assessments.map((row) => ({
        objectId: row.objectId,
        score: row.score.trim() === '' ? null : Number(row.score),
        observation: row.observation.trim() || null,
        conclusion: row.conclusion.trim() || null,
        recommendation: row.recommendation.trim() || null,
        photoIds: [],
        // Omitted entirely while the definitions are unknown — absent means "not asked",
        // and an empty object would mean "the answer to everything is nothing".
        ...(row.attributes
          ? { attributeValues: toAttributePayload(row.attributes, row.attributeDrafts) }
          : {}),
      })),
      materials: materials
        .filter((row) => row.name.trim().length > 0)
        .map((row) => ({
          name: row.name.trim(),
          quantity: Number(row.quantity || '0'),
          unit: row.unit,
        })),
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

    setSaving(true);
    try {
      const saved = await workReportService.save(requestId, parsed.data);
      notify('Дүгнэлт хадгалагдлаа.', 'success');
      onSaved(saved);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSaving(false);
    }
  }

  const parsedScore = score.trim() === '' ? null : Number(score);

  return (
    <>
      <Drawer
        open={open}
        title="Дүгнэлт тайлан гаргах"
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Цуцлах
            </Button>
            <Button onClick={() => void handleSave()} loading={saving} disabled={uploading !== null}>
              Хадгалах
            </Button>
          </>
        }
      >
        <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        <Field label="Үнэлгээ (0-100)" required error={fieldErrors.score}>
          <TextInput type="number" value={score} onChange={setScore} disabled={saving} />
        </Field>

        <div>
          <span className={FILTER_LABEL}>Эрсдэлийн түвшин</span>
          <div className="rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-inset ring-slate-200">
            <ScoreBar
              level={parsedScore === report.score ? report.riskLevel : null}
              score={parsedScore}
              showPill
            />
          </div>
        </div>

        <div>
          <label htmlFor="report-conclusion" className={FILTER_LABEL}>
            Дүгнэлт <span className="text-red-600">*</span>
          </label>
          <textarea
            id="report-conclusion"
            rows={3}
            value={conclusion}
            onChange={(event) => setConclusion(event.target.value)}
            disabled={saving}
            className={FIELD_TEXTAREA}
          />
          {fieldErrors.conclusion && (
            <p className="mt-0.5 text-xs text-red-600">{fieldErrors.conclusion}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="report-recommendation"
            className={FILTER_LABEL}
          >
            Зөвлөмж / арга хэмжээ <span className="text-red-600">*</span>
          </label>
          <textarea
            id="report-recommendation"
            rows={3}
            value={recommendation}
            onChange={(event) => setRecommendation(event.target.value)}
            disabled={saving}
            className={FIELD_TEXTAREA}
          />
        </div>

        {(
          [
            { slot: 'BEFORE', label: 'Ажлын өмнөх зураг', photos: beforePhotos, urls: beforeUrls, ref: beforeInputRef, set: setBeforePhotos },
            { slot: 'AFTER', label: 'Ажлын дараах зураг', photos: afterPhotos, urls: afterUrls, ref: afterInputRef, set: setAfterPhotos },
          ] as const
        ).map((field) => (
          <div key={field.slot}>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">
                {field.label} ({field.photos.length})
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => field.ref.current?.click()}
                loading={uploading === field.slot}
                disabled={saving || uploading !== null}
              >
                Зураг хавсаргах
              </Button>
            </div>

            <input
              ref={field.ref}
              type="file"
              accept={ACCEPTED_PHOTO_TYPES}
              className="hidden"
              aria-label={`${field.label} сонгох`}
              onChange={(event) => {
                void handleUpload(field.slot, event.target.files?.[0]);
                // Cleared so re-picking the same file fires change again.
                event.target.value = '';
              }}
            />

            {field.photos.length > 0 ? (
              <PhotoGrid
                photos={field.photos}
                urls={field.urls}
                onPreview={setPreview}
                onRemove={(photoId) =>
                  field.set((current) => current.filter((entry) => entry.id !== photoId))
                }
              />
            ) : (
              <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                Хавсаргаагүй
              </p>
            )}
          </div>
        ))}

        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">
            Үзлэг хийсэн тоноглол ({assessments.length})
          </p>
          <EquipmentAssessments
            buildingId={buildingId}
            rows={assessments}
            disabled={saving}
            onChange={setAssessments}
            showAttributeErrors={attributesRefused}
          />
        </div>

        <MaterialEditor rows={materials} disabled={saving} onChange={setMaterials} />

        <div>
          <label htmlFor="report-action" className={FILTER_LABEL}>
            Хийсэн ажил
          </label>
          <textarea
            id="report-action"
            rows={2}
            value={actionTaken}
            onChange={(event) => setActionTaken(event.target.value)}
            disabled={saving}
            className={FIELD_TEXTAREA}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={repairRequired}
            onChange={(event) => setRepairRequired(event.target.checked)}
            disabled={saving}
            className="h-4 w-4 rounded border-slate-300"
          />
          Засвар шаардлагатай
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={revisitRequired}
            onChange={(event) => setRevisitRequired(event.target.checked)}
            disabled={saving}
            className="h-4 w-4 rounded border-slate-300"
          />
          Дахин үзлэг шаардлагатай
        </label>

        {revisitRequired && (
          <Field label="Дахин очих огноо" error={fieldErrors.revisitDate}>
            <TextInput type="date" value={revisitDate} onChange={setRevisitDate} disabled={saving} />
          </Field>
        )}
        </div>
      </Drawer>

      <PhotoPreviewModal
        photo={preview}
        url={preview ? (beforeUrls[preview.id] ?? afterUrls[preview.id] ?? null) : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

/**
 * The saved before/after evidence, shown as pictures rather than filenames.
 *
 * Its own component so the authorised-URL hooks sit at a component boundary instead of
 * inside the panel's render body.
 */
function ReportEvidence({ report }: { report: WorkReportDto }): ReactElement {
  const beforeUrls = useAuthorisedFileUrls(report.beforePhotos);
  const afterUrls = useAuthorisedFileUrls(report.afterPhotos);
  const [preview, setPreview] = useState<WorkReportPhotoDto | null>(null);

  return (
    <>
      <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
        {(
          [
            { label: 'Ажлын өмнөх зураг', photos: report.beforePhotos, urls: beforeUrls },
            { label: 'Ажлын дараах зураг', photos: report.afterPhotos, urls: afterUrls },
          ] as const
        ).map((field) => (
          <div key={field.label}>
            <p className="mb-1 text-xs font-medium text-slate-600">
              {field.label} ({field.photos.length})
            </p>
            {field.photos.length === 0 ? (
              <p className="text-xs text-slate-400">Хавсаргаагүй</p>
            ) : (
              <PhotoGrid photos={field.photos} urls={field.urls} onPreview={setPreview} />
            )}
          </div>
        ))}
      </div>

      <PhotoPreviewModal
        photo={preview}
        url={preview ? (beforeUrls[preview.id] ?? afterUrls[preview.id] ?? null) : null}
        onClose={() => setPreview(null)}
      />
    </>
  );
}

/**
 * Enlarged view of one evidence photo.
 *
 * Reuses the object URL the thumbnail already resolved, so opening a preview costs no
 * second download and there is a single URL per photo to revoke.
 */
function PhotoPreviewModal({
  photo,
  url,
  onClose,
}: {
  photo: WorkReportPhotoDto | null;
  url: string | null;
  onClose: () => void;
}): ReactElement {
  return (
    <Modal open={photo !== null} title={photo?.name ?? ''} onClose={onClose}>
      {url ? (
        <img src={url} alt={photo?.name ?? ''} className="mx-auto max-h-[70vh] w-auto" />
      ) : (
        <p className="py-6 text-center text-sm text-slate-500">Зураг ачаалж чадсангүй.</p>
      )}
    </Modal>
  );
}

/** The status pill, shown both on the trigger row and inside the drawer. */
function StatusPill({ status }: { status: WorkReportStatus }): ReactElement {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {WORK_REPORT_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The conclusion as written: what was found, what is still missing, the evidence and the
 * materials.
 *
 * Read-only. Every control that changes the report lives in the drawer footer that owns
 * this body, so this renders identically to a technician and to a reviewer.
 */
function ReportSummary({ report }: { report: WorkReportDto }): ReactElement {
  return (
    <>
      {report.status === 'RETURNED' && report.returnReason && (
        <div className="mb-3">
          <Alert variant="warning" title="Засварлуулахаар буцаасан">
            {report.returnReason}
          </Alert>
        </div>
      )}

      {/* Rules 17.6 and 17.7 stop a request being finished without these, so every
          outstanding field is named at once rather than discovered one refusal at a time. */}
      {!report.isComplete && (
        <div className="mb-3">
          <Alert variant="warning" title="Дараах мэдээлэл дутуу байна">
            <ul className="ml-4 list-disc space-y-0.5">
              {report.missing.map((field) => (
                <li key={field}>{WORK_REPORT_REQUIREMENT_LABELS[field]}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Эдгээрийг бөглөх хүртэл ажлыг дуусгах боломжгүй.</p>
          </Alert>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Үнэлгээ</dt>
          <dd className="mt-0.5">
            <ScoreBar level={report.riskLevel} score={report.score} showPill />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Шаардлага</dt>
          <dd className="mt-0.5 flex flex-wrap gap-1.5">
            {report.repairRequired && (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">
                Засвар шаардлагатай
              </span>
            )}
            {report.revisitRequired && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                Дахин үзлэг {report.revisitDate?.slice(0, 10) ?? ''}
              </span>
            )}
            {!report.repairRequired && !report.revisitRequired && (
              <span className="text-xs text-slate-500">Байхгүй</span>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">Дүгнэлт</dt>
          <dd className="whitespace-pre-wrap text-sm text-slate-900">{report.conclusion ?? '-'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-slate-500">Зөвлөмж</dt>
          <dd className="whitespace-pre-wrap text-sm text-slate-900">
            {report.recommendation ?? '-'}
          </dd>
        </div>
      </dl>

      <ReportEvidence report={report} />

      <div className="mt-3 border-t border-slate-200 pt-3">
        <p className="mb-1 text-xs font-medium text-slate-600">
          Ашигласан материал ({report.materials.length})
        </p>
        {report.materials.length === 0 ? (
          <p className="text-xs text-slate-400">{WORK_REPORT_MATERIALS_NOTE}</p>
        ) : (
          <ul className="space-y-0.5">
            {report.materials.map((material, index) => (
              <li
                // Saved rows carry no identifier of their own, so the position is the key.
                key={`${material.name}-${index}`}
                className="flex justify-between gap-2 text-xs text-slate-600"
              >
                <span className="truncate">{material.name}</span>
                <span className="shrink-0 tabular-nums">
                  {material.quantity} {MATERIAL_UNIT_LABELS[material.unit]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Requirements 11: who wrote it and when, printed at the end of the conclusion. */}
      <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
        Бичсэн: {report.createdByName ?? '-'} · {formatDateTime(report.createdAt)}
        {report.submittedAt ? ` · Илгээсэн ${formatDateTime(report.submittedAt)}` : ''}
        {report.approvedByName
          ? ` · Баталсан ${report.approvedByName} ${formatDateTime(report.approvedAt)}`
          : ''}
      </p>
    </>
  );
}

/**
 * Which overlay is open, if any.
 *
 * One value rather than three booleans, because the [Drawer] is a plain `fixed inset-0
 * z-50` element with no portal and no stacking order of its own: two open at once would
 * fight over the body scroll lock and both close on a single Escape. Editing and
 * returning therefore replace the report view rather than stack on it, and hand control
 * back to `'report'` when they finish so the reader is not dropped onto the page.
 */
type ReportPane = 'none' | 'report' | 'edit' | 'return';

/**
 * The work conclusion for a request, behind one button.
 *
 * The body is the tallest thing on the detail page and is read far less often than the
 * status, location and history around it, so the page carries only the trigger — the
 * status at a glance, plus a marker when something is still outstanding — and the report
 * itself opens in a drawer. Keeping the evidence photos unmounted until then also means
 * the page no longer downloads every one of them on load.
 */
export function WorkReportPanel({
  requestId,
  buildingId = null,
  onRequestMoved,
}: {
  requestId: string;
  /** Where the call was. Null leaves the equipment picker unusable and says so. */
  buildingId?: string | null;
  /**
   * Called when an action here has ALSO moved the request itself.
   *
   * Submitting a conclusion advances the request to REPORT_SUBMITTED and approving one
   * completes it — `advanceOnConclusion` on the backend, called from `submitWorkReport`
   * and `approveWorkReport`. Neither response carries the request, so a page holding one
   * keeps a status that went stale the moment either button was pressed, and goes on
   * offering the transitions the OLD status allowed. Pressing one of those produces
   * «"COMPLETED" төлвөөс "COMPLETED" төлөв рүү шилжих боломжгүй» — a refusal the reader
   * cannot make sense of, because their screen still says the request is somewhere else.
   */
  onRequestMoved?: () => void;
}): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();

  const canEdit = can(PERMISSIONS.SERVICE_REQUEST_UPDATE);
  const canReview = can(PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS);

  const [report, setReport] = useState<WorkReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<ReportPane>('none');
  const [returnReason, setReturnReason] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setReport(await workReportService.get(requestId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Дүгнэлт ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Runs one conclusion action.
   *
   * `movesRequest` is passed by the two call sites whose action also advances the request,
   * rather than inferred here, so that a new action has to state which it is.
   */
  async function run(
    action: () => Promise<WorkReportDto>,
    message: string,
    movesRequest = false,
  ): Promise<void> {
    setBusy(true);
    try {
      setReport(await action());
      if (movesRequest) onRequestMoved?.();
      notify(message, 'success');
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Гүйцэтгэж чадсангүй.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Short, because the trigger it stands in for is a single row rather than a panel.
  if (loading) return <Skeleton className="h-14 w-full" />;
  if (error || !report) {
    return (
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <Alert variant="error">{error ?? 'Дүгнэлт олдсонгүй.'}</Alert>
      </section>
    );
  }

  return (
    <>
      <section className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <Button variant="secondary" size="sm" onClick={() => setPane('report')}>
          Ажлын дүгнэлт
        </Button>
        <StatusPill status={report.status} />
        {/* The one thing worth surfacing without opening the drawer: the request cannot be
            finished while this is true, and the reason is a click away. */}
        {!report.isComplete && (
          <span className="text-xs text-amber-700">Дутуу мэдээлэлтэй</span>
        )}
      </section>

      <Drawer
        open={pane === 'report'}
        title="Ажлын дүгнэлт"
        width="lg"
        onClose={() => setPane('none')}
        footer={
          <>
            {canEdit && report.status !== 'APPROVED' && (
              <Button variant="secondary" onClick={() => setPane('edit')}>
                Засах
              </Button>
            )}
            {canEdit && (report.status === 'DRAFT' || report.status === 'RETURNED') && (
              <Button
                loading={busy}
                disabled={!report.isComplete}
                onClick={() =>
                  void run(
                    () => workReportService.submit(requestId),
                    'Хянуулахаар илгээлээ.',
                    true,
                  )
                }
              >
                Хянуулахаар илгээх
              </Button>
            )}
            {canReview && report.status === 'SUBMITTED' && (
              <>
                <Button
                  loading={busy}
                  onClick={() =>
                    void run(() => workReportService.approve(requestId), 'Батлагдлаа.', true)
                  }
                >
                  Батлах
                </Button>
                <Button variant="danger" onClick={() => setPane('return')}>
                  Буцаах
                </Button>
              </>
            )}
          </>
        }
      >
        <div className="mb-3">
          <StatusPill status={report.status} />
        </div>
        <ReportSummary report={report} />
      </Drawer>

      <ReportDrawer
        requestId={requestId}
        report={report}
        buildingId={buildingId}
        open={pane === 'edit'}
        onClose={() => setPane('report')}
        onSaved={(next) => {
          setReport(next);
          setPane('report');
        }}
      />

      <Drawer
        open={pane === 'return'}
        title="Дүгнэлт буцаах"
        onClose={() => setPane('report')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPane('report')} disabled={busy}>
              Болих
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                void run(
                  () => workReportService.returnForFix(requestId, returnReason.trim()),
                  'Буцаалаа.',
                ).then(() => {
                  setPane('report');
                  setReturnReason('');
                });
              }}
            >
              Буцаах
            </Button>
          </>
        }
      >
        <div>
          <label htmlFor="return-reason" className={FILTER_LABEL}>
            Шалтгаан <span className="text-red-600">*</span>
          </label>
          <textarea
            id="return-reason"
            rows={3}
            value={returnReason}
            onChange={(event) => setReturnReason(event.target.value)}
            className={FIELD_TEXTAREA}
          />
        </div>
      </Drawer>
    </>
  );
}
