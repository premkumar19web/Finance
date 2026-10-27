import type { ReactNode } from 'react';
import type { PageMeta } from '../api/types';
import { formatNumber } from '../lib/format';
import { Icon } from './Icon';
import { Button, EmptyState, ErrorState } from './ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Server sort key; makes the header clickable. */
  sortKey?: string;
  align?: 'right';
  width?: number | string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
  sort?: string;
  onSortChange?: (sort: string) => void;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}

export function DataTable<T>({
  columns, rows, rowKey, loading, error, onRetry, emptyTitle = 'Nothing here yet', emptyMessage,
  sort, onSortChange, onRowClick, footer,
}: Props<T>) {
  if (error && !rows?.length) return <ErrorState error={error} onRetry={onRetry} />;

  const sortDesc = sort?.startsWith('-');
  const sortField = sort?.replace(/^-/, '');
  const showSkeleton = loading && !rows;

  return (
    <div className="table-wrap" aria-busy={loading}>
      <table className="table" style={{ opacity: loading && rows ? 0.6 : 1 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''} style={c.width ? { width: c.width } : undefined}
                aria-sort={c.sortKey && c.sortKey === sortField ? (sortDesc ? 'descending' : 'ascending') : undefined}>
                {c.sortKey && onSortChange ? (
                  <button className="sort-button" onClick={() => onSortChange(sortField === c.sortKey && !sortDesc ? `-${c.sortKey}` : c.sortKey!)}>
                    {c.header}
                    {sortField === c.sortKey && <Icon name={sortDesc ? 'arrow-down' : 'arrow-up'} size={12} />}
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showSkeleton &&
            Array.from({ length: 6 }, (_, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key}><div className="skeleton" /></td>)}</tr>
            ))}
          {rows?.map((row) => (
            <tr key={rowKey(row)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
      {!loading && rows && rows.length === 0 && <EmptyState title={emptyTitle} message={emptyMessage} />}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta: PageMeta | undefined; onPage: (page: number) => void }) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.total, meta.page * meta.pageSize);
  return (
    <div className="pagination">
      <span>Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(meta.total)}</span>
      <div className="row">
        <Button size="sm" icon="chevron-left" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <span>Page {meta.page} of {meta.totalPages}</span>
        <Button size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          Next <Icon name="chevron-right" size={14} />
        </Button>
      </div>
    </div>
  );
}
