import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { useSession } from "./lib/session";
import { Login } from "./pages/Login";
import { Today } from "./pages/Today";
import { EntriesHub } from "./pages/EntriesHub";
import { Shopping } from "./pages/Shopping";
import { AddExpense } from "./pages/AddExpense";
import { Expenses } from "./pages/Expenses";
import { CloseDay } from "./pages/CloseDay";
import { History } from "./pages/History";
import { Alerts } from "./pages/Alerts";
import { More } from "./pages/More";
import { ReportsHub } from "./pages/reports/ReportsHub";
import { Advances, Attendance, Payroll, PeopleHub } from "./pages/people/People";
import { VendorDetail, VendorList } from "./pages/vendors/Vendors";
const SalesReport = lazy(() => import("./pages/reports/SalesReport").then((m) => ({ default: m.SalesReport })));
const ExpenseReport = lazy(() => import("./pages/reports/ExpenseReport").then((m) => ({ default: m.ExpenseReport })));
const PaymentsReport = lazy(() => import("./pages/reports/PaymentsReport").then((m) => ({ default: m.PaymentsReport })));
const ReportingReport = lazy(() => import("./pages/reports/ReportingReport").then((m) => ({ default: m.ReportingReport })));
import { ManageHub } from "./pages/manage/ManageHub";
import { Users } from "./pages/manage/Users";
import { StaffPage } from "./pages/manage/Staff";
import { Categories } from "./pages/manage/Categories";
import { SettingsPage } from "./pages/manage/Settings";

export function App() {
  const { user, ready } = useSession();
  if (!ready) return <Loading />;
  if (!user) return <BrowserRouter><Login /></BrowserRouter>;
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
          <Route path="people" element={<PeopleHub />} />
          <Route path="people/attendance" element={<Attendance />} />
          <Route path="people/advances" element={<Advances />} />
          <Route path="vendors" element={<VendorList />} />
          <Route path="vendors/:id" element={<VendorDetail />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="more" element={<More />} />
          {owner && (
            <>
              <Route path="reports" element={<ReportsHub />} />
              <Route path="reports/sales" element={<Suspense fallback={<Loading />}><SalesReport /></Suspense>} />
              <Route path="reports/expenses" element={<Suspense fallback={<Loading />}><ExpenseReport /></Suspense>} />
              <Route path="reports/payments" element={<Suspense fallback={<Loading />}><PaymentsReport /></Suspense>} />
              <Route path="reports/reporting" element={<Suspense fallback={<Loading />}><ReportingReport /></Suspense>} />
              <Route path="people/pay" element={<Payroll />} />
              <Route path="manage" element={<ManageHub />} />
              <Route path="manage/users" element={<Users />} />
              <Route path="manage/staff" element={<StaffPage />} />
              <Route path="manage/categories" element={<Categories />} />
              <Route path="manage/settings" element={<SettingsPage />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
