import {
  OBJECT_NODE_KIND_LABELS,
  SERVICE_REQUEST_TYPES,
  SERVICE_REQUEST_TYPE_LABELS,
  createServiceRequestSchema,
  type CreateServiceRequestInput,
  type PlanPositionDto,
  type ServiceRequestAttachmentDto,
  type ServiceRequestType,
} from '@monhorus/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/ToastProvider';
import { FILTER_INPUT, FILTER_LABEL } from '../../components/ui/control-styles';
import { useSlaHours } from '../../hooks/use-sla-hours';
import { ApiError } from '../../lib/api-client';
import { serviceRequestService } from '../../services/service-request.service';
import { Field, Section, SelectInput, TextInput } from '../employees/FormControls';
import { FloorPlanPin } from '../projects/FloorPlanPin';
import { RequestAttachments } from './RequestAttachments';
import { LOCATION_LEVELS, useLocationChain } from './useLocationChain';

/** Mirrors ALLOWED_MIME_TYPES and MAX_FILE_BYTES in the storage service. */
const ACCEPTED_TYPES =
  'image/jpeg,image/png,image/webp,application/pdf,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACCEPTED_HINT = 'Зураг, PDF, Word, Excel - хамгийн ихдээ 10MB, 20 хүртэл файл.';

export function ServiceRequestCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { notify } = useToast();
  const chain = useLocationChain();
  const slaHours = useSlaHours();

  const [requestType, setRequestType] = useState<ServiceRequestType | ''>('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [branch, setBranch] = useState('');
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<readonly ServiceRequestAttachmentDto[]>([]);
  const [uploading, setUploading] = useState(false);

  /**
   * Optional pin on the chosen floor's plan.
   *
   * Tied to the floor rather than to the zone: the API rejects a position without a floor
   * and takes one without a zone, which matches how the plan is read — somebody points at
   * the spot whether or not the zone it falls in has been drawn up yet.
   */
  const floorId = chain.selection.FLOOR ?? '';
  const [planPosition, setPlanPosition] = useState<PlanPositionDto | null>(null);

  // A coordinate is meaningless against a different drawing, so changing the floor drops it.
  useEffect(() => {
    setPlanPosition(null);
  }, [floorId]);

  /**
   * Uploads immediately and holds the stored file until the form is submitted.
   *
   * `POST /files/service-request-attachments` parks the file on the uploader; the request
   * claims it by id. Removing one here therefore only drops it from the draft — the same
   * behaviour the work-report drawer has, and the reason an abandoned form attaches
   * nothing.
   */
  async function handleUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    setFormError(null);

    try {
      const uploaded = await serviceRequestService.uploadAttachment(file);
      setAttachments((current) => [...current, uploaded]);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Файл хуулж чадсангүй.');
    } finally {
      setUploading(false);
    }
  }

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
      // Omitted rather than sent as null when nothing was pinned, so an untouched form
      // submits exactly the payload it always did.
      ...(planPosition ? { planPosition } : {}),
      requestType: requestType as ServiceRequestType,
      isUrgent,
      description: description.trim(),
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      attachmentIds: attachments.map((attachment) => attachment.id),
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

            {/*
              The pin sits outside the location grid on purpose: it is a picture, and the
              three-column field grid would squeeze it. Optional throughout — a request with
              no floor, or a floor with no drawing, says so in a line instead of leaving a
              dead area where a control would be.
            */}
            <div>
              <span className={FILTER_LABEL}>План дээрх байрлал</span>
              {floorId ? (
                <FloorPlanPin
                  floorId={floorId}
                  value={planPosition}
                  onChange={setPlanPosition}
                  disabled={submitting}
                />
              ) : (
                <p className="text-xs text-slate-500">
                  Давхар сонгосны дараа план зураг дээр байрлал тэмдэглэх боломжтой.
                </p>
              )}
              {fieldErrors.planPosition && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.planPosition}</p>
              )}
            </div>

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
                // Silence rather than a guess: the deadline is computed server-side from
                // the Тохиргоо values, and a caller who cannot read them (DISPATCH and
                // SALES hold no `settings.view`) must not state a number for them.
                hint={
                  slaHours
                    ? `SLA ${isUrgent ? slaHours.urgent : slaHours.standard} цаг`
                    : undefined
                }
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

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className={FILTER_LABEL}>Хавсралт</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  loading={uploading}
                  disabled={submitting || attachments.length >= 20}
                >
                  Файл хавсаргах
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                aria-label="Хавсралт сонгох"
                onChange={(event) => {
                  void handleUpload(event.target.files?.[0]);
                  // Cleared so re-choosing the same file fires a change event again.
                  event.target.value = '';
                }}
              />
              <RequestAttachments
                attachments={attachments}
                disabled={submitting}
                onRemove={(attachmentId) =>
                  setAttachments((current) =>
                    current.filter((attachment) => attachment.id !== attachmentId),
                  )
                }
              />
              <p className="mt-1 text-xs text-slate-400">{ACCEPTED_HINT}</p>
              {fieldErrors.attachmentIds && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.attachmentIds}</p>
              )}
            </div>
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
