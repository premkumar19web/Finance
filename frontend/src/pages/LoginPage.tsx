import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/context';
import { Alert, Button, Field } from '../components/ui';
import { errorMessage } from '../lib/errors';

export function LoginPage() {
  const { login, status, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">LF</div>
          <div className="brand-name">Lion Finance</div>
        </div>
        <div>
          <h1>Collections, loans and payments in one place.</h1>
          <p>Track every installment, record payments with printed receipts, and see branch and agent performance in real time.</p>
        </div>
        <p className="small">Authorised staff only. All activity is logged.</p>
      </section>

      <section className="login-panel">
        <form className="login-card stack" onSubmit={onSubmit} noValidate>
          <div>
            <h1>Sign in</h1>
            <p className="muted" style={{ marginTop: 4 }}>Use your staff email and password.</p>
          </div>
          {notice && notice !== error && <Alert tone="warning">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email">
            {(id) => (
              <input id={id} className="input" type="email" autoComplete="username" required autoFocus
                value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <input id={id} className="input" type="password" autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={submitting} disabled={!email || !password}>
            Sign in
          </Button>
          {import.meta.env.DEV && (
            <p className="muted small">
              Development demo accounts are listed in <code>SEED_DATA.md</code>.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
