import { useState } from 'react';
import { http } from '../../api/client';
import type { Setting } from '../../api/types';
import { useAuth } from '../../auth/context';
import { Alert, Button, Card, ErrorState, PageHeader, Spinner } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, labelize } from '../../lib/format';
import { useApi } from '../../lib/useApi';

const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];

export function SettingsPage() {
  const { can, refresh } = useAuth();
  const { data, error, reload } = useApi<{ data: Setting[] }>('/settings');
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const editable = can('settings.manage');

  return (
    <div className="stack">
      <PageHeader title="Application settings"
        subtitle="Business rules used by the server. Values marked as assumptions in OPEN_QUESTIONS.md should be confirmed before go-live." />
      {!editable && <Alert tone="info">You can view settings but not change them.</Alert>}
      <Card flush>
        {data.data.map((s) => (
          <SettingRow key={s.key} setting={s} editable={editable} onSaved={() => { reload(); void refresh(); }} />
        ))}
      </Card>
    </div>
  );
}

function SettingRow({ setting, editable, onSaved }: { setting: Setting; editable: boolean; onSaved: () => void }) {
  const [value, setValue] = useState<unknown>(setting.value);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const dirty = JSON.stringify(value) !== JSON.stringify(setting.value);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await http.put(`/settings/${encodeURIComponent(setting.key)}`, { value });
      setMessage({ tone: 'success', text: 'Saved' });
      onSaved();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="row" style={{ padding: '16px 18px', borderBottom: '1px solid var(--gray-100)', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div style={{ flex: '1 1 260px' }}>
        <strong>{labelize(setting.key.split('.').slice(1).join(' '))}</strong> <span className="mono muted">{setting.key}</span>
        <p className="muted small">{setting.description}</p>
        <p className="muted small">Updated {formatDateTime(setting.updatedAt)}{setting.updatedByName && ` by ${setting.updatedByName}`}</p>
      </div>
      <div className="stack" style={{ flex: '1 1 320px', gap: 8 }}>
        <SettingEditor value={value} onChange={setValue} disabled={!editable} />
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {editable && dirty && (
          <div className="row">
            <Button size="sm" variant="primary" loading={saving} onClick={save}>Save</Button>
            <Button size="sm" onClick={() => { setValue(setting.value); setMessage(null); }}>Undo</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Picks an input that matches the JSON shape of the value. */
function SettingEditor({ value, onChange, disabled }: { value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  if (typeof value === 'boolean') {
    return (
      <label className="checkbox">
        <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> Enabled
      </label>
    );
  }
  if (typeof value === 'number') {
    return <input className="input" type="number" value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (typeof value === 'string') {
    return <input className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
  if (Array.isArray(value)) {
    return (
      <div className="row">
        {PAYMENT_METHODS.map((m) => (
          <label key={m} className="checkbox">
            <input type="checkbox" checked={value.includes(m)} disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...value, m] : value.filter((x) => x !== m))} />
            {labelize(m)}
          </label>
        ))}
      </div>
    );
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, number>;
    return (
      <div className="form-grid">
        {Object.entries(obj).map(([k, v]) => (
          <label key={k} className="field">
            <span className="small">{labelize(k)}</span>
            <input className="input" type="number" value={v} disabled={disabled} onChange={(e) => onChange({ ...obj, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
    );
  }
  return <code>{JSON.stringify(value)}</code>;
}
