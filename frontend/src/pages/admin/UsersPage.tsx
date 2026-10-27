import { useState, type FormEvent } from 'react';
import { http } from '../../api/client';
import type { Paged, Role, User } from '../../api/types';
import { useAuth } from '../../auth/context';
import { DataTable, Pagination, type Column } from '../../components/DataTable';
import { BranchSelect } from '../../components/pickers';
import { SearchInput } from '../../components/SearchInput';
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { errorMessage, fieldErrors } from '../../lib/errors';
import { formatDateTime, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';
import { useFilters } from '../../lib/useFilters';

export function UsersPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [f, setF] = useFilters({ search: '', role: '', branchId: '', isActive: 'true', sort: '', page: '1' });
  const { data, error, loading, reload } = useApi<Paged<User>>('/users', { ...f, pageSize: 25 });
  const roles = useApi<{ data: Role[] }>('/roles');
  const manage = can('users.manage');

  const columns: Column<User>[] = [
    { key: 'name', header: 'Name', sortKey: 'name', render: (u) => <><strong>{u.name}</strong><div className="muted small">{u.email}</div></> },
    { key: 'roles', header: 'Roles', render: (u) => <div className="row" style={{ gap: 4 }}>{u.roles.map((r) => <Badge key={r} tone="teal">{labelize(r)}</Badge>)}</div> },
    { key: 'branch', header: 'Branch', sortKey: 'branch', render: (u) => u.branchName ?? <span className="muted">All branches</span> },
    { key: 'phone', header: 'Phone', render: (u) => u.phone ?? '—' },
    { key: 'login', header: 'Last sign-in', sortKey: 'lastLogin', render: (u) => formatDateTime(u.lastLoginAt) },
    { key: 'status', header: 'Status', render: (u) => <>{<StatusBadge status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />} {u.isLocked && <StatusBadge status="LOCKED" />}</> },
    ...(manage ? [{ key: 'act', header: '', render: (u: User) => (
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" onClick={() => setEditing(u)}>Edit</Button>
        <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>Reset password</Button>
      </div>
    ) }] : []),
  ];

  return (
    <div className="stack">
      <PageHeader title="Users" subtitle="Staff accounts, their roles and branch."
        actions={manage && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New user</Button>} />
      <Card flush>
        <div className="filters">
          <Field label="Search" className="grow">
            {(id) => <SearchInput id={id} placeholder="Name, email or phone" value={f.search} onChange={(search) => setF({ search })} />}
          </Field>
          <Field label="Role">
            {(id) => (
              <select id={id} className="select" value={f.role} onChange={(e) => setF({ role: e.target.value })}>
                <option value="">Any role</option>
                {roles.data?.data.map((r) => <option key={r.id} value={r.roleName}>{r.displayName}</option>)}
              </select>
            )}
          </Field>
          {can('scope.all_branches') && (
            <Field label="Branch">
              {(id) => <BranchSelect id={id} value={f.branchId ? Number(f.branchId) : ''} onChange={(v) => setF({ branchId: String(v) })} />}
            </Field>
          )}
          <Field label="Status">
            {(id) => (
              <select id={id} className="select" value={f.isActive} onChange={(e) => setF({ isActive: e.target.value })}>
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            )}
          </Field>
        </div>
        <DataTable columns={columns} rows={data?.data} rowKey={(u) => u.id} loading={loading} error={error} onRetry={reload}
          sort={f.sort} onSortChange={(sort) => setF({ sort })} emptyTitle="No users found" />
        <Pagination meta={data?.meta} onPage={(p) => setF({ page: String(p) })} />
      </Card>
      {editing && roles.data && (
        <UserForm user={editing === 'new' ? undefined : editing} roles={roles.data.data}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} onDone={() => { setResetting(null); reload(); }} />}
    </div>
  );
}

function UserForm({ user, roles, onClose, onSaved }: { user?: User; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '',
    branchId: (user?.branchId ?? '') as number | '', roles: user?.roles ?? [], isActive: user?.isActive ?? true, password: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const toggleRole = (role: string) =>
    setForm((f) => ({ ...f, roles: f.roles.includes(role) ? f.roles.filter((r) => r !== role) : [...f.roles, role] }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setErrors({});
    const branchId = form.branchId === '' ? null : form.branchId;
    try {
      if (user) {
        await http.patch(`/users/${user.id}`, { name: form.name, phone: form.phone, branchId, roles: form.roles, isActive: form.isActive });
      } else {
        await http.post('/users', { name: form.name, email: form.email, phone: form.phone, branchId, roles: form.roles, password: form.password });
      }
      onSaved();
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={user ? `Edit ${user.name}` : 'New user'} onClose={onClose} wide>
      <form onSubmit={onSubmit} noValidate className="stack">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="form-grid">
          <Field label="Full name" error={errors.name}>
            {(id) => <input id={id} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />}
          </Field>
          <Field label="Email" error={errors.email}>
            {(id) => <input id={id} className="input" type="email" value={form.email} disabled={!!user}
              onChange={(e) => setForm({ ...form, email: e.target.value })} required />}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(id) => <input id={id} className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
          </Field>
          <Field label="Branch" error={errors.branchId} hint="Leave empty for head-office staff who work across branches">
            {(id) => <BranchSelect id={id} value={form.branchId} includeAll={false} onChange={(v) => setForm({ ...form, branchId: v })} />}
          </Field>
          {!user && (
            <Field label="Initial password" error={errors.password} hint="At least 10 characters with a letter and a number" className="span-2">
              {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} required />}
            </Field>
          )}
          <fieldset className="span-2" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field" style={{ fontWeight: 600, fontSize: '0.83rem', marginBottom: 6 }}>Roles</legend>
            <div className="perm-grid">
              {roles.map((r) => (
                <label key={r.id} className="checkbox">
                  <input type="checkbox" checked={form.roles.includes(r.roleName)} onChange={() => toggleRole(r.roleName)} />
                  <span><strong>{r.displayName}</strong><span className="muted small"> — {r.description}</span></span>
                </label>
              ))}
            </div>
            {errors.roles && <span className="error small">{errors.roles}</span>}
          </fieldset>
          {user && (
            <label className="checkbox span-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Account is active (deactivating signs the user out everywhere)
            </label>
          )}
        </div>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!form.roles.length}>{user ? 'Save changes' : 'Create user'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await http.post(`/users/${user.id}/reset-password`, { newPassword: password });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Reset password for ${user.name}`} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Alert tone="info">The user is signed out everywhere and any lockout is cleared. Share the new password securely.</Alert>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="New password" hint="At least 10 characters with a letter and a number">
          {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}
        </Field>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!password}>Reset password</Button>
        </div>
      </form>
    </Modal>
  );
}
