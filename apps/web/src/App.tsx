import { PERMISSIONS } from '@monhorus/shared';
import type { ReactElement, ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { PermissionGuard } from './components/PermissionGuard';
import { ForbiddenState } from './components/ui/States';
import { ToastProvider } from './components/ui/ToastProvider';
import { AuthProvider, useAuth } from './contexts/auth-context';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { AccessPage } from './features/access/AccessPage';
import { AuditLogPage } from './features/audit/AuditLogPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { CustomerDetailPage } from './features/customers/CustomerDetailPage';
import { CustomerFormPage } from './features/customers/CustomerFormPage';
import { CustomerListPage } from './features/customers/CustomerListPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DispatchBoardPage } from './features/dispatch/DispatchBoardPage';
import { EmployeeDetailPage } from './features/employees/EmployeeDetailPage';
import { EmployeeFormPage } from './features/employees/EmployeeFormPage';
import { EmployeeListPage } from './features/employees/EmployeeListPage';
import { InspectionListPage } from './features/inspections/InspectionListPage';
import { InvoiceDetailPage } from './features/invoices/InvoiceDetailPage';
import { InvoiceListPage } from './features/invoices/InvoiceListPage';
import { NotFoundPage } from './features/NotFoundPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { InspectionReportPage } from './features/planned-work/InspectionReportPage';
import { PlannedWorkDetailPage } from './features/planned-work/PlannedWorkDetailPage';
import { PlannedWorkFormPage } from './features/planned-work/PlannedWorkFormPage';
import { PlannedWorkListPage } from './features/planned-work/PlannedWorkListPage';
import { PlannedWorkReportPage } from './features/planned-work/PlannedWorkReportPage';
import { MaterialsPage } from './features/materials/MaterialsPage';
import { ObjectTypesPage } from './features/object-master/ObjectTypesPage';
import { CompaniesPage } from './features/org/CompaniesPage';
import { DepartmentsPage } from './features/org/DepartmentsPage';
import { PositionsPage } from './features/org/PositionsPage';
import { BuildingDetailPage } from './features/projects/BuildingDetailPage';
import { FloorDetailPage } from './features/projects/FloorDetailPage';
import { ObjectDetailPage } from './features/projects/objects/ObjectDetailPage';
import { ObjectFormPage } from './features/projects/objects/ObjectFormPage';
import { ProjectDetailPage } from './features/projects/ProjectDetailPage';
import { ProjectFormPage } from './features/projects/ProjectFormPage';
import { ProjectListPage } from './features/projects/ProjectListPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { ServiceRequestCreatePage } from './features/service-requests/ServiceRequestCreatePage';
import { ServiceRequestDetailPage } from './features/service-requests/ServiceRequestDetailPage';
import { ServiceRequestListPage } from './features/service-requests/ServiceRequestListPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { PortalFloorPage } from './features/portal/PortalFloorPage';
import { PortalHomePage } from './features/portal/PortalHomePage';
import { PortalObjectDetailPage } from './features/portal/PortalObjectDetailPage';
import { PortalPlannedWorkDetailPage } from './features/portal/PortalPlannedWorkDetailPage';
import { PortalPlannedWorkListPage } from './features/portal/PortalPlannedWorkListPage';
import { PortalRequestCreatePage } from './features/portal/PortalRequestCreatePage';
import { PortalRequestDetailPage } from './features/portal/PortalRequestDetailPage';
import { PortalRequestListPage } from './features/portal/PortalRequestListPage';
import { PortalSiteDetailPage } from './features/portal/PortalSiteDetailPage';
import { PortalSitesPage } from './features/portal/PortalSitesPage';
import { homePathFor } from './lib/home-path';
import { ProtectedRoute } from './routes/ProtectedRoute';

/** Authenticated page inside the shell, gated by an any-of permission list. */
function Page({
  anyOf,
  children,
}: {
  anyOf: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][];
  children: ReactNode;
}): ReactElement {
  return (
    <ProtectedRoute>
      <AppShell>
        <PermissionGuard anyOf={anyOf}>{children}</PermissionGuard>
      </AppShell>
    </ProtectedRoute>
  );
}

