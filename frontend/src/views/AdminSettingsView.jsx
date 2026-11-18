import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AdminSettingsView() {
  const { currentUser, profile } = useAuth();
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
    max_duration_minutes: 120,
    max_daily_hours: 2,
    max_daily_bookings: 2,
    require_ticket_release: 0
  });

  const [saving, setSaving] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [banner, setBanner] = useState(null);
  const [showReset, setShowReset] = useState(false);
  const [newSemName, setNewSemName] = useState('Spring 2027 Semester');
  const [resetting, setResetting] = useState(false);

  const fetchPolicy = useCallback(async () => {
    const res = await fetch('/api/admin/policy');
    if (res.ok) {
      const p = await res.json();
      if (p) setPolicy(prev => ({ ...prev, ...p }));
    }
  }, []);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
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
        max_duration_minutes: Math.min(120, Number(policy.max_duration_minutes || 120)),
        max_daily_hours: Number(policy.max_daily_hours),
        max_daily_bookings: Number(policy.max_daily_bookings),
        require_ticket_release: Boolean(policy.require_ticket_release)
      };

      const res = await fetch('/api/admin/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setBanner({ type: 'success', text: 'Policy settings saved and recorded in the audit log.' });
        await fetchPolicy();
      } else {
        setBanner({ type: 'error', text: data.error || 'Admin permission required (HTTP 403).' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleNoShowSweep = async () => {
    setSweeping(true);
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
          text: `No-show sweep complete: ${data.noShowCount} expired booking(s) released, ${data.promotedCount} waitlisted promoted.`
        });
      } else {
        setBanner({ type: 'error', text: data.error || 'No-show sweep failed.' });
      }
    } finally {
      setSweeping(false);
    }
  };

  const handleSemesterReset = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/admin/semester/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify({ semesterName: newSemName })
      });
      const data = await res.json();
      if (res.ok) {
        setShowReset(false);
        setBanner({
          type: 'success',
          text: `Semester rolled to "${data.semesterName}" — reset ${data.resetStudentsCount} student scores.`
        });
      } else {
        setBanner({ type: 'error', text: data.error || 'Semester reset failed.' });
      }
    } finally {
      setResetting(false);
    }
  };

  const fieldCls =
    'w-full h-10 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-medium text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5] tabular-nums';

  return (
    <form onSubmit={handleSave} className="flex flex-col w-full gap-6">
      {/* Header Row (Exact 13_admin_settings.png) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Policy settings
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            Configure fairness and booking rules. Changes are audited.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleNoShowSweep}
            disabled={sweeping}
            className="h-10 px-3.5 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#E5E7EB] text-xs font-semibold text-[#334155]"
          >
            {sweeping ? 'Checking...' : 'No-show sweep'}
          </button>
          <button
            type="button"
            onClick={() => setShowReset(true)}
            className="h-10 px-3.5 rounded-xl bg-[#FEE2E2] hover:bg-[#FECACA] text-[#DC2626] text-xs font-semibold"
          >
            Semester reset
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-10 px-5 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-colors"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      {!isAdmin && (
        <div className="px-4 py-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] text-xs text-[#92400E]">
          Read-only preview: switch to <strong>Dr. A. K. Sharma (Admin)</strong> in the bottom-left account menu to persist changes.
        </div>
      )}

      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
            banner.type === 'success'
              ? 'bg-[#DCFCE7] border-[#BBF7D0] text-[#15803D]'
              : 'bg-[#FEE2E2] border-[#FECACA] text-[#DC2626]'
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Exact 2-Column Settings Cards (13_admin_settings.png) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-stretch">
        {/* Left: Fairness Policy */}
        <section className="fl-card p-6">
          <h2 className="text-[14px] font-bold text-[#0F172A]">Fairness policy</h2>
          <p className="text-xs font-mono text-[#64748B] mt-0.5">
            P = max(floor, base − a·T − b·H)
          </p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Base priority</label>
              <input
                type="number"
                value={policy.base_score}
                onChange={(e) => setPolicy({ ...policy, base_score: parseInt(e.target.value, 10) || 100 })}
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Minimum floor</label>
              <input
                type="number"
                value={policy.min_priority_floor}
                onChange={(e) => setPolicy({ ...policy, min_priority_floor: parseInt(e.target.value, 10) || 10 })}
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Penalty per hour (a)</label>
              <input
                type="number"
                step="0.5"
                value={policy.deduction_per_hour}
                onChange={(e) => setPolicy({ ...policy, deduction_per_hour: parseFloat(e.target.value) || 5 })}
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">High-demand surcharge (b)</label>
              <input
                type="number"
                step="0.5"
                value={policy.high_demand_deduction_per_hour}
                onChange={(e) => setPolicy({ ...policy, high_demand_deduction_per_hour: parseFloat(e.target.value) || 10 })}
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">High-demand threshold D ≥</label>
              <input
                type="number"
                step="0.1"
                value={policy.high_demand_threshold}
                onChange={(e) => setPolicy({ ...policy, high_demand_threshold: parseFloat(e.target.value) || 1.5 })}
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">No-show penalty (pts)</label>
              <input
                type="number"
                value={policy.no_show_penalty}
                onChange={(e) => setPolicy({ ...policy, no_show_penalty: parseInt(e.target.value, 10) || 25 })}
                className={fieldCls}
              />
            </div>
          </div>
        </section>

        {/* Right: Booking Policy */}
        <section className="fl-card p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Booking policy</h2>
            <p className="text-xs text-[#64748B] mt-0.5">Limits applied to student requests</p>

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Lab open time</label>
                <input
                  type="time"
                  value={policy.lab_open_time || '09:00'}
                  onChange={(e) => setPolicy({ ...policy, lab_open_time: e.target.value })}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Lab close time</label>
                <input
                  type="time"
                  value={policy.lab_close_time || '18:00'}
                  onChange={(e) => setPolicy({ ...policy, lab_close_time: e.target.value })}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Max daily hours / student</label>
                <input
                  type="number"
                  step="0.5"
                  value={policy.max_daily_hours}
                  onChange={(e) => setPolicy({ ...policy, max_daily_hours: parseFloat(e.target.value) || 2 })}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Cancellation cutoff (hours)</label>
                <input
                  type="number"
                  value={policy.cancellation_window_hours}
                  onChange={(e) => setPolicy({ ...policy, cancellation_window_hours: parseInt(e.target.value, 10) || 2 })}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Check-in grace period (min)</label>
                <input
                  type="number"
                  value={policy.grace_period_minutes}
                  onChange={(e) => setPolicy({ ...policy, grace_period_minutes: parseInt(e.target.value, 10) || 15 })}
                  className={fieldCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Max single booking (min)</label>
                <input
                  type="number"
                  min={30}
                  max={120}
                  step={15}
                  value={Math.min(120, policy.max_duration_minutes ?? 120)}
                  onChange={(e) => setPolicy({ ...policy, max_duration_minutes: Math.min(120, parseInt(e.target.value, 10) || 120) })}
                  className={fieldCls}
                />
              </div>
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-[#F1F5F9] flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-[#0F172A]">Block overlapping bookings per student</div>
              <div className="text-[11px] text-[#94A3B8] mt-0.5">Enforced at database level via half-open interval constraints</div>
            </div>
            <div className="w-10 h-5 rounded-full bg-[#4F46E5] p-0.5 flex items-center justify-end shrink-0">
              <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
            </div>
          </div>
        </section>
      </div>

      {/* Semester Reset Modal */}
      {showReset && (
        <div className="fixed inset-0 z-50 bg-[#0B1120]/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#E5E7EB] p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-[#0F172A]">Confirm semester reset</h3>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Archives the active term and resets all students to <strong>{policy.base_score} points</strong> and 0 used hours. Historical records remain untouched.
            </p>
            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">New semester name</label>
              <input
                type="text"
                value={newSemName}
                onChange={(e) => setNewSemName(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReset(false)}
                className="h-9 px-4 rounded-xl bg-white border border-[#E5E7EB] text-xs font-semibold text-[#475569]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSemesterReset}
                disabled={resetting}
                className="h-9 px-4 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-semibold"
              >
                {resetting ? 'Resetting...' : 'Execute reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

