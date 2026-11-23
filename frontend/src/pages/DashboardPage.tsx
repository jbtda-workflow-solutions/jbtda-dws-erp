import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { dashboardApi, type DashboardSummary, ApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { BookkeeperHome } from '@/features/dashboard/BookkeeperHome';
import { EmployeeHome } from '@/features/dashboard/EmployeeHome';
import { SpecialistHome } from '@/features/dashboard/SpecialistHome';
import { ExecutiveHome } from '@/features/dashboard/ExecutiveHome';

export function DashboardPage() {
  const { role } = useAuth();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Allow ADMIN users to toggle between Executive and Bookkeeping workbenches
  const [adminView, setAdminView] = useState<'EXECUTIVE' | 'BOOKKEEPER'>('EXECUTIVE');

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await dashboardApi.getSummary();
      setData(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load dashboard metrics');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard();
  }, []);

  if (loading && !data) {
    return (
      <div className="py-12 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 rounded-full border-2 border-forest-900 border-t-transparent animate-spin mb-4" />
        <p className="text-sm font-light text-slate-500">Loading workspace…</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="py-12">
        <div className="rounded-md border border-rose-200 bg-rose-50/50 p-6 text-center">
          <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
          <h2 className="text-base font-medium text-rose-900">Failed to Load Workspace</h2>
          <p className="text-sm text-rose-600 mt-1 mb-4">{error}</p>
          <Button variant="outline" onClick={fetchDashboard}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (role === 'EMPLOYEE') {
    return <EmployeeHome data={data} loading={loading} onRefresh={fetchDashboard} />;
  }

  if (role === 'ACCOUNTANT') {
    return <BookkeeperHome data={data} loading={loading} onRefresh={fetchDashboard} />;
  }

  if (role === 'AR_SPECIALIST') {
    return <SpecialistHome mode="AR" data={data} loading={loading} onRefresh={fetchDashboard} />;
  }

  if (role === 'AP_SPECIALIST') {
    return <SpecialistHome mode="AP" data={data} loading={loading} onRefresh={fetchDashboard} />;
  }

  if (role === 'ADMIN') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end">
          <div className="inline-flex rounded border border-slate-200 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setAdminView('EXECUTIVE')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                adminView === 'EXECUTIVE'
                  ? 'bg-forest-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Executive View
            </button>
            <button
              type="button"
              onClick={() => setAdminView('BOOKKEEPER')}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                adminView === 'BOOKKEEPER'
                  ? 'bg-forest-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bookkeeping View
            </button>
          </div>
        </div>
        {adminView === 'BOOKKEEPER' ? (
          <BookkeeperHome data={data} loading={loading} onRefresh={fetchDashboard} />
        ) : (
          <ExecutiveHome data={data} loading={loading} onRefresh={fetchDashboard} />
        )}
      </div>
    );
  }

  return <ExecutiveHome data={data} loading={loading} onRefresh={fetchDashboard} />;
}
