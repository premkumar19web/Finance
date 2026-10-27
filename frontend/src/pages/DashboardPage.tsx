import { useState } from 'react';
import { Link } from 'react-router';
import type { DashboardSummary, Envelope } from '../api/types';
import { useAuth } from '../auth/context';
import { BarChart } from '../components/BarChart';
import { BranchSelect } from '../components/pickers';
import { Card, ErrorState, Money, PageHeader, Progress, StatCard, StatusBadge } from '../components/ui';
import { formatDate, formatDateTime, formatMoneyShort, formatNumber, formatPercent } from '../lib/format';
import { useApi } from '../lib/useApi';

export function DashboardPage() {
  const { can } = useAuth();
  const [branchId, setBranchId] = useState<number | ''>('');
  const { data, error, loading, reload } = useApi<Envelope<DashboardSummary>>('/dashboard/summary', {
    branchId: branchId || undefined,
  });
  const d = data?.data;

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        subtitle="Live figures from the loan book and today’s collections."
        actions={can('scope.all_branches') && (
          <div style={{ width: 220 }}><BranchSelect value={branchId} onChange={setBranchId} /></div>
        )}
      />
      {error && !d ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-4">
            <StatCard label="Active customers" loading={!d} value={formatNumber(d?.totalCustomers)} tone="navy" />
            <StatCard label="Active loans" loading={!d} value={formatNumber(d?.activeLoans)}
              hint={d ? `${formatNumber(d.pendingApprovals)} awaiting approval` : undefined} tone="navy" />
            <StatCard label="Total disbursed" loading={!d} value={formatMoneyShort(d?.totalDisbursed)} />
            <StatCard label="Outstanding balance" loading={!d} value={formatMoneyShort(d?.totalOutstanding)} />
            <StatCard label="Collected today" loading={!d} value={formatMoneyShort(d?.collectedToday)}
              hint={d ? `of ${formatMoneyShort(d.dueToday)} due today` : undefined} />
            <StatCard label="Collected this week" loading={!d} value={formatMoneyShort(d?.collectedThisWeek)} />
            <StatCard label="Overdue installments" loading={!d} value={formatNumber(d?.overdueInstallments)}
              hint={d ? `${formatMoneyShort(d.overdueAmount)} overdue` : undefined} tone="danger" />
            <StatCard label="Collection achievement (month)" loading={!d} tone="warn"
              value={d?.collectionAchievementPercent == null ? '—' : formatPercent(d.collectionAchievementPercent)}
              hint={d && <Progress percent={d.collectionAchievementPercent} />} />
          </div>

          <div className="grid grid-sidebar">
            <Card title="Collections — last 14 days">
              {d ? (
                <BarChart points={d.collectionTrend.map((t) => ({
                  label: formatDate(t.day).split(' ').slice(0, 2).join(' '),
                  collected: Number(t.collected),
                  due: Number(t.due),
                }))} />
              ) : <div className="skeleton" style={{ height: 190 }} />}
            </Card>
            <Card title="Recent payments" actions={<Link to="/payments">View all</Link>} flush>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {d?.recentPayments.map((p) => (
                  <li key={p.id} style={{ padding: '10px 18px', borderBottom: '1px solid var(--gray-100)' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <Link to={`/payments/${p.id}`}>{p.customerName}</Link>
                      <Money value={p.amount} />
                    </div>
                    <div className="row muted small" style={{ justifyContent: 'space-between' }}>
                      <span>{p.loanCode} · {formatDateTime(p.paymentDate)}</span>
                      {p.status !== 'RECORDED' && <StatusBadge status={p.status} />}
                    </div>
                  </li>
                ))}
                {d && !d.recentPayments.length && <li className="empty">No payments yet</li>}
                {!d && loading && <li className="card-body"><div className="skeleton" /></li>}
              </ul>
            </Card>
          </div>

          <div className="grid grid-3">
            <Card title="Upcoming installments (7 days)" flush>
              <table className="table">
                <tbody>
                  {d?.upcomingInstallments.map((u) => (
                    <tr key={u.id}>
                      <td><Link to={`/loans/${u.loanId}`}>{u.loanCode}</Link><div className="muted small">{u.customerName}</div></td>
                      <td className="nowrap">{formatDate(u.dueDate)}</td>
                      <td className="num"><Money value={u.outstandingAmount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d && !d.upcomingInstallments.length && <p className="empty">Nothing due in the next week</p>}
            </Card>
            <Card title="Top agents this month" flush>
              <table className="table">
                <tbody>
                  {d?.agentPerformance.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}<div className="muted small">{a.branchName ?? '—'}</div></td>
                      <td className="num">{formatNumber(a.payments)} pmts</td>
                      <td className="num"><Money value={a.collected} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d && !d.agentPerformance.length && <p className="empty">No collections this month</p>}
            </Card>
            <Card title="Branch performance (month)" flush>
              <table className="table">
                <thead><tr><th>Branch</th><th className="num">Collected</th><th className="num">Overdue</th></tr></thead>
                <tbody>
                  {d?.branchPerformance.map((b) => (
                    <tr key={b.id}>
                      <td>{b.branchName}</td>
                      <td className="num">{formatMoneyShort(b.collectedThisMonth)}</td>
                      <td className="num danger-text">{formatMoneyShort(b.overdue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
