import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_LABELS,
  type ObjectCategory,
  type ObjectListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { SearchField } from '../../components/ui/SearchField';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { objectMasterService } from '../../services/object-master.service';
import { projectService } from '../../services/project.service';
import { ObjectCategoryBadge } from './objects/ObjectBadges';

interface FloorObjectPickerProps {
  floorId: string;
  customerId: string;
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
}

/**
 * Links existing objects to a floor.
 *
 * Only objects belonging to the same customer that are not yet on any floor are offered,
 * matching the backend rule. Nothing here creates an object: an object that does not exist
 * yet must be registered in the object master module first, which is what the empty state
 * points at.
 */
export function FloorObjectPicker({
  floorId,
  customerId,
  open,
  onClose,
  onLinked,
}: FloorObjectPickerProps): ReactElement {
  const { notify } = useToast();

  const [candidates, setCandidates] = useState<ObjectListItemDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState<ObjectCategory | ''>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!open || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      const page = await objectMasterService.list({
        customerId,
        unlinkedOnly: true,
        limit: 100,
        ...(category ? { category } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      setCandidates(page.items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Объект ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [open, customerId, category, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  async function handleLink(): Promise<void> {
    if (selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await projectService.linkObjects(floorId, { objectIds: selected });
      notify(`${result.linked} объект холбогдлоо.`, 'success');
      onLinked();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Холбож чадсангүй.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Объект холбох"
      onClose={onClose}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button
            onClick={() => void handleLink()}
            loading={submitting}
            disabled={selected.length === 0}
          >
            Холбох{selected.length > 0 ? ` (${selected.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}

        <Alert variant="info">
          Объектын мастер бүртгэлээс сонгоно. Сонгосон объект хуулагдахгүй, зөвхөн энэ
          давхартай холбогдоно.
        </Alert>

        <div className="flex flex-wrap gap-2">
          <div className="min-w-[160px] flex-1">
            <label htmlFor="pick-search" className={FILTER_LABEL}>
              Хайлт
            </label>
            <SearchField
              id="pick-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Нэр эсвэл код"
            />
          </div>
          <div>
            <label htmlFor="pick-category" className={FILTER_LABEL}>
              Ангилал
            </label>
            <select
              id="pick-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as ObjectCategory | '')}
              className={FILTER_SELECT}
            >
              <option value="">Бүгд</option>
              {OBJECT_CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {OBJECT_CATEGORY_LABELS[entry]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <EmptyState
            title="Холбох боломжтой объект алга"
            description="Холбох боломжтой объект байхгүй байна. Тоноглол нэмэх товчоор энэ давхарт шинээр үүсгэнэ үү."
          />
        ) : (
          <ul className="space-y-1">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg p-2 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selected.includes(candidate.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, candidate.id]
                          : current.filter((id) => id !== candidate.id),
                      )
                    }
                    disabled={submitting}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-900">{candidate.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {candidate.code}
                      {candidate.objectType ? ` · ${candidate.objectType.name}` : ''}
                    </span>
                  </span>
                  <ObjectCategoryBadge category={candidate.category} />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
