import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, http } from '../../api/client';
import type { Customer, CustomerDetail, Envelope, Frequency, SchedulePreview } from '../../api/types';
import { DataTable } from '../../components/DataTable';
import { CustomerPicker } from '../../components/pickers';
import { Alert, Button, Card, Field, Money, PageHeader, StatCard } from '../../components/ui';
import { errorMessage, fieldErrors } from '../../lib/errors';
import { formatDate, formatMoney, isoDate } from '../../lib/format';
import { useApi, useDebounced } from '../../lib/useApi';

const TERM_HINT: Record<Frequency, string> = {
  DAILY: 'Number of daily collections, e.g. 100',
  WEEKLY: 'Number of weekly collections, e.g. 20',
  MONTHLY: 'Number of monthly installments, e.g. 12',
};

export function NewLoanPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const preselected = params.get('customerId');
  const pre = useApi<Envelope<CustomerDetail>>(preselected ? `/customers/${preselected}` : null);
  const [picked, setPicked] = useState<Customer | null>(null);
  const customer = picked ?? pre.data?.data ?? null;

  const [terms, setTerms] = useState({
    principalAmount: '',
    annualInterestRate: '24',
    loanTerm: '20',
    collectionFrequency: 'WEEKLY' as Frequency,
    loanStartDate: isoDate(),
    purpose: '',
  });
  const set = (key: keyof typeof terms) => (value: string) => setTerms((t) => ({ ...t, [key]: value }));

  // Live preview of the repayment schedule as the terms change.
  const debounced = useDebounced(terms, 400);
  const [preview, setPreview] = useState<{ key: string; data?: SchedulePreview; error?: string }>({ key: '' });
  const previewKey = JSON.stringify(debounced);
  const ready = /^\d+(\.\d{1,2})?$/.test(debounced.principalAmount) && Number(debounced.loanTerm) > 0;
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    http.post<Envelope<SchedulePreview>>('/loans/preview', { ...debounced, loanTerm: Number(debounced.loanTerm) }).then(
      (res) => !cancelled && setPreview({ key: previewKey, data: res.data }),
      (err: unknown) => !cancelled && setPreview({ key: previewKey, error: errorMessage(err) }),
    );
    return () => { cancelled = true; };
  }, [previewKey, ready, debounced]);
  const current = ready && preview.key === previewKey ? preview : null;

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customer) return setError('Choose a customer first.');
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const res = await http.post<{ data: { id: number } }>('/loans', {
        ...terms, loanTerm: Number(terms.loanTerm), customerId: customer.id, purpose: terms.purpose || null,
      });
      navigate(`/loans/${res.data.id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader breadcrumb={<Link to="/loans">Loans</Link>} title="New loan application"
        subtitle="The loan is created as Pending and must be approved by a second person before disbursement." />
      <form onSubmit={onSubmit} noValidate className="grid grid-sidebar" style={{ alignItems: 'start' }}>
        <div className="stack">
          {error && <Alert tone="error">{error}</Alert>}
          <Card title="Customer">
            {customer ? (
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{customer.fullName}</strong> <span className="mono muted">{customer.customerCode}</span>
                  <div className="muted small">{customer.phone} · {customer.branchName}</div>
                </div>
                <Button size="sm" onClick={() => { setPicked(null); navigate('/loans/new', { replace: true }); }}>Change</Button>
              </div>
            ) : (
              <Field label="Find customer" hint="Only active customers can receive loans.">
                {(id) => <CustomerPicker id={id} onSelect={setPicked} />}
              </Field>
            )}
          </Card>
          <Card title="Loan terms">
            <div className="form-grid">
              <Field label="Principal amount (₹)" error={errors.principalAmount}>
                {(id) => <input id={id} className="input" inputMode="decimal" value={terms.principalAmount}
                  onChange={(e) => set('principalAmount')(e.target.value)} placeholder="25000" required />}
              </Field>
              <Field label="Annual interest rate (% flat)" error={errors.annualInterestRate}>
                {(id) => <input id={id} className="input" inputMode="decimal" value={terms.annualInterestRate}
                  onChange={(e) => set('annualInterestRate')(e.target.value)} required />}
              </Field>
              <Field label="Collection frequency" error={errors.collectionFrequency}>
                {(id) => (
                  <select id={id} className="select" value={terms.collectionFrequency} onChange={(e) => set('collectionFrequency')(e.target.value)}>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                  </select>
                )}
              </Field>
              <Field label="Number of installments" error={errors.loanTerm} hint={TERM_HINT[terms.collectionFrequency]}>
                {(id) => <input id={id} className="input" type="number" min={1} value={terms.loanTerm}
                  onChange={(e) => set('loanTerm')(e.target.value)} required />}
              </Field>
              <Field label="Start date" error={errors.loanStartDate} hint="First installment is due one period later.">
                {(id) => <input id={id} className="input" type="date" min={isoDate()} value={terms.loanStartDate}
                  onChange={(e) => set('loanStartDate')(e.target.value)} required />}
              </Field>
              <Field label="Purpose (optional)" error={errors.purpose}>
                {(id) => <input id={id} className="input" value={terms.purpose} maxLength={200}
                  onChange={(e) => set('purpose')(e.target.value)} />}
              </Field>
            </div>
            <div className="form-actions">
              <Link className="btn btn-secondary" to="/loans">Cancel</Link>
              <Button type="submit" variant="primary" loading={saving} disabled={!customer || !current?.data}>Submit application</Button>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="Schedule preview">
            {!ready && <p className="muted">Enter an amount and term to see the repayment schedule.</p>}
            {ready && !current && <p className="muted">Calculating…</p>}
            {current?.error && <Alert tone="error">{current.error}</Alert>}
            {current?.data && (
              <div className="stack">
                <div className="grid grid-2">
                  <StatCard label="Total interest" value={formatMoney(current.data.totalInterest)} />
                  <StatCard label="Total payable" value={formatMoney(current.data.totalPayable)} tone="navy" />
                </div>
                <p className="small muted">
                  {current.data.installments.length} installments of about{' '}
                  <strong>{formatMoney(current.data.installments[0]?.totalDue)}</strong>; matures {formatDate(current.data.maturityDate)}.
                  Rounding differences are added to the final installment.
                </p>
              </div>
            )}
          </Card>
          {current?.data && (
            <Card title="Installments" flush>
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                <DataTable rows={current.data.installments} rowKey={(i) => i.installmentNumber}
                  columns={[
                    { key: 'n', header: '#', render: (i) => i.installmentNumber },
                    { key: 'date', header: 'Due', render: (i) => formatDate(i.dueDate) },
                    { key: 'p', header: 'Principal', align: 'right', render: (i) => <Money value={i.principalDue} /> },
                    { key: 'i', header: 'Interest', align: 'right', render: (i) => <Money value={i.interestDue} /> },
                    { key: 't', header: 'Total', align: 'right', render: (i) => <Money value={i.totalDue} /> },
                  ]} />
              </div>
            </Card>
          )}
        </div>
      </form>
    </div>
  );
}
