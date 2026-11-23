export type UserRole = 'master_admin' | 'company_admin' | 'company_operator' | 'company_viewer';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  companyId: string | null;
  companyName: string | null;
}

export interface CompanySummary {
  id: string;
  name: string;
  slug: string;
  industry: string;
  plan_tier: 'standard' | 'growth' | 'enterprise';
  status: 'active' | 'suspended';
  contact_email: string;
  storage_file: string;
  created_at: string;
  updated_at: string;
  userCount: number;
  totalSkus: number;
  totalUnits: number;
  totalValuation: number;
  outOfStockCount: number;
  lowStockCount: number;
  healthyCount: number;
  importBatchCount: number;
  rowsIngested: number;
  warehouseCount: number;
  storageBytes: number;
}

export interface TenantBreakdownItem {
  companyId: string;
  companyName: string;
  slug: string;
  industry: string;
  planTier: 'standard' | 'growth' | 'enterprise';
  status: 'active' | 'suspended';
  storageFile: string;
  userCount: number;
  healthPct: number;
  totalSkus: number;
  totalUnits: number;
  totalValuation: number;
  outOfStockCount: number;
  lowStockCount: number;
  healthyCount: number;
  importBatchCount: number;
  rowsIngested: number;
  warehouseCount: number;
  storageBytes: number;
}

export interface CategoryMetric {
  category: string;
  skus: number;
  units: number;
  valuation: number;
}

export interface WarehouseMetric {
  warehouse: string;
  skus: number;
  units: number;
  valuation: number;
}

export interface StockMovement {
  id: string;
  item_id: string;
  sku: string;
  item_name: string;
  delta: number;
  previous_qty: number;
  new_qty: number;
  reason: string;
  actor_username: string;
  created_at: string;
  companyId?: string;
  companyName?: string;
}

export interface ImportBatch {
  id: string;
  filename: string;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  actor_username: string;
  created_at: string;
  companyId?: string;
  companyName?: string;
}

export interface CrossTenantAnalytics {
  overview: {
    totalCompanies: number;
    activeCompanies: number;
    suspendedCompanies: number;
    totalSkus: number;
    totalUnits: number;
    totalValuation: number;
    lowStockCount: number;
    outOfStockCount: number;
    totalImports: number;
    totalStorageBytes: number;
  };
  tenantBreakdown: TenantBreakdownItem[];
  categories: CategoryMetric[];
  recentMovements: StockMovement[];
  recentImports: ImportBatch[];
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unit_price: number;
  reorder_level: number;
  warehouse: string;
  supplier: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface TenantAnalytics {
  company: {
    id: string;
    name: string;
    slug: string;
    industry: string;
    plan_tier: string;
    status: 'active' | 'suspended';
    storage_file: string;
  };
  summary: {
    totalSkus: number;
    totalUnits: number;
    totalValuation: number;
    outOfStockCount: number;
    lowStockCount: number;
    healthyCount: number;
    importBatchCount: number;
    rowsIngested: number;
    warehouseCount: number;
    storageBytes: number;
  };
  categories: CategoryMetric[];
  warehouses: WarehouseMetric[];
  lowStockItems: InventoryItem[];
  recentMovements: StockMovement[];
  recentImports: ImportBatch[];
}

export interface UserRecord {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: UserRole;
  company_id: string | null;
  company_name: string | null;
  status: 'active' | 'disabled';
  has_password: number | boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor_user_id: string;
  actor_username: string;
  actor_role: string;
  company_id: string | null;
  company_name: string | null;
  action: string;
  target_type: string;
  target_id: string;
  details_json: string;
  created_at: string;
}

export interface CsvImportResult {
  totalRows: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ row: number; sku: string; message: string }>;
}
