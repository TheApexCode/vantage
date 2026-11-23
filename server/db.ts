import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { hashPassword, INITIAL_MASTER_ADMIN_HASH, UserRole } from './crypto.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TENANTS_DIR = path.resolve(DATA_DIR, 'tenants');
const PLATFORM_DB_PATH = path.resolve(DATA_DIR, 'platform.db');

fs.mkdirSync(TENANTS_DIR, { recursive: true });

export const platformDb = new Database(PLATFORM_DB_PATH);
platformDb.pragma('journal_mode = WAL');
platformDb.pragma('foreign_keys = ON');

platformDb.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    industry TEXT NOT NULL DEFAULT 'Logistics & Distribution',
    plan_tier TEXT NOT NULL DEFAULT 'enterprise' CHECK (plan_tier IN ('standard', 'growth', 'enterprise')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    contact_email TEXT NOT NULL DEFAULT '',
    storage_file TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('master_admin', 'company_admin', 'company_operator', 'company_viewer')),
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    token_version INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    company_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
  CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_logs(company_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
`);

const tenantDbCache = new Map<string, Database.Database>();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertValidCompanyId(companyId: string): string {
  if (!UUID_REGEX.test(companyId)) {
    throw new Error('Invalid company identifier');
  }
  return companyId.toLowerCase();
}

export function getTenantDbPath(companyId: string): string {
  const safeId = assertValidCompanyId(companyId);
  const resolved = path.resolve(TENANTS_DIR, `${safeId}.db`);
  if (!resolved.startsWith(TENANTS_DIR + path.sep)) {
    throw new Error('Resolved tenant database path escapes confinement directory');
  }
  return resolved;
}

export function getTenantDb(companyId: string): Database.Database {
  const safeId = assertValidCompanyId(companyId);
  const cached = tenantDbCache.get(safeId);
  if (cached && cached.open) {
    return cached;
  }

  const dbPath = getTenantDbPath(safeId);
  const tenantDb = new Database(dbPath);
  tenantDb.pragma('journal_mode = WAL');
  tenantDb.pragma('foreign_keys = ON');

  tenantDb.exec(`
    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'pcs',
      unit_price REAL NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 10,
      warehouse TEXT NOT NULL DEFAULT 'Main Hub',
      supplier TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      item_name TEXT NOT NULL,
      delta INTEGER NOT NULL,
      previous_qty INTEGER NOT NULL,
      new_qty INTEGER NOT NULL,
      reason TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      inserted_count INTEGER NOT NULL,
      updated_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      error_count INTEGER NOT NULL,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_inv_category ON inventory_items(category);
    CREATE INDEX IF NOT EXISTS idx_inv_warehouse ON inventory_items(warehouse);
    CREATE INDEX IF NOT EXISTS idx_mov_created ON stock_movements(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_imp_created ON import_batches(created_at DESC);
  `);

  tenantDbCache.set(safeId, tenantDb);
  return tenantDb;
}

export function closeAndDeleteTenantDb(companyId: string): void {
  const safeId = assertValidCompanyId(companyId);
  const cached = tenantDbCache.get(safeId);
  if (cached) {
    try {
      cached.close();
    } catch {
      // ignore close errors
    }
    tenantDbCache.delete(safeId);
  }
  const dbPath = getTenantDbPath(safeId);
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

export function getTenantStorageBytes(companyId: string): number {
  try {
    const dbPath = getTenantDbPath(companyId);
    if (fs.existsSync(dbPath)) {
      return fs.statSync(dbPath).size;
    }
  } catch {
    return 0;
  }
  return 0;
}

export function recordAuditLog(entry: {
  actorUserId: string;
  actorUsername: string;
  actorRole: UserRole | string;
  companyId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}): void {
  platformDb
    .prepare(
      `INSERT INTO audit_logs (
        id, actor_user_id, actor_username, actor_role, company_id,
        action, target_type, target_id, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      crypto.randomUUID(),
      entry.actorUserId,
      entry.actorUsername,
      entry.actorRole,
      entry.companyId,
      entry.action,
      entry.targetType,
      entry.targetId,
      JSON.stringify(entry.details ?? {}),
      new Date().toISOString()
    );
}

export function bootstrapPlatform(): void {
  const now = new Date().toISOString();
  const envMasterPass = process.env.MASTER_ADMIN_PASSWORD?.trim();

  const existingMaster = platformDb
    .prepare(`SELECT id FROM users WHERE username = 'master_admin'`)
    .get() as { id: string } | undefined;

  if (!existingMaster) {
    const passwordHash = envMasterPass ? hashPassword(envMasterPass) : INITIAL_MASTER_ADMIN_HASH;
    platformDb
      .prepare(
        `INSERT INTO users (
          id, username, full_name, email, password_hash, role, company_id, status, token_version, created_at
        ) VALUES (?, ?, ?, ?, ?, 'master_admin', NULL, 'active', 1, ?)`
      )
      .run(
        crypto.randomUUID(),
        'master_admin',
        'Platform Master Administrator',
        'admin@vantagestock.internal',
        passwordHash,
        now
      );
  } else if (envMasterPass) {
    // Allow explicit environment secret override if provided
    platformDb
      .prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
      .run(hashPassword(envMasterPass), existingMaster.id);
  }

  // Seed initial showcase multi-tenant companies only if platform has zero companies
  const companyCount = (
    platformDb.prepare(`SELECT COUNT(*) as cnt FROM companies`).get() as { cnt: number }
  ).cnt;

  if (companyCount === 0) {
    const seedCompanies = [
      {
        id: '11111111-1111-4111-8111-111111111101',
        name: 'Nordic Precision Components',
        slug: 'nordic-precision',
        industry: 'Industrial Manufacturing',
        plan_tier: 'enterprise',
        contact_email: 'ops@nordicprecision.io',
        adminUsername: 'nordic_admin',
        adminName: 'Henrik Lindqvist',
        items: [
          { sku: 'NPC-BRG-401', name: 'Ceramic Hybrid Spindle Bearing 40mm', category: 'Bearings', quantity: 420, unit: 'pcs', unit_price: 84.5, reorder_level: 80, warehouse: 'Gothenburg North', supplier: 'SKF Industrial' },
          { sku: 'NPC-SRV-880', name: 'Brushless Servo Actuator 1.2kW', category: 'Motion Control', quantity: 18, unit: 'pcs', unit_price: 640.0, reorder_level: 25, warehouse: 'Gothenburg North', supplier: 'Bosch Rexroth' },
          { sku: 'NPC-CNC-112', name: 'Carbide End Mill 12mm 5-Flute', category: 'Tooling', quantity: 950, unit: 'pcs', unit_price: 38.25, reorder_level: 150, warehouse: 'Malmo Hub', supplier: 'Sandvik Coromant' },
          { sku: 'NPC-VAL-209', name: 'Proportional Hydraulic Valve 24V', category: 'Hydraulics', quantity: 0, unit: 'pcs', unit_price: 315.0, reorder_level: 15, warehouse: 'Gothenburg North', supplier: 'Parker Hannifin' },
          { sku: 'NPC-ALU-707', name: '7075-T6 Billet Plate 300x300mm', category: 'Raw Materials', quantity: 145, unit: 'sheets', unit_price: 112.0, reorder_level: 40, warehouse: 'Malmo Hub', supplier: 'Hydro Aluminium' },
        ],
      },
      {
        id: '22222222-2222-4222-8222-222222222202',
        name: 'Vanguard Cold-Chain Pharma',
        slug: 'vanguard-pharma',
        industry: 'Healthcare & Cold Chain',
        plan_tier: 'enterprise',
        contact_email: 'supply@vanguardpharma.com',
        adminUsername: 'vanguard_admin',
        adminName: 'Elena Rostova',
        items: [
          { sku: 'VCP-VIAL-10M', name: 'Borosilicate Type-I Sterile Vials 10mL', category: 'Primary Packaging', quantity: 14500, unit: 'pcs', unit_price: 1.45, reorder_level: 3000, warehouse: 'Basel Cold Vault A', supplier: 'Schott Pharma' },
          { sku: 'VCP-CRYO-90', name: 'Ultra-Low Phase Change Gel Pack -20C', category: 'Thermal Control', quantity: 310, unit: 'units', unit_price: 29.0, reorder_level: 400, warehouse: 'Basel Cold Vault A', supplier: 'Cryopak' },
          { sku: 'VCP-LOG-502', name: 'NFC Cold-Chain Temperature Logger', category: 'Telemetry Hardware', quantity: 640, unit: 'pcs', unit_price: 42.0, reorder_level: 120, warehouse: 'Zurich Dispatch', supplier: 'Sensitech' },
          { sku: 'VCP-FLT-022', name: '0.22 Micron Sterile PES Filter Cartridge', category: 'Filtration', quantity: 85, unit: 'pcs', unit_price: 185.0, reorder_level: 50, warehouse: 'Basel Cold Vault A', supplier: 'Sartorius' },
          { sku: 'VCP-SYR-005', name: 'Pre-fillable Polymer Syringe Barrel 5mL', category: 'Primary Packaging', quantity: 0, unit: 'pcs', unit_price: 3.1, reorder_level: 1000, warehouse: 'Zurich Dispatch', supplier: 'West Pharma' },
        ],
      },
      {
        id: '33333333-3333-4333-8333-333333333303',
        name: 'Meridian Urban Mobility',
        slug: 'meridian-mobility',
        industry: 'EV & Fleet Hardware',
        plan_tier: 'growth',
        contact_email: 'fleet@meridianmobility.co',
        adminUsername: 'meridian_admin',
        adminName: 'Marcus Vance',
        items: [
          { sku: 'MUM-BAT-48V', name: '48V 20Ah Swappable LFP Battery Pack', category: 'Powertrains', quantity: 124, unit: 'packs', unit_price: 495.0, reorder_level: 30, warehouse: 'Rotterdam Depot', supplier: 'CATL Modules' },
          { sku: 'MUM-HUB-350', name: '350W Planetary Geared Hub Motor', category: 'Drivetrain', quantity: 58, unit: 'pcs', unit_price: 168.0, reorder_level: 25, warehouse: 'Rotterdam Depot', supplier: 'Bafang OEM' },
          { sku: 'MUM-BRK-180', name: 'Hydraulic Disc Caliper Assembly 180mm', category: 'Braking', quantity: 210, unit: 'sets', unit_price: 54.0, reorder_level: 60, warehouse: 'Amsterdam Service', supplier: 'Tektro' },
          { sku: 'MUM-IOT-910', name: 'LTE-M Fleet Telematics Gateway Module', category: 'Electronics', quantity: 14, unit: 'pcs', unit_price: 132.0, reorder_level: 20, warehouse: 'Amsterdam Service', supplier: 'Quectel' },
        ],
      },
    ];

    const insertCompany = platformDb.prepare(
      `INSERT INTO companies (id, name, slug, industry, plan_tier, status, contact_email, storage_file, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    );
    const insertUser = platformDb.prepare(
      `INSERT INTO users (id, username, full_name, email, password_hash, role, company_id, status, token_version, created_at)
       VALUES (?, ?, ?, ?, ?, 'company_admin', ?, 'active', 1, ?)`
    );

    for (const c of seedCompanies) {
      const storageFile = `${c.id}.db`;
      insertCompany.run(
        c.id,
        c.name,
        c.slug,
        c.industry,
        c.plan_tier,
        c.contact_email,
        storageFile,
        now,
        now
      );

      // Seeded company admin starts disabled until master_admin sets their password via Users & RBAC
      insertUser.run(
        crypto.randomUUID(),
        c.adminUsername,
        c.adminName,
        c.contact_email,
        '',
        c.id,
        now
      );

      const tDb = getTenantDb(c.id);
      const insertItem = tDb.prepare(
        `INSERT INTO inventory_items (
          id, sku, name, category, quantity, unit, unit_price, reorder_level, warehouse, supplier, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system_seed', ?, ?)`
      );
      const insertMov = tDb.prepare(
        `INSERT INTO stock_movements (
          id, item_id, sku, item_name, delta, previous_qty, new_qty, reason, actor_username, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, 'Initial Tenant Provisioning', 'master_admin', ?)`
      );

      const tx = tDb.transaction(() => {
        for (const item of c.items) {
          const itemId = crypto.randomUUID();
          insertItem.run(
            itemId,
            item.sku,
            item.name,
            item.category,
            item.quantity,
            item.unit,
            item.unit_price,
            item.reorder_level,
            item.warehouse,
            item.supplier,
            now,
            now
          );
          if (item.quantity > 0) {
            insertMov.run(crypto.randomUUID(), itemId, item.sku, item.name, item.quantity, item.quantity, now);
          }
        }
        tDb.prepare(
          `INSERT INTO import_batches (id, filename, total_rows, inserted_count, updated_count, skipped_count, error_count, actor_username, created_at)
           VALUES (?, ?, ?, ?, 0, 0, 0, 'master_admin', ?)`
        ).run(crypto.randomUUID(), `${c.slug}-initial-catalog.csv`, c.items.length, c.items.length, now);
      });
      tx();
    }
  }
}