/**
 * A portal page: the shell, the permission gate, and the CUSTOMER TIER.
 *
 * The tier check is not redundant with the permissions. SYSTEM_ADMIN is resynchronised to
 * the entire permission catalogue on every boot and `head_admin` is an unconditional
 * superuser, so both hold every `portal.*` key — the permission gate alone lets them
 * straight in. That matters beyond tidiness: `resolveCustomerScope` reads the tier, so a
 * staff caller reaching these screens gets STAFF scope, and the customer-styled request
 * list would quietly fill with EVERY organisation's records.
 *
 * The refusal is the same `ForbiddenState` every other guard renders, so a staff member who
 * follows an old link sees the app's normal "not for you" rather than a broken screen.
 */
function PortalPage({
  anyOf,
  children,
}: {
  anyOf: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][];
  children: ReactNode;
}): ReactElement {
  return (
    <ProtectedRoute>
      <AppShell>
        <CustomerOnly>
          <PermissionGuard anyOf={anyOf}>{children}</PermissionGuard>
        </CustomerOnly>
      </AppShell>
    </ProtectedRoute>
  );
}

export function CustomerOnly({ children }: { children: ReactNode }): ReactElement {
  const { user } = useAuth();
  if (user && user.role !== 'customer') return <ForbiddenState />;
  return <>{children}</>;
}

/** Sends a signed-in caller to the home their account actually has. */
function HomeRedirect(): ReactElement {
  const { user } = useAuth();
  return <Navigate to={homePathFor(user?.role)} replace />;
}

