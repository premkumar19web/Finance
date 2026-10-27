import type { ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAuth, RequirePermission } from './auth/guards';
import { Layout } from './components/Layout';
import { EmptyState } from './components/ui';
import { AuditLogsPage } from './pages/admin/AuditLogsPage';
import { BranchesPage } from './pages/admin/BranchesPage';
import { RolesPage } from './pages/admin/RolesPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { AgentDashboardPage } from './pages/collections/AgentDashboardPage';
import { DailyCollectionsPage } from './pages/collections/DailyCollectionsPage';
import { WeeklyCollectionsPage } from './pages/collections/WeeklyCollectionsPage';
import { CustomerDetailPage } from './pages/customers/CustomerDetailPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { LoanDetailPage } from './pages/loans/LoanDetailPage';
import { LoansPage } from './pages/loans/LoansPage';
import { NewLoanPage } from './pages/loans/NewLoanPage';
import { LoginPage } from './pages/LoginPage';
import { PaymentDetailPage } from './pages/payments/PaymentDetailPage';
import { PaymentEntryPage } from './pages/payments/PaymentEntryPage';
import { PaymentsPage } from './pages/payments/PaymentsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReportsPage } from './pages/ReportsPage';

const guard = (any: string[], page: ReactNode) => <RequirePermission any={any}>{page}</RequirePermission>;

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth><Layout /></RequireAuth>,
    children: [
      { index: true, element: guard(['dashboard.view'], <DashboardPage />) },
      { path: 'agent', element: guard(['collections.view'], <AgentDashboardPage />) },
      { path: 'customers', element: guard(['customers.view'], <CustomersPage />) },
      { path: 'customers/:id', element: guard(['customers.view'], <CustomerDetailPage />) },
      { path: 'loans', element: guard(['loans.view'], <LoansPage />) },
      { path: 'loans/new', element: guard(['loans.create'], <NewLoanPage />) },
      { path: 'loans/:id', element: guard(['loans.view'], <LoanDetailPage />) },
      { path: 'collections/daily', element: guard(['collections.view'], <DailyCollectionsPage />) },
      { path: 'collections/weekly', element: guard(['collections.view'], <WeeklyCollectionsPage />) },
      { path: 'payments', element: guard(['payments.view'], <PaymentsPage />) },
      { path: 'payments/new', element: guard(['payments.create'], <PaymentEntryPage />) },
      { path: 'payments/:id', element: guard(['payments.view'], <PaymentDetailPage />) },
      { path: 'assignments', element: guard(['assignments.view'], <AssignmentsPage />) },
      { path: 'expenses', element: guard(['expenses.view'], <ExpensesPage />) },
      { path: 'reports', element: guard(['reports.view'], <ReportsPage />) },
      { path: 'branches', element: guard(['branches.view'], <BranchesPage />) },
      { path: 'users', element: guard(['users.view'], <UsersPage />) },
      { path: 'roles', element: guard(['roles.view'], <RolesPage />) },
      { path: 'audit-logs', element: guard(['audit.view'], <AuditLogsPage />) },
      { path: 'settings', element: guard(['settings.view'], <SettingsPage />) },
      { path: 'profile', element: <ProfilePage /> },
      { path: '*', element: <EmptyState icon="search" title="Page not found" message="Check the address or use the menu." /> },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
