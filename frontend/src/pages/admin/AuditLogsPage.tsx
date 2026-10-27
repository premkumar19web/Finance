import type { AuditLog, Paged } from '../../api/types';
import { DataTable, Pagination, type Column } from '../../components/DataTable';
import { SearchInput } from '../../components/SearchInput';
import { Badge, Card, Field, PageHeader } from '../../components/ui';
import { formatDateTime, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';

const ENTITY_TYPES = ['user', 'customer', 'loan', 'payment', 'expense', 'branch', 'role', 'setting', 'report'];

function tone(action: string): string {
  if (/FAILED|REVERSED|REJECTED|DEACTIVATED|DEFAULTED/.test(action)) return 'red';
  if (/CREATED|APPROVED|DISBURSED|RECORDED/.test(action)) return 'green';
  if (/LOGIN|LOGOUT/.test(action)) return 'blue';
  return 'gray';
}

const COLUMNS: Column<AuditLog>[] = [
  { key: 'when', header: 'When', render: (a) => <span className="nowrap">{formatDateTime(a.createdAt)}</span> },
  { key: 'who', header: 'User', render: (a) => a.userName ?? <span className="muted">System</span> },
  { key: 'action', header: 'Action', render: (a) => <Badge tone={tone(a.action)}>{labelize(a.action)}</Badge> },
  { key: 'entity', header: 'Record', render: (a) => `${labelize(a.entityType)}${a.entityId ? ` #${a.entityId}` : ''}` },
  { key: 'details', header: 'Details', render: (a) => a.details ? (
    <span className="small muted" style={{ display: 'block', maxWidth: 480, overflowWrap: 'anywhere' }}>
      {Object.entries(a.details).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}
    </span>
  ) : '' },
  { key: 'ip', header: 'IP', render: (a) => <span className="mono">{a.ipAddress ?? ''}</span> },
];

export function AuditLogsPage() {
  const [f, setF] = useFilters({ search: '', action: '', entityType: '', from: '', to: '', page: '1' });
  const { data, error, loading, reload } = useApi<Paged<AuditLog>>('/audit-logs', { ...f, pageSize: 50 });
  const actions = useApi<{ data: string[] }>('/audit-logs/actions');

  return (
    <div className="stack">
      <PageHeader title="Audit log" subtitle="Who did what, and when. Entries cannot be edited or deleted from the application." />
      <Card flush>
        <div className="filters">
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="User, action or details" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
          <Field label="Action">
            {(id) => (
              <select id={id} className="select" value={f.action} onChange={(e) => setF({ action: e.target.value })}>
                <option value="">Any</option>
                {actions.data?.data.map((a) => <option key={a} value={a}>{labelize(a)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Record type">
            {(id) => (
              <select id={id} className="select" value={f.entityType} onChange={(e) => setF({ entityType: e.target.value })}>
                <option value="">Any</option>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{labelize(t)}</option>)}
              </select>
            )}
          </Field>
          <Field label="From">{(id) => <input id={id} type="date" className="input" value={f.from} onChange={(e) => setF({ from: e.target.value })} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className="input" value={f.to} onChange={(e) => setF({ to: e.target.value })} />}</Field>
        </div>
        <DataTable columns={COLUMNS} rows={data?.data} rowKey={(a) => a.id} loading={loading} error={error} onRetry={reload}
          emptyTitle="No audit entries match" />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
    </div>
  );
}
