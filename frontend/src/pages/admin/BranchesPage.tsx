import { useState, type FormEvent } from 'react';
import { http } from '../../api/client';
import type { Branch, Paged } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable, Pagination, type Column } from '../../components/DataTable';
import { SearchInput } from '../../components/SearchInput';
import { Alert, Button, Card, Field, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { errorMessage, fieldErrors } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';

export function BranchesPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<Branch | 'new' | null>(null);
  const [f, setF] = useFilters({ search: '', isActive: '', sort: '', page: '1' });
  const { data, error, loading, reload } = useApi<Paged<Branch>>('/branches', { ...f, pageSize: 25 });

  const columns: Column<Branch>[] = [
    { key: 'code', header: 'Code', sortKey: 'code', render: (b) => <span className="mono">{b.branchCode}</span> },
    { key: 'name', header: 'Branch', sortKey: 'name', render: (b) => <><strong>{b.branchName}</strong><div className="muted small">{b.address}</div></> },
    { key: 'city', header: 'City', sortKey: 'city', render: (b) => b.city ?? '—' },
    { key: 'contact', header: 'Contact', render: (b) => <>{b.phone ?? '—'}<div className="muted small">{b.email}</div></> },
    { key: 'customers', header: 'Customers', align: 'right', render: (b) => formatNumber(b.customerCount) },
    { key: 'loans', header: 'Open loans', align: 'right', render: (b) => formatNumber(b.openLoans) },
    { key: 'staff', header: 'Staff', align: 'right', render: (b) => formatNumber(b.staffCount) },
    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    ...(can('branches.manage') ? [{ key: 'edit', header: '', render: (b: Branch) => <Button size="sm" onClick={() => setEditing(b)}>Edit</Button> }] : []),
  ];

  return (
    <div className="stack">
      <PageHeader title="Branches" subtitle="Offices that customers, staff and loans belong to."
        actions={can('branches.manage') && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New branch</Button>} />
      <Card flush>
        <div className="filters">
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="Name, code or city" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
          <Field label="Status">
            {(id) => (
              <select id={id} className="select" value={f.isActive} onChange={(e) => setF({ isActive: e.target.value })}>
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            )}
          </Field>
        </div>
        <DataTable columns={columns} rows={data?.data} rowKey={(b) => b.id} loading={loading} error={error} onRetry={reload}
          sort={f.sort} onSortChange={(sort) => setF({ sort })} emptyTitle="No branches found" />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
      {editing && (
        <BranchForm branch={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}
    </div>
  );
}

function BranchForm({ branch, onClose, onSaved }: { branch?: Branch; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    branchCode: branch?.branchCode ?? '', branchName: branch?.branchName ?? '', city: branch?.city ?? '',
    address: branch?.address ?? '', phone: branch?.phone ?? '', email: branch?.email ?? '', isActive: branch?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const { branchCode, branchName, city, address, phone, email } = form;
      if (branch) await http.patch(`/branches/${branch.id}`, form);
      else await http.post('/branches', { branchCode, branchName, city, address, phone, email });
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={branch ? `Edit ${branch.branchName}` : 'New branch'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="stack">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="form-grid">
          <Field label="Branch code" error={errors.branchCode} hint="Capital letters, digits and dashes">
            {(id) => <input id={id} className="input" value={form.branchCode} onChange={(e) => set('branchCode')(e.target.value.toUpperCase())} required />}
          </Field>
          <Field label="Branch name" error={errors.branchName}>
            {(id) => <input id={id} className="input" value={form.branchName} onChange={(e) => set('branchName')(e.target.value)} required />}
          </Field>
          <Field label="City" error={errors.city}>
            {(id) => <input id={id} className="input" value={form.city} onChange={(e) => set('city')(e.target.value)} />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(id) => <input id={id} className="input" type="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />}
          </Field>
          <Field label="Email" error={errors.email} className="span-2">
            {(id) => <input id={id} className="input" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} />}
          </Field>
          <Field label="Address" error={errors.address} className="span-2">
            {(id) => <textarea id={id} className="textarea" value={form.address} onChange={(e) => set('address')(e.target.value)} />}
          </Field>
          {branch && (
            <label className="checkbox span-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive')(e.target.checked)} />
              Branch is active (inactive branches cannot take new customers)
            </label>
          )}
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{branch ? 'Save changes' : 'Create branch'}</Button>
        </div>
      </form>
    </Modal>
  );
}
