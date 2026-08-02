import {
  canManageRole,
  USER_ROLES,
  USER_ROLE_LABELS,
  type CreateUserResponse,
  type CustomerDto,
  type UserRole,
} from '@monhorus/shared';
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { generatePasscode } from '../../lib/passcode';
import { objectService } from '../../services/object.service';
import { userService } from '../../services/user.service';

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateUserModal({ open, onClose, onCreated }: CreateUserModalProps): ReactElement {
  const { user: actor } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [customerId, setCustomerId] = useState('');
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [password, setPassword] = useState(generatePasscode);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CreateUserResponse | null>(null);

  // A plain admin cannot mint another administrator. Uses the same shared predicate
  // as the backend guard, so the UI never offers an option that would return 403.
  const roleOptions = useMemo(
    () =>
      USER_ROLES.filter((candidate) => (actor ? canManageRole(actor.role, candidate) : false)).map(
        (value) => ({ value, label: USER_ROLE_LABELS[value] }),
      ),
    [actor],
  );

  // User management is role-gated on the server, so the same coarse predicate decides
  // whether the organisation control is usable here. Presentation only: the API rejects
  // the request regardless of what this renders.
  const canLinkCustomer = actor ? canManageRole(actor.role, 'customer') : false;

  // Only a customer account belongs to an organisation, so the selector exists exactly
  // when the chosen role is `customer` and disappears the moment it changes.
  const showCustomerSelect = role === 'customer';

  // Loaded through the customer list the customer module already exposes; there is no
  // user-specific endpoint for this.
  useEffect(() => {
    if (!open || !showCustomerSelect || !canLinkCustomer) return undefined;

    let cancelled = false;
    setCustomersError(null);

    void objectService
      .customers()
      .then((items) => {
        if (!cancelled) setCustomers(items);
      })
      .catch(() => {
        if (!cancelled) setCustomersError('Байгууллагын жагсаалт ачаалахад алдаа гарлаа.');
      });

    return () => {
      cancelled = true;
    };
  }, [open, showCustomerSelect, canLinkCustomer]);

  const customerOptions = useMemo(
    () => customers.map((customer) => ({ value: customer.id, label: customer.name })),
    [customers],
  );

  function reset(): void {
    setFullName('');
    setEmail('');
    setPhone('');
    setRole('');
    setCustomerId('');
    setPassword(generatePasscode());
    setFormError(null);
    setFieldErrors({});
    setResult(null);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!role) {
      setFieldErrors({ role: 'Эрх заавал сонгоно.' });
      return;
    }

    // Mirrors the server rule: a customer account without an organisation cannot be
    // scoped, so the request is not sent at all rather than being sent to fail.
    if (role === 'customer' && !customerId) {
      setFieldErrors({ customerId: 'Байгууллага заавал сонгоно.' });
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const created = await userService.create({
        fullName,
        email,
        password,
        phone: phone.trim() || null,
        role,
        // Sent only for a customer: the server refuses a link on a staff account.
        ...(role === 'customer' ? { customerId } : {}),
        requirePasswordChange: true,
      });
      setResult(created);
      onCreated();
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Success view: the passcode is shown exactly once and is never retrievable again.
  if (result) {
    return (
      <Modal
        open={open}
        title="Хэрэглэгч үүслээ"
        onClose={handleClose}
        footer={<Button onClick={handleClose}>Хаах</Button>}
      >
        <div className="space-y-4">
          <Alert variant="success" title="Амжилттай">
            <strong>{result.user.fullName}</strong> ({result.user.email}) бүртгэгдлээ.
          </Alert>

          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Түр нууц үг
            </p>
            <p className="mt-1 select-all break-all font-mono text-base font-semibold text-slate-900">
              {result.temporaryPassword}
            </p>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(result.temporaryPassword)}
              className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Хуулах
            </button>
          </div>

          <Alert variant="warning" title="Анхаар">
            Энэ нууц үг дахин харагдахгүй. Хэрэглэгчид аюулгүй сувгаар дамжуулна уу. Тэрээр анх
            нэвтрэхдээ заавал нууц үгээ солино.
          </Alert>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="Шинэ хэрэглэгч нэмэх"
      onClose={handleClose}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button type="submit" form="create-user-form" loading={submitting}>
            Үүсгэх
          </Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && <Alert variant="error">{formError}</Alert>}

        <Input
          label="Бүтэн нэр"
          required
          autoFocus
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          error={fieldErrors.fullName}
          disabled={submitting}
        />
        <Input
          label="Имэйл"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          placeholder="name@company.mn"
          disabled={submitting}
        />
        <Input
          label="Утас"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={fieldErrors.phone}
          hint="Сонголттой. Жишээ: 9911-2233"
          disabled={submitting}
        />
        <Select
          label="Эрх"
          required
          options={roleOptions}
          placeholder="Эрх сонгоно уу"
          value={role}
          onChange={(event) => {
            const next = event.target.value as UserRole | '';
            setRole(next);
            // A staff account must not carry an organisation, so a leftover choice is
            // dropped the moment the role stops being customer.
            if (next !== 'customer') setCustomerId('');
          }}
          error={fieldErrors.role}
          disabled={submitting}
        />

        {showCustomerSelect && (
          <>
            <Select
              label="Харилцагч байгууллага"
              required
              options={customerOptions}
              placeholder="Байгууллага сонгоно уу"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              error={fieldErrors.customerId}
              disabled={submitting || !canLinkCustomer}
            />
            <p className="-mt-2 text-xs text-slate-500">
              Харилцагч зөвхөн энэ байгууллагын мэдээллийг харна.
            </p>
            {customersError && <Alert variant="error">{customersError}</Alert>}
          </>
        )}

        <div className="space-y-1.5">
          <Input
            label="Түр нууц үг"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            className="font-mono"
            disabled={submitting}
          />
          <button
            type="button"
            onClick={() => setPassword(generatePasscode())}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
            disabled={submitting}
          >
            Шинээр үүсгэх
          </button>
        </div>

        {actor?.role === 'admin' && (
          <Alert variant="info">
            Админ болон ерөнхий админ эрхтэй хэрэглэгчийг зөвхөн ерөнхий админ үүсгэнэ.
          </Alert>
        )}
      </form>
    </Modal>
  );
}
