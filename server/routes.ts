import { parse as parseCsvSync } from 'csv-parse/sync';
import crypto from 'crypto';
import { Express, Request, Response } from 'express';
import { hashPassword, signSessionToken, UserRole, verifyPassword } from './crypto.ts';
import {
  assertValidCompanyId,
  closeAndDeleteTenantDb,
  getTenantDb,
  getTenantStorageBytes,
  platformDb,
  recordAuditLog,
} from './db.ts';
import { authenticate, requireRole, resolveTenantAccess } from './middleware.ts';

const VALID_COMPANY_ROLES: UserRole[] = ['company_admin', 'company_operator', 'company_viewer'];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function escapeCsvCell(val: string | number | null | undefined): string {
  let str = val === null || val === undefined ? '' : String(val);
  // Neutralize spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

interface CompanyRow {
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
}

function summarizeTenantInventory(companyId: string) {
  const tDb = getTenantDb(companyId);
  const stats = tDb
    .prepare(
      `SELECT
         COUNT(*) AS totalSkus,
         COALESCE(SUM(quantity), 0) AS totalUnits,
         COALESCE(SUM(quantity * unit_price), 0) AS totalValuation,
         SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) AS outOfStockCount,
         SUM(CASE WHEN quantity > 0 AND quantity <= reorder_level THEN 1 ELSE 0 END) AS lowStockCount
       FROM inventory_items`
    )
    .get() as {
    totalSkus: number;
    totalUnits: number;
    totalValuation: number;
    outOfStockCount: number;
    lowStockCount: number;
  };

  const importStats = tDb
    .prepare(
      `SELECT COUNT(*) AS batchCount, COALESCE(SUM(inserted_count + updated_count), 0) AS rowsIngested
       FROM import_batches`
    )
    .get() as { batchCount: number; rowsIngested: number };

  const warehouseCount = (
    tDb.prepare(`SELECT COUNT(DISTINCT warehouse) AS cnt FROM inventory_items`).get() as {
      cnt: number;
    }
  ).cnt;

  return {
    totalSkus: stats.totalSkus || 0,
    totalUnits: stats.totalUnits || 0,
    totalValuation: Number((stats.totalValuation || 0).toFixed(2)),
    outOfStockCount: stats.outOfStockCount || 0,
    lowStockCount: stats.lowStockCount || 0,
    healthyCount: Math.max(0, (stats.totalSkus || 0) - (stats.outOfStockCount || 0) - (stats.lowStockCount || 0)),
    importBatchCount: importStats.batchCount || 0,
    rowsIngested: importStats.rowsIngested || 0,
    warehouseCount: warehouseCount || 0,
    storageBytes: getTenantStorageBytes(companyId),
  };
}

export function registerRoutes(app: Express): void {
  // Health endpoint (non-authenticated)
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // ---------------------------------------------------------------------------
  // Authentication & Account Security
  // ---------------------------------------------------------------------------
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = platformDb
      .prepare(
        `SELECT u.id, u.username, u.full_name, u.email, u.password_hash, u.role, u.company_id,
                u.status, u.token_version, c.name AS company_name, c.status AS company_status
         FROM users u
         LEFT JOIN companies c ON u.company_id = c.id
         WHERE u.username = ?`
      )
      .get(username) as
      | {
          id: string;
          username: string;
          full_name: string;
          email: string;
          password_hash: string;
          role: UserRole;
          company_id: string | null;
          status: string;
          token_version: number;
          company_name: string | null;
          company_status: 'active' | 'suspended' | null;
        }
      | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    if (user.status !== 'active') {
      res.status(403).json({ error: 'This user account has been disabled by an administrator' });
      return;
    }

    if (user.role !== 'master_admin' && (!user.company_id || user.company_status !== 'active')) {
      res.status(403).json({ error: 'Your company workspace is currently suspended' });
      return;
    }

    const now = new Date().toISOString();
    platformDb.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(now, user.id);

    const token = signSessionToken({
      sub: user.id,
      username: user.username,
      role: user.role,
      companyId: user.company_id,
      ver: user.token_version,
    });

    recordAuditLog({
      actorUserId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      companyId: user.company_id,
      action: 'USER_LOGIN',
      targetType: 'user',
      targetId: user.id,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        companyName: user.company_name,
      },
    });
  });

  app.get('/api/auth/me', authenticate, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/change-password', authenticate, (req: Request, res: Response) => {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters' });
      return;
    }

    const row = platformDb
      .prepare(`SELECT id, password_hash, token_version FROM users WHERE id = ?`)
      .get(req.user!.id) as { id: string; password_hash: string; token_version: number } | undefined;

    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const newHash = hashPassword(newPassword);
    const nextVer = row.token_version + 1;
    platformDb
      .prepare(`UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?`)
      .run(newHash, nextVer, row.id);

    const newToken = signSessionToken({
      sub: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
      companyId: req.user!.companyId,
      ver: nextVer,
    });

    recordAuditLog({
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      companyId: req.user!.companyId,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: req.user!.id,
    });

    res.json({ ok: true, token: newToken });
  });

  // ---------------------------------------------------------------------------
  // Master Admin: Company Onboarding & Tenant Management
  // ---------------------------------------------------------------------------
  app.get('/api/companies', authenticate, requireRole('master_admin'), (_req: Request, res: Response) => {
    const companies = platformDb
      .prepare(`SELECT * FROM companies ORDER BY created_at DESC`)
      .all() as CompanyRow[];

    const userCounts = platformDb
      .prepare(`SELECT company_id, COUNT(*) AS cnt FROM users WHERE company_id IS NOT NULL GROUP BY company_id`)
      .all() as Array<{ company_id: string; cnt: number }>;
    const userCountMap = new Map(userCounts.map((u) => [u.company_id, u.cnt]));

    const enriched = companies.map((c) => {
      const inv = summarizeTenantInventory(c.id);
      return {
        ...c,
        userCount: userCountMap.get(c.id) ?? 0,
        ...inv,
      };
    });

    res.json({ companies: enriched });
  });

  app.post('/api/companies', authenticate, requireRole('master_admin'), (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const industry = typeof req.body?.industry === 'string' ? req.body.industry.trim() : 'Logistics & Supply Chain';
    const planTier = ['standard', 'growth', 'enterprise'].includes(req.body?.planTier)
      ? (req.body.planTier as 'standard' | 'growth' | 'enterprise')
      : 'enterprise';
    const contactEmail = typeof req.body?.contactEmail === 'string' ? req.body.contactEmail.trim() : '';
    const adminUsername = typeof req.body?.adminUsername === 'string' ? req.body.adminUsername.trim() : '';
    const adminFullName = typeof req.body?.adminFullName === 'string' ? req.body.adminFullName.trim() : '';
    const adminPassword = typeof req.body?.adminPassword === 'string' ? req.body.adminPassword : '';

    if (name.length < 2) {
      res.status(400).json({ error: 'Company name must be at least 2 characters' });
      return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(adminUsername)) {
      res.status(400).json({ error: 'Company admin username must be 3-40 alphanumeric/underscore characters' });
      return;
    }
    if (adminPassword.length < 8) {
      res.status(400).json({ error: 'Initial company admin password must be at least 8 characters' });
      return;
    }

    const baseSlug = slugify(name) || `tenant-${Date.now()}`;
    let slug = baseSlug;
    let suffix = 1;
    while (platformDb.prepare(`SELECT 1 FROM companies WHERE slug = ?`).get(slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const existingUser = platformDb
      .prepare(`SELECT 1 FROM users WHERE username = ?`)
      .get(adminUsername);
    if (existingUser) {
      res.status(409).json({ error: `Username "${adminUsername}" is already taken` });
      return;
    }

    const companyId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    const now = new Date().toISOString();
    const storageFile = `${companyId}.db`;
    const passwordHash = hashPassword(adminPassword);

    const tx = platformDb.transaction(() => {
      platformDb
        .prepare(
          `INSERT INTO companies (id, name, slug, industry, plan_tier, status, contact_email, storage_file, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
        )
        .run(companyId, name, slug, industry || 'Logistics & Supply Chain', planTier, contactEmail, storageFile, now, now);

      platformDb
        .prepare(
          `INSERT INTO users (id, username, full_name, email, password_hash, role, company_id, status, token_version, created_at)
           VALUES (?, ?, ?, ?, ?, 'company_admin', ?, 'active', 1, ?)`
        )
        .run(adminId, adminUsername, adminFullName || `${name} Admin`, contactEmail, passwordHash, companyId, now);
    });

    tx();

    // Provision the company's isolated SQLite database file
    getTenantDb(companyId);

    recordAuditLog({
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      companyId,
      action: 'COMPANY_ONBOARDED',
      targetType: 'company',
      targetId: companyId,
      details: { name, slug, planTier, adminUsername, storageFile },
    });

    res.status(201).json({
      company: {
        id: companyId,
        name,
        slug,
        industry,
        plan_tier: planTier,
        status: 'active',
        contact_email: contactEmail,
        storage_file: storageFile,
        created_at: now,
        updated_at: now,
      },
      adminUser: {
        id: adminId,
        username: adminUsername,
        fullName: adminFullName || `${name} Admin`,
        role: 'company_admin',
      },
    });
  });

  app.patch('/api/companies/:companyId', authenticate, requireRole('master_admin'), (req: Request, res: Response) => {
    let companyId: string;
    try {
      companyId = assertValidCompanyId(req.params.companyId);
    } catch {
      res.status(400).json({ error: 'Invalid company identifier' });
      return;
    }

    const existing = platformDb
      .prepare(`SELECT * FROM companies WHERE id = ?`)
      .get(companyId) as CompanyRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : existing.name;
    const industry =
      typeof req.body?.industry === 'string' && req.body.industry.trim()
        ? req.body.industry.trim()
        : existing.industry;
    const planTier = ['standard', 'growth', 'enterprise'].includes(req.body?.planTier)
      ? req.body.planTier
      : existing.plan_tier;
    const status = ['active', 'suspended'].includes(req.body?.status) ? req.body.status : existing.status;
    const contactEmail =
      typeof req.body?.contactEmail === 'string' ? req.body.contactEmail.trim() : existing.contact_email;
    const now = new Date().toISOString();

    platformDb
      .prepare(
        `UPDATE companies
         SET name = ?, industry = ?, plan_tier = ?, status = ?, contact_email = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(name, industry, planTier, status, contactEmail, now, companyId);

    // If suspended, bump token_version for all company users to revoke active tokens immediately
    if (status === 'suspended' && existing.status !== 'suspended') {
      platformDb
        .prepare(`UPDATE users SET token_version = token_version + 1 WHERE company_id = ?`)
        .run(companyId);
    }

    recordAuditLog({
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      companyId,
      action: status !== existing.status ? `COMPANY_${status.toUpperCase()}` : 'COMPANY_UPDATED',
      targetType: 'company',
      targetId: companyId,
      details: { name, planTier, status },
    });

    res.json({ ok: true });
  });

  app.delete('/api/companies/:companyId', authenticate, requireRole('master_admin'), (req: Request, res: Response) => {
    let companyId: string;
    try {
      companyId = assertValidCompanyId(req.params.companyId);
    } catch {
      res.status(400).json({ error: 'Invalid company identifier' });
      return;
    }

    const existing = platformDb
      .prepare(`SELECT id, name FROM companies WHERE id = ?`)
      .get(companyId) as { id: string; name: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    platformDb.prepare(`DELETE FROM companies WHERE id = ?`).run(companyId);
    closeAndDeleteTenantDb(companyId);

    recordAuditLog({
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      companyId: null,
      action: 'COMPANY_DELETED',
      targetType: 'company',
      targetId: companyId,
      details: { deletedCompanyName: existing.name },
    });

    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Master Admin: Cross-Tenant Analytics Dashboard
  // ---------------------------------------------------------------------------
  app.get('/api/analytics/cross-tenant', authenticate, requireRole('master_admin'), (_req: Request, res: Response) => {
    const companies = platformDb
      .prepare(`SELECT * FROM companies ORDER BY name ASC`)
      .all() as CompanyRow[];

    const userCounts = platformDb
      .prepare(`SELECT company_id, COUNT(*) AS cnt FROM users WHERE company_id IS NOT NULL GROUP BY company_id`)
      .all() as Array<{ company_id: string; cnt: number }>;
    const userCountMap = new Map(userCounts.map((u) => [u.company_id, u.cnt]));

    let totalSkus = 0;
    let totalUnits = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let totalImports = 0;
    let totalStorageBytes = 0;

    const categoryMap = new Map<string, { category: string; skus: number; units: number; valuation: number }>();
    const recentMovements: Array<Record<string, unknown>> = [];
    const recentImports: Array<Record<string, unknown>> = [];

    const tenantBreakdown = companies.map((company) => {
      const tDb = getTenantDb(company.id);
      const summary = summarizeTenantInventory(company.id);

      totalSkus += summary.totalSkus;
      totalUnits += summary.totalUnits;
      totalValuation += summary.totalValuation;
      lowStockCount += summary.lowStockCount;
      outOfStockCount += summary.outOfStockCount;
      totalImports += summary.importBatchCount;
      totalStorageBytes += summary.storageBytes;

      const cats = tDb
        .prepare(
          `SELECT category, COUNT(*) AS skus, COALESCE(SUM(quantity), 0) AS units,
                  COALESCE(SUM(quantity * unit_price), 0) AS valuation
           FROM inventory_items GROUP BY category`
        )
        .all() as Array<{ category: string; skus: number; units: number; valuation: number }>;

      for (const cat of cats) {
        const cur = categoryMap.get(cat.category) ?? {
          category: cat.category,
          skus: 0,
          units: 0,
          valuation: 0,
        };
        cur.skus += cat.skus;
        cur.units += cat.units;
        cur.valuation += cat.valuation;
        categoryMap.set(cat.category, cur);
      }

      const movs = tDb
        .prepare(`SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 6`)
        .all() as Array<Record<string, unknown>>;
      for (const m of movs) {
        recentMovements.push({ ...m, companyId: company.id, companyName: company.name });
      }

      const imps = tDb
        .prepare(`SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 5`)
        .all() as Array<Record<string, unknown>>;
      for (const imp of imps) {
        recentImports.push({ ...imp, companyId: company.id, companyName: company.name });
      }

      const healthPct =
        summary.totalSkus > 0
          ? Math.round((summary.healthyCount / summary.totalSkus) * 100)
          : 100;

      return {
        companyId: company.id,
        companyName: company.name,
        slug: company.slug,
        industry: company.industry,
        planTier: company.plan_tier,
        status: company.status,
        storageFile: company.storage_file,
        userCount: userCountMap.get(company.id) ?? 0,
        healthPct,
        ...summary,
      };
    });

    recentMovements.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    recentImports.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const categories = Array.from(categoryMap.values())
      .map((c) => ({ ...c, valuation: Number(c.valuation.toFixed(2)) }))
      .sort((a, b) => b.valuation - a.valuation);

    res.json({
      overview: {
        totalCompanies: companies.length,
        activeCompanies: companies.filter((c) => c.status === 'active').length,
        suspendedCompanies: companies.filter((c) => c.status === 'suspended').length,
        totalSkus,
        totalUnits,
        totalValuation: Number(totalValuation.toFixed(2)),
        lowStockCount,
        outOfStockCount,
        totalImports,
        totalStorageBytes,
      },
      tenantBreakdown,
      categories,
      recentMovements: recentMovements.slice(0, 15),
      recentImports: recentImports.slice(0, 10),
    });
  });

  // ---------------------------------------------------------------------------
  // Users & RBAC Management (Master Admin = all tenants; Company Admin = own tenant)
  // ---------------------------------------------------------------------------
  app.get('/api/users', authenticate, requireRole('master_admin', 'company_admin'), (req: Request, res: Response) => {
    const requestedCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';

    let rows: Array<Record<string, unknown>>;
    if (req.user!.role === 'master_admin') {
      if (requestedCompanyId) {
        let safeId: string;
        try {
          safeId = assertValidCompanyId(requestedCompanyId);
        } catch {
          res.status(400).json({ error: 'Invalid companyId filter' });
          return;
        }
        rows = platformDb
          .prepare(
            `SELECT u.id, u.username, u.full_name, u.email, u.role, u.company_id, u.status,
                    u.last_login_at, u.created_at, (u.password_hash != '') AS has_password,
                    c.name AS company_name
             FROM users u
             LEFT JOIN companies c ON u.company_id = c.id
             WHERE u.company_id = ?
             ORDER BY u.created_at DESC`
          )
          .all(safeId) as Array<Record<string, unknown>>;
      } else {
        rows = platformDb
          .prepare(
            `SELECT u.id, u.username, u.full_name, u.email, u.role, u.company_id, u.status,
                    u.last_login_at, u.created_at, (u.password_hash != '') AS has_password,
                    c.name AS company_name
             FROM users u
             LEFT JOIN companies c ON u.company_id = c.id
             ORDER BY CASE WHEN u.role = 'master_admin' THEN 0 ELSE 1 END, u.created_at DESC`
          )
          .all() as Array<Record<string, unknown>>;
      }
    } else {
      // Strictly isolated to company_admin's own company
      rows = platformDb
        .prepare(
          `SELECT u.id, u.username, u.full_name, u.email, u.role, u.company_id, u.status,
                  u.last_login_at, u.created_at, (u.password_hash != '') AS has_password,
                  c.name AS company_name
           FROM users u
           LEFT JOIN companies c ON u.company_id = c.id
           WHERE u.company_id = ?
           ORDER BY u.created_at DESC`
        )
        .all(req.user!.companyId) as Array<Record<string, unknown>>;
    }

    res.json({ users: rows });
  });

  app.post('/api/users', authenticate, requireRole('master_admin', 'company_admin'), (req: Request, res: Response) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role = req.body?.role as UserRole;

    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      res.status(400).json({ error: 'Username must be 3-40 alphanumeric, dot, dash, or underscore characters' });
      return;
    }
    if (!fullName) {
      res.status(400).json({ error: 'Full name is required' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }
    if (!VALID_COMPANY_ROLES.includes(role)) {
      res.status(400).json({ error: 'Role must be company_admin, company_operator, or company_viewer' });
      return;
    }

    let targetCompanyId: string;
    if (req.user!.role === 'master_admin') {
      try {
        targetCompanyId = assertValidCompanyId(String(req.body?.companyId ?? ''));
      } catch {
        res.status(400).json({ error: 'Valid companyId is required' });
        return;
      }
      const companyExists = platformDb.prepare(`SELECT 1 FROM companies WHERE id = ?`).get(targetCompanyId);
      if (!companyExists) {
        res.status(404).json({ error: 'Target company not found' });
        return;
      }
    } else {
      targetCompanyId = req.user!.companyId!;
    }

    const existing = platformDb.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username);
    if (existing) {
      res.status(409).json({ error: `Username "${username}" already exists` });
      return;
    }

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    platformDb
      .prepare(
        `INSERT INTO users (id, username, full_name, email, password_hash, role, company_id, status, token_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?)`
      )
      .run(userId, username, fullName, email, hashPassword(password), role, targetCompanyId, now);

    recordAuditLog({
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      companyId: targetCompanyId,
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: userId,
      details: { username, role },
    });

    res.status(201).json({ id: userId, username, fullName, email, role, companyId: targetCompanyId, status: 'active' });
  });

  app.patch('/api/users/:userId', authenticate, requireRole('master_admin', 'company_admin'), (req: Request, res: Response) => {
    const targetUserId = req.params.userId;
    const target = platformDb
      .prepare(`SELECT id, username, role, company_id, status, token_version FROM users WHERE id = ?`)
      .get(targetUserId) as
      | {
          id: string;
          username: string;
          role: UserRole;
          company_id: string | null;
          status: 'active' | 'disabled';
          token_version: number;
        }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (target.role === 'master_admin') {
      res.status(403).json({ error: 'Master admin role and status cannot be modified here' });
      return;
    }

    if (req.user!.role !== 'master_admin' && target.company_id !== req.user!.companyId) {
      res.status(403).json({ error: 'Cross-tenant user management denied' });
      return;
    }

    const newRole = VALID_COMPANY_ROLES.includes(req.body?.role) ? (req.body.role as UserRole) : target.role;
    const newStatus = ['active', 'disabled'].includes(req.body?.status)
      ? (req.body.status as 'active' | 'disabled')
      : target.status;

    if (target.id === req.user!.id && newStatus === 'disabled') {
      res.status(400).json({ error: 'You cannot disable your own active account' });
      return;
    }

    platformDb
      .prepare(`UPDATE users SET role = ?, status = ?, token_version = token_version + 1 WHERE id = ?`)
      .run(newRole, newStatus, target.id);

    recordAuditLog({
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      actorRole: req.user!.role,
      companyId: target.company_id,
      action: 'USER_UPDATED',
      targetType: 'user',
      targetId: target.id,
      details: { username: target.username, role: newRole, status: newStatus },
    });

    res.json({ ok: true });
  });

  app.post(
    '/api/users/:userId/reset-password',
    authenticate,
    requireRole('master_admin', 'company_admin'),
    (req: Request, res: Response) => {
      const targetUserId = req.params.userId;
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters' });
        return;
      }

      const target = platformDb
        .prepare(`SELECT id, username, role, company_id FROM users WHERE id = ?`)
        .get(targetUserId) as { id: string; username: string; role: UserRole; company_id: string | null } | undefined;

      if (!target) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (target.role === 'master_admin' && req.user!.id !== target.id) {
        res.status(403).json({ error: 'Cannot reset master admin password from another account' });
        return;
      }

      if (req.user!.role !== 'master_admin' && target.company_id !== req.user!.companyId) {
        res.status(403).json({ error: 'Cross-tenant password reset denied' });
        return;
      }

      platformDb
        .prepare(`UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?`)
        .run(hashPassword(newPassword), target.id);

      recordAuditLog({
        actorUserId: req.user!.id,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        companyId: target.company_id,
        action: 'USER_PASSWORD_RESET',
        targetType: 'user',
        targetId: target.id,
        details: { username: target.username },
      });

      res.json({ ok: true });
    }
  );

  // ---------------------------------------------------------------------------
  // Tenant-Isolated Inventory, Analytics, & CSV Ingestion
  // ---------------------------------------------------------------------------
  app.get('/api/tenants/:companyId/analytics', authenticate, resolveTenantAccess, (req: Request, res: Response) => {
    const companyId = req.tenantCompanyId!;
    const company = platformDb.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId) as CompanyRow;
    const tDb = getTenantDb(companyId);
    const summary = summarizeTenantInventory(companyId);

    const categories = tDb
      .prepare(
        `SELECT category, COUNT(*) AS skus, COALESCE(SUM(quantity), 0) AS units,
                COALESCE(SUM(quantity * unit_price), 0) AS valuation
         FROM inventory_items
         GROUP BY category
         ORDER BY valuation DESC`
      )
      .all() as Array<{ category: string; skus: number; units: number; valuation: number }>;

    const warehouses = tDb
      .prepare(
        `SELECT warehouse, COUNT(*) AS skus, COALESCE(SUM(quantity), 0) AS units,
                COALESCE(SUM(quantity * unit_price), 0) AS valuation
         FROM inventory_items
         GROUP BY warehouse
         ORDER BY units DESC`
      )
      .all() as Array<{ warehouse: string; skus: number; units: number; valuation: number }>;

    const lowStockItems = tDb
      .prepare(
        `SELECT id, sku, name, category, quantity, unit, reorder_level, warehouse
         FROM inventory_items
         WHERE quantity <= reorder_level
         ORDER BY quantity ASC, reorder_level DESC
         LIMIT 12`
      )
      .all();

    const recentMovements = tDb
      .prepare(`SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 15`)
      .all();

    const recentImports = tDb
      .prepare(`SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 10`)
      .all();

    res.json({
      company,
      summary,
      categories: categories.map((c) => ({ ...c, valuation: Number(c.valuation.toFixed(2)) })),
      warehouses: warehouses.map((w) => ({ ...w, valuation: Number(w.valuation.toFixed(2)) })),
      lowStockItems,
      recentMovements,
      recentImports,
    });
  });

  app.get('/api/tenants/:companyId/inventory', authenticate, resolveTenantAccess, (req: Request, res: Response) => {
    const companyId = req.tenantCompanyId!;
    const tDb = getTenantDb(companyId);

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const warehouse = typeof req.query.warehouse === 'string' ? req.query.warehouse.trim() : '';
    const stockStatus = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';

    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (search) {
      whereClauses.push(`(sku LIKE ? OR name LIKE ? OR supplier LIKE ?)`);
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (category && category !== 'all') {
      whereClauses.push(`category = ?`);
      params.push(category);
    }
    if (warehouse && warehouse !== 'all') {
      whereClauses.push(`warehouse = ?`);
      params.push(warehouse);
    }
    if (stockStatus === 'out') {
      whereClauses.push(`quantity = 0`);
    } else if (stockStatus === 'low') {
      whereClauses.push(`quantity > 0 AND quantity <= reorder_level`);
    } else if (stockStatus === 'healthy') {
      whereClauses.push(`quantity > reorder_level`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const items = tDb
      .prepare(`SELECT * FROM inventory_items ${whereSql} ORDER BY updated_at DESC, sku ASC`)
      .all(...params);

    const categories = (
      tDb.prepare(`SELECT DISTINCT category FROM inventory_items ORDER BY category ASC`).all() as Array<{
        category: string;
      }>
    ).map((r) => r.category);

    const warehouses = (
      tDb.prepare(`SELECT DISTINCT warehouse FROM inventory_items ORDER BY warehouse ASC`).all() as Array<{
        warehouse: string;
      }>
    ).map((r) => r.warehouse);

    res.json({ items, categories, warehouses });
  });

  app.post(
    '/api/tenants/:companyId/inventory',
    authenticate,
    resolveTenantAccess,
    requireRole('master_admin', 'company_admin', 'company_operator'),
    (req: Request, res: Response) => {
      const companyId = req.tenantCompanyId!;
      const tDb = getTenantDb(companyId);

      const sku = typeof req.body?.sku === 'string' ? req.body.sku.trim().toUpperCase() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const category = typeof req.body?.category === 'string' && req.body.category.trim() ? req.body.category.trim() : 'General';
      const unit = typeof req.body?.unit === 'string' && req.body.unit.trim() ? req.body.unit.trim() : 'pcs';
      const warehouse =
        typeof req.body?.warehouse === 'string' && req.body.warehouse.trim()
          ? req.body.warehouse.trim()
          : 'Main Hub';
      const supplier = typeof req.body?.supplier === 'string' ? req.body.supplier.trim() : '';

      const quantity = Number(req.body?.quantity ?? 0);
      const unitPrice = Number(req.body?.unitPrice ?? 0);
      const reorderLevel = Number(req.body?.reorderLevel ?? 10);

      if (!sku || !name) {
        res.status(400).json({ error: 'SKU and Item Name are required' });
        return;
      }
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
        res.status(400).json({ error: 'Quantity must be a non-negative integer' });
        return;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        res.status(400).json({ error: 'Unit price must be a non-negative number' });
        return;
      }
      if (!Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isInteger(reorderLevel)) {
        res.status(400).json({ error: 'Reorder level must be a non-negative integer' });
        return;
      }

      const existing = tDb.prepare(`SELECT id FROM inventory_items WHERE sku = ?`).get(sku);
      if (existing) {
        res.status(409).json({ error: `SKU "${sku}" already exists in this tenant's inventory` });
        return;
      }

      const itemId = crypto.randomUUID();
      const now = new Date().toISOString();

      const tx = tDb.transaction(() => {
        tDb
          .prepare(
            `INSERT INTO inventory_items (
              id, sku, name, category, quantity, unit, unit_price, reorder_level, warehouse, supplier, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(itemId, sku, name, category, quantity, unit, unitPrice, reorderLevel, warehouse, supplier, req.user!.username, now, now);

        if (quantity > 0) {
          tDb
            .prepare(
              `INSERT INTO stock_movements (id, item_id, sku, item_name, delta, previous_qty, new_qty, reason, actor_username, created_at)
               VALUES (?, ?, ?, ?, ?, 0, ?, 'Manual SKU Creation', ?, ?)`
            )
            .run(crypto.randomUUID(), itemId, sku, name, quantity, quantity, req.user!.username, now);
        }
      });
      tx();

      recordAuditLog({
        actorUserId: req.user!.id,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        companyId,
        action: 'INVENTORY_ITEM_CREATED',
        targetType: 'inventory_item',
        targetId: itemId,
        details: { sku, name, quantity },
      });

      res.status(201).json({ id: itemId, sku });
    }
  );

  app.patch(
    '/api/tenants/:companyId/inventory/:itemId',
    authenticate,
    resolveTenantAccess,
    requireRole('master_admin', 'company_admin', 'company_operator'),
    (req: Request, res: Response) => {
      const companyId = req.tenantCompanyId!;
      const tDb = getTenantDb(companyId);
      const itemId = req.params.itemId;

      const existing = tDb.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(itemId) as
        | {
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
          }
        | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }

      const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : existing.name;
      const category =
        typeof req.body?.category === 'string' && req.body.category.trim() ? req.body.category.trim() : existing.category;
      const unit = typeof req.body?.unit === 'string' && req.body.unit.trim() ? req.body.unit.trim() : existing.unit;
      const warehouse =
        typeof req.body?.warehouse === 'string' && req.body.warehouse.trim()
          ? req.body.warehouse.trim()
          : existing.warehouse;
      const supplier = typeof req.body?.supplier === 'string' ? req.body.supplier.trim() : existing.supplier;
      const unitPrice = req.body?.unitPrice !== undefined ? Number(req.body.unitPrice) : existing.unit_price;
      const reorderLevel =
        req.body?.reorderLevel !== undefined ? Number(req.body.reorderLevel) : existing.reorder_level;

      let nextQty = existing.quantity;
      if (typeof req.body?.delta === 'number' && Number.isInteger(req.body.delta)) {
        nextQty = existing.quantity + req.body.delta;
      } else if (req.body?.quantity !== undefined) {
        nextQty = Number(req.body.quantity);
      }

      if (!Number.isInteger(nextQty) || nextQty < 0) {
        res.status(400).json({ error: 'Resulting stock quantity cannot be negative' });
        return;
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        res.status(400).json({ error: 'Unit price must be non-negative' });
        return;
      }
      if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
        res.status(400).json({ error: 'Reorder level must be a non-negative integer' });
        return;
      }

      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim()
          : 'Stock Adjustment';
      const now = new Date().toISOString();
      const delta = nextQty - existing.quantity;

      const tx = tDb.transaction(() => {
        tDb
          .prepare(
            `UPDATE inventory_items
             SET name = ?, category = ?, quantity = ?, unit = ?, unit_price = ?,
                 reorder_level = ?, warehouse = ?, supplier = ?, updated_by = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(name, category, nextQty, unit, unitPrice, reorderLevel, warehouse, supplier, req.user!.username, now, itemId);

        if (delta !== 0) {
          tDb
            .prepare(
              `INSERT INTO stock_movements (id, item_id, sku, item_name, delta, previous_qty, new_qty, reason, actor_username, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(crypto.randomUUID(), itemId, existing.sku, name, delta, existing.quantity, nextQty, reason, req.user!.username, now);
        }
      });
      tx();

      recordAuditLog({
        actorUserId: req.user!.id,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        companyId,
        action: delta !== 0 ? 'STOCK_ADJUSTED' : 'INVENTORY_ITEM_UPDATED',
        targetType: 'inventory_item',
        targetId: itemId,
        details: { sku: existing.sku, delta, previousQty: existing.quantity, newQty: nextQty, reason },
      });

      res.json({ ok: true, quantity: nextQty });
    }
  );

  app.delete(
    '/api/tenants/:companyId/inventory/:itemId',
    authenticate,
    resolveTenantAccess,
    requireRole('master_admin', 'company_admin'),
    (req: Request, res: Response) => {
      const companyId = req.tenantCompanyId!;
      const tDb = getTenantDb(companyId);
      const itemId = req.params.itemId;

      const existing = tDb
        .prepare(`SELECT id, sku, name FROM inventory_items WHERE id = ?`)
        .get(itemId) as { id: string; sku: string; name: string } | undefined;

      if (!existing) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }

      tDb.prepare(`DELETE FROM inventory_items WHERE id = ?`).run(itemId);

      recordAuditLog({
        actorUserId: req.user!.id,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        companyId,
        action: 'INVENTORY_ITEM_DELETED',
        targetType: 'inventory_item',
        targetId: itemId,
        details: { sku: existing.sku, name: existing.name },
      });

      res.json({ ok: true });
    }
  );

  // ---------------------------------------------------------------------------
  // CSV Bulk Inventory Ingestion & Safe Export
  // ---------------------------------------------------------------------------
  app.post(
    '/api/tenants/:companyId/inventory/import-csv',
    authenticate,
    resolveTenantAccess,
    requireRole('master_admin', 'company_admin', 'company_operator'),
    (req: Request, res: Response) => {
      const companyId = req.tenantCompanyId!;
      const tDb = getTenantDb(companyId);

      const csvText = typeof req.body?.csvText === 'string' ? req.body.csvText : '';
      const filename =
        typeof req.body?.filename === 'string' && req.body.filename.trim()
          ? req.body.filename.trim().slice(0, 120)
          : 'inventory-import.csv';
      const duplicateMode = req.body?.duplicateMode === 'skip' ? 'skip' : 'upsert';
      const columnMap = (req.body?.columnMap ?? {}) as Record<string, string>;

      if (!csvText.trim()) {
        res.status(400).json({ error: 'CSV content is empty' });
        return;
      }
      if (csvText.length > 4 * 1024 * 1024) {
        res.status(413).json({ error: 'CSV payload exceeds 4 MB limit' });
        return;
      }

      let records: Array<Record<string, string>>;
      try {
        records = parseCsvSync(csvText, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
          relax_column_count: true,
        }) as Array<Record<string, string>>;
      } catch (err) {
        res.status(400).json({
          error: `Malformed CSV file: ${err instanceof Error ? err.message : 'Unable to parse'}`,
        });
        return;
      }

      if (records.length === 0) {
        res.status(400).json({ error: 'CSV contains headers but zero data rows' });
        return;
      }
      if (records.length > 10000) {
        res.status(400).json({ error: 'Maximum 10,000 rows per CSV import batch' });
        return;
      }

      // Helper to resolve field using explicit columnMap or common header aliases
      const readField = (
        row: Record<string, string>,
        targetField: string,
        aliases: string[]
      ): string => {
        const mappedHeader = columnMap[targetField];
        if (mappedHeader && row[mappedHeader] !== undefined) {
          return String(row[mappedHeader]).trim();
        }
        const rowKeys = Object.keys(row);
        for (const alias of aliases) {
          const matchedKey = rowKeys.find((k) => k.toLowerCase().replace(/[\s_-]+/g, '') === alias);
          if (matchedKey && row[matchedKey] !== undefined) {
            return String(row[matchedKey]).trim();
          }
        }
        return '';
      };

      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const errors: Array<{ row: number; sku: string; message: string }> = [];
      const now = new Date().toISOString();

      const findBySku = tDb.prepare(`SELECT id, quantity, name FROM inventory_items WHERE sku = ?`);
      const insertItem = tDb.prepare(
        `INSERT INTO inventory_items (
          id, sku, name, category, quantity, unit, unit_price, reorder_level, warehouse, supplier, updated_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const updateItem = tDb.prepare(
        `UPDATE inventory_items
         SET name = ?, category = ?, quantity = ?, unit = ?, unit_price = ?, reorder_level = ?,
             warehouse = ?, supplier = ?, updated_by = ?, updated_at = ?
         WHERE id = ?`
      );
      const insertMovement = tDb.prepare(
        `INSERT INTO stock_movements (id, item_id, sku, item_name, delta, previous_qty, new_qty, reason, actor_username, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const tx = tDb.transaction(() => {
        records.forEach((row, index) => {
          const rowNum = index + 2; // 1-indexed + header row
          const sku = readField(row, 'sku', ['sku', 'itemcode', 'code', 'partnumber', 'productid']).toUpperCase();
          const name = readField(row, 'name', ['name', 'itemname', 'productname', 'title', 'description']);
          const category = readField(row, 'category', ['category', 'group', 'department', 'type']) || 'General';
          const unit = readField(row, 'unit', ['unit', 'uom', 'measure']) || 'pcs';
          const warehouse =
            readField(row, 'warehouse', ['warehouse', 'location', 'bin', 'facility', 'depot']) || 'Main Hub';
          const supplier = readField(row, 'supplier', ['supplier', 'vendor', 'manufacturer']) || '';

          const rawQty = readField(row, 'quantity', ['quantity', 'qty', 'stock', 'onhand', 'count']);
          const rawPrice = readField(row, 'unitPrice', ['unitprice', 'price', 'cost', 'rate', 'value']).replace(
            /[$,\s]/g,
            ''
          );
          const rawReorder = readField(row, 'reorderLevel', [
            'reorderlevel',
            'reorder',
            'minstock',
            'threshold',
            'safetystock',
          ]);

          if (!sku || !name) {
            errors.push({ row: rowNum, sku: sku || '-', message: 'Missing required SKU or Name' });
            return;
          }

          const quantity = rawQty === '' ? 0 : Number(rawQty);
          const unitPrice = rawPrice === '' ? 0 : Number(rawPrice);
          const reorderLevel = rawReorder === '' ? 10 : Number(rawReorder);

          if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
            errors.push({ row: rowNum, sku, message: `Invalid integer quantity "${rawQty}"` });
            return;
          }
          if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            errors.push({ row: rowNum, sku, message: `Invalid unit price "${rawPrice}"` });
            return;
          }
          if (!Number.isFinite(reorderLevel) || reorderLevel < 0 || !Number.isInteger(reorderLevel)) {
            errors.push({ row: rowNum, sku, message: `Invalid reorder level "${rawReorder}"` });
            return;
          }

          const existing = findBySku.get(sku) as { id: string; quantity: number; name: string } | undefined;
          if (existing) {
            if (duplicateMode === 'skip') {
              skippedCount++;
              return;
            }
            updateItem.run(
              name,
              category,
              quantity,
              unit,
              unitPrice,
              reorderLevel,
              warehouse,
              supplier,
              req.user!.username,
              now,
              existing.id
            );
            const delta = quantity - existing.quantity;
            if (delta !== 0) {
              insertMovement.run(
                crypto.randomUUID(),
                existing.id,
                sku,
                name,
                delta,
                existing.quantity,
                quantity,
                `CSV Import (${filename})`,
                req.user!.username,
                now
              );
            }
            updatedCount++;
          } else {
            const newId = crypto.randomUUID();
            insertItem.run(
              newId,
              sku,
              name,
              category,
              quantity,
              unit,
              unitPrice,
              reorderLevel,
              warehouse,
              supplier,
              req.user!.username,
              now,
              now
            );
            if (quantity > 0) {
              insertMovement.run(
                crypto.randomUUID(),
                newId,
                sku,
                name,
                quantity,
                0,
                quantity,
                `CSV Import (${filename})`,
                req.user!.username,
                now
              );
            }
            insertedCount++;
          }
        });

        tDb
          .prepare(
            `INSERT INTO import_batches (
              id, filename, total_rows, inserted_count, updated_count, skipped_count, error_count, actor_username, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            crypto.randomUUID(),
            filename,
            records.length,
            insertedCount,
            updatedCount,
            skippedCount,
            errors.length,
            req.user!.username,
            now
          );
      });

      tx();

      recordAuditLog({
        actorUserId: req.user!.id,
        actorUsername: req.user!.username,
        actorRole: req.user!.role,
        companyId,
        action: 'CSV_INVENTORY_IMPORTED',
        targetType: 'import_batch',
        targetId: filename,
        details: {
          totalRows: records.length,
          insertedCount,
          updatedCount,
          skippedCount,
          errorCount: errors.length,
        },
      });

      res.json({
        totalRows: records.length,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount: errors.length,
        errors: errors.slice(0, 50),
      });
    }
  );

  app.get('/api/tenants/:companyId/inventory/export-csv', authenticate, resolveTenantAccess, (req: Request, res: Response) => {
    const companyId = req.tenantCompanyId!;
    const tDb = getTenantDb(companyId);
    const items = tDb
      .prepare(
        `SELECT sku, name, category, quantity, unit, unit_price, reorder_level, warehouse, supplier, updated_at
         FROM inventory_items ORDER BY sku ASC`
      )
      .all() as Array<{
      sku: string;
      name: string;
      category: string;
      quantity: number;
      unit: string;
      unit_price: number;
      reorder_level: number;
      warehouse: string;
      supplier: string;
      updated_at: string;
    }>;

    const header = ['sku', 'name', 'category', 'quantity', 'unit', 'unit_price', 'reorder_level', 'warehouse', 'supplier', 'updated_at'];
    const lines = [header.join(',')];
    for (const item of items) {
      lines.push(
        [
          escapeCsvCell(item.sku),
          escapeCsvCell(item.name),
          escapeCsvCell(item.category),
          escapeCsvCell(item.quantity),
          escapeCsvCell(item.unit),
          escapeCsvCell(item.unit_price),
          escapeCsvCell(item.reorder_level),
          escapeCsvCell(item.warehouse),
          escapeCsvCell(item.supplier),
          escapeCsvCell(item.updated_at),
        ].join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-${companyId.slice(0, 8)}.csv"`);
    res.send(lines.join('\n'));
  });

  // ---------------------------------------------------------------------------
  // Audit Logs
  // ---------------------------------------------------------------------------
  app.get('/api/audit-logs', authenticate, requireRole('master_admin', 'company_admin'), (req: Request, res: Response) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 80)));

    if (req.user!.role === 'master_admin') {
      const filterCompanyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : '';
      if (filterCompanyId) {
        let safeId: string;
        try {
          safeId = assertValidCompanyId(filterCompanyId);
        } catch {
          res.status(400).json({ error: 'Invalid companyId filter' });
          return;
        }
        const logs = platformDb
          .prepare(
            `SELECT a.*, c.name AS company_name
             FROM audit_logs a
             LEFT JOIN companies c ON a.company_id = c.id
             WHERE a.company_id = ?
             ORDER BY a.created_at DESC
             LIMIT ?`
          )
          .all(safeId, limit);
        res.json({ logs });
        return;
      }

      const logs = platformDb
        .prepare(
          `SELECT a.*, c.name AS company_name
           FROM audit_logs a
           LEFT JOIN companies c ON a.company_id = c.id
           ORDER BY a.created_at DESC
           LIMIT ?`
        )
        .all(limit);
      res.json({ logs });
      return;
    }

    const logs = platformDb
      .prepare(
        `SELECT a.*, c.name AS company_name
         FROM audit_logs a
         LEFT JOIN companies c ON a.company_id = c.id
         WHERE a.company_id = ?
         ORDER BY a.created_at DESC
         LIMIT ?`
      )
      .all(req.user!.companyId, limit);
    res.json({ logs });
  });
}
