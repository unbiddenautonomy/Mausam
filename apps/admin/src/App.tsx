import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { useSession } from "./lib/session";
import { Login, PosOnly } from "./pages/Login";
import { Today } from "./pages/Today";
import { EntriesHub } from "./pages/EntriesHub";
import { Shopping } from "./pages/Shopping";
import { AddExpense } from "./pages/AddExpense";
import { Expenses } from "./pages/Expenses";
import { CloseDay } from "./pages/CloseDay";
import { History } from "./pages/History";
import { Unsent } from "./pages/Unsent";
import { Alerts } from "./pages/Alerts";
import { More } from "./pages/More";
import { ReportsHub } from "./pages/reports/ReportsHub";
import { Advances, Attendance, Payroll, PeopleHub } from "./pages/people/People";
import { VendorDetail, VendorList } from "./pages/vendors/Vendors";
import { MonthClose } from "./pages/Month";
const CostsReport = lazy(() => import("./pages/reports/CostsReport").then((m) => ({ default: m.CostsReport })));
const ItemsReport = lazy(() => import("./pages/reports/ItemsReport").then((m) => ({ default: m.ItemsReport })));
const PricesReport = lazy(() => import("./pages/reports/PricesReport").then((m) => ({ default: m.PricesReport })));
import { AuditPage } from "./pages/manage/Audit";
const PosImport = lazy(() => import("./pages/manage/PosImport").then((m) => ({ default: m.PosImport })));
const SalesReport = lazy(() => import("./pages/reports/SalesReport").then((m) => ({ default: m.SalesReport })));
const ExpenseReport = lazy(() => import("./pages/reports/ExpenseReport").then((m) => ({ default: m.ExpenseReport })));
const PaymentsReport = lazy(() => import("./pages/reports/PaymentsReport").then((m) => ({ default: m.PaymentsReport })));
const ReportingReport = lazy(() => import("./pages/reports/ReportingReport").then((m) => ({ default: m.ReportingReport })));
import { ManageHub } from "./pages/manage/ManageHub";
import { Users } from "./pages/manage/Users";
import { StaffPage } from "./pages/manage/Staff";
import { Categories } from "./pages/manage/Categories";
import { SettingsPage } from "./pages/manage/Settings";
import { MenuPage } from "./pages/pos/Menu";
import { TablesPage } from "./pages/pos/Tables";
import { BillsPage } from "./pages/pos/Bills";
import { WaitersPage } from "./pages/pos/Waiters";
import { PosOptionsPage } from "./pages/pos/PosOptions";
const CancellationsReport = lazy(() => import("./pages/reports/CancellationsReport").then((m) => ({ default: m.CancellationsReport })));
const ItemSalesReport = lazy(() => import("./pages/reports/ItemSalesReport").then((m) => ({ default: m.ItemSalesReport })));
const OrderTypesReport = lazy(() => import("./pages/reports/OrderTypesReport").then((m) => ({ default: m.OrderTypesReport })));
const WaitersReport = lazy(() => import("./pages/reports/WaitersReport").then((m) => ({ default: m.WaitersReport })));

export function App() {
  const { user, ready } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <BrowserRouter><Login /></BrowserRouter>;
  // Employees only bill at the counter, in the POS; this app is for the owner and managers.
  if (user.role === "staff") return <PosOnly />;
  const owner = user.role === "owner";
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Today />} />
          <Route path="entries" element={<EntriesHub />} />
          <Route path="entries/shopping" element={<Shopping />} />
          <Route path="entries/expenses" element={<Expenses />} />
          <Route path="entries/expenses/new" element={<AddExpense />} />
          <Route path="entries/close" element={<CloseDay />} />
          <Route path="entries/close/:date" element={<CloseDay />} />
          <Route path="entries/history" element={<History />} />
          <Route path="entries/unsent" element={<Unsent />} />
          <Route path="people" element={<PeopleHub />} />
          <Route path="people/attendance" element={<Attendance />} />
          <Route path="people/advances" element={<Advances />} />
          <Route path="vendors" element={<VendorList />} />
          <Route path="vendors/:id" element={<VendorDetail />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="more" element={<More />} />
          {(owner || user.role === "manager") && (
            <>
              <Route path="bills" element={<BillsPage />} />
              {/* Managers: the basic reports always; the rest show data only while the owner shares analytics for the month. */}
              <Route path="reports" element={<ReportsHub />} />
              <Route path="reports/sales" element={<Suspense fallback={<Loading />}><SalesReport /></Suspense>} />
              <Route path="reports/expenses" element={<Suspense fallback={<Loading />}><ExpenseReport /></Suspense>} />
              <Route path="reports/payments" element={<Suspense fallback={<Loading />}><PaymentsReport /></Suspense>} />
              <Route path="reports/reporting" element={<Suspense fallback={<Loading />}><ReportingReport /></Suspense>} />
              <Route path="reports/costs" element={<Suspense fallback={<Loading />}><CostsReport /></Suspense>} />
              <Route path="reports/items" element={<Suspense fallback={<Loading />}><ItemsReport /></Suspense>} />
              <Route path="reports/prices" element={<Suspense fallback={<Loading />}><PricesReport /></Suspense>} />
              <Route path="reports/waiters" element={<Suspense fallback={<Loading />}><WaitersReport /></Suspense>} />
              <Route path="reports/cancellations" element={<Suspense fallback={<Loading />}><CancellationsReport /></Suspense>} />
              <Route path="reports/item-sales" element={<Suspense fallback={<Loading />}><ItemSalesReport /></Suspense>} />
              <Route path="reports/order-types" element={<Suspense fallback={<Loading />}><OrderTypesReport /></Suspense>} />
            </>
          )}
          {owner && (
            <>
              <Route path="people/pay" element={<Payroll />} />
              <Route path="month" element={<MonthClose />} />
              <Route path="manage/audit" element={<AuditPage />} />
              <Route path="manage" element={<ManageHub />} />
              <Route path="manage/users" element={<Users />} />
              <Route path="manage/staff" element={<StaffPage />} />
              <Route path="manage/categories" element={<Categories />} />
              <Route path="manage/settings" element={<SettingsPage />} />
              <Route path="manage/menu" element={<MenuPage />} />
              <Route path="manage/tables" element={<TablesPage />} />
              <Route path="manage/waiters" element={<WaitersPage />} />
              <Route path="manage/pos" element={<PosOptionsPage />} />
              <Route path="manage/import" element={<Suspense fallback={<Loading />}><PosImport /></Suspense>} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
