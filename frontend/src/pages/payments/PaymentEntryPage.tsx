import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, http } from '../../api/client';
import type { Envelope, LoanDetail, PaymentMethod } from '../../api/types';
import { useAuth } from '../../auth/context';
import { LoanPicker } from '../../components/pickers';
import { Alert, Button, Card, ErrorState, Field, Money, PageHeader, Spinner, StatCard, StatusBadge } from '../../components/ui';
import { errorMessage, fieldErrors } from '../../lib/errors';
import { formatDate, formatMoney, labelize } from '../../lib/format';
import { fromPaise, previewAllocation, toPaise } from '../../lib/money';
import { useApi } from '../../lib/useApi';

const NEEDS_REFERENCE: PaymentMethod[] = ['UPI', 'BANK_TRANSFER', 'CHEQUE'];

export function PaymentEntryPage() {
  const [params, setParams] = useSearchParams();
  const loanId = params.get('loanId');
  const { data, error, reload } = useApi<Envelope<LoanDetail>>(loanId ? `/loans/${loanId}` : null);
  const loan = data?.data;

  return (
    <div className="stack">
      <PageHeader title="Record payment" breadcrumb={<Link to="/payments">Payments</Link>}
        subtitle="Payments are applied to the oldest unpaid installment first." />
      <Card title="1. Loan">
        {loan ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <Link to={`/loans/${loan.id}`} className="mono">{loan.loanCode}</Link> <StatusBadge status={loan.status} />
              <div><strong>{loan.customerName}</strong> · {loan.customerPhone}</div>
              <div className="muted small">{loan.branchName} · Agent: {loan.agent?.name ?? 'unassigned'}</div>
            </div>
            <Button size="sm" onClick={() => setParams({})}>Choose another loan</Button>
          </div>
        ) : loanId && error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loanId ? (
          <Spinner />
        ) : (
          <Field label="Find an active loan">
            {(id) => <LoanPicker id={id} onSelect={(l) => setParams({ loanId: String(l.id) })} />}
          </Field>
        )}
      </Card>
      {/* key: a different loan gets a fresh form and a fresh submission key */}
      {loan && <PaymentForm key={loan.id} loan={loan} onLoanChanged={reload} />}
    </div>
  );
}

