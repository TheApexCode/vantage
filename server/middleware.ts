import { NextFunction, Request, Response } from 'express';
import { UserRole, verifySessionToken } from './crypto.ts';
import { assertValidCompanyId, platformDb, recordAuditLog } from './db.ts';

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  companyId: string | null;
  companyName: string | null;
  companyStatus: 'active' | 'suspended' | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      tenantCompanyId?: string;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token' });
    return;
  }

  const row = platformDb
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.company_id, u.status, u.token_version,
              c.name AS company_name, c.status AS company_status
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.id = ?`
    )
    .get(payload.sub) as
    | {
        id: string;
        username: string;
        full_name: string;
        email: string;
        role: UserRole;
        company_id: string | null;
        status: string;
        token_version: number;
        company_name: string | null;
        company_status: 'active' | 'suspended' | null;
      }
    | undefined;

  if (!row || row.status !== 'active' || row.token_version !== payload.ver) {
    res.status(401).json({ error: 'Session revoked or account inactive' });
    return;
  }

  if (row.role !== 'master_admin') {
    if (!row.company_id || row.company_status !== 'active') {
      res.status(403).json({ error: 'Tenant workspace is suspended or unavailable' });
      return;
    }
  }

  req.user = {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    companyId: row.company_id,
    companyName: row.company_name,
    companyStatus: row.company_status,
  };

  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role permissions for this action' });
      return;
    }
    next();
  };
}

export function resolveTenantAccess(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const paramCompanyId = req.params.companyId;
  if (!paramCompanyId) {
    res.status(400).json({ error: 'Missing tenant company identifier' });
    return;
  }

  let safeCompanyId: string;
  try {
    safeCompanyId = assertValidCompanyId(paramCompanyId);
  } catch {
    res.status(400).json({ error: 'Invalid tenant identifier format' });
    return;
  }

  if (req.user.role !== 'master_admin') {
    if (!req.user.companyId || req.user.companyId.toLowerCase() !== safeCompanyId) {
      recordAuditLog({
        actorUserId: req.user.id,
        actorUsername: req.user.username,
        actorRole: req.user.role,
        companyId: req.user.companyId,
        action: 'CROSS_TENANT_ACCESS_DENIED',
        targetType: 'company',
        targetId: safeCompanyId,
        details: { attemptedCompanyId: safeCompanyId },
      });
      res.status(403).json({ error: 'Cross-tenant access denied' });
      return;
    }
  }

  const company = platformDb
    .prepare(`SELECT id, status FROM companies WHERE id = ?`)
    .get(safeCompanyId) as { id: string; status: string } | undefined;

  if (!company) {
    res.status(404).json({ error: 'Company tenant not found' });
    return;
  }

  if (req.user.role !== 'master_admin' && company.status !== 'active') {
    res.status(403).json({ error: 'Company tenant is currently suspended' });
    return;
  }

  req.tenantCompanyId = company.id;
  next();
}
