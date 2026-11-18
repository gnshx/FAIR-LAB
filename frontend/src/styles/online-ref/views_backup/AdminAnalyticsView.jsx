import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function AdminAnalyticsView() {
  const { currentUser, profile } = useAuth();
  const { subscribe } = useSocket();
  const isAdmin = profile?.user?.role === 'admin';

  const [policy, setPolicy] = useState({
    base_score: 100,
    min_priority_floor: 10,
    deduction_per_booking: 10,
    deduction_per_hour: 5,
    high_demand_deduction_per_hour: 10,
    high_demand_threshold: 1.5,
    no_show_penalty: 25,
    cancellation_window_hours: 2,
    grace_period_minutes: 15,
    lab_open_time: '09:00',
    lab_close_time: '18:00',
    slot_interval_minutes: 60,
    max_daily_hours: 2,
    max_daily_bookings: 2
  });

  const [report, setReport] = useState(null);
  const [health, setHealth] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [workstations, setWorkstations] = useState([]);
  const [blockFilter, setBlockFilter] = useState('A');
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');

  const [showResetModal, setShowResetModal] = useState(false);
  const [newSemesterName, setNewSemesterName] = useState('Spring 2027 Semester');
  const [resetting, setResetting] = useState(false);
  const [banner, setBanner] = useState(null);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [sweepingNoShows, setSweepingNoShows] = useState(false);

  const fetchAdminData = useCallback(async () => {
    try {
      const [resPolicy, resReport, resHealth, resCompare, resRigs, resAudit] = await Promise.all([
        fetch('/api/admin/policy'),
        fetch('/api/admin/analytics'),
        fetch('/api/admin/workstation-health'),
        fetch('/api/fairness/compare-policies?iterations=150'),
        fetch('/api/labs/L106/workstations'),
        fetch('/api/admin/audit-logs')
      ]);

      if (resPolicy.ok) {
        const p = await resPolicy.json();
        if (p) setPolicy(prev => ({ ...prev, ...p }));
      }
      if (resReport.ok) setReport(await resReport.json());
      if (resHealth.ok) setHealth(await resHealth.json());
      if (resCompare.ok) setComparison(await resCompare.json());
      if (resRigs.ok) setWorkstations(await resRigs.json());
      if (resAudit.ok) setAuditLogs(await resAudit.json());
    } catch (e) {
      console.error('Failed to load admin data', e);
    }
  }, []);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  useEffect(() => {
    const unsubs = [
      subscribe('SCORE_CHANGED', fetchAdminData),
      subscribe('fairness.score_updated', fetchAdminData),
      subscribe('workstation.status_changed', fetchAdminData),
      subscribe('SLOT_UPDATED', fetchAdminData)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchAdminData]);

  const handleSavePolicy = async (e) => {
    e.preventDefault();
    setSavingPolicy(true);
    setBanner(null);
    try {
      const payload = {
        base_score: Number(policy.base_score),
        min_priority_floor: Number(policy.min_priority_floor),
        deduction_per_booking: Number(policy.deduction_per_booking || 10),
        deduction_per_hour: Number(policy.deduction_per_hour),
        high_demand_deduction_per_hour: Number(policy.high_demand_deduction_per_hour),
        high_demand_threshold: Number(policy.high_demand_threshold),
        no_show_penalty: Number(policy.no_show_penalty),
        cancellation_window_hours: Number(policy.cancellation_window_hours),
        grace_period_minutes: Number(policy.grace_period_minutes),
        lab_open_time: policy.lab_open_time,
        lab_close_time: policy.lab_close_time,
        slot_interval_minutes: Number(policy.slot_interval_minutes),
        max_daily_hours: Number(policy.max_daily_hours),
        max_daily_bookings: Number(policy.max_daily_bookings)
      };

      const res = await fetch('/api/admin/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({
          type: 'success',
          text: data.slotsSynced
            ? `Schedule & fairness policy saved. Active daily intervals regenerated (${payload.lab_open_time}–${payload.lab_close_time}, ${payload.slot_interval_minutes}m slots).`
            : 'Fairness policy updated and recorded in audit trail.'
        });
        await fetchAdminData();
      } else {
        setBanner({ type: 'error', text: data.error || 'Could not update policy.' });
      }
    } catch (e) {
      setBanner({ type: 'error', text: e.message });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleToggleMaintenance = async (machineId, currentStatus) => {
    const isMaint = currentStatus !== 'MAINTENANCE';
    try {
      const res = await fetch('/api/admin/workstation/toggle-maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify({ machineId, isMaintenance: isMaint })
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({
          type: 'success',
          text: isMaint
            ? `${machineId} marked offline for maintenance.${data.reallocatedCount > 0 ? ` Automatically reallocated ${data.reallocatedCount} active booking(s).` : ''}`
            : `${machineId} restored to online booking pool.`
        });
        await fetchAdminData();
      } else {
        setBanner({ type: 'error', text: data.error || 'Could not toggle maintenance status.' });
      }
    } catch (e) {
      setBanner({ type: 'error', text: e.message });
    }
  };

  const handleSweepNoShows = async () => {
    setSweepingNoShows(true);
    setBanner(null);
    try {
      const res = await fetch('/api/admin/process-no-shows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify({ force: false })
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({
          type: 'success',
          text: `No-show sweep complete: ${data.noShowCount} expired reservation(s) released, ${data.promotedCount} waitlisted student(s) promoted.`
        });
        await fetchAdminData();
      } else {
        setBanner({ type: 'error', text: data.error || 'No-show sweep failed.' });
      }
    } catch (e) {
      setBanner({ type: 'error', text: e.message });
    } finally {
      setSweepingNoShows(false);
    }
  };

  const handleRunSim = async () => {
    setSimRunning(true);
    try {
      const res = await fetch('/api/fairness/compare-policies?iterations=300');
      if (res.ok) setComparison(await res.json());
    } finally {
      setSimRunning(false);
    }
  };

  const handleExecuteReset = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/admin/semester/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify({ semesterName: newSemesterName })
      });
      const data = await res.json();
      if (res.ok) {
        setShowResetModal(false);
        setBanner({
          type: 'success',
          text: `Semester rolled to "${data.semesterName}". Reset scores and hour counters for ${data.resetStudentsCount} students.`
        });
        await fetchAdminData();
      } else {
        setBanner({ type: 'error', text: data.error || 'Semester reset failed.' });
      }
    } finally {
      setResetting(false);
    }
  };

  const uniqueAuditActions = useMemo(() => {
    const set = new Set(auditLogs.map(l => l.action).filter(Boolean));
    return ['ALL', ...Array.from(set)];
  }, [auditLogs]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (auditActionFilter !== 'ALL' && log.action !== auditActionFilter) return false;
      if (auditSearch.trim()) {
        const q = auditSearch.trim().toLowerCase();
        const hay = `${log.actor_name || ''} ${log.action || ''} ${log.details || ''}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [auditLogs, auditActionFilter, auditSearch]);

  const handleExportAuditCsv = () => {
    const header = ['Time', 'Actor', 'Action', 'Details'];
    const rows = filteredAuditLogs.map(l => [
      new Date(l.created_at).toISOString(),
      l.actor_name || '',
      l.action || '',
      (l.details || '').replace(/"/g, '""')
    ]);
    const csv = [header.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fairlab-audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredRigs = workstations.filter(w => (w.block_code || 'A') === blockFilter);

  const inputCls =
    'w-full h-10 px-3 rounded-lg bg-white border border-[#D0D5DD] text-xs font-mono text-[#1D2939] outline-none focus:border-[#5B4CF5] focus:ring-2 focus:ring-[#5B4CF5]/15 tabular-nums';

  return (
    <div className="flex flex-col w-full gap-6 text-[#1D2939]">
      {/* Page Header */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-display font-bold tracking-tight text-[#1D2939]">
              Admin &amp; Fairness Policy
            </h1>
            <span className="text-xs font-mono font-medium px-2.5 py-0.5 rounded-full bg-[#F0EEFF] text-[#4F22F2] border border-[#E4DDFF]">
              Lab L-106 Governance
            </span>
          </div>
          <p className="text-sm text-[#667085] mt-1">
            Configure operating hours, booking intervals, daily quotas, duration-based fairness weights, and workstation availability.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSweepNoShows}
            disabled={sweepingNoShows}
            className="h-10 px-4 rounded-xl bg-white hover:bg-[#F7F8FC] border border-[#D0D5DD] text-xs font-semibold text-[#344054] flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <span className="material-symbols-outlined text-[17px] text-[#667085]">person_off</span>
            <span>{sweepingNoShows ? 'Checking...' : 'Run No-Show Sweep'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowResetModal(true)}
            className="h-10 px-4 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#DC2626] border border-[#FECACA] text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[17px]">restart_alt</span>
            <span>Semester Reset</span>
          </button>
        </div>
      </section>

      {!isAdmin && (
        <div className="px-4 py-3.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E] flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[19px] text-[#D97706] shrink-0">lock</span>
          <span>
            Viewing in read-only mode as <strong>{profile?.user?.role || 'student'}</strong>. Backend RBAC blocks admin writes (HTTP 403) — switch persona to{' '}
            <strong>Dr. A. K. Sharma (Admin)</strong> in the top-right account menu to modify policy or maintenance states.
          </span>
        </div>
      )}

      {banner && (
        <div
          className={`px-4 py-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            banner.type === 'success'
              ? 'bg-[#ECFDF3] border-[#A6F4C5] text-[#15803D]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              {banner.type === 'success' ? 'check_circle' : 'error'}
            </span>
            <span>{banner.text}</span>
          </div>
          <button type="button" onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Row 1: Schedule & Fairness Policy Form + Lab Operational Health */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSavePolicy}
          className="xl:col-span-8 bg-white rounded-2xl border border-[#EAECF0] shadow-card p-6 space-y-5"
        >
          <div className="flex items-center justify-between pb-4 border-b border-[#EAECF0]">
            <div>
              <h2 className="text-sm font-bold text-[#1D2939]">Configurable Schedule &amp; Fairness Parameters</h2>
              <p className="text-xs text-[#667085] mt-0.5">
                Updates to lab hours or slot duration automatically regenerate active daily intervals.
              </p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-[#F0EEFF] text-[#5B4CF5] flex items-center justify-center">
              <span className="material-symbols-outlined text-[19px]">tune</span>
            </div>
          </div>

          {/* Schedule Config Group */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] mb-3">
              Lab Operating Hours &amp; Daily Quotas
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Lab Open Time</label>
                <input
                  type="time"
                  value={policy.lab_open_time || '09:00'}
                  onChange={(e) => setPolicy({ ...policy, lab_open_time: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Lab Close Time</label>
                <input
                  type="time"
                  value={policy.lab_close_time || '18:00'}
                  onChange={(e) => setPolicy({ ...policy, lab_close_time: e.target.value })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Slot Interval</label>
                <select
                  value={policy.slot_interval_minutes || 60}
                  onChange={(e) => setPolicy({ ...policy, slot_interval_minutes: Number(e.target.value) })}
                  className={inputCls}
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes (1 hour)</option>
                  <option value={90}>90 minutes</option>
                  <option value={120}>120 minutes (2 hours)</option>
                </select>
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Max Daily Hours / Student</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="12"
                  value={policy.max_daily_hours}
                  onChange={(e) => setPolicy({ ...policy, max_daily_hours: parseFloat(e.target.value) || 2 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Max Daily Bookings</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={policy.max_daily_bookings}
                  onChange={(e) => setPolicy({ ...policy, max_daily_bookings: parseInt(e.target.value, 10) || 2 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">No-Show Grace (Mins)</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={policy.grace_period_minutes}
                  onChange={(e) => setPolicy({ ...policy, grace_period_minutes: parseInt(e.target.value, 10) || 15 })}
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Fairness Formula Group */}
          <div className="pt-4 border-t border-[#EAECF0]">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] mb-3">
              Duration &amp; High-Demand Fairness Weights
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Base Score (P_base)</label>
                <input
                  type="number"
                  value={policy.base_score}
                  onChange={(e) => setPolicy({ ...policy, base_score: parseInt(e.target.value, 10) || 100 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Normal Deduction (pts/hr)</label>
                <input
                  type="number"
                  step="0.5"
                  value={policy.deduction_per_hour}
                  onChange={(e) => setPolicy({ ...policy, deduction_per_hour: parseFloat(e.target.value) || 5 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Peak Surcharge (pts/hr)</label>
                <input
                  type="number"
                  step="0.5"
                  value={policy.high_demand_deduction_per_hour}
                  onChange={(e) => setPolicy({ ...policy, high_demand_deduction_per_hour: parseFloat(e.target.value) || 10 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">High-Demand Ratio Threshold</label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="10.0"
                  value={policy.high_demand_threshold}
                  onChange={(e) => setPolicy({ ...policy, high_demand_threshold: parseFloat(e.target.value) || 1.5 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">Priority Floor (P_min)</label>
                <input
                  type="number"
                  value={policy.min_priority_floor}
                  onChange={(e) => setPolicy({ ...policy, min_priority_floor: parseInt(e.target.value, 10) || 10 })}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[#475467] font-medium block mb-1.5">No-Show Penalty (pts)</label>
                <input
                  type="number"
                  value={policy.no_show_penalty}
                  onChange={(e) => setPolicy({ ...policy, no_show_penalty: parseInt(e.target.value, 10) || 25 })}
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-[#EAECF0] flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-mono text-[#475467] bg-[#F7F8FC] px-3 py-1.5 rounded-lg border border-[#EAECF0]">
              P<sub>u</sub> = max({policy.min_priority_floor}, {policy.base_score} − {policy.deduction_per_hour}T<sub>u</sub> − {policy.high_demand_deduction_per_hour}T<sub>H</sub>)
            </span>
            <button
              type="submit"
              disabled={savingPolicy}
              className="h-10 px-5 rounded-xl bg-[#5B4CF5] hover:bg-[#4F22F2] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-colors"
            >
              {savingPolicy ? 'Saving...' : 'Save Schedule & Policy'}
            </button>
          </div>
        </form>

        {/* Operational Health Overview */}
        <section className="xl:col-span-4 bg-white rounded-2xl border border-[#EAECF0] shadow-card p-6 space-y-4">
          <div className="flex items-center justify-between pb-3.5 border-b border-[#EAECF0]">
            <div>
              <h2 className="text-sm font-bold text-[#1D2939]">Lab L-106 Operational Health</h2>
              <p className="text-xs text-[#667085] mt-0.5">84 workstations across 2 blocks</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-[#ECFDF3] text-[#15803D] flex items-center justify-center">
              <span className="material-symbols-outlined text-[19px]">monitoring</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
            <div className="p-3.5 rounded-xl bg-[#ECFDF3]/60 border border-[#A6F4C5]">
              <span className="text-[10px] font-semibold uppercase text-[#15803D] block">Online Systems</span>
              <div className="mt-1">
                <strong className="text-2xl font-display font-bold text-[#15803D]">{health?.summary?.onlineCount ?? 82}</strong>
                <span className="text-[#667085] font-mono"> / {health?.summary?.totalWorkstations ?? 84}</span>
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F7F8FC] border border-[#EAECF0]">
              <span className="text-[10px] font-semibold uppercase text-[#667085] block">Maintenance</span>
              <div className="mt-1">
                <strong className="text-2xl font-display font-bold text-[#1D2939]">{health?.summary?.maintenanceCount ?? 2}</strong>
                <span className="text-[#667085] font-mono"> offline</span>
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#F0EEFF]/60 border border-[#E4DDFF]">
              <span className="text-[10px] font-semibold uppercase text-[#4F22F2] block">Live Jain Index</span>
              <strong className="text-2xl font-display font-bold text-[#4F22F2] block mt-1">
                {report?.liveMetrics?.jainsFairnessIndex ?? '1.00'}
              </strong>
            </div>
            <div className="p-3.5 rounded-xl bg-[#FFFBEB]/70 border border-[#FDE68A]">
              <span className="text-[10px] font-semibold uppercase text-[#B45309] block">Queued Waitlist</span>
              <strong className="text-2xl font-display font-bold text-[#B45309] block mt-1">
                {report?.waitlistCount ?? 0}
              </strong>
            </div>
          </div>

          {health?.occupancyDistribution && (
            <div className="p-4 rounded-xl bg-[#F7F8FC] border border-[#EAECF0] text-xs space-y-2 tabular-nums">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] mb-1">
                Daily Occupancy Breakdown
              </div>
              <div className="flex justify-between">
                <span className="text-[#15803D] font-medium">Low (0–49%)</span>
                <span className="font-mono font-semibold text-[#1D2939]">{health.occupancyDistribution.LOW} seats</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#B45309] font-medium">Medium (50–70%)</span>
                <span className="font-mono font-semibold text-[#1D2939]">{health.occupancyDistribution.MEDIUM} seats</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#C2410C] font-medium">High (71–99%)</span>
                <span className="font-mono font-semibold text-[#1D2939]">{health.occupancyDistribution.HIGH} seats</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#DC2626] font-medium">Full (100%)</span>
                <span className="font-mono font-semibold text-[#1D2939]">{health.occupancyDistribution.FULL} seats</span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Row 2: 3-Policy Research Comparison Table */}
      <section className="bg-white rounded-2xl border border-[#EAECF0] shadow-card overflow-hidden">
        <div className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#EAECF0]">
          <div>
            <h2 className="text-sm font-bold text-[#1D2939]">
              3-Policy Research Comparison (FIFO vs Basic FairLab vs FairLab v2)
            </h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Identical mixed-demand &amp; bot-skew workload trace (Mulberry32 deterministic seed 1337 · 60 students · 10 workstations).
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunSim}
            disabled={simRunning}
            className="h-9 px-4 rounded-xl bg-white hover:bg-[#F7F8FC] border border-[#D0D5DD] text-xs font-semibold text-[#344054] flex items-center gap-1.5 transition-colors self-start sm:self-auto"
          >
            <span className="material-symbols-outlined text-[16px] text-[#5B4CF5]">play_arrow</span>
            <span>{simRunning ? 'Running 300 Rounds...' : 'Run 300-Round Benchmark'}</span>
          </button>
        </div>

        {comparison?.policies && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead className="bg-[#F8FAFC] border-b border-[#EAECF0] text-[#667085] uppercase font-sans font-semibold text-[11px] tracking-wider">
                <tr>
                  <th className="py-3 px-5">Policy</th>
                  <th className="py-3 px-4">Overall Gini</th>
                  <th className="py-3 px-4">Peak-Slot Gini</th>
                  <th className="py-3 px-4">Jain Index</th>
                  <th className="py-3 px-4">Max Wait</th>
                  <th className="py-3 px-4">Zero-Alloc %</th>
                  <th className="py-3 px-5 text-right">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EAECF0]">
                {comparison.policies.map((p, idx) => (
                  <tr key={p.policy} className={idx === 2 ? 'bg-[#F0EEFF]/50' : 'hover:bg-[#F9FAFB]'}>
                    <td className="py-3.5 px-5 font-sans">
                      <div className={`font-bold ${idx === 2 ? 'text-[#4F22F2]' : 'text-[#1D2939]'}`}>{p.policy}</div>
                      <div className="text-[11px] text-[#667085] mt-0.5">{p.rule}</div>
                    </td>
                    <td className="py-3.5 px-4 text-[#344054]">{p.giniCoefficient}</td>
                    <td className="py-3.5 px-4 text-[#344054]">{p.highDemandGini}</td>
                    <td className="py-3.5 px-4 font-bold text-[#15803D]">{p.jainsFairnessIndex}</td>
                    <td className="py-3.5 px-4 text-[#344054]">{p.maxWaitingCycles} cycles</td>
                    <td className="py-3.5 px-4 text-[#344054]">{p.zeroAllocationPct}%</td>
                    <td className="py-3.5 px-5 text-right font-semibold text-[#1D2939]">{p.utilizationPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Row 3: 84-Workstation Maintenance Matrix */}
      <section className="bg-white rounded-2xl border border-[#EAECF0] shadow-card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-5 border-b border-[#EAECF0]">
          <div>
            <h2 className="text-sm font-bold text-[#1D2939]">Workstation Maintenance &amp; Offline Reallocation</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Marking a booked workstation offline automatically reallocates active bookings to another free seat in the same block.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F7F8FC] border border-[#EAECF0] text-xs font-medium self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setBlockFilter('A')}
              className={`px-3.5 py-1.5 rounded-lg transition-colors ${
                blockFilter === 'A' ? 'bg-white text-[#5B4CF5] font-semibold shadow-sm' : 'text-[#667085] hover:text-[#1D2939]'
              }`}
            >
              Block A (60)
            </button>
            <button
              type="button"
              onClick={() => setBlockFilter('B')}
              className={`px-3.5 py-1.5 rounded-lg transition-colors ${
                blockFilter === 'B' ? 'bg-white text-[#5B4CF5] font-semibold shadow-sm' : 'text-[#667085] hover:text-[#1D2939]'
              }`}
            >
              Block B (24)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-10 gap-2.5">
          {filteredRigs.map(rig => {
            const isMaint = rig.status === 'MAINTENANCE';
            return (
              <div
                key={rig.machine_id}
                className={`p-2.5 rounded-xl border flex flex-col justify-between gap-2 text-xs font-mono transition-colors ${
                  isMaint
                    ? 'bg-white border-[#E5E7EB] text-[#6B7280]'
                    : 'bg-[#ECFDF3] border-[#86EFAC] text-[#15803D]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px]">{rig.display_label || rig.machine_id}</span>
                  <span className={`w-2 h-2 rounded-full ${isMaint ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`} />
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleMaintenance(rig.machine_id, rig.status)}
                  className={`w-full py-1 rounded-lg text-[10px] font-sans font-semibold border transition-colors ${
                    isMaint
                      ? 'bg-[#ECFDF3] text-[#15803D] border-[#86EFAC] hover:bg-[#DCFCE7]'
                      : 'bg-white text-[#475467] border-[#D0D5DD] hover:text-[#DC2626] hover:border-[#FCA5A5]'
                  }`}
                >
                  {isMaint ? 'Restore' : 'Set Offline'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Row 4: Immutable Audit Trail with Filter Bar + CSV Export (design/adminpage to sww the booking uiux.png) */}
      <section className="bg-white rounded-2xl border border-[#EAECF0] shadow-card overflow-hidden">
        <div className="px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[#EAECF0]">
          <div>
            <h2 className="text-sm font-bold text-[#1D2939]">Immutable Audit Trail</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Policy updates, offline reallocations, no-show recoveries, and semester resets ({filteredAuditLogs.length} of {auditLogs.length}).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <span className="material-symbols-outlined text-[16px] text-[#98A2B3] absolute left-2.5 top-1/2 -translate-y-1/2">
                search
              </span>
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Filter actor or details..."
                className="h-9 pl-8 pr-3 rounded-lg bg-white border border-[#D0D5DD] text-xs text-[#1D2939] outline-none focus:border-[#5B4CF5] w-48"
              />
            </div>

            <select
              value={auditActionFilter}
              onChange={(e) => setAuditActionFilter(e.target.value)}
              className="h-9 px-3 rounded-lg bg-white border border-[#D0D5DD] text-xs font-mono text-[#1D2939] outline-none focus:border-[#5B4CF5]"
            >
              {uniqueAuditActions.map(act => (
                <option key={act} value={act}>
                  {act === 'ALL' ? 'All Actions' : act}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleExportAuditCsv}
              className="h-9 px-3.5 rounded-lg bg-[#F7F8FC] hover:bg-[#F0EEFF] border border-[#D0D5DD] text-xs font-semibold text-[#344054] hover:text-[#4F22F2] flex items-center gap-1.5 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F8FAFC] border-b border-[#EAECF0] text-[#667085] uppercase font-semibold text-[11px] tracking-wider sticky top-0">
              <tr>
                <th className="py-3 px-5">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAECF0]">
              {filteredAuditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[#667085]">
                    No audit entries match the current filter.
                  </td>
                </tr>
              ) : (
                filteredAuditLogs.map(log => (
                  <tr key={log.log_id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-3 px-5 text-[#667085] font-mono whitespace-nowrap tabular-nums">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-semibold text-[#1D2939] whitespace-nowrap">{log.actor_name}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#15803D] border border-[#A6F4C5] font-mono text-[10px] font-semibold">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-5 text-[#475467]">{log.details}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row 5: Planned Future Development (Strictly Documented Roadmap, Not Active Telemetry) */}
      <section className="p-5 rounded-2xl bg-white border border-dashed border-[#D0D5DD] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-[#344054]">
              Future Development Roadmap · Hardware Telemetry Agents
            </h2>
            <span className="text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#F7F8FC] text-[#667085] border border-[#EAECF0]">
              Planned · Not Active on Site
            </span>
          </div>
          <p className="text-xs text-[#667085] mt-1.5 leading-relaxed">
            FairLab&apos;s active core focuses exclusively on 84-seat interval booking, fairness-aware allocation, and signed QR gate verification. Automated workstation hardware telemetry agents (<code className="font-mono text-[#344054] bg-[#F7F8FC] px-1 py-0.5 rounded">agents/</code>) are documented strictly as future work pending physical L-106 network onboarding.
          </p>
        </div>
      </section>

      {/* Semester Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-[#0F172A]/45 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#EAECF0] shadow-card-hover p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FEF2F2] text-[#DC2626] flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">restart_alt</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1D2939]">Confirm Semester Reset</h3>
                <p className="text-xs text-[#667085]">Archives active term and restores full priority scores</p>
              </div>
            </div>
            <p className="text-xs text-[#475467] leading-relaxed">
              This archives the active semester and resets all students to <strong>{policy.base_score} points</strong> and 0 used hours. Historical bookings and audit logs remain preserved.
            </p>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] block mb-1.5">
                New Semester Name
              </label>
              <input
                type="text"
                value={newSemesterName}
                onChange={(e) => setNewSemesterName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="h-9 px-4 rounded-xl bg-white hover:bg-[#F7F8FC] border border-[#D0D5DD] text-[#344054] font-semibold text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReset}
                disabled={resetting}
                className="h-9 px-4 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white font-semibold text-xs shadow-sm"
              >
                {resetting ? 'Resetting...' : 'Execute Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
