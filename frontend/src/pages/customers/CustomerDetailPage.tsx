import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { http } from '../../api/client';
import type { CustomerDetail, Envelope, Paged, Payment, PaymentSummary } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable, Pagination } from '../../components/DataTable';
import { Alert, Button, Card, ErrorState, Money, PageHeader, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatMoney, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { CustomerForm } from './CustomerForm';

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, reload } = useApi<Envelope<CustomerDetail>>(`/customers/${id}`);
  const payments = useApi<Paged<Payment, PaymentSummary>>('/payments', { customerId: id, page, pageSize: 10 });
  const c = data?.data;

  if (error && !c) return <ErrorState error={error} onRetry={reload} />;
  if (!c) return <Spinner />;

  const toggleActive = async () => {
    setActionError(null);
    try {
      await http.patch(`/customers/${c.id}`, { isActive: !c.isActive });
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={<Link to="/customers">Customers</Link>}
        title={<>{c.fullName} <StatusBadge status={c.isActive ? 'ACTIVE' : 'INACTIVE'} /></>}
        subtitle={<span className="mono">{c.customerCode}</span>}
        actions={<>
          {can('loans.create') && c.isActive && <Link className="btn btn-primary" to={`/loans/new?customerId=${c.id}`}>New loan</Link>}
          {can('customers.manage') && <Button icon="settings" onClick={() => setEditing(true)}>Edit</Button>}
          {can('customers.manage') && (
            <Button variant={c.isActive ? 'danger' : 'secondary'} onClick={toggleActive}>{c.isActive ? 'Deactivate' : 'Reactivate'}</Button>
          )}
        </>}
      />
      {actionError && <Alert tone="error">{actionError}</Alert>}

      <div className="grid grid-3">
        <StatCard label="Outstanding" value={formatMoney(c.totals.totalOutstanding)} />
        <StatCard label="Total paid" value={formatMoney(c.totals.totalPaid)} tone="navy" />
        <StatCard label="Overdue installments" value={c.totals.overdueInstallments} tone={c.totals.overdueInstallments ? 'danger' : 'accent'} />
      </div>

      <Card title="Details">
        <dl className="detail-list">
          <div><dt>Phone</dt><dd>{c.phone}</dd></div>
          <div><dt>Email</dt><dd>{c.email ?? '—'}</dd></div>
          <div><dt>Branch</dt><dd>{c.branchName}</dd></div>
          <div><dt>Occupation</dt><dd>{c.occupation ?? '—'}</dd></div>
          <div><dt>ID document</dt><dd>{c.idDocumentType ? `${labelize(c.idDocumentType)} ••••${c.idDocumentLast4}` : '—'}</dd></div>
          <div><dt>Customer since</dt><dd>{formatDate(c.createdAt.slice(0, 10))}</dd></div>
          <div><dt>Registered by</dt><dd>{c.createdByName ?? '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt>Address</dt><dd>{c.address ?? '—'}</dd></div>
        </dl>
      </Card>

      <Card title="Loans" flush>
        <DataTable rows={c.loans} rowKey={(l) => l.id} emptyTitle="No loans yet"
          columns={[
            { key: 'code', header: 'Loan', render: (l) => <Link to={`/loans/${l.id}`} className="mono">{l.loanCode}</Link> },
            { key: 'principal', header: 'Principal', align: 'right', render: (l) => <Money value={l.principalAmount} /> },
            { key: 'payable', header: 'Total payable', align: 'right', render: (l) => <Money value={l.totalPayable} /> },
            { key: 'outstanding', header: 'Outstanding', align: 'right', render: (l) => <Money value={l.outstandingBalance} /> },
            { key: 'terms', header: 'Terms', render: (l) => `${l.loanTerm} × ${labelize(l.collectionFrequency)}` },
            { key: 'dates', header: 'Start → maturity', render: (l) => `${formatDate(l.loanStartDate)} → ${formatDate(l.maturityDate)}` },
            { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
          ]} />
      </Card>

      <Card title="Payment history" flush>
        <DataTable rows={payments.data?.data} rowKey={(p) => p.id} loading={payments.loading} error={payments.error}
          emptyTitle="No payments yet"
          columns={[
            { key: 'receipt', header: 'Receipt', render: (p) => <Link to={`/payments/${p.id}`} className="mono">{p.receiptNumber}</Link> },
            { key: 'date', header: 'Date', render: (p) => formatDateTime(p.paymentDate) },
            { key: 'loan', header: 'Loan', render: (p) => p.loanCode },
            { key: 'method', header: 'Method', render: (p) => labelize(p.paymentMethod) },
            { key: 'amount', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} /> },
            { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
          ]} />
        <Pagination meta={payments.data?.meta} onPage={setPage} />
      </Card>

      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}
