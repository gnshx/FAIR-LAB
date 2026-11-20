import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

const WEEKDAYS = [
  { id: 1, short: 'Mon', name: 'Monday' },
  { id: 2, short: 'Tue', name: 'Tuesday' },
  { id: 3, short: 'Wed', name: 'Wednesday' },
  { id: 4, short: 'Thu', name: 'Thursday' },
  { id: 5, short: 'Fri', name: 'Friday' },
  { id: 6, short: 'Sat', name: 'Saturday' },
  { id: 0, short: 'Sun', name: 'Sunday' }
];

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function AdminScheduleView() {
  const { currentUser, profile } = useAuth();
  const { subscribe } = useSocket();
  const isAdmin = profile?.user?.role === 'admin';

  const [tab, setTab] = useState('TIMETABLE'); // TIMETABLE | OVERRIDES | TICKETS
  const [timetable, setTimetable] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [releases, setReleases] = useState([]);
  const [requireTicketRelease, setRequireTicketRelease] = useState(false);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);

  // Timetable Form
  const [ttForm, setTtForm] = useState({
    dayOfWeek: 1,
    startTime: '10:00',
    endTime: '12:00',
    courseCode: 'CS202',
    title: 'Operating Systems Lab',
    instructor: 'Dr. A. K. Sharma'
  });

  // Override Form (Holiday / Extra Day / Custom Hours)
  const [ovrForm, setOvrForm] = useState({
    overrideDate: getTodayStr(),
    overrideType: 'HOLIDAY',
    openTime: '09:00',
    closeTime: '18:00',
    ignoreTimetable: true,
    reason: 'Institute Holiday'
  });

  // Ticket Release Form
  const [relForm, setRelForm] = useState({
    releaseDate: getTodayStr(),
    startTime: '09:00',
    endTime: '18:00',
    title: 'Lab L-106 Open Access Tickets',
    totalTickets: 84,
    status: 'RELEASED'
  });

  const [bulkDaysInput, setBulkDaysInput] = useState(7);

  const coverageDays = useMemo(() => {
    const today = getTodayStr();
    const days = [];
    const relList = Array.isArray(releases) ? releases : [];
    const ovrList = Array.isArray(overrides) ? overrides : [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().split('T')[0];
      const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
      const formattedDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);

      const rel = relList.find(r => r && r.release_date === iso);
      const ovr = ovrList.find(o => o && o.override_date === iso);

      days.push({
        iso,
        dayName,
        formattedDate,
        isToday: i === 0,
        release: rel,
        override: ovr
      });
    }
    return days;
  }, [releases, overrides]);

  const fetchSchedule = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/schedule-overview');
      if (res.ok) {
        const data = await res.json();
        setTimetable(data.timetable || []);
        setOverrides(data.overrides || []);
        setReleases(data.ticketReleases || []);
        setRequireTicketRelease(Boolean(data.requireTicketRelease));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchSchedule();
  }, [fetchSchedule]);

  useEffect(() => {
    const unsubs = [
      subscribe('SLOT_UPDATED', fetchSchedule),
      subscribe('TIMETABLE_CHANGED', fetchSchedule),
      subscribe('OVERRIDE_CHANGED', fetchSchedule),
      subscribe('TICKET_RELEASE_CHANGED', fetchSchedule)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchSchedule]);

  const adminHeaders = { 'Content-Type': 'application/json', 'x-user-id': currentUser };

  // --- Timetable Actions ---
  const handleAddTimetable = async (e) => {
    e.preventDefault();
    setBanner(null);
    const res = await fetch('/api/admin/timetable', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        ...ttForm,
        dayOfWeek: Number(ttForm.dayOfWeek)
      })
    });
    const d = await res.json();
    if (res.ok) {
      setBanner({ type: 'success', text: `Added academic lab class: ${d.course_code ? `${d.course_code} · ` : ''}${d.title} (${d.start_time}–${d.end_time}).` });
      await fetchSchedule();
    } else {
      setBanner({ type: 'error', text: d.error || 'Could not add timetable entry.' });
    }
  };

  const handleToggleTimetable = async (entry) => {
    const res = await fetch(`/api/admin/timetable/${entry.entry_id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ isActive: !entry.is_active })
    });
    const d = await res.json();
    if (res.ok) {
      setBanner({ type: 'success', text: `${entry.title} ${entry.is_active ? 'paused (students may book)' : 'activated (blocked for class)'}.` });
      await fetchSchedule();
    } else {
      setBanner({ type: 'error', text: d.error || 'Admin permission required.' });
    }
  };

  const handleDeleteTimetable = async (entryId) => {
    const res = await fetch(`/api/admin/timetable/${entryId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': currentUser }
    });
    if (res.ok) {
      setBanner({ type: 'success', text: 'Academic lab block removed from weekly timetable.' });
      await fetchSchedule();
    } else {
      const d = await res.json();
      setBanner({ type: 'error', text: d.error || 'Could not delete timetable block.' });
    }
  };

  // --- Date Override Actions ---
  const handleSaveOverride = async (e) => {
    e.preventDefault();
    setBanner(null);
    const res = await fetch('/api/admin/date-overrides', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        overrideDate: ovrForm.overrideDate,
        overrideType: ovrForm.overrideType,
        isOpen: ovrForm.overrideType !== 'HOLIDAY',
        openTime: ovrForm.overrideType === 'HOLIDAY' ? null : ovrForm.openTime,
        closeTime: ovrForm.overrideType === 'HOLIDAY' ? null : ovrForm.closeTime,
        ignoreTimetable: Boolean(ovrForm.ignoreTimetable),
        reason: ovrForm.reason
      })
    });
    const d = await res.json();
    if (res.ok) {
      setBanner({ type: 'success', text: `Saved ${d.override_type} override for ${d.override_date} (${d.reason}).` });
      await fetchSchedule();
    } else {
      setBanner({ type: 'error', text: d.error || 'Could not save date override.' });
    }
  };

  const handleDeleteOverride = async (dateStr) => {
    const res = await fetch(`/api/admin/date-overrides/${dateStr}`, {
      method: 'DELETE',
      headers: { 'x-user-id': currentUser }
    });
    if (res.ok) {
      setBanner({ type: 'success', text: `Removed date override for ${dateStr}.` });
      await fetchSchedule();
    } else {
      const d = await res.json();
      setBanner({ type: 'error', text: d.error || 'Could not remove override.' });
    }
  };

  // --- Ticket Release Actions ---
  const handleToggleTicketMode = async () => {
    const next = !requireTicketRelease;
    const res = await fetch('/api/admin/ticket-release-mode', {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ requireTicketRelease: next })
    });
    const d = await res.json();
    if (res.ok) {
      setRequireTicketRelease(next);
      setBanner({
        type: 'success',
        text: next
          ? 'Ticket-Release Gate ENABLED: Students can only book dates/windows with an active Released ticket drop.'
          : 'Ticket-Release Gate DISABLED: Students can book any open date (released ticket quotas still apply when configured).'
      });
    } else {
      setBanner({ type: 'error', text: d.error || 'Admin permission required.' });
    }
  };

  const handleCreateRelease = async (e) => {
    e.preventDefault();
    setBanner(null);
    const res = await fetch('/api/admin/ticket-releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        ...relForm,
        totalTickets: Number(relForm.totalTickets)
      })
    });
    const d = await res.json();
    if (res.ok) {
      setBanner({ type: 'success', text: `Released ${d.total_tickets} tickets for ${d.release_date} (${d.start_time}–${d.end_time}).` });
      await fetchSchedule();
    } else {
      setBanner({ type: 'error', text: d.error || 'Could not release tickets.' });
    }
  };

  const handleBulkRelease = async (days = 5) => {
    setBanner(null);
    const numDays = Math.max(1, Math.min(60, Number(days) || 5));
    const res = await fetch('/api/admin/ticket-releases/bulk', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ days: numDays, totalTickets: 84, startTime: '09:00', endTime: '18:00' })
    });
    const d = await res.json();
    if (res.ok) {
      setBanner({
        type: 'success',
        text: `Bulk release complete: ${d.createdCount > 0 ? `opened tickets for ${d.createdCount} new day(s)` : `all ${numDays} upcoming day(s) already have active ticket drops`}.`
      });
      await fetchSchedule();
    } else {
      setBanner({ type: 'error', text: d.error || 'Bulk ticket release failed.' });
    }
  };

  const handleQuickReleaseForDate = async (isoDate) => {
    setBanner(null);
    const res = await fetch('/api/admin/ticket-releases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        releaseDate: isoDate,
        startTime: '09:00',
        endTime: '18:00',
        title: `Lab L-106 Open Access Tickets (${isoDate})`,
        totalTickets: 84,
        status: 'RELEASED'
      })
    });
    const d = await res.json();
    if (res.ok) {
      setBanner({ type: 'success', text: `Released 84 tickets for ${isoDate} (09:00–18:00).` });
      await fetchSchedule();
    } else {
      setBanner({ type: 'error', text: d.error || 'Could not release tickets.' });
    }
  };

  const handlePatchRelease = async (releaseId, status) => {
    const res = await fetch(`/api/admin/ticket-releases/${releaseId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      setBanner({ type: 'success', text: `Ticket release status updated to ${status}.` });
      await fetchSchedule();
    } else {
      const d = await res.json();
      setBanner({ type: 'error', text: d.error || 'Could not update release.' });
    }
  };

  const handleDeleteRelease = async (releaseId) => {
    const res = await fetch(`/api/admin/ticket-releases/${releaseId}`, {
      method: 'DELETE',
      headers: { 'x-user-id': currentUser }
    });
    if (res.ok) {
      setBanner({ type: 'success', text: 'Ticket release deleted.' });
      await fetchSchedule();
    }
  };

  const fieldCls =
    'w-full h-10 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-medium text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5] tabular-nums';

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Schedule &amp; ticket releases
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            Manage Mon–Fri academic lab classes, holidays / extra days, and student ticket drops (strict 2 hr max / booking)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <div className="inline-flex items-center rounded-xl border border-[#E2E8F0] bg-white p-1 shadow-sm">
            <span className="text-[11px] font-semibold text-[#64748B] px-2.5">Release tickets:</span>
            {[
              { days: 5, label: '5 Days' },
              { days: 7, label: '7 Days' },
              { days: 14, label: '14 Days' },
              { days: 30, label: '30 Days' }
            ].map(p => (
              <button
                key={p.days}
                type="button"
                onClick={() => handleBulkRelease(p.days)}
                className="h-8 px-2.5 rounded-lg text-xs font-semibold text-[#4F46E5] hover:bg-[#EEF2FF] transition-colors"
                title={`Release 84 tickets per day for next ${p.days} days`}
              >
                +{p.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white p-1 shadow-sm">
            <input
              type="number"
              min="1"
              max="60"
              value={bulkDaysInput}
              onChange={(e) => setBulkDaysInput(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="w-12 h-8 px-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-bold text-center text-[#0F172A] outline-none focus:border-[#4F46E5]"
              title="Number of upcoming days to release"
            />
            <button
              type="button"
              onClick={() => handleBulkRelease(bulkDaysInput)}
              className="h-8 px-3 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[15px]">confirmation_number</span>
              <span>Release Days</span>
            </button>
          </div>
        </div>
      </div>

      {!isAdmin && (
        <div className="px-4 py-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] text-xs text-[#92400E]">
          Read-only view: switch to <strong>Dr. A. K. Sharma (Admin)</strong> from the bottom-left profile menu to edit timetable, holidays, or ticket releases.
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

      {/* Section Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'TIMETABLE', label: `Mon–Fri Academic Timetable · ${(Array.isArray(timetable) ? timetable : []).filter(t => t?.is_active).length}` },
          { id: 'OVERRIDES', label: `Holidays & Extra Days · ${(Array.isArray(overrides) ? overrides : []).length}` },
          { id: 'TICKETS', label: `Ticket Releases · ${(Array.isArray(releases) ? releases : []).filter(r => r?.status === 'RELEASED').length}` }
        ].map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`h-8 px-4 rounded-full text-xs font-semibold transition-colors ${
              tab === item.id
                ? 'bg-[#4F46E5] text-white'
                : 'bg-white border border-[#E5E7EB] text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* TAB 1: MON–FRI ACADEMIC LAB TIMETABLE */}
      {tab === 'TIMETABLE' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* Weekly Schedule Grid (8 cols) */}
          <section className="xl:col-span-8 fl-card p-6">
            <div className="mb-4">
              <h2 className="text-[14px] font-bold text-[#0F172A]">Weekly academic lab timetable</h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Active class blocks automatically prevent student workstation bookings during scheduled IIT Bhilai lab courses
              </p>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-14 rounded-xl bg-[#F1F5F9] animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {WEEKDAYS.slice(0, 5).map(day => {
                  const dayEntries = (Array.isArray(timetable) ? timetable : []).filter(t => t && Number(t.day_of_week) === day.id);
                  return (
                    <div key={day.id} className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="text-xs font-bold text-[#0F172A]">{day.name}</span>
                        <span className="text-[11px] text-[#64748B]">
                          {dayEntries.length === 0 ? 'Fully open for bookings' : `${dayEntries.length} academic block(s)`}
                        </span>
                      </div>
                      {dayEntries.length === 0 ? (
                        <p className="text-xs text-[#94A3B8]">No general lab classes scheduled.</p>
                      ) : (
                        <div className="space-y-2">
                          {dayEntries.map(entry => (
                            <div
                              key={entry.entry_id}
                              className="p-3 rounded-xl bg-white border border-[#E5E7EB] flex flex-wrap items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-mono font-bold text-[#4F46E5] tabular-nums">
                                    {entry.start_time} – {entry.end_time}
                                  </span>
                                  {entry.course_code && (
                                    <span className="px-2 py-0.5 rounded-md bg-[#EEF2FF] text-[#4338CA] text-[10.5px] font-bold font-mono">
                                      {entry.course_code}
                                    </span>
                                  )}
                                  <span className="text-xs font-semibold text-[#0F172A]">{entry.title}</span>
                                </div>
                                {entry.instructor && (
                                  <div className="text-[11px] text-[#64748B] mt-0.5">{entry.instructor}</div>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleTimetable(entry)}
                                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                                    entry.is_active
                                      ? 'bg-[#FEF3C7] text-[#B45309] hover:bg-[#FDE68A]'
                                      : 'bg-[#F1F5F9] text-[#64748B] hover:bg-[#E2E8F0]'
                                  }`}
                                >
                                  {entry.is_active ? 'Blocking · Active' : 'Paused'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTimetable(entry.entry_id)}
                                  className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEE2E2]/50"
                                  title="Delete class"
                                >
                                  <span className="material-symbols-outlined text-[16px]">delete</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Add Academic Class Form (4 cols) */}
          <form onSubmit={handleAddTimetable} className="xl:col-span-4 fl-card p-6 space-y-4">
            <div>
              <h2 className="text-[14px] font-bold text-[#0F172A]">Add academic lab session</h2>
              <p className="text-xs text-[#64748B] mt-0.5">Reserve Lab L-106 for weekly course labs</p>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Day of week</label>
              <select
                value={ttForm.dayOfWeek}
                onChange={(e) => setTtForm({ ...ttForm, dayOfWeek: Number(e.target.value) })}
                className={fieldCls}
              >
                {WEEKDAYS.slice(0, 5).map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Start time</label>
                <input
                  type="time"
                  value={ttForm.startTime}
                  onChange={(e) => setTtForm({ ...ttForm, startTime: e.target.value })}
                  required
                  className={fieldCls}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">End time</label>
                <input
                  type="time"
                  value={ttForm.endTime}
                  onChange={(e) => setTtForm({ ...ttForm, endTime: e.target.value })}
                  required
                  className={fieldCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Course code</label>
              <input
                type="text"
                value={ttForm.courseCode}
                onChange={(e) => setTtForm({ ...ttForm, courseCode: e.target.value })}
                placeholder="e.g. CS201"
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Lab session title</label>
              <input
                type="text"
                value={ttForm.title}
                onChange={(e) => setTtForm({ ...ttForm, title: e.target.value })}
                required
                placeholder="e.g. Deep Learning Practical"
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Instructor / Coordinator</label>
              <input
                type="text"
                value={ttForm.instructor}
                onChange={(e) => setTtForm({ ...ttForm, instructor: e.target.value })}
                placeholder="e.g. Prof. Sneha Sen"
                className={fieldCls}
              />
            </div>

            <button
              type="submit"
              className="w-full h-10 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors"
            >
              Add to Mon–Fri timetable
            </button>
          </form>
        </div>
      )}

      {/* TAB 2: HOLIDAYS, EXTRA WORKING DAYS & CUSTOM HOURS */}
      {tab === 'OVERRIDES' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          <section className="xl:col-span-8 fl-card overflow-hidden">
            <div className="px-6 py-4 border-b border-[#F1F5F9]">
              <h2 className="text-[14px] font-bold text-[#0F172A]">Date exceptions (Holidays &amp; Extra days)</h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Close the lab on holidays, open extra weekend days, or customize hours for specific dates
              </p>
            </div>

            {(Array.isArray(overrides) ? overrides : []).length === 0 ? (
              <div className="py-12 text-center text-xs text-[#64748B]">
                No holidays or extra-day overrides configured yet. Add one on the right.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                    <tr>
                      <th className="py-3 px-6 font-medium">Date</th>
                      <th className="py-3 px-4 font-medium">Type</th>
                      <th className="py-3 px-4 font-medium">Hours</th>
                      <th className="py-3 px-4 font-medium">Reason</th>
                      <th className="py-3 px-6 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
                    {(Array.isArray(overrides) ? overrides : []).map(o => {
                      const isHol = o.override_type === 'HOLIDAY';
                      return (
                        <tr key={o.override_id} className="hover:bg-[#F8FAFC]">
                          <td className="py-4 px-6 font-mono font-bold text-[#0F172A]">{o.override_date}</td>
                          <td className="py-4 px-4">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                isHol
                                  ? 'bg-[#FEE2E2] text-[#DC2626]'
                                  : o.override_type === 'EXTRA_DAY'
                                  ? 'bg-[#DCFCE7] text-[#15803D]'
                                  : 'bg-[#EEF2FF] text-[#4F46E5]'
                              }`}
                            >
                              {isHol ? 'Holiday · Closed' : o.override_type === 'EXTRA_DAY' ? 'Extra day · Open' : 'Custom hours'}
                            </span>
                          </td>
                          <td className="py-4 px-4 font-mono text-[#475569]">
                            {isHol ? 'Closed' : `${o.open_time || '09:00'} – ${o.close_time || '18:00'}`}
                            {o.ignore_timetable ? ' (No classes)' : ''}
                          </td>
                          <td className="py-4 px-4 text-[#0F172A]">{o.reason}</td>
                          <td className="py-4 px-6 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteOverride(o.override_date)}
                              className="text-xs font-semibold text-[#DC2626] hover:underline"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <form onSubmit={handleSaveOverride} className="xl:col-span-4 fl-card p-6 space-y-4">
            <div>
              <h2 className="text-[14px] font-bold text-[#0F172A]">Add holiday or extra day</h2>
              <p className="text-xs text-[#64748B] mt-0.5">Overrides standard Mon–Fri availability for one date</p>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Target date</label>
              <input
                type="date"
                min={getTodayStr()}
                value={ovrForm.overrideDate}
                onChange={(e) => setOvrForm({ ...ovrForm, overrideDate: e.target.value })}
                required
                className={fieldCls}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Override type</label>
              <select
                value={ovrForm.overrideType}
                onChange={(e) => {
                  const nextType = e.target.value;
                  setOvrForm({
                    ...ovrForm,
                    overrideType: nextType,
                    reason:
                      nextType === 'HOLIDAY'
                        ? 'Institute Holiday'
                        : nextType === 'EXTRA_DAY'
                        ? 'Extra Open Lab Day (No Regular Classes)'
                        : 'Extended Exam Preparation Hours'
                  });
                }}
                className={fieldCls}
              >
                <option value="HOLIDAY">Holiday (Close Lab L-106)</option>
                <option value="EXTRA_DAY">Extra Day (Open on Weekend / Special Day)</option>
                <option value="CUSTOM_HOURS">Custom Open / Close Hours</option>
              </select>
            </div>

            {ovrForm.overrideType !== 'HOLIDAY' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Open time</label>
                    <input
                      type="time"
                      value={ovrForm.openTime}
                      onChange={(e) => setOvrForm({ ...ovrForm, openTime: e.target.value })}
                      className={fieldCls}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Close time</label>
                    <input
                      type="time"
                      value={ovrForm.closeTime}
                      onChange={(e) => setOvrForm({ ...ovrForm, closeTime: e.target.value })}
                      className={fieldCls}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-[#334155] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ovrForm.ignoreTimetable}
                    onChange={(e) => setOvrForm({ ...ovrForm, ignoreTimetable: e.target.checked })}
                    className="rounded border-[#CBD5E1] text-[#4F46E5]"
                  />
                  <span>Cancel Mon–Fri academic classes on this date</span>
                </label>
              </>
            )}

            <div>
              <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Reason / announcement</label>
              <input
                type="text"
                value={ovrForm.reason}
                onChange={(e) => setOvrForm({ ...ovrForm, reason: e.target.value })}
                required
                className={fieldCls}
              />
            </div>

            <button
              type="submit"
              className="w-full h-10 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors"
            >
              Save date override
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: TICKET RELEASES (BOOKING WINDOWS LIKE MOVIE TICKETS) */}
      {tab === 'TICKETS' && (
        <div className="space-y-5">
          {/* Ticket Gate Mode Switch Card */}
          <div className="fl-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#0F172A]">Require admin ticket release before booking</h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    requireTicketRelease ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#F1F5F9] text-[#64748B]'
                  }`}
                >
                  {requireTicketRelease ? 'Gate Active' : 'Flexible Mode'}
                </span>
              </div>
              <p className="text-xs text-[#64748B] mt-1">
                When enabled, students can ONLY book dates and intervals where you have explicitly released tickets below (just like movie ticket drops).
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={requireTicketRelease}
              onClick={handleToggleTicketMode}
              className={`w-12 h-6 rounded-full p-0.5 flex items-center transition-colors shrink-0 ${
                requireTicketRelease ? 'bg-[#4F46E5] justify-end' : 'bg-[#CBD5E1] justify-start'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-white shadow-sm block" />
            </button>
          </div>

          {/* Upcoming 14-Day Date Coverage & Status Strip */}
          <div className="fl-card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-[#0F172A]">Upcoming 14-Day Ticket Coverage</h3>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#EEF2FF] text-[#4F46E5] border border-[#E0E7FF]">
                    {coverageDays.filter(d => d.release && d.release.status === 'RELEASED').length} of 14 Days Released
                  </span>
                </div>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Live calendar status: See exactly which upcoming dates have active ticket drops. Click “+ Release” on any unreleased day to open it immediately.
                </p>
              </div>

              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <span className="text-[11px] font-medium text-[#64748B]">Quick extend:</span>
                <button
                  type="button"
                  onClick={() => handleBulkRelease(7)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F8FAFC] hover:bg-[#EEF2FF] border border-[#E2E8F0] text-[#4F46E5] transition-colors"
                >
                  + Next 7 Days
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkRelease(14)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F8FAFC] hover:bg-[#EEF2FF] border border-[#E2E8F0] text-[#4F46E5] transition-colors"
                >
                  + Next 14 Days
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
              {coverageDays.map(d => {
                const isReleased = d.release && d.release.status === 'RELEASED';
                const isPaused = d.release && d.release.status === 'PAUSED';
                const isHoliday = d.override && d.override.override_type === 'HOLIDAY';

                return (
                  <div
                    key={d.iso}
                    className={`p-3 rounded-xl border flex flex-col justify-between transition-all ${
                      isReleased
                        ? 'bg-[#F0FDF4] border-[#BBF7D0]'
                        : isPaused
                        ? 'bg-[#FEFCE8] border-[#FEF08A]'
                        : isHoliday
                        ? 'bg-[#FEF2F2] border-[#FECACA]'
                        : 'bg-[#F8FAFC] border-[#E2E8F0]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">{d.dayName}</span>
                        {d.isToday && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-[#4F46E5] text-white">
                            Today
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-[#0F172A] mt-1 font-mono">{d.formattedDate}</div>
                      <div className="text-[10px] text-[#94A3B8] font-mono">{d.iso}</div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-black/5">
                      {isHoliday ? (
                        <div className="text-[10.5px] font-semibold text-[#DC2626] flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">block</span>
                          <span>Holiday</span>
                        </div>
                      ) : isReleased ? (
                        <div className="space-y-0.5">
                          <div className="text-[10.5px] font-bold text-[#15803D] flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                            <span>Released</span>
                          </div>
                          <div className="text-[10px] text-[#166534] font-mono font-medium">
                            {d.release.remaining_tickets} / {d.release.total_tickets} left
                          </div>
                        </div>
                      ) : isPaused ? (
                        <div className="space-y-1">
                          <div className="text-[10.5px] font-semibold text-[#B45309] flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">pause_circle</span>
                            <span>Paused</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handlePatchRelease(d.release.release_id, 'RELEASED')}
                            className="w-full py-0.5 rounded text-[10px] font-bold bg-[#DCFCE7] text-[#15803D] hover:bg-[#BBF7D0]"
                          >
                            Resume
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="text-[10px] text-[#94A3B8] font-medium">Not released</div>
                          <button
                            type="button"
                            onClick={() => handleQuickReleaseForDate(d.iso)}
                            className="w-full py-1 rounded-lg text-[10.5px] font-bold bg-[#4F46E5] hover:bg-[#4338CA] text-white transition-colors shadow-sm flex items-center justify-center gap-0.5"
                          >
                            <span className="material-symbols-outlined text-[12px]">add</span>
                            <span>Release</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            {/* Ticket Drops Table (8 cols) */}
            <section className="xl:col-span-8 fl-card overflow-hidden">
              <div className="px-6 py-4 border-b border-[#F1F5F9]">
                <h2 className="text-[14px] font-bold text-[#0F172A]">Released ticket windows</h2>
                <p className="text-xs text-[#64748B] mt-0.5">Live claimed vs remaining tickets per drop</p>
              </div>

              {(Array.isArray(releases) ? releases : []).length === 0 ? (
                <div className="py-12 text-center text-xs text-[#64748B]">
                  No ticket releases created yet. Release a day or window on the right.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[11px] font-medium text-[#94A3B8] border-b border-[#F1F5F9]">
                      <tr>
                        <th className="py-3 px-6 font-medium">Date &amp; Window</th>
                        <th className="py-3 px-4 font-medium">Release title</th>
                        <th className="py-3 px-4 font-medium">Tickets</th>
                        <th className="py-3 px-4 font-medium">Status</th>
                        <th className="py-3 px-6 font-medium text-right">Controls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F1F5F9] tabular-nums">
                      {(Array.isArray(releases) ? releases : []).map(rel => {
                        const pct = Math.min(100, Math.round((rel.claimed_tickets / Math.max(1, rel.total_tickets)) * 100));
                        const pill =
                          rel.status === 'RELEASED'
                            ? 'bg-[#DCFCE7] text-[#15803D]'
                            : rel.status === 'PAUSED'
                            ? 'bg-[#FEF3C7] text-[#B45309]'
                            : 'bg-[#FEE2E2] text-[#DC2626]';
                        return (
                          <tr key={rel.release_id} className="hover:bg-[#F8FAFC]">
                            <td className="py-4 px-6 whitespace-nowrap">
                              <div className="font-mono font-bold text-[#0F172A]">{rel.release_date}</div>
                              <div className="font-mono text-[11px] text-[#64748B]">
                                {rel.start_time} – {rel.end_time}
                              </div>
                            </td>
                            <td className="py-4 px-4 font-semibold text-[#0F172A]">{rel.title}</td>
                            <td className="py-4 px-4">
                              <div className="font-mono text-[11.5px] font-semibold text-[#0F172A]">
                                {rel.remaining_tickets} left <span className="text-[#94A3B8] font-normal">/ {rel.total_tickets}</span>
                              </div>
                              <div className="w-24 h-1.5 rounded-full bg-[#E5E7EB] mt-1 overflow-hidden">
                                <div className="h-full bg-[#4F46E5] rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pill}`}>
                                {rel.status}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {rel.status !== 'RELEASED' ? (
                                  <button
                                    type="button"
                                    onClick={() => handlePatchRelease(rel.release_id, 'RELEASED')}
                                    className="px-2.5 py-1 rounded-lg bg-[#DCFCE7] text-[#15803D] text-[11px] font-semibold"
                                  >
                                    Release
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handlePatchRelease(rel.release_id, 'PAUSED')}
                                    className="px-2.5 py-1 rounded-lg bg-[#FEF3C7] text-[#B45309] text-[11px] font-semibold"
                                  >
                                    Pause
                                  </button>
                                )}
                                {rel.status !== 'CLOSED' && (
                                  <button
                                    type="button"
                                    onClick={() => handlePatchRelease(rel.release_id, 'CLOSED')}
                                    className="px-2.5 py-1 rounded-lg bg-[#F1F5F9] text-[#475569] text-[11px] font-semibold"
                                  >
                                    Close
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRelease(rel.release_id)}
                                  className="p-1 text-[#94A3B8] hover:text-[#DC2626]"
                                  title="Delete release"
                                >
                                  <span className="material-symbols-outlined text-[16px]">delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Release New Tickets Form (4 cols) */}
            <form onSubmit={handleCreateRelease} className="xl:col-span-4 fl-card p-6 space-y-4">
              <div>
                <h2 className="text-[14px] font-bold text-[#0F172A]">Release new tickets</h2>
                <p className="text-xs text-[#64748B] mt-0.5">Open a bookable ticket batch for students</p>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Release date</label>
                <input
                  type="date"
                  min={getTodayStr()}
                  value={relForm.releaseDate}
                  onChange={(e) => setRelForm({ ...relForm, releaseDate: e.target.value })}
                  required
                  className={fieldCls}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Window start</label>
                  <input
                    type="time"
                    value={relForm.startTime}
                    onChange={(e) => setRelForm({ ...relForm, startTime: e.target.value })}
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Window end</label>
                  <input
                    type="time"
                    value={relForm.endTime}
                    onChange={(e) => setRelForm({ ...relForm, endTime: e.target.value })}
                    className={fieldCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Batch title</label>
                <input
                  type="text"
                  value={relForm.title}
                  onChange={(e) => setRelForm({ ...relForm, title: e.target.value })}
                  required
                  className={fieldCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Ticket quota (1 – 84 seats)</label>
                <input
                  type="number"
                  min={1}
                  max={84}
                  value={relForm.totalTickets}
                  onChange={(e) => setRelForm({ ...relForm, totalTickets: parseInt(e.target.value, 10) || 84 })}
                  className={fieldCls}
                />
              </div>

              <button
                type="submit"
                className="w-full h-10 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors"
              >
                Release tickets now
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

