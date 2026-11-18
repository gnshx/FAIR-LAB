import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../context/SocketContext';

export default function AdminStudentsView() {
  const { subscribe } = useSocket();

  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const fetchStudents = useCallback(async () => {
    try {
      const res = await fetch('/api/fairness/leaderboard?limit=100');
      if (res.ok) {
        const data = await res.json();
        setStudents(data.students || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchStudents();
  }, [fetchStudents]);

  useEffect(() => {
    const unsubs = [
      subscribe('SCORE_CHANGED', fetchStudents),
      subscribe('fairness.score_updated', fetchStudents)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchStudents]);

  const filtered = useMemo(() => {
    return students.filter(st => {
      const score = Number(st.current_score ?? 100);
      const count = Number(st.booking_count ?? 0);
      if (filter === 'LOW' && score > 50) return false;
      if (filter === 'ZERO' && count > 0) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return `${st.name || ''} ${st.roll_no || ''}`.toLowerCase().includes(q);
      }
      return true;
    });
  }, [students, filter, search]);

  const handleExportCsv = () => {
    const header = ['Student', 'Roll No', 'Priority', 'Total Hours', 'High-Demand Hours', 'Allocations', 'Penalties'];
    const rows = filtered.map(s => [
      s.name || '',
      s.roll_no || '',
      s.current_score ?? 100,
      s.total_hours_used ?? 0,
      s.high_demand_hours ?? 0,
      s.booking_count ?? 0,
      s.penalty_points ?? 0
    ]);
    const csv = [header.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fairlab-students-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusPill = (st) => {
    const score = Number(st.current_score ?? 100);
    const count = Number(st.booking_count ?? 0);
    if (score <= 10) return { label: 'At floor', cls: 'bg-[#FEE2E2] text-[#DC2626]' };
    if (score <= 50) return { label: 'Low priority', cls: 'bg-[#FEF3C7] text-[#B45309]' };
    if (count === 0) return { label: 'No allocation', cls: 'bg-[#FEF9C3] text-[#A16207]' };
    return { label: 'Active', cls: 'bg-[#DCFCE7] text-[#15803D]' };
  };

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header Row (Exact 10_admin_students.png) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Students
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            Booking and fairness history per student
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="h-9 px-4 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#E5E7EB] text-xs font-semibold text-[#0F172A] transition-colors self-start sm:self-auto"
        >
          Export CSV
        </button>
      </div>

      {/* Search + Filter Pills */}
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or roll number"
          className="h-9 px-3.5 rounded-xl bg-white border border-[#E5E7EB] text-xs text-[#0F172A] outline-none focus:border-[#4F46E5] w-64 placeholder:text-[#94A3B8]"
        />
        {[
          { id: 'ALL', label: 'All' },
          { id: 'LOW', label: 'Low priority' },
          { id: 'ZERO', label: 'No allocation' }
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

      {/* Students Table */}
      <section className="fl-card overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F1F5F9]">
          <h2 className="text-[14px] font-bold text-[#0F172A]">Students</h2>
          <p className="text-xs text-[#64748B] mt-0.5">Sorted by priority</p>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-11 rounded-xl bg-[#F1F5F9] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#64748B]">
            No students match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                <tr>
                  <th className="py-3 px-6 font-medium">Student</th>
                  <th className="py-3 px-4 font-medium">Roll no.</th>
                  <th className="py-3 px-4 font-medium">Priority</th>
                  <th className="py-3 px-4 font-medium">Hours (T)</th>
                  <th className="py-3 px-4 font-medium">Peak (H)</th>
                  <th className="py-3 px-4 font-medium">Allocations</th>
                  <th className="py-3 px-4 font-medium">Penalties</th>
                  <th className="py-3 px-6 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
                {filtered.map(st => {
                  const pill = getStatusPill(st);
                  return (
                    <tr key={st.user_id} className="hover:bg-[#F8FAFC]">
                      <td className="py-4 px-6 font-semibold text-[#0F172A]">{st.name}</td>
                      <td className="py-4 px-4 text-[#475569] font-mono">{st.roll_no}</td>
                      <td className="py-4 px-4 font-bold text-[#0F172A] font-mono">{st.current_score}</td>
                      <td className="py-4 px-4 text-[#475569] font-mono">{st.total_hours_used ?? 0}h</td>
                      <td className="py-4 px-4 text-[#475569] font-mono">{st.high_demand_hours ?? 0}h</td>
                      <td className="py-4 px-4 text-[#475569] font-mono">{st.booking_count ?? 0}</td>
                      <td className="py-4 px-4 text-[#475569] font-mono">{st.penalty_points ?? 0} pts</td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pill.cls}`}>
                          {pill.label}
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
    </div>
  );
}

