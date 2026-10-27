import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth, useUser } from '../auth/context';
import { labelize } from '../lib/format';
import { Icon, type IconName } from './Icon';
import { Button } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown when the user has any of these permissions. */
  any: string[];
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', any: ['dashboard.view'] },
      { to: '/agent', label: 'Agent dashboard', icon: 'agent', any: ['collections.view'] },
    ],
  },
  {
    group: 'Lending',
    items: [
      { to: '/customers', label: 'Customers', icon: 'customers', any: ['customers.view'] },
      { to: '/loans', label: 'Loans', icon: 'loan', any: ['loans.view'] },
      { to: '/assignments', label: 'Assignments', icon: 'assign', any: ['assignments.view'] },
    ],
  },
  {
    group: 'Collections',
    items: [
      { to: '/collections/daily', label: 'Daily collections', icon: 'calendar', any: ['collections.view'] },
      { to: '/collections/weekly', label: 'Weekly collections', icon: 'week', any: ['collections.view'] },
      { to: '/payments/new', label: 'Record payment', icon: 'payment', any: ['payments.create'] },
      { to: '/payments', label: 'Payment history', icon: 'receipt', any: ['payments.view'] },
    ],
  },
  {
    group: 'Finance',
    items: [
      { to: '/expenses', label: 'Expenses', icon: 'expense', any: ['expenses.view'] },
      { to: '/reports', label: 'Reports', icon: 'report', any: ['reports.view'] },
    ],
  },
  {
    group: 'Administration',
    items: [
      { to: '/branches', label: 'Branches', icon: 'branch', any: ['branches.view'] },
      { to: '/users', label: 'Users', icon: 'users', any: ['users.view'] },
      { to: '/roles', label: 'Roles & permissions', icon: 'shield', any: ['roles.view'] },
      { to: '/audit-logs', label: 'Audit log', icon: 'audit', any: ['audit.view'] },
      { to: '/settings', label: 'Settings', icon: 'settings', any: ['settings.view'] },
    ],
  },
];

export function Layout() {
  const { can, logout } = useAuth();
  const user = useUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">LF</div>
          <div>
            <div className="brand-name">{user.config.companyName}</div>
            <div className="brand-sub">{user.branch ? user.branch.name : 'All branches'}</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((section) => {
            const items = section.items.filter((i) => can(...i.any));
            if (!items.length) return null;
            return (
              <div key={section.group}>
                <div className="nav-group">{section.group}</div>
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/' || item.to === '/payments'}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
                    <Icon name={item.icon} />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <Button variant="ghost" className="btn-icon menu-button" icon="menu" aria-label="Open menu" onClick={() => setOpen(true)} />
          <div className="topbar-spacer" />
          <NavLink to="/profile" className="user-chip" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="avatar" aria-hidden="true">{initials}</div>
            <div className="user-meta">
              <div className="name">{user.name}</div>
              <div className="role">{user.roles.map(labelize).join(', ')}</div>
            </div>
          </NavLink>
          <Button variant="ghost" icon="logout" onClick={onLogout}>Sign out</Button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
