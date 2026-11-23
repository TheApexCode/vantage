import { KeyRound, Plus, Search, Shield, UserCheck, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiRequest, formatDateTime, roleLabel } from '../lib/api';
import { AuthUser, CompanySummary, UserRecord, UserRole } from '../types';

interface UsersRbacViewProps {
  currentUser: AuthUser;
}

export function UsersRbacView({ currentUser }: UsersRbacViewProps) {
  const isMaster = currentUser.role === 'master_admin';
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Create User Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('company_operator');
  const [newCompanyId, setNewCompanyId] = useState(currentUser.companyId || '');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Reset Password Modal
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const usersUrl =
        isMaster && companyFilter !== 'all'
          ? `/api/users?companyId=${encodeURIComponent(companyFilter)}`
          : '/api/users';
      const [usersRes, companiesRes] = await Promise.all([
        apiRequest<{ users: UserRecord[] }>(usersUrl),
        isMaster
          ? apiRequest<{ companies: CompanySummary[] }>('/api/companies')
          : Promise.resolve({ companies: [] as CompanySummary[] }),
      ]);
      setUsers(usersRes.users);
      if (isMaster) {
        setCompanies(companiesRes.companies);
        if (!newCompanyId && companiesRes.companies.length > 0) {
          setNewCompanyId(companiesRes.companies[0].id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [companyFilter]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          fullName: newFullName,
          email: newEmail,
          password: newPassword,
          role: newRole,
          companyId: isMaster ? newCompanyId : currentUser.companyId,
        }),
      });
      setShowCreateModal(false);
      setNewUsername('');
      setNewFullName('');
      setNewEmail('');
      setNewPassword('');
      await loadData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdateUser(user: UserRecord, patch: { role?: UserRole; status?: 'active' | 'disabled' }) {
    try {
      await apiRequest(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError(null);
    setResetting(true);
    try {
      await apiRequest(`/api/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      setResetTarget(null);
      setResetPassword('');
      await loadData();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  }

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      u.full_name.toLowerCase().includes(q) ||
      (u.company_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* RBAC Matrix Summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-5">
        <div>
          <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-blue-600" />
            <span>Master Admin</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Global platform governance, company onboarding, tenant suspension, and cross-tenant analytics.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-900">Company Admin</div>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Full control strictly inside their own isolated company DB, team RBAC, and CSV feeds.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-900">Operator</div>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Create/edit SKUs, adjust warehouse stock levels, and upload CSV inventory batches.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-900">Viewer</div>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Read-only access to their company&apos;s inventory ledger, stock alerts, and analytics.
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by username or name..."
              className="pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {isMaster && (
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Tenants & Platform</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          disabled={isMaster && companies.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add User Account
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <UserCheck className="w-8 h-8 text-slate-400 mx-auto" />
            <h3 className="mt-3 font-display text-sm font-semibold text-slate-900">
              No user accounts match this view
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Create a company administrator, operator, or viewer account to delegate access.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-4">Tenant Scope</th>
                  <th className="py-2.5 px-4">RBAC Role</th>
                  <th className="py-2.5 px-4">Credentials</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Last Login</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((user) => {
                  const isSelf = user.id === currentUser.id;
                  const isMasterRow = user.role === 'master_admin';
                  const hasPass = Boolean(user.has_password);

                  return (
                    <tr key={user.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{user.full_name}</div>
                        <div className="text-xs font-mono text-slate-500">
                          {user.username}
                          {user.email ? ` · ${user.email}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700">
                        {isMasterRow ? 'Global Platform' : user.company_name || 'Unassigned'}
                      </td>
                      <td className="py-2.5 px-4">
                        {isMasterRow ? (
                          <span className="text-xs font-semibold text-blue-700">
                            {roleLabel(user.role)}
                          </span>
                        ) : (
                          <select
                            aria-label={`Role for ${user.username}`}
                            value={user.role}
                            disabled={isSelf}
                            onChange={(e) =>
                              void handleUpdateUser(user, { role: e.target.value as UserRole })
                            }
                            className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 disabled:bg-slate-100"
                          >
                            <option value="company_admin">Company Admin</option>
                            <option value="company_operator">Operator</option>
                            <option value="company_viewer">Viewer</option>
                          </select>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {hasPass ? (
                          <span className="text-slate-600">Scrypt hashed</span>
                        ) : (
                          <span className="text-amber-700 font-medium">Password pending</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`text-xs font-medium ${
                            user.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {user.status === 'active' ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums">
                        {formatDateTime(user.last_login_at)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {(!isMasterRow || isSelf) && (
                            <button
                              type="button"
                              onClick={() => {
                                setResetTarget(user);
                                setResetPassword('');
                                setResetError(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-md cursor-pointer"
                            >
                              <KeyRound className="w-3 h-3" />
                              {hasPass ? 'Reset Password' : 'Set Password'}
                            </button>
                          )}
                          {!isMasterRow && !isSelf && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateUser(user, {
                                  status: user.status === 'active' ? 'disabled' : 'active',
                                })
                              }
                              className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                            >
                              {user.status === 'active' ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Create Tenant User Account
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              {createError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {createError}
                </div>
              )}

              {isMaster && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Assigned Company Tenant
                  </label>
                  <select
                    required
                    value={newCompanyId}
                    onChange={(e) => setNewCompanyId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    required
                    type="text"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Username</label>
                  <input
                    required
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="alex_ops"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="alex@company.com"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">RBAC Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="company_admin">Company Admin</option>
                    <option value="company_operator">Operator</option>
                    <option value="company_viewer">Viewer</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password (min 8 characters)
                </label>
                <input
                  required
                  minLength={8}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  {creating ? 'Creating...' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Set Password for {resetTarget.username}
              </h2>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              {resetError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {resetError}
                </div>
              )}
              <p className="text-xs text-slate-600">
                Assigning a new password hashes the credential with salted Scrypt and immediately revokes prior active tokens for this user.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  New Password (min 8 characters)
                </label>
                <input
                  required
                  minLength={8}
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  {resetting ? 'Updating...' : 'Save Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
