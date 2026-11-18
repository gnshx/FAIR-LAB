import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

export default function AdminAllocationView() {
  const { currentUser } = useAuth();
  const { subscribe } = useSocket();

  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [slots, setSlots] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState('slot-4');
  const [queue, setQueue] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  const fetchRound = useCallback(async () => {
    try {
      setError('');
      const [resSlots, resQueue, resPolicy] = await Promise.all([
        fetch(`/api/labs/L106/slots?date=${selectedDate}`),
        fetch(`/api/bookings/queue/${selectedSlotId}?date=${selectedDate}`),
        fetch('/api/admin/policy')
      ]);

      if (resSlots.ok) {
        const sData = await resSlots.json();
        setSlots(sData);
        if (sData.length > 0 && !sData.some(s => s.slot_id === selectedSlotId)) {
          setSelectedSlotId(sData[0].slot_id);
        }
      }
      if (resQueue.ok) setQueue(await resQueue.json());
      if (resPolicy.ok) setPolicy(await resPolicy.json());
    } catch (e) {
      setError('Unable to load allocation queue for this interval.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedSlotId]);

  useEffect(() => {
    setLoading(true);
    fetchRound();
  }, [fetchRound]);

  useEffect(() => {
    const unsubs = [
      subscribe('QUEUE_CHANGED', fetchRound),
      subscribe('allocation.completed', fetchRound),
      subscribe('SLOT_UPDATED', fetchRound)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchRound]);

  const handleCommit = async () => {
    setCommitting(true);
    setSummary(null);
    setError('');
    try {
      const res = await fetch(`/api/bookings/queue/${selectedSlotId}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify({ bookingDate: selectedDate })
      });
      const data = await res.json();
      if (res.ok) {
        setSummary(data);
        await fetchRound();
      } else {
        setError(data.error || 'Allocation round failed.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCommitting(false);
    }
  };

  const selectedSlot = slots.find(s => s.slot_id === selectedSlotId);
  const freeSeats = selectedSlot
    ? Math.max(0, Number(selectedSlot.capacity || 84) - Number(selectedSlot.allocated_count || 0))
    : 82;
  const queuedCount = queue.filter(q => q.status === 'QUEUED').length;
  const totalReq = queue.length;
  const ratio = freeSeats > 0 ? queuedCount / freeSeats : (queuedCount > 0 ? 99 : 0);
  const threshold = Number(policy?.high_demand_threshold ?? 1.5);
  const isHighDemand = ratio >= threshold;

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header Row (Exact 08_admin_allocation_round.png) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Allocation round
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1 tabular-nums">
            Interval {selectedDate} · {selectedSlot ? `${selectedSlot.start_time}–${selectedSlot.end_time}` : selectedSlotId} · {totalReq} eligible requests · {freeSeats} workstations free
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 px-3 rounded-xl bg-white border border-[#E5E7EB] text-xs font-mono text-[#0F172A] outline-none focus:border-[#4F46E5]"
          />
          <select
            value={selectedSlotId}
            onChange={(e) => setSelectedSlotId(e.target.value)}
            className="h-9 px-3 rounded-xl bg-white border border-[#E5E7EB] text-xs font-mono text-[#0F172A] outline-none focus:border-[#4F46E5]"
          >
            {slots.map(s => (
              <option key={s.slot_id} value={s.slot_id}>
                {s.start_time}–{s.end_time} ({s.queued_count || 0} queued)
              </option>
            ))}
          </select>
          <span
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold tabular-nums ${
              isHighDemand ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#DCFCE7] text-[#15803D]'
            }`}
          >
            {isHighDemand ? 'High demand' : 'Normal'} · D = {ratio.toFixed(2)}
          </span>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-xs text-[#DC2626]">
          {error}
        </div>
      )}

      {summary && (
        <div className="px-4 py-3.5 rounded-xl bg-[#DCFCE7] border border-[#BBF7D0] text-xs font-medium text-[#15803D] flex items-center justify-between">
          <span>
            Round committed: <strong>{summary.allocatedCount}</strong> allocated, <strong>{summary.waitlistedCount}</strong> waitlisted · Demand: <strong>{summary.demandLevel}</strong> (D = {summary.demandRatio})
          </span>
          <button type="button" onClick={() => setSummary(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Main Split: Ranked Candidates (8 cols) + Policy/Safeguards Sidebar (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        <section className="xl:col-span-8 fl-card p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Ranked candidates</h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Ranked by priority → waiting time → request time → request ID
            </p>

            {loading ? (
              <div className="mt-5 space-y-3">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-12 rounded-xl bg-[#F1F5F9] animate-pulse" />
                ))}
              </div>
            ) : queue.length === 0 ? (
              <div className="py-16 text-center text-xs text-[#64748B]">
                No queued requests for this interval yet. Switch interval above or submit a request from the Student Workspace.
              </div>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                    <tr>
                      <th className="py-3 pr-3 font-medium">#</th>
                      <th className="py-3 px-3 font-medium">Student</th>
                      <th className="py-3 px-3 font-medium">Priority</th>
                      <th className="py-3 px-3 font-medium">T / H</th>
                      <th className="py-3 px-3 font-medium">Preference</th>
                      <th className="py-3 pl-3 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
                    {queue.map((req, idx) => {
                      const scoreVal = Number(req.priority_score_snapshot ?? 100);
                      const isAllocated = req.status === 'ALLOCATED';
                      const isWaitlisted = req.status === 'WAITLISTED' || req.status === 'REJECTED';
                      return (
                        <tr key={req.request_id || idx} className="hover:bg-[#F8FAFC]">
                          <td className="py-4 pr-3 text-[#64748B] font-mono">{req.queue_rank || idx + 1}</td>
                          <td className="py-4 px-3">
                            <div className="font-semibold text-[#0F172A]">{req.student_name}</div>
                            <div className="text-[11px] font-mono text-[#94A3B8]">{req.roll_no}</div>
                          </td>
                          <td className="py-4 px-3">
                            <div className="flex items-center gap-2.5">
                              <span className="font-bold text-[#4F46E5] font-mono w-7">{scoreVal}</span>
                              <div className="w-20 h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                                <div
                                  className="h-full bg-[#4F46E5] rounded-full"
                                  style={{ width: `${Math.min(100, Math.max(6, scoreVal))}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-3 font-mono text-[#475569]">
                            {req.total_hours_used ?? 0}h / {req.high_demand_hours ?? 0}h
                          </td>
                          <td className="py-4 px-3 font-mono text-[11px] text-[#475569]">
                            {req.preferred_label || req.preferred_machine_id || 'Any PC'}
                          </td>
                          <td className="py-4 pl-3">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                isAllocated
                                  ? 'bg-[#DCFCE7] text-[#15803D]'
                                  : isWaitlisted
                                  ? 'bg-[#FEE2E2] text-[#DC2626]'
                                  : 'bg-[#FEF3C7] text-[#B45309]'
                              }`}
                            >
                              {isAllocated ? `Allocated` : isWaitlisted ? 'Not allocated' : 'Queued'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-6 px-4 py-3 rounded-xl bg-[#EEF2FF] text-[#4338CA] text-xs font-medium">
            Ties on equal priority score break deterministically by longer cumulative eligible wait time, then earliest submission timestamp.
          </div>
        </section>

        {/* Right Column Cards */}
        <aside className="xl:col-span-4 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="fl-card p-5">
              <h3 className="text-[13.5px] font-bold text-[#0F172A]">Priority formula</h3>
              <p className="text-xs text-[#64748B] mt-0.5">Active institutional policy</p>
              <div className="mt-3 p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                <div className="text-xs font-mono font-bold text-[#4F46E5]">
                  P = max({policy?.min_priority_floor ?? 10}, {policy?.base_score ?? 100} − {policy?.deduction_per_hour ?? 5}T − {policy?.high_demand_deduction_per_hour ?? 10}H)
                </div>
                <div className="text-[11px] text-[#64748B] mt-1">
                  T = total hours · H = high-demand hours
                </div>
              </div>
            </div>

            <div className="fl-card p-5">
              <h3 className="text-[13.5px] font-bold text-[#0F172A]">Demand classification</h3>
              <div className="mt-3 flex items-center gap-2.5 flex-wrap">
                <span className="text-lg font-bold font-mono text-[#0F172A] tabular-nums">
                  {totalReq} ÷ {freeSeats} = {ratio.toFixed(2)}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    isHighDemand ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#DCFCE7] text-[#15803D]'
                  }`}
                >
                  {isHighDemand ? `High (≥ ${threshold})` : `Normal (< ${threshold})`}
                </span>
              </div>
              <p className="text-[11.5px] text-[#64748B] mt-2 leading-relaxed">
                Recorded with every round so historical fairness calculations remain immutable.
              </p>
            </div>

            <div className="fl-card p-5">
              <h3 className="text-[13.5px] font-bold text-[#0F172A]">Round safeguards</h3>
              <ul className="mt-3 space-y-2.5 text-xs text-[#475569]">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] shrink-0" />
                  Round is claimed atomically to prevent duplicate commits
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] shrink-0" />
                  Availability rechecked under DB overlap constraint
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] shrink-0" />
                  Signed QR passes issued immediately on commit
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing || queuedCount === 0}
              className="w-full h-11 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-colors"
            >
              {committing ? 'Committing round...' : `Commit allocation (${queuedCount} queued)`}
            </button>
            <button
              type="button"
              onClick={fetchRound}
              className="w-full h-10 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#E5E7EB] text-[#0F172A] font-semibold text-xs transition-colors"
            >
              Refresh queue
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

