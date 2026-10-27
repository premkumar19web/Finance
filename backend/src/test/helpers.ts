import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app.js';

export const DEV_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LionDev@2026';

export async function startServer() {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface ApiResponse {
  status: number;
  // Tests inspect arbitrary JSON shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  setCookie: string[];
}

/** Minimal API client that keeps the session cookie like a browser would. */
export class ApiClient {
  private cookie = '';
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async login(email: string, password = DEV_PASSWORD): Promise<ApiResponse> {
    const res = await this.post('/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return res;
  }

  async request(method: string, path: string, body?: unknown, opts: { csrf?: boolean } = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.csrf !== false) headers['X-Requested-With'] = 'LionFinance';
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie();
    for (const c of setCookie) {
      const pair = c.split(';')[0]!;
      if (pair.startsWith('lf_session=')) this.cookie = pair === 'lf_session=' ? '' : pair;
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, setCookie };
  }

  get(path: string) {
    return this.request('GET', path);
  }
  post(path: string, body?: unknown) {
    return this.request('POST', path, body);
  }
  patch(path: string, body?: unknown) {
    return this.request('PATCH', path, body);
  }
  put(path: string, body?: unknown) {
    return this.request('PUT', path, body);
  }
}

export const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

export async function todayFromApi(client: ApiClient): Promise<string> {
  // Business "today" as the server sees it (collections default to today).
  const res = await client.get('/collections/due?pageSize=1');
  return res.body.summary.from as string;
}

/**
 * Creates a customer and a loan in branch BR001 and takes it through
 * approval (manager) and disbursement (accountant) with agent@ assigned.
 */
export async function createDisbursedLoan(
  clients: { admin: ApiClient; manager: ApiClient; accountant: ApiClient },
  terms: Partial<{ principalAmount: string; annualInterestRate: string; loanTerm: number; collectionFrequency: string }> = {},
) {
  const { admin, manager, accountant } = clients;
  const branch = (await admin.get('/branches?search=BR001')).body.data[0];
  const agent = (await admin.get(`/assignments/agents?branchId=${branch.id}`)).body.data.find(
    (a: { name: string }) => a.name === 'Ganesh Agent',
  );
  const customer = await admin.post('/customers', {
    branchId: branch.id,
    fullName: `Test Customer ${unique()}`,
    phone: '+91 00000 99999',
  });
  if (customer.status !== 201) throw new Error(`customer: ${JSON.stringify(customer.body)}`);
  const today = await todayFromApi(admin);
  const loan = await admin.post('/loans', {
    customerId: customer.body.data.id,
    principalAmount: '10000',
    annualInterestRate: '24',
    loanTerm: 10,
    collectionFrequency: 'WEEKLY',
    loanStartDate: today,
    ...terms,
  });
  if (loan.status !== 201) throw new Error(`loan: ${JSON.stringify(loan.body)}`);
  const id = loan.body.data.id as number;
  const approved = await manager.post(`/loans/${id}/approve`);
  if (approved.status !== 204) throw new Error(`approve: ${JSON.stringify(approved.body)}`);
  const disbursed = await accountant.post(`/loans/${id}/disburse`, { agentId: agent.id });
  if (disbursed.status !== 204) throw new Error(`disburse: ${JSON.stringify(disbursed.body)}`);
  return { loanId: id, customerId: customer.body.data.id as number, branchId: branch.id as number, agentId: agent.id as number };
}
