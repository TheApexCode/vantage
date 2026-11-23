import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiRequest, formatDateTime, roleLabel, setAuthToken } from '../lib/api';
import { AuditLogEntry, AuthUser, CompanySummary } from '../types';

interface AuditSecurityViewProps {
  currentUser: AuthUser;
}

export function AuditSecurityView({ currentUser }: AuditSecurityViewProps) {
  const isMaster = currentUser.role === 'master_admin';
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [companyFilter, setCompanyFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Change own password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdStatus, setPwdStatus] = useState<{ type: 'ok' | 'err'; message: string } | null>(null);
  const [savingPwd, setSavingPwd] = useState(false);

  async function loadAudit() {
    setLoading(true);
    setError(null);
    try {
      const url =
        isMaster && companyFilter !== 'all'
          ? `/api/audit-logs?companyId=${encodeURIComponent(companyFilter)}`
          : '/api/audit-logs';
      const [logRes, compRes] = await Promise.all([
        apiRequest<{ logs: AuditLogEntry[] }>(url),
        isMaster
          ? apiRequest<{ companies: CompanySummary[] }>('/api/companies')
          : Promise.resolve({ companies: [] as CompanySummary[] }),
      ]);
      setLogs(logRes.logs);
      if (isMaster) setCompanies(compRes.companies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAudit();
  }, [companyFilter]);

  async function handlePasswordRotation(e: React.FormEvent) {
    e.preventDefault();
    setPwdStatus(null);
    if (newPassword !== confirmPassword) {
      setPwdStatus({ type: 'err', message: 'New password confirmation does not match.' });
      return;
    }
    if (newPassword.length < 8) {
      setPwdStatus({ type: 'err', message: 'New password must be at least 8 characters.' });
      return;
    }

    setSavingPwd(true);
    try {
      const res = await apiRequest<{ ok: boolean; token: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setAuthToken(res.token);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdStatus({
        type: 'ok',
        message: 'Password updated with fresh Scrypt salt and active session token rotated.',
      });
      void loadAudit();
    } catch (err) {
      setPwdStatus({
        type: 'err',
        message: err instanceof Error ? err.message : 'Failed to update password',
      });
    } finally {
      setSavingPwd(false);
    }
  }

  function formatDetails(jsonStr: string): string {
    try {
      const obj = JSON.parse(jsonStr) as Record<string, unknown>;
      const entries = Object.entries(obj);
      if (entries.length === 0) return '—';
      return entries
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(' · ');
    } catch {
      return jsonStr;
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Audit Log Stream (8 cols) */}
      <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Security & Activity Audit Trail
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Immutable ledger of logins, RBAC changes, CSV feeds, and cross-tenant boundary checks
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isMaster && (
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="all">All Tenants</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => void loadAudit()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:border-slate-300 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="m-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            No audit events recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Tenant</th>
                  <th className="py-2.5 px-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                      {formatDateTime(log.created_at)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="font-mono font-medium text-slate-900">{log.actor_username}</span>
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-500">{roleLabel(log.actor_role)}</span>
                    </td>
                    <td className="py-2.5 px-4 font-mono whitespace-nowrap">
                      <span
                        className={
                          log.action.includes('DENIED') || log.action.includes('DELETED') || log.action.includes('SUSPENDED')
                            ? 'text-red-700 font-medium'
                            : 'text-slate-800'
                        }
                      >
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                      {log.company_name || 'Platform'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">
                      {formatDetails(log.details_json)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credential Security & Rotation (4 cols) */}
      <div className="lg:col-span-4 space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-blue-600" />
            <h3 className="font-display text-base font-semibold text-slate-900">
              Rotate Account Password
            </h3>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
            Signed in as <span className="font-mono font-medium text-slate-800">{currentUser.username}</span>. Updating your password generates a new 16-byte Scrypt salt and increments your token version.
          </p>

          <form onSubmit={handlePasswordRotation} className="mt-5 space-y-4">
            {pwdStatus && (
              <div
                className={`p-3 rounded-lg text-xs border ${
                  pwdStatus.type === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {pwdStatus.message}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Current Password
              </label>
              <input
                required
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                New Password (min 8 characters)
              </label>
              <input
                required
                minLength={8}
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Confirm New Password
              </label>
              <input
                required
                minLength={8}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <button
              type="submit"
              disabled={savingPwd}
              className="w-full py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg cursor-pointer"
            >
              {savingPwd ? 'Rotating Credentials...' : 'Update Password'}
            </button>
          </form>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Isolation & Hashing Posture
            </h3>
          </div>
          <div className="mt-3 space-y-2.5 text-xs text-slate-600">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span>Password KDF</span>
              <span className="font-mono text-slate-900">Scrypt (N=16384, r=8)</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span>Token Signature</span>
              <span className="font-mono text-slate-900">HMAC-SHA256</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span>Tenant Storage</span>
              <span className="font-mono text-slate-900">Per-Company SQLite</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span>CSV Export Guard</span>
              <span className="font-mono text-slate-900">Formula Escaped</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
