import {
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABELS,
  MATERIAL_UNITS,
  MATERIAL_UNIT_LABELS,
  PERMISSIONS,
  createMaterialItemSchema,
  updateMaterialItemSchema,
  type MaterialCategory,
  type MaterialItemDto,
  type MaterialItemListQueryInput,
  type MaterialUnit,
  type PaginatedData,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { SearchField } from '../../components/ui/SearchField';
import { useToast } from '../../components/ui/ToastProvider';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { materialService } from '../../services/material.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

const PAGE_SIZE = 20;

/**
 * Create and edit a catalogue item.
 *
 * WHAT EDITING DOES NOT REACH. A planned work freezes an item's name and unit onto its own
 * row when the material is registered, so renaming here or changing the unit leaves every
 * existing registration exactly as it was. That is deliberate — a work's record should not
 * change because somebody tidied the catalogue months later — but it is also surprising
 * enough to say on the form rather than leave to be discovered.
 */
function MaterialDrawer({
  target,
  onClose,
  onSaved,
}: {
  target: MaterialItemDto | null | 'new';
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const isNew = target === 'new';
  const existing = target !== null && target !== 'new' ? target : null;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<MaterialCategory>('OTHER');
  const [defaultUnit, setDefaultUnit] = useState<MaterialUnit>('PIECE');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return;
    setFormError(null);
    setFieldErrors({});
    setCode(existing?.code ?? '');
    setName(existing?.name ?? '');
    setCategory(existing?.category ?? 'OTHER');
    setDefaultUnit(existing?.defaultUnit ?? 'PIECE');
    setDescription(existing?.description ?? '');
  }, [target, existing]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const payload = {
      code: code.trim(),
      name: name.trim(),
      category,
      defaultUnit,
      // Empty is a real answer — no description — rather than a field left unsent.
      description: description.trim() || null,
    };

    // The same schema the API validates with, so a rejection here and a rejection there
    // say the same thing about the same field.
    const parsed = isNew
      ? createMaterialItemSchema.safeParse(payload)
      : updateMaterialItemSchema.safeParse(payload);

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
        await materialService.create(parsed.data as Parameters<typeof materialService.create>[0]);
      } else if (existing) {
        await materialService.update(
          existing.id,
          parsed.data as Parameters<typeof materialService.update>[1],
        );
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
      title={isNew ? 'Шинэ материал' : (existing?.name ?? '')}
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

        <Field
          label="Код"
          required
          error={fieldErrors.code}
          hint="Жишээ: CBL-3X2.5. Том үсэг, тоо, зураас, цэг."
        >
          <TextInput value={code} onChange={setCode} disabled={submitting} />
        </Field>

        <Field label="Нэр" required error={fieldErrors.name}>
          <TextInput value={name} onChange={setName} disabled={submitting} />
        </Field>

        <Field label="Ангилал" required error={fieldErrors.category}>
          <SelectInput
            value={category}
            onChange={(value) => setCategory(value as MaterialCategory)}
            options={MATERIAL_CATEGORIES.map((value) => ({
              value,
              label: MATERIAL_CATEGORY_LABELS[value],
            }))}
            disabled={submitting}
          />
        </Field>

        <Field
          label="Хэмжих нэгж"
          required
          error={fieldErrors.defaultUnit}
          hint="Ажилд бүртгэхэд энэ нэгжээр тоологдоно."
        >
          <SelectInput
            value={defaultUnit}
            onChange={(value) => setDefaultUnit(value as MaterialUnit)}
            options={MATERIAL_UNITS.map((value) => ({
              value,
              label: MATERIAL_UNIT_LABELS[value],
            }))}
            disabled={submitting}
          />
        </Field>

        <Field label="Тайлбар" error={fieldErrors.description}>
          <TextInput value={description} onChange={setDescription} disabled={submitting} />
        </Field>
      </div>
    </Drawer>
  );
}

/**
 * The material catalogue.
 *
 * The list every planned work picks its materials from. It is master data, not tenant
 * data: one company stocks one list of cable and breakers and issues it to whichever
 * customer's site the work is on.
 *
 * THERE IS NO DELETE, and that is the catalogue's whole shape. A planned work's material
 * row points at an item here, so removing one would orphan every registration that names
 * it. Retiring an item instead keeps those references resolvable while stopping it being
 * offered on new work.
 *
 * There are also no stock balances, deliberately — see the note in the shared constants.
 * Nothing on this page claims to know how much of anything is on hand.
 */
