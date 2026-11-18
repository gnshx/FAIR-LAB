import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

export default function QueueFloorMapView() {
  const { subscribe } = useSocket();

  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [slots, setSlots] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState('slot-4');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [queue, setQueue] = useState([]);
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);
  const [allocationSummary, setAllocationSummary] = useState(null);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setError('');
      const [resSlots, resQueue, resLeader] = await Promise.all([
        fetch(`/api/labs/L106/slots?date=${selectedDate}`),
        fetch(`/api/bookings/queue/${selectedSlotId}?date=${selectedDate}`),
        fetch('/api/fairness/leaderboard?limit=25')
      ]);

      if (resSlots.ok) {
        const sData = await resSlots.json();
        setSlots(sData);
        if (sData.length > 0 && !sData.some(s => s.slot_id === selectedSlotId)) {
          setSelectedSlotId(sData[0].slot_id);
        }
      }
      if (resQueue.ok) setQueue(await resQueue.json());
      if (resLeader.ok) setLeaderboard(await resLeader.json());
    } catch (e) {
      setError('Unable to load fairness queue and cohort leaderboard.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedSlotId]);

  useEffect(() => {
    setLoading(true);
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const unsubs = [
      subscribe('QUEUE_CHANGED', fetchAll),
      subscribe('SLOT_UPDATED', fetchAll),
      subscribe('allocation.completed', fetchAll),
      subscribe('fairness.score_updated', fetchAll)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchAll]);

  const handleRunAllocation = async () => {
    setAllocating(true);
    setAllocationSummary(null);
    setError('');
    try {
      const res = await fetch(`/api/bookings/queue/${selectedSlotId}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingDate: selectedDate })
      });
      const data = await res.json();
      if (res.ok) {
        setAllocationSummary(data);
        await fetchAll();
      } else {
        setError(data.error || 'Allocation round could not complete.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setAllocating(false);
    }
  };

  const selectedSlot = slots.find(s => s.slot_id === selectedSlotId);
  const queuedCount = queue.filter(q => q.status === 'QUEUED').length;
  const allocatedCount = queue.filter(q => q.status === 'ALLOCATED').length;

  const filteredQueue = useMemo(() => {
    return queue.filter(req => {
      if (statusFilter !== 'ALL' && req.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${req.student_name || ''} ${req.roll_no || ''} ${req.preferred_label || ''}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [queue, statusFilter, searchQuery]);

  return (
    <div className="flex flex-col w-full gap-6 text-[#1D2939]">
      {/* Page Header */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-display font-bold tracking-tight text-[#1D2939]">
              Fairness Queue &amp; Allocation Worker
            </h1>
            <span className="text-xs font-mono font-medium px-2.5 py-0.5 rounded-full bg-[#F0EEFF] text-[#4F22F2] border border-[#E4DDFF]">
              4-Tier Lexicographic
            </span>
          </div>
          <p className="text-sm text-[#667085] mt-1">
            Inspect competing student requests, demand ratios, and run deterministic batch allocation rounds.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunAllocation}
          disabled={allocating || queuedCount === 0}
          className="h-10 px-4 rounded-xl bg-[#5B4CF5] hover:bg-[#4F22F2] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">play_arrow</span>
          <span>{allocating ? 'Running Round...' : `Run Batch Allocation (${queuedCount})`}</span>
        </button>
      </section>

      {/* Enterprise Labeled Filter Bar (inspired by design/adminpage to sww the booking uiux.png) */}
      <section className="bg-white rounded-2xl border border-[#EAECF0] shadow-card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 items-end">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] block mb-1.5">
              Booking Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-white border border-[#D0D5DD] text-xs font-mono text-[#1D2939] outline-none focus:border-[#5B4CF5] focus:ring-2 focus:ring-[#5B4CF5]/15"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] block mb-1.5">
              Time Interval
            </label>
            <select
              value={selectedSlotId}
              onChange={(e) => setSelectedSlotId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-white border border-[#D0D5DD] text-xs font-mono text-[#1D2939] outline-none focus:border-[#5B4CF5] focus:ring-2 focus:ring-[#5B4CF5]/15"
            >
              {slots.map(s => (
                <option key={s.slot_id} value={s.slot_id}>
                  {s.start_time}–{s.end_time} ({s.queued_count || 0} queued)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] block mb-1.5">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-white border border-[#D0D5DD] text-xs font-medium text-[#1D2939] outline-none focus:border-[#5B4CF5] focus:ring-2 focus:ring-[#5B4CF5]/15"
            >
              <option value="ALL">All Requests ({queue.length})</option>
              <option value="QUEUED">Queued ({queuedCount})</option>
              <option value="ALLOCATED">Allocated ({allocatedCount})</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#667085] block mb-1.5">
              Search Student / Seat
            </label>
            <div className="relative">
              <span className="material-symbols-outlined text-[16px] text-[#98A2B3] absolute left-3 top-1/2 -translate-y-1/2">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name, Roll No, or Seat..."
                className="w-full h-10 pl-9 pr-3 rounded-lg bg-white border border-[#D0D5DD] text-xs text-[#1D2939] outline-none focus:border-[#5B4CF5] focus:ring-2 focus:ring-[#5B4CF5]/15 placeholder:text-[#98A2B3]"
              />
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#B91C1C] flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={fetchAll}
            className="px-3 py-1 rounded-lg bg-white border border-[#FECACA] text-[#B91C1C] font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {allocationSummary && (
        <div className="px-4 py-3.5 rounded-xl bg-[#ECFDF3] border border-[#A6F4C5] text-[#15803D] flex items-center justify-between text-xs font-medium">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            <span>
              Allocated <strong>{allocationSummary.allocatedCount}</strong> workstation(s) ·{' '}
              <strong>{allocationSummary.waitlistedCount}</strong> waitlisted · Demand:{' '}
              <strong className="font-mono">{allocationSummary.demandLevel}</strong> (Ratio {allocationSummary.demandRatio})
            </span>
          </div>
          <button type="button" onClick={() => setAllocationSummary(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Main Split: Ranked Request Table (7 cols) + Cohort Fairness Leaderboard (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Ranked Queue Table */}
        <section className="xl:col-span-7 bg-white rounded-2xl border border-[#EAECF0] shadow-card overflow-hidden">
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#EAECF0]">
            <div>
              <h2 className="text-sm font-bold text-[#1D2939]">
                Priority Ranking Queue · {selectedSlot ? `${selectedSlot.start_time}–${selectedSlot.end_time}` : selectedSlotId}
              </h2>
              <p className="text-xs text-[#667085] mt-0.5">
                Order: Score (P<sub>u</sub>) → Eligible Wait (W<sub>u</sub>) → Timestamp → Deterministic ID
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
              <span className="px-2.5 py-0.5 rounded-full bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A] font-semibold">
                {queuedCount} Queued
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#ECFDF3] text-[#15803D] border border-[#A6F4C5] font-semibold">
                {allocatedCount} Allocated
              </span>
            </div>
          </div>

          {loading ? (
            <div className="p-5 space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded-xl bg-[#F2F4F7] animate-pulse" />
              ))}
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <div className="w-11 h-11 rounded-2xl bg-[#F7F8FC] border border-[#EAECF0] flex items-center justify-center text-[#98A2B3] mx-auto mb-3">
                <span className="material-symbols-outlined text-[24px]">inbox</span>
              </div>
              <p className="text-sm font-semibold text-[#1D2939]">No requests match this filter</p>
              <p className="text-xs text-[#667085] mt-1">
                Submit a workstation request on the Lab Seat Map or choose another interval above.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#EAECF0] text-[#667085] uppercase font-semibold tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4 text-center">Score</th>
                    <th className="py-3 px-4">Preference &amp; Tie-Break</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAECF0]">
                  {filteredQueue.map((req, idx) => {
                    const isAllocated = req.status === 'ALLOCATED';
                    return (
                      <tr key={req.request_id || idx} className="hover:bg-[#F9FAFB] transition-colors">
                        <td className="py-3.5 px-4 font-mono font-bold tabular-nums">
                          {isAllocated ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#ECFDF3] text-[#15803D]">
                              <span className="material-symbols-outlined text-[15px]">check</span>
                            </span>
                          ) : (
                            <span className="text-[#4F22F2]">#{req.queue_rank || idx + 1}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-[#1D2939]">{req.student_name}</div>
                          <div className="text-[11px] font-mono text-[#667085] tabular-nums mt-0.5">
                            {req.roll_no} · {req.total_hours_used ?? 0}h ({req.high_demand_hours ?? 0}h peak)
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center font-mono tabular-nums">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#F0EEFF] text-[#4F22F2] border border-[#E4DDFF] font-bold">
                            {req.priority_score_snapshot} pts
                          </span>
                        </td>
                        <td className="py-3.5 px-4 max-w-[220px]">
                          <div className="text-[#1D2939] font-mono font-medium text-[11px]">
                            {req.preferred_label || req.preferred_machine_id || 'Any available seat'}
                          </div>
                          <div className="text-[11px] text-[#667085] truncate mt-0.5">{req.tie_break_reason}</div>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                              isAllocated
                                ? 'bg-[#ECFDF3] text-[#15803D] border-[#A6F4C5]'
                                : 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]'
                            }`}
                          >
                            {req.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Cohort Fairness Leaderboard */}
        <section className="xl:col-span-5 bg-white rounded-2xl border border-[#EAECF0] shadow-card overflow-hidden">
          <div className="px-5 py-4 flex items-center justify-between border-b border-[#EAECF0]">
            <div>
              <h2 className="text-sm font-bold text-[#1D2939]">Cohort Fairness Leaderboard</h2>
              <p className="text-xs text-[#667085] mt-0.5">Live priority standing across active students</p>
            </div>
            {leaderboard?.metrics && (
              <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                <span className="px-2 py-0.5 rounded-md bg-[#ECFDF3] text-[#15803D] border border-[#A6F4C5] font-semibold">
                  Jain {leaderboard.metrics.jainsFairnessIndex}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-[#F7F8FC] text-[#475467] border border-[#EAECF0]">
                  Gini {leaderboard.metrics.giniCoefficient}
                </span>
              </div>
            )}
          </div>

          <div className="divide-y divide-[#F2F4F7] max-h-[480px] overflow-y-auto">
            {(leaderboard?.students || []).map((st, idx) => (
              <div
                key={st.user_id}
                className="px-5 py-3 flex items-center justify-between text-xs hover:bg-[#F9FAFB] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-[#F7F8FC] border border-[#EAECF0] text-[#667085] font-mono text-[11px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1D2939] truncate">{st.name}</div>
                    <div className="text-[11px] font-mono text-[#667085] tabular-nums">
                      {st.roll_no} · {st.total_hours_used ?? 0}h total · {st.high_demand_hours ?? 0}h peak
                    </div>
                  </div>
                </div>
                <span className="font-mono font-bold text-[#4F22F2] bg-[#F0EEFF] px-2.5 py-0.5 rounded-full tabular-nums shrink-0 ml-2">
                  {st.current_score} pts
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
