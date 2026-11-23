import {
  ArrowDownUp,
  Building2,
  Download,
  HardDrive,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import {
  apiRequest,
  downloadTenantCsv,
  formatBytes,
  formatCurrency,
  formatDateTime,
  formatNumber,
} from '../lib/api';
import { AuthUser, CompanySummary, InventoryItem, TenantAnalytics } from '../types';
import { CsvFeedSection } from './CsvFeedSection';

interface InventoryWorkspaceViewProps {
  currentUser: AuthUser;
  selectedCompanyId: string | null;
  onSelectCompanyId: (companyId: string) => void;
  activeSubTab: 'ledger' | 'analytics' | 'csv';
  onChangeSubTab: (tab: 'ledger' | 'analytics' | 'csv') => void;
  openAddSkuSignal?: number;
}

export function InventoryWorkspaceView({
  currentUser,
  selectedCompanyId,
  onSelectCompanyId,
  activeSubTab,
  onChangeSubTab,
  openAddSkuSignal,
}: InventoryWorkspaceViewProps) {
  const isMaster = currentUser.role === 'master_admin';
  const canWrite = currentUser.role !== 'company_viewer';
  const canDelete = currentUser.role === 'master_admin' || currentUser.role === 'company_admin';

  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [warehouses, setWarehouses] = useState<string[]>([]);
  const [analytics, setAnalytics] = useState<TenantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'low' | 'out'>('all');

  // Modals
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  // Add/Edit SKU state
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('General');
  const [quantity, setQuantity] = useState('0');
  const [unit, setUnit] = useState('pcs');
  const [unitPrice, setUnitPrice] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('10');
  const [warehouse, setWarehouse] = useState('Main Hub');
  const [supplier, setSupplier] = useState('');
  const [itemFormError, setItemFormError] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  // Stock adjustment state
  const [adjustDelta, setAdjustDelta] = useState('0');
  const [adjustReason, setAdjustReason] = useState('Cycle Count Adjustment');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [savingAdjust, setSavingAdjust] = useState(false);

  const effectiveCompanyId = isMaster ? selectedCompanyId : currentUser.companyId;

  useEffect(() => {
    if (!isMaster) return;
    apiRequest<{ companies: CompanySummary[] }>('/api/companies')
      .then((res) => {
        setCompanies(res.companies);
        if (!selectedCompanyId && res.companies.length > 0) {
          onSelectCompanyId(res.companies[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load company list');
      });
  }, [isMaster]);

  async function loadWorkspaceData(targetId: string) {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (categoryFilter !== 'all') qs.set('category', categoryFilter);
      if (warehouseFilter !== 'all') qs.set('warehouse', warehouseFilter);
      if (statusFilter !== 'all') qs.set('status', statusFilter);

      const [invRes, anaRes] = await Promise.all([
        apiRequest<{ items: InventoryItem[]; categories: string[]; warehouses: string[] }>(
          `/api/tenants/${encodeURIComponent(targetId)}/inventory?${qs.toString()}`
        ),
        apiRequest<TenantAnalytics>(`/api/tenants/${encodeURIComponent(targetId)}/analytics`),
      ]);

      setItems(invRes.items);
      setCategories(invRes.categories);
      setWarehouses(invRes.warehouses);
      setAnalytics(anaRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant inventory');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (effectiveCompanyId) {
      void loadWorkspaceData(effectiveCompanyId);
    } else {
      setLoading(false);
    }
  }, [effectiveCompanyId, search, categoryFilter, warehouseFilter, statusFilter]);

  useEffect(() => {
    if (openAddSkuSignal && openAddSkuSignal > 0 && canWrite && effectiveCompanyId) {
      openCreateModal();
    }
  }, [openAddSkuSignal]);

  function openCreateModal() {
    setEditingItem(null);
    setSku('');
    setName('');
    setCategory('General');
    setQuantity('0');
    setUnit('pcs');
    setUnitPrice('0');
    setReorderLevel('10');
    setWarehouse('Main Hub');
    setSupplier('');
    setItemFormError(null);
    setShowItemModal(true);
  }

  function openEditModal(item: InventoryItem) {
    setEditingItem(item);
    setSku(item.sku);
    setName(item.name);
    setCategory(item.category);
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setUnitPrice(String(item.unit_price));
    setReorderLevel(String(item.reorder_level));
    setWarehouse(item.warehouse);
    setSupplier(item.supplier);
    setItemFormError(null);
    setShowItemModal(true);
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveCompanyId) return;
    setItemFormError(null);
    setSavingItem(true);

    try {
      if (editingItem) {
        await apiRequest(
          `/api/tenants/${encodeURIComponent(effectiveCompanyId)}/inventory/${editingItem.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name,
              category,
              quantity: Number(quantity),
              unit,
              unitPrice: Number(unitPrice),
              reorderLevel: Number(reorderLevel),
              warehouse,
              supplier,
              reason: 'SKU Record Updated',
            }),
          }
        );
      } else {
        await apiRequest(`/api/tenants/${encodeURIComponent(effectiveCompanyId)}/inventory`, {
          method: 'POST',
          body: JSON.stringify({
            sku,
            name,
            category,
            quantity: Number(quantity),
            unit,
            unitPrice: Number(unitPrice),
            reorderLevel: Number(reorderLevel),
            warehouse,
            supplier,
          }),
        });
      }
      setShowItemModal(false);
      await loadWorkspaceData(effectiveCompanyId);
    } catch (err) {
      setItemFormError(err instanceof Error ? err.message : 'Failed to save SKU');
    } finally {
      setSavingItem(false);
    }
  }

  async function handleStockAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveCompanyId || !adjustTarget) return;
    setAdjustError(null);
    const deltaNum = Number(adjustDelta);
    if (!Number.isInteger(deltaNum) || deltaNum === 0) {
      setAdjustError('Enter a non-zero integer adjustment (e.g., +25 or -10).');
      return;
    }

    setSavingAdjust(true);
    try {
      await apiRequest(
        `/api/tenants/${encodeURIComponent(effectiveCompanyId)}/inventory/${adjustTarget.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ delta: deltaNum, reason: adjustReason }),
        }
      );
      setAdjustTarget(null);
      await loadWorkspaceData(effectiveCompanyId);
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Failed to adjust stock');
    } finally {
      setSavingAdjust(false);
    }
  }

  async function handleDeleteItem() {
    if (!effectiveCompanyId || !deleteTarget) return;
    try {
      await apiRequest(
        `/api/tenants/${encodeURIComponent(effectiveCompanyId)}/inventory/${deleteTarget.id}`,
        { method: 'DELETE' }
      );
      setDeleteTarget(null);
      await loadWorkspaceData(effectiveCompanyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete SKU');
    }
  }

  if (!effectiveCompanyId) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
        <h3 className="mt-3 font-display text-base font-semibold text-slate-900">
          No company tenant selected
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Onboard a company first to inspect or feed inventory into its isolated database.
        </p>
      </div>
    );
  }

  const companyInfo = analytics?.company;
  const summary = analytics?.summary;

  return (
    <div className="space-y-6">
      {/* Tenant Context Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {isMaster ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Tenant Partition:</span>
              <select
                aria-label="Select active company tenant"
                value={effectiveCompanyId}
                onChange={(e) => {
                  setCategoryFilter('all');
                  setWarehouseFilter('all');
                  onSelectCompanyId(e.target.value);
                }}
                className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-sm font-display font-semibold text-slate-900">
              {companyInfo?.name || currentUser.companyName}
            </div>
          )}

          {companyInfo && (
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-mono">
              <HardDrive className="w-3.5 h-3.5 text-slate-400" />
              <span>{companyInfo.storage_file.slice(0, 12)}….db</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(summary?.storageBytes || 0)}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(
            [
              { id: 'ledger', label: 'Inventory Ledger' },
              { id: 'analytics', label: 'Tenant Analytics' },
              { id: 'csv', label: 'CSV Feed' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeSubTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeSubTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Sub-tab 1: Inventory Ledger */}
      {activeSubTab === 'ledger' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search SKU, item, supplier..."
                  className="pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                className="px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="all">All Warehouses</option>
                {warehouses.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'healthy', label: 'Nominal' },
                    { id: 'low', label: 'Low Stock' },
                    { id: 'out', label: 'Out' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      statusFilter === st.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadTenantCsv(effectiveCompanyId, companyInfo?.slug || 'inventory')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              {canWrite && (
                <>
                  <button
                    type="button"
                    onClick={() => onChangeSubTab('csv')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Import CSV
                  </button>
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add SKU
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="mt-3 font-display text-sm font-semibold text-slate-900">
                  No inventory SKUs found
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Add SKUs manually or bulk-feed inventory from a CSV spreadsheet.
                </p>
                {canWrite && (
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => onChangeSubTab('csv')}
                      className="px-3.5 py-2 text-xs font-medium border border-slate-200 hover:border-slate-300 rounded-lg text-slate-700 cursor-pointer"
                    >
                      Import CSV File
                    </button>
                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="px-3.5 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer"
                    >
                      Add First SKU
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2.5 px-4">SKU</th>
                      <th className="py-2.5 px-4">Item Name</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4">Warehouse</th>
                      <th className="py-2.5 px-4 text-right">On Hand</th>
                      <th className="py-2.5 px-4 text-right">Reorder</th>
                      <th className="py-2.5 px-4 text-right">Unit Price</th>
                      <th className="py-2.5 px-4 text-right">Line Value</th>
                      <th className="py-2.5 px-4">Stock State</th>
                      {canWrite && <th className="py-2.5 px-4 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {items.map((item) => {
                      const isOut = item.quantity === 0;
                      const isLow = item.quantity > 0 && item.quantity <= item.reorder_level;
                      const lineVal = item.quantity * item.unit_price;

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                            {item.sku}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-slate-900">{item.name}</div>
                            {item.supplier && (
                              <div className="text-[11px] text-slate-500">{item.supplier}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                            {item.category}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">
                            {item.warehouse}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatNumber(item.quantity)}{' '}
                            <span className="font-sans font-normal text-slate-400">{item.unit}</span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-500 tabular-nums">
                            {formatNumber(item.reorder_level)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono text-slate-700 tabular-nums">
                            {formatCurrency(item.unit_price)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-900 tabular-nums">
                            {formatCurrency(lineVal)}
                          </td>
                          <td className="py-2.5 px-4 whitespace-nowrap font-medium">
                            {isOut ? (
                              <span className="text-red-700">Out of Stock</span>
                            ) : isLow ? (
                              <span className="text-amber-700">Low Stock</span>
                            ) : (
                              <span className="text-emerald-700">Nominal</span>
                            )}
                          </td>
                          {canWrite && (
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdjustTarget(item);
                                    setAdjustDelta('0');
                                    setAdjustReason('Cycle Count Adjustment');
                                    setAdjustError(null);
                                  }}
                                  title="Adjust stock quantity"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 hover:text-slate-900 border border-slate-200 rounded cursor-pointer"
                                >
                                  <ArrowDownUp className="w-3 h-3" />
                                  Stock
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(item)}
                                  aria-label={`Edit ${item.sku}`}
                                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                {canDelete && (
                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget(item)}
                                    aria-label={`Delete ${item.sku}`}
                                    className="p-1.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-tab 2: Tenant Analytics */}
      {activeSubTab === 'analytics' && analytics && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Total SKUs</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {formatNumber(summary.totalSkus)}
              </div>
              <div className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
                {formatNumber(summary.warehouseCount)} active warehouses
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Inventory Valuation</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {formatCurrency(summary.totalValuation)}
              </div>
              <div className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
                {formatNumber(summary.totalUnits)} total units on hand
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">Reorder Queue</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {formatNumber(summary.lowStockCount + summary.outOfStockCount)}
              </div>
              <div className="mt-1.5 text-xs">
                <span className="text-red-700 font-medium">{summary.outOfStockCount} out</span>
                <span className="text-slate-300 mx-1.5">·</span>
                <span className="text-amber-700 font-medium">{summary.lowStockCount} low</span>
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-medium text-slate-500">CSV Ingestion Volume</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
                {formatNumber(summary.rowsIngested)}
                <span className="text-xs font-normal text-slate-400 ml-1">rows</span>
              </div>
              <div className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
                {formatNumber(summary.importBatchCount)} committed batches
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h3 className="font-display text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
                Valuation by Category
              </h3>
              {analytics.categories.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No categories yet.</div>
              ) : (
                <div className="mt-4 space-y-3.5">
                  {analytics.categories.map((cat) => {
                    const maxVal = Math.max(1, ...analytics.categories.map((c) => c.valuation));
                    const pct = Math.max(4, Math.round((cat.valuation / maxVal) * 100));
                    return (
                      <div key={cat.category}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-800">{cat.category}</span>
                          <span className="font-mono text-slate-900 tabular-nums">
                            {formatCurrency(cat.valuation)} · {formatNumber(cat.units)} u
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 bg-slate-100 rounded-sm overflow-hidden">
                          <div className="h-full bg-blue-600" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h3 className="font-display text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
                Warehouse Stock Distribution
              </h3>
              {analytics.warehouses.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No warehouses yet.</div>
              ) : (
                <div className="mt-4 divide-y divide-slate-100">
                  {analytics.warehouses.map((w) => (
                    <div key={w.warehouse} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-medium text-slate-900">{w.warehouse}</div>
                        <div className="text-slate-500 font-mono">{formatNumber(w.skus)} SKUs</div>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{formatCurrency(w.valuation)}</div>
                        <div className="text-slate-500">{formatNumber(w.units)} units</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Critical Reorder Queue
                </h3>
              </div>
              {analytics.lowStockItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  All SKUs are above configured reorder thresholds.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {analytics.lowStockItems.map((item) => (
                    <div key={item.id} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">
                          <span className="font-mono text-slate-500 mr-2">{item.sku}</span>
                          {item.name}
                        </div>
                        <div className="text-slate-500 mt-0.5">{item.warehouse}</div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className={item.quantity === 0 ? 'text-red-700 font-semibold' : 'text-amber-700 font-semibold'}>
                          {item.quantity} / {item.reorder_level} min
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Recent Tenant Stock Movements
                </h3>
              </div>
              {analytics.recentMovements.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No stock movements recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 text-xs">
                  {analytics.recentMovements.map((m) => (
                    <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">
                          <span className="font-mono text-slate-500 mr-2">{m.sku}</span>
                          {m.item_name}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {m.reason} · {m.actor_username}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
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
          </div>
        </div>
      )}

      {/* Sub-tab 3: CSV Bulk Feed */}
      {activeSubTab === 'csv' && (
        <CsvFeedSection
          companyId={effectiveCompanyId}
          companyName={companyInfo?.name || currentUser.companyName || 'Company Tenant'}
          canWrite={canWrite}
          recentImports={analytics?.recentImports || []}
          onImportSuccess={() => void loadWorkspaceData(effectiveCompanyId)}
        />
      )}

      {/* Add / Edit SKU Modal */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900">
                {editingItem ? `Edit SKU: ${editingItem.sku}` : 'Add New Inventory SKU'}
              </h2>
              <button
                type="button"
                onClick={() => setShowItemModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveItem} className="p-6 space-y-4">
              {itemFormError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {itemFormError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SKU Code</label>
                  <input
                    required
                    disabled={Boolean(editingItem)}
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value.toUpperCase())}
                    placeholder="SKU-4001"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Hardware"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Item Name</label>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Precision Ball Screw Assembly"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
                  <input
                    required
                    min={0}
                    step={1}
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Unit of Measure</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="pcs"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Unit Price (USD)</label>
                  <input
                    required
                    min={0}
                    step="0.01"
                    type="number"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reorder Level</label>
                  <input
                    required
                    min={0}
                    step={1}
                    type="number"
                    value={reorderLevel}
                    onChange={(e) => setReorderLevel(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Warehouse</label>
                  <input
                    type="text"
                    value={warehouse}
                    onChange={(e) => setWarehouse(e.target.value)}
                    placeholder="Main Hub"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Supplier</label>
                  <input
                    type="text"
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="Vendor name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingItem}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  {savingItem ? 'Saving...' : editingItem ? 'Save Changes' : 'Create SKU'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Adjust Stock: {adjustTarget.sku}
              </h2>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleStockAdjust} className="p-6 space-y-4">
              {adjustError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  {adjustError}
                </div>
              )}
              <div className="text-xs text-slate-600 flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg border border-slate-200">
                <span>Current On Hand</span>
                <span className="font-mono font-semibold text-slate-900">
                  {formatNumber(adjustTarget.quantity)} {adjustTarget.unit}
                </span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Quantity Delta (+ inbound / - outbound)
                </label>
                <input
                  required
                  type="number"
                  step={1}
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Movement Reason</label>
                <input
                  required
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAdjust}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                >
                  {savingAdjust ? 'Applying...' : 'Commit Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete SKU Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-sm p-6">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Remove SKU {deleteTarget.sku}?
            </h3>
            <p className="mt-1.5 text-xs text-slate-600">
              This removes <span className="font-medium text-slate-900">{deleteTarget.name}</span> from this tenant&apos;s isolated inventory database.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteItem()}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg cursor-pointer"
              >
                Delete SKU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
