export type JobStatus = "pending" | "completed" | "cancelled";

/** Extra named cost line on a property (e.g. detergent, bags). */
export interface PropertyCostItem {
  id: string;
  label: string;
  amount: number;
}

export interface Owner {
  id: string;
  name: string;
  /** WhatsApp / mobile number (international format preferred) */
  whatsapp: string | null;
  /** Soft-delete — kept in backups and recoverable */
  archived?: boolean;
}

export type PropertySize =
  | "Monolocale"
  | "Bilocale"
  | "Trilocale"
  | "Quadrilocale"
  | "Quadrilocale +"
  /** @deprecated kept so existing client properties still load */
  | "Doppia"
  | "";

export interface Property {
  id: string;
  owner: string;
  name: string;
  /** Apartment size category */
  size: PropertySize;
  /** @deprecated prefer single_beds + double_beds; kept as total bed units */
  beds: number;
  single_beds: number;
  double_beds: number;
  /** Pillow covers needed per single bed */
  pillow_covers_single: number;
  /** Pillow covers needed per double bed */
  pillow_covers_double: number;
  /** Extra pillows beyond bed covers (count) */
  extra_pillows: number;
  /** What the owner is charged for a clean (EUR) */
  owner_amount: number;
  /** Total employee pay for this place per clean (EUR), split by team size */
  employee_pay_amount: number;
  /** @deprecated use owner_amount — kept in sync for older data */
  amount: number;
  /** Cost per single bed (EUR) */
  single_sheet_cost: number;
  /** Cost per double bed (EUR) */
  double_sheet_cost: number;
  /** Flat extra sheet cost for a clean (EUR) — Money section */
  extra_sheet_cost: number;
  /** Cost per extra pillow only — bed pillow covers are inventory, not billed */
  pillow_cost: number;
  /** Custom cost lines (label + price) */
  extra_costs: PropertyCostItem[];
  /** Sum of extra_costs — kept for job/product_cost snapshots */
  other_cost: number;
  /**
   * @deprecated legacy flat bedsheet total — kept for old data / reports.
   * Prefer single_sheet_cost + double_sheet_cost.
   */
  bedsheet_cost: number;
  /** @deprecated use other_cost / extra_costs */
  product_cost: number;
  archived?: boolean;
  created_at?: string;
  /** Bumped on edit/archive so sync can LWW soft-delete */
  updated_at?: string;
}

export interface Employee {
  id: string;
  name: string;
  phone: string | null;
  color_code: string;
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
  /** kept optional for older records */
  hourly_rate?: number;
  is_active?: boolean;
}

/** Snapshot fields keep history even if place/cleaner is later archived */
export interface JobAssignment {
  id: string;
  job_id: string;
  employee_id: string;
  employee_name: string;
  employees?: Employee;
}

export interface Job {
  id: string;
  property_id: string;
  date: string;
  status: JobStatus;
  linen_cost: number;
  product_cost: number;
  /** Snapshot: owner charge for this clean */
  charged_amount: number;
  /** Snapshot: employee pay pool for this clean (split by team) */
  employee_pay_amount: number;
  place_name: string;
  owner_name: string;
  /** Size snapshot for reports (Intervento) */
  place_size?: PropertySize;
  /** Day-specific bed counts (override property defaults) */
  single_beds: number;
  double_beds: number;
  /** Day snapshot: total pillow covers for single beds */
  pillow_covers_single: number;
  /** Day snapshot: total pillow covers for double beds */
  pillow_covers_double: number;
  /** Day snapshot: extra pillows count */
  extra_pillows: number;
  /** Day snapshot: flat extra sheet cost (EUR) */
  extra_sheet_cost: number;
  /** Day rate snapshots (override property rates for this day) */
  single_sheet_cost?: number;
  double_sheet_cost?: number;
  pillow_cost?: number;
  job_assignments: JobAssignment[];
  properties?: Property;
  notes?: string | null;
  hours_worked?: number;
  created_at?: string;
  /** Bumped on every local edit — used for schedule LWW sync (untick must stick). */
  updated_at?: string;
}

export interface ReportRow {
  date: string;
  place: string;
  owner: string;
  /** Distinguishes same-named places under different properties */
  propertyId?: string;
  /** Apartment size — shown as Intervento */
  size: string;
  cleaners: string;
  /** Owner base fee (Importo) */
  placePrice: number;
  /** Flat Extra cost (€) for the day */
  productCost: number;
  /** Flat Extra sheet cost (€) for the day */
  extraSheetCost: number;
  /** Full linen snapshot (sheets + extra pillows) — internal */
  otherCost: number;
  /** Extra pillows × per-extra-pillow rate (owner-facing add-on) */
  extraPillowCost: number;
  extraPillows: number;
  singleBeds: number;
  doubleBeds: number;
  pillowCoversSingle: number;
  pillowCoversDouble: number;
}

/** Compact employee summary: unique dates/places, total share of property amounts */
export interface EmployeeReportRow {
  employeeId: string;
  name: string;
  dates: string[];
  places: string[];
  amount: number;
}

/** Day view: one row per place cleaned that day */
export interface EmployeeDayPlaceRow {
  propertyId: string;
  place: string;
  employees: string[];
  teamSize: number;
  /** Employee pay ÷ team size (first share; cent-exact) */
  payByEmployee: number;
  /** When shares differ by a cent, show range e.g. "33,33–33,34 €" */
  payNote?: string;
  /** Full employee pay for the place */
  amount: number;
}

/** Default night schedule: propertyId → employeeIds (empty [] = place cleared). */
export type DefaultSchedule = Record<string, string[]>;

/** Application / company settings (you — not property owners) */
export interface AppSettings {
  company_name: string;
  whatsapp: string | null;
  /**
   * Bumped on intentional wipe / replace. Devices with a lower generation
   * replace local data from cloud instead of union-merging (so purged
   * test rows cannot resurrect).
   */
  sync_generation?: number;
}

export interface AppData {
  properties: Property[];
  employees: Employee[];
  jobs: Job[];
  owners: Owner[];
  /** Template used by Schedule → Apply default */
  default_schedule: DefaultSchedule;
  settings: AppSettings;
}

/** Loose typing for Supabase client — schema matches supabase/schema.sql */
export type Database = {
  public: {
    Tables: {
      properties: { Row: Property; Insert: Partial<Property>; Update: Partial<Property> };
      employees: { Row: Employee; Insert: Partial<Employee>; Update: Partial<Employee> };
      jobs: { Row: Job; Insert: Partial<Job>; Update: Partial<Job> };
      job_assignments: {
        Row: JobAssignment;
        Insert: Partial<JobAssignment>;
        Update: Partial<JobAssignment>;
      };
    };
  };
};

