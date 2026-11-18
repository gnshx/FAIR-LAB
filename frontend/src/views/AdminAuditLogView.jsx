import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';

function classifyAudit(action = '') {
  const a = action.toUpperCase();
  if (a.includes('ALLOC') || a.includes('ROUND') || a.includes('NO_SHOW')) return 'ALLOCATION';
  if (a.includes('CHECK') || a.includes('GATE') || a.includes('PASS') || a.includes('ACCESS')) return 'ACCESS';
  if (a.includes('POLICY') || a.includes('SEMESTER')) return 'POLICY';
  if (a.includes('MAINT') || a.includes('WORKSTATION') || a.includes('REALLOC')) return 'MAINTENANCE';
  return 'ALLOCATION';
}

export default function AdminAuditLogView() {
  const { subscribe } = useSocket();

  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/audit-logs');
      if (res.ok) setLogs(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const unsubs = [
      subscribe('workstation.status_changed', fetchLogs),
      subscribe('allocation.completed', fetchLogs),
      subscribe('SCORE_CHANGED', fetchLogs)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchLogs]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return logs;
    return logs.filter(l => classifyAudit(l.action) === filter);
  }, [logs, filter]);

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header Row (Exact 14_admin_audit_log.png) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Audit log
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            Append-only record of important actions
          </p>
        </div>

        <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#EEF2FF] text-[#4F46E5] text-xs font-semibold self-start sm:self-auto">
          Append-only
        </span>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'ALL', label: 'All' },
          { id: 'ALLOCATION', label: 'Allocation' },
          { id: 'ACCESS', label: 'Access' },
          { id: 'POLICY', label: 'Policy' },
          { id: 'MAINTENANCE', label: 'Maintenance' }
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

      {/* Recent Activity Table */}
      <section className="fl-card overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F1F5F9]">
          <h2 className="text-[14px] font-bold text-[#0F172A]">Recent activity</h2>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-11 rounded-xl bg-[#F1F5F9] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#64748B]">
            No audit events recorded in this category yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                <tr>
                  <th className="py-3 px-6 font-medium">Time</th>
                  <th className="py-3 px-4 font-medium">Actor</th>
                  <th className="py-3 px-4 font-medium">Action</th>
                  <th className="py-3 px-4 font-medium">Details</th>
                  <th className="py-3 px-4 font-medium">Result</th>
                  <th className="py-3 px-6 font-medium">Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
                {filtered.map(log => {
                  const isDenied = (log.action || '').toUpperCase().includes('REJECT') || (log.action || '').toUpperCase().includes('FAIL');
                  const isRetry = (log.action || '').toUpperCase().includes('RETRY');
                  const pill = isDenied
                    ? { label: 'Rejected', cls: 'bg-[#FEE2E2] text-[#DC2626]' }
                    : isRetry
                    ? { label: 'Retried', cls: 'bg-[#FEF3C7] text-[#B45309]' }
                    : { label: 'Success', cls: 'bg-[#DCFCE7] text-[#15803D]' };

                  const dt = new Date(log.created_at);
                  const timeLabel = `${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;

                  return (
                    <tr key={log.log_id} className="hover:bg-[#F8FAFC]">
                      <td className="py-4 px-6 font-semibold text-[#0F172A] whitespace-nowrap">{timeLabel}</td>
                      <td className="py-4 px-4 text-[#475569] whitespace-nowrap">{log.actor_name}</td>
                      <td className="py-4 px-4 text-[#0F172A] font-mono text-[11px] whitespace-nowrap">{log.action}</td>
                      <td className="py-4 px-4 text-[#475569] max-w-md truncate">{log.details}</td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pill.cls}`}>
                          {pill.label}
                        </span>
                      </td>
                      <td className="py-4 px-6 font-mono text-[11px] text-[#94A3B8] whitespace-nowrap">
                        {String(log.log_id || '').slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

