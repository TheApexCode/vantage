import {
  BarChart3,
  Building2,
  FileSpreadsheet,
  LogOut,
  Menu,
  Package,
  Plus,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import { AuditSecurityView } from './components/AuditSecurityView';
import { CompaniesView } from './components/CompaniesView';
import { CrossTenantAnalyticsView } from './components/CrossTenantAnalyticsView';
import { InventoryWorkspaceView } from './components/InventoryWorkspaceView';
import { LoginView } from './components/LoginView';
import { UsersRbacView } from './components/UsersRbacView';
import { roleLabel, setAuthToken } from './lib/api';
import { AuthUser } from './types';

type ActiveSection =
  | 'cross_tenant'
  | 'companies'
  | 'inventory'
  | 'users'
  | 'audit';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [section, setSection] = useState<ActiveSection>('cross_tenant');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [inventorySubTab, setInventorySubTab] = useState<'ledger' | 'analytics' | 'csv'>('ledger');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Action button triggers from top header
  const [onboardModalSignal, setOnboardModalSignal] = useState(0);
  const [addSkuModalSignal, setAddSkuModalSignal] = useState(0);

  function handleAuthenticated(authenticatedUser: AuthUser) {
    setUser(authenticatedUser);
    if (authenticatedUser.role === 'master_admin') {
      setSection('cross_tenant');
      setSelectedCompanyId(null);
      setInventorySubTab('ledger');
    } else {
      setSection('inventory');
      setSelectedCompanyId(authenticatedUser.companyId);
      setInventorySubTab('ledger');
    }
  }

  function handleLogout() {
    setAuthToken(null);
    setUser(null);
    setSelectedCompanyId(null);
  }

  function handleInspectTenant(companyId: string, tab: 'ledger' | 'analytics' | 'csv' = 'ledger') {
    setSelectedCompanyId(companyId);
    setInventorySubTab(tab);
    setSection('inventory');
    setMobileMenuOpen(false);
  }

  if (!user) {
    return <LoginView onAuthenticated={handleAuthenticated} />;
  }

  const isMaster = user.role === 'master_admin';
  const canManageUsers = user.role === 'master_admin' || user.role === 'company_admin';
  const canWriteInventory = user.role !== 'company_viewer';

  const navItems: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    isActive: boolean;
    onClick: () => void;
  }> = isMaster
    ? [
        {
          id: 'cross_tenant',
          label: 'Cross-Tenant Analytics',
          icon: BarChart3,
          isActive: section === 'cross_tenant',
          onClick: () => setSection('cross_tenant'),
        },
        {
          id: 'companies',
          label: 'Companies & Tenants',
          icon: Building2,
          isActive: section === 'companies',
          onClick: () => setSection('companies'),
        },
        {
          id: 'inventory',
          label: 'Tenant Inventory',
          icon: Package,
          isActive: section === 'inventory',
          onClick: () => {
            setSection('inventory');
          },
        },
        {
          id: 'users',
          label: 'Users & RBAC',
          icon: Users,
          isActive: section === 'users',
          onClick: () => setSection('users'),
        },
        {
          id: 'audit',
          label: 'Audit & Security',
          icon: ShieldCheck,
          isActive: section === 'audit',
          onClick: () => setSection('audit'),
        },
      ]
    : [
        {
          id: 'inv_ledger',
          label: 'Inventory Ledger',
          icon: Package,
          isActive: section === 'inventory' && inventorySubTab === 'ledger',
          onClick: () => {
            setSection('inventory');
            setInventorySubTab('ledger');
          },
        },
        {
          id: 'inv_analytics',
          label: 'Company Analytics',
          icon: BarChart3,
          isActive: section === 'inventory' && inventorySubTab === 'analytics',
          onClick: () => {
            setSection('inventory');
            setInventorySubTab('analytics');
          },
        },
        ...(canWriteInventory
          ? [
              {
                id: 'inv_csv',
                label: 'CSV Bulk Feed',
                icon: FileSpreadsheet,
                isActive: section === 'inventory' && inventorySubTab === 'csv',
                onClick: () => {
                  setSection('inventory');
                  setInventorySubTab('csv');
                },
              },
            ]
          : []),
        ...(canManageUsers
          ? [
              {
                id: 'users',
                label: 'Team & RBAC',
                icon: Users,
                isActive: section === 'users',
                onClick: () => setSection('users'),
              },
              {
                id: 'audit',
                label: 'Audit & Security',
                icon: ShieldCheck,
                isActive: section === 'audit',
                onClick: () => setSection('audit'),
              },
            ]
          : []),
      ];

  function getBreadcrumb(): { root: string; current: string } {
    const scope = isMaster ? 'Master Platform' : user?.companyName || 'Tenant Workspace';
    switch (section) {
      case 'cross_tenant':
        return { root: scope, current: 'Cross-Tenant Analytics' };
      case 'companies':
        return { root: scope, current: 'Companies & Tenants' };
      case 'inventory':
        if (inventorySubTab === 'csv') return { root: scope, current: 'CSV Bulk Feed' };
        if (inventorySubTab === 'analytics') return { root: scope, current: 'Tenant Analytics' };
        return { root: scope, current: 'Inventory Ledger' };
      case 'users':
        return { root: scope, current: isMaster ? 'Users & RBAC' : 'Team & RBAC' };
      case 'audit':
        return { root: scope, current: 'Audit & Security' };
    }
  }

  const breadcrumb = getBreadcrumb();

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Fixed 256px Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-150 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-slate-900 text-white font-display font-bold text-xs flex items-center justify-center">
                VS
              </div>
              <span className="font-display font-bold text-base tracking-tight text-slate-900 whitespace-nowrap">
                VantageStock
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.onClick();
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    item.isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">{user.fullName}</div>
            <div className="mt-0.5 text-[11px] text-slate-500 truncate">
              <span className="font-mono text-slate-700">{user.username}</span>
              <span className="mx-1">·</span>
              <span>{roleLabel(user.role)}</span>
            </div>
            {user.companyName && (
              <div className="mt-0.5 text-[11px] text-slate-500 truncate">{user.companyName}</div>
            )}
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg bg-white transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-6 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 truncate hidden sm:inline">{breadcrumb.root}</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {breadcrumb.current}
              </h1>
            </div>
          </div>

          {/* At most 1-2 contextual primary actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            {isMaster && (section === 'cross_tenant' || section === 'companies') && (
              <button
                type="button"
                onClick={() => {
                  setSection('companies');
                  setOnboardModalSignal((n) => n + 1);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Onboard Company
              </button>
            )}

            {section === 'inventory' && canWriteInventory && inventorySubTab !== 'csv' && (
              <>
                <button
                  type="button"
                  onClick={() => setInventorySubTab('csv')}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:border-slate-300 bg-white text-slate-700 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Feed CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInventorySubTab('ledger');
                    setAddSkuModalSignal((n) => n + 1);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add SKU
                </button>
              </>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {section === 'cross_tenant' && isMaster && (
            <CrossTenantAnalyticsView
              onInspectTenant={handleInspectTenant}
              onNavigateCompanies={() => setSection('companies')}
            />
          )}

          {section === 'companies' && isMaster && (
            <CompaniesView
              onInspectTenant={handleInspectTenant}
              openCreateModalSignal={onboardModalSignal}
            />
          )}

          {section === 'inventory' && (
            <InventoryWorkspaceView
              currentUser={user}
              selectedCompanyId={selectedCompanyId}
              onSelectCompanyId={setSelectedCompanyId}
              activeSubTab={inventorySubTab}
              onChangeSubTab={setInventorySubTab}
              openAddSkuSignal={addSkuModalSignal}
            />
          )}

          {section === 'users' && canManageUsers && (
            <UsersRbacView currentUser={user} />
          )}

          {section === 'audit' && canManageUsers && (
            <AuditSecurityView currentUser={user} />
          )}
        </main>
      </div>
    </div>
  );
}
