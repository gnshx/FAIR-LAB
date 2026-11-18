import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Exact pastel-on-dotted-grid color language from design/booking page-colrs-css.png
 */
function getSeatCardClasses(seat, viewMode, prefRank, isInspected) {
  if (seat.operational_status === 'MAINTENANCE') {
    return {
      card: 'bg-white border-[#E5E7EB] text-[#6B7280] cursor-not-allowed',
      statusText: 'text-[#9CA3AF]',
      showLock: false
    };
  }

  const ring = isInspected ? 'ring-2 ring-[#5B4CF5] ring-offset-2 ring-offset-[#F8FAFC] z-10' : '';

  if (prefRank != null) {
    return {
      card: `bg-[#EFF6FF] border-[#60A5FA] text-[#1E3A8A] shadow-sm hover:border-[#3B82F6] ${ring}`,
      statusText: 'text-[#1D4ED8]',
      showLock: false
    };
  }

  if (viewMode === 'AVAILABILITY') {
    switch (seat.slot_status) {
      case 'AVAILABLE':
        return {
          card: `bg-[#ECFDF3] border-[#86EFAC] text-[#1D2939] hover:border-[#22C55E] hover:shadow-sm ${ring}`,
          statusText: 'text-[#15803D]',
          showLock: false
        };
      case 'PENDING':
        return {
          card: `bg-[#FFFBEB] border-[#FCD34D] text-[#1D2939] hover:border-[#F59E0B] ${ring}`,
          statusText: 'text-[#B45309]',
          showLock: false
        };
      case 'BOOKED':
      case 'OCCUPIED':
      default:
        return {
          card: `bg-[#FEF2F2] border-[#FCA5A5] text-[#1D2939] hover:border-[#F87171] ${ring}`,
          statusText: 'text-[#DC2626]',
          showLock: true
        };
    }
  }

  // DAILY UTILIZATION MODE
  let base = '';
  let statusText = '';
  switch (seat.occupancy_band) {
    case 'LOW':
      base = 'bg-[#ECFDF3] border-[#86EFAC] text-[#1D2939] hover:border-[#22C55E]';
      statusText = 'text-[#15803D]';
      break;
    case 'MEDIUM':
      base = 'bg-[#FEFCE8] border-[#FDE047] text-[#1D2939] hover:border-[#EAB308]';
      statusText = 'text-[#A16207]';
      break;
    case 'HIGH':
      base = 'bg-[#FFF7ED] border-[#FDBA74] text-[#1D2939] hover:border-[#F97316]';
      statusText = 'text-[#C2410C]';
      break;
    case 'FULL':
    default:
      base = 'bg-[#FEF2F2] border-[#FCA5A5] text-[#1D2939] hover:border-[#EF4444]';
      statusText = 'text-[#DC2626]';
      break;
  }

  const busyPattern = !seat.slot_available ? 'seat-busy-pattern' : '';
  return {
    card: `${base} ${busyPattern} ${ring}`,
    statusText,
    showLock: !seat.slot_available
  };
}

