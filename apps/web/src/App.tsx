import { PERMISSIONS } from '@monhorus/shared';
import type { ReactElement, ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/layout/AppShell';
import { PermissionGuard } from './components/PermissionGuard';
import { ToastProvider } from './components/ui/ToastProvider';
import { AuthProvider, useAuth } from './contexts/auth-context';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';
import { LoginPage } from './features/auth/LoginPage';
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
import { ObjectTypesPage } from './features/object-master/ObjectTypesPage';
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
              <Page anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW, PERMISSIONS.PORTAL_BUILDING_VIEW]}>
                <PortalHomePage />
              </Page>
            }
          />
          <Route
            path="/portal/requests"
            element={
              <Page anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW]}>
                <PortalRequestListPage />
              </Page>
            }
          />
          <Route
            path="/portal/requests/new"
            element={
              <Page anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE]}>
                <PortalRequestCreatePage />
              </Page>
            }
          />
          <Route
            path="/portal/requests/:requestId"
            element={
              <Page anyOf={[PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW]}>
                <PortalRequestDetailPage />
              </Page>
            }
          />
          <Route
            path="/portal/sites"
            element={
              <Page anyOf={[PERMISSIONS.PORTAL_BUILDING_VIEW]}>
                <PortalSitesPage />
              </Page>
            }
          />
          <Route
            path="/portal/sites/:buildingId"
            element={
              <Page anyOf={[PERMISSIONS.PORTAL_BUILDING_VIEW]}>
                <PortalSiteDetailPage />
              </Page>
            }
          />
          <Route
            path="/portal/sites/:buildingId/floors/:floorId"
            element={
              <Page anyOf={[PERMISSIONS.PORTAL_FLOOR_VIEW]}>
                <PortalFloorPage />
              </Page>
            }
          />
          <Route
            path="/portal/sites/:buildingId/floors/:floorId/objects/:objectId"
            element={
              <Page anyOf={[PERMISSIONS.PORTAL_OBJECT_VIEW]}>
                <PortalObjectDetailPage />
              </Page>
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
