// Development seed: realistic, synthetic, reproducible data for every table.
//
//   npm run db:seed
//
// Safety:
//  * Refuses to run when NODE_ENV=production.
//  * Runs once: a marker setting ('dev.seed_version') is written in the same
//    transaction, and later runs exit without changes. Nothing is ever deleted.
//  * Everything is inserted in ONE transaction — either all of it or none of it.
//  * Seeded staff use the reserved .test email domain; the backend refuses .test
//    logins in production, so these accounts can never become production credentials.
//
// The loan history is simulated with the same schedule and allocation functions
// the API uses, so balances, allocations and statuses reconcile exactly.

import type { PoolClient } from 'pg';
import { hashPassword, passwordPolicy } from '../auth/password.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { allocatePayment, installmentStatus } from '../finance/allocation.js';
import { fromPaise, toRateUnits } from '../finance/money.js';
import { addPeriods, buildSchedule, type CollectionFrequency, formatUtcDate } from '../finance/schedule.js';
import {
  CITIES,
  createRandom,
  EXPENSE_TEMPLATES,
  FIRST_NAMES,
  LAST_NAMES,
  LOAN_PURPOSES,
  OCCUPATIONS,
  STREETS,
} from './seed-data.js';

const SEED_MARKER = 'dev.seed_version';
const SEED_VERSION = 1;
const SEED_LOCK_ID = 774_211_002;
const DEFAULT_DEV_PASSWORD = 'LionDev@2026';

type LoanStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'CLOSED' | 'REJECTED' | 'DEFAULTED';
type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';

