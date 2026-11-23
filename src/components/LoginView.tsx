import { Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import React, { useState } from 'react';
import { apiRequest, setAuthToken } from '../lib/api';
import { AuthUser } from '../types';

interface LoginViewProps {
  onAuthenticated: (user: AuthUser) => void;
}

export function LoginView({ onAuthenticated }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Enter both your username and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 lg:p-8">
      <div className="w-full max-w-5xl bg-white border border-slate-200 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-6 p-8 sm:p-10 lg:p-12 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white font-display font-bold text-sm">
                VS
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-slate-900">
                VantageStock
              </span>
            </div>

            <div className="mt-10">
              <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900 text-balance">
                Multi-Tenant Inventory Control
              </h1>
              <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">
                Sign in with your Master Administrator or Company Tenant credentials to access isolated inventory workspaces and analytics.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              {error && (
                <div
                  role="alert"
                  className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="username" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full pl-10 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 cursor-pointer"
              >
                {loading ? 'Verifying credentials...' : 'Sign In'}
              </button>
            </form>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-200 grid grid-cols-2 gap-4 text-xs text-slate-500">
            <div>
              <div className="font-medium text-slate-700 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                <span>Salted Scrypt Auth</span>
              </div>
              <p className="mt-1 text-slate-500">
                Credentials verified against cryptographic hashes with token revocation.
              </p>
            </div>
            <div>
              <div className="font-medium text-slate-700">Isolated Tenant Storage</div>
              <p className="mt-1 text-slate-500">
                Each onboarded company operates on a dedicated SQLite database partition.
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 relative min-h-[280px] lg:min-h-[580px] bg-slate-900">
          {!imgError ? (
            <img
              src="/src/assets/images/logistics_warehouse_architecture_1795437526172.jpg"
              alt="Modern automated inventory distribution facility"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 flex items-center justify-center p-8">
              <div className="text-slate-400 text-sm font-display">VantageStock Warehouse Operations</div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/35 to-transparent flex flex-col justify-end p-8 lg:p-10">
            <p className="text-xs font-medium text-slate-300">
              Enterprise Multi-Tenant Architecture
            </p>
            <h2 className="mt-1.5 font-display text-xl font-semibold text-white text-balance">
              Centralized oversight with strict company-level data boundaries.
            </h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed max-w-md">
              Onboard companies, delegate tenant administrators, ingest bulk CSV inventory feeds, and monitor valuation across every warehouse.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