export function MaterialsPage(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.MATERIAL_MANAGE);

  const query = useMemo<Partial<MaterialItemListQueryInput>>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const search = searchParams.get('search');
    const category = searchParams.get('category');

    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(category ? { category: category as MaterialCategory } : {}),
      // Omitting `isActive` returns both, which is what the "Бүгд" option means. The
      // default is the active list, because a picker only ever offers those.
      ...(searchParams.get('status') === 'all' ? {} : { isActive: true }),
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<MaterialItemDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [target, setTarget] = useState<MaterialItemDto | null | 'new'>(null);
  const [statusTarget, setStatusTarget] = useState<MaterialItemDto | null>(null);

  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await materialService.list(JSON.parse(queryKey) as Partial<MaterialItemListQueryInput>),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Материал ачаалж чадсангүй.');
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

  async function handleStatusChange(): Promise<void> {
    if (!statusTarget) return;
    const activating = !statusTarget.isActive;
    try {
      await materialService.update(statusTarget.id, { isActive: activating });
      notify(activating ? 'Материал идэвхжлээ.' : 'Материал идэвхгүй боллоо.', 'success');
      setStatusTarget(null);
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Төлөв өөрчилж чадсангүй.', 'error');
      setStatusTarget(null);
    }
  }

  const columns: ReadonlyArray<Column<MaterialItemDto>> = [
    {
      key: 'code',
      header: 'Код',
      render: (row) => (
        <span className="whitespace-nowrap font-medium text-slate-900">{row.code}</span>
      ),
    },
    {
      key: 'name',
      header: 'Нэр',
      render: (row) => <span className="truncate text-slate-800">{row.name}</span>,
    },
    {
      key: 'category',
      header: 'Ангилал',
      render: (row) => (
        <span className="text-slate-700">{MATERIAL_CATEGORY_LABELS[row.category]}</span>
      ),
    },
    {
      key: 'unit',
      header: 'Нэгж',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {MATERIAL_UNIT_LABELS[row.defaultUnit]}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Тайлбар',
      render: (row) => <span className="text-slate-600">{row.description ?? '-'}</span>,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) =>
        row.isActive ? (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
            Идэвхтэй
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            Идэвхгүй
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [];
        if (canManage) {
          items.push({ label: 'Засах', onSelect: () => setTarget(row) });
          items.push({
            label: row.isActive ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх',
            onSelect: () => setStatusTarget(row),
            ...(row.isActive ? { tone: 'danger' as const } : {}),
          });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const hasFilters = ['search', 'category', 'status'].some((key) => searchParams.get(key));

  return (
    <>
      <PageHeader
        title="Материалын жагсаалт"
        description="Төлөвлөгөөт ажилд бүртгэх материалын нэгдсэн жагсаалт."
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Материалын жагсаалт' }]}
        actions={canManage && <Button onClick={() => setTarget('new')}>Шинэ материал</Button>}
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="material-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="material-search"
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
          <label htmlFor="material-category" className={FILTER_LABEL}>
            Ангилал
          </label>
          <select
            id="material-category"
            value={searchParams.get('category') ?? ''}
            onChange={(event) => updateParam('category', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх ангилал</option>
            {MATERIAL_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {MATERIAL_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="material-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="material-status"
            value={searchParams.get('status') ?? ''}
            onChange={(event) => updateParam('status', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Идэвхтэй</option>
            <option value="all">Бүгд</option>
          </select>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams(new URLSearchParams())}>
            Шүүлтүүр цэвэрлэх
          </Button>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          ariaLabel="Материалын жагсаалт"
          numbering={{ page: query.page ?? 1, limit: PAGE_SIZE }}
          emptyTitle="Материал алга"
          emptyDescription={
            canManage
              ? 'Шинэ материал товчоор жагсаалтад нэмнэ. Төлөвлөгөөт ажилд бүртгэх материал эндээс сонгогдоно.'
              : 'Одоогоор бүртгэгдсэн материал алга байна.'
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

      <MaterialDrawer
        target={target}
        onClose={() => setTarget(null)}
        onSaved={() => {
          notify(target === 'new' ? 'Материал үүслээ.' : 'Материал шинэчлэгдлээ.', 'success');
          setTarget(null);
          void load();
        }}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget?.isActive ? 'Материалыг идэвхгүй болгох' : 'Материалыг идэвхжүүлэх'}
        message={
          statusTarget?.isActive
            ? 'Идэвхгүй материал шинэ ажилд сонгогдохоо болино. Өмнө нь бүртгэсэн ажлууд хэвээр үлдэнэ.'
            : 'Материал дахин сонгогдох боломжтой болно.'
        }
        confirmLabel={statusTarget?.isActive ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
        danger={statusTarget?.isActive === true}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => void handleStatusChange()}
      />
    </>
  );
}
