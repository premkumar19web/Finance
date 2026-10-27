import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { http } from '../../api/client';
import type { Envelope, PaymentDetail } from '../../api/types';
import { useAuth } from '../../auth/context';
import { Alert, Button, Card, ErrorState, Field, Modal, Money, PageHeader, Spinner, StatusBadge } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatMoney, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';

export function PaymentDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { can } = useAuth();
  const { data, error, reload } = useApi<Envelope<PaymentDetail>>(`/payments/${id}`);
  const [reversing, setReversing] = useState(false);
  const p = data?.data;

  if (error && !p) return <ErrorState error={error} onRetry={reload} />;
  if (!p) return <Spinner />;
  const reversed = p.status === 'REVERSED';

  return (
    <div className="stack">
      <PageHeader breadcrumb={<Link to="/payments">Payments</Link>}
        title={<>Receipt <span className="mono">{p.receiptNumber}</span> <StatusBadge status={p.status} /></>}
        actions={<>
          <Button icon="print" onClick={() => window.print()}>Print receipt</Button>
          {!reversed && can('payments.reverse') && <Button variant="danger" onClick={() => setReversing(true)}>Reverse payment</Button>}
        </>} />
      {params.get('recorded') === '1' && !reversed && (
        <Alert tone="success">Payment recorded and confirmed by the server. Receipt {p.receiptNumber} has been issued.</Alert>
      )}
      {reversed && (
        <Alert tone="error">
          Reversed on {formatDateTime(p.reversedAt)} by {p.reversedByName}: {p.reversalReason}. This amount no longer counts towards the loan.
        </Alert>
      )}

      <Card>
        <div className="receipt stack">
          <div className="receipt-head">
            <div>
              <h2>{p.companyName}</h2>
              <div className="muted small">{p.branchName}{p.branchAddress && ` · ${p.branchAddress}`}</div>
              {p.branchPhone && <div className="muted small">{p.branchPhone}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="muted small">Payment receipt</div>
              <div className="mono">{p.receiptNumber}</div>
              <div className="small">{formatDateTime(p.paymentDate)}</div>
              {reversed && <div className="watermark">REVERSED</div>}
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div className="muted small">Received from</div>
              <strong>{p.customerName}</strong> <span className="mono muted">{p.customerCode}</span>
              <div className="small">Loan <Link to={`/loans/${p.loanId}`} className="mono">{p.loanCode}</Link></div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="muted small">Amount</div>
              <div className="receipt-amount">{formatMoney(p.amount)}</div>
            </div>
          </div>
          <dl className="detail-list">
            <div><dt>Method</dt><dd>{labelize(p.paymentMethod)}</dd></div>
            <div><dt>Reference</dt><dd className="mono">{p.referenceNumber ?? '—'}</dd></div>
            <div><dt>Collected by</dt><dd>{p.collectedByName ?? '—'}</dd></div>
            <div><dt>Recorded by</dt><dd>{p.recordedByName ?? '—'}</dd></div>
            <div><dt>Loan balance now</dt><dd>{formatMoney(p.loanOutstanding)} <StatusBadge status={p.loanStatus} /></dd></div>
            {p.notes && <div><dt>Notes</dt><dd>{p.notes}</dd></div>}
          </dl>
          <table className="table">
            <thead><tr><th>Installment</th><th>Due date</th><th className="num">Installment amount</th><th className="num">Paid by this receipt</th></tr></thead>
            <tbody>
              {p.allocations.map((a) => (
                <tr key={a.scheduleId}>
                  <td>#{a.installmentNumber}</td>
                  <td>{formatDate(a.dueDate)}</td>
                  <td className="num"><Money value={a.dueAmount} /></td>
                  <td className="num"><Money value={a.allocatedAmount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Computer-generated receipt. Keep it for your records.</p>
        </div>
      </Card>

      {reversing && <ReverseDialog paymentId={p.id} onClose={() => setReversing(false)} onDone={() => { setReversing(false); reload(); }} />}
    </div>
  );
}

function ReverseDialog({ paymentId, onClose, onDone }: { paymentId: number; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await http.post(`/payments/${paymentId}/reverse`, { reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Reverse payment" onClose={onClose}>
      <div className="stack">
        <Alert tone="warning">
          Reversing restores the installments and loan balance this payment paid. The receipt stays on record, marked as reversed.
        </Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Reason (recorded in the audit log)">
          {(id) => <textarea id={id} className="textarea" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} autoFocus />}
        </Field>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit}>Reverse payment</Button>
        </div>
      </div>
    </Modal>
  );
}
