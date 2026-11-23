import { Building2, HardDrive, Plus, Search, ShieldAlert, Trash2, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiRequest, formatBytes, formatCurrency, formatDateTime, formatNumber } from '../lib/api';
import { CompanySummary } from '../types';

interface CompaniesViewProps {
  onInspectTenant: (companyId: string, tab?: 'ledger' | 'analytics' | 'csv') => void;
  openCreateModalSignal?: number;
}

export function CompaniesView({ onInspectTenant, openCreateModalSignal }: CompaniesViewProps) {
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');

  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CompanySummary | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // Onboard form fields
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('Logistics & Distribution');
  const [planTier, setPlanTier] = useState<'standard' | 'growth' | 'enterprise'>('enterprise');
  const [contactEmail, setContactEmail] = useState('');
  const [adminFullName, setAdminFullName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadCompanies() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ companies: CompanySummary[] }>('/api/companies');
      setCompanies(res.companies);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCompanies();
  }, []);

  useEffect(() => {
    if (openCreateModalSignal && openCreateModalSignal > 0) {
      setShowOnboardModal(true);
    }
  }, [openCreateModalSignal]);

  async function handleOnboardSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiRequest('/api/companies', {
        method: 'POST',
        body: JSON.stringify({
          name,
          industry,
          planTier,
          contactEmail,
          adminFullName,
          adminUsername,
          adminPassword,
        }),
      });
      setShowOnboardModal(false);
      setName('');
      setContactEmail('');
      setAdminFullName('');
      setAdminUsername('');
      setAdminPassword('');
      await loadCompanies();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to onboard company');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(company: CompanySummary) {
    setActionBusyId(company.id);
    try {
      const nextStatus = company.status === 'active' ? 'suspended' : 'active';
      await apiRequest(`/api/companies/${company.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await loadCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update company status');
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setActionBusyId(deleteTarget.id);
    try {
      await apiRequest(`/api/companies/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await loadCompanies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete company');
    } finally {
      setActionBusyId(null);
    }
  }

  const filtered = companies.filter((c) => {
    const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesQuery =
      !q ||
      c.name.toLowerCase().includes(q) ||
      c.industry.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies or industry..."
              className="pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'active', 'suspended'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === status
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {status === 'all' ? 'All Tenants' : status === 'active' ? 'Active' : 'Suspended'}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowOnboardModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Onboard Company
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
            No matching companies found
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Adjust your filter or onboard a new company tenant with its isolated database.
          </p>
          <button
            type="button"
            onClick={() => setShowOnboardModal(true)}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
          >
            Onboard Company
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((company) => (
            <div
              key={company.id}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-slate-900 truncate">
                      {company.name}
                    </h3>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="truncate">{company.industry}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{company.plan_tier}</span>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium shrink-0 ${
                      company.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {company.status === 'active' ? 'Active' : 'Suspended'}
                  </span>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[11px] text-slate-500">SKUs</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatNumber(company.totalSkus)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Valuation</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatCurrency(company.totalValuation)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500">Users</div>
                    <div className="font-mono text-sm font-semibold text-slate-900 tabular-nums mt-0.5">
                      {formatNumber(company.userCount)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1 font-mono">
                    <HardDrive className="w-3 h-3 text-slate-400" />
                    {formatBytes(company.storageBytes)} isolated DB
                  </span>
                  <span>Created {formatDateTime(company.created_at)}</span>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onInspectTenant(company.id, 'ledger')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-md whitespace-nowrap cursor-pointer"
                  >
                    Open Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => onInspectTenant(company.id, 'csv')}
                    className="px-2.5 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer"
                  >
                    Feed CSV
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={actionBusyId === company.id}
                    onClick={() => void handleToggleStatus(company)}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                  >
                    {company.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    disabled={actionBusyId === company.id}
                    onClick={() => setDeleteTarget(company)}
                    aria-label={`Delete ${company.name}`}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Onboard Company Modal */}
      {showOnboardModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Onboard New Company Tenant
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Provisions an isolated SQLite database and an initial Company Admin account
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOnboardModal(false)}
                aria-label="Close modal"
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleOnboardSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Company Name
                  </label>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Atlas Robotics Logistics"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Industry</label>
                  <input
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="Manufacturing"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Plan Tier</label>
                  <select
                    value={planTier}
                    onChange={(e) => setPlanTier(e.target.value as 'standard' | 'growth' | 'enterprise')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="standard">Standard</option>
                    <option value="growth">Growth</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Operations Contact Email
                  </label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="ops@company.com"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 space-y-4">
                <div className="text-xs font-semibold text-slate-800">
                  Initial Company Administrator Credentials
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Admin Full Name
                    </label>
                    <input
                      required
                      type="text"
                      value={adminFullName}
                      onChange={(e) => setAdminFullName(e.target.value)}
                      placeholder="Jordan Rivera"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Admin Username
                    </label>
                    <input
                      required
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="atlas_admin"
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Initial Password (hashed via Scrypt, min 8 chars)
                    </label>
                    <input
                      required
                      minLength={8}
                      type="password"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Enter initial password for company admin"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowOnboardModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  {submitting ? 'Provisioning Tenant...' : 'Create Company & Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-50 text-red-700 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Delete Tenant & Isolated Database
                </h3>
                <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                  Are you sure you want to permanently remove{' '}
                  <span className="font-semibold text-slate-900">{deleteTarget.name}</span>? This deletes all{' '}
                  <span className="font-mono">{deleteTarget.totalSkus}</span> SKUs, its isolated{' '}
                  <span className="font-mono">{deleteTarget.storage_file.slice(0, 8)}….db</span> partition, and{' '}
                  <span className="font-mono">{deleteTarget.userCount}</span> tenant user accounts.
                </p>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusyId === deleteTarget.id}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg cursor-pointer"
              >
                {actionBusyId === deleteTarget.id ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
