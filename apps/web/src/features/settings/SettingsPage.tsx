import type { SettingEntryDto, SettingKey, SettingValue, SettingsDto } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { settingsService } from '../../services/settings.service';

import {
  FIELD_INPUT,
  FIELD_INPUT_DIRTY,
  FIELD_INPUT_ERROR,
} from '../../components/ui/control-styles';

/**
 * System settings (requirements 16.1).
 *
 * Every control is driven by the catalogue the backend publishes: label, hint, type,
 * bounds and unit all arrive with the value, so adding a setting needs no change here.
 * The form is dirty-tracked and submits only the keys that actually changed, which is
 * what keeps the audit trail free of no-op rows.
 */
function isChanged(entry: SettingEntryDto, draft: string): boolean {
  if (entry.type === 'string') return draft !== String(entry.value);
  return draft !== '' && Number(draft) !== Number(entry.value);
}

export function SettingsPage(): ReactElement {
  const { notify } = useToast();

  const [data, setData] = useState<SettingsDto | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function seedDrafts(next: SettingsDto): void {
    const seeded: Record<string, string> = {};
    for (const group of next.groups) {
      for (const entry of group.entries) {
        seeded[entry.key] = String(entry.value);
      }
    }
    setDrafts(seeded);
  }

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await settingsService.get();
      setData(next);
      seedDrafts(next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Тохиргоо ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = data?.groups.flatMap((group) => group.entries) ?? [];
  const changedKeys = entries
    .filter((entry) => isChanged(entry, drafts[entry.key] ?? ''))
    .map((entry) => entry.key);

  function describe(caught: unknown): string {
    if (caught instanceof ApiError) {
      setFieldErrors(caught.fieldErrors);
      return caught.message;
    }
    return 'Гэнэтийн алдаа гарлаа.';
  }

  async function handleSave(): Promise<void> {
    if (!data || changedKeys.length === 0) return;

    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const payload: Partial<Record<SettingKey, SettingValue>> = {};
    for (const entry of entries) {
      if (!changedKeys.includes(entry.key)) continue;
      payload[entry.key] =
        entry.type === 'string' ? (drafts[entry.key] ?? '') : Number(drafts[entry.key]);
    }

    try {
      const next = await settingsService.update(payload);
      setData(next);
      seedDrafts(next);
      notify(`${changedKeys.length} тохиргоо хадгалагдлаа.`, 'success');
    } catch (caught) {
      setFormError(describe(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(key: SettingKey): Promise<void> {
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const next = await settingsService.reset(key);
      setData(next);
      seedDrafts(next);
      notify('Анхны утгад буцаалаа.', 'success');
    } catch (caught) {
      setFormError(describe(caught));
    } finally {
      setSaving(false);
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

  if (error || !data) return <ErrorState description={error ?? 'Тохиргоо олдсонгүй.'} />;

  const readOnly = !data.canManage;

  return (
    <>
      <PageHeader
        title="Тохиргоо"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Тохиргоо' }]}
        actions={
          !readOnly && (
            <>
              <Button
                variant="secondary"
                onClick={() => data && seedDrafts(data)}
                disabled={saving || changedKeys.length === 0}
              >
                Буцаах
              </Button>
              <Button
                onClick={() => void handleSave()}
                loading={saving}
                disabled={changedKeys.length === 0}
              >
                Хадгалах
                {changedKeys.length > 0 ? ` (${changedKeys.length})` : ''}
              </Button>
            </>
          )
        }
      />

      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        {readOnly && (
          <Alert variant="info">
            Танд тохиргоо өөрчлөх эрх байхгүй тул зөвхөн харах горимд байна.
          </Alert>
        )}

        {data.groups.map((group) => (
          <section
            key={group.group}
            className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
          >
            <h2 className="text-sm font-semibold text-slate-900">{group.label}</h2>
            <p className="mb-4 text-xs text-slate-500">{group.description}</p>

            <div className="space-y-4">
              {group.entries.map((entry) => {
                const draft = drafts[entry.key] ?? '';
                const dirty = isChanged(entry, draft);
                const fieldError = fieldErrors[entry.key];

                return (
                  <div
                    key={entry.key}
                    className="grid grid-cols-1 gap-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_260px]"
                  >
                    <div className="min-w-0">
                      <label
                        htmlFor={`setting-${entry.key}`}
                        className="block break-words text-sm font-medium text-slate-800"
                      >
                        {entry.label}
                      </label>
                      <p className="mt-0.5 break-words text-xs text-slate-500">{entry.hint}</p>
                      {entry.isOverridden && (
                        <p className="mt-1 text-xs text-amber-700">
                          Анхны утга {String(entry.defaultValue)}
                          {entry.unit ? ` ${entry.unit}` : ''}. Өөрчилсөн:{' '}
                          {entry.updatedByName ?? '-'}
                        </p>
                      )}
                      {fieldError && <p className="mt-1 text-xs text-red-600">{fieldError}</p>}
                    </div>

                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <input
                            id={`setting-${entry.key}`}
                            type={entry.type === 'string' ? 'text' : 'number'}
                            step={entry.type === 'ratio' ? '0.01' : '1'}
                            {...(entry.min === undefined ? {} : { min: entry.min })}
                            {...(entry.max === undefined ? {} : { max: entry.max })}
                            value={draft}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [entry.key]: event.target.value,
                              }))
                            }
                            disabled={readOnly || saving}
                            aria-invalid={fieldError ? true : undefined}
                            className={
                              fieldError
                                ? FIELD_INPUT_ERROR
                                : dirty
                                  ? FIELD_INPUT_DIRTY
                                  : FIELD_INPUT
                            }
                          />
                          {entry.unit && (
                            <span className="whitespace-nowrap text-xs text-slate-500">
                              {entry.unit}
                            </span>
                          )}
                        </div>
                      </div>

                      {!readOnly && entry.isOverridden && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleReset(entry.key)}
                          disabled={saving}
                        >
                          Анхны утга
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