export default function WorkstationMapView({ onNavigateToPass, onNavigateToQueue }) {
  const { currentUser, refreshProfile } = useAuth();
  const { subscribe } = useSocket();

  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [intervalMode, setIntervalMode] = useState('PRESET');
  const [selectedSlotId, setSelectedSlotId] = useState('slot-6');
  const [customStart, setCustomStart] = useState('10:30');
  const [customEnd, setCustomEnd] = useState('12:15');

  const [viewMode, setViewMode] = useState('AVAILABILITY');
  const [availableOnly, setAvailableOnly] = useState(false);

  const [availability, setAvailability] = useState(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const [mapError, setMapError] = useState('');

  const [inspectedMachineId, setInspectedMachineId] = useState(null);
  const [rankedPrefs, setRankedPrefs] = useState([]);
  const [seatDetail, setSeatDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [fairnessInfo, setFairnessInfo] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [domain, setDomain] = useState('Algorithms & Systems');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const latestVersionRef = useRef(0);

  const fetchAvailability = useCallback(async () => {
    try {
      setMapError('');
      const params = new URLSearchParams({ labId: 'L106', date: selectedDate });
      if (intervalMode === 'CUSTOM') {
        params.set('start', customStart);
        params.set('end', customEnd);
      } else if (selectedSlotId) {
        params.set('slotId', selectedSlotId);
      }

      const [resMap, resFair] = await Promise.all([
        fetch(`/api/v1/availability?${params.toString()}`),
        fetch(`/api/v1/fairness/me?date=${selectedDate}`, { headers: { 'x-user-id': currentUser } })
      ]);

      const mapData = await resMap.json();
      if (!resMap.ok) {
        setMapError(mapData.error || 'Unable to load seat availability for this time window.');
        return;
      }

      if (mapData.version) latestVersionRef.current = Math.max(latestVersionRef.current, mapData.version);
      setAvailability(mapData);

      if (intervalMode === 'PRESET' && !selectedSlotId && mapData.selectedSlot?.slot_id) {
        setSelectedSlotId(mapData.selectedSlot.slot_id);
      }

      if (resFair.ok) {
        setFairnessInfo(await resFair.json());
      }
    } catch (err) {
      setMapError(err.message || 'Could not reach the availability service.');
    } finally {
      setLoadingMap(false);
    }
  }, [selectedDate, intervalMode, selectedSlotId, customStart, customEnd, currentUser]);

  const fetchSeatDetail = useCallback(async (machineId, dateVal) => {
    if (!machineId) {
      setSeatDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/v1/workstations/${machineId}/availability?date=${dateVal}`);
      if (res.ok) setSeatDetail(await res.json());
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    setLoadingMap(true);
    fetchAvailability();
  }, [fetchAvailability]);

  useEffect(() => {
    if (inspectedMachineId) fetchSeatDetail(inspectedMachineId, selectedDate);
  }, [inspectedMachineId, selectedDate, fetchSeatDetail]);

  useEffect(() => {
    if (!inspectedMachineId && availability?.workstations?.length > 0) {
      const pick = availability.workstations.find(w => w.machine_id === 'L106-PC-05') || availability.workstations[0];
      setInspectedMachineId(pick.machine_id);
    }
  }, [availability, inspectedMachineId]);

  useEffect(() => {
    const onEvent = (evt) => {
      if (evt?.version && evt.version < latestVersionRef.current) return;
      fetchAvailability();
      if (inspectedMachineId) fetchSeatDetail(inspectedMachineId, selectedDate);
      refreshProfile();
    };
    const unsubs = [
      subscribe('workstation.status_changed', onEvent),
      subscribe('booking.requested', onEvent),
      subscribe('booking.confirmed', onEvent),
      subscribe('booking.cancelled', onEvent),
      subscribe('allocation.completed', onEvent),
      subscribe('SLOT_UPDATED', onEvent),
      subscribe('QUEUE_CHANGED', onEvent)
    ];
    return () => unsubs.forEach(fn => fn && fn());
  }, [subscribe, fetchAvailability, fetchSeatDetail, inspectedMachineId, selectedDate, refreshProfile]);

  const handleSeatClick = (seat) => {
    setInspectedMachineId(seat.machine_id);
    if (seat.operational_status === 'MAINTENANCE') return;

    setRankedPrefs(prev => {
      if (prev.includes(seat.machine_id)) return prev.filter(id => id !== seat.machine_id);
      if (prev.length >= 3) return [...prev.slice(1), seat.machine_id];
      return [...prev, seat.machine_id];
    });
  };

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    const idempotencyKey = `req-${currentUser}-${selectedDate}-${intervalMode === 'CUSTOM' ? `${customStart}-${customEnd}` : selectedSlotId}-${Date.now()}`;

    const bodyPayload = {
      labId: 'L106',
      bookingDate: selectedDate,
      ...(intervalMode === 'CUSTOM'
        ? { startTime: customStart, endTime: customEnd }
        : { slotId: selectedSlotId }),
      preferredWorkstations: rankedPrefs,
      computePurpose: purpose.trim() || 'Academic Lab Work',
      researchField: domain,
      allocationMode: 'AUTO',
      idempotencyKey
    };

    try {
      const res = await fetch('/api/v1/booking-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser,
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', title: 'Request not accepted', message: data.error || 'Could not submit request.' });
        return;
      }

      if (data.status === 'CONFIRMED' && data.booking) {
        setFeedback({
          type: 'success',
          title: `Confirmed: ${data.booking.displayLabel}`,
          message: `${data.booking.timeSlot} on ${data.booking.bookingDate}${data.booking.preferenceRankHonored ? ` · Preference #${data.booking.preferenceRankHonored} assigned.` : ' · Assigned available seat.'}`,
          showPassLink: true
        });
      } else {
        setFeedback({
          type: 'info',
          title: 'Queued for Fairness Allocation Round',
          message: data.message || `Competing requests detected. Ranked by Fairness Score (${data.priorityScore} pts), Wait Time, and Timestamp.`,
          showQueueLink: true
        });
      }

      setPurpose('');
      setRankedPrefs([]);
      await fetchAvailability();
      if (inspectedMachineId) await fetchSeatDetail(inspectedMachineId, selectedDate);
      await refreshProfile();
    } catch (err) {
      setFeedback({ type: 'error', title: 'Connection issue', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const workstations = availability?.workstations || [];
  const wsById = new Map(workstations.map(w => [w.machine_id, w]));
  const blockA = workstations.filter(w => w.block_code === 'A');
  const blockB = workstations.filter(w => w.block_code === 'B');
  const inspectedSeat = workstations.find(w => w.machine_id === inspectedMachineId) || null;
  const activeInterval = availability?.selectedSlot;
  const schedule = availability?.schedule;
  const dailyQuota = fairnessInfo?.dailyQuota;

  const intervalHours = activeInterval ? parseFloat(((activeInterval.duration_minutes || 60) / 60).toFixed(2)) : 1;
  const isHighDemand = activeInterval?.demand_level === 'HIGH_DEMAND';
  const estDeduction = schedule
    ? Math.round(intervalHours * (schedule.deductionPerHour + (isHighDemand ? schedule.highDemandDeductionPerHour : 0)))
    : 5;

  const renderBlockGrid = (title, subtitle, seats, cols) => {
    const rowsMap = new Map();
    for (const seat of seats) {
      if (!rowsMap.has(seat.row_num)) rowsMap.set(seat.row_num, []);
      rowsMap.get(seat.row_num).push(seat);
    }
    const rowNumbers = Array.from(rowsMap.keys()).sort((a, b) => a - b);
    const freeCount = seats.filter(s => s.slot_available).length;

    return (
      <div className="rounded-2xl bg-white border border-[#EAECF0] shadow-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EAECF0] flex flex-wrap items-center justify-between gap-2 bg-white">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[18px] text-[#5B4CF5]">desktop_windows</span>
            <div>
              <h3 className="font-display text-sm font-bold text-[#101828]">{title}</h3>
              <p className="text-xs text-[#667085]">{subtitle}</p>
            </div>
          </div>
          <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-full bg-[#ECFDF3] text-[#15803D] border border-[#BBF7D0] tabular-nums">
            {freeCount} / {seats.length} free
          </span>
        </div>

        {/* Dotted Floor Grid Surface (exact design/booking page-colrs-css.png look!) */}
        <div className="lab-dotted-grid p-4 sm:p-5 space-y-2.5 overflow-x-auto">
          {rowNumbers.map(rowNum => {
            const rowSeats = rowsMap.get(rowNum) || [];
            return (
              <div key={rowNum} className="flex items-center gap-2.5 min-w-max">
                <span className="w-6 text-[11px] font-mono font-semibold text-[#667085] text-right shrink-0 select-none">
                  R{rowNum}
                </span>
                <div
                  className="grid gap-2 flex-1"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(60px, 1fr))` }}
                >
                  {rowSeats.map(seat => {
                    const prefIdx = rankedPrefs.indexOf(seat.machine_id);
                    const prefRank = prefIdx >= 0 ? prefIdx + 1 : null;
                    const isInspected = seat.machine_id === inspectedMachineId;
                    const dimmed = availableOnly && !seat.slot_available;
                    const cls = getSeatCardClasses(seat, viewMode, prefRank, isInspected);

                    return (
                      <button
                        key={seat.machine_id}
                        type="button"
                        onClick={() => handleSeatClick(seat)}
                        title={`${seat.display_label} (${seat.machine_id}) · Interval: ${seat.slot_status} · Daily: ${seat.daily_occupancy_pct}%`}
                        className={`relative h-[54px] px-2 py-1.5 rounded-xl border text-left transition-all flex flex-col justify-between ${cls.card} ${
                          dimmed ? 'opacity-25' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-mono text-[11px] font-bold tabular-nums leading-none">
                            {seat.block_code}{seat.block_seat_num}
                          </span>
                          {prefRank != null ? (
                            <span className="w-4 h-4 rounded-full bg-[#2563EB] text-white text-[10px] font-bold flex items-center justify-center leading-none">
                              {prefRank}
                            </span>
                          ) : cls.showLock ? (
                            <span className="material-symbols-outlined text-[13px] text-[#DC2626]/75">lock</span>
                          ) : null}
                        </div>

                        <div className={`font-mono text-[9.5px] font-semibold uppercase tracking-tight leading-none tabular-nums ${cls.statusText}`}>
                          {seat.operational_status === 'MAINTENANCE'
                            ? 'OFFLINE'
                            : prefRank != null
                            ? `PREF #${prefRank}`
                            : viewMode === 'UTILIZATION'
                            ? `${seat.daily_occupancy_pct}% DAY`
                            : seat.slot_status === 'AVAILABLE'
                            ? 'FREE'
                            : seat.slot_status === 'PENDING'
                            ? 'PENDING'
                            : 'BOOKED'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full gap-5 text-[#1D2939]">
      {/* Top Bar: Date + Preset/Custom Time Picker */}
      <section className="p-5 rounded-2xl bg-white border border-[#EAECF0] shadow-card flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-xl font-bold text-[#101828] tracking-tight">
                Lab L-106 Workstation Map
              </h1>
              <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-[#F4F2FF] text-[#5B4CF5] border border-[#E4DDFF]">
                84 Systems
              </span>
              {schedule && (
                <span className="text-xs font-mono text-[#667085]">
                  Open {schedule.openTime}–{schedule.closeTime} · Custom {schedule.minDurationMinutes}–{schedule.maxDurationMinutes}m
                </span>
              )}
            </div>
            <p className="text-xs text-[#667085] mt-1">
              Select a date and time interval, click up to 3 preferred workstations, and submit a fairness-backed booking request.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#D0D5DD] rounded-xl px-3 h-9">
              <span className="material-symbols-outlined text-[16px] text-[#667085]">calendar_today</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs font-mono text-[#1D2939] outline-none tabular-nums"
                aria-label="Booking date"
              />
            </div>

            <div className="flex items-center p-0.5 rounded-xl bg-[#F2F4F7] border border-[#EAECF0] text-xs font-medium h-9">
              <button
                type="button"
                onClick={() => setIntervalMode('PRESET')}
                className={`px-3 h-full rounded-lg transition-all ${
                  intervalMode === 'PRESET' ? 'bg-white text-[#101828] shadow-sm font-semibold' : 'text-[#667085] hover:text-[#1D2939]'
                }`}
              >
                Quick Slots
              </button>
              <button
                type="button"
                onClick={() => setIntervalMode('CUSTOM')}
                className={`px-3 h-full rounded-lg transition-all ${
                  intervalMode === 'CUSTOM' ? 'bg-white text-[#101828] shadow-sm font-semibold' : 'text-[#667085] hover:text-[#1D2939]'
                }`}
              >
                Custom Time
              </button>
            </div>

            <button
              type="button"
              onClick={onNavigateToPass}
              className="h-9 px-3.5 rounded-xl bg-white hover:bg-[#F7F8FC] border border-[#D0D5DD] text-xs font-semibold text-[#344054] flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px] text-[#5B4CF5]">qr_code_2</span>
              <span>My QR Pass</span>
            </button>
          </div>
        </div>

        {/* Interval Selection Row */}
        <div className="pt-3.5 border-t border-[#F2F4F7]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
              {intervalMode === 'CUSTOM' ? `Custom Half-Open Window [start, end) · ${selectedDate}` : `Time Intervals · ${selectedDate}`}
            </span>
            {dailyQuota && (
              <span className="text-xs font-mono text-[#475467] tabular-nums">
                Today&apos;s Quota:{' '}
                <strong className={dailyQuota.remainingHours > 0 ? 'text-[#101828]' : 'text-[#DC2626]'}>
                  {dailyQuota.usedHours}h / {dailyQuota.maxDailyHours}h
                </strong>
                {' · '}
                Priority: <strong className="text-[#5B4CF5]">{fairnessInfo?.currentScore ?? 100} pts</strong>
              </span>
            )}
          </div>

          {intervalMode === 'CUSTOM' ? (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#EAECF0] text-xs font-mono">
              <div className="flex items-center gap-2">
                <label className="text-[#667085]">Start</label>
                <input
                  type="time"
                  value={customStart}
                  min={schedule?.openTime || '09:00'}
                  max={schedule?.closeTime || '18:00'}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-8 px-2.5 rounded-lg bg-white border border-[#D0D5DD] text-[#1D2939] outline-none focus:border-[#5B4CF5]"
                />
              </div>
              <span className="text-[#98A2B3]">→</span>
              <div className="flex items-center gap-2">
                <label className="text-[#667085]">End</label>
                <input
                  type="time"
                  value={customEnd}
                  min={schedule?.openTime || '09:00'}
                  max={schedule?.closeTime || '18:00'}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-8 px-2.5 rounded-lg bg-white border border-[#D0D5DD] text-[#1D2939] outline-none focus:border-[#5B4CF5]"
                />
              </div>
              <span className="text-[#667085] tabular-nums ml-auto">
                Duration: <strong className="text-[#101828]">{activeInterval?.duration_minutes ?? '—'} mins</strong> · Back-to-back allowed
              </span>
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {(availability?.slots || []).map(slot => {
                const isActive = slot.slot_id === selectedSlotId;
                const isPeak = slot.demand_level === 'HIGH_DEMAND';
                return (
                  <button
                    key={slot.slot_id}
                    type="button"
                    onClick={() => setSelectedSlotId(slot.slot_id)}
                    className={`px-3 py-2 rounded-xl border text-left shrink-0 transition-all min-w-[116px] ${
                      isActive
                        ? 'bg-[#F0EEFF] border-[#5B4CF5] text-[#101828] shadow-sm'
                        : 'bg-[#F8FAFC] border-[#EAECF0] text-[#475467] hover:border-[#D0D5DD] hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-semibold tabular-nums">
                        {slot.start_time}–{slot.end_time}
                      </span>
                      {isPeak && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309]">
                          Peak
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono mt-1 tabular-nums flex items-center justify-between">
                      <span className={slot.available_count > 0 ? 'text-[#15803D] font-medium' : 'text-[#DC2626]'}>
                        {slot.available_count} free
                      </span>
                      {slot.queued_count > 0 && <span className="text-[#667085]">{slot.queued_count} pend</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {mapError && (
        <div className="p-4 rounded-xl bg-[#FEF2F2] border border-[#FECACA] flex items-center justify-between text-xs text-[#B91C1C]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{mapError}</span>
          </div>
          <button type="button" onClick={fetchAvailability} className="px-3 py-1 rounded-lg bg-white border border-[#FECACA] font-semibold">
            Retry
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
            feedback.type === 'success'
              ? 'bg-[#ECFDF3] border-[#BBF7D0] text-[#14532D]'
              : feedback.type === 'info'
              ? 'bg-[#F4F2FF] border-[#D4C5FF] text-[#312E81]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span className="material-symbols-outlined text-[18px] mt-0.5">
              {feedback.type === 'success' ? 'check_circle' : feedback.type === 'info' ? 'schedule' : 'warning'}
            </span>
            <div>
              <div className="font-semibold">{feedback.title}</div>
              <div className="opacity-90 mt-0.5">{feedback.message}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {feedback.showPassLink && (
              <button
                type="button"
                onClick={onNavigateToPass}
                className="px-3 py-1.5 rounded-lg bg-[#15803D] text-white font-semibold hover:bg-[#166534]"
              >
                Open QR Pass
              </button>
            )}
            {feedback.showQueueLink && (
              <button
                type="button"
                onClick={onNavigateToQueue}
                className="px-3 py-1.5 rounded-lg bg-[#5B4CF5] text-white font-semibold hover:bg-[#4B3CE0]"
              >
                View Queue
              </button>
            )}
            <button type="button" onClick={() => setFeedback(null)} className="p-1 opacity-60 hover:opacity-100">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace: 84-Seat Map (8 cols) + Sticky Booking Inspector (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-8 flex flex-col gap-5">
          {/* View Mode Toggle + Clean Legend */}
          <div className="px-5 py-3.5 rounded-2xl bg-white border border-[#EAECF0] shadow-card flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center p-0.5 rounded-xl bg-[#F2F4F7] border border-[#EAECF0] text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setViewMode('AVAILABILITY')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    viewMode === 'AVAILABILITY' ? 'bg-white text-[#101828] shadow-sm font-semibold' : 'text-[#667085] hover:text-[#1D2939]'
                  }`}
                >
                  Availability Mode
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('UTILIZATION')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    viewMode === 'UTILIZATION' ? 'bg-white text-[#101828] shadow-sm font-semibold' : 'text-[#667085] hover:text-[#1D2939]'
                  }`}
                >
                  Daily Utilization Mode
                </button>
              </div>

              <button
                type="button"
                onClick={() => setAvailableOnly(v => !v)}
                className={`h-8 px-3 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  availableOnly
                    ? 'bg-[#ECFDF3] border-[#86EFAC] text-[#15803D]'
                    : 'bg-white border-[#D0D5DD] text-[#475467] hover:bg-[#F8FAFC]'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">
                  {availableOnly ? 'check_box' : 'check_box_outline_blank'}
                </span>
                <span>Only Available</span>
              </button>
            </div>

            {viewMode === 'AVAILABILITY' ? (
              <div className="flex flex-wrap items-center gap-4 text-[11px] font-medium text-[#475467] pt-2.5 border-t border-[#F2F4F7]">
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#ECFDF3] border border-[#86EFAC]" /> Available</span>
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#FFFBEB] border border-[#FCD34D]" /> Pending</span>
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#FEF2F2] border border-[#FCA5A5]" /> Booked</span>
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-white border border-[#D0D5DD]" /> Offline</span>
                <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#EFF6FF] border border-[#60A5FA]" /> Selected (#1–#3)</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-medium text-[#475467] pt-2.5 border-t border-[#F2F4F7]">
                <div className="flex flex-wrap items-center gap-3.5">
                  <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#ECFDF3] border border-[#86EFAC]" /> 0–49%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#FEFCE8] border border-[#FDE047]" /> 50–70%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#FFF7ED] border border-[#FDBA74]" /> 71–99%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-[#FEF2F2] border border-[#FCA5A5]" /> 100%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded bg-white border border-[#D0D5DD]" /> Offline</span>
                </div>
                <span className="flex items-center gap-1.5 text-[#667085]">
                  <span className="w-4 h-3.5 rounded border border-[#FCA5A5] seat-busy-pattern inline-block" />
                  Busy in selected window
                </span>
              </div>
            )}
          </div>

          {loadingMap && !availability ? (
            <div className="space-y-4">
              <div className="h-80 rounded-2xl bg-white border border-[#EAECF0] animate-pulse" />
              <div className="h-56 rounded-2xl bg-white border border-[#EAECF0] animate-pulse" />
            </div>
          ) : (
            <>
              {renderBlockGrid('Block A', '6 rows × 10 systems · A-R1-PC01 to A-R6-PC10 (60 workstations)', blockA, 10)}
              {renderBlockGrid('Block B', '4 rows × 6 systems · B-R1-PC01 to B-R4-PC06 (24 workstations)', blockB, 6)}
            </>
          )}
        </div>

        {/* Right: Sticky Inspector & Multi-Preference Booking Form */}
        <aside className="xl:col-span-4 xl:sticky xl:top-20 flex flex-col gap-5">
          <div className="p-5 rounded-2xl bg-white border border-[#EAECF0] shadow-card space-y-4">
            {/* Ranked Preferences (up to 3) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#667085]">
                  Ranked Preferences ({rankedPrefs.length} / 3)
                </span>
                {rankedPrefs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRankedPrefs([])}
                    className="text-xs font-medium text-[#5B4CF5] hover:text-[#4318D8]"
                  >
                    Clear
                  </button>
                )}
              </div>

              {rankedPrefs.length === 0 ? (
                <div className="p-3 rounded-xl bg-[#F8FAFC] border border-dashed border-[#D0D5DD] text-xs text-[#667085]">
                  Click up to 3 seats on the dotted floor map to set preferences, or submit to let the Fairness Engine pick any open seat.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {rankedPrefs.map((mId, idx) => {
                    const seat = wsById.get(mId);
                    return (
                      <div
                        key={mId}
                        className="px-3 py-2 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-between text-xs font-mono"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-[#2563EB] text-white text-[11px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-[#1E3A8A]">{seat?.display_label || mId}</span>
                          <span className="text-[11px] text-[#3B82F6]">({seat?.slot_status || 'FREE'})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRankedPrefs(p => p.filter(id => id !== mId))}
                          className="text-[#60A5FA] hover:text-[#1D4ED8]"
                        >
                          <span className="material-symbols-outlined text-[15px]">close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Inspected Seat Hourly Breakdown */}
            {inspectedSeat && (
              <div className="pt-4 border-t border-[#F2F4F7] space-y-3 text-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono font-bold text-sm text-[#101828]">{inspectedSeat.display_label}</div>
                    <div className="text-[#667085] mt-0.5">
                      Block {inspectedSeat.block_code} · Row {inspectedSeat.row_num} · Seat {inspectedSeat.seat_num}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#F8FAFC] border border-[#EAECF0] text-[#344054] tabular-nums">
                    {inspectedSeat.daily_occupancy_pct}% daily
                  </span>
                </div>

                {loadingDetail ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-7 rounded-lg bg-[#F2F4F7] animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {(seatDetail?.intervals || []).map(iv => (
                      <button
                        key={iv.slot_id}
                        type="button"
                        onClick={() => {
                          setIntervalMode('PRESET');
                          setSelectedSlotId(iv.slot_id);
                        }}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-mono tabular-nums font-medium ${
                          iv.available
                            ? 'border-[#86EFAC] bg-[#ECFDF3] text-[#15803D] hover:border-[#22C55E]'
                            : 'border-[#EAECF0] bg-[#F8FAFC] text-[#98A2B3]'
                        }`}
                      >
                        {iv.start_time}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Booking Submission Form */}
            <form onSubmit={handleSubmitRequest} className="pt-4 border-t border-[#F2F4F7] space-y-3">
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#EAECF0] text-xs font-mono space-y-1.5 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-[#667085]">Window</span>
                  <span className="text-[#101828] font-semibold">
                    {activeInterval ? `${activeInterval.start_time}–${activeInterval.end_time}` : '—'} ({intervalHours}h)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#667085]">Allocation Mode</span>
                  <span className="text-[#344054]">
                    {(activeInterval?.queued_count || 0) > 0 ? 'Fairness Round' : 'Immediate'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#667085]">Checkout Deduction</span>
                  <span className={isHighDemand ? 'text-[#B45309] font-semibold' : 'text-[#5B4CF5] font-semibold'}>
                    -{estDeduction} pts ({isHighDemand ? 'Peak' : 'Normal'})
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[#344054] block mb-1">Academic Purpose</label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g., CS302 Operating Systems lab"
                  required
                  minLength={3}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#D0D5DD] text-xs text-[#1D2939] placeholder:text-[#98A2B3] focus:border-[#5B4CF5] focus:ring-2 focus:ring-[#5B4CF5]/15 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#344054] block mb-1">Track</label>
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#D0D5DD] text-xs text-[#1D2939] focus:border-[#5B4CF5] outline-none"
                >
                  <option value="Algorithms & Systems">Algorithms &amp; Systems</option>
                  <option value="AI / Machine Learning">AI / Machine Learning</option>
                  <option value="Data Science & Databases">Data Science &amp; Databases</option>
                  <option value="Coursework & Exam Prep">Coursework &amp; Exam Prep</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting || Boolean(mapError)}
                className="w-full h-11 rounded-xl bg-[#5B4CF5] hover:bg-[#4B3CE0] disabled:opacity-50 text-white font-semibold text-xs shadow-brand transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">event_available</span>
                <span>
                  {submitting
                    ? 'Submitting...'
                    : rankedPrefs.length > 0
                    ? `Request ${wsById.get(rankedPrefs[0])?.display_label || rankedPrefs[0]} (${activeInterval?.start_time || ''}–${activeInterval?.end_time || ''})`
                    : `Request Any Available Seat (${activeInterval?.start_time || ''}–${activeInterval?.end_time || ''})`}
                </span>
              </button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}
