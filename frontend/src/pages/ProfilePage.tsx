import { useState, type FormEvent } from 'react';
import { http } from '../api/client';
import { useAuth, useUser } from '../auth/context';
import { Alert, Badge, Button, Card, Field, PageHeader } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/errors';
import { formatDateTime, labelize } from '../lib/format';

export function ProfilePage() {
  const user = useUser();
  const { refresh } = useAuth();
  const [profile, setProfile] = useState({ name: user.name, phone: user.phone ?? '' });
  const [profileMsg, setProfileMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwMsg, setPwMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      await http.patch('/auth/me', profile);
      await refresh();
      setProfileMsg({ tone: 'success', text: 'Profile updated.' });
    } catch (err) {
      setProfileMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    setPwErrors({});
    if (pw.newPassword !== pw.confirm) return setPwErrors({ confirm: 'Passwords do not match' });
    setSavingPw(true);
    try {
      await http.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setPwMsg({ tone: 'success', text: 'Password changed. Your other devices have been signed out.' });
    } catch (err) {
      setPwErrors(fieldErrors(err));
      setPwMsg({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader title="My profile" subtitle={user.email} />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Profile">
          <form onSubmit={saveProfile} className="stack">
            {profileMsg && <Alert tone={profileMsg.tone}>{profileMsg.text}</Alert>}
            <Field label="Name">
              {(id) => <input id={id} className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required />}
            </Field>
            <Field label="Phone">
              {(id) => <input id={id} className="input" type="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />}
            </Field>
            <dl className="detail-list">
              <div><dt>Branch</dt><dd>{user.branch?.name ?? 'All branches'}</dd></div>
              <div><dt>Last sign-in</dt><dd>{formatDateTime(user.lastLoginAt)}</dd></div>
              <div style={{ gridColumn: '1 / -1' }}><dt>Roles</dt><dd className="row" style={{ gap: 4 }}>{user.roles.map((r) => <Badge key={r} tone="teal">{labelize(r)}</Badge>)}</dd></div>
            </dl>
            <div className="form-actions"><Button type="submit" variant="primary" loading={savingProfile}>Save profile</Button></div>
          </form>
        </Card>
        <Card title="Change password">
          <form onSubmit={changePassword} className="stack">
            {pwMsg && <Alert tone={pwMsg.tone}>{pwMsg.text}</Alert>}
            <Field label="Current password" error={pwErrors.currentPassword}>
              {(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={pw.currentPassword}
                onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />}
            </Field>
            <Field label="New password" error={pwErrors.newPassword} hint="At least 10 characters, with a letter and a number">
              {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />}
            </Field>
            <Field label="Confirm new password" error={pwErrors.confirm}>
              {(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />}
            </Field>
            <p className="muted small">Last changed {formatDateTime(user.passwordChangedAt)}</p>
            <div className="form-actions">
              <Button type="submit" variant="primary" loading={savingPw} disabled={!pw.currentPassword || !pw.newPassword}>Change password</Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
