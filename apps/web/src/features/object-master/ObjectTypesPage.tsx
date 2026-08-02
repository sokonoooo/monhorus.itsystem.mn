import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_LABELS,
  OBJECT_ICONS,
  OBJECT_ICON_LABELS,
  PERMISSIONS,
  createObjectTypeSchema,
  updateObjectTypeSchema,
  type ObjectCategory,
  type ObjectIcon,
  type ObjectTypeDto,
  type ObjectTypeListQuery,
  type PaginatedData,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
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
import { objectTypeService } from '../../services/object-master.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';
import { ObjectCategoryBadge } from '../projects/objects/ObjectBadges';

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
  const [icon, setIcon] = useState<ObjectIcon>('OTHER');
  const [isActive, setIsActive] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return;
    setFormError(null);
    setFieldErrors({});

    if (existing) {
      setCode(existing.code);
      setName(existing.name);
      setDescription(existing.description ?? '');
      setCategory(existing.category);
      setShowOnPlan(existing.showOnPlan);
      setInsidePanel(existing.insidePanel);
      setGeneratesConclusion(existing.generatesConclusion);
      setIcon(existing.icon);
      setIsActive(existing.isActive);
    } else {
      setCode('');
      setName('');
      setDescription('');
      setCategory('EQUIPMENT');
      setShowOnPlan(false);
      setInsidePanel(false);
      setGeneratesConclusion(true);
      setIcon('OTHER');
      setIsActive(true);
    }
  }, [target, existing]);

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
          icon,
        })
      : updateObjectTypeSchema.safeParse({
          name: name.trim(),
          description: description.trim() || null,
          showOnPlan,
          insidePanel,
          generatesConclusion,
          icon,
          isActive,
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
