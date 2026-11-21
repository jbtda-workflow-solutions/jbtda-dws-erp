import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Key,
  Plug,
  Plus,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Trash2,
  FolderSync,
  Table2,
  Calendar,
  Lock,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  connectorsApi,
  ApiError,
  type ApiKeyScopeDefinition,
  type ApiKeySummary,
  type ConnectorsOverviewResponse,
} from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusTag } from '@/components/ui/StatusTag';

type ConnectorsTab = 'apps' | 'api-keys';

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ConnectorsPage() {
  const { role } = useAuth();
  const isAdmin = role === 'ADMIN';
  const canAccess = role === 'ADMIN' || role === 'ACCOUNTANT';

  const [activeTab, setActiveTab] = useState<ConnectorsTab>('apps');
  const [overview, setOverview] = useState<ConnectorsOverviewResponse | null>(
    null,
  );
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [scopes, setScopes] = useState<ApiKeyScopeDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Create API Key modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<string>('90');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'reports:read',
    'contacts:read',
  ]);
  const [creatingKey, setCreatingKey] = useState(false);

  // One-time plaintext reveal modal
  const [revealedKey, setRevealedKey] = useState<{
    name: string;
    plaintextKey: string;
    scopes: string[];
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    setErrorBanner(null);
    try {
      const ov = await connectorsApi.getOverview();
      setOverview(ov);
      setScopes(ov.availableScopes);

      if (isAdmin) {
        const keyResp = await connectorsApi.listApiKeys();
        setApiKeys(keyResp.apiKeys);
        if (keyResp.availableScopes.length > 0) {
          setScopes(keyResp.availableScopes);
        }
      }
    } catch (err) {
      setErrorBanner(
        err instanceof ApiError
          ? err.message
          : 'Failed to load Connectors Hub data.',
      );
    } finally {
      setLoading(false);
    }
  }, [canAccess, isAdmin]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const scopesByDomain = useMemo(() => {
    const map = new Map<string, ApiKeyScopeDefinition[]>();
    for (const s of scopes) {
      const list = map.get(s.domain) ?? [];
      list.push(s);
      map.set(s.domain, list);
    }
    return Array.from(map.entries());
  }, [scopes]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim() || selectedScopes.length === 0) return;

    setCreatingKey(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const parsedDays =
        expiresInDays === 'never' ? null : Number(expiresInDays);
      const res = await connectorsApi.createApiKey({
        name: keyName.trim(),
        scopes: selectedScopes,
        expiresInDays:
          parsedDays && Number.isFinite(parsedDays) ? parsedDays : null,
      });

      setCreateModalOpen(false);
      setKeyName('');
      setRevealedKey({
        name: res.apiKey.name,
        plaintextKey: res.plaintextKey,
        scopes: res.apiKey.scopes,
      });
      setCopiedKey(false);
      await loadData();
    } catch (err) {
      setErrorBanner(
        err instanceof ApiError ? err.message : 'Failed to create API key.',
      );
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (key: ApiKeySummary) => {
    setRevokingId(key.id);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      await connectorsApi.revokeApiKey(key.id);
      setSuccessBanner(`Revoked API key "${key.name}" (${key.keyPrefix}...).`);
      await loadData();
    } catch (err) {
      setErrorBanner(
        err instanceof ApiError ? err.message : 'Failed to revoke API key.',
      );
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyPlaintext = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey.plaintextKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
    } catch {
      // Fallback ignored
    }
  };

  if (!canAccess) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-600">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="text-base font-medium text-slate-900">
          Administrator or Accountant Clearance Required
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          The Connectors Hub is restricted to organization{' '}
          <span className="font-mono text-xs text-slate-700">ADMIN</span> and{' '}
          <span className="font-mono text-xs text-slate-700">ACCOUNTANT</span>{' '}
          members.
        </p>
      </div>
    );
  }

  const googleAccount = overview?.connectedApps.find(
    (a) => a.provider === 'GOOGLE_WORKSPACE',
  );
  const activeKeysCount =
    overview?.activeApiKeyCount ??
    apiKeys.filter((k) => !k.revokedAt).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-slate-900">
            Connectors Hub
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Manage tenant-scoped inbound API keys and external Google Workspace integrations (Drive, Sheets &amp; Calendar).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <RefreshCw
              className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')}
            />
            Refresh
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setActiveTab('api-keys');
                setCreateModalOpen(true);
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New API Key
            </Button>
          )}
        </div>
      </div>

      {errorBanner && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {errorBanner}
        </div>
      )}

      {successBanner && (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          {successBanner}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Active Inbound API Keys
          </p>
          <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-slate-900">
            {activeKeysCount}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            SHA-256 hashed Bearer tokens
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Google Workspace
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusTag
              label={
                googleAccount?.status === 'CONNECTED'
                  ? 'Connected'
                  : 'Not Connected'
              }
              tone={
                googleAccount?.status === 'CONNECTED' ? 'emerald' : 'neutral'
              }
            />
          </div>
          <p className="mt-1 text-xs text-slate-500 truncate">
            {googleAccount?.externalAccountEmail ?? 'Drive, Sheets & Calendar'}
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            AES-256-GCM Secret Vault
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            {overview?.encryptionConfigured ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                ENCRYPTION_KEY Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                ENCRYPTION_KEY Pending
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Encrypts OAuth refresh tokens at rest
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Recent Sync Runs
          </p>
          <p className="mt-1 font-mono text-2xl font-medium tabular-nums text-slate-900">
            {overview?.recentSyncLogs.length ?? 0}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Latest 25 connector executions
          </p>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-6" aria-label="Connectors Tabs">
          <button
            type="button"
            onClick={() => setActiveTab('apps')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'apps'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <Plug className="h-4 w-4" />
            <span>External Apps (Google Workspace)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('api-keys')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'api-keys'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <Key className="h-4 w-4" />
            <span>Inbound API Keys</span>
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-600">
              {activeKeysCount}
            </span>
          </button>
        </nav>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: EXTERNAL APPS (GOOGLE WORKSPACE)                           */}
      {/* ================================================================= */}
      {activeTab === 'apps' && (
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Google Workspace Connector
                  </h2>
                  <StatusTag
                    label={
                      googleAccount?.status === 'CONNECTED'
                        ? 'Connected'
                        : 'Stage 16 OAuth Ready'
                    }
                    tone={
                      googleAccount?.status === 'CONNECTED'
                        ? 'emerald'
                        : 'amber'
                    }
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Dedicated OAuth 2.0 offline-access integration (separate from user sign-in) with encrypted refresh token storage in{' '}
                  <span className="font-mono text-slate-700">connector_accounts</span>.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled>
                  Connect Google Workspace (Stage 16)
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-3 md:divide-x md:divide-y-0">
              <div className="p-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <FolderSync className="h-4 w-4 text-forest-800" />
                  <span className="text-xs font-semibold">Google Drive</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Archive structured financial snapshots, tax invoice records, and quarterly BAS summaries into organized year/month Drive folders.
                </p>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <Table2 className="h-4 w-4 text-forest-800" />
                  <span className="text-xs font-semibold">Google Sheets</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Push live Profit &amp; Loss, Trial Balance, Balance Sheet, Aged AR/AP, and General Ledger extracts directly to a linked spreadsheet.
                </p>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <Calendar className="h-4 w-4 text-forest-800" />
                  <span className="text-xs font-semibold">Google Calendar</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  Synchronize open Customer Invoice due dates, Vendor Bill due dates, ATO BAS lodgement deadlines, and recurring run dates.
                </p>
              </div>
            </div>
          </div>

          {/* Recent Sync Activity */}
          <div className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                Connector Sync Activity
              </h3>
            </div>
            {overview && overview.recentSyncLogs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Timestamp</th>
                      <th className="px-4 py-2.5 font-medium">Service</th>
                      <th className="px-4 py-2.5 font-medium">Action</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {overview.recentSyncLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-mono text-slate-600">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-800">
                          {log.service}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {log.action}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusTag
                            label={log.status}
                            tone={
                              log.status === 'SUCCESS' ? 'emerald' : 'danger'
                            }
                          />
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {log.summary}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">
                No external sync executions recorded yet. Connect Google Workspace in Stage 16 to trigger Drive, Sheets, and Calendar syncs.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: INBOUND API KEYS                                           */}
      {/* ================================================================= */}
      {activeTab === 'api-keys' && (
        <div className="space-y-4">
          {!isAdmin ? (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-600">
              Creating and revoking tenant Bearer API keys requires{' '}
              <span className="font-mono font-semibold text-slate-800">ADMIN</span>{' '}
              clearance.
            </div>
          ) : (
            <div className="rounded-md border border-slate-200 bg-white">
              <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Scoped Bearer API Keys
                  </h2>
                  <p className="text-xs text-slate-500">
                    Authenticate machine clients with{' '}
                    <span className="font-mono text-slate-700">
                      Authorization: Bearer dws_live_...
                    </span>
                    . Keys are strictly tenant-isolated and never granted ADMIN governance access.
                  </p>
                </div>
                <Button size="sm" onClick={() => setCreateModalOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create API Key
                </Button>
              </div>

              {apiKeys.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No API keys have been issued for this organization yet. Click{' '}
                  <span className="font-medium text-slate-800">Create API Key</span>{' '}
                  to generate a scoped Bearer token.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Name &amp; Prefix</th>
                        <th className="px-4 py-2.5 font-medium">Scopes</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Last Used</th>
                        <th className="px-4 py-2.5 font-medium">Expires</th>
                        <th className="px-4 py-2.5 text-right font-medium">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {apiKeys.map((k) => {
                        const isExpired =
                          k.expiresAt !== null &&
                          new Date(k.expiresAt) <= new Date();
                        const statusLabel = k.revokedAt
                          ? 'Revoked'
                          : isExpired
                            ? 'Expired'
                            : 'Active';
                        const statusTone = k.revokedAt
                          ? 'danger'
                          : isExpired
                            ? 'amber'
                            : 'emerald';

                        return (
                          <tr key={k.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900">
                                {k.name}
                              </p>
                              <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                                {k.keyPrefix}••••••••
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1 max-w-md">
                                {k.scopes.map((sc) => (
                                  <span
                                    key={sc}
                                    className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
                                  >
                                    {sc}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <StatusTag label={statusLabel} tone={statusTone} />
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-600">
                              {formatDateTime(k.lastUsedAt)}
                            </td>
                            <td className="px-4 py-3 font-mono text-slate-600">
                              {k.expiresAt
                                ? formatDateTime(k.expiresAt)
                                : 'Never'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {!k.revokedAt && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  loading={revokingId === k.id}
                                  onClick={() => void handleRevokeKey(k)}
                                  className="text-red-700 border-red-200 hover:bg-red-50"
                                >
                                  <Trash2 className="mr-1 h-3 w-3" />
                                  Revoke
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* CREATE API KEY MODAL                                              */}
      {/* ================================================================= */}
      <Modal
        open={createModalOpen}
        onClose={() => !creatingKey && setCreateModalOpen(false)}
        title="Create Scoped API Key"
        size="3xl"
      >
        <form onSubmit={(e) => void handleCreateKey(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Key Label
              </label>
              <Input
                required
                placeholder="e.g. Finance BI Reporting Sync"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Expiration
              </label>
              <select
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-forest-700 focus:outline-none focus:ring-1 focus:ring-forest-700"
              >
                <option value="30">30 days</option>
                <option value="90">90 days (Recommended)</option>
                <option value="365">1 year</option>
                <option value="never">Never expires</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">
                Module Permission Scopes ({selectedScopes.length} selected)
              </label>
              <button
                type="button"
                onClick={() => setSelectedScopes([])}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                Clear all
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100">
              {scopesByDomain.map(([domain, domainScopes]) => (
                <div key={domain} className="p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    {domain}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {domainScopes.map((sc) => {
                      const checked = selectedScopes.includes(sc.scope);
                      return (
                        <label
                          key={sc.scope}
                          className={cn(
                            'flex items-start gap-2.5 rounded border p-2 cursor-pointer transition-colors',
                            checked
                              ? 'border-forest-300 bg-forest-50/40'
                              : 'border-slate-200 bg-white hover:bg-slate-50',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleScope(sc.scope)}
                            className="mt-0.5 rounded border-slate-300 text-forest-900 focus:ring-forest-600"
                          />
                          <div className="min-w-0">
                            <p className="font-mono text-[11px] font-medium text-slate-900">
                              {sc.scope}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {sc.description}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateModalOpen(false)}
              disabled={creatingKey}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={creatingKey}
              disabled={!keyName.trim() || selectedScopes.length === 0}
            >
              Generate API Key
            </Button>
          </div>
        </form>
      </Modal>

      {/* ================================================================= */}
      {/* ONE-TIME PLAINTEXT KEY REVEAL MODAL                               */}
      {/* ================================================================= */}
      <Modal
        open={Boolean(revealedKey)}
        onClose={() => setRevealedKey(null)}
        title="Copy Your New API Key"
        size="xl"
      >
        {revealedKey && (
          <div className="space-y-4">
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Shown Once Only:</strong> For security, only the SHA-256 hash of this key is stored. Copy and store it in your secret manager now — you will not be able to view it again.
            </div>

            <div>
              <p className="text-xs font-medium text-slate-700 mb-1">
                Bearer Token ({revealedKey.name})
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded border border-slate-200 bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300">
                  {revealedKey.plaintextKey}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyPlaintext()}
                >
                  {copiedKey ? (
                    <>
                      <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-700 mb-1">
                Example Request
              </p>
              <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700">
{`curl -H "Authorization: Bearer ${revealedKey.plaintextKey}" \\
  "${window.location.origin}/api/v1/reports/trial-balance"`}
              </pre>
            </div>

            <div className="flex justify-end border-t border-slate-200 pt-3">
              <Button size="sm" onClick={() => setRevealedKey(null)}>
                Done — I Have Saved This Key
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