interface SeedUser {
  email: string;
  name: string;
  phone: string;
  branch: number | null;
  roles: string[];
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SeedCustomer {
  branch: number;
  fullName: string;
  phone: string;
  email: string | null;
  address: string;
  occupation: string;
  docType: string | null;
  docLast4: string | null;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

interface SeedInstallment {
  n: number;
  dueDate: string;
  principal: bigint;
  interest: bigint;
  total: bigint;
  paid: bigint;
  waived: boolean;
}

interface SeedLoan {
  customer: number;
  branch: number;
  principal: bigint;
  rate: string;
  term: number;
  frequency: CollectionFrequency;
  startDate: string;
  maturityDate: string;
  totalInterest: bigint;
  status: LoanStatus;
  purpose: string;
  createdAt: string;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  disbursedBy: string | null;
  disbursedAt: string | null;
  closedAt: string | null;
  defaultedAt: string | null;
  installments: SeedInstallment[];
  outstanding: bigint;
}

interface SeedAssignment {
  loan: number;
  agent: string;
  assignedBy: string;
  assignedAt: string;
  unassignedAt: string | null;
  unassignedBy: string | null;
  notes: string | null;
}

interface SeedPayment {
  loan: number;
  amount: bigint;
  at: string;
  method: PaymentMethod;
  reference: string | null;
  collector: string;
  reversedAt: string | null;
  reversedBy: string | null;
  reversalReason: string | null;
  allocations: { n: number; amount: bigint }[];
  idempotencyKey: string;
}

interface SeedExpense {
  branch: number;
  submittedBy: string;
  category: string;
  amount: bigint;
  date: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

interface SeedPlan {
  branches: { code: string; name: string; city: string; address: string; phone: string; email: string; createdAt: string }[];
  users: SeedUser[];
  customers: SeedCustomer[];
  loans: SeedLoan[];
  assignments: SeedAssignment[];
  payments: SeedPayment[];
  expenses: SeedExpense[];
}

// ---------------------------------------------------------------------------
// Date helpers ('YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS', business time zone)
// ---------------------------------------------------------------------------
const addDays = (date: string, days: number) => addPeriods(date, 'DAILY', days);
const pad = (n: number) => String(n).padStart(2, '0');
const at = (date: string, hour: number, minute: number) => `${date} ${pad(hour)}:${pad(minute)}:00`;
const minTs = (a: string, b: string) => (a < b ? a : b);
const maxTs = (a: string, b: string) => (a > b ? a : b);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
function shiftTs(ts: string, minutes: number): string {
  const d = new Date(`${ts.replace(' ', 'T')}Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return `${formatUtcDate(d)} ${d.toISOString().slice(11, 19)}`;
}

// ---------------------------------------------------------------------------
// Plan: build the whole dataset in memory first
// ---------------------------------------------------------------------------
function buildPlan(today: string, now: string): SeedPlan {
  const rnd = createRandom(20261026);
  const fakePhone = () => `+91 00000 ${rnd.digits(5)}`;
  const personName = () => `${rnd.pick(FIRST_NAMES)} ${rnd.pick(LAST_NAMES)}`;
  const clampNow = (ts: string) => minTs(ts, now);

  // Branches -----------------------------------------------------------------
  const branches = CITIES.map((city, i) => ({
    code: `BR${String(i + 1).padStart(3, '0')}`,
    name: `${city} Branch`,
    city,
    address: `${rnd.int(1, 250)}, ${rnd.pick(STREETS)}, ${city}`,
    phone: `+91 00000 ${String(10000 + i).slice(-5)}`,
    email: `${city.toLowerCase().replace(/[^a-z]/g, '')}@branches.lionfinance.test`,
    createdAt: at(addDays(today, -rnd.int(1100, 1300)), 10, 0),
  }));

  // Users --------------------------------------------------------------------
  const users: SeedUser[] = [];
  const usedEmails = new Set<string>();
  const addUser = (u: Omit<SeedUser, 'createdAt' | 'lastLoginAt' | 'phone'> & { phone?: string }) => {
    users.push({
      ...u,
      phone: u.phone ?? fakePhone(),
      createdAt: at(addDays(today, -rnd.int(950, 1050)), 11, rnd.int(0, 59)),
      lastLoginAt: u.isActive && rnd.chance(0.8) ? clampNow(at(addDays(today, -rnd.int(0, 10)), rnd.int(8, 19), rnd.int(0, 59))) : null,
    });
    usedEmails.add(u.email);
    return u.email;
  };
  const generatedEmail = (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z ]/g, '').replace(' ', '.');
    let n = 1;
    while (usedEmails.has(`${base}${n}@lionfinance.test`)) n++;
    return `${base}${n}@lionfinance.test`;
  };

  // Memorable demo accounts (documented in SEED_DATA.md).
  const admin = addUser({ email: 'admin@lionfinance.test', name: 'Asha Admin', branch: null, roles: ['ADMIN'], isActive: true });
  const managers = [addUser({ email: 'manager@lionfinance.test', name: 'Mohan Manager', branch: null, roles: ['MANAGER'], isActive: true })];
  const accountants = [addUser({ email: 'accountant@lionfinance.test', name: 'Anitha Accountant', branch: null, roles: ['ACCOUNTANT'], isActive: true })];
  addUser({ email: 'auditor@lionfinance.test', name: 'Arjun Auditor', branch: null, roles: ['AUDITOR'], isActive: true });
  const branchManagers = new Map<number, string>();
  branchManagers.set(0, addUser({ email: 'branchmanager@lionfinance.test', name: 'Bharath Branch Manager', branch: 0, roles: ['BRANCH_MANAGER'], isActive: true }));
  const agentsByBranch = new Map<number, string[]>();
  agentsByBranch.set(0, [addUser({ email: 'agent@lionfinance.test', name: 'Ganesh Agent', branch: 0, roles: ['COLLECTION_AGENT'], isActive: true })]);

  const generated = (roles: string[], branch: number | null, isActive = true) => {
    const name = personName();
    return addUser({ email: generatedEmail(name), name, branch, roles, isActive });
  };
  managers.push(generated(['MANAGER'], null));
  accountants.push(generated(['ACCOUNTANT'], null), generated(['ACCOUNTANT'], null));
  generated(['AUDITOR'], null);
  for (let b = 1; b < 20; b++) branchManagers.set(b, generated(['BRANCH_MANAGER'], b));
  for (let b = 0; b < branches.length; b++) {
    const wanted = b < 10 ? 2 : 1;
    const list = agentsByBranch.get(b) ?? [];
    while (list.length < wanted) list.push(generated(['COLLECTION_AGENT'], b));
    agentsByBranch.set(b, list);
  }
  for (let i = 0; i < 4; i++) generated(['COLLECTION_AGENT'], rnd.int(10, 49), false); // former staff

  // Customers ----------------------------------------------------------------
  const customers: SeedCustomer[] = [];
  for (let b = 0; b < branches.length; b++) {
    const count = b < 10 ? 6 : b < 20 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const fullName = personName();
      const docType = rnd.weighted([['AADHAAR', 6], ['VOTER_ID', 2], ['PAN', 1], ['DRIVING_LICENSE', 1], [null, 1]] as const);
      customers.push({
        branch: b,
        fullName,
        phone: fakePhone(),
        email: rnd.chance(0.45) ? `${fullName.toLowerCase().replace(' ', '.')}.${customers.length + 1}@example.com` : null,
        address: `${rnd.int(1, 300)}, ${rnd.pick(STREETS)}, ${branches[b]!.city}`,
        occupation: rnd.pick(OCCUPATIONS),
        docType,
        docLast4: docType ? (docType === 'PAN' ? `${rnd.digits(3)}${String.fromCharCode(65 + rnd.int(0, 25))}` : rnd.digits(4)) : null,
        isActive: true,
        createdAt: '', // set once their loans are known
        createdBy: branchManagers.get(b) ?? managers[0]!,
      });
    }
  }

  // Loans --------------------------------------------------------------------
  const statusPool: LoanStatus[] = [
    ...Array<LoanStatus>(110).fill('ACTIVE'),
    ...Array<LoanStatus>(10).fill('PENDING'),
    ...Array<LoanStatus>(6).fill('APPROVED'),
    ...Array<LoanStatus>(8).fill('REJECTED'),
    ...Array<LoanStatus>(6).fill('DEFAULTED'),
    ...Array<LoanStatus>(10).fill('CLOSED'),
  ];
  for (let i = statusPool.length - 1; i > 0; i--) {
    const j = rnd.int(0, i);
    [statusPool[i], statusPool[j]] = [statusPool[j]!, statusPool[i]!];
  }

  const loans: SeedLoan[] = [];
  const termsFor = (frequency: CollectionFrequency) => {
    if (frequency === 'DAILY') return { term: rnd.pick([50, 60, 75, 100]), principal: BigInt(rnd.int(10, 50)) * 100_000n };
    if (frequency === 'WEEKLY') return { term: rnd.pick([12, 16, 20, 26]), principal: BigInt(rnd.int(4, 20)) * 500_000n };
    return { term: rnd.pick([6, 9, 12]), principal: BigInt(rnd.int(5, 30)) * 1_000_000n };
  };
  const periodsAgo = (frequency: CollectionFrequency, periods: number) => addPeriods(today, frequency, -periods);
  const approverFor = (creator: string) => (creator === managers[0] ? managers[1]! : rnd.pick([managers[0]!, managers[1]!, admin]));

  /** `endBefore`: an older loan that must have fully matured before this date. */
  const makeLoan = (customerIndex: number, status: LoanStatus, endBefore?: string): SeedLoan => {
    const c = customers[customerIndex]!;
    const frequency = rnd.weighted([['DAILY', 45], ['WEEKLY', 35], ['MONTHLY', 20]] as const);
    const { term, principal } = termsFor(frequency);
    const rate = rnd.pick(['12', '15', '18', '20', '24', '26.5', '30']);

    let start: string;
    if (endBefore) start = addPeriods(endBefore, frequency, -(term + rnd.int(2, 6)));
    else {
      if (status === 'ACTIVE') start = periodsAgo(frequency, rnd.int(3, term - 2));
      else if (status === 'CLOSED') start = periodsAgo(frequency, term + rnd.int(1, 8));
      else if (status === 'DEFAULTED') start = periodsAgo(frequency, term + rnd.int(4, 10));
      else if (status === 'REJECTED') start = addDays(today, -rnd.int(5, 150));
      else start = addDays(today, rnd.int(1, 25)); // PENDING / APPROVED
    }
    const schedule = buildSchedule({ principal, annualRateUnits: toRateUnits(rate), term, frequency, startDate: start });

    const createdDate = status === 'PENDING' ? addDays(today, -rnd.int(2, 6)) : addDays(start, -rnd.int(3, 8));
    // Applications for future start dates were still made in the past.
    const createdAt = at(minTs(createdDate, addDays(today, -2 - rnd.int(0, 3))), rnd.int(10, 16), rnd.int(0, 59));
    const createdBy = c.createdBy;
    const decidedAt = at(addDays(createdAt.slice(0, 10), 1), rnd.int(11, 17), rnd.int(0, 59));
    const approved = ['APPROVED', 'ACTIVE', 'CLOSED', 'DEFAULTED'].includes(status);
    const disbursed = ['ACTIVE', 'CLOSED', 'DEFAULTED'].includes(status);

    return {
      customer: customerIndex,
      branch: c.branch,
      principal,
      rate,
      term,
      frequency,
      startDate: start,
      maturityDate: schedule.maturityDate,
      totalInterest: schedule.totalInterest,
      status,
      purpose: rnd.pick(LOAN_PURPOSES),
      createdAt,
      createdBy,
      approvedBy: approved ? approverFor(createdBy) : null,
      approvedAt: approved ? decidedAt : null,
      rejectedBy: status === 'REJECTED' ? approverFor(createdBy) : null,
      rejectedAt: status === 'REJECTED' ? decidedAt : null,
      rejectionReason:
        status === 'REJECTED'
          ? rnd.pick(['Insufficient repayment capacity', 'Incomplete documents', 'Existing overdue loan elsewhere', 'Address could not be verified'])
          : null,
      disbursedBy: disbursed ? rnd.pick(accountants) : null,
      disbursedAt: disbursed ? at(start, 9, rnd.int(5, 55)) : null,
      closedAt: null,
      defaultedAt: null,
      installments: schedule.installments.map((i) => ({
        n: i.installmentNumber,
        dueDate: i.dueDate,
        principal: i.principalDue,
        interest: i.interestDue,
        total: i.totalDue,
        paid: 0n,
        waived: false,
      })),
      outstanding: disbursed ? schedule.totalPayable : 0n,
    };
  };

  customers.forEach((_, i) => loans.push(makeLoan(i, statusPool[i]!)));
  // Some customers are deactivated: only those whose primary loan is finished or rejected.
  let deactivated = 0;
  loans.forEach((l) => {
    if (deactivated < 7 && (l.status === 'REJECTED' || l.status === 'CLOSED') && rnd.chance(0.5)) {
      customers[l.customer]!.isActive = false;
      deactivated++;
    }
  });
  // 20 repeat customers have an older, fully repaid loan.
  for (let k = 0; k < 20; k++) {
    const primary = loans[k * 7]!;
    loans.push(makeLoan(primary.customer, 'CLOSED', addDays(minTs(primary.createdAt.slice(0, 10), today), -rnd.int(20, 60))));
  }

  // Assignments + payment simulation -----------------------------------------
  const assignments: SeedAssignment[] = [];
  const payments: SeedPayment[] = [];
  let reversals = 0;
  let waivers = 0;

  loans.forEach((loan, loanIndex) => {
    const agents = agentsByBranch.get(loan.branch)!;
    const supervisor = branchManagers.get(loan.branch) ?? managers[0]!;

    if (loan.status === 'APPROVED') {
      assignments.push({
        loan: loanIndex, agent: rnd.pick(agents), assignedBy: supervisor, assignedAt: shiftTs(loan.approvedAt!, 60),
        unassignedAt: null, unassignedBy: null, notes: null,
      });
      return;
    }
    if (!loan.disbursedAt) return;

    // Who collects this loan, and from when.
    const first = rnd.pick(agents);
    const timeline: { agent: string; from: string }[] = [{ agent: first, from: loan.disbursedAt }];
    const span = daysBetween(loan.startDate, minTs(loan.maturityDate, today));
    if (agents.length > 1 && span > 6 && rnd.chance(0.35)) {
      const second = agents.find((a) => a !== first)!;
      timeline.push({ agent: second, from: at(addDays(loan.startDate, Math.floor(span / 2)), 8, 0) });
    }
    const collectorAt = (ts: string) => [...timeline].reverse().find((t) => t.from <= ts)!.agent;

    const profile =
      loan.status === 'CLOSED' ? 'good'
        : loan.status === 'DEFAULTED' ? 'struggling'
          : rnd.weighted([['good', 55], ['late', 30], ['struggling', 15]] as const);
    const payChance = { good: 0.96, late: 0.75, struggling: 0.6 }[profile];
    const fullChance = loan.status === 'CLOSED' ? 1 : { good: 0.92, late: 0.6, struggling: 0.35 }[profile];
    const inst = loan.installments;
    const dueCount = inst.filter((i) => i.dueDate <= today).length;
    const stopAt = loan.status === 'DEFAULTED' ? Math.floor(dueCount * (0.4 + rnd.next() * 0.3)) : dueCount;
    const periodDays = loan.frequency === 'DAILY' ? 1 : loan.frequency === 'WEEKLY' ? 7 : 28;

    if (loan.status === 'CLOSED' && waivers < 3 && rnd.chance(0.25)) {
      inst[inst.length - 1]!.waived = true; // settled with the last installment waived
      waivers++;
    }

    const open = () =>
      inst.filter((i) => !i.waived && i.total > i.paid).map((i) => ({ scheduleId: i.n, installmentNumber: i.n, outstanding: i.total - i.paid }));
    let lastTs = loan.disbursedAt;

    for (let k = 0; k < Math.min(stopAt, dueCount); k++) {
      if (loan.status !== 'CLOSED' && !rnd.chance(payChance)) continue;
      const arrears = inst.slice(0, k + 1).reduce((s, i) => s + (i.waived ? 0n : i.total - i.paid), 0n);
      if (arrears === 0n) continue;

      const late = profile === 'late' && loan.frequency !== 'DAILY' ? rnd.int(0, Math.min(3, periodDays - 1)) : 0;
      const day = minTs(addDays(inst[k]!.dueDate, late), today);
      let ts = clampNow(at(day, rnd.int(8, 18), rnd.int(0, 59)));
      ts = maxTs(ts, shiftTs(lastTs, 1));
      if (ts > now) break;

      let amount = arrears;
      if (!rnd.chance(fullChance)) {
        const partial = ((arrears * BigInt(rnd.int(30, 90))) / 100n / 100n) * 100n; // whole rupees
        amount = partial > 0n && partial < arrears ? partial : arrears;
      }
      const method = rnd.weighted([['CASH', 60], ['UPI', 25], ['BANK_TRANSFER', 8], ['CHEQUE', loan.frequency === 'MONTHLY' ? 8 : 1], ['OTHER', 2]] as const);
      const reference =
        method === 'UPI' ? `UPI${rnd.digits(12)}`
          : method === 'BANK_TRANSFER' ? `NEFT${rnd.digits(10)}`
            : method === 'CHEQUE' ? `CHQ${rnd.digits(6)}`
              : null;
      const collector = collectorAt(ts);

      // Occasionally an agent records a payment twice; the duplicate is reversed.
      if (loan.status === 'ACTIVE' && reversals < 15 && rnd.chance(0.01)) {
        const dupTs = maxTs(shiftTs(ts, -30), shiftTs(lastTs, 1));
        if (dupTs < ts) {
          payments.push({
            loan: loanIndex, amount, at: dupTs, method, reference, collector,
            reversedAt: clampNow(shiftTs(dupTs, 10)), reversedBy: rnd.pick(accountants),
            reversalReason: rnd.pick(['Duplicate entry by agent', 'Recorded against the wrong loan', 'Cheque returned by bank']),
            allocations: allocatePayment(amount, open()).map((a) => ({ n: a.scheduleId, amount: a.amount })),
            idempotencyKey: rnd.uuid(),
          });
          reversals++;
        }
      }

      const allocations = allocatePayment(amount, open());
      for (const a of allocations) inst[a.scheduleId - 1]!.paid += a.amount;
      payments.push({
        loan: loanIndex, amount, at: ts, method, reference, collector,
        reversedAt: null, reversedBy: null, reversalReason: null,
        allocations: allocations.map((a) => ({ n: a.scheduleId, amount: a.amount })),
        idempotencyKey: rnd.uuid(),
      });
      lastTs = ts;
    }

    loan.outstanding = inst.reduce((s, i) => s + (i.waived ? 0n : i.total - i.paid), 0n);
    if (loan.status === 'CLOSED') {
      if (loan.outstanding !== 0n) throw new Error(`Seed bug: closed loan ${loanIndex} still owes ${loan.outstanding}`);
      loan.closedAt = lastTs;
    }
    if (loan.status === 'DEFAULTED') loan.defaultedAt = clampNow(at(addDays(loan.maturityDate, 7), 12, 0));

    timeline.forEach((t, i) => {
      const next = timeline[i + 1];
      assignments.push({
        loan: loanIndex,
        agent: t.agent,
        assignedBy: supervisor,
        assignedAt: t.from,
        unassignedAt: next ? next.from : loan.closedAt,
        unassignedBy: next || loan.closedAt ? supervisor : null,
        notes: next ? 'Route rebalanced between agents' : null,
      });
    });
  });

  // Customers were registered shortly before their first loan application.
  customers.forEach((c, i) => {
    const first = loans.filter((l) => l.customer === i).map((l) => l.createdAt).sort()[0]!;
    c.createdAt = at(addDays(first.slice(0, 10), -rnd.int(1, 20)), rnd.int(10, 16), rnd.int(0, 59));
  });

  // Expenses -----------------------------------------------------------------
  const expenses: SeedExpense[] = [];
  const categories = Object.keys(EXPENSE_TEMPLATES);
  for (let i = 0; i < 80; i++) {
    const branch = rnd.int(0, 19);
    const category = rnd.pick(categories);
    const t = EXPENSE_TEMPLATES[category]!;
    const date = addDays(today, -rnd.int(0, 90));
    const submittedBy = rnd.chance(0.6) ? branchManagers.get(branch)! : rnd.pick(agentsByBranch.get(branch)!);
    const status = rnd.weighted([['APPROVED', 60], ['PENDING', 25], ['REJECTED', 15]] as const);
    const createdAt = clampNow(at(date, rnd.int(10, 17), rnd.int(0, 59)));
    const reviewedAt = status === 'PENDING' ? null : maxTs(createdAt, clampNow(at(addDays(date, rnd.int(1, 3)), 15, rnd.int(0, 59))));
    expenses.push({
      branch,
      submittedBy,
      category,
      amount: BigInt(rnd.int(t.min, t.max)) * 100n + (rnd.chance(0.2) ? 50n : 0n),
      date,
      description: rnd.pick(t.notes),
      status,
      reviewedBy: status === 'PENDING' ? null : rnd.pick(accountants),
      reviewedAt,
      reviewNote: status === 'REJECTED' ? rnd.pick(['Bill not attached', 'Exceeds monthly limit', 'Not a branch expense']) : status === 'APPROVED' ? 'Verified' : null,
      createdAt,
    });
  }

  return { branches, users, customers, loans, assignments, payments, expenses };
}

// ---------------------------------------------------------------------------
// Insert: write the plan in dependency order and resolve generated ids
// ---------------------------------------------------------------------------
async function insertRows<T = Record<string, unknown>>(
  db: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  returning = '',
): Promise<T[]> {
  const out: T[] = [];
  const perChunk = Math.max(1, Math.floor(60_000 / columns.length));
  for (let i = 0; i < rows.length; i += perChunk) {
    const params: unknown[] = [];
    const values = rows.slice(i, i + perChunk).map(
      (row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`,
    );
    const result = await db.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values.join(', ')}${returning ? ` RETURNING ${returning}` : ''}`,
      params,
    );
    out.push(...(result.rows as T[]));
  }
  return out;
}

async function nextValues(db: PoolClient, sequence: string, count: number): Promise<number[]> {
  const { rows } = await db.query<{ v: number }>(`SELECT nextval('${sequence}') AS v FROM generate_series(1, $1)`, [count]);
  return rows.map((r) => r.v).sort((a, b) => a - b);
}

interface AuditRow {
  user: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  at: string;
}

async function insertPlan(db: PoolClient, plan: SeedPlan, passwordHashes: Map<string, string>) {
  const audits: AuditRow[] = [];

  // Branches.
  await insertRows(db, 'branches', ['branch_code', 'branch_name', 'city', 'address', 'phone', 'email', 'created_at', 'updated_at'],
    plan.branches.map((b) => [b.code, b.name, b.city, b.address, b.phone, b.email, b.createdAt, b.createdAt]));
  const branchRows = await db.query<{ id: number; branch_code: string }>('SELECT id, branch_code FROM branches WHERE branch_code = ANY($1)', [
    plan.branches.map((b) => b.code),
  ]);
  const branchIds = plan.branches.map((b) => branchRows.rows.find((r) => r.branch_code === b.code)!.id);

  // Users and roles.
  const userRows = await insertRows<{ id: number; email: string }>(db, 'users',
    ['name', 'email', 'phone', 'branch_id', 'password_hash', 'is_active', 'created_at', 'updated_at', 'last_login_at', 'password_changed_at'],
    plan.users.map((u) => [u.name, u.email, u.phone, u.branch === null ? null : branchIds[u.branch], passwordHashes.get(u.email),
      u.isActive, u.createdAt, u.createdAt, u.lastLoginAt, u.createdAt]),
    'id, email');
  const userId = new Map(userRows.map((r) => [r.email, r.id]));
  const uid = (email: string | null) => (email ? userId.get(email)! : null);
  const roleRows = await db.query<{ id: number; role_name: string }>('SELECT id, role_name FROM roles');
  const roleId = new Map(roleRows.rows.map((r) => [r.role_name, r.id]));
  await insertRows(db, 'user_roles', ['user_id', 'role_id', 'assigned_at'],
    plan.users.flatMap((u) => u.roles.map((r) => [uid(u.email), roleId.get(r), u.createdAt])));
  for (const u of plan.users) {
    if (u.lastLoginAt) audits.push({ user: u.email, action: 'LOGIN', entityType: 'user', entityId: uid(u.email), details: null, at: u.lastLoginAt });
  }

  // Customers, codes in registration order.
  const customerOrder = plan.customers.map((_, i) => i).sort((a, b) => plan.customers[a]!.createdAt.localeCompare(plan.customers[b]!.createdAt));
  const customerSeq = await nextValues(db, 'customer_code_seq', plan.customers.length);
  const customerCode = new Map(customerOrder.map((ci, k) => [ci, `CUST-${String(customerSeq[k]).padStart(6, '0')}`]));
  const customerRows = await insertRows<{ id: number; customer_code: string }>(db, 'customers',
    ['customer_code', 'branch_id', 'full_name', 'phone', 'email', 'address', 'occupation', 'id_document_type', 'id_document_last4',
      'is_active', 'created_by', 'created_at', 'updated_at'],
    plan.customers.map((c, i) => [customerCode.get(i), branchIds[c.branch], c.fullName, c.phone, c.email, c.address, c.occupation,
      c.docType, c.docLast4, c.isActive, uid(c.createdBy), c.createdAt, c.createdAt]),
    'id, customer_code');
  const customerIdByCode = new Map(customerRows.map((r) => [r.customer_code, r.id]));
  const customerId = (i: number) => customerIdByCode.get(customerCode.get(i)!)!;
  plan.customers.forEach((c, i) => audits.push({
    user: c.createdBy, action: 'CUSTOMER_CREATED', entityType: 'customer', entityId: customerId(i),
    details: { customerCode: customerCode.get(i), branchId: branchIds[c.branch] }, at: c.createdAt,
  }));

  // Loans, codes in application order.
  const loanOrder = plan.loans.map((_, i) => i).sort((a, b) => plan.loans[a]!.createdAt.localeCompare(plan.loans[b]!.createdAt));
  const loanSeq = await nextValues(db, 'loan_code_seq', plan.loans.length);
  const loanCode = new Map(loanOrder.map((li, k) => [li, `LN-${String(loanSeq[k]).padStart(6, '0')}`]));
  const loanRows = await insertRows<{ id: number; loan_code: string }>(db, 'loans',
    ['loan_code', 'customer_id', 'principal_amount', 'annual_interest_rate', 'loan_start_date', 'loan_term', 'collection_frequency',
      'status', 'total_interest', 'outstanding_balance', 'maturity_date', 'purpose', 'created_by', 'approved_by', 'approved_at',
      'rejected_by', 'rejected_at', 'rejection_reason', 'disbursed_by', 'disbursed_at', 'closed_at', 'created_at', 'updated_at'],
    plan.loans.map((l, i) => [loanCode.get(i), customerId(l.customer), fromPaise(l.principal), l.rate, l.startDate, l.term, l.frequency,
      l.status, fromPaise(l.totalInterest), fromPaise(l.outstanding), l.maturityDate, l.purpose, uid(l.createdBy), uid(l.approvedBy),
      l.approvedAt, uid(l.rejectedBy), l.rejectedAt, l.rejectionReason, uid(l.disbursedBy), l.disbursedAt, l.closedAt, l.createdAt,
      l.closedAt ?? l.disbursedAt ?? l.approvedAt ?? l.rejectedAt ?? l.createdAt]),
    'id, loan_code');
  const loanIdByCode = new Map(loanRows.map((r) => [r.loan_code, r.id]));
  const loanId = (i: number) => loanIdByCode.get(loanCode.get(i)!)!;
  plan.loans.forEach((l, i) => {
    const base = { entityType: 'loan', entityId: loanId(i) };
    const code = loanCode.get(i);
    audits.push({ ...base, user: l.createdBy, action: 'LOAN_CREATED', at: l.createdAt,
      details: { loanCode: code, principalAmount: fromPaise(l.principal), annualInterestRate: l.rate, loanTerm: l.term, collectionFrequency: l.frequency } });
    if (l.approvedAt) audits.push({ ...base, user: l.approvedBy, action: 'LOAN_APPROVED', at: l.approvedAt, details: { loanCode: code } });
    if (l.rejectedAt) audits.push({ ...base, user: l.rejectedBy, action: 'LOAN_REJECTED', at: l.rejectedAt, details: { loanCode: code, reason: l.rejectionReason } });
    if (l.disbursedAt) audits.push({ ...base, user: l.disbursedBy, action: 'LOAN_DISBURSED', at: l.disbursedAt,
      details: { loanCode: code, principalAmount: fromPaise(l.principal), totalPayable: fromPaise(l.principal + l.totalInterest), installments: l.term } });
    if (l.closedAt) audits.push({ ...base, user: null, action: 'LOAN_CLOSED', at: l.closedAt, details: { loanCode: code } });
    if (l.defaultedAt) audits.push({ ...base, user: l.approvedBy, action: 'LOAN_DEFAULTED', at: l.defaultedAt,
      details: { loanCode: code, reason: 'No payments received for an extended period' } });
  });

  // Installments (final paid amounts from the simulation).
  const disbursed = plan.loans.map((l, i) => ({ l, i })).filter(({ l }) => l.disbursedAt);
  const scheduleRows = await insertRows<{ id: number; loan_id: number; installment_number: number }>(db, 'collection_schedules',
    ['loan_id', 'installment_number', 'due_date', 'principal_due', 'interest_due', 'due_amount', 'paid_amount', 'status', 'created_at', 'updated_at'],
    disbursed.flatMap(({ l, i }) => l.installments.map((s) => [loanId(i), s.n, s.dueDate, fromPaise(s.principal), fromPaise(s.interest),
      fromPaise(s.total), fromPaise(s.paid), s.waived ? 'WAIVED' : installmentStatus(s.paid, s.total), l.disbursedAt, l.closedAt ?? l.disbursedAt])),
    'id, loan_id, installment_number');
  const scheduleId = new Map(scheduleRows.map((r) => [`${r.loan_id}:${r.installment_number}`, r.id]));

  // Collection assignments.
  await insertRows(db, 'collection_assignments',
    ['loan_id', 'agent_user_id', 'assigned_by', 'assigned_at', 'unassigned_at', 'unassigned_by', 'notes'],
    plan.assignments.map((a) => [loanId(a.loan), uid(a.agent), uid(a.assignedBy), a.assignedAt, a.unassignedAt, uid(a.unassignedBy), a.notes]));
  plan.assignments.forEach((a) => audits.push({
    user: a.assignedBy, action: 'AGENT_ASSIGNED', entityType: 'loan', entityId: loanId(a.loan),
    details: { loanCode: loanCode.get(a.loan), agentId: uid(a.agent) }, at: a.assignedAt,
  }));

  // Payments, numbered in chronological order; then their allocations.
  const prefix = await db.query<{ v: string }>(`SELECT setting_value #>> '{}' AS v FROM app_settings WHERE setting_key = 'receipts.prefix'`);
  const receiptPrefix = prefix.rows[0]?.v ?? 'LF';
  const payOrder = plan.payments.map((_, i) => i).sort((a, b) => plan.payments[a]!.at.localeCompare(plan.payments[b]!.at));
  const receiptSeq = await nextValues(db, 'receipt_number_seq', plan.payments.length);
  const receipt = new Map(payOrder.map((pi, k) => {
    const p = plan.payments[pi]!;
    return [pi, `${receiptPrefix}-${p.at.slice(0, 10).replace(/-/g, '')}-${String(receiptSeq[k]).padStart(6, '0')}`];
  }));
  const paymentRows = await insertRows<{ id: number; receipt_number: string }>(db, 'payments',
    ['loan_id', 'amount', 'payment_date', 'payment_method', 'reference_number', 'recorded_by', 'collected_by', 'status',
      'receipt_number', 'idempotency_key', 'reversed_at', 'reversed_by', 'reversal_reason', 'created_at'],
    plan.payments.map((p, i) => [loanId(p.loan), fromPaise(p.amount), p.at, p.method, p.reference, uid(p.collector), uid(p.collector),
      p.reversedAt ? 'REVERSED' : 'RECORDED', receipt.get(i), p.idempotencyKey, p.reversedAt, uid(p.reversedBy), p.reversalReason, p.at]),
    'id, receipt_number');
  const paymentIdByReceipt = new Map(paymentRows.map((r) => [r.receipt_number, r.id]));
  const paymentId = (i: number) => paymentIdByReceipt.get(receipt.get(i)!)!;
  await insertRows(db, 'payment_allocations', ['payment_id', 'schedule_id', 'loan_id', 'allocated_amount', 'created_at'],
    plan.payments.flatMap((p, i) => p.allocations.map((a) => [paymentId(i), scheduleId.get(`${loanId(p.loan)}:${a.n}`), loanId(p.loan),
      fromPaise(a.amount), p.at])));
  plan.payments.forEach((p, i) => {
    audits.push({ user: p.collector, action: 'PAYMENT_RECORDED', entityType: 'payment', entityId: paymentId(i), at: p.at,
      details: { receiptNumber: receipt.get(i), loanCode: loanCode.get(p.loan), amount: fromPaise(p.amount), method: p.method, installments: p.allocations.length } });
    if (p.reversedAt) audits.push({ user: p.reversedBy, action: 'PAYMENT_REVERSED', entityType: 'payment', entityId: paymentId(i), at: p.reversedAt,
      details: { receiptNumber: receipt.get(i), loanCode: loanCode.get(p.loan), amount: fromPaise(p.amount), reason: p.reversalReason } });
  });

  // Expenses.
  const expenseRows = await insertRows<{ id: number }>(db, 'expenses',
    ['branch_id', 'recorded_by', 'category', 'amount', 'expense_date', 'description', 'status', 'reviewed_by', 'reviewed_at',
      'review_note', 'created_at', 'updated_at'],
    plan.expenses.map((e) => [branchIds[e.branch], uid(e.submittedBy), e.category, fromPaise(e.amount), e.date, e.description, e.status,
      uid(e.reviewedBy), e.reviewedAt, e.reviewNote, e.createdAt, e.reviewedAt ?? e.createdAt]),
    'id');
  plan.expenses.forEach((e, i) => {
    const id = expenseRows[i]!.id;
    audits.push({ user: e.submittedBy, action: 'EXPENSE_SUBMITTED', entityType: 'expense', entityId: id, at: e.createdAt,
      details: { category: e.category, amount: fromPaise(e.amount), branchId: branchIds[e.branch] } });
    if (e.reviewedAt) audits.push({ user: e.reviewedBy, action: e.status === 'APPROVED' ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
      entityType: 'expense', entityId: id, at: e.reviewedAt, details: { amount: fromPaise(e.amount), category: e.category, note: e.reviewNote } });
  });

  // Audit trail, oldest first.
  audits.sort((a, b) => a.at.localeCompare(b.at));
  await insertRows(db, 'audit_logs', ['user_id', 'action', 'entity_type', 'entity_id', 'details', 'ip_address', 'created_at'],
    audits.map((a) => [uid(a.user), a.action, a.entityType, a.entityId, a.details ? JSON.stringify(a.details) : null, '127.0.0.1', a.at]));

  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value, description) VALUES ($1, $2, $3)`,
    [SEED_MARKER, JSON.stringify({ version: SEED_VERSION, seededAt: new Date().toISOString() }),
      'Marker written by the development seed. Its presence makes the seed skip on re-runs.'],
  );
  return { audits: audits.length };
}

// ---------------------------------------------------------------------------
async function main() {
  if (config.isProduction) throw new Error('Refusing to seed: NODE_ENV is production. The seed is for development only.');
  const password = passwordPolicy.parse(process.env.SEED_USER_PASSWORD ?? DEFAULT_DEV_PASSWORD);

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_ID]);
    const marker = await client.query('SELECT 1 FROM app_settings WHERE setting_key = $1', [SEED_MARKER]);
    if (marker.rowCount) {
      console.log('ℹ️  Development seed already applied (found app_settings.dev.seed_version). Nothing to do.');
      return;
    }

    const { rows } = await client.query<{ today: string; now: string }>(
      `SELECT CURRENT_DATE AS today, to_char(LOCALTIMESTAMP - INTERVAL '1 minute', 'YYYY-MM-DD HH24:MI:SS') AS now`,
    );
    const { today, now } = rows[0]!;
    console.log(`Building seed plan relative to ${today} (${config.APP_TIMEZONE})...`);
    const plan = buildPlan(today, now);

    console.log(`Hashing ${plan.users.length} development passwords (Argon2id)...`);
    const hashes = new Map(await Promise.all(plan.users.map(async (u) => [u.email, await hashPassword(password)] as const)));

    await client.query('BEGIN');
    const result = await insertPlan(client, plan, hashes);
    console.log('Committing (deferred integrity checks run now)...');
    await client.query('COMMIT');
    // Refresh planner statistics after the bulk load so queries are fast immediately.
    await client.query('ANALYZE');

    console.log('✅ Development seed applied:');
    console.table({
      branches: plan.branches.length,
      users: plan.users.length,
      customers: plan.customers.length,
      loans: plan.loans.length,
      collection_assignments: plan.assignments.length,
      collection_schedules: plan.loans.reduce((s, l) => s + (l.disbursedAt ? l.installments.length : 0), 0),
      payments: plan.payments.length,
      payment_allocations: plan.payments.reduce((s, p) => s + p.allocations.length, 0),
      expenses: plan.expenses.length,
      audit_logs: result.audits,
    });
    console.log(`Demo logins: admin@lionfinance.test, manager@, branchmanager@, agent@, accountant@, auditor@ (see SEED_DATA.md).`);
    console.log(`Password: ${process.env.SEED_USER_PASSWORD ? 'the value of SEED_USER_PASSWORD' : `${DEFAULT_DEV_PASSWORD} (development default)`}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_ID]).catch(() => {});
    client.release();
  }
}

try {
  await main();
} catch (err) {
  console.error(`❌ Seed failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