function PaymentForm({ loan, onLoanChanged }: { loan: LoanDetail; onLoanChanged: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const methods = user?.config.paymentMethods ?? ['CASH'];
  const open = loan.status === 'ACTIVE' || loan.status === 'DEFAULTED';
  const suggested = Number(loan.summary.overdueAmount) > 0
    ? loan.summary.overdueAmount
    : loan.schedule.find((i) => i.status === 'PENDING' || i.status === 'PARTIAL')?.outstandingAmount ?? '';

  const [form, setForm] = useState({ amount: suggested, paymentMethod: methods[0] as PaymentMethod, referenceNumber: '', notes: '' });
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; uncertain: boolean } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const amountPaise = toPaise(form.amount);
  const outstandingPaise = toPaise(loan.outstandingBalance) ?? 0n;
  const clientErrors: Record<string, string> = {};
  if (amountPaise === null) clientErrors.amount = 'Enter an amount like 1500 or 1500.50';
  else if (amountPaise <= 0n) clientErrors.amount = 'Amount must be greater than zero';
  else if (amountPaise > outstandingPaise) clientErrors.amount = `Cannot exceed the outstanding ${formatMoney(loan.outstandingBalance)}`;
  if (NEEDS_REFERENCE.includes(form.paymentMethod) && !form.referenceNumber.trim()) {
    clientErrors.referenceNumber = 'Reference number is required for this method';
  }
  const allocation = useMemo(
    () => (amountPaise && amountPaise > 0n ? previewAllocation(amountPaise, loan.schedule) : []),
    [amountPaise, loan.schedule],
  );

  if (!open) {
    return <Alert tone="warning">Payments can only be recorded for active or defaulted loans. This loan is {labelize(loan.status)}.</Alert>;
  }

  const review = () => {
    if (Object.keys(clientErrors).length) return setErrors(clientErrors);
    setErrors({});
    setError(null);
    // One key per reviewed submission: retries reuse it, so the payment is recorded at most once.
    setIdempotencyKey(crypto.randomUUID());
    setStep('review');
  };

  const submit = async () => {
    if (!idempotencyKey) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await http.post<{ data: { id: number; receiptNumber: string } }>('/payments', {
        loanId: loan.id,
        amount: form.amount.trim(),
        paymentMethod: form.paymentMethod,
        referenceNumber: form.referenceNumber.trim() || null,
        notes: form.notes.trim() || null,
        idempotencyKey,
      });
      navigate(`/payments/${res.data.id}?recorded=1`, { replace: true });
    } catch (err) {
      // No response at all: the payment may or may not have been saved. Retrying with
      // the same key is safe — the server returns the original payment if it exists.
      const uncertain = err instanceof ApiError && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT' || err.status >= 500);
      setError({ message: errorMessage(err), uncertain });
      setErrors(fieldErrors(err));
      if (!uncertain) {
        setStep('edit');
        onLoanChanged();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid grid-sidebar" style={{ alignItems: 'start' }}>
      <Card title={step === 'edit' ? '2. Payment details' : '3. Review and confirm'}>
        {error && (
          <div style={{ marginBottom: 14 }}>
            <Alert tone="error">
              <div>
                <strong>Payment not confirmed.</strong> {error.message}
                {error.uncertain && <div>We could not confirm whether it was saved. Retrying is safe — it will never be recorded twice.</div>}
              </div>
            </Alert>
          </div>
        )}
        {step === 'edit' ? (
          <div className="form-grid">
            <Field label="Amount (₹)" error={errors.amount} hint={`Outstanding: ${formatMoney(loan.outstandingBalance)}`}>
              {(id) => <input id={id} className="input" inputMode="decimal" value={form.amount} aria-invalid={!!errors.amount}
                onChange={(e) => set('amount')(e.target.value)} autoFocus />}
            </Field>
            <Field label="Method" error={errors.paymentMethod}>
              {(id) => (
                <select id={id} className="select" value={form.paymentMethod} onChange={(e) => set('paymentMethod')(e.target.value)}>
                  {methods.map((m) => <option key={m} value={m}>{labelize(m)}</option>)}
                </select>
              )}
            </Field>
            <Field label={NEEDS_REFERENCE.includes(form.paymentMethod) ? 'Reference number' : 'Reference number (optional)'} error={errors.referenceNumber}
              hint="UPI transaction ID, bank reference or cheque number">
              {(id) => <input id={id} className="input" value={form.referenceNumber} maxLength={100} aria-invalid={!!errors.referenceNumber}
                onChange={(e) => set('referenceNumber')(e.target.value)} />}
            </Field>
            <Field label="Notes (optional)" error={errors.notes}>
              {(id) => <input id={id} className="input" value={form.notes} maxLength={255} onChange={(e) => set('notes')(e.target.value)} />}
            </Field>
            <div className="span-2 form-actions" style={{ marginTop: 0 }}>
              <Button variant="primary" onClick={review}>Review payment</Button>
            </div>
          </div>
        ) : (
          <div className="stack">
            <div className="receipt-head">
              <div>
                <div className="muted small">Receipt preview — not yet recorded</div>
                <div className="receipt-amount">{formatMoney(form.amount)}</div>
                <div>{labelize(form.paymentMethod)}{form.referenceNumber && ` · ${form.referenceNumber}`}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong>{loan.customerName}</strong>
                <div className="mono">{loan.loanCode}</div>
                <div className="muted small">Collected by {user?.name}</div>
              </div>
            </div>
            <table className="table">
              <thead><tr><th>Installment</th><th>Due date</th><th className="num">Applied</th><th></th></tr></thead>
              <tbody>
                {allocation.map((a) => (
                  <tr key={a.installmentNumber}>
                    <td>#{a.installmentNumber}</td>
                    <td>{formatDate(a.dueDate)}</td>
                    <td className="num"><Money value={a.amount} /></td>
                    <td>{a.settles ? <StatusBadge status="PAID" /> : <StatusBadge status="PARTIAL" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">
              Balance after this payment: <strong>{formatMoney(fromPaise(outstandingPaise - (amountPaise ?? 0n)))}</strong>
              {amountPaise === outstandingPaise && ' — this payment closes the loan.'}
            </p>
            <div className="form-actions">
              <Button onClick={() => { setStep('edit'); setError(null); }} disabled={submitting}>Back</Button>
              <Button variant="primary" icon="check" loading={submitting} onClick={submit}>
                {error?.uncertain ? 'Retry confirmation' : 'Confirm and record'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="stack">
        <StatCard label="Outstanding" value={formatMoney(loan.outstandingBalance)} tone="navy" />
        <StatCard label="Overdue now" value={formatMoney(loan.summary.overdueAmount)}
          hint={`${loan.summary.overdueInstallments} installments`} tone={Number(loan.summary.overdueAmount) > 0 ? 'danger' : 'accent'} />
        <Card title="Next installments" flush>
          <table className="table">
            <tbody>
              {loan.schedule.filter((i) => i.status === 'PENDING' || i.status === 'PARTIAL').slice(0, 6).map((i) => (
                <tr key={i.id}>
                  <td>#{i.installmentNumber}</td>
                  <td>{formatDate(i.dueDate)}</td>
                  <td className="num"><Money value={i.outstandingAmount} /></td>
                  <td><StatusBadge status={i.effectiveStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
