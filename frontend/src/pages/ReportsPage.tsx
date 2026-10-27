import { useState } from 'react';
import { downloadFile } from '../api/client';
import type { Envelope, ReportColumnType, ReportResult } from '../api/types';
import { useAuth } from '../auth/context';
import { BranchSelect } from '../components/pickers';
import { Alert, Button, Card, ErrorState, Field, PageHeader } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, isoDate, labelize } from '../lib/format';
import { useApi } from '../lib/useApi';
import { useFilters } from '../lib/useFilters';

const REPORTS = [
  { key: 'collections', label: 'Collections (daily / weekly / monthly)' },
  { key: 'payments', label: 'Payment history' },
  { key: 'outstanding-loans', label: 'Outstanding loans' },
  { key: 'overdue-installments', label: 'Overdue installments' },
  { key: 'branch-performance', label: 'Branch performance' },
  { key: 'agent-performance', label: 'Agent performance' },
  { key: 'expenses', label: 'Expenses' },
];

function formatCell(value: unknown, type: ReportColumnType): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'money': return formatMoney(String(value));
    case 'number': return formatNumber(Number(value));
    case 'percent': return formatPercent(Number(value));
    case 'date': return formatDate(String(value));
    case 'datetime': return formatDateTime(String(value));
    default: return /^[A-Z_]+$/.test(String(value)) ? labelize(String(value)) : String(value);
  }
}

export function ReportsPage() {
  const { can } = useAuth();
  const today = isoDate();
  const [f, setF] = useFilters({ report: 'collections', from: `${today.slice(0, 8)}01`, to: today, branchId: '', groupBy: 'day' });
  const query = { from: f.from, to: f.to, branchId: f.branchId, groupBy: f.groupBy };
  const { data, error, loading, reload } = useApi<Envelope<ReportResult>>(`/reports/${f.report}`, query);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const r = data?.data;

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadFile(`/reports/${f.report}`, { ...query, format: 'csv' }, `${f.report}.csv`);
    } catch (err) {
      setExportError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Reports" subtitle="Figures are calculated directly from recorded transactions."
        actions={<>
          <Button icon="print" onClick={() => window.print()}>Print</Button>
          {can('reports.export') && <Button variant="primary" icon="download" loading={exporting} onClick={exportCsv}>Export CSV</Button>}
        </>} />
      {exportError && <Alert tone="error">{exportError}</Alert>}
      <Card flush>
        <div className="filters no-print">
          <Field label="Report" className="grow">
            {(id) => (
              <select id={id} className="select" value={f.report} onChange={(e) => setF({ report: e.target.value })}>
                {REPORTS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="From">{(id) => <input id={id} type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} />}</Field>
          {f.report === 'collections' && (
            <Field label="Group by">
              {(id) => (
                <select id={id} className="select" value={f.groupBy} onChange={(e) => setF({ groupBy: e.target.value })}>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              )}
            </Field>
          )}
          {can('scope.all_branches') && (
            <Field label="Branch">
              {(id) => <BranchSelect id={id} value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v) })} />}
            </Field>
          )}
        </div>
        {error && !r ? <ErrorState error={error} onRetry={reload} /> : (
          <>
            {r && (
              <div className="card-header">
                <div>
                  <h2>{r.title}</h2>
                  <p className="muted small">{formatDate(r.from)} – {formatDate(r.to)} · {formatNumber(r.rows.length)} rows</p>
                </div>
              </div>
            )}
            {r?.truncated && <div className="card-body"><Alert tone="warning">Only the first 5,000 rows are shown. Narrow the date range or export to CSV.</Alert></div>}
            <div className="table-wrap" aria-busy={loading}>
              <table className="table" style={{ opacity: loading ? 0.6 : 1 }}>
                <thead>
                  <tr>{r?.columns.map((c) => <th key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {r?.rows.map((row, i) => (
                    <tr key={i}>
                      {r.columns.map((c) => <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{formatCell(row[c.key], c.type)}</td>)}
                    </tr>
                  ))}
                </tbody>
                {r?.totals && r.rows.length > 0 && (
                  <tfoot>
                    <tr>{r.columns.map((c, i) => (
                      <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>
                        {i === 0 ? 'Total' : c.key in r.totals! ? formatCell(r.totals![c.key], c.type) : ''}
                      </td>
                    ))}</tr>
                  </tfoot>
                )}
              </table>
              {!r && loading && <div className="card-body"><div className="skeleton" /></div>}
              {r && !r.rows.length && <p className="empty">No data for this period.</p>}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
