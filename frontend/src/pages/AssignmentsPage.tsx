import { useState } from 'react';
import { Link } from 'react-router';
import { http } from '../api/client';
import type { Assignment, Loan, Paged } from '../api/types';
import { useAuth } from '../auth/context';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { AgentSelect, BranchSelect, LoanPicker } from '../components/pickers';
import { SearchInput } from '../components/SearchInput';
import { Alert, Button, Card, Field, Modal, Money, PageHeader, StatusBadge } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useFilters } from '../lib/useFilters';

export function AssignmentsPage() {
  const { can } = useAuth();
  const manage = can('assignments.manage');
  const [assigning, setAssigning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [f, setF] = useFilters({ search: '', active: 'true', branchId: '', agentId: '', sort: '', page: '1' });
  const { data, error, loading, reload } = useApi<Paged<Assignment>>('/assignments', { ...f, pageSize: 25 });

  const end = async (a: Assignment) => {
    if (!window.confirm(`End ${a.agentName}'s assignment on ${a.loanCode}?`)) return;
    setActionError(null);
    try {
      await http.post(`/assignments/${a.id}/end`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const columns: Column<Assignment>[] = [
    { key: 'loan', header: 'Loan', sortKey: 'loan', render: (a) => <><Link to={`/loans/${a.loanId}`} className="mono">{a.loanCode}</Link> <StatusBadge status={a.loanStatus} /></> },
    { key: 'customer', header: 'Customer', sortKey: 'customer', render: (a) => <>{a.customerName}<div className="muted small">{a.branchName}</div></> },
    { key: 'agent', header: 'Agent', sortKey: 'agent', render: (a) => a.agentName },
    { key: 'outstanding', header: 'Outstanding', align: 'right', render: (a) => <Money value={a.outstandingBalance} /> },
    { key: 'from', header: 'Assigned', sortKey: 'assignedAt', render: (a) => <>{formatDateTime(a.assignedAt)}<div className="muted small">by {a.assignedByName ?? '—'}</div></> },
    { key: 'until', header: 'Ended', render: (a) => formatDateTime(a.unassignedAt) },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    ...(manage ? [{ key: 'act', header: '', render: (a: Assignment) => a.status === 'ACTIVE' && <Button size="sm" onClick={() => end(a)}>End</Button> }] : []),
  ];

  return (
    <div className="stack">
      <PageHeader title="Collection assignments" subtitle="Which agent collects each loan. Reassigning keeps the full history."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setAssigning(true)}>Assign agent</Button>} />
      {actionError && <Alert tone="error">{actionError}</Alert>}
      <Card flush>
        <div className="filters">
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="Loan, customer or agent" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
          <Field label="Show">
            {(id) => (
              <select id={id} className="select" value={f.active} onChange={(e) => setF({ active: e.target.value })}>
                <option value="true">Current</option>
                <option value="false">Ended</option>
                <option value="">All history</option>
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
        <DataTable columns={columns} rows={data?.data} rowKey={(a) => a.id} loading={loading} error={error} onRetry={reload}
          sort={f.sort} onSortChange={(sort) => setF({ sort })} emptyTitle="No assignments found" />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
      {assigning && <AssignDialog onClose={() => setAssigning(false)} onDone={() => { setAssigning(false); reload(); }} />}
    </div>
  );
}

function AssignDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [loan, setLoan] = useState<Loan | null>(null);
  const [agentId, setAgentId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!loan || !agentId) return;
    setBusy(true);
    setError(null);
    try {
      await http.post('/assignments', { loanId: loan.id, agentId, notes: notes || null });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Assign collection agent" onClose={onClose}>
      <div className="stack">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Loan">
          {(id) => loan
            ? <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><span className="mono">{loan.loanCode}</span> · {loan.customerName} · current agent: {loan.agent?.name ?? 'none'}</span>
                <Button size="sm" onClick={() => setLoan(null)}>Change</Button>
              </div>
            : <LoanPicker id={id} onSelect={setLoan} />}
        </Field>
        <Field label="Agent" hint="Agents from the loan’s branch">
          {(id) => <AgentSelect id={id} value={agentId} onChange={setAgentId} branchId={loan?.branchId ?? ''} placeholder="Select an agent…" />}
        </Field>
        <Field label="Notes (optional)">
          {(id) => <input id={id} className="input" value={notes} maxLength={255} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!loan || !agentId} onClick={submit}>Assign</Button>
        </div>
      </div>
    </Modal>
  );
}
