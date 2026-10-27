import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { formatMoney, labelize } from '../lib/format';
import { Icon, type IconName } from './Icon';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant = 'secondary',
  size,
  icon,
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm'; icon?: IconName; loading?: boolean }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

const TONES: Record<string, string> = {
  ACTIVE: 'green', PAID: 'green', APPROVED: 'green', RECORDED: 'green', CLOSED: 'blue',
  PENDING: 'amber', PARTIAL: 'violet', OVERDUE: 'red', DEFAULTED: 'red', REJECTED: 'red', REVERSED: 'red',
  WAIVED: 'gray', ENDED: 'gray', INACTIVE: 'gray', LOCKED: 'red',
};

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Colored badge for a status code such as ACTIVE, OVERDUE or REVERSED. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <Badge tone={TONES[status] ?? 'gray'}>{labelize(status)}</Badge>;
}

export function Money({ value, className = '' }: { value: string | number | null | undefined; className?: string }) {
  return <span className={`num ${className}`}>{formatMoney(value)}</span>;
}

export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone = 'accent', loading }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'accent' | 'warn' | 'danger' | 'navy'; loading?: boolean;
}) {
  return (
    <div className={`card stat ${tone}`}>
      <span className="stat-label">{label}</span>
      {loading ? <div className="skeleton" style={{ height: 28, width: '60%' }} /> : <span className="stat-value">{value}</span>}
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions no-print">{actions}</div>}
    </header>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <span className="spinner" role="status">{label}</span>;
}

export function EmptyState({ icon = 'inbox', title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

/** Shows an API failure clearly, with a retry button when possible. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'Something went wrong while loading this data.';
  return (
    <div className="empty" role="alert">
      <div className="empty-icon" style={{ color: 'var(--red-600)', background: 'var(--red-100)' }}><Icon name="alert" /></div>
      <h3>Couldn’t load data</h3>
      <p>{message}</p>
      {onRetry && <Button icon="refresh" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  return <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Field({ label, error, hint, children, className = '' }: {
  label: string; error?: string | undefined; hint?: string; children: (id: string) => ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <Button variant="ghost" className="btn-icon" icon="x" aria-label="Close" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={t.value === value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ percent }: { percent: number | null }) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className="progress" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${p}%` }} />
    </div>
  );
}
