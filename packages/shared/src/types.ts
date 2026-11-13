import type { Paise } from "./money";

export type Role = "owner" | "manager" | "staff";
export type Lang = "en" | "hi" | "kn";

export interface User {
  id: number;
  name: string;
  phone: string;
  role: Role;
  language: Lang;
  active: boolean;
}

export interface Staff {
  id: number;
  name: string;
  name_local: string | null;
  role: string;
  phone: string | null;
  pay_type: "monthly" | "daily" | "shift" | null;
  pay_rate: Paise | null;
  joined_on: string | null;
  active: boolean;
}

export interface Category {
  id: number;
  key: string;
  name_en: string;
  name_hi: string | null;
  name_kn: string | null;
  sort: number;
  active: boolean;
}

export type PayMode = "cash" | "online";

export interface Expense {
  id: number;
  business_date: string;
  trip_id: number | null;
  category_id: number;
  category_key?: string;
  category_name?: string;
  shop: string | null;
  amount: Paise;
  mode: PayMode;
  has_receipt: boolean;
  photo_key: string | null;
  note: string | null;
  created_by: number;
  created_by_name?: string;
  created_at: string;
}

export interface ShoppingTrip {
  id: number;
  business_date: string;
  manager_id: number;
  manager_name?: string;
  float_out: Paise;
  float_back: Paise | null;
  status: "open" | "closed";
  note: string | null;
  created_at: string;
  closed_at: string | null;
  spent?: Paise;
  count?: number;
}

export interface DayClose {
  id: number;
  business_date: string;
  total_counter: Paise;
  cash: Paise;
  online: Paise;
  expenses: Paise;
  pos_sales: Paise | null;
  note: string | null;
  memo_photo_key: string | null;
  pos_photo_key: string | null;
  submitted_by: number;
  submitted_by_name?: string;
  submitted_at: string;
  flags: CloseFlag[];
}

export type FlagCode =
  | "formula_mismatch"
  | "expenses_differ"
  | "pos_differs"
  | "no_memo_photo"
  | "late";

export interface CloseFlag {
  code: FlagCode;
  /** difference in paise where relevant */
  diff?: Paise;
}

export type AlertType =
  | "close_missing"
  | "close_flag"
  | "shopping_open"
  | "expense_high"
  | "month_close";

export interface Alert {
  id: number;
  type: AlertType;
  business_date: string;
  severity: "info" | "warn" | "critical";
  params: Record<string, string | number>;
  created_at: string;
  seen_at: string | null;
}

export interface Settings {
  close_due: string; // "01:45"
  close_escalate: string; // "10:00" next morning
  shopping_due: string; // "11:30"
  shopping_escalate: string; // "13:00"
  lock_hour: number; // 11
  cash_tolerance: Paise; // 20000 = ₹200
  shopping_tolerance: Paise; // 5000 = ₹50
}

export const DEFAULT_SETTINGS: Settings = {
  close_due: "01:45",
  close_escalate: "10:00",
  shopping_due: "11:30",
  shopping_escalate: "13:00",
  lock_hour: 11,
  cash_tolerance: 20_000,
  shopping_tolerance: 5_000,
};

export interface TodayStatus {
  business_date: string;
  locked: boolean;
  shopping: { status: "not_started" | "open" | "closed"; trip: ShoppingTrip | null };
  expenses: { count: number; total: Paise };
  close: { status: "pending" | "done"; close: DayClose | null };
  open_alerts: number;
}

export interface DaySummary {
  business_date: string;
  close: DayClose | null;
  /** same weekday one week earlier */
  compare: DayClose | null;
  expenses_entered: Paise;
  expenses_by_category: { key: string; name: string; amount: Paise }[];
  no_receipt_total: Paise;
  last7: { business_date: string; total_counter: Paise | null; expenses: Paise | null }[];
}
