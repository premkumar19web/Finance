import { useState, type FormEvent } from 'react';
import { http } from '../../api/client';
import type { Customer } from '../../api/types';
import { useAuth } from '../../auth/context';
import { BranchSelect } from '../../components/pickers';
import { Alert, Button, Field, Modal } from '../../components/ui';
import { errorMessage, fieldErrors } from '../../lib/errors';

const DOC_TYPES = ['AADHAAR', 'PAN', 'VOTER_ID', 'PASSPORT', 'DRIVING_LICENSE'];

/** Create (no `customer`) or edit a customer. Calls onSaved with the customer id. */
export function CustomerForm({ customer, onClose, onSaved }: {
  customer?: Customer; onClose: () => void; onSaved: (id: number) => void;
}) {
  const { can } = useAuth();
  const [form, setForm] = useState({
    branchId: (customer?.branchId ?? '') as number | '',
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    address: customer?.address ?? '',
    occupation: customer?.occupation ?? '',
    idDocumentType: customer?.idDocumentType ?? '',
    idDocumentLast4: customer?.idDocumentLast4 ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (value: string | number) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setErrors({});
    const body = {
      ...form,
      branchId: form.branchId === '' ? undefined : form.branchId,
      idDocumentType: form.idDocumentType || null,
      idDocumentLast4: form.idDocumentLast4 || null,
    };
    try {
      if (customer) {
        await http.patch(`/customers/${customer.id}`, body);
        onSaved(customer.id);
      } else {
        const res = await http.post<{ data: { id: number } }>('/customers', body);
        onSaved(res.data.id);
      }
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={customer ? `Edit ${customer.fullName}` : 'New customer'} onClose={onClose} wide>
      <form onSubmit={onSubmit} noValidate>
        {error && <div style={{ marginBottom: 14 }}><Alert tone="error">{error}</Alert></div>}
        <div className="form-grid">
          <Field label="Full name" error={errors.fullName}>
            {(id) => <input id={id} className="input" value={form.fullName} onChange={(e) => set('fullName')(e.target.value)} required maxLength={150} />}
          </Field>
          <Field label="Branch" error={errors.branchId}>
            {(id) => can('scope.all_branches')
              ? <BranchSelect id={id} value={form.branchId} onChange={set('branchId')} includeAll={false} required />
              : <BranchSelect id={id} value="" onChange={() => {}} />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(id) => <input id={id} className="input" type="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} placeholder="+91 98765 43210" required />}
          </Field>
          <Field label="Email (optional)" error={errors.email}>
            {(id) => <input id={id} className="input" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />}
          </Field>
          <Field label="Occupation" error={errors.occupation}>
            {(id) => <input id={id} className="input" value={form.occupation} onChange={(e) => set('occupation')(e.target.value)} maxLength={100} />}
          </Field>
          <div className="form-grid" style={{ gap: 10 }}>
            <Field label="ID document" error={errors.idDocumentType}>
              {(id) => (
                <select id={id} className="select" value={form.idDocumentType} onChange={(e) => set('idDocumentType')(e.target.value)}>
                  <option value="">None</option>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
              )}
            </Field>
            <Field label="Last 4 characters" error={errors.idDocumentLast4} hint="Never enter the full number">
              {(id) => (
                <input id={id} className="input" value={form.idDocumentLast4} maxLength={4}
                  onChange={(e) => set('idDocumentLast4')(e.target.value.toUpperCase())} disabled={!form.idDocumentType} />
              )}
            </Field>
          </div>
          <Field label="Address" error={errors.address} className="span-2">
            {(id) => <textarea id={id} className="textarea" value={form.address} onChange={(e) => set('address')(e.target.value)} maxLength={500} />}
          </Field>
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{customer ? 'Save changes' : 'Create customer'}</Button>
        </div>
      </form>
    </Modal>
  );
}
