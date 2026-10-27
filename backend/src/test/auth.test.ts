import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { pool } from '../db.js';
import { ApiClient, DEV_PASSWORD, startServer, unique } from './helpers.js';

let server: Awaited<ReturnType<typeof startServer>>;
const client = () => new ApiClient(server.baseUrl);

before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await pool.end();
});

describe('authentication', () => {
  it('signs in and sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const c = client();
    const res = await c.login('admin@lionfinance.test');
    assert.equal(res.body.data.email, 'admin@lionfinance.test');
    assert.ok(res.body.data.permissions.includes('settings.manage'));
    assert.equal(res.body.data.password_hash, undefined);
    const cookie = res.setCookie.find((s) => s.startsWith('lf_session='))!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\/api/i);
  });

  it('rejects a wrong password with a generic message', async () => {
    const res = await client().post('/auth/login', { email: 'admin@lionfinance.test', password: 'wrong-password-1' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Invalid email or password.');
  });

  it('gives an unknown email the same answer as a wrong password', async () => {
    const res = await client().post('/auth/login', { email: 'nobody@lionfinance.test', password: 'whatever123' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Invalid email or password.');
  });

  it('requires a session for protected endpoints', async () => {
    const res = await client().get('/customers');
    assert.equal(res.status, 401);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const res = await client().request('POST', '/auth/login', { email: 'admin@lionfinance.test', password: DEV_PASSWORD }, { csrf: false });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'CSRF_CHECK_FAILED');
  });

  it('allows local dev origins on any port but rejects foreign origins', async () => {
    for (const origin of ['http://localhost:5174', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
      const res = await fetch(`${server.baseUrl}/auth/login`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-requested-with' },
      });
      assert.equal(res.headers.get('access-control-allow-origin'), origin, origin);
    }
    const evil = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'X-Requested-With': 'LionFinance' },
      body: JSON.stringify({ email: 'admin@lionfinance.test', password: DEV_PASSWORD }),
    });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });

  it('logout invalidates the session on the server', async () => {
    const c = client();
    await c.login('auditor@lionfinance.test');
    const cookieBefore = (c as unknown as { cookie: string }).cookie;
    assert.equal((await c.post('/auth/logout')).status, 204);
    // Re-using the old cookie must fail even though the browser kept it.
    (c as unknown as { cookie: string }).cookie = cookieBefore;
    assert.equal((await c.get('/auth/me')).status, 401);
  });

  it('locks an account after repeated failures', async () => {
    const admin = client();
    await admin.login('admin@lionfinance.test');
    const email = `lock.${unique().toLowerCase()}@lionfinance.test`;
    const created = await admin.post('/users', { name: 'Lockout Test', email, roles: ['AUDITOR'], password: 'Initial12345' });
    assert.equal(created.status, 201);
    for (let i = 0; i < 5; i++) {
      assert.equal((await client().post('/auth/login', { email, password: 'bad-password-9' })).status, 401);
    }
    const locked = await client().post('/auth/login', { email, password: 'Initial12345' });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
  });

  it('changes a password only with the correct current password', async () => {
    const admin = client();
    await admin.login('admin@lionfinance.test');
    const email = `pw.${unique().toLowerCase()}@lionfinance.test`;
    await admin.post('/users', { name: 'Password Test', email, roles: ['AUDITOR'], password: 'Initial12345' });

    const user = client();
    await user.login(email, 'Initial12345');
    const wrong = await user.post('/auth/change-password', { currentPassword: 'nope', newPassword: 'Changed12345' });
    assert.equal(wrong.status, 400);
    const weak = await user.post('/auth/change-password', { currentPassword: 'Initial12345', newPassword: 'short' });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, 'VALIDATION_ERROR');
    const ok = await user.post('/auth/change-password', { currentPassword: 'Initial12345', newPassword: 'Changed12345' });
    assert.equal(ok.status, 204);
    await client().login(email, 'Changed12345');
  });
});

describe('authorization', () => {
  it('collection agents cannot approve loans, read the audit log or change settings', async () => {
    const agent = client();
    await agent.login('agent@lionfinance.test');
    assert.equal((await agent.post('/loans/1/approve')).status, 403);
    assert.equal((await agent.get('/audit-logs')).status, 403);
    assert.equal((await agent.put('/settings/company.name', { value: 'X' })).status, 403);
    assert.equal((await agent.post('/branches', { branchCode: 'X1', branchName: 'X' })).status, 403);
  });

  it('auditors can read but not write', async () => {
    const auditor = client();
    await auditor.login('auditor@lionfinance.test');
    assert.equal((await auditor.get('/audit-logs')).status, 200);
    assert.equal((await auditor.get('/customers')).status, 200);
    const create = await auditor.post('/customers', { branchId: 1, fullName: 'No Access', phone: '+91 00000 11111' });
    assert.equal(create.status, 403);
  });

  it('branch staff only see their own branch', async () => {
    const bm = client();
    const me = (await bm.login('branchmanager@lionfinance.test')).body.data;
    const list = await bm.get('/customers?pageSize=100');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.length > 0);
    assert.ok(list.body.data.every((c: { branchId: number }) => c.branchId === me.branch.id));

    const admin = client();
    await admin.login('admin@lionfinance.test');
    const other = (await admin.get('/customers?pageSize=100')).body.data.find((c: { branchId: number }) => c.branchId !== me.branch.id);
    assert.equal((await bm.get(`/customers/${other.id}`)).status, 403);
    assert.equal((await bm.get(`/customers?branchId=${other.branchId}`)).status, 403);
  });

  it('the administrator role cannot be stripped of permissions', async () => {
    const admin = client();
    await admin.login('admin@lionfinance.test');
    const roles = (await admin.get('/roles')).body.data;
    const adminRole = roles.find((r: { roleName: string }) => r.roleName === 'ADMIN');
    const res = await admin.put(`/roles/${adminRole.id}/permissions`, { permissionCodes: [] });
    assert.equal(res.status, 422);
  });
});
