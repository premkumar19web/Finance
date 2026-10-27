import { Link, useNavigate } from 'react-router';
import type { Paged, Payment, PaymentSummary } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable, Pagination, type Column } from '../../components/DataTable';
import { AgentSelect, BranchSelect } from '../../components/pickers';
import { SearchInput } from '../../components/SearchInput';
import { Card, Field, Money, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { formatDateTime, formatMoney, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';

const COLUMNS: Column<Payment>[] = [
  { key: 'receipt', header: 'Receipt', sortKey: 'receipt', render: (p) => <span className="mono">{p.receiptNumber}</span> },
  { key: 'date', header: 'Date', sortKey: 'date', render: (p) => formatDateTime(p.paymentDate) },
  { key: 'customer', header: 'Customer', sortKey: 'customer', render: (p) => <>{p.customerName}<div className="muted small">{p.loanCode}</div></> },
  { key: 'branch', header: 'Branch', render: (p) => p.branchName },
  { key: 'collector', header: 'Collected by', render: (p) => p.collectedByName ?? '—' },
  { key: 'method', header: 'Method', render: (p) => <>{labelize(p.paymentMethod)}{p.referenceNumber && <div className="muted small mono">{p.referenceNumber}</div>}</> },
  { key: 'amount', header: 'Amount', sortKey: 'amount', align: 'right', render: (p) => <Money value={p.amount} /> },
  { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
];

export function PaymentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useFilters({ search: '', from: '', to: '', method: '', status: '', branchId: '', agentId: '', sort: '', page: '1' });
  const { data, error, loading, reload } = useApi<Paged<Payment, PaymentSummary>>('/payments', { ...f, pageSize: 25 });
  const s = data?.summary;

  return (
    <div className="stack">
      <PageHeader title="Payment history" subtitle="Every receipt issued. Reversed payments stay listed for the audit trail."
        actions={can('payments.create') && <Link className="btn btn-primary" to="/payments/new">Record payment</Link>} />
      <div className="grid grid-3">
        <StatCard label="Recorded (filtered)" loading={!s} value={formatMoney(s?.recordedAmount)} hint={s && `${s.recordedCount} payments`} />
        <StatCard label="Reversed (filtered)" loading={!s} value={formatMoney(s?.reversedAmount)} hint={s && `${s.reversedCount} payments`} tone="danger" />
        <StatCard label="Matching payments" loading={!data} value={data?.meta.total ?? '—'} tone="navy" />
      </div>
      <Card flush>
        <div className="filters">
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="Receipt, loan, customer or reference" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
          <Field label="From">{(id) => <input id={id} type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} />}</Field>
          <Field label="Method">
            {(id) => (
              <select id={id} className="select" value={f.method} onChange={(e) => setF({ method: e.target.value })}>
                <option value="">Any</option>
                {['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'].map((m) => <option key={m} value={m}>{labelize(m)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <select id={id} className="select" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
                <option value="">Any</option>
                <option value="RECORDED">Recorded</option>
                <option value="REVERSED">Reversed</option>
              </select>
            )}
          </Field>
          {can('scope.all_branches') && (
            <Field label="Branch">
              {(id) => <BranchSelect id={id} value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v), agentId: '' })} />}
            </Field>
          )}
          {can('assignments.view') && (
            <Field label="Collected by">
              {(id) => <AgentSelect id={id} value={f.agentId ? Number(f.agentId) : ''} branchId={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ agentId: String(v) })} />}
            </Field>
          )}
        </div>
        <DataTable columns={COLUMNS} rows={data?.data} rowKey={(p) => p.id} loading={loading} error={error} onRetry={reload}
          sort={f.sort} onSortChange={(sort) => setF({ sort })} onRowClick={(p) => navigate(`/payments/${p.id}`)}
          emptyTitle="No payments found" />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
    </div>
  );
}
