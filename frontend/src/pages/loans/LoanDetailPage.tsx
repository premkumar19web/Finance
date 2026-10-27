import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { http } from '../../api/client';
import type { Envelope, LoanDetail } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable } from '../../components/DataTable';
import { AgentSelect } from '../../components/pickers';
import { Alert, Button, Card, ErrorState, Field, Modal, Money, PageHeader, Spinner, StatCard, StatusBadge, Tabs } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatMoney, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';

type Dialog = null | 'reject' | 'disburse' | 'default' | 'assign';
type Tab = 'schedule' | 'payments' | 'agents' | 'details';

export function LoanDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const { data, error, reload } = useApi<Envelope<LoanDetail>>(`/loans/${id}`);
  const [tab, setTab] = useState<Tab>('schedule');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loan = data?.data;

  if (error && !loan) return <ErrorState error={error} onRetry={reload} />;
  if (!loan) return <Spinner />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setDialog(null);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const open = loan.status === 'ACTIVE' || loan.status === 'DEFAULTED';
  const ownLoan = loan.createdBy === user?.id;

  return (
    <div className="stack">
      <PageHeader
        breadcrumb={<Link to="/loans">Loans</Link>}
        title={<><span className="mono">{loan.loanCode}</span> <StatusBadge status={loan.status} /></>}
        subtitle={<><Link to={`/customers/${loan.customerId}`}>{loan.customerName}</Link> · {loan.customerPhone} · {loan.branchName}</>}
        actions={<>
          {loan.status === 'PENDING' && can('loans.approve') && (
            <>
              <Button variant="primary" icon="check" loading={busy} disabled={ownLoan}
                title={ownLoan ? 'Another person must approve a loan you created' : undefined}
                onClick={() => run(() => http.post(`/loans/${loan.id}/approve`))}>Approve</Button>
              <Button variant="danger" onClick={() => setDialog('reject')}>Reject</Button>
            </>
          )}
          {loan.status === 'APPROVED' && can('loans.disburse') && (
            <Button variant="primary" onClick={() => setDialog('disburse')}>Disburse</Button>
          )}
          {open && can('payments.create') && (
            <Link className="btn btn-primary" to={`/payments/new?loanId=${loan.id}`}>Record payment</Link>
          )}
          {open && can('assignments.manage') && <Button onClick={() => setDialog('assign')}>{loan.agent ? 'Reassign agent' : 'Assign agent'}</Button>}
          {loan.status === 'ACTIVE' && can('loans.approve') && <Button variant="ghost" onClick={() => setDialog('default')}>Mark defaulted</Button>}
        </>}
      />
      {actionError && !dialog && <Alert tone="error">{actionError}</Alert>}
      {loan.status === 'PENDING' && ownLoan && can('loans.approve') && (
        <Alert tone="info">You created this application, so another manager must approve it (maker-checker rule).</Alert>
      )}
      {loan.status === 'REJECTED' && <Alert tone="error">Rejected by {loan.rejectedByName}: {loan.rejectionReason}</Alert>}

      <div className="grid grid-4">
        <StatCard label="Principal" value={formatMoney(loan.principalAmount)} tone="navy" />
        <StatCard label="Total payable" value={formatMoney(loan.totalPayable)} hint={`Interest ${formatMoney(loan.totalInterest)}`} tone="navy" />
        <StatCard label="Paid so far" value={formatMoney(loan.summary.paidAmount)}
          hint={`${loan.summary.paidInstallments} of ${loan.loanTerm} installments paid`} />
        <StatCard label="Outstanding" value={formatMoney(loan.outstandingBalance)} tone={Number(loan.summary.overdueAmount) > 0 ? 'danger' : 'accent'}
          hint={Number(loan.summary.overdueAmount) > 0 ? `${formatMoney(loan.summary.overdueAmount)} overdue (${loan.summary.overdueInstallments})` : loan.summary.nextDueDate ? `Next due ${formatDate(loan.summary.nextDueDate)}` : undefined} />
      </div>

      <Card flush>
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { value: 'schedule', label: `Repayment schedule (${loan.schedule.length})` },
          { value: 'payments', label: `Payments (${loan.payments.length})` },
          { value: 'agents', label: 'Collection agents' },
          { value: 'details', label: 'Details' },
        ]} />
        {tab === 'schedule' && (
          loan.schedule.length ? (
            <DataTable rows={loan.schedule} rowKey={(i) => i.id}
              columns={[
                { key: 'n', header: '#', render: (i) => i.installmentNumber },
                { key: 'due', header: 'Due date', render: (i) => formatDate(i.dueDate) },
                { key: 'p', header: 'Principal', align: 'right', render: (i) => <Money value={i.principalDue} /> },
                { key: 'int', header: 'Interest', align: 'right', render: (i) => <Money value={i.interestDue} /> },
                { key: 't', header: 'Total due', align: 'right', render: (i) => <Money value={i.totalDue} /> },
                { key: 'paid', header: 'Paid', align: 'right', render: (i) => <Money value={i.paidAmount} /> },
                { key: 'o', header: 'Outstanding', align: 'right', render: (i) => <Money value={i.outstandingAmount} /> },
                { key: 's', header: 'Status', render: (i) => <>
                  <StatusBadge status={i.effectiveStatus} />
                  {i.effectiveStatus === 'OVERDUE' && <span className="muted small"> {i.daysPastDue}d</span>}
                </> },
              ]} />
          ) : <p className="empty">The schedule is created when the loan is disbursed.</p>
        )}
        {tab === 'payments' && (
          <DataTable rows={loan.payments} rowKey={(p) => p.id} emptyTitle="No payments yet"
            columns={[
              { key: 'r', header: 'Receipt', render: (p) => <Link to={`/payments/${p.id}`} className="mono">{p.receiptNumber}</Link> },
              { key: 'd', header: 'Date', render: (p) => formatDateTime(p.paymentDate) },
              { key: 'm', header: 'Method', render: (p) => labelize(p.paymentMethod) },
              { key: 'c', header: 'Collected by', render: (p) => p.collectedByName ?? '—' },
              { key: 'a', header: 'Amount', align: 'right', render: (p) => <Money value={p.amount} /> },
              { key: 's', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            ]} />
        )}
        {tab === 'agents' && (
          <DataTable rows={loan.assignments} rowKey={(a) => a.id} emptyTitle="No agent assigned yet"
            columns={[
              { key: 'a', header: 'Agent', render: (a) => a.agentName },
              { key: 'f', header: 'From', render: (a) => formatDateTime(a.assignedAt) },
              { key: 't', header: 'Until', render: (a) => a.unassignedAt ? formatDateTime(a.unassignedAt) : <StatusBadge status="ACTIVE" /> },
              { key: 'b', header: 'Assigned by', render: (a) => a.assignedByName ?? '—' },
              { key: 'n', header: 'Notes', render: (a) => a.notes ?? '' },
            ]} />
        )}
        {tab === 'details' && (
          <div className="card-body">
            <dl className="detail-list">
              <div><dt>Interest</dt><dd>{loan.annualInterestRate}% per year, {labelize(loan.interestMethod)}</dd></div>
              <div><dt>Term</dt><dd>{loan.loanTerm} {labelize(loan.collectionFrequency)} installments</dd></div>
              <div><dt>Start date</dt><dd>{formatDate(loan.loanStartDate)}</dd></div>
              <div><dt>Maturity date</dt><dd>{formatDate(loan.maturityDate)}</dd></div>
              <div><dt>Purpose</dt><dd>{loan.purpose ?? '—'}</dd></div>
              <div><dt>Collection agent</dt><dd>{loan.agent?.name ?? '—'}</dd></div>
              <div><dt>Created</dt><dd>{formatDateTime(loan.createdAt)} by {loan.createdByName ?? '—'}</dd></div>
              <div><dt>Approved</dt><dd>{loan.approvedAt ? `${formatDateTime(loan.approvedAt)} by ${loan.approvedByName}` : '—'}</dd></div>
              <div><dt>Disbursed</dt><dd>{loan.disbursedAt ? `${formatDateTime(loan.disbursedAt)} by ${loan.disbursedByName}` : '—'}</dd></div>
              <div><dt>Closed</dt><dd>{loan.closedAt ? formatDateTime(loan.closedAt) : '—'}</dd></div>
            </dl>
          </div>
        )}
      </Card>

      {dialog === 'reject' && (
        <ReasonDialog title="Reject loan application" action="Reject" busy={busy} error={actionError}
          onClose={() => setDialog(null)} onSubmit={(reason) => run(() => http.post(`/loans/${loan.id}/reject`, { reason }))} />
      )}
      {dialog === 'default' && (
        <ReasonDialog title="Mark loan as defaulted" action="Mark defaulted" busy={busy} error={actionError}
          onClose={() => setDialog(null)} onSubmit={(reason) => run(() => http.post(`/loans/${loan.id}/default`, { reason }))} />
      )}
      {(dialog === 'disburse' || dialog === 'assign') && (
        <AgentDialog branchId={loan.branchId} disburse={dialog === 'disburse'} busy={busy} error={actionError}
          onClose={() => setDialog(null)}
          onSubmit={(agentId, notes) => run(() => dialog === 'disburse'
            ? http.post(`/loans/${loan.id}/disburse`, agentId ? { agentId } : {})
            : http.post('/assignments', { loanId: loan.id, agentId, notes: notes || null }))} />
      )}
    </div>
  );
}

