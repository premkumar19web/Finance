import { useState } from 'react';
import { Link } from 'react-router';
import type { AgentSummary, DueInstallment, DueSummary, Envelope, Paged } from '../../api/types';
import { useAuth } from '../../auth/context';
import { Pagination } from '../../components/DataTable';
import { AgentSelect } from '../../components/pickers';
import { Card, EmptyState, ErrorState, Money, PageHeader, StatCard, StatusBadge } from '../../components/ui';
import { formatDateTime, formatMoney, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { DueTable } from './DueTable';

export function AgentDashboardPage() {
  const { can, user } = useAuth();
  const supervisor = can('assignments.manage') || can('scope.all_branches');
  const [agentId, setAgentId] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const viewingSelf = !supervisor || agentId === '';
  const needsChoice = supervisor && agentId === '' && !user?.roles.includes('COLLECTION_AGENT');

  const summary = useApi<Envelope<AgentSummary>>(needsChoice ? null : '/collections/agent-summary', { agentId: agentId || undefined });
  const due = useApi<Paged<DueInstallment, DueSummary>>(needsChoice ? null : '/collections/due', {
    agentId: viewingSelf ? user?.id : agentId, includeArrears: true, page, pageSize: 20,
  });
  const s = summary.data?.data;

  return (
    <div className="stack">
      <PageHeader title={s ? `${s.agent.name}’s collections` : 'Agent dashboard'}
        subtitle={s?.agent.branchName ?? 'Today’s route, arrears and recent receipts.'}
        actions={supervisor && <div style={{ width: 300 }}><AgentSelect value={agentId} onChange={(v) => { setAgentId(v); setPage(1); }} placeholder="Choose an agent…" /></div>} />

      {needsChoice ? (
        <Card><EmptyState icon="agent" title="Choose an agent" message="Pick a collection agent above to see their route and performance." /></Card>
      ) : summary.error && !s ? (
        <ErrorState error={summary.error} onRetry={summary.reload} />
      ) : (
        <>
          <div className="grid grid-4">
            <StatCard label="Due today" loading={!s} value={formatMoney(s?.dueTodayAmount)} hint={s && `${s.dueTodayCount} installments · ${formatMoney(s.dueTodayRemaining)} left`} tone="navy" />
            <StatCard label="Collected today" loading={!s} value={formatMoney(s?.collectedToday)} hint={s && `${s.paymentsToday} receipts`} />
            <StatCard label="Overdue" loading={!s} value={formatMoney(s?.overdueAmount)} hint={s && `${s.overdueCount} installments`} tone="danger" />
            <StatCard label="Collected this month" loading={!s} value={formatMoney(s?.collectedThisMonth)}
              hint={s && `${s.assignedLoans} loans · ${formatMoney(s.portfolioOutstanding)} portfolio`} tone="warn" />
          </div>
          <Card title="Route: due today and arrears" flush>
            <DueTable rows={due.data?.data} loading={due.loading} error={due.error} onRetry={due.reload} />
            <Pagination meta={due.data?.meta} onPage={setPage} />
          </Card>
          <Card title="Recent receipts" flush>
            <table className="table">
              <tbody>
                {s?.recentPayments.map((p) => (
                  <tr key={p.id}>
                    <td><Link to={`/payments/${p.id}`} className="mono">{p.receiptNumber}</Link></td>
                    <td>{p.customerName}<div className="muted small">{p.loanCode}</div></td>
                    <td>{formatDateTime(p.paymentDate)}</td>
                    <td>{labelize(p.paymentMethod)}</td>
                    <td className="num"><Money value={p.amount} /></td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s && !s.recentPayments.length && <EmptyState title="No receipts yet" />}
          </Card>
        </>
      )}
    </div>
  );
}
