import React, { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

export default function QueueFloorMapView() {
  const { subscribe } = useSocket();

  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [slots, setSlots] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState('slot-4');
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
        fetch('/api/fairness/leaderboard?limit=20')
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

  return (
    <div className="flex flex-col w-full gap-6 text-zinc-100">
      {/* Top Batch Allocation Control Bar */}
      <section className="p-5 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-zinc-100 tracking-tight">
              Fairness Queue & Allocation Worker
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
              4-Tier Lexicographic
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Inspect competing student requests, demand ratios, and trigger deterministic batch allocation rounds.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-100 outline-none focus:border-emerald-500"
          />

          <select
            value={selectedSlotId}
            onChange={(e) => setSelectedSlotId(e.target.value)}
            className="h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-100 outline-none focus:border-emerald-500"
          >
            {slots.map(s => (
              <option key={s.slot_id} value={s.slot_id}>
                {s.start_time}–{s.end_time} ({s.queued_count || 0} queued)
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleRunAllocation}
            disabled={allocating || queuedCount === 0}
            className="h-9 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-xs transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            <span>{allocating ? 'Allocating...' : 'Run Batch Allocation'}</span>
          </button>
        </div>
      </section>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchAll} className="px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200">Retry</button>
        </div>
      )}

      {allocationSummary && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-200 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
            <span>
              Allocated <strong>{allocationSummary.allocatedCount}</strong> workstation(s) ·{' '}
              <strong>{allocationSummary.waitlistedCount}</strong> waitlisted · Demand:{' '}
              <strong>{allocationSummary.demandLevel}</strong> (Ratio {allocationSummary.demandRatio})
            </span>
          </div>
          <button onClick={() => setAllocationSummary(null)} className="text-zinc-400 hover:text-zinc-200">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Main Split: Ranked Request Queue (7 cols) + Cohort Fairness Leaderboard (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Ranked Queue */}
        <section className="xl:col-span-7 p-5 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Priority Ranking Queue · {selectedSlot ? `${selectedSlot.start_time}–${selectedSlot.end_time}` : selectedSlotId}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Ranked by Fairness Score (P<sub>u</sub>) → Eligible Wait (W<sub>u</sub>) → Request Timestamp → Deterministic ID
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">{queuedCount} Queued</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">{allocatedCount} Allocated</span>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-zinc-800/50 animate-pulse" />
              ))}
            </div>
          ) : queue.length === 0 ? (
            <div className="py-12 text-center">
              <span className="material-symbols-outlined text-[32px] text-zinc-600 mb-2">inbox</span>
              <p className="text-sm font-medium text-zinc-300">No requests in this interval</p>
              <p className="text-xs text-zinc-500 mt-1">
                Submit a workstation request from the Lab Seat Map or switch to another interval.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 uppercase font-mono text-[11px]">
                    <th className="py-2.5 px-2">Rank</th>
                    <th className="py-2.5 px-2">Student</th>
                    <th className="py-2.5 px-2 text-center">Score</th>
                    <th className="py-2.5 px-2">Preference & Tie-Break</th>
                    <th className="py-2.5 px-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {queue.map((req, idx) => {
                    const isAllocated = req.status === 'ALLOCATED';
                    return (
                      <tr key={req.request_id || idx} className="hover:bg-zinc-800/30">
                        <td className="py-3 px-2 font-mono font-bold tabular-nums">
                          {isAllocated ? (
                            <span className="text-emerald-400">Done</span>
                          ) : (
                            <span className="text-zinc-300">#{req.queue_rank || idx + 1}</span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <div className="font-medium text-zinc-100">{req.student_name}</div>
                          <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                            {req.roll_no} · {req.total_hours_used ?? 0}h used ({req.high_demand_hours ?? 0}h peak)
                          </div>
                        </td>
                        <td className="py-3 px-2 text-center font-mono tabular-nums">
                          <span className="px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-100 font-semibold">
                            {req.priority_score_snapshot} pts
                          </span>
                        </td>
                        <td className="py-3 px-2 max-w-[220px]">
                          <div className="text-zinc-300 font-mono text-[11px]">
                            {req.preferred_label || req.preferred_machine_id || 'Any available seat'}
                          </div>
                          <div className="text-[11px] text-zinc-500 truncate">{req.tie_break_reason}</div>
                        </td>
                        <td className="py-3 px-2 text-right">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                            isAllocated
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                          }`}>
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
        <section className="xl:col-span-5 p-5 rounded-xl bg-zinc-900 border border-zinc-800">
          <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Cohort Fairness Leaderboard</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Live priority distribution across students</p>
            </div>
            {leaderboard?.metrics && (
              <div className="text-right font-mono text-[11px] tabular-nums">
                <div className="text-emerald-400 font-semibold">Jain: {leaderboard.metrics.jainsFairnessIndex}</div>
                <div className="text-zinc-400">Gini: {leaderboard.metrics.giniCoefficient}</div>
              </div>
            )}
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {(leaderboard?.students || []).map((st, idx) => (
              <div
                key={st.user_id}
                className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-500 w-5 tabular-nums">{idx + 1}.</span>
                    <span className="font-medium text-zinc-200 truncate">{st.name}</span>
                  </div>
                  <div className="pl-7 text-[11px] font-mono text-zinc-500 tabular-nums mt-0.5">
                    {st.roll_no} · {st.total_hours_used ?? 0}h total · {st.high_demand_hours ?? 0}h peak
                  </div>
                </div>
                <span className="font-mono font-semibold text-emerald-400 tabular-nums shrink-0 ml-2">
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