function ReasonDialog({ title, action, busy, error, onClose, onSubmit }: {
  title: string; action: string; busy: boolean; error: string | null; onClose: () => void; onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Reason (recorded in the audit log)">
          {(id) => <textarea id={id} className="textarea" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} autoFocus />}
        </Field>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>{action}</Button>
        </div>
      </div>
    </Modal>
  );
}

function AgentDialog({ branchId, disburse, busy, error, onClose, onSubmit }: {
  branchId: number; disburse: boolean; busy: boolean; error: string | null; onClose: () => void;
  onSubmit: (agentId: number | undefined, notes: string) => void;
}) {
  const [agentId, setAgentId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  return (
    <Modal title={disburse ? 'Disburse loan' : 'Assign collection agent'} onClose={onClose}>
      <div className="stack">
        {disburse && (
          <Alert tone="info">
            Disbursing creates the repayment schedule and makes the full amount payable. Confirm the money has been handed over.
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={disburse ? 'Collection agent (optional)' : 'Collection agent'}>
          {(id) => <AgentSelect id={id} value={agentId} onChange={setAgentId} branchId={branchId} placeholder="Select an agent…" />}
        </Field>
        {!disburse && (
          <Field label="Notes (optional)">
            {(id) => <input id={id} className="input" value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        )}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!disburse && !agentId}
            onClick={() => onSubmit(agentId || undefined, notes)}>
            {disburse ? 'Confirm disbursement' : 'Assign'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
