import { Link } from 'react-router';
import type { DueInstallment } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable } from '../../components/DataTable';
import { Money, StatusBadge } from '../../components/ui';
import { formatDate } from '../../lib/format';

/** Installments to collect, with a shortcut to record a payment. */
export function DueTable({ rows, loading, error, onRetry, sort, onSortChange }: {
  rows: DueInstallment[] | undefined; loading: boolean; error: unknown; onRetry: () => void;
  sort?: string; onSortChange?: (s: string) => void;
}) {
  const { can } = useAuth();
  return (
    <DataTable rows={rows} rowKey={(r) => r.id} loading={loading} error={error} onRetry={onRetry}
      sort={sort} onSortChange={onSortChange} emptyTitle="Nothing to collect" emptyMessage="No installments match these filters."
      columns={[
        { key: 'due', header: 'Due', sortKey: 'dueDate', render: (r) => <>{formatDate(r.dueDate)}{r.daysPastDue > 0 && <div className="danger-text small">{r.daysPastDue} days late</div>}</> },
        { key: 'customer', header: 'Customer', sortKey: 'customer', render: (r) => <>
          <Link to={`/customers/${r.customerId}`}>{r.customerName}</Link>
          <div className="muted small">{r.customerPhone}</div>
        </> },
        { key: 'loan', header: 'Loan', sortKey: 'loan', render: (r) => <>
          <Link to={`/loans/${r.loanId}`} className="mono">{r.loanCode}</Link>
          <div className="muted small">#{r.installmentNumber} · {r.branchName}</div>
        </> },
        { key: 'agent', header: 'Agent', sortKey: 'agent', render: (r) => r.agentName ?? <span className="muted">Unassigned</span> },
        { key: 'dueAmt', header: 'Due', align: 'right', render: (r) => <Money value={r.dueAmount} /> },
        { key: 'paid', header: 'Paid', align: 'right', render: (r) => <Money value={r.paidAmount} /> },
        { key: 'out', header: 'Remaining', sortKey: 'outstanding', align: 'right', render: (r) => <Money value={r.outstandingAmount} /> },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'act', header: '', render: (r) =>
          can('payments.create') && Number(r.outstandingAmount) > 0 && r.loanStatus !== 'CLOSED'
            ? <Link className="btn btn-sm btn-primary no-print" to={`/payments/new?loanId=${r.loanId}`} onClick={(e) => e.stopPropagation()}>Collect</Link>
            : null },
      ]} />
  );
}
