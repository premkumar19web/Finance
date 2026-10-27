// Response shapes returned by the backend. Money is always a decimal string
// (e.g. "1500.00") so no precision is lost in the browser.

export type Money = string;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paged<T, S = undefined> {
  data: T[];
  meta: PageMeta;
  summary: S;
}

export interface Envelope<T> {
  data: T;
}

export type PaymentMethod = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';
export type LoanStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'CLOSED' | 'REJECTED' | 'DEFAULTED';
export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type InstallmentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'WAIVED';

export interface Profile {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  lastLoginAt: string | null;
  passwordChangedAt: string;
  branch: { id: number; name: string; code: string } | null;
  roles: string[];
  permissions: string[];
  config: { companyName: string; currency: string; paymentMethods: PaymentMethod[]; weekStartsOn: 'MONDAY' | 'SUNDAY' };
}

export interface Branch {
  id: number;
  branchCode: string;
  branchName: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  customerCount?: number;
  staffCount?: number;
  openLoans?: number;
}

export interface User {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  isLocked: boolean;
  branchId: number | null;
  branchName: string | null;
  roles: string[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Role {
  id: number;
  roleName: string;
  displayName: string;
  description: string;
  activeUsers: number;
  permissions: string[];
}

export interface Permission {
  id: number;
  permissionCode: string;
  description: string;
}

export interface Customer {
  id: number;
  customerCode: string;
  fullName: string;
  phone: string;
  email: string | null;
  address: string | null;
  occupation: string | null;
  idDocumentType: string | null;
  idDocumentLast4: string | null;
  isActive: boolean;
  branchId: number;
  branchName: string;
  createdAt: string;
  openLoans?: number;
}

export interface CustomerLoanSummary {
  id: number;
  loanCode: string;
  principalAmount: Money;
  totalPayable: Money;
  outstandingBalance: Money;
  collectionFrequency: Frequency;
  loanTerm: number;
  loanStartDate: string;
  maturityDate: string;
  status: LoanStatus;
}

export interface CustomerDetail extends Customer {
  createdByName: string | null;
  loans: CustomerLoanSummary[];
  totals: { totalOutstanding: Money; totalPaid: Money; overdueInstallments: number };
}

export interface Loan {
  id: number;
  loanCode: string;
  customerId: number;
  customerCode: string;
  customerName: string;
  customerPhone: string;
  branchId: number;
  branchName: string;
  principalAmount: Money;
  annualInterestRate: string;
  interestMethod: string;
  totalInterest: Money;
  totalPayable: Money;
  outstandingBalance: Money;
  loanTerm: number;
  collectionFrequency: Frequency;
  loanStartDate: string;
  maturityDate: string;
  status: LoanStatus;
  purpose: string | null;
  createdAt: string;
  approvedAt: string | null;
  disbursedAt: string | null;
  closedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  agent: { id: number; name: string } | null;
}

export interface Installment {
  id: number;
  installmentNumber: number;
  dueDate: string;
  principalDue: Money;
  interestDue: Money;
  totalDue: Money;
  paidAmount: Money;
  outstandingAmount: Money;
  status: InstallmentStatus;
  effectiveStatus: InstallmentStatus;
  daysPastDue: number;
}

export interface LoanPaymentRow {
  id: number;
  receiptNumber: string;
  amount: Money;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  status: 'RECORDED' | 'REVERSED';
  collectedByName: string | null;
}

export interface AssignmentHistoryRow {
  id: number;
  agentId: number;
  agentName: string;
  assignedAt: string;
  unassignedAt: string | null;
  assignedByName: string | null;
  notes: string | null;
}

export interface LoanDetail extends Loan {
  createdBy: number | null;
  createdByName: string | null;
  approvedByName: string | null;
  disbursedByName: string | null;
  rejectedByName: string | null;
  summary: {
    paidAmount: Money;
    overdueAmount: Money;
    overdueInstallments: number;
    paidInstallments: number;
    nextDueDate: string | null;
  };
  schedule: Installment[];
  payments: LoanPaymentRow[];
  assignments: AssignmentHistoryRow[];
}

export interface SchedulePreview {
  totalInterest: Money;
  totalPayable: Money;
  maturityDate: string;
  installments: { installmentNumber: number; dueDate: string; principalDue: Money; interestDue: Money; totalDue: Money }[];
}

export interface Payment {
  id: number;
  receiptNumber: string;
  amount: Money;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  status: 'RECORDED' | 'REVERSED';
  notes: string | null;
  loanId: number;
  loanCode: string;
  customerId: number;
  customerCode: string;
  customerName: string;
  customerPhone: string;
  branchId: number;
  branchName: string;
  collectedById: number;
  collectedByName: string | null;
  recordedByName: string | null;
  createdAt: string;
  reversedAt: string | null;
  reversedByName: string | null;
  reversalReason: string | null;
}

export interface PaymentDetail extends Payment {
  loanOutstanding: Money;
  loanTotalPayable: Money;
  loanStatus: LoanStatus;
  branchAddress: string | null;
  branchPhone: string | null;
  companyName: string;
  currency: string;
  allocations: { scheduleId: number; installmentNumber: number; dueDate: string; dueAmount: Money; allocatedAmount: Money }[];
}

export interface PaymentSummary {
  recordedAmount: Money;
  recordedCount: number;
  reversedAmount: Money;
  reversedCount: number;
}

export interface Assignment {
  id: number;
  loanId: number;
  loanCode: string;
  loanStatus: LoanStatus;
  outstandingBalance: Money;
  customerName: string;
  branchId: number;
  branchName: string;
  agentId: number;
  agentName: string;
  assignedAt: string;
  assignedByName: string | null;
  unassignedAt: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'ENDED';
}

export interface Agent {
  id: number;
  name: string;
  branchId: number;
  branchName: string;
  activeLoans: number;
}

export interface DueInstallment {
  id: number;
  loanId: number;
  loanCode: string;
  loanStatus: LoanStatus;
  collectionFrequency: Frequency;
  customerId: number;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  branchName: string;
  installmentNumber: number;
  dueDate: string;
  dueAmount: Money;
  paidAmount: Money;
  outstandingAmount: Money;
  status: InstallmentStatus;
  daysPastDue: number;
  agentId: number | null;
  agentName: string | null;
}

export interface DueSummary {
  installments: number;
  dueAmount: Money;
  paidAmount: Money;
  outstandingAmount: Money;
  paidCount: number;
  partialCount: number;
  pendingCount: number;
  overdueCount: number;
  from: string;
  to: string;
}

export interface DailyTotal {
  day: string;
  dueAmount: Money;
  collectedAmount: Money;
  paymentCount: number;
}

export interface AgentSummary {
  agent: { id: number; name: string; branchId: number | null; branchName: string | null };
  assignedLoans: number;
  portfolioOutstanding: Money;
  dueTodayCount: number;
  dueTodayAmount: Money;
  dueTodayRemaining: Money;
  overdueCount: number;
  overdueAmount: Money;
  collectedToday: Money;
  paymentsToday: number;
  collectedThisMonth: Money;
  recentPayments: { id: number; receiptNumber: string; amount: Money; paymentDate: string; paymentMethod: PaymentMethod; status: string; loanCode: string; customerName: string }[];
}

export interface Expense {
  id: number;
  category: string;
  amount: Money;
  expenseDate: string;
  description: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  branchId: number | null;
  branchName: string | null;
  submittedBy: number;
  submittedByName: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export interface ExpenseSummary {
  approvedAmount: Money;
  pendingAmount: Money;
  pendingCount: number;
}

export interface AuditLog {
  id: number;
  createdAt: string;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

export interface Setting {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface DashboardSummary {
  totalCustomers: number;
  activeLoans: number;
  pendingApprovals: number;
  totalDisbursed: Money;
  totalOutstanding: Money;
  collectedToday: Money;
  collectedThisWeek: Money;
  dueToday: Money;
  overdueInstallments: number;
  overdueAmount: Money;
  collectionAchievementPercent: number | null;
  recentPayments: { id: number; receiptNumber: string; amount: Money; paymentDate: string; paymentMethod: PaymentMethod; status: string; loanCode: string; customerName: string }[];
  upcomingInstallments: { id: number; dueDate: string; outstandingAmount: Money; installmentNumber: number; loanId: number; loanCode: string; customerName: string }[];
  agentPerformance: { id: number; name: string; branchName: string | null; collected: Money; payments: number }[];
  branchPerformance: { id: number; branchName: string; collectedThisMonth: Money; outstanding: Money; overdue: Money }[];
  collectionTrend: { day: string; collected: Money; due: Money }[];
}

export type ReportColumnType = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent';

export interface ReportResult {
  title: string;
  from: string;
  to: string;
  columns: { key: string; label: string; type: ReportColumnType }[];
  rows: Record<string, unknown>[];
  totals: Record<string, string | number> | null;
  truncated: boolean;
}
