import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

export default function AdminWorkstationsView() {
  const { currentUser, profile } = useAuth();
  const { subscribe } = useSocket();
  const isAdmin = profile?.user?.role === 'admin';

  const [workstations, setWorkstations] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);

  const fetchWorkstations = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/availability?labId=L106');
      if (res.ok) {
        const data = await res.json();
        setWorkstations(data.workstations || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchWorkstations();
  }, [fetchWorkstations]);

  useEffect(() => {
    const unsubs = [
      subscribe('workstation.status_changed', fetchWorkstations),
      subscribe('SLOT_UPDATED', fetchWorkstations)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchWorkstations]);

  const checkIsMaintenance = (ws) => {
    return ws.status === 'MAINTENANCE' ||
           ws.operational_status === 'MAINTENANCE' ||
           ws.hardware_state === 'MAINTENANCE' ||
           Boolean(ws.is_maintenance);
  };

  const handleToggleMaintenance = async (ws) => {
    const isCurrentlyMaint = checkIsMaintenance(ws);
    const nextMaint = !isCurrentlyMaint;
    const res = await fetch('/api/admin/workstation/toggle-maintenance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
      body: JSON.stringify({ machineId: ws.machine_id, isMaintenance: nextMaint })
    });
    const data = await res.json();
    if (res.ok) {
      setBanner({
        type: 'success',
        text: nextMaint
          ? `${ws.display_label || ws.machine_id} placed in maintenance.${data.reallocatedCount ? ` Automatically reallocated ${data.reallocatedCount} active booking(s).` : ''}`
          : `${ws.display_label || ws.machine_id} restored to online pool.`
      });
      await fetchWorkstations();
    } else {
      setBanner({ type: 'error', text: data.error || 'Admin permission required (HTTP 403).' });
    }
  };

  const counts = useMemo(() => {
    const maint = workstations.filter(checkIsMaintenance).length;
    const offline = workstations.filter(w => w.status === 'OFFLINE' || w.operational_status === 'OFFLINE').length;
    const online = Math.max(0, workstations.length - maint - offline);
    const blockA = workstations.filter(w => (w.block_code || 'A') === 'A').length;
    const blockB = workstations.filter(w => w.block_code === 'B').length;
    return { total: workstations.length, online, offline, maint, attention: offline + maint, blockA, blockB };
  }, [workstations]);

  const filtered = useMemo(() => {
    if (filter === 'A') return workstations.filter(w => (w.block_code || 'A') === 'A');
    if (filter === 'B') return workstations.filter(w => w.block_code === 'B');
    if (filter === 'ATTENTION') return workstations.filter(w => checkIsMaintenance(w) || w.status === 'OFFLINE');
    return workstations;
  }, [workstations, filter]);

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header Row (Exact 09_admin_workstations.png) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Workstations
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            {counts.total || 84} systems · inventory, availability &amp; maintenance windows
          </p>
        </div>

        <button
          type="button"
          onClick={() => setFilter('ATTENTION')}
          className="h-10 px-4 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors self-start sm:self-auto"
        >
          View maintenance ({counts.attention})
        </button>
      </div>

      {!isAdmin && (
        <div className="px-4 py-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] text-xs text-[#92400E]">
          Read-only view: switch to <strong>Dr. A. K. Sharma (Admin)</strong> from the bottom-left profile menu to toggle maintenance states.
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

      {/* 4 Status KPI Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Online</span>
          <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1">{counts.online}</div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#DCFCE7] text-[#15803D] mt-2">
            ONLINE
          </span>
        </div>
        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Offline</span>
          <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1">{counts.offline}</div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#FEE2E2] text-[#DC2626] mt-2">
            OFFLINE
          </span>
        </div>
        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Maintenance</span>
          <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1">{counts.maint}</div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#FEF3C7] text-[#B45309] mt-2">
            MAINTENANCE
          </span>
        </div>
        <div className="fl-card p-5">
          <span className="text-xs text-[#64748B]">Unknown</span>
          <div className="text-[32px] font-bold text-[#0F172A] tabular-nums leading-tight mt-1">0</div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#F1F5F9] text-[#64748B] mt-2">
            UNKNOWN
          </span>
        </div>
      </section>

      {/* Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'ALL', label: `All · ${counts.total}` },
          { id: 'A', label: `Block A · ${counts.blockA}` },
          { id: 'B', label: `Block B · ${counts.blockB}` },
          { id: 'ATTENTION', label: `Needs attention · ${counts.attention}` }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`h-8 px-4 rounded-full text-xs font-semibold transition-colors ${
              filter === tab.id
                ? 'bg-[#4F46E5] text-white'
                : 'bg-white border border-[#E5E7EB] text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Inventory & Telemetry Table (Honest "—" for telemetry, exact 09_admin_workstations.png) */}
      <section className="fl-card overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F1F5F9]">
          <h2 className="text-[14px] font-bold text-[#0F172A]">Inventory &amp; telemetry</h2>
        </div>

        {loading ? (
          <div className="p-6 space-y-2.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-11 rounded-xl bg-[#F1F5F9] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9] bg-white sticky top-0">
                <tr>
                  <th className="py-3 px-6 font-medium">Workstation</th>
                  <th className="py-3 px-4 font-medium">Block / Row</th>
                  <th className="py-3 px-4 font-medium">Hardware state</th>
                  <th className="py-3 px-4 font-medium">GPU util</th>
                  <th className="py-3 px-4 font-medium">VRAM</th>
                  <th className="py-3 px-4 font-medium">Temp</th>
                  <th className="py-3 px-4 font-medium">Today</th>
                  <th className="py-3 px-6 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
                {filtered.map(ws => {
                  const isMaint = checkIsMaintenance(ws);
                  const slotSt = (ws.slot_status || 'AVAILABLE').toUpperCase();
                  const todayPill = isMaint
                    ? { label: 'Maintenance', cls: 'bg-[#FEF3C7] text-[#B45309]' }
                    : slotSt === 'BOOKED'
                    ? { label: 'Booked', cls: 'bg-[#FEE2E2] text-[#DC2626]' }
                    : slotSt === 'PENDING'
                    ? { label: 'Pending', cls: 'bg-[#FEF3C7] text-[#B45309]' }
                    : { label: 'Available', cls: 'bg-[#DCFCE7] text-[#15803D]' };

                  return (
                    <tr key={ws.machine_id} className="hover:bg-[#F8FAFC]">
                      <td className="py-3.5 px-6 font-bold text-[#0F172A] font-mono">
                        {ws.display_label || ws.machine_id}
                      </td>
                      <td className="py-3.5 px-4 text-[#475569]">
                        Block {ws.block_code || 'A'} · R{ws.row_num || 1}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            isMaint ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#DCFCE7] text-[#15803D]'
                          }`}
                        >
                          {isMaint ? 'MAINTENANCE' : 'ONLINE'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-[#94A3B8] font-mono">—</td>
                      <td className="py-3.5 px-4 text-[#94A3B8] font-mono">—</td>
                      <td className="py-3.5 px-4 text-[#94A3B8] font-mono">—</td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${todayPill.cls}`}>
                          {todayPill.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleMaintenance(ws)}
                          className={`h-7 px-3 rounded-lg text-[11px] font-semibold border transition-colors ${
                            isMaint
                              ? 'bg-[#DCFCE7] border-[#BBF7D0] text-[#15803D] hover:bg-[#BBF7D0]'
                              : 'bg-white border-[#E2E8F0] text-[#475569] hover:border-[#FCA5A5] hover:text-[#DC2626]'
                          }`}
                          title={isMaint ? 'Restore workstation to available online pool' : 'Place workstation in maintenance mode'}
                        >
                          {isMaint ? 'Mark online' : 'Maintenance'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="m-4 px-4 py-3 rounded-xl bg-[#EEF2FF] text-[#4338CA] text-xs font-medium">
          When NVIDIA-SMI telemetry agents are not connected (planned future work), readings show &ldquo;—&rdquo;. FairLab never fabricates GPU data.
        </div>
      </section>
    </div>
  );
}

