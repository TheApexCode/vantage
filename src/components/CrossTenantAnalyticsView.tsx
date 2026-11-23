import { AlertTriangle, ArrowUpRight, Building2, FileSpreadsheet, Package } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiRequest, formatBytes, formatCurrency, formatDateTime, formatNumber } from '../lib/api';
import { CrossTenantAnalytics } from '../types';

interface CrossTenantAnalyticsViewProps {
  onInspectTenant: (companyId: string, tab?: 'ledger' | 'analytics' | 'csv') => void;
  onNavigateCompanies: () => void;
}

export function CrossTenantAnalyticsView({
  onInspectTenant,
  onNavigateCompanies,
}: CrossTenantAnalyticsViewProps) {
  const [data, setData] = useState<CrossTenantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredTenantId, setHoveredTenantId] = useState<string | null>(null);

  async function loadAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<CrossTenantAnalytics>('/api/analytics/cross-tenant');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cross-tenant analytics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-slate-200 rounded-xl p-5 animate-pulse">
              <div className="h-3 w-24 bg-slate-200 rounded" />
              <div className="h-7 w-32 bg-slate-200 rounded mt-4" />
            </div>
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-8 text-center">
        <p className="text-sm text-red-700 font-medium">{error || 'Unable to load analytics'}</p>
        <button
          type="button"
          onClick={() => void loadAnalytics()}
          className="mt-4 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  const { overview, tenantBreakdown, categories, recentMovements, recentImports } = data;
  const maxValuation = Math.max(1, ...tenantBreakdown.map((t) => t.totalValuation));
  const maxCategoryVal = Math.max(1, ...categories.map((c) => c.valuation));
  const totalAlerts = overview.lowStockCount + overview.outOfStockCount;

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Onboarded Companies</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatNumber(overview.activeCompanies)}
            <span className="text-sm font-normal text-slate-400 ml-1.5">
              / {formatNumber(overview.totalCompanies)} total
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {overview.suspendedCompanies > 0
              ? `${overview.suspendedCompanies} suspended · Isolated DBs`
              : `All tenant partitions operational`}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Cross-Tenant Valuation</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatCurrency(overview.totalValuation)}
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            {formatNumber(overview.totalUnits)} units across {formatNumber(overview.totalSkus)} SKUs
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">Stock Risk Alerts</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatNumber(totalAlerts)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className={overview.outOfStockCount > 0 ? 'text-red-700 font-medium' : 'text-slate-500'}>
              {overview.outOfStockCount} out of stock
            </span>
            <span className="text-slate-300" aria-hidden="true">·</span>
            <span className={overview.lowStockCount > 0 ? 'text-amber-700 font-medium' : 'text-slate-500'}>
              {overview.lowStockCount} low stock
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">CSV Feeds & Storage</div>
          <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {formatNumber(overview.totalImports)}
            <span className="text-sm font-normal text-slate-400 ml-1.5">batches</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            {formatBytes(overview.totalStorageBytes)} isolated SQLite storage
          </div>
        </div>
      </div>

      {/* Main Comparison Chart & Category Breakdown */}
      {tenantBreakdown.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
            No companies onboarded yet
          </h3>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
            Onboard your first company tenant to provision its isolated inventory database and unlock cross-tenant analytics.
          </p>
          <button
            type="button"
            onClick={onNavigateCompanies}
            className="mt-5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
          >
            Onboard First Company
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 8 cols: Cross-Tenant Valuation & Stock Health Bar Chart */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Tenant Valuation & Stock Distribution
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live aggregated valuation and SKU health ratio per isolated company database
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-600">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" />
                  Nominal
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />
                  Low Stock
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" />
                  Out of Stock
                </span>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              {tenantBreakdown.map((tenant) => {
                const valPct = Math.max(4, Math.round((tenant.totalValuation / maxValuation) * 100));
                const total = Math.max(1, tenant.totalSkus);
                const healthyPct = (tenant.healthyCount / total) * 100;
                const lowPct = (tenant.lowStockCount / total) * 100;
                const outPct = (tenant.outOfStockCount / total) * 100;
                const isHovered = hoveredTenantId === tenant.companyId;

                return (
                  <div
                    key={tenant.companyId}
                    onMouseEnter={() => setHoveredTenantId(tenant.companyId)}
                    onMouseLeave={() => setHoveredTenantId(null)}
                    className="group"
                  >
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => onInspectTenant(tenant.companyId, 'ledger')}
                          className="font-medium text-slate-900 hover:text-blue-600 truncate text-left cursor-pointer"
                        >
                          {tenant.companyName}
                        </button>
                        <span className="text-xs text-slate-400 shrink-0">·</span>
                        <span className="text-xs text-slate-500 shrink-0">
                          {tenant.industry}
                        </span>
                        {tenant.status === 'suspended' && (
                          <>
                            <span className="text-xs text-slate-400 shrink-0">·</span>
                            <span className="text-xs font-medium text-red-700 shrink-0">Suspended</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-4 shrink-0 font-mono text-xs tabular-nums">
                        <span className="text-slate-500">{formatNumber(tenant.totalSkus)} SKUs</span>
                        <span className="font-semibold text-slate-900">
                          {formatCurrency(tenant.totalValuation)}
                        </span>
                      </div>
                    </div>

                    {/* Valuation bar */}
                    <div className="mt-2 h-2.5 w-full bg-slate-100 rounded-sm overflow-hidden">
                      <div
                        className={`h-full transition-colors ${
                          isHovered ? 'bg-blue-700' : 'bg-blue-600'
                        }`}
                        style={{ width: `${valPct}%` }}
                      />
                    </div>

                    {/* Health composition bar */}
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-sm overflow-hidden flex">
                        {tenant.totalSkus > 0 && (
                          <>
                            <div className="bg-emerald-600 h-full" style={{ width: `${healthyPct}%` }} />
                            <div className="bg-amber-500 h-full" style={{ width: `${lowPct}%` }} />
                            <div className="bg-red-600 h-full" style={{ width: `${outPct}%` }} />
                          </>
                        )}
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 tabular-nums w-24 text-right">
                        {tenant.healthPct}% healthy
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right 4 cols: Global Category Valuation */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6">
            <div className="pb-4 border-b border-slate-200">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Top Categories Across Tenants
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Combined valuation by inventory classification
              </p>
            </div>

            {categories.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                No SKU categories recorded yet.
              </div>
            ) : (
              <div className="mt-4 divide-y divide-slate-100">
                {categories.slice(0, 7).map((cat) => {
                  const pct = Math.max(5, Math.round((cat.valuation / maxCategoryVal) * 100));
                  return (
                    <div key={cat.category} className="py-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-800 truncate pr-3">{cat.category}</span>
                        <span className="font-mono font-medium text-slate-900 tabular-nums shrink-0">
                          {formatCurrency(cat.valuation)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-sm overflow-hidden">
                          <div className="h-full bg-slate-700" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                          {formatNumber(cat.units)} u
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tenant Health Matrix Table */}
      {tenantBreakdown.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Isolated Tenant Health Matrix
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Direct drill-down into each company&apos;s partitioned SQLite inventory ledger and CSV pipeline
              </p>
            </div>
            <button
              type="button"
              onClick={onNavigateCompanies}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Manage Companies
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4">Company Tenant</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Partition File</th>
                  <th className="py-2.5 px-4 text-right">Users</th>
                  <th className="py-2.5 px-4 text-right">SKUs</th>
                  <th className="py-2.5 px-4 text-right">Units</th>
                  <th className="py-2.5 px-4 text-right">Low / Out</th>
                  <th className="py-2.5 px-4 text-right">Valuation</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {tenantBreakdown.map((t) => (
                  <tr key={t.companyId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{t.companyName}</div>
                      <div className="text-xs text-slate-500">
                        {t.industry} · {t.planTier}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={`text-xs font-medium ${
                          t.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {t.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-500">
                      {t.storageFile.slice(0, 12)}….db
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {formatNumber(t.userCount)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-900 tabular-nums">
                      {formatNumber(t.totalSkus)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs text-slate-700 tabular-nums">
                      {formatNumber(t.totalUnits)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums">
                      <span className={t.lowStockCount > 0 ? 'text-amber-700 font-medium' : 'text-slate-400'}>
                        {t.lowStockCount}
                      </span>
                      <span className="text-slate-300 mx-1">/</span>
                      <span className={t.outOfStockCount > 0 ? 'text-red-700 font-medium' : 'text-slate-400'}>
                        {t.outOfStockCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {formatCurrency(t.totalValuation)}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onInspectTenant(t.companyId, 'csv')}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-md cursor-pointer"
                        >
                          Feed CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => onInspectTenant(t.companyId, 'ledger')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 rounded-md cursor-pointer"
                        >
                          Inspect
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Cross-Tenant Movements & CSV Batches */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Recent Cross-Tenant Stock Movements
            </h3>
            <Package className="w-4 h-4 text-slate-400" />
          </div>
          {recentMovements.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No stock movements recorded yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentMovements.slice(0, 7).map((m) => (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      <span className="font-mono text-slate-600 mr-2">{m.sku}</span>
                      {m.item_name}
                    </div>
                    <div className="mt-0.5 text-slate-500 truncate">
                      {m.companyName} · {m.reason} · by {m.actor_username}
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono tabular-nums">
                    <div className={m.delta >= 0 ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                      {m.delta >= 0 ? `+${m.delta}` : m.delta}
                    </div>
                    <div className="text-[11px] text-slate-400">{formatDateTime(m.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Recent CSV Inventory Batches
            </h3>
            <FileSpreadsheet className="w-4 h-4 text-slate-400" />
          </div>
          {recentImports.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No CSV imports processed yet.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentImports.slice(0, 7).map((imp) => (
                <div key={imp.id} className="px-5 py-3 flex items-center justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <div className="font-mono font-medium text-slate-900 truncate">{imp.filename}</div>
                    <div className="mt-0.5 text-slate-500 truncate">
                      {imp.companyName} · uploaded by {imp.actor_username}
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono tabular-nums">
                    <div className="text-slate-900 font-medium">
                      +{imp.inserted_count} / ~{imp.updated_count}
                      {imp.error_count > 0 && (
                        <span className="text-amber-700 ml-1.5 inline-flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" />
                          {imp.error_count}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">{formatDateTime(imp.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