export default function App(): ReactElement {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/*
            Password recovery, unauthenticated by necessity — the whole point is that the
            caller cannot sign in. Both must stay outside ProtectedRoute, or the link in the
            email bounces the reader to the login screen they cannot get past.
          */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <Page anyOf={[PERMISSIONS.DASHBOARD_VIEW]}>
                <DashboardPage />
              </Page>
            }
          />

          <Route
            path="/employees"
            element={
              <Page anyOf={[PERMISSIONS.EMPLOYEE_VIEW]}>
                <EmployeeListPage />
              </Page>
            }
          />
          <Route
            path="/employees/new"
            element={
              <Page anyOf={[PERMISSIONS.EMPLOYEE_CREATE]}>
                <EmployeeFormPage />
              </Page>
            }
          />
          <Route
            path="/employees/:employeeId"
            element={
              <Page anyOf={[PERMISSIONS.EMPLOYEE_VIEW]}>
                <EmployeeDetailPage />
              </Page>
            }
          />
          <Route
            path="/employees/:employeeId/edit"
            element={
              <Page anyOf={[PERMISSIONS.EMPLOYEE_UPDATE]}>
                <EmployeeFormPage />
              </Page>
            }
          />


          <Route
            path="/customers"
            element={
              <Page anyOf={[PERMISSIONS.CUSTOMER_VIEW]}>
                <CustomerListPage />
              </Page>
            }
          />
          <Route
            path="/customers/new"
            element={
              <Page anyOf={[PERMISSIONS.CUSTOMER_MANAGE]}>
                <CustomerFormPage />
              </Page>
            }
          />
          <Route
            path="/customers/:customerId"
            element={
              <Page anyOf={[PERMISSIONS.CUSTOMER_VIEW]}>
                <CustomerDetailPage />
              </Page>
            }
          />
          <Route
            path="/customers/:customerId/edit"
            element={
              <Page anyOf={[PERMISSIONS.CUSTOMER_MANAGE]}>
                <CustomerFormPage />
              </Page>
            }
          />

          <Route
            path="/projects"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_VIEW]}>
                <ProjectListPage />
              </Page>
            }
          />
          <Route
            path="/projects/new"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MANAGE]}>
                <ProjectFormPage />
              </Page>
            }
          />
          <Route
            path="/projects/:projectId"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_VIEW]}>
                <ProjectDetailPage />
              </Page>
            }
          />
          <Route
            path="/projects/:projectId/edit"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MANAGE]}>
                <ProjectFormPage />
              </Page>
            }
          />
          <Route
            path="/buildings/:buildingId"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_VIEW]}>
                <BuildingDetailPage />
              </Page>
            }
          />
          <Route
            path="/floors/:floorId"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_VIEW]}>
                <FloorDetailPage />
              </Page>
            }
          />

          {/*
            Object instances live under their floor, not in a module of their own: the
            catalogue at /object-types is the product list, and an instance only exists as a
            placement on a floor. Every path here keeps the user inside the project module.
          */}
          <Route
            path="/floors/:floorId/objects/new"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MASTER_MANAGE]}>
                <ObjectFormPage />
              </Page>
            }
          />
          {/*
            Registration without walking down to a floor first.

            `floorId` has always been optional on the create endpoint and the service simply
            skips the floor when it is absent, so this route exposes what the API already
            allowed: the customer is chosen on the form and the floor is an optional field.
            The floor-anchored route above is unchanged and remains the way in from a floor.
          */}
          <Route
            path="/objects/new"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MASTER_MANAGE]}>
                <ObjectFormPage />
              </Page>
            }
          />
          <Route
            path="/floors/:floorId/objects/:objectId"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MASTER_VIEW]}>
                <ObjectDetailPage />
              </Page>
            }
          />
          <Route
            path="/floors/:floorId/objects/:objectId/edit"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MASTER_MANAGE]}>
                <ObjectFormPage />
              </Page>
            }
          />
          <Route
            path="/object-types"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MASTER_VIEW]}>
                <ObjectTypesPage />
              </Page>
            }
          />

          <Route
            path="/materials"
            element={
              <Page anyOf={[PERMISSIONS.MATERIAL_VIEW]}>
                <MaterialsPage />
              </Page>
            }
          />

          <Route
            path="/inspections"
            element={
              <Page anyOf={[PERMISSIONS.OBJECT_MASTER_VIEW]}>
                <InspectionListPage />
              </Page>
            }
          />

          <Route
            path="/invoices"
            element={
              <Page anyOf={[PERMISSIONS.INVOICE_VIEW]}>
                <InvoiceListPage />
              </Page>
            }
          />
          <Route
            path="/invoices/:invoiceId"
            element={
              <Page anyOf={[PERMISSIONS.INVOICE_VIEW]}>
                <InvoiceDetailPage />
              </Page>
            }
          />

          <Route
            path="/reports"
            element={
              <Page anyOf={[PERMISSIONS.REPORT_VIEW]}>
                <ReportsPage />
              </Page>
            }
          />

          <Route
            path="/notifications"
            element={
              <Page anyOf={[PERMISSIONS.NOTIFICATION_VIEW]}>
                <NotificationsPage />
              </Page>
            }
          />

          <Route
            path="/service-requests"
            element={
              <Page anyOf={[PERMISSIONS.SERVICE_REQUEST_VIEW]}>
                <ServiceRequestListPage />
              </Page>
            }
          />
          <Route
            path="/service-requests/new"
            element={
              <Page anyOf={[PERMISSIONS.SERVICE_REQUEST_CREATE]}>
                <ServiceRequestCreatePage />
              </Page>
            }
          />
          <Route
            path="/service-requests/dispatch"
            element={
              <Page anyOf={[PERMISSIONS.DISPATCH_VIEW]}>
                <DispatchBoardPage />
              </Page>
            }
          />
          <Route
            path="/service-requests/:requestId"
            element={
              <Page anyOf={[PERMISSIONS.SERVICE_REQUEST_VIEW]}>
                <ServiceRequestDetailPage />
              </Page>
            }
          />

          {/* The board moved under the request module; the old path still resolves. */}
          <Route path="/dispatch" element={<Navigate to="/service-requests/dispatch" replace />} />

          <Route
            path="/planned-work"
            element={
              <Page anyOf={[PERMISSIONS.PLANNED_WORK_VIEW]}>
                <PlannedWorkListPage />
              </Page>
            }
          />
          <Route
            path="/planned-work/new"
            element={
              <Page anyOf={[PERMISSIONS.PLANNED_WORK_CREATE]}>
                <PlannedWorkFormPage />
              </Page>
            }
          />
          <Route
            path="/planned-work/:plannedWorkId"
            element={
              <Page anyOf={[PERMISSIONS.PLANNED_WORK_VIEW]}>
                <PlannedWorkDetailPage />
              </Page>
            }
          />
          <Route
            path="/planned-work/:plannedWorkId/edit"
            element={
              <Page anyOf={[PERMISSIONS.PLANNED_WORK_UPDATE]}>
                <PlannedWorkFormPage />
              </Page>
            }
          />
          <Route
            path="/planned-work/:plannedWorkId/report"
            element={
              <Page anyOf={[PERMISSIONS.PLANNED_WORK_VIEW]}>
                <PlannedWorkReportPage />
              </Page>
            }
          />
          <Route
            path="/planned-work/:plannedWorkId/inspection-report"
            element={
              <Page anyOf={[PERMISSIONS.PLANNED_WORK_VIEW]}>
                <InspectionReportPage />
              </Page>
            }
          />

          <Route
            path="/calendar"
            element={
              <Page anyOf={[PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.SERVICE_REQUEST_VIEW]}>
                <CalendarPage />
              </Page>
            }
          />

          <Route
            path="/org/companies"
            element={
              <Page anyOf={[PERMISSIONS.ORG_VIEW]}>
                <CompaniesPage />
              </Page>
            }
          />
          <Route
            path="/org/departments"
            element={
              <Page anyOf={[PERMISSIONS.ORG_VIEW]}>
                <DepartmentsPage />
              </Page>
            }
          />
          <Route
            path="/org/positions"
            element={
              <Page anyOf={[PERMISSIONS.ORG_VIEW]}>
                <PositionsPage />
              </Page>
            }
          />

          <Route
            path="/access"
            element={
              <Page anyOf={[PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_VIEW]}>
                <AccessPage />
              </Page>
            }
          />
          <Route
            path="/settings"
            element={
              <Page anyOf={[PERMISSIONS.SETTINGS_VIEW]}>
                <SettingsPage />
              </Page>
            }
          />
          <Route
            path="/audit"
            element={
              <Page anyOf={[PERMISSIONS.AUDIT_VIEW]}>
                <AuditLogPage />
              </Page>
            }
          />

          {/*
            THE CUSTOMER PORTAL.

            Same three layers as every staff route — ProtectedRoute, AppShell,
            PermissionGuard — through the same `Page` helper, gated on the `portal.*` keys
            the backend already accepts. No separate auth path, no second guard component,
            no role branch: a customer is an ordinary authenticated caller whose permission
            set happens to be portal keys.
          */}
          <Route
            path="/portal"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW, PERMISSIONS.PORTAL_BUILDING_VIEW]}>
                <PortalHomePage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/requests"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW]}>
                <PortalRequestListPage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/requests/new"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE]}>
                <PortalRequestCreatePage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/requests/:requestId"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW]}>
                <PortalRequestDetailPage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/planned-work"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_PLANNED_WORK_VIEW]}>
                <PortalPlannedWorkListPage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/planned-work/new"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_PLANNED_WORK_CREATE]}>
                <PlannedWorkFormPage variant="portal" />
              </PortalPage>
            }
          />
          <Route
            path="/portal/planned-work/:plannedWorkId/edit"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_PLANNED_WORK_CREATE]}>
                <PlannedWorkFormPage variant="portal" />
              </PortalPage>
            }
          />
          <Route
            path="/portal/planned-work/:plannedWorkId"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_PLANNED_WORK_VIEW]}>
                <PortalPlannedWorkDetailPage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/sites"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_BUILDING_VIEW]}>
                <PortalSitesPage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/sites/:buildingId"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_BUILDING_VIEW]}>
                <PortalSiteDetailPage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/sites/:buildingId/floors/:floorId"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_FLOOR_VIEW]}>
                <PortalFloorPage />
              </PortalPage>
            }
          />
          <Route
            path="/portal/sites/:buildingId/floors/:floorId/objects/:objectId"
            element={
              <PortalPage anyOf={[PERMISSIONS.PORTAL_OBJECT_VIEW]}>
                <PortalObjectDetailPage />
              </PortalPage>
            }
          />

          {/*
            Wrapped in ProtectedRoute so the session has resolved before the destination is
            chosen: a bare `<Navigate>` would read a null user mid-restore and send every
            customer to the staff dashboard, which they are forbidden from.
          */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomeRedirect />
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <AppShell>
                  <NotFoundPage />
                </AppShell>
              </ProtectedRoute>
            }
          />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
