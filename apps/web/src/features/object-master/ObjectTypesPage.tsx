import {
  MAX_OBJECT_TYPE_ICON_BYTES,
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_LABELS,
  OBJECT_ICONS,
  OBJECT_ICON_LABELS,
  OBJECT_TYPE_ICON_MIME,
  PERMISSIONS,
  createObjectTypeSchema,
  updateObjectTypeSchema,
  type ObjectCategory,
  type ObjectIcon,
  type ObjectTypeAttributeDto,
  type ObjectTypeDto,
  type ObjectTypeListQuery,
  type PaginatedData,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { SearchField } from '../../components/ui/SearchField';
import { useToast } from '../../components/ui/ToastProvider';
import {
  FIELD_TEXTAREA,
  FILTER_BAR,
  FILTER_LABEL,
  FILTER_SELECT,
} from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { authorisedFileUrl } from '../../lib/file-url';
import { objectTypeService } from '../../services/object-master.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';
import { ObjectTypeAttributesEditor } from './ObjectTypeAttributesEditor';
import { ObjectCategoryBadge } from '../projects/objects/ObjectBadges';
import { ObjectTypeIcon } from '../projects/plan-icons';

/** Roughly how large the icon may be, in the words the hint and the error both use. */
const ICON_LIMIT_KB = Math.round(MAX_OBJECT_TYPE_ICON_BYTES / 1024);

/**
 * Why a chosen file cannot be an icon, or null when nothing is obviously wrong with it.
 *
 * THIS IS NOT A SECURITY CHECK, and nothing downstream may be simplified on the strength
 * of it. Both rules are the browser's word for what the user picked: a `File.type` is
 * whatever the OS guessed from the extension, and a size is a number the page could not
 * verify. The gate is the server — `POST /files/object-type-icons` caps the request at
 * MAX_OBJECT_TYPE_ICON_BYTES, refuses any content type but OBJECT_TYPE_ICON_MIME, and
 * then PARSES the bytes and stores only the parser's sanitised output. Anything posted
 * straight at the endpoint meets all of that and none of this. What this buys is a user
 * who is told "that is a PNG" in the form instead of by a round trip.
 *
 * The limits themselves come from the shared constants, so the message and the server
 * cannot drift apart.
 */
function iconFileProblem(file: File): string | null {
  if (file.type !== OBJECT_TYPE_ICON_MIME) {
    return 'Зөвхөн SVG өргөтгөлтэй файл байршуулна уу.';
  }
  if (file.size > MAX_OBJECT_TYPE_ICON_BYTES) {
    return `Айкон ${ICON_LIMIT_KB}KB-аас хэтрэхгүй байх ёстой.`;
  }
  return null;
}

/**
 * Section 4.1 equipment type registry.
 *
 * `Дүгнэлт үүсгэх эсэх` is the flag with immediate effect: it decides whether an object of
 * this type may carry an assessment. `План дээр харуулах эсэх` and the icon are stored for
 * the plan editor, which is not approved yet, and are labelled as such.
 */
function TypeDrawer({
  target,
  onClose,
  onSaved,
}: {
  target: ObjectTypeDto | null | 'new';
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const isNew = target === 'new';
  const existing = target !== null && target !== 'new' ? target : null;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ObjectCategory>('EQUIPMENT');
  const [showOnPlan, setShowOnPlan] = useState(false);
  const [insidePanel, setInsidePanel] = useState(false);
  const [generatesConclusion, setGeneratesConclusion] = useState(true);
  const [canCreateCall, setCanCreateCall] = useState(false);
  /*
   * Held as a string, like every other numeric field in this app: a number input reports ''
   * while being cleared, and Number('') is 0 - which here would read as a zero-hour SLA
   * rather than as "not filled in yet".
   */
  const [callSlaHours, setCallSlaHours] = useState('');
  const [icon, setIcon] = useState<ObjectIcon>('OTHER');
  const [isActive, setIsActive] = useState(true);
  /** What objects of this type must record beyond their category's own fields (4.1). */
  const [attributes, setAttributes] = useState<ObjectTypeAttributeDto[]>([]);

  // -- Custom icon -----------------------------------------------------------
  /** The uploaded file the type will carry, or null for "no custom icon". */
  const [iconFileId, setIconFileId] = useState<string | null>(null);
  /**
   * Whether the icon was touched at all in this session of the drawer.
   *
   * This is the whole reason a PATCH can leave an icon alone. `iconFileId` on the update
   * payload is three-valued — absent leaves it, an id replaces it, `null` clears it — and
   * a form that always sent its state would have no way to say "absent". Editing a type's
   * name would then re-send the icon it already had, and worse, editing a type whose icon
   * had not loaded would clear it.
   */
  const [iconTouched, setIconTouched] = useState(false);
  /** Object url for a file chosen in this drawer, shown before anything is saved. */
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  /** Object url for the icon the type is already saved with, when editing one. */
  const [savedPreview, setSavedPreview] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return;
    setFormError(null);
    setFieldErrors({});
    setIconError(null);
    setIconTouched(false);
    setLocalPreview(null);
    setIconFileId(existing?.iconFileId ?? null);
    if (iconInputRef.current) iconInputRef.current.value = '';

    if (existing) {
      setCode(existing.code);
      setName(existing.name);
      setDescription(existing.description ?? '');
      setCategory(existing.category);
      setShowOnPlan(existing.showOnPlan);
      setInsidePanel(existing.insidePanel);
      setGeneratesConclusion(existing.generatesConclusion);
      setCanCreateCall(existing.canCreateCall);
      setCallSlaHours(existing.callSlaHours === null ? '' : String(existing.callSlaHours));
      setIcon(existing.icon);
      setIsActive(existing.isActive);
      // Copied rather than referenced: the editor replaces rows wholesale, and holding the
      // list row's own objects would let an unsaved edit show up in the table behind.
      setAttributes(
        existing.attributes.map((attribute) => ({
          ...attribute,
          options: attribute.options.map((option) => ({ ...option })),
        })),
      );
    } else {
      setCode('');
      setName('');
      setDescription('');
      setCategory('EQUIPMENT');
      setShowOnPlan(false);
      setInsidePanel(false);
      setGeneratesConclusion(true);
      setCanCreateCall(false);
      setCallSlaHours('');
      setIcon('OTHER');
      setIsActive(true);
      setAttributes([]);
    }
  }, [target, existing]);

  /**
   * The icon the type is already saved with.
   *
   * `GET /files/:id` requires the bearer token, so the stored icon cannot be a bare `src`
   * any more than an employee photo can: it is fetched and turned into an object url,
   * which is revoked when the drawer moves to another type or closes.
   */
  useEffect(() => {
    const path = existing?.iconUrl ?? null;
    if (target === null || !path) {
      setSavedPreview(null);
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void authorisedFileUrl(path)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setSavedPreview(url);
      })
      // An icon that will not load is not worth an error in a form about something else;
      // the fallback glyph is what the plan draws in that case anyway.
      .catch(() => setSavedPreview(null));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target, existing]);

  /** A locally previewed file lives as long as the document unless it is let go of. */
  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  /**
   * What the preview shows: the file just chosen, else the one already saved.
   *
   * The saved icon is only shown while `iconFileId` still names it. Removing it sets that
   * to null, and the preview has to go with it — the point of Remove is to see the type
   * fall back to its built-in glyph before saving, not after.
   */
  const previewUrl =
    localPreview ?? (iconFileId !== null && iconFileId === existing?.iconFileId ? savedPreview : null);
  const hasIcon = iconFileId !== null;

  async function handleIconPicked(file: File | undefined): Promise<void> {
    if (!file) return;
    setIconError(null);

    const problem = iconFileProblem(file);
    if (problem) {
      setIconError(problem);
      // The rejected file is dropped, so picking the same one again re-runs the check.
      if (iconInputRef.current) iconInputRef.current.value = '';
      return;
    }

    setIconUploading(true);
    try {
      const uploaded = await objectTypeService.uploadIcon(file);
      setIconFileId(uploaded.id);
      setIconTouched(true);
      // Previewed from the local file rather than by fetching what was just sent: the
      // bytes are already here, and an `<img>` of an object url cannot run what is in it.
      setLocalPreview(URL.createObjectURL(file));
    } catch (caught) {
      setIconError(caught instanceof ApiError ? caught.message : 'Айкон хуулж чадсангүй.');
    } finally {
      setIconUploading(false);
      if (iconInputRef.current) iconInputRef.current.value = '';
    }
  }

  function handleIconRemoved(): void {
    setIconFileId(null);
    setIconTouched(true);
    setLocalPreview(null);
    setIconError(null);
    if (iconInputRef.current) iconInputRef.current.value = '';
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const parsed = isNew
      ? createObjectTypeSchema.safeParse({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || null,
          category,
          showOnPlan,
          insidePanel,
          generatesConclusion,
          canCreateCall,
          // Null rather than 0 when blank, and dropped entirely when calls are off, so the
          // server is never asked to store hours for a type nobody can call about.
          callSlaHours: canCreateCall && callSlaHours.trim() !== '' ? Number(callSlaHours) : null,
          icon,
          attributes,
          // Sent only when there is one to claim; the endpoint treats absent as "none".
          ...(iconFileId !== null ? { iconFileId } : {}),
        })
      : updateObjectTypeSchema.safeParse({
          name: name.trim(),
          description: description.trim() || null,
          showOnPlan,
          insidePanel,
          generatesConclusion,
          canCreateCall,
          callSlaHours: canCreateCall && callSlaHours.trim() !== '' ? Number(callSlaHours) : null,
          icon,
          isActive,
          // Always sent, unlike the icon below: the whole list is what the editor holds, so
          // "as it now stands" is the only thing it can say, and every change to it — an
          // added row, a removed one, a new order — is expressed the same way.
          attributes,
          /*
            The three-valued field, and the key is deliberately absent unless the icon was
            touched. Absent leaves the type's icon exactly as it is, an id replaces it, and
            an explicit null clears it back to the built-in glyph. Spreading the state
            unconditionally would make "I renamed a type" mean "and re-stated its icon".
          */
          ...(iconTouched ? { iconFileId } : {}),
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

    setSubmitting(true);
    try {
      if (isNew) {
        await objectTypeService.create(
          parsed.data as Parameters<typeof objectTypeService.create>[0],
        );
        notify('Тоноглолын төрөл үүслээ.', 'success');
      } else if (existing) {
        await objectTypeService.update(
          existing.id,
          parsed.data as Parameters<typeof objectTypeService.update>[1],
        );
        notify('Тоноглолын төрөл шинэчлэгдлээ.', 'success');
      }
      onSaved();
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

  return (
    <Drawer
      open={target !== null}
      title={isNew ? 'Шинэ тоноглолын төрөл' : (existing?.name ?? '')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        {!isNew && (
          <Alert variant="info">
            Код болон ангиллыг үүсгэсний дараа өөрчлөхгүй. Аль хэдийн бүртгэгдсэн объектууд
            хүчингүй болохоос сэргийлж байна.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Код" required={isNew} error={fieldErrors.code}>
            <TextInput
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              disabled={submitting || !isNew}
            />
          </Field>
          <Field label="Нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={submitting} />
          </Field>
          <Field label="Ангилал" required error={fieldErrors.category}>
            <SelectInput
              value={category}
              onChange={(value) => setCategory(value as ObjectCategory)}
              options={OBJECT_CATEGORIES.map((entry) => ({
                value: entry,
                label: OBJECT_CATEGORY_LABELS[entry],
              }))}
              disabled={submitting || !isNew}
            />
          </Field>
          <Field label="План дээрх тэмдэглэгээ" error={fieldErrors.icon}>
            <SelectInput
              value={icon}
              onChange={(value) => setIcon(value as ObjectIcon)}
              options={OBJECT_ICONS.map((entry) => ({
                value: entry,
                label: OBJECT_ICON_LABELS[entry],
              }))}
              disabled={submitting}
            />
          </Field>
        </div>

        {/*
          The custom icon, beside the built-in one it overrides rather than replaces.

          The enum picker above stays required on purpose: it is what every client that
          has not learned about uploads still draws, and what this type falls back to the
          moment the file is removed or fails to load.
        */}
        <div>
          <label htmlFor="type-icon-file" className={FILTER_LABEL}>
            Тусгай айкон (SVG)
          </label>

          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200">
              {previewUrl ? (
                /*
                  An `<img>`, never markup inlined into this document by React's raw-HTML
                  escape hatch — for a file the server has not seen yet least of all. An SVG
                  is a document: put into this page its script would run as this page, in
                  this session. Inside an `<img>` the browser treats it as a picture and
                  executes nothing, which is the layer that has to hold if sanitising ever
                  does not. A test pins the absence of the escape hatch in this file.
                */
                <img
                  src={previewUrl}
                  alt="Сонгосон айкон"
                  className="h-8 w-8 object-contain"
                  draggable={false}
                />
              ) : (
                <ObjectTypeIcon icon={icon} className="h-6 w-6" />
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <input
                id="type-icon-file"
                ref={iconInputRef}
                type="file"
                accept={`${OBJECT_TYPE_ICON_MIME},.svg`}
                disabled={submitting || iconUploading}
                onChange={(event) => void handleIconPicked(event.target.files?.[0])}
                className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:text-slate-700"
              />
              <p className="text-xs text-slate-500">
                SVG, хамгийн ихдээ {ICON_LIMIT_KB}KB. Оруулаагүй бол дээрх тэмдэглэгээг
                ашиглана.
              </p>
              {iconUploading && <p className="text-xs text-slate-500">Айкон хуулж байна…</p>}
              {iconError && <p className="text-xs text-red-600">{iconError}</p>}
              {fieldErrors.iconFileId && (
                <p className="text-xs text-red-600">{fieldErrors.iconFileId}</p>
              )}
              {hasIcon && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleIconRemoved}
                  disabled={submitting || iconUploading}
                >
                  Айкон устгах
                </Button>
              )}
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="type-description" className={FILTER_LABEL}>
            Тайлбар
          </label>
          <textarea
            id="type-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
        </div>

        <fieldset aria-label="Тохиргоо" className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={canCreateCall}
              onChange={(event) => setCanCreateCall(event.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Дуудлага үүсгэх боломжтой эсэх
              <span className="block text-xs text-slate-500">
                Идэвхтэй бол энэ төрлийг сонгож дуудлага үүсгэнэ. Дуудлагын SLA хугацаа
                доорх утгаар бодогдоно.
              </span>
            </span>
          </label>

          {/*
            Shown only when calls are enabled, because the hours mean nothing otherwise -
            and required then, because the server refuses the pair apart. Same conditional
            shape as `isActive` below, which is likewise only meaningful in one state.
          */}
          {canCreateCall && (
            <Field
              label="Дуудлагын SLA хугацаа (цаг)"
              required
              error={fieldErrors.callSlaHours}
              hint="Жишээ: гэрэл 24 цаг, автомат залгуур 6 цаг. Яаралтай эсэх нь энэ хугацааг өөрчлөхгүй."
            >
              <TextInput
                value={callSlaHours}
                onChange={setCallSlaHours}
                type="number"
                placeholder="24"
                disabled={submitting}
              />
            </Field>
          )}

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={generatesConclusion}
              onChange={(event) => setGeneratesConclusion(event.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              Дүгнэлт үүсгэх эсэх
              <span className="block text-xs text-slate-500">
                Идэвхгүй бол энэ төрлийн объектод үнэлгээ бүртгэх боломжгүй.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={insidePanel}
              onChange={(event) => setInsidePanel(event.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>Самбарт байрлах эсэх</span>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showOnPlan}
              onChange={(event) => setShowOnPlan(event.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              План дээр харуулах эсэх
              <span className="block text-xs text-slate-500">
                План зураг дээрх байршуулалт батлагдаагүй тул одоогоор хадгалагдана.
              </span>
            </span>
          </label>

          {!isNew && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-slate-300"
              />
              Идэвхтэй
            </label>
          )}
        </fieldset>

        <ObjectTypeAttributesEditor
          value={attributes}
          onChange={setAttributes}
          disabled={submitting}
          /*
            Read off the SAVED type rather than off the editor's own state, so a key that
            objects may already carry values under stays fixed while a row added in this
            session stays editable. Empty when registering a new type, where nothing can be
            stored against anything yet.
          */
          savedKeys={new Set((existing?.attributes ?? []).map((attribute) => attribute.key))}
          fieldErrors={fieldErrors}
        />
      </div>
    </Drawer>
  );
}

export function ObjectTypesPage(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.OBJECT_TYPE_MANAGE);

  const query = useMemo<ObjectTypeListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 50,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
      ...(searchParams.get('category')
        ? { category: searchParams.get('category') as ObjectCategory }
        : {}),
      ...(searchParams.get('isActive') ? { isActive: searchParams.get('isActive') === 'true' } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<ObjectTypeDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [target, setTarget] = useState<ObjectTypeDto | null | 'new'>(null);
  const [deleteTarget, setDeleteTarget] = useState<ObjectTypeDto | null>(null);

  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await objectTypeService.list(JSON.parse(queryKey) as ObjectTypeListQuery));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Төрөл ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await objectTypeService.remove(deleteTarget.id);
      notify('Тоноглолын төрөл устгагдлаа.', 'success');
      setDeleteTarget(null);
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
      setDeleteTarget(null);
    }
  }

  const columns: ReadonlyArray<Column<ObjectTypeDto>> = [
    {
      key: 'type',
      header: 'Төрөл',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'category',
      header: 'Ангилал',
      render: (row) => <ObjectCategoryBadge category={row.category} />,
    },
    {
      key: 'generatesConclusion',
      header: 'Дүгнэлт үүсгэх',
      render: (row) =>
        row.generatesConclusion ? (
          <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700">Тийм</span>
        ) : (
          <span className="text-xs text-slate-400">Үгүй</span>
        ),
    },
    {
      key: 'insidePanel',
      header: 'Самбарт байрлах',
      render: (row) =>
        row.insidePanel ? (
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-700">Тийм</span>
        ) : (
          <span className="text-xs text-slate-400">Үгүй</span>
        ),
    },
    {
      key: 'showOnPlan',
      header: 'Планд харуулах',
      render: (row) =>
        row.showOnPlan ? (
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">Тийм</span>
        ) : (
          <span className="text-xs text-slate-400">Үгүй</span>
        ),
    },
    {
      key: 'icon',
      header: 'Тэмдэглэгээ',
      render: (row) => <span className="text-slate-700">{OBJECT_ICON_LABELS[row.icon]}</span>,
    },
    {
      key: 'createdBy',
      header: 'Үүсгэсэн',
      render: (row) => <span className="text-slate-700">{row.createdByName ?? '-'}</span>,
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [];
        if (canManage) {
          items.push({ label: 'Засах', onSelect: () => setTarget(row) });
          // Deletion is offered for every type; only a type already carrying objects is held
          // back, because removing it would invalidate them. The item stays visible and
          // explains itself rather than disappearing without a reason.
          const inUse = row.objectCount > 0;
          items.push({
            label: 'Устгах',
            onSelect: () => setDeleteTarget(row),
            tone: 'danger',
            disabled: inUse,
            ...(inUse
              ? {
                  disabledReason: `Энэ төрлийг ${row.objectCount} тоноглол ашиглаж байгаа тул устгах боломжгүй.`,
                }
              : {}),
          });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const columnState = useTableColumns('object-types', columns);

  const hasFilters = ['search', 'category', 'isActive'].some((key) => searchParams.get(key));

  return (
    <>
      <PageHeader
        title="Тоноглолын төрөл"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Тоноглолын төрөл' }]}
        actions={canManage && <Button onClick={() => setTarget('new')}>Шинэ төрөл</Button>}
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="type-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="type-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэр эсвэл код"
          />
        </div>

        <div>
          <label htmlFor="type-category" className={FILTER_LABEL}>
            Ангилал
          </label>
          <select
            id="type-category"
            value={searchParams.get('category') ?? ''}
            onChange={(event) => updateParam('category', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх ангилал</option>
            {OBJECT_CATEGORIES.map((entry) => (
              <option key={entry} value={entry}>
                {OBJECT_CATEGORY_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="type-active" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="type-active"
            value={searchParams.get('isActive') ?? ''}
            onChange={(event) => updateParam('isActive', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            <option value="true">Идэвхтэй</option>
            <option value="false">Идэвхгүй</option>
          </select>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams(new URLSearchParams())}>
            Шүүлтүүр цэвэрлэх
          </Button>
        )}
      </div>

      <div className="mb-2 flex justify-end">
        <ColumnPicker controller={columnState} />
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columnState.visibleColumns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          // Numbered off the response rather than the query, so a request in flight can
          // never number the rows on screen against the page they did not come from.
          numbering={{ page: data?.page ?? 1, limit: data?.limit ?? 50 }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          emptyTitle="Тоноглолын төрөл олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох төрөл алга.'
              : 'Объект бүртгэхийн өмнө төрөл нэмнэ үү.'
          }
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={(page) => updateParam('page', String(page))}
          />
        )}
      </div>

      <TypeDrawer
        target={target}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          void load();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Тоноглолын төрөл устгах"
        message={`"${deleteTarget?.name ?? ''}" төрлийг устгах уу?`}
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete()}
      />
    </>
  );
}
