import { Link, useNavigate } from 'react-router';
import type { Loan, Paged } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable, Pagination, type Column } from '../../components/DataTable';
import { AgentSelect, BranchSelect } from '../../components/pickers';
import { SearchInput } from '../../components/SearchInput';
import { Card, Field, Money, PageHeader, StatusBadge } from '../../components/ui';
import { formatDate, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';

const STATUSES = ['PENDING', 'APPROVED', 'ACTIVE', 'DEFAULTED', 'CLOSED', 'REJECTED'];

const COLUMNS: Column<Loan>[] = [
  { key: 'code', header: 'Loan', sortKey: 'code', render: (l) => <span className="mono">{l.loanCode}</span> },
  { key: 'customer', header: 'Customer', sortKey: 'customer', render: (l) => <>{l.customerName}<div className="muted small">{l.branchName}</div></> },
  { key: 'principal', header: 'Principal', sortKey: 'principal', align: 'right', render: (l) => <Money value={l.principalAmount} /> },
  { key: 'outstanding', header: 'Outstanding', sortKey: 'outstanding', align: 'right', render: (l) => <Money value={l.outstandingBalance} /> },
  { key: 'terms', header: 'Terms', render: (l) => <>{l.loanTerm} × {labelize(l.collectionFrequency)}<div className="muted small">{l.annualInterestRate}% p.a. flat</div></> },
  { key: 'start', header: 'Start', sortKey: 'startDate', render: (l) => formatDate(l.loanStartDate) },
  { key: 'agent', header: 'Agent', render: (l) => l.agent?.name ?? <span className="muted">—</span> },
  { key: 'status', header: 'Status', sortKey: 'status', render: (l) => <StatusBadge status={l.status} /> },
];

export function LoansPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useFilters({ search: '', status: '', frequency: '', branchId: '', agentId: '', sort: '', page: '1' });
  const { data, error, loading, reload } = useApi<Paged<Loan>>('/loans', { ...f, pageSize: 20 });

  return (
    <div className="stack">
      <PageHeader title="Loans" subtitle="Applications, approvals and the active loan book."
        actions={can('loans.create') && <Link className="btn btn-primary" to="/loans/new">New loan</Link>} />
      <Card flush>
        <div className="filters">
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="Loan code, customer or phone" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
          <Field label="Status">
            {(id) => (
              <select id={id} className="select" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Frequency">
            {(id) => (
              <select id={id} className="select" value={f.frequency} onChange={(e) => setF({ frequency: e.target.value })}>
                <option value="">Any</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            )}
          </Field>
          {can('scope.all_branches') && (
            <Field label="Branch">
              {(id) => <BranchSelect id={id} value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v), agentId: '' })} />}
            </Field>
          )}
          <Field label="Agent">
            {(id) => <AgentSelect id={id} value={f.agentId ? Number(f.agentId) : ''} branchId={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ agentId: String(v) })} />}
          </Field>
        </div>
        <DataTable columns={COLUMNS} rows={data?.data} rowKey={(l) => l.id} loading={loading} error={error} onRetry={reload}
          sort={f.sort} onSortChange={(sort) => setF({ sort })} onRowClick={(l) => navigate(`/loans/${l.id}`)}
          emptyTitle="No loans found" />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
    </div>
  );
}
