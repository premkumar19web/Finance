import type { DueInstallment, DueSummary, Paged } from '../../api/types';
import { useAuth } from '../../auth/context';
import { Pagination } from '../../components/DataTable';
import { AgentSelect, BranchSelect } from '../../components/pickers';
import { SearchInput } from '../../components/SearchInput';
import { Card, Field, PageHeader, StatCard } from '../../components/ui';
import { formatDate, formatMoney, isoDate } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';
import { DueTable } from './DueTable';

export function DailyCollectionsPage() {
  const { can } = useAuth();
  const [f, setF] = useFilters({
    date: isoDate(), includeArrears: 'true', status: '', branchId: '', agentId: '', search: '', sort: '', page: '1',
  });
  const { data, error, loading, reload } = useApi<Paged<DueInstallment, DueSummary>>('/collections/due', {
    from: f.date, to: f.date, includeArrears: f.includeArrears === 'true', status: f.status, branchId: f.branchId,
    agentId: f.agentId, search: f.search, sort: f.sort, page: f.page, pageSize: 25,
  });
  const s = data?.summary;
  const agentOnly = !can('assignments.manage') && !can('scope.all_branches');

  return (
    <div className="stack">
      <PageHeader title="Daily collections" subtitle={`Installments due on ${formatDate(f.date)}${f.includeArrears === 'true' ? ', plus earlier unpaid ones' : ''}.`}
        actions={<button className="btn btn-secondary" onClick={() => window.print()}>Print list</button>} />
      <div className="grid grid-4">
        <StatCard label="Due" loading={!s} value={formatMoney(s?.dueAmount)} hint={s && `${s.installments} installments`} tone="navy" />
        <StatCard label="Collected against these" loading={!s} value={formatMoney(s?.paidAmount)} hint={s && `${s.paidCount} fully paid`} />
        <StatCard label="Still to collect" loading={!s} value={formatMoney(s?.outstandingAmount)} hint={s && `${s.pendingCount + s.partialCount} open`} tone="warn" />
        <StatCard label="Overdue" loading={!s} value={s?.overdueCount ?? '—'} tone="danger" />
      </div>
      <Card flush>
        <div className="filters no-print">
          <Field label="Date">
            {(id) => <input id={id} type="date" className="input" value={f.date} onChange={(e) => setF({ date: e.target.value || isoDate() })} />}
          </Field>
          <Field label="Show">
            {(id) => (
              <select id={id} className="select" value={f.includeArrears} onChange={(e) => setF({ includeArrears: e.target.value })}>
                <option value="true">Due + arrears</option>
                <option value="false">Due this day only</option>
              </select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <select id={id} className="select" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
                <option value="">Any</option>
                <option value="PENDING">Pending</option>
                <option value="PARTIAL">Partially paid</option>
                <option value="OVERDUE">Overdue</option>
                <option value="PAID">Paid</option>
              </select>
            )}
          </Field>
          {can('scope.all_branches') && (
            <Field label="Branch">
              {(id) => <BranchSelect id={id} value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v), agentId: '' })} />}
            </Field>
          )}
          {!agentOnly && (
            <Field label="Agent">
              {(id) => <AgentSelect id={id} value={f.agentId ? Number(f.agentId) : ''} branchId={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ agentId: String(v) })} />}
            </Field>
          )}
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="Customer, loan or phone" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
        </div>
        <DueTable rows={data?.data} loading={loading} error={error} onRetry={reload} sort={f.sort} onSortChange={(sort) => setF({ sort })} />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
    </div>
  );
}
