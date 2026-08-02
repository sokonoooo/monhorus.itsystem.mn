import {
  OBJECT_NODE_KIND_LABELS,
  SERVICE_REQUEST_TYPES,
  SERVICE_REQUEST_TYPE_LABELS,
  createServiceRequestSchema,
  type CreateServiceRequestInput,
  type ServiceRequestType,
} from '@monhorus/shared';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/ToastProvider';
import { FILTER_INPUT, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { serviceRequestService } from '../../services/service-request.service';
import { Field, Section, SelectInput, TextInput } from '../employees/FormControls';
import { LOCATION_LEVELS, useLocationChain } from './useLocationChain';

export function ServiceRequestCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { notify } = useToast();
  const chain = useLocationChain();

  const [requestType, setRequestType] = useState<ServiceRequestType | ''>('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [branch, setBranch] = useState('');
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const payload: CreateServiceRequestInput = {
      customerId: chain.customerId,
      branch: branch.trim() || null,
      projectId: chain.selection.PROJECT ?? null,
      buildingId: chain.selection.BUILDING ?? '',
      floorId: chain.selection.FLOOR ?? null,
      roomId: chain.selection.ROOM ?? null,
      panelId: chain.selection.PANEL ?? null,
      circuitId: chain.selection.CIRCUIT ?? null,
      deviceId: chain.selection.DEVICE ?? null,
      requestType: requestType as ServiceRequestType,
      isUrgent,
      description: description.trim(),
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      attachmentIds: [],
    };

    // Same schema the API uses, so the rules cannot drift between the two layers.
    const parsed = createServiceRequestSchema.safeParse(payload);
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
      const created = await serviceRequestService.create(parsed.data);
      notify(`${created.requestNumber} хүсэлт үүслээ.`, 'success');
      navigate(`/service-requests/${created.id}`, { replace: true });
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
    <>
      <PageHeader
        title="Шинэ үйлчилгээний хүсэлт"
        backTo={{ to: '/service-requests', label: 'Хүсэлтийн жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Үйлчилгээний хүсэлт', to: '/service-requests' },
          { label: 'Шинэ' },
        ]}
      />

      <form onSubmit={handleSubmit} noValidate>
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="space-y-6 p-5">
            {formError && <Alert variant="error">{formError}</Alert>}
            {chain.error && <Alert variant="warning">{chain.error}</Alert>}

            <Section title="Байршил">
              <Field label="Харилцагч байгууллага" required error={fieldErrors.customerId}>
                <SelectInput
                  value={chain.customerId}
                  onChange={chain.selectCustomer}
                  placeholder="Харилцагч сонгох"
                  options={chain.customers.map((customer) => ({
                    value: customer.id,
                    label: customer.name,
                  }))}
                  disabled={submitting}
                />
              </Field>

              <Field label="Салбар/байршил" error={fieldErrors.branch}>
                <TextInput value={branch} onChange={setBranch} disabled={submitting} />
              </Field>

              {LOCATION_LEVELS.map((kind, index) => {
                const parentKind = index === 0 ? null : LOCATION_LEVELS[index - 1];
                const parentSelected =
                  index === 0 ? Boolean(chain.customerId) : Boolean(parentKind && chain.selection[parentKind]);
                const available = chain.options[kind] ?? [];

                return (
                  <Field
                    key={kind}
                    label={OBJECT_NODE_KIND_LABELS[kind]}
                    required={kind === 'BUILDING'}
                    error={fieldErrors[`${kind.toLowerCase()}Id`]}
                    hint={
                      !parentSelected
                        ? 'Эхлээд дээд түвшнийг сонгоно уу'
                        : available.length === 0 && chain.loadingKind !== kind
                          ? 'Сонголт байхгүй'
                          : undefined
                    }
                  >
                    <SelectInput
                      value={chain.selection[kind] ?? ''}
                      onChange={(value) => chain.selectNode(kind, value)}
                      placeholder={chain.loadingKind === kind ? 'Ачааллаж байна...' : 'Сонгох'}
                      options={available.map((node) => ({ value: node.id, label: node.name }))}
                      disabled={submitting || !parentSelected || available.length === 0}
                    />
                  </Field>
                );
              })}
            </Section>

            <Section title="Хүсэлтийн мэдээлэл">
              <Field label="Хүсэлтийн төрөл" required error={fieldErrors.requestType}>
                <SelectInput
                  value={requestType}
                  onChange={(value) => setRequestType(value as ServiceRequestType)}
                  placeholder="Төрөл сонгох"
                  options={SERVICE_REQUEST_TYPES.map((type) => ({
                    value: type,
                    label: SERVICE_REQUEST_TYPE_LABELS[type],
                  }))}
                  disabled={submitting}
                />
              </Field>

              <Field
                label="Яаралтай эсэх"
                hint={isUrgent ? 'SLA 6 цаг' : 'SLA 24 цаг'}
              >
                <label className="flex items-center gap-2 py-1.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={isUrgent}
                    onChange={(event) => setIsUrgent(event.target.checked)}
                    disabled={submitting}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Яаралтай дуудлага
                </label>
              </Field>

              <Field label="Холбоо барих хүн" required error={fieldErrors.contactName}>
                <TextInput value={contactName} onChange={setContactName} disabled={submitting} />
              </Field>

              <Field label="Холбоо барих утас" required error={fieldErrors.contactPhone} hint="Жишээ: 9911-2233">
                <TextInput value={contactPhone} onChange={setContactPhone} disabled={submitting} />
              </Field>
            </Section>

            <div>
              <label htmlFor="request-description" className={FILTER_LABEL}>
                Тайлбар<span className="ml-0.5 text-red-600">*</span>
              </label>
              <textarea
                id="request-description"
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
                placeholder="Илэрсэн асуудал, хийх шаардлагатай ажлыг тодорхой бичнэ үү."
                className={FILTER_INPUT}
              />
              {fieldErrors.description && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
              )}
            </div>

            <Alert variant="info">
              Зураг, файл хавсаргах боломж дараагийн үе шатанд нэмэгдэнэ.
            </Alert>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/service-requests')}
              disabled={submitting}
            >
              Цуцлах
            </Button>
            <Button type="submit" loading={submitting}>
              Хүсэлт үүсгэх
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
