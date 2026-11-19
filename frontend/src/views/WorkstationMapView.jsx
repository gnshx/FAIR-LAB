import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getInitialDateStr() {
  const now = new Date();
  if (now.getHours() >= 18) {
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return getTodayStr();
}

function getInitialTimeWindow() {
  const now = new Date();
  const currentHour = now.getHours();
  if (currentHour >= 18 || currentHour < 9) {
    return { start: '10:00', end: '12:00' };
  }
  const nextStart = Math.min(17, currentHour + 1);
  const nextEnd = Math.min(18, nextStart + 1);
  return {
    start: `${String(nextStart).padStart(2, '0')}:00`,
    end: `${String(nextEnd).padStart(2, '0')}:00`
  };
}

function calcDurationMinutes(start, end) {
  const [sh, sm] = String(start || '10:00').split(':').map(Number);
  const [eh, em] = String(end || '12:00').split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function calcDurationLabel(start, end) {
  const diff = calcDurationMinutes(start, end);
  if (diff <= 0) return 'Invalid';
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export default function WorkstationMapView({ onNavigateToPass }) {
  const { currentUser, profile, refreshProfile } = useAuth();
  const { subscribe } = useSocket();

  const [selectedDate, setSelectedDate] = useState(getInitialDateStr);
  const [startTime, setStartTime] = useState(() => getInitialTimeWindow().start);
  const [endTime, setEndTime] = useState(() => getInitialTimeWindow().end);
  const [availability, setAvailability] = useState(null);
  const [selectedMachineIds, setSelectedMachineIds] = useState([]);
  const [purpose, setPurpose] = useState('ML coursework & CUDA lab');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState('');

  const fetchAvailability = useCallback(async () => {
    try {
      setError('');
      const params = new URLSearchParams({
        labId: 'L106',
        date: selectedDate,
        start: startTime,
        end: endTime
      });
      const res = await fetch(`/api/v1/availability?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to check availability');
      setAvailability(data);
      // Prune any previously selected seat that became BOOKED or MAINTENANCE on the new interval
      const wsList = data.workstations || [];
      setSelectedMachineIds(prev =>
        prev.filter(id => {
          const found = wsList.find(w => w.machine_id === id);
          if (!found) return false;
          const st = (found.slot_status || found.status || '').toUpperCase();
          return st !== 'BOOKED' && st !== 'MAINTENANCE' && st !== 'OFFLINE';
        })
      );
    } catch (e) {
      setError(e.message || 'Unable to load Lab L-106 workstation availability.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, startTime, endTime]);

  const mapSectionRef = useRef(null);

  const handleCheckAvailability = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    await fetchAvailability();
    setTimeout(() => {
      if (mapSectionRef.current) {
        mapSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);
  };

  useEffect(() => {
    setLoading(true);
    fetchAvailability();
  }, [fetchAvailability]);

  useEffect(() => {
    const unsubs = [
      subscribe('SLOT_UPDATED', fetchAvailability),
      subscribe('booking.confirmed', fetchAvailability),
      subscribe('booking.cancelled', fetchAvailability),
      subscribe('workstation.status_changed', fetchAvailability),
      subscribe('TIMETABLE_CHANGED', fetchAvailability),
      subscribe('OVERRIDE_CHANGED', fetchAvailability),
      subscribe('TICKET_RELEASE_CHANGED', fetchAvailability)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchAvailability]);

  const allWorkstations = availability?.workstations || [];
  const blockA = useMemo(() => allWorkstations.filter(w => (w.block_code || 'A') === 'A'), [allWorkstations]);
  const blockB = useMemo(() => allWorkstations.filter(w => w.block_code === 'B'), [allWorkstations]);

  const groupRows = (list, expectedRows) => {
    const map = {};
    for (let r = 1; r <= expectedRows; r++) map[r] = [];
    list.forEach(w => {
      const r = Number(w.row_num) || 1;
      if (!map[r]) map[r] = [];
      map[r].push(w);
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => (a.seat_num || 0) - (b.seat_num || 0)));
    return map;
  };

  const rowsA = useMemo(() => groupRows(blockA, 6), [blockA]);
  const rowsB = useMemo(() => groupRows(blockB, 4), [blockB]);

  const toggleSelectSeat = (ws) => {
    const st = (ws.slot_status || ws.status || '').toUpperCase();
    if (st === 'MAINTENANCE' || st === 'OFFLINE' || st === 'BOOKED') return;

    setSelectedMachineIds(prev => {
      if (prev.includes(ws.machine_id)) {
        return prev.filter(id => id !== ws.machine_id);
      }
      if (prev.length >= 3) {
        return [...prev.slice(0, 2), ws.machine_id];
      }
      return [...prev, ws.machine_id];
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setFeedback(null);
    setError('');
    try {
      const cleanPurpose = (purpose || '').trim();
      const res = await fetch('/api/v1/booking-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser },
        body: JSON.stringify({
          bookingDate: selectedDate,
          startTime,
          endTime,
          preferredMachineId: selectedMachineIds[0] || null,
          preferredWorkstations: selectedMachineIds,
          computePurpose: cleanPurpose.length >= 3 ? cleanPurpose : 'Academic Lab Work',
          researchField: profile?.user?.department || 'Computer Science',
          allocationMode: 'AUTO'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Booking request could not be submitted.' });
      } else if (data.status === 'CONFIRMED' || data.booking?.bookingId) {
        const assignedLabel = data.booking?.displayLabel || data.booking?.machineId || 'Lab L-106';
        setFeedback({
          type: 'success',
          text: `Confirmed immediately on ${assignedLabel} (${data.startTime || startTime}–${data.endTime || endTime}). Your QR pass is ready.`,
          canOpenPass: true
        });
        setSelectedMachineIds([]);
        await fetchAvailability();
        await refreshProfile();
      } else {
        setFeedback({
          type: 'info',
          text: `Request queued for fairness allocation (${selectedDate}, ${data.startTime || startTime}–${data.endTime || endTime}). Priority snapshot: ${data.priorityScore ?? profile?.fairness?.current_score ?? 100} pts.`
        });
        setSelectedMachineIds([]);
        await fetchAvailability();
      }
    } catch (e) {
      setFeedback({ type: 'error', text: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const score = profile?.fairness?.current_score ?? 100;
  const durationMins = calcDurationMinutes(startTime, endTime);
  const durationLabel = calcDurationLabel(startTime, endTime);
  const exceedsMax2Hrs = durationMins > 120;
  const tooShort = durationMins > 0 && durationMins < 30;
  const isPastDate = selectedDate < getTodayStr();
  const isPastTime = useMemo(() => {
    if (selectedDate !== getTodayStr()) return false;
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = String(startTime || '00:00').split(':').map(Number);
    const [eh, em] = String(endTime || '00:00').split(':').map(Number);
    return (eh * 60 + em) <= curMin || (sh * 60 + sm) < curMin;
  }, [selectedDate, startTime, endTime]);
  const daySchedule = availability?.daySchedule;
  const intervalSchedule = availability?.intervalSchedule;
  const scheduleBlocked = Boolean(intervalSchedule && !intervalSchedule.allowed) || isPastDate || isPastTime;
  const matchingRelease = intervalSchedule?.matchingRelease || daySchedule?.ticketReleases?.find(r => r.status === 'RELEASED') || null;
  const selectedObjects = selectedMachineIds
    .map(id => allWorkstations.find(w => w.machine_id === id))
    .filter(Boolean);

  const freeWorkstations = useMemo(() => {
    return allWorkstations.filter(w => {
      const isMaint =
        w.status === 'MAINTENANCE' ||
        w.operational_status === 'MAINTENANCE' ||
        w.hardware_state === 'MAINTENANCE' ||
        Boolean(w.is_maintenance) ||
        w.status === 'OFFLINE';
      const isBooked =
        (w.slot_status || '').toUpperCase() === 'BOOKED' ||
        (w.slot_status || '').toUpperCase() === 'OCCUPIED';
      return !isMaint && !isBooked && w.slot_available !== false;
    });
  }, [allWorkstations]);

  const bookedSelected = useMemo(() => {
    return selectedObjects.filter(w => {
      const isMaint =
        w.status === 'MAINTENANCE' ||
        w.operational_status === 'MAINTENANCE' ||
        w.hardware_state === 'MAINTENANCE' ||
        Boolean(w.is_maintenance) ||
        w.status === 'OFFLINE';
      const isBooked =
        (w.slot_status || '').toUpperCase() === 'BOOKED' ||
        (w.slot_status || '').toUpperCase() === 'OCCUPIED';
      return isMaint || isBooked || w.slot_available === false;
    });
  }, [selectedObjects]);

  const alternativeSlots = useMemo(() => {
    if (!availability?.slots) return [];
    return availability.slots.filter(s => {
      if (s.start_time === startTime && s.end_time === endTime) return false;
      return (s.available_count || 0) > 0;
    });
  }, [availability?.slots, startTime, endTime]);

  const autoPickFreeSeats = () => {
    if (freeWorkstations.length === 0) return;
    const top3 = freeWorkstations.slice(0, 3).map(w => w.machine_id);
    setSelectedMachineIds(top3);
  };

  const replaceBookedWithFree = () => {
    const validIds = selectedMachineIds.filter(id => {
      const obj = allWorkstations.find(w => w.machine_id === id);
      if (!obj) return false;
      const isMaint =
        obj.status === 'MAINTENANCE' ||
        obj.operational_status === 'MAINTENANCE' ||
        obj.hardware_state === 'MAINTENANCE' ||
        Boolean(obj.is_maintenance) ||
        obj.status === 'OFFLINE';
      const isBooked =
        (obj.slot_status || '').toUpperCase() === 'BOOKED' ||
        (obj.slot_status || '').toUpperCase() === 'OCCUPIED';
      return !isMaint && !isBooked && obj.slot_available !== false;
    });
    const need = 3 - validIds.length;
    const availableToAdd = freeWorkstations
      .filter(w => !validIds.includes(w.machine_id))
      .slice(0, need)
      .map(w => w.machine_id);
    setSelectedMachineIds([...validIds, ...availableToAdd]);
  };

  const summary = availability?.summary;
  const bookedRatio = summary && summary.onlineCount > 0
    ? summary.slotBookedCount / summary.onlineCount
    : 0;
  const isHighDemand = bookedRatio >= 0.4 || (summary?.slotPendingCount || 0) > 0;

  const renderTile = (ws) => {
    const rankIndex = selectedMachineIds.indexOf(ws.machine_id);
    const isSelected = rankIndex !== -1;
    const st = (ws.slot_status || ws.status || 'AVAILABLE').toUpperCase();
    const numStr = String(ws.seat_num || 1).padStart(2, '0');

    let tileStyle = 'bg-[#DCFCE7] border-[#BBF7D0] text-[#15803D] hover:border-[#4ADE80] cursor-pointer';
    if (isSelected) {
      tileStyle = 'bg-[#4F46E5] border-[#4338CA] text-white cursor-pointer shadow-sm z-10';
    } else if (st === 'BOOKED') {
      tileStyle = 'bg-[#FEE2E2] border-[#FECACA] text-[#DC2626]/80 cursor-not-allowed';
    } else if (st === 'PENDING') {
      tileStyle = 'bg-[#FEF3C7] border-[#FDE68A] text-[#B45309] hover:border-[#FBBF24] cursor-pointer';
    } else if (st === 'MAINTENANCE' || st === 'OFFLINE') {
      tileStyle = 'bg-[#F1F5F9] border-[#E2E8F0] text-[#94A3B8] cursor-not-allowed';
    }

    return (
      <div
        key={ws.machine_id}
        role="button"
        tabIndex={st === 'BOOKED' || st === 'MAINTENANCE' || st === 'OFFLINE' ? -1 : 0}
        onClick={() => toggleSelectSeat(ws)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSelectSeat(ws);
          }
        }}
        title={`${ws.display_label || ws.machine_id} · ${st}`}
        className={`relative overflow-visible h-9 sm:h-[38px] rounded-lg border text-xs font-semibold tabular-nums select-none transition-all flex items-center justify-center ${tileStyle}`}
      >
        <span>{numStr}</span>
        {isSelected && (
          <span className="absolute -top-1.5 -right-1.5 w-[19px] h-[19px] rounded-full bg-[#0F172A] text-white text-[10px] font-bold flex items-center justify-center shadow-md ring-2 ring-white z-30 pointer-events-none">
            {rankIndex + 1}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full gap-5">
      {/* Page Title Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            Book a workstation
          </h1>
          <p className="text-[13px] text-[#64748B] mt-1">
            Lab L-106 · 84 GPU workstations · choose any custom interval
          </p>
        </div>

        <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-[#EEF2FF] text-[#4F46E5] text-xs font-semibold tabular-nums self-start sm:self-auto">
          Priority score {score}
        </span>
      </div>

      {/* Horizontal Interval Bar (Exact 03_student_book_workstation.png) */}
      <section className="fl-card p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5 items-end">
          <div className="lg:col-span-3">
            <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Date</label>
            <input
              type="date"
              min={getTodayStr()}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-medium text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5]"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">Start time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-medium text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5] tabular-nums"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">End time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full h-10 px-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-medium text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5] tabular-nums"
            />
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-[#64748B] mb-1.5">
              Duration <span className="text-[#4F46E5] font-semibold">(Max 2 hrs)</span>
            </label>
            <div
              className={`w-full h-10 px-3.5 rounded-xl border text-xs font-semibold flex items-center tabular-nums ${
                exceedsMax2Hrs || durationLabel === 'Invalid' || tooShort
                  ? 'bg-[#FEE2E2] border-[#FECACA] text-[#DC2626]'
                  : 'bg-[#F8FAFC] border-[#E2E8F0] text-[#0F172A]'
              }`}
            >
              {durationLabel}
            </div>
          </div>

          <div className="lg:col-span-3 flex justify-end">
            <button
              type="button"
              onClick={handleCheckAvailability}
              className="w-full lg:w-auto h-10 px-5 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-xs shadow-brand transition-colors"
            >
              Check availability
            </button>
          </div>
        </div>

        {/* Live Day Schedule, Mon–Fri Academic Timetable & Ticket Release Strip */}
        {daySchedule && (
          <div className="mt-4 pt-3.5 border-t border-[#F1F5F9] flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#0F172A]">
                {daySchedule.dayName} ({daySchedule.openTime}–{daySchedule.closeTime})
              </span>

              {!daySchedule.isOpen ? (
                <span className="px-2.5 py-0.5 rounded-full bg-[#FEE2E2] text-[#DC2626] font-semibold text-[11px]">
                  Closed · {daySchedule.closureReason || 'Holiday'}
                </span>
              ) : daySchedule.override ? (
                <span className="px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] font-semibold text-[11px]">
                  {daySchedule.override.override_type === 'EXTRA_DAY' ? 'Extra Lab Day' : 'Custom Hours'} · {daySchedule.override.reason}
                </span>
              ) : null}

              {(daySchedule.blockedSessions || []).map(cls => (
                <span
                  key={cls.entry_id}
                  className="px-2.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] font-medium text-[11px] tabular-nums"
                >
                  Academic Lab: {cls.course_code ? `${cls.course_code} ` : ''}{cls.start_time}–{cls.end_time}
                </span>
              ))}
            </div>

            <div>
              {matchingRelease ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803D] font-semibold text-[11px] tabular-nums">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                  Tickets released · {matchingRelease.remaining_tickets} / {matchingRelease.total_tickets} left
                </span>
              ) : daySchedule.requireTicketRelease ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FEE2E2] text-[#DC2626] font-semibold text-[11px]">
                  Tickets not yet released by Admin
                </span>
              ) : (
                <span className="text-[11px] text-[#64748B]">Max 2 hrs / booking · 2 hrs / day</span>
              )}
            </div>
          </div>
        )}
      </section>

      {exceedsMax2Hrs && (
        <div className="px-4 py-3 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-xs font-medium text-[#DC2626]">
          Maximum booking limit is 2 hours (120 minutes). Please shorten your time interval.
        </div>
      )}

      {!exceedsMax2Hrs && scheduleBlocked && (
        <div className="px-4 py-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] text-xs font-semibold text-[#92400E] flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">event_busy</span>
          <span>
            {isPastDate
              ? `Cannot book workstations for a past date (${selectedDate}). Please choose today or a future date.`
              : isPastTime
              ? `Requested interval (${startTime}–${endTime}) has already passed for today. Please choose an upcoming time.`
              : (intervalSchedule?.reason || 'Selected interval is unavailable.')}
          </span>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-xs text-[#DC2626] flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={fetchAvailability} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`px-4 py-3.5 rounded-xl border text-xs font-medium flex flex-wrap items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-[#DCFCE7] border-[#BBF7D0] text-[#15803D]'
              : feedback.type === 'info'
              ? 'bg-[#EEF2FF] border-[#C7D2FE] text-[#4338CA]'
              : 'bg-[#FEE2E2] border-[#FECACA] text-[#DC2626]'
          }`}
        >
          <span>{feedback.text}</span>
          <div className="flex items-center gap-2">
            {feedback.canOpenPass && onNavigateToPass && (
              <button
                type="button"
                onClick={onNavigateToPass}
                className="px-3 py-1 rounded-lg bg-[#15803D] text-white font-semibold"
              >
                View QR pass
              </button>
            )}
            <button type="button" onClick={() => setFeedback(null)} className="opacity-70 hover:opacity-100">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Split: 84-Seat Map (8 cols) + Your Preferences Sidebar (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {/* Workstation Map Card */}
        <section ref={mapSectionRef} className="xl:col-span-8 fl-card p-5 scroll-mt-3">
          <div className="mb-3">
            <h2 className="text-[15px] font-bold text-[#0F172A]">Workstation map</h2>
            <p className="text-xs text-[#64748B] mt-0.5">
              Live availability for the selected interval · pick up to 3 PCs in order of preference
            </p>
          </div>

          {/* Availability Status & Fast Actions Bar */}
          <div className="mb-3.5 px-4 py-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${freeWorkstations.length > 0 ? 'bg-[#16A34A] animate-pulse' : 'bg-[#DC2626]'}`} />
              <span className="font-bold text-[#0F172A]">
                {freeWorkstations.length > 0 ? `${freeWorkstations.length} workstations free` : 'No workstations free'}
              </span>
              <span className="text-[#64748B]">
                ({startTime}–{endTime} · {selectedDate})
              </span>
            </div>

            <div className="flex items-center gap-2">
              {freeWorkstations.length > 0 && selectedMachineIds.length < 3 && (
                <button
                  type="button"
                  onClick={autoPickFreeSeats}
                  className="px-3 py-1 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] text-white font-semibold text-[11px] shadow-xs flex items-center gap-1 transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                  Auto-fill 3 free seats
                </button>
              )}
            </div>
          </div>

          {/* Exact Legend Row */}
          <div className="flex flex-wrap items-center gap-3.5 text-[11px] text-[#475569] mb-3.5">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#DCFCE7] border border-[#86EFAC]" />
              Available
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#FEF3C7] border border-[#FCD34D]" />
              Pending
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#FEE2E2] border border-[#FCA5A5]" />
              Booked
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#4F46E5]" />
              Selected
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#F1F5F9] border border-[#CBD5E1]" />
              Offline / maintenance
            </span>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-[#F1F5F9] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Block A · 60 workstations */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-[#0F172A]">Block A</span>
                  <span className="text-xs text-[#94A3B8]">60 workstations</span>
                </div>
                <div className="space-y-1 overflow-x-auto pt-3.5 px-2.5 pb-2.5">
                  {[1, 2, 3, 4, 5, 6].map(r => (
                    <div key={r} className="flex items-center gap-2 min-w-[540px] py-1">
                      <span className="w-6 text-[11px] font-medium text-[#94A3B8] shrink-0">R{r}</span>
                      <div className="grid grid-cols-10 gap-1.5 flex-1 overflow-visible">
                        {(rowsA[r] || []).map(ws => renderTile(ws))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Block B · 24 workstations */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-[#0F172A]">Block B</span>
                  <span className="text-xs text-[#94A3B8]">24 workstations</span>
                </div>
                <div className="space-y-1 overflow-x-auto pt-3.5 px-2.5 pb-2.5">
                  {[1, 2, 3, 4].map(r => (
                    <div key={r} className="flex items-center gap-2 min-w-[340px] max-w-[62%] py-1">
                      <span className="w-6 text-[11px] font-medium text-[#94A3B8] shrink-0">R{r}</span>
                      <div className="grid grid-cols-6 gap-1.5 flex-1 overflow-visible">
                        {(rowsB[r] || []).map(ws => renderTile(ws))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Your Preferences Sidebar (4 cols) */}
        <aside className="xl:col-span-4 fl-card p-5 flex flex-col justify-between gap-5">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-bold text-[#0F172A]">Your preferences</h2>
                <p className="text-xs text-[#64748B] mt-0.5">Up to 3 · ranked by choice (3 recommended)</p>
              </div>
              {freeWorkstations.length > 0 && selectedMachineIds.length < 3 && (
                <button
                  type="button"
                  onClick={autoPickFreeSeats}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#4F46E5] text-[11px] font-semibold transition-colors"
                  title="Automatically pick 3 available workstations"
                >
                  <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                  Auto-pick free
                </button>
              )}
            </div>

            {/* Booked Warning & Fast-Replace Action */}
            {bookedSelected.length > 0 && (
              <div className="mt-3 p-3 rounded-xl bg-[#FEF3C7] border border-[#FDE68A] text-xs text-[#92400E] flex flex-col gap-1.5">
                <div className="font-semibold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">warning</span>
                  Preference occupied
                </div>
                <p className="text-[11px] leading-relaxed">
                  {bookedSelected.map(w => w.display_label || w.machine_id).join(', ')} is booked for this interval.
                </p>
                {freeWorkstations.length > 0 && (
                  <button
                    type="button"
                    onClick={replaceBookedWithFree}
                    className="self-start text-[11px] font-bold text-[#4F46E5] underline hover:text-[#4338CA]"
                  >
                    Replace with available workstation →
                  </button>
                )}
              </div>
            )}

            {/* Preference List */}
            <div className="mt-4 space-y-2.5">
              {selectedObjects.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#F8FAFC] border border-dashed border-[#CBD5E1] text-center text-xs text-[#64748B]">
                  Click up to 3 green or yellow seats on the map, or use &ldquo;Auto-pick free&rdquo; above.
                </div>
              ) : (
                selectedObjects.map((ws, idx) => (
                  <div
                    key={ws.machine_id}
                    className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-[#4F46E5] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#0F172A] font-mono truncate">
                          {ws.display_label || ws.machine_id}
                        </div>
                        <div className="text-[11px] text-[#64748B]">
                          Block {ws.block_code || 'A'} · Row {ws.row_num || 1}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleSelectSeat(ws)}
                      className="text-[#94A3B8] hover:text-[#DC2626] p-1"
                      aria-label="Remove preference"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Quick Available Systems Options */}
            {freeWorkstations.length > 0 ? (
              <div className="mt-4 pt-3.5 border-t border-[#F1F5F9]">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-semibold text-[#0F172A]">Available in this slot</span>
                  <span className="text-[11px] text-[#15803D] font-bold">{freeWorkstations.length} free</span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {freeWorkstations.slice(0, 8).map(ws => {
                    const isSel = selectedMachineIds.includes(ws.machine_id);
                    return (
                      <button
                        key={ws.machine_id}
                        type="button"
                        onClick={() => toggleSelectSeat(ws)}
                        className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-semibold border transition-all ${
                          isSel
                            ? 'bg-[#4F46E5] border-[#4338CA] text-white shadow-xs'
                            : 'bg-[#DCFCE7] border-[#BBF7D0] text-[#15803D] hover:border-[#4ADE80]'
                        }`}
                        title={`Click to ${isSel ? 'remove' : 'add'} ${ws.display_label || ws.machine_id}`}
                      >
                        {ws.display_label || ws.machine_id}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#94A3B8] mt-1.5">
                  Click any chip to add. Fallback matching automatically assigns a free seat if needed.
                </p>
              </div>
            ) : (
              alternativeSlots.length > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-xs">
                  <div className="font-bold text-[#DC2626] flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-[16px]">event_busy</span>
                    Slot 100% full · Alternative slots today:
                  </div>
                  <div className="flex flex-col gap-1.5 mt-2">
                    {alternativeSlots.slice(0, 3).map(alt => (
                      <button
                        key={alt.slot_id}
                        type="button"
                        onClick={() => {
                          setStartTime(alt.start_time);
                          setEndTime(alt.end_time);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-[#FECACA] hover:border-[#4F46E5] text-[11px] font-semibold text-[#0F172A] flex items-center justify-between transition-colors"
                      >
                        <span>{alt.start_time} – {alt.end_time}</span>
                        <span className="text-[#15803D] font-bold">{alt.available_count} free →</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}

            {/* Session Purpose */}
            <div className="mt-4">
              <label className="block text-[11px] font-medium text-[#64748B] mb-1">Session note (optional)</label>
              <input
                type="text"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full h-9 px-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A] outline-none focus:bg-white focus:border-[#4F46E5]"
              />
            </div>

            {/* Callout Cards (Exact 03_student_book_workstation.png) */}
            <div className="mt-4 space-y-2.5">
              <div className="p-3.5 rounded-xl bg-[#FEF3C7] border border-[#FDE68A]">
                <div className="text-xs font-bold text-[#92400E]">
                  {isHighDemand ? 'High-demand interval' : 'Standard-demand interval'}
                </div>
                <p className="text-[11px] text-[#92400E]/90 mt-1 leading-relaxed">
                  {isHighDemand
                    ? 'More requests than free PCs are expected. Allocation runs by fairness priority.'
                    : `${summary?.slotAvailableCount ?? 0} of ${summary?.onlineCount ?? 82} online PCs are currently free for this interval.`}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#EEF2FF] border border-[#E0E7FF]">
                <div className="text-xs font-bold text-[#4338CA]">How it works</div>
                <p className="text-[11px] text-[#4338CA]/85 mt-1 leading-relaxed">
                  Uncontested seats confirm instantly. Contested intervals are evaluated automatically by the fairness engine with zero admin delay. We recommend choosing 3 preferences to maximize assignment match.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || durationLabel === 'Invalid' || exceedsMax2Hrs || tooShort || scheduleBlocked || Boolean(error)}
              className="w-full h-11 rounded-xl bg-[#4F46E5] hover:bg-[#4338CA] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-colors"
            >
              {submitting ? 'Submitting request...' : scheduleBlocked ? 'Interval unavailable' : 'Submit booking request'}
            </button>
            <p className="text-[11px] text-[#94A3B8] text-center mt-2">
              You can cancel or edit until the round closes
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
