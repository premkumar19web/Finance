import type { DailyTotal, DueInstallment, DueSummary, Paged } from '../../api/types';
import { useAuth } from '../../auth/context';
import { BarChart } from '../../components/BarChart';
import { Pagination } from '../../components/DataTable';
import { AgentSelect, BranchSelect } from '../../components/pickers';
import { Button, Card, Field, Money, PageHeader, StatCard } from '../../components/ui';
import { addDays, formatDate, formatMoney, formatNumber, isoDate, startOfWeek } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';
import { DueTable } from './DueTable';

const sum = (values: string[]) => values.reduce((s, v) => s + Number(v), 0);

export function WeeklyCollectionsPage() {
  const { can, user } = useAuth();
  const weekStartsOn = user?.config.weekStartsOn ?? 'MONDAY';
  const [f, setF] = useFilters({ week: startOfWeek(isoDate(), weekStartsOn), branchId: '', agentId: '', status: '', page: '1' });
  const from = startOfWeek(f.week, weekStartsOn);
  const to = addDays(from, 6);
  const agentOnly = !can('assignments.manage') && !can('scope.all_branches');

  const totals = useApi<{ data: DailyTotal[] }>('/collections/daily-totals', { from, to, branchId: f.branchId, agentId: f.agentId });
  const list = useApi<Paged<DueInstallment, DueSummary>>('/collections/due', {
    from, to, branchId: f.branchId, agentId: f.agentId, status: f.status, page: f.page, pageSize: 25,
  });
  const days = totals.data?.data;
  const due = days ? sum(days.map((d) => d.dueAmount)) : null;
  const collected = days ? sum(days.map((d) => d.collectedAmount)) : null;

  return (
    <div className="stack">
      <PageHeader title="Weekly collections" subtitle={`${formatDate(from)} – ${formatDate(to)}`}
        actions={<>
          <Button icon="chevron-left" onClick={() => setF({ week: addDays(from, -7) })}>Previous week</Button>
          <Button onClick={() => setF({ week: startOfWeek(isoDate(), weekStartsOn) })}>This week</Button>
          <Button onClick={() => setF({ week: addDays(from, 7) })}>Next week</Button>
        </>} />
      <div className="grid grid-4">
        <StatCard label="Due this week" loading={due === null} value={formatMoney(due ?? 0)} tone="navy" />
        <StatCard label="Collected this week" loading={collected === null} value={formatMoney(collected ?? 0)}
          hint={days && `${formatNumber(days.reduce((s, d) => s + d.paymentCount, 0))} payments`} />
        <StatCard label="Achievement" loading={due === null}
          value={due ? `${((collected ?? 0) / due * 100).toFixed(1)}%` : '—'} tone="warn" />
        <StatCard label="Overdue in week" loading={!list.data} value={list.data?.summary.overdueCount ?? '—'} tone="danger" />
      </div>
      <Card title="Day by day" actions={<div className="row no-print">
        {can('scope.all_branches') && <div style={{ width: 200 }}><BranchSelect value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v), agentId: '' })} /></div>}
        {!agentOnly && <div style={{ width: 240 }}><AgentSelect value={f.agentId ? Number(f.agentId) : ''} branchId={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ agentId: String(v) })} /></div>}
      </div>}>
        {days ? (
          <div className="grid grid-sidebar">
            <BarChart points={days.map((d) => ({ label: formatDate(d.day).split(' ').slice(0, 2).join(' '), due: Number(d.dueAmount), collected: Number(d.collectedAmount) }))} />
            <table className="table">
              <thead><tr><th>Day</th><th className="num">Due</th><th className="num">Collected</th></tr></thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <td>{new Date(`${d.day}T00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                    <td className="num"><Money value={d.dueAmount} /></td>
                    <td className="num"><Money value={d.collectedAmount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="skeleton" style={{ height: 190 }} />}
      </Card>
      <Card title="Installments due this week" flush actions={
        <select className="select" style={{ width: 180 }} aria-label="Status filter" value={f.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="">Any status</option>
          <option value="PENDING">Pending</option>
          <option value="PARTIAL">Partially paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="PAID">Paid</option>
        </select>
      }>
        <DueTable rows={list.data?.data} loading={list.loading} error={list.error} onRetry={list.reload} />
        <Pagination meta={list.data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
      <Field label="Jump to week containing" className="no-print">
        {(id) => <input id={id} type="date" className="input" style={{ maxWidth: 220 }} value={from} onChange={(e) => e.target.value && setF({ week: e.target.value })} />}
      </Field>
    </div>
  );
}
