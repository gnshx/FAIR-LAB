import React, { useState, useEffect, useCallback } from 'react';
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

  const filteredRigs = workstations.filter(w => (w.block_code || 'A') === blockFilter);

  return (
    <div className="flex flex-col w-full gap-6 text-zinc-100">
      {/* Admin Header */}
      <section className="p-5 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-zinc-100 tracking-tight">
              Lab Schedule, Fairness Policy & Governance
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
              Admin Controls
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Configure L-106 operating hours, booking intervals, daily quotas, duration-based fairness deductions, and workstation availability.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSweepNoShows}
            disabled={sweepingNoShows}
            className="h-9 px-3.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px] text-zinc-400">person_off</span>
            <span>{sweepingNoShows ? 'Checking...' : 'Run No-Show Sweep'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowResetModal(true)}
            className="h-9 px-3.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-medium flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            <span>Semester Reset</span>
          </button>
        </div>
      </section>

      {!isAdmin && (
        <div className="p-3.5 rounded-xl bg-zinc-900 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[18px] text-amber-400">lock</span>
          <span>
            Viewing in read-only mode as <strong>{profile?.user?.role || 'student'}</strong>. Backend RBAC blocks admin changes (HTTP 403) — switch persona to <strong>Dr. A. K. Sharma (Admin)</strong> in the top-right menu to edit policy or maintenance states.
          </span>
        </div>
      )}

      {banner && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs ${
            banner.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-200'
          }`}
        >
          <span>{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-zinc-400 hover:text-zinc-200">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Row 1: Schedule & Fairness Policy Form + Live Operational Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleSavePolicy}
          className="xl:col-span-8 p-6 rounded-xl bg-zinc-900 border border-zinc-800 space-y-5"
        >
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Configurable Schedule & Fairness Parameters</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Changes to lab hours or slot intervals immediately regenerate active daily intervals.
              </p>
            </div>
            <span className="material-symbols-outlined text-zinc-400 text-[20px]">tune</span>
          </div>

          {/* Schedule Config Group */}
          <div>
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-3">
              Lab Operating Hours & Daily Quotas
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs font-mono">
              <div>
                <label className="text-zinc-400 block mb-1">Lab Open Time</label>
                <input
                  type="time"
                  value={policy.lab_open_time || '09:00'}
                  onChange={(e) => setPolicy({ ...policy, lab_open_time: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Lab Close Time</label>
                <input
                  type="time"
                  value={policy.lab_close_time || '18:00'}
                  onChange={(e) => setPolicy({ ...policy, lab_close_time: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Slot Interval (Minutes)</label>
                <select
                  value={policy.slot_interval_minutes || 60}
                  onChange={(e) => setPolicy({ ...policy, slot_interval_minutes: Number(e.target.value) })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500"
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes (1 hour)</option>
                  <option value={90}>90 minutes</option>
                  <option value={120}>120 minutes (2 hours)</option>
                </select>
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Max Daily Hours / Student</label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="12"
                  value={policy.max_daily_hours}
                  onChange={(e) => setPolicy({ ...policy, max_daily_hours: parseFloat(e.target.value) || 2 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Max Daily Bookings</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={policy.max_daily_bookings}
                  onChange={(e) => setPolicy({ ...policy, max_daily_bookings: parseInt(e.target.value, 10) || 2 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">No-Show Grace (Mins)</label>
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={policy.grace_period_minutes}
                  onChange={(e) => setPolicy({ ...policy, grace_period_minutes: parseInt(e.target.value, 10) || 15 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Fairness Formula Group */}
          <div className="pt-4 border-t border-zinc-800">
            <h3 className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mb-3">
              Duration & High-Demand Fairness Scoring Weights
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 text-xs font-mono">
              <div>
                <label className="text-zinc-400 block mb-1">Base Score (P_base)</label>
                <input
                  type="number"
                  value={policy.base_score}
                  onChange={(e) => setPolicy({ ...policy, base_score: parseInt(e.target.value, 10) || 100 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Normal Deduction (pts/hr)</label>
                <input
                  type="number"
                  step="0.5"
                  value={policy.deduction_per_hour}
                  onChange={(e) => setPolicy({ ...policy, deduction_per_hour: parseFloat(e.target.value) || 5 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Peak Surcharge (pts/hr)</label>
                <input
                  type="number"
                  step="0.5"
                  value={policy.high_demand_deduction_per_hour}
                  onChange={(e) => setPolicy({ ...policy, high_demand_deduction_per_hour: parseFloat(e.target.value) || 10 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">High-Demand Ratio Threshold</label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="10.0"
                  value={policy.high_demand_threshold}
                  onChange={(e) => setPolicy({ ...policy, high_demand_threshold: parseFloat(e.target.value) || 1.5 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">Priority Floor (P_min)</label>
                <input
                  type="number"
                  value={policy.min_priority_floor}
                  onChange={(e) => setPolicy({ ...policy, min_priority_floor: parseInt(e.target.value, 10) || 10 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
              <div>
                <label className="text-zinc-400 block mb-1">No-Show Penalty (pts)</label>
                <input
                  type="number"
                  value={policy.no_show_penalty}
                  onChange={(e) => setPolicy({ ...policy, no_show_penalty: parseInt(e.target.value, 10) || 25 })}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 outline-none focus:border-emerald-500 tabular-nums"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-400">
              Active Formula: P_u = max({policy.min_priority_floor}, {policy.base_score} − {policy.deduction_per_hour}T_u − {policy.high_demand_deduction_per_hour}T_H)
            </span>
            <button
              type="submit"
              disabled={savingPolicy}
              className="h-9 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-xs transition-colors"
            >
              {savingPolicy ? 'Saving...' : 'Save Schedule & Policy'}
            </button>
          </div>
        </form>

        {/* Operational Health Overview */}
        <div className="xl:col-span-4 p-6 rounded-xl bg-zinc-900 border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Lab L-106 Operational Health</h2>
              <p className="text-xs text-zinc-400 mt-0.5">84 workstations across 2 blocks</p>
            </div>
            <span className="material-symbols-outlined text-zinc-400 text-[20px]">monitoring</span>
          </div>

          <div className="grid grid-cols-2 gap-3 font-mono text-xs tabular-nums">
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 uppercase block">Online Systems</span>
              <strong className="text-xl text-emerald-400 font-bold">{health?.summary?.onlineCount ?? 82}</strong>
              <span className="text-zinc-500"> / {health?.summary?.totalWorkstations ?? 84}</span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 uppercase block">Maintenance</span>
              <strong className="text-xl text-zinc-200 font-bold">{health?.summary?.maintenanceCount ?? 2}</strong>
              <span className="text-zinc-500"> offline</span>
            </div>
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 uppercase block">Live Jain Index</span>
              <strong className="text-xl text-zinc-100 font-bold">{report?.liveMetrics?.jainsFairnessIndex ?? '1.00'}</strong>
            </div>
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
              <span className="text-[10px] text-zinc-500 uppercase block">Queued Waitlist</span>
              <strong className="text-xl text-zinc-100 font-bold">{report?.waitlistCount ?? 0}</strong>
            </div>
          </div>

          {health?.occupancyDistribution && (
            <div className="p-3.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono space-y-1.5 tabular-nums">
              <div className="text-[10px] uppercase text-zinc-500 mb-1">Daily Occupancy Breakdown</div>
              <div className="flex justify-between"><span className="text-emerald-400">Low (0–49%)</span><span>{health.occupancyDistribution.LOW} seats</span></div>
              <div className="flex justify-between"><span className="text-amber-300">Medium (50–70%)</span><span>{health.occupancyDistribution.MEDIUM} seats</span></div>
              <div className="flex justify-between"><span className="text-orange-400">High (71–99%)</span><span>{health.occupancyDistribution.HIGH} seats</span></div>
              <div className="flex justify-between"><span className="text-rose-400">Full (100%)</span><span>{health.occupancyDistribution.FULL} seats</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: 3-Policy Fairness Comparison (FIFO vs Basic FairLab vs FairLab v2) */}
      <section className="p-6 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-5 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">3-Policy Research Comparison (FIFO vs Basic FairLab vs FairLab v2)</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Identical mixed-demand & bot-skew workload trace (Mulberry32 deterministic seed 1337 · 60 students · 10 workstations).
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunSim}
            disabled={simRunning}
            className="h-9 px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-100 flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            <span>{simRunning ? 'Running 300 Rounds...' : 'Run 300-Round Comparison'}</span>
          </button>
        </div>

        {comparison?.policies && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[11px]">
                  <th className="py-2.5 px-3">Policy</th>
                  <th className="py-2.5 px-3">Overall Gini</th>
                  <th className="py-2.5 px-3">Peak-Slot Gini</th>
                  <th className="py-2.5 px-3">Jain Index</th>
                  <th className="py-2.5 px-3">Max Wait</th>
                  <th className="py-2.5 px-3">Zero-Alloc %</th>
                  <th className="py-2.5 px-3 text-right">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {comparison.policies.map((p, idx) => (
                  <tr key={p.policy} className={idx === 2 ? 'bg-emerald-500/5' : ''}>
                    <td className="py-3 px-3">
                      <div className={`font-semibold ${idx === 2 ? 'text-emerald-400' : 'text-zinc-200'}`}>{p.policy}</div>
                      <div className="text-[11px] text-zinc-500">{p.rule}</div>
                    </td>
                    <td className="py-3 px-3">{p.giniCoefficient}</td>
                    <td className="py-3 px-3">{p.highDemandGini}</td>
                    <td className="py-3 px-3 font-semibold">{p.jainsFairnessIndex}</td>
                    <td className="py-3 px-3">{p.maxWaitingCycles} cycles</td>
                    <td className="py-3 px-3">{p.zeroAllocationPct}%</td>
                    <td className="py-3 px-3 text-right">{p.utilizationPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Row 3: 84-Workstation Maintenance Matrix (Block A / Block B Tabs) */}
      <section className="p-6 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-5 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Workstation Maintenance & Offline Reallocation</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Taking a booked seat offline automatically reallocates active bookings to another free seat in the same block.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono">
            <button
              type="button"
              onClick={() => setBlockFilter('A')}
              className={`px-3 py-1 rounded-md transition-colors ${
                blockFilter === 'A' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Block A (60)
            </button>
            <button
              type="button"
              onClick={() => setBlockFilter('B')}
              className={`px-3 py-1 rounded-md transition-colors ${
                blockFilter === 'B' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Block B (24)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-10 gap-2">
          {filteredRigs.map(rig => {
            const isMaint = rig.status === 'MAINTENANCE';
            return (
              <div
                key={rig.machine_id}
                className={`p-2.5 rounded-lg border flex flex-col justify-between gap-2 text-xs font-mono ${
                  isMaint ? 'bg-zinc-950 border-zinc-800 text-zinc-500' : 'bg-zinc-950 border-zinc-800/80 text-zinc-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[11px]">{rig.display_label || rig.machine_id}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${isMaint ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleMaintenance(rig.machine_id, rig.status)}
                  className={`w-full py-1 rounded text-[10px] border transition-colors ${
                    isMaint
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-rose-400 hover:border-rose-500/30'
                  }`}
                >
                  {isMaint ? 'Restore' : 'Set Offline'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Row 4: Immutable Audit Trail */}
      <section className="p-6 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Audit Trail</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Recorded policy changes, offline reallocations, no-show recoveries, and semester rolls.</p>
          </div>
          <span className="text-xs font-mono text-zinc-400">{auditLogs.length} entries</span>
        </div>

        <div className="overflow-x-auto max-h-60 overflow-y-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400 uppercase text-[11px]">
                <th className="py-2 px-2">Time</th>
                <th className="py-2 px-2">Actor</th>
                <th className="py-2 px-2">Action</th>
                <th className="py-2 px-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {auditLogs.map(log => (
                <tr key={log.log_id} className="hover:bg-zinc-800/30">
                  <td className="py-2 px-2 text-zinc-500 whitespace-nowrap tabular-nums">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="py-2 px-2 text-zinc-200 whitespace-nowrap">{log.actor_name}</td>
                  <td className="py-2 px-2 text-emerald-400 whitespace-nowrap">{log.action}</td>
                  <td className="py-2 px-2 text-zinc-300">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Row 5: Planned Future Development (Not Active in Current Booking Core) */}
      <section className="p-5 rounded-xl bg-zinc-900/60 border border-dashed border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-zinc-300">
              Future Development Roadmap · Hardware Telemetry Agents
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              Planned · Not Active on Site
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            FairLab&apos;s active core focuses exclusively on 84-seat interval booking, fairness-aware allocation, and QR gate verification. Automated workstation hardware telemetry agents (<code className="text-zinc-300">agents/</code>) are documented as future work pending physical L-106 network onboarding.
          </p>
        </div>
      </section>

      {/* Semester Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-zinc-900 border border-zinc-800 p-6 space-y-4">
            <h3 className="text-base font-bold text-zinc-100">Confirm Semester Reset</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This archives the active term and resets all students to <strong>{policy.base_score} points</strong> and 0 used hours. All historical bookings and audit trails remain intact.
            </p>
            <div>
              <label className="text-[11px] font-mono uppercase text-zinc-400 block mb-1">New Semester Name</label>
              <input
                type="text"
                value={newSemesterName}
                onChange={(e) => setNewSemesterName(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="h-9 px-3.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteReset}
                disabled={resetting}
                className="h-9 px-4 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-semibold text-xs"
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
