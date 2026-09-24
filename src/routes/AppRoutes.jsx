import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { Loading } from '../components/Common';

const Login = lazy(() => import('../pages/Login'));
const NotFound = lazy(() => import('../pages/NotFound'));

const SuperAdminLayout = lazy(() => import('../layouts/SuperAdminLayout'));
const SuperAdminDashboard = lazy(() => import('../pages/superadmin/SuperAdminDashboard'));
const RestaurantsList = lazy(() => import('../pages/superadmin/RestaurantsList'));
const RestaurantDetail = lazy(() => import('../pages/superadmin/RestaurantDetail'));

const AdminLayout = lazy(() => import('../layouts/AdminLayout'));
const AdminDashboard = lazy(() => import('../pages/admin/AdminDashboard'));
const OrdersPage = lazy(() => import('../pages/admin/OrdersPage'));
const AdminKitchenPage = lazy(() => import('../pages/admin/AdminKitchenPage'));
const MenuPage = lazy(() => import('../pages/admin/MenuPage'));
const TablesPage = lazy(() => import('../pages/admin/TablesPage'));
const QRCodesPage = lazy(() => import('../pages/admin/QRCodesPage'));
const CustomersPage = lazy(() => import('../pages/admin/CustomersPage'));
const StaffPage = lazy(() => import('../pages/admin/StaffPage'));
const ReportsPage = lazy(() => import('../pages/admin/ReportsPage'));
const SettingsPage = lazy(() => import('../pages/admin/SettingsPage'));

const KitchenLayout = lazy(() => import('../layouts/KitchenLayout'));
const KitchenDashboard = lazy(() => import('../pages/kitchen/KitchenDashboard'));

const ReceptionLayout = lazy(() => import('../layouts/ReceptionLayout'));
const ReceptionDashboard = lazy(() => import('../pages/reception/ReceptionDashboard'));

const CustomerLayout = lazy(() => import('../pages/customer/CustomerLayout'));
const CustomerHomePage = lazy(() => import('../pages/customer/CustomerHomePage'));
const CustomerFullMenuPage = lazy(() => import('../pages/customer/CustomerFullMenuPage'));
const OrderStatusPage = lazy(() => import('../pages/customer/OrderStatusPage'));

export default function AppRoutes() {
  return (
    <Suspense fallback={<Loading fullPage label="Loading…" />}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />

        {/* Super Admin */}
        <Route
          path="/super-admin"
          element={
            <ProtectedRoute allowedRoles={['super_admin']}>
              <SuperAdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<SuperAdminDashboard />} />
          <Route path="restaurants" element={<RestaurantsList />} />
          <Route path="restaurants/:restaurantId" element={<RestaurantDetail />} />
        </Route>

        {/* Restaurant Owner/Admin */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['owner', 'admin']}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="kitchen" element={<AdminKitchenPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="tables" element={<TablesPage />} />
          <Route path="qr" element={<QRCodesPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Kitchen Staff */}
        <Route
          path="/kitchen"
          element={
            <ProtectedRoute allowedRoles={['kitchen', 'owner', 'admin']}>
              <KitchenLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<KitchenDashboard />} />
        </Route>

        {/* Reception / Cashier */}
        <Route
          path="/reception"
          element={
            <ProtectedRoute allowedRoles={['reception', 'owner', 'admin']}>
              <ReceptionLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<ReceptionDashboard />} />
        </Route>

        {/* Customer (guest, QR-driven) */}
        <Route path="/r/:restaurantSlug/table/:tableNumber" element={<CustomerLayout />}>
          <Route index element={<CustomerHomePage />} />
          <Route path="menu" element={<CustomerFullMenuPage />} />
        </Route>
        <Route path="/menu" element={<CustomerLayout />}>
          <Route index element={<CustomerHomePage />} />
          <Route path="menu" element={<CustomerFullMenuPage />} />
        </Route>
        <Route path="/order/:orderId" element={<OrderStatusPage />} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
