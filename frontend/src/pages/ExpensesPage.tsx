import { useState, type FormEvent } from 'react';
import { http } from '../api/client';
import type { Expense, ExpenseSummary, Paged } from '../api/types';
import { useAuth } from '../auth/context';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { BranchSelect } from '../components/pickers';
import { Alert, Button, Card, Field, Modal, Money, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/errors';
import { formatDate, formatMoney, isoDate, labelize } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useFilters } from '../lib/useFilters';

const CATEGORIES = ['RENT', 'UTILITIES', 'SALARIES', 'TRAVEL', 'OFFICE_SUPPLIES', 'MARKETING', 'MAINTENANCE', 'COMMUNICATION', 'OTHER'];

export function ExpensesPage() {
  const { can, user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<{ expense: Expense; decision: 'approve' | 'reject' } | null>(null);
  const [f, setF] = useFilters({ status: '', category: '', branchId: '', from: '', to: '', sort: '', page: '1' });
  const { data, error, loading, reload } = useApi<Paged<Expense, ExpenseSummary>>('/expenses', { ...f, pageSize: 25 });
  const s = data?.summary;

  const columns: Column<Expense>[] = [
    { key: 'date', header: 'Date', sortKey: 'date', render: (e) => formatDate(e.expenseDate) },
    { key: 'branch', header: 'Branch', sortKey: 'branch', render: (e) => e.branchName ?? '—' },
    { key: 'category', header: 'Category', sortKey: 'category', render: (e) => <>{labelize(e.category)}<div className="muted small">{e.description}</div></> },
    { key: 'by', header: 'Submitted by', render: (e) => e.submittedByName },
    { key: 'amount', header: 'Amount', sortKey: 'amount', align: 'right', render: (e) => <Money value={e.amount} /> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (e) => <>
      <StatusBadge status={e.status} />
      {e.reviewedByName && <div className="muted small">{e.reviewedByName}{e.reviewNote ? `: ${e.reviewNote}` : ''}</div>}
    </> },
    { key: 'act', header: '', render: (e) => e.status === 'PENDING' && can('expenses.approve') && e.submittedBy !== user?.id && (
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" variant="primary" onClick={() => setReviewing({ expense: e, decision: 'approve' })}>Approve</Button>
        <Button size="sm" variant="danger" onClick={() => setReviewing({ expense: e, decision: 'reject' })}>Reject</Button>
      </div>
    ) },
  ];

  return (
    <div className="stack">
      <PageHeader title="Expenses" subtitle="Branch running costs. Expenses need approval by someone other than the submitter."
        actions={can('expenses.create') && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Submit expense</Button>} />
      <div className="grid grid-3">
        <StatCard label="Approved (filtered)" loading={!s} value={formatMoney(s?.approvedAmount)} />
        <StatCard label="Awaiting approval" loading={!s} value={formatMoney(s?.pendingAmount)} hint={s && `${s.pendingCount} expenses`} tone="warn" />
        <StatCard label="Matching expenses" loading={!data} value={data?.meta.total ?? '—'} tone="navy" />
      </div>
      <Card flush>
        <div className="filters">
          <Field label="Status">
            {(id) => (
              <select id={id} className="select" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
                <option value="">Any</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            )}
          </Field>
          <Field label="Category">
            {(id) => (
              <select id={id} className="select" value={f.category} onChange={(e) => setF({ category: e.target.value })}>
                <option value="">Any</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            )}
          </Field>
          {can('scope.all_branches') && (
            <Field label="Branch">
              {(id) => <BranchSelect id={id} value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v) })} />}
            </Field>
          )}
          <Field label="From">{(id) => <input id={id} type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} />}</Field>
        </div>
        <DataTable columns={columns} rows={data?.data} rowKey={(e) => e.id} loading={loading} error={error} onRetry={reload}
          sort={f.sort} onSortChange={(sort) => setF({ sort })} emptyTitle="No expenses found" />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
      {creating && <ExpenseForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {reviewing && <ReviewDialog {...reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); reload(); }} />}
    </div>
  );
}

function ExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth();
  const [form, setForm] = useState({ branchId: '' as number | '', category: 'TRAVEL', amount: '', expenseDate: isoDate(), description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      await http.post('/expenses', { ...form, branchId: form.branchId === '' ? undefined : form.branchId, description: form.description || null });
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Submit expense" onClose={onClose}>
      <form onSubmit={onSubmit} noValidate className="stack">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="form-grid">
          <Field label="Branch" error={errors.branchId}>
            {(id) => <BranchSelect id={id} value={form.branchId} includeAll={!can('scope.all_branches')} onChange={(v) => setForm({ ...form, branchId: v })} />}
          </Field>
          <Field label="Category" error={errors.category}>
            {(id) => (
              <select id={id} className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Amount (₹)" error={errors.amount}>
            {(id) => <input id={id} className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />}
          </Field>
          <Field label="Date" error={errors.expenseDate}>
            {(id) => <input id={id} className="input" type="date" max={isoDate()} value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} required />}
          </Field>
          <Field label="Description" error={errors.description} className="span-2">
            {(id) => <textarea id={id} className="textarea" value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
          </Field>
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>Submit for approval</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewDialog({ expense, decision, onClose, onDone }: { expense: Expense; decision: 'approve' | 'reject'; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await http.post(`/expenses/${expense.id}/${decision}`, { note: note || null });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${decision === 'approve' ? 'Approve' : 'Reject'} expense`} onClose={onClose}>
      <div className="stack">
        <p>{labelize(expense.category)} · {expense.branchName} · <strong>{formatMoney(expense.amount)}</strong> · {formatDate(expense.expenseDate)}</p>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={decision === 'reject' ? 'Reason (required)' : 'Note (optional)'}>
          {(id) => <input id={id} className="input" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} autoFocus />}
        </Field>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={decision === 'approve' ? 'primary' : 'danger'} loading={busy}
            disabled={decision === 'reject' && !note.trim()} onClick={submit}>
            {decision === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
