import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Customer, Paged } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable, Pagination, type Column } from '../../components/DataTable';
import { BranchSelect } from '../../components/pickers';
import { SearchInput } from '../../components/SearchInput';
import { Button, Card, Field, PageHeader, StatusBadge } from '../../components/ui';
import { formatDate } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';
import { CustomerForm } from './CustomerForm';

const COLUMNS: Column<Customer>[] = [
  { key: 'code', header: 'Code', sortKey: 'code', render: (c) => <span className="mono">{c.customerCode}</span> },
  { key: 'name', header: 'Name', sortKey: 'name', render: (c) => <strong>{c.fullName}</strong> },
  { key: 'phone', header: 'Phone', render: (c) => c.phone },
  { key: 'branch', header: 'Branch', sortKey: 'branch', render: (c) => c.branchName },
  { key: 'loans', header: 'Open loans', align: 'right', render: (c) => c.openLoans ?? 0 },
  { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
  { key: 'created', header: 'Since', sortKey: 'createdAt', render: (c) => formatDate(c.createdAt.slice(0, 10)) },
];

export function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [f, setF] = useFilters({ search: '', branchId: '', isActive: 'true', sort: '', page: '1' });

  const { data, error, loading, reload } = useApi<Paged<Customer>>('/customers', {
    search: f.search, branchId: f.branchId, isActive: f.isActive || undefined, sort: f.sort, page: f.page, pageSize: 20,
  });

  return (
    <div className="stack">
      <PageHeader title="Customers" subtitle="Everyone who has borrowed or applied for a loan."
        actions={can('customers.manage') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New customer</Button>} />
      <Card flush>
        <div className="filters">
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="Name, code, phone or email" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
          {can('scope.all_branches') && (
            <Field label="Branch">
              {(id) => <BranchSelect id={id} value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v) })} />}
            </Field>
          )}
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
        <DataTable columns={COLUMNS} rows={data?.data} rowKey={(c) => c.id} loading={loading} error={error} onRetry={reload}
          sort={f.sort} onSortChange={(sort) => setF({ sort })} onRowClick={(c) => navigate(`/customers/${c.id}`)}
          emptyTitle="No customers found" emptyMessage="Try a different search or filter." />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
      {creating && (
        <CustomerForm onClose={() => setCreating(false)} onSaved={(id) => navigate(`/customers/${id}`)} />
      )}
    </div>
  );
}
