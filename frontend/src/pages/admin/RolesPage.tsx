import { useState } from 'react';
import { http } from '../../api/client';
import type { Permission, Role } from '../../api/types';
import { useAuth } from '../../auth/context';
import { Alert, Button, Card, ErrorState, PageHeader, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { useApi } from '../../lib/useApi';

export function RolesPage() {
  const { can, refresh } = useAuth();
  const roles = useApi<{ data: Role[] }>('/roles');
  const perms = useApi<{ data: Permission[] }>('/roles/permissions');

  if (roles.error || perms.error) return <ErrorState error={roles.error ?? perms.error} onRetry={() => { roles.reload(); perms.reload(); }} />;
  if (!roles.data || !perms.data) return <Spinner />;

  // Group permission codes by area ("loans.approve" → "loans").
  const groups = new Map<string, Permission[]>();
  for (const p of perms.data.data) {
    const area = p.permissionCode.split('.')[0]!;
    groups.set(area, [...(groups.get(area) ?? []), p]);
  }

  return (
    <div className="stack">
      <PageHeader title="Roles & permissions"
        subtitle="What each role may do. The server enforces these on every request; hiding a menu item is not the protection." />
      {roles.data.data.map((role) => (
        <RoleCard key={role.id} role={role} groups={groups} editable={can('roles.manage') && role.roleName !== 'ADMIN'}
          onSaved={() => { roles.reload(); void refresh(); }} />
      ))}
    </div>
  );
}

function RoleCard({ role, groups, editable, onSaved }: {
  role: Role; groups: Map<string, Permission[]>; editable: boolean; onSaved: () => void;
}) {
  const [selected, setSelected] = useState(new Set(role.permissions));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const dirty = selected.size !== role.permissions.length || role.permissions.some((p) => !selected.has(p));

  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSelected(next);
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await http.put(`/roles/${role.id}/permissions`, { permissionCodes: [...selected] });
      setMessage({ tone: 'success', text: 'Permissions saved. Users get them on their next request.' });
      onSaved();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={<div><h2>{role.displayName}</h2><p className="muted small">{role.description} · {role.activeUsers} active users</p></div>}
      actions={editable && (
        <>
          {dirty && <Button size="sm" onClick={() => { setSelected(new Set(role.permissions)); setMessage(null); }}>Undo</Button>}
          <Button size="sm" variant="primary" loading={saving} disabled={!dirty} onClick={save}>Save</Button>
        </>
      )}>
      <div className="stack">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {!editable && role.roleName === 'ADMIN' && <p className="muted small">The Administrator role always has every permission.</p>}
        <div className="perm-grid">
          {[...groups.entries()].map(([area, list]) => (
            <div key={area}>
              <div className="nav-group" style={{ color: 'var(--gray-500)', margin: '4px 0' }}>{area}</div>
              {list.map((p) => (
                <label key={p.id} className="checkbox" style={{ display: 'flex', marginBottom: 4 }} title={p.permissionCode}>
                  <input type="checkbox" checked={selected.has(p.permissionCode)} disabled={!editable} onChange={() => toggle(p.permissionCode)} />
                  {p.description}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
