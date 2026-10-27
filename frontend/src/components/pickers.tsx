// Dropdowns and search boxes that load their options from the API.
import { useState } from 'react';
import type { Agent, Branch, Customer, Loan, Paged } from '../api/types';
import { useAuth } from '../auth/context';
import { formatMoney } from '../lib/format';
import { useApi, useDebounced } from '../lib/useApi';

/** Branch dropdown; only shown to users who can see every branch. */
export function BranchSelect({ id, value, onChange, includeAll = true, required }: {
  id?: string; value: number | ''; onChange: (v: number | '') => void; includeAll?: boolean; required?: boolean;
}) {
  const { can, user } = useAuth();
  const allBranches = can('scope.all_branches');
  const { data } = useApi<Paged<Branch>>(allBranches ? '/branches' : null, { pageSize: 100, isActive: true, sort: 'name' });
  if (!allBranches) {
    return <input id={id} className="input" value={user?.branch?.name ?? 'Your branch'} disabled readOnly />;
  }
  return (
    <select id={id} className="select" value={value} required={required}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">{includeAll ? 'All branches' : 'Select a branch…'}</option>
      {data?.data.map((b) => <option key={b.id} value={b.id}>{b.branchName}</option>)}
    </select>
  );
}

export function AgentSelect({ id, value, onChange, branchId, placeholder = 'All agents' }: {
  id?: string; value: number | ''; onChange: (v: number | '') => void; branchId?: number | ''; placeholder?: string;
}) {
  const { data, loading } = useApi<{ data: Agent[] }>('/assignments/agents', { branchId: branchId || undefined });
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
      <option value="">{loading ? 'Loading agents…' : placeholder}</option>
      {data?.data.map((a) => (
        <option key={a.id} value={a.id}>{a.name} — {a.branchName} ({a.activeLoans} loans)</option>
      ))}
    </select>
  );
}

interface SearchPickerProps<T> {
  id?: string;
  placeholder: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  render: (item: T) => { title: string; meta?: string };
  onSelect: (item: T) => void;
}

/** Type-to-search box backed by a paged API list. */
function SearchPicker<T extends { id: number }>({ id, placeholder, path, query, render, onSelect }: SearchPickerProps<T>) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const search = useDebounced(text.trim(), 300);
  const { data, loading } = useApi<Paged<T>>(open && search.length >= 2 ? path : null, { ...query, search, pageSize: 10 });
  const items = search.length >= 2 ? data?.data ?? [] : [];

  return (
    <div className="combo">
      <input id={id} className="input" placeholder={placeholder} value={text} autoComplete="off"
        role="combobox" aria-expanded={open && items.length > 0}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && search.length >= 2 && (
        <ul className="combo-list" role="listbox">
          {loading && !items.length && <li className="combo-item muted">Searching…</li>}
          {!loading && !items.length && <li className="combo-item muted">No matches</li>}
          {items.map((item) => {
            const r = render(item);
            return (
              <li key={item.id} className="combo-item" role="option" aria-selected={false}
                onMouseDown={(e) => { e.preventDefault(); onSelect(item); setText(''); setOpen(false); }}>
                <span>{r.title}</span>
                {r.meta && <span className="muted small">{r.meta}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function LoanPicker({ id, onSelect, statuses = 'ACTIVE' }: { id?: string; onSelect: (loan: Loan) => void; statuses?: string }) {
  return (
    <SearchPicker<Loan>
      id={id}
      placeholder="Search loan code, customer name or phone…"
      path="/loans"
      query={{ status: statuses }}
      render={(l) => ({ title: `${l.loanCode} · ${l.customerName}`, meta: `${formatMoney(l.outstandingBalance)} due` })}
      onSelect={onSelect}
    />
  );
}

export function CustomerPicker({ id, onSelect }: { id?: string; onSelect: (c: Customer) => void }) {
  return (
    <SearchPicker<Customer>
      id={id}
      placeholder="Search customer name, code or phone…"
      path="/customers"
      query={{ isActive: true }}
      render={(c) => ({ title: `${c.fullName} (${c.customerCode})`, meta: c.branchName })}
      onSelect={onSelect}
    />
  );
}
