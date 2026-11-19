import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';

function heatmapCellClass(pct, isMaint) {
  if (isMaint) return 'bg-[#F1F5F9] border-[#E2E8F0] text-[#94A3B8]';
  if (pct >= 100) return 'bg-[#DC2626] border-[#DC2626] text-white';
  if (pct >= 71) return 'bg-[#FFEDD5] border-[#FDBA74] text-[#9A3412]';
  if (pct >= 50) return 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]';
  return 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]';
}

export default function AdminOverviewView({ onNavigate }) {
  const { subscribe } = useSocket();

  const [availability, setAvailability] = useState(null);
  const [health, setHealth] = useState(null);
  const [report, setReport] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [blockTab, setBlockTab] = useState('A');
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      const [resAvail, resHealth, resReport, resAudit] = await Promise.all([
        fetch('/api/v1/availability?labId=L106'),
        fetch('/api/admin/workstation-health'),
        fetch('/api/admin/analytics'),
        fetch('/api/admin/audit-logs')
      ]);

      if (resAvail.ok) setAvailability(await resAvail.json());
      if (resHealth.ok) setHealth(await resHealth.json());
      if (resReport.ok) setReport(await resReport.json());
      if (resAudit.ok) setAuditLogs(await resAudit.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    const unsubs = [
      subscribe('SLOT_UPDATED', fetchOverview),
      subscribe('workstation.status_changed', fetchOverview),
      subscribe('allocation.completed', fetchOverview),
      subscribe('TIMETABLE_CHANGED', fetchOverview),
      subscribe('OVERRIDE_CHANGED', fetchOverview)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchOverview]);

  const todayLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const workstations = availability?.workstations || [];
  const onlineCount = health?.summary?.onlineCount ?? availability?.summary?.onlineCount ?? 82;
  const totalCount = health?.summary?.totalWorkstations ?? availability?.summary?.totalWorkstations ?? 84;
  const maintCount = health?.summary?.maintenanceCount ?? (totalCount - onlineCount);
  const pendingCount = report?.waitlistCount ?? availability?.summary?.slotPendingCount ?? 0;
  const activeSessions = availability?.summary?.slotBookedCount ?? 0;
  const freeNow = availability?.summary?.slotAvailableCount ?? Math.max(0, onlineCount - activeSessions);

  const avgDailyUtil = useMemo(() => {
    const onlineWs = workstations.filter(w => w.status !== 'MAINTENANCE' && w.operational_status !== 'MAINTENANCE' && !w.is_maintenance);
    if (onlineWs.length === 0) return 0;
    const sum = onlineWs.reduce((acc, w) => acc + Number(w.daily_occupancy_pct || 0), 0);
    return Math.round(sum / onlineWs.length);
  }, [workstations]);

  const utilBand = avgDailyUtil >= 71 ? '71–99% band' : avgDailyUtil >= 50 ? '50–70% band' : '0–49% band';
  const utilBandCls =
    avgDailyUtil >= 71
      ? 'bg-[#FFEDD5] text-[#9A3412]'
      : avgDailyUtil >= 50
      ? 'bg-[#FEF3C7] text-[#B45309]'
      : 'bg-[#DCFCE7] text-[#15803D]';

  const demandRatio = freeNow > 0 ? ((pendingCount + activeSessions) / Math.max(1, freeNow)).toFixed(2) : '0.00';

  const blockRows = useMemo(() => {
    const isA = blockTab === 'A';
    const expected = isA ? 6 : 4;
    const map = {};
    for (let r = 1; r <= expected; r++) map[r] = [];
    workstations
      .filter(w => (w.block_code || 'A') === blockTab)
      .forEach(w => {
        const r = Number(w.row_num) || 1;
        if (!map[r]) map[r] = [];
        map[r].push(w);
      });
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.seat_num || 0) - (b.seat_num || 0)));
    return map;
  }, [workstations, blockTab]);

  const maintAlerts = useMemo(
    () =>
      workstations
        .filter(
          w =>
            w.status === 'MAINTENANCE' ||
            w.operational_status === 'MAINTENANCE' ||
            w.hardware_state === 'MAINTENANCE' ||
            Boolean(w.is_maintenance) ||
            w.status === 'OFFLINE'
        )
        .slice(0, 4),
    [workstations]
  );

  return (
    <div className="flex flex-col w-full gap-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Lab overview
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            L-106 · {totalCount} workstations · {todayLabel}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]">
            <span className="w-2 h-2 rounded-full bg-[#15803D] animate-pulse" />
            Autonomous Engine: Active
          </span>
          <button
            type="button"
            onClick={async () => {
              try {
                await fetch('/api/admin/autonomous-engine/trigger', { method: 'POST' });
                fetchOverview();
              } catch {}
            }}
            className="h-9 px-3.5 rounded-xl bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#0F172A] font-semibold text-xs shadow-xs transition-colors flex items-center gap-1.5"
            title="Force immediate evaluation cycle across all active queues"
          >
            <span className="material-symbols-outlined text-[15px]">sync</span>
            <span>Trigger cycle</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Lab utilization today</span>
          <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1.5">
            {loading ? '—' : `${avgDailyUtil}%`}
          </div>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold mt-2.5 ${utilBandCls}`}>
            {utilBand}
          </span>
        </div>

        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Fairness allocation</span>
          <div className="text-[28px] font-bold text-[#0F172A] leading-tight mt-1.5">
            Autonomous
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCFCE7] text-[#15803D] mt-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#15803D]" />
            Zero admin delay
          </span>
        </div>

        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Workstations online</span>
          <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1.5">
            {loading ? '—' : `${onlineCount} / ${totalCount}`}
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCFCE7] text-[#15803D] mt-2.5">
            {maintCount} maintenance
          </span>
        </div>

        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Booked in current slot</span>
          <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1.5">
            {loading ? '—' : activeSessions}
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F1F5F9] text-[#475569] mt-2.5">
            {freeNow} available now
          </span>
        </div>
      </section>

      {/* Middle Split: Daily Utilization Heatmap (8 cols) + Allocation Queue Summary (4 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        <div className="xl:col-span-8 fl-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-[14px] font-bold text-[#0F172A]">
                Block {blockTab} · daily utilization
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Each cell = % of bookable minutes booked today
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F1F5F9] text-xs font-semibold">
              <button
                type="button"
                onClick={() => setBlockTab('A')}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  blockTab === 'A' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B]'
                }`}
              >
                Block A · 60
              </button>
              <button
                type="button"
                onClick={() => setBlockTab('B')}
                className={`px-3 py-1 rounded-lg transition-colors ${
                  blockTab === 'B' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B]'
                }`}
              >
                Block B · 24
              </button>
            </div>
          </div>

          <div className="space-y-2 overflow-x-auto pb-1">
            {Object.entries(blockRows).map(([rowNum, seats]) => (
              <div
                key={rowNum}
                className={`flex items-center gap-2 ${blockTab === 'A' ? 'min-w-[540px]' : 'min-w-[340px] max-w-[62%]'}`}
              >
                <span className="w-6 text-[11px] font-medium text-[#94A3B8] shrink-0">R{rowNum}</span>
                <div className={`grid gap-2 flex-1 ${blockTab === 'A' ? 'grid-cols-10' : 'grid-cols-6'}`}>
                  {seats.map(ws => {
                    const isMaint = ws.status === 'MAINTENANCE' || ws.status === 'OFFLINE';
                    const pct = Math.round(Number(ws.daily_occupancy_pct || 0));
                    return (
                      <button
                        key={ws.machine_id}
                        type="button"
                        onClick={() => onNavigate('admin-workstations')}
                        title={`${ws.display_label || ws.machine_id}: ${isMaint ? 'Offline / Maintenance' : `${pct}% daily utilization`}`}
                        className={`h-10 rounded-lg border text-[11.5px] font-semibold tabular-nums flex items-center justify-center transition-transform hover:scale-[1.03] ${heatmapCellClass(pct, isMaint)}`}
                      >
                        {isMaint ? '—' : `${pct}%`}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Exact Legend */}
          <div className="mt-5 flex flex-wrap items-center gap-4 text-[11px] text-[#64748B]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#DCFCE7] border border-[#BBF7D0]" />0–49%</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#FEF3C7] border border-[#FDE68A]" />50–70%</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#FFEDD5] border border-[#FDBA74]" />71–99%</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#DC2626]" />100%</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#F1F5F9] border border-[#E2E8F0]" />Offline / maintenance</span>
          </div>
        </div>

        {/* Right: Allocation Queue Card */}
        <div className="xl:col-span-4 fl-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-[#0F172A]">Autonomous fairness engine</h2>
              <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" title="Engine actively auto-allocating" />
            </div>
            <p className="text-xs text-[#64748B] mt-0.5">Self-governing contention resolution</p>

            <div className="mt-6 space-y-5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[#475569]">Contention requests in queue</span>
                <strong className="text-base font-bold text-[#0F172A] tabular-nums">{pendingCount}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#475569]">Available workstations</span>
                <strong className="text-base font-bold text-[#0F172A] tabular-nums">{freeNow}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#475569]">Contention ratio D</span>
                <strong className="text-base font-bold text-[#0F172A] font-mono tabular-nums">{demandRatio}</strong>
              </div>
            </div>

            <div className="mt-5 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] text-[#475569] leading-relaxed">
              Queued requests resolve automatically by institutional fairness formula <strong className="font-mono text-[#4F46E5]">P = max(10, 100 - 5T - 8H)</strong> without requiring manual admin approval.
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('admin-allocation')}
            className="mt-6 w-full h-10 rounded-xl bg-[#F8FAFC] hover:bg-[#EEF2FF] border border-[#E2E8F0] text-xs font-semibold text-[#4F46E5] transition-colors"
          >
            Inspect allocation telemetry &amp; history
          </button>
        </div>
      </section>

      {/* Bottom Split: Maintenance & System Alerts (8 cols) + Recent Audit Activity (4 cols) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        <div className="xl:col-span-8 fl-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-bold text-[#0F172A]">Workstation alerts &amp; maintenance</h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Live offline workstations · hardware telemetry agents are planned future work (no synthetic readings)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('admin-workstations')}
              className="text-xs font-semibold text-[#4F46E5] hover:text-[#4338CA]"
            >
              Manage
            </button>
          </div>

          <div className="divide-y divide-[#F1F5F9]">
            {maintAlerts.length === 0 ? (
              <div className="py-6 text-xs text-[#64748B]">All 84 workstations are online and bookable.</div>
            ) : (
              maintAlerts.map(ws => (
                <div key={ws.machine_id} className="py-3.5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-bold text-[#0F172A] font-mono">
                      {ws.display_label || ws.machine_id}
                    </div>
                    <div className="text-xs text-[#64748B] mt-0.5">
                      Block {ws.block_code || 'A'} · Row {ws.row_num || 1} · Marked offline for scheduled maintenance
                    </div>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FEF3C7] text-[#B45309]">
                    Maintenance
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="xl:col-span-4 fl-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[14px] font-bold text-[#0F172A]">Recent audit activity</h2>
              <p className="text-xs text-[#64748B] mt-0.5">Append-only log</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('admin-audit')}
              className="text-xs font-semibold text-[#4F46E5] hover:text-[#4338CA]"
            >
              View all
            </button>
          </div>

          <div className="space-y-4">
            {auditLogs.slice(0, 4).map(log => (
              <div key={log.log_id}>
                <div className="text-xs font-semibold text-[#0F172A] truncate">{log.action}</div>
                <div className="text-[11px] text-[#64748B] mt-0.5 truncate">
                  {log.actor_name} · {new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

