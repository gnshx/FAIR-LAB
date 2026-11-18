import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function StudentFairnessView() {
  const { currentUser, profile } = useAuth();
  const { subscribe } = useSocket();

  const [fairness, setFairness] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchFairness = useCallback(async () => {
    try {
      const res = await fetch('/api/fairness/me', {
        headers: { 'x-user-id': currentUser }
      });
      if (res.ok) setFairness(await res.json());
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    setLoading(true);
    fetchFairness();
  }, [fetchFairness]);

  useEffect(() => {
    const unsubs = [
      subscribe('SCORE_CHANGED', fetchFairness),
      subscribe('fairness.score_updated', fetchFairness)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchFairness]);

  const policy = fairness?.policy;
  const baseScore = policy?.base_score ?? 100;
  const minFloor = policy?.min_priority_floor ?? 10;
  const normalRate = policy?.deduction_per_hour ?? 5;
  const peakRate = policy?.high_demand_deduction_per_hour ?? 10;

  const score = fairness?.currentScore ?? profile?.fairness?.current_score ?? baseScore;
  const completedCount = fairness?.completedBookings ?? 0;
  const history = fairness?.history || [];

  // Build trajectory bars (Start -> each session) matching 05_student_fairness_score.png
  const chartBars = [{ label: 'Start', value: baseScore, isPeak: false }];
  if (history.length > 0) {
    [...history].reverse().slice(-5).forEach((h, idx) => {
      chartBars.push({
        label: h.demand_level === 'HIGH_DEMAND' ? `Session ${idx + 1} · high demand` : `Session ${idx + 1}`,
        value: Number(h.score_after ?? score),
        isPeak: h.demand_level === 'HIGH_DEMAND'
      });
    });
  } else if (score < baseScore) {
    chartBars.push({ label: 'Current', value: score, isPeak: false });
  }

  const tierLabel = score >= 85 ? 'Normal tier' : score > minFloor ? 'Moderate tier' : 'At floor';
  const tierCls =
    score >= 85
      ? 'bg-[#EEF2FF] text-[#4F46E5]'
      : score > minFloor
      ? 'bg-[#FEF3C7] text-[#B45309]'
      : 'bg-[#FEE2E2] text-[#DC2626]';

  return (
    <div className="flex flex-col w-full gap-6">
      {/* Header */}
      <div>
        <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
          Fairness score
        </h1>
        <p className="text-[13px] text-[#64748B] mt-1">
          How your priority is calculated and how it changes
        </p>
      </div>

      {/* Top 3 KPI Cards (Exact 05_student_fairness_score.png) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Priority score</span>
          {loading ? (
            <div className="h-9 w-16 bg-[#F1F5F9] rounded-lg animate-pulse mt-2" />
          ) : (
            <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1.5">
              {score}
            </div>
          )}
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold mt-2.5 ${tierCls}`}>
            {tierLabel}
          </span>
        </div>

        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Allocations received</span>
          {loading ? (
            <div className="h-9 w-16 bg-[#F1F5F9] rounded-lg animate-pulse mt-2" />
          ) : (
            <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1.5">
              {completedCount}
            </div>
          )}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCFCE7] text-[#15803D] mt-2.5">
            This semester
          </span>
        </div>

        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Cumulative hours used</span>
          {loading ? (
            <div className="h-9 w-20 bg-[#F1F5F9] rounded-lg animate-pulse mt-2" />
          ) : (
            <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1.5">
              {fairness?.totalHoursUsed ?? 0} h
            </div>
          )}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F1F5F9] text-[#64748B] mt-2.5">
            {fairness?.highDemandHours ?? 0} h high-demand
          </span>
        </div>
      </section>

      {/* Main Split: Vertical Bar Trajectory (7 cols) + Session History Table (5 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {/* Bar Chart Card */}
        <div className="xl:col-span-7 fl-card p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-[14px] font-bold text-[#0F172A]">Priority over completed sessions</h2>
            <p className="text-xs font-mono text-[#64748B] mt-0.5">
              P = max({minFloor}, {baseScore} − {normalRate}T − {peakRate}H)
            </p>

            {/* Vertical Rounded Bars */}
            <div className="mt-10 mb-6 flex items-end justify-center gap-6 sm:gap-9 h-60 px-4">
              {chartBars.map((bar, idx) => {
                const isLast = idx === chartBars.length - 1;
                const heightPct = Math.max(14, Math.round((bar.value / Math.max(1, baseScore)) * 100));
                return (
                  <div key={idx} className="flex flex-col items-center gap-2 h-full justify-end">
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        isLast ? 'text-[#4F46E5]' : 'text-[#0F172A]'
                      }`}
                    >
                      {bar.value}
                    </span>
                    <div
                      className={`w-12 sm:w-14 rounded-t-xl rounded-b-md transition-all duration-300 ${
                        isLast ? 'bg-[#4F46E5]' : 'bg-[#C7D2FE]'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-[11px] text-[#64748B] text-center max-w-[110px] leading-tight">
                      {bar.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-4 py-3 rounded-xl bg-[#EEF2FF] text-[#4338CA] text-xs font-medium">
            Floor is {minFloor}, so no student is ever fully locked out of contested slots.
          </div>
        </div>

        {/* Session History Card */}
        <div className="xl:col-span-5 fl-card overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-[#F1F5F9]">
            <h2 className="text-[14px] font-bold text-[#0F172A]">Session history</h2>
            <p className="text-xs text-[#64748B] mt-0.5">Completed sessions only</p>
          </div>

          {history.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-10 text-center text-xs text-[#64748B]">
              No completed sessions recorded yet this semester. Your score starts at {baseScore}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                  <tr>
                    <th className="py-3 px-5 font-medium">Seat</th>
                    <th className="py-3 px-3 font-medium">Hours</th>
                    <th className="py-3 px-3 font-medium">Session</th>
                    <th className="py-3 px-5 font-medium text-right">Priority</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
                  {history.map(h => (
                    <tr key={h.allocation_id} className="hover:bg-[#F8FAFC]">
                      <td className="py-3.5 px-5 font-semibold text-[#0F172A] font-mono">
                        {h.machine_id || 'L-106'}
                      </td>
                      <td className="py-3.5 px-3 text-[#475569] font-mono">
                        {h.duration_hours ?? 1}h
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                            h.demand_level === 'HIGH_DEMAND'
                              ? 'bg-[#FEF3C7] text-[#B45309]'
                              : 'bg-[#F1F5F9] text-[#475569]'
                          }`}
                        >
                          {h.demand_level === 'HIGH_DEMAND' ? 'High demand' : 'Normal'}
                        </span>
                      </td>
                      <td className="py-3.5 px-5 text-right font-bold text-[#0F172A] font-mono">
                        {h.score_after}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

