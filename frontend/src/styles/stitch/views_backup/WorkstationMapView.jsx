import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getSeatStyles(seat, viewMode, prefRank, isInspected) {
  if (seat.operational_status === 'MAINTENANCE') {
    return 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed';
  }

  const inspectedRing = isInspected ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-950 z-10' : '';

  if (prefRank != null) {
    return `bg-sky-500/25 border-sky-400 text-sky-100 hover:border-sky-300 ${inspectedRing}`;
  }

  if (viewMode === 'AVAILABILITY') {
    switch (seat.slot_status) {
      case 'AVAILABLE':
        return `bg-emerald-500/15 border-emerald-500/45 text-emerald-300 hover:border-emerald-400 ${inspectedRing}`;
      case 'PENDING':
        return `bg-amber-400/15 border-amber-400/50 text-amber-200 hover:border-amber-300 ${inspectedRing}`;
      case 'BOOKED':
      case 'OCCUPIED':
      default:
        return `bg-rose-500/15 border-rose-500/40 text-rose-300 opacity-70 hover:opacity-95 ${inspectedRing}`;
    }
  }

  // UTILIZATION MODE (Daily Occupancy % bands)
  let base = '';
  switch (seat.occupancy_band) {
    case 'LOW':
      base = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:border-emerald-400';
      break;
    case 'MEDIUM':
      base = 'bg-amber-400/15 border-amber-400/40 text-amber-200 hover:border-amber-300';
      break;
    case 'HIGH':
      base = 'bg-orange-500/15 border-orange-500/45 text-orange-200 hover:border-orange-400';
      break;
    case 'FULL':
    default:
      base = 'bg-rose-500/15 border-rose-500/45 text-rose-300 hover:border-rose-400';
      break;
  }
  const busyOverlay = !seat.slot_available ? 'seat-busy-pattern opacity-65' : '';
  return `${base} ${busyOverlay} ${inspectedRing}`;
}

export default function WorkstationMapView({ onNavigateToPass, onNavigateToQueue }) {
  const { currentUser, refreshProfile } = useAuth();
  const { subscribe } = useSocket();

  const [selectedDate, setSelectedDate] = useState(getTodayStr());
  const [intervalMode, setIntervalMode] = useState('PRESET'); // 'PRESET' | 'CUSTOM'
  const [selectedSlotId, setSelectedSlotId] = useState('slot-6');
  const [customStart, setCustomStart] = useState('10:30');
  const [customEnd, setCustomEnd] = useState('12:15');

  const [viewMode, setViewMode] = useState('AVAILABILITY'); // 'AVAILABILITY' | 'UTILIZATION'
  const [availableOnly, setAvailableOnly] = useState(false);

  const [availability, setAvailability] = useState(null);
  const [loadingMap, setLoadingMap] = useState(true);
  const [mapError, setMapError] = useState('');

  // Inspected seat + up to 3 ranked preferences (machine_id array)
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
        fetch(`/api/availability?${params.toString()}`),
        fetch(`/api/fairness/me?date=${selectedDate}`, { headers: { 'x-user-id': currentUser } })
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
      const res = await fetch(`/api/workstations/${machineId}/availability?date=${dateVal}`);
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
    if (inspectedMachineId) {
      fetchSeatDetail(inspectedMachineId, selectedDate);
    }
  }, [inspectedMachineId, selectedDate, fetchSeatDetail]);

  useEffect(() => {
    if (!inspectedMachineId && availability?.workstations?.length > 0) {
      const pick = availability.workstations.find(w => w.machine_id === 'L106-PC-05') || availability.workstations[0];
      setInspectedMachineId(pick.machine_id);
    }
  }, [availability, inspectedMachineId]);

  // Version-aware live WebSocket updates
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

    // Toggle seat in ranked preferences (up to 3)
    setRankedPrefs(prev => {
      if (prev.includes(seat.machine_id)) {
        return prev.filter(id => id !== seat.machine_id);
      }
      if (prev.length >= 3) {
        return [...prev.slice(1), seat.machine_id];
      }
      return [...prev, seat.machine_id];
    });
  };

  const removePref = (machineId) => {
    setRankedPrefs(prev => prev.filter(id => id !== machineId));
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
      const res = await fetch('/api/booking-requests', {
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
        setFeedback({ type: 'error', title: 'Request rejected', message: data.error || 'Could not process booking request.' });
        return;
      }

      if (data.status === 'CONFIRMED' && data.booking) {
        setFeedback({
          type: 'success',
          title: `Confirmed Immediately: ${data.booking.displayLabel} (${data.booking.machineId})`,
          message: `${data.booking.timeSlot} on ${data.booking.bookingDate}${data.booking.preferenceRankHonored ? ` · Preference #${data.booking.preferenceRankHonored} honored.` : ' · Assigned available workstation.'}`,
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
      <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>
          </div>
          <span className="text-xs font-mono tabular-nums text-zinc-300">
            <strong className="text-emerald-400">{freeCount}</strong> / {seats.length} open for interval
          </span>
        </div>

        <div className="space-y-2 overflow-x-auto pb-1">
          {rowNumbers.map(rowNum => {
            const rowSeats = rowsMap.get(rowNum) || [];
            return (
              <div key={rowNum} className="flex items-center gap-2 min-w-max">
                <span className="w-7 text-[11px] font-mono text-zinc-500 text-right shrink-0 select-none">
                  R{rowNum}
                </span>
                <div
                  className="grid gap-1.5 flex-1"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(44px, 1fr))` }}
                >
                  {rowSeats.map(seat => {
                    const prefIdx = rankedPrefs.indexOf(seat.machine_id);
                    const prefRank = prefIdx >= 0 ? prefIdx + 1 : null;
                    const isInspected = seat.machine_id === inspectedMachineId;
                    const dimmedByFilter = availableOnly && !seat.slot_available;
                    const tileClass = getSeatStyles(seat, viewMode, prefRank, isInspected);

                    return (
                      <button
                        key={seat.machine_id}
                        type="button"
                        onClick={() => handleSeatClick(seat)}
                        title={`${seat.display_label} (${seat.machine_id}) · Interval: ${seat.slot_status} · Daily Occupancy: ${seat.daily_occupancy_pct}%`}
                        className={`relative h-10 rounded-lg border text-xs font-mono font-semibold tabular-nums transition-all flex flex-col items-center justify-center ${tileClass} ${
                          dimmedByFilter ? 'opacity-20' : ''
                        }`}
                      >
                        <span className="leading-none">
                          {seat.block_code}{seat.block_seat_num}
                        </span>
                        <span className="text-[9px] font-normal opacity-80 mt-0.5 leading-none">
                          {seat.operational_status === 'MAINTENANCE'
                            ? 'OFF'
                            : viewMode === 'UTILIZATION'
                            ? `${seat.daily_occupancy_pct}%`
                            : seat.slot_status === 'AVAILABLE'
                            ? 'FREE'
                            : seat.slot_status === 'PENDING'
                            ? 'PEND'
                            : 'BUSY'}
                        </span>
                        {prefRank != null && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-sky-400 text-zinc-950 text-[10px] font-bold flex items-center justify-center">
                            {prefRank}
                          </span>
                        )}
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
    <div className="flex flex-col w-full gap-6 text-zinc-100">
      {/* Top Bar: Date + Custom / Preset Interval Selector */}
      <section className="p-5 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-zinc-100 tracking-tight">
                Computer Lab L-106 · Workstation Map
              </h1>
              <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700 tabular-nums">
                84 Systems
              </span>
              {schedule && (
                <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-zinc-950 text-zinc-400 border border-zinc-800 tabular-nums">
                  Hours {schedule.openTime}–{schedule.closeTime} · Custom {schedule.minDurationMinutes}–{schedule.maxDurationMinutes}m
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Choose a date and preset or custom time interval, select up to 3 ranked seat preferences, and submit a fairness-backed request.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Date Picker */}
            <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 h-9">
              <span className="material-symbols-outlined text-[16px] text-zinc-400">calendar_today</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs font-mono text-zinc-100 outline-none tabular-nums"
                aria-label="Booking date"
              />
            </div>

            {/* Preset vs Custom Time Window Switcher */}
            <div className="flex items-center p-0.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono h-9">
              <button
                type="button"
                onClick={() => setIntervalMode('PRESET')}
                className={`px-2.5 h-full rounded-md transition-colors ${
                  intervalMode === 'PRESET' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Quick Slots
              </button>
              <button
                type="button"
                onClick={() => setIntervalMode('CUSTOM')}
                className={`px-2.5 h-full rounded-md transition-colors ${
                  intervalMode === 'CUSTOM' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Custom Time
              </button>
            </div>

            <button
              type="button"
              onClick={onNavigateToPass}
              className="h-9 px-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium text-zinc-100 transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px] text-emerald-400">confirmation_number</span>
              <span>My QR Pass</span>
            </button>
          </div>
        </div>

        {/* Interval Controls */}
        <div className="pt-3 border-t border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              {intervalMode === 'CUSTOM'
                ? `Custom Half-Open Window [start, end) · ${selectedDate}`
                : `Quick Intervals · ${selectedDate}`}
            </span>
            {dailyQuota && (
              <span className="text-xs font-mono text-zinc-400 tabular-nums">
                Daily Quota:{' '}
                <strong className={dailyQuota.remainingHours > 0 ? 'text-zinc-200' : 'text-rose-400'}>
                  {dailyQuota.usedHours}h / {dailyQuota.maxDailyHours}h
                </strong>
                {' · '}
                Priority: <strong className="text-emerald-400">{fairnessInfo?.currentScore ?? 100} pts</strong>
              </span>
            )}
          </div>

          {intervalMode === 'CUSTOM' ? (
            <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono">
              <div className="flex items-center gap-2">
                <label className="text-zinc-400">Start</label>
                <input
                  type="time"
                  value={customStart}
                  min={schedule?.openTime || '09:00'}
                  max={schedule?.closeTime || '18:00'}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-8 px-2.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              <span className="text-zinc-500">→</span>
              <div className="flex items-center gap-2">
                <label className="text-zinc-400">End</label>
                <input
                  type="time"
                  value={customEnd}
                  min={schedule?.openTime || '09:00'}
                  max={schedule?.closeTime || '18:00'}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-8 px-2.5 rounded-md bg-zinc-900 border border-zinc-700 text-zinc-100 outline-none focus:border-emerald-500"
                />
              </div>
              <span className="text-zinc-400 tabular-nums ml-auto">
                Duration: <strong className="text-zinc-100">{activeInterval?.duration_minutes ?? '—'} mins</strong> · Back-to-back boundaries allowed
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
                    className={`px-3 py-2 rounded-lg border text-left shrink-0 transition-all min-w-[116px] ${
                      isActive
                        ? 'bg-emerald-500/15 border-emerald-500 text-zinc-100'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-semibold tabular-nums">
                        {slot.start_time}–{slot.end_time}
                      </span>
                      {isPeak && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          Peak
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono mt-1 tabular-nums flex items-center justify-between">
                      <span className={slot.available_count > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {slot.available_count} free
                      </span>
                      {slot.queued_count > 0 && <span className="text-zinc-500">{slot.queued_count} pend</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {mapError && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-center justify-between text-xs text-rose-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{mapError}</span>
          </div>
          <button
            type="button"
            onClick={fetchAvailability}
            className="px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200"
          >
            Retry
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
              : feedback.type === 'info'
              ? 'bg-zinc-900 border-zinc-700 text-zinc-200'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span className="material-symbols-outlined text-[18px] mt-0.5">
              {feedback.type === 'success' ? 'check_circle' : feedback.type === 'info' ? 'schedule' : 'warning'}
            </span>
            <div>
              <div className="font-semibold">{feedback.title}</div>
              <div className="text-zinc-300 mt-0.5">{feedback.message}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {feedback.showPassLink && (
              <button
                type="button"
                onClick={onNavigateToPass}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-zinc-950 font-semibold hover:bg-emerald-400"
              >
                Open QR Pass
              </button>
            )}
            {feedback.showQueueLink && (
              <button
                type="button"
                onClick={onNavigateToQueue}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700"
              >
                View Fairness Queue
              </button>
            )}
            <button type="button" onClick={() => setFeedback(null)} className="p-1 text-zinc-400 hover:text-zinc-200">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Split: 84-Seat Map (8 cols) + Inspector & Ranked Multi-Preference Booking (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-8 flex flex-col gap-5">
          {/* Map Mode Toggle (Availability Mode vs Utilization Mode) + Legend */}
          <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center p-0.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setViewMode('AVAILABILITY')}
                  className={`px-3 py-1.5 rounded-md transition-colors ${
                    viewMode === 'AVAILABILITY' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Availability Mode
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('UTILIZATION')}
                  className={`px-3 py-1.5 rounded-md transition-colors ${
                    viewMode === 'UTILIZATION' ? 'bg-zinc-800 text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
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
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="material-symbols-outlined text-[15px]">
                  {availableOnly ? 'check_box' : 'check_box_outline_blank'}
                </span>
                <span>Only Available</span>
              </button>
            </div>

            {viewMode === 'AVAILABILITY' ? (
              <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-zinc-400 pt-2 border-t border-zinc-800">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/60" /> Available</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400/30 border border-amber-400/60" /> Pending</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-500/30 border border-rose-500/60" /> Booked</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-zinc-800 border border-zinc-700" /> Offline</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-sky-500/30 border border-sky-400" /> Selected (#1–#3)</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-zinc-400 pt-2 border-t border-zinc-800">
                <div className="flex flex-wrap items-center gap-3.5">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500/30 border border-emerald-500/60" /> 0–49%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-400/30 border border-amber-400/60" /> 50–70%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-500/30 border border-orange-500/60" /> 71–99%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-rose-500/30 border border-rose-500/60" /> 100%</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-zinc-800 border border-zinc-700" /> Offline</span>
                </div>
                <span className="flex items-center gap-1.5 text-zinc-300">
                  <span className="w-4 h-3 rounded border border-zinc-600 seat-busy-pattern inline-block" />
                  Busy in selected window
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center">
            <div className="px-8 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-mono uppercase tracking-widest text-zinc-500">
              Lab L-106 Front · Instructor Desk & Gate Entrance
            </div>
          </div>

          {loadingMap && !availability ? (
            <div className="space-y-4">
              <div className="h-72 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" />
              <div className="h-52 rounded-xl bg-zinc-900 border border-zinc-800 animate-pulse" />
            </div>
          ) : (
            <>
              {renderBlockGrid('Block A', '6 rows × 10 systems · A-R1-PC01 to A-R6-PC10 (60 workstations)', blockA, 10)}
              {renderBlockGrid('Block B', '4 rows × 6 systems · B-R1-PC01 to B-R4-PC06 (24 workstations)', blockB, 6)}
            </>
          )}
        </div>

        {/* Right: Sticky Inspector + Ranked Preferences (Up to 3) Booking Panel */}
        <aside className="xl:col-span-4 xl:sticky xl:top-20 flex flex-col gap-5">
          <div className="p-5 rounded-xl bg-zinc-900 border border-zinc-800 space-y-4">
            {/* Ranked Preferences Pill Box */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                  Ranked Preferences ({rankedPrefs.length} / 3)
                </span>
                {rankedPrefs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRankedPrefs([])}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    Clear
                  </button>
                )}
              </div>

              {rankedPrefs.length === 0 ? (
                <div className="p-3 rounded-lg bg-zinc-950 border border-dashed border-zinc-800 text-xs text-zinc-500">
                  Click up to 3 seats on the map to rank preferences, or submit to let the Fairness Engine assign any free seat.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {rankedPrefs.map((mId, idx) => {
                    const seat = wsById.get(mId);
                    return (
                      <div
                        key={mId}
                        className="px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-between text-xs font-mono"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-sky-400 text-zinc-950 text-[11px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-zinc-100">{seat?.display_label || mId}</span>
                          <span className="text-[11px] text-zinc-400">({seat?.slot_status || 'AVAILABLE'})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePref(mId)}
                          className="text-zinc-400 hover:text-zinc-100"
                          aria-label={`Remove ${mId}`}
                        >
                          <span className="material-symbols-outlined text-[15px]">close</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Inspected Seat Details */}
            {inspectedSeat && (
              <div className="pt-4 border-t border-zinc-800 space-y-3 text-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono font-bold text-sm text-zinc-100">{inspectedSeat.display_label}</div>
                    <div className="text-zinc-400 mt-0.5">
                      Block {inspectedSeat.block_code} · Row {inspectedSeat.row_num} · Seat {inspectedSeat.seat_num}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-300 tabular-nums">
                    {inspectedSeat.daily_occupancy_pct}% daily
                  </span>
                </div>

                {/* Single Seat Hourly Strip */}
                {loadingDetail ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-7 rounded bg-zinc-800/50 animate-pulse" />
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
                        className={`px-2 py-1 rounded-md border text-[11px] font-mono tabular-nums ${
                          iv.available
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400'
                            : 'border-zinc-800 bg-zinc-950 text-zinc-500'
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
            <form onSubmit={handleSubmitRequest} className="pt-4 border-t border-zinc-800 space-y-3">
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono space-y-1.5 tabular-nums">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Window</span>
                  <span className="text-zinc-100 font-semibold">
                    {activeInterval ? `${activeInterval.start_time} – ${activeInterval.end_time}` : '—'} ({intervalHours}h)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Allocation Path</span>
                  <span className="text-zinc-200">
                    {(activeInterval?.queued_count || 0) > 0 ? 'Fairness Round (Contested)' : 'Immediate (Uncontested)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Est. Checkout Cost</span>
                  <span className={isHighDemand ? 'text-amber-300 font-semibold' : 'text-zinc-200'}>
                    -{estDeduction} pts ({isHighDemand ? 'High Demand' : 'Normal'})
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-mono uppercase text-zinc-400 block mb-1">Academic Purpose</label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g., CS302 Systems lab evaluation"
                  required
                  minLength={3}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono uppercase text-zinc-400 block mb-1">Track</label>
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                >
                  <option value="Algorithms & Systems">Algorithms & Systems</option>
                  <option value="AI / Machine Learning">AI / Machine Learning</option>
                  <option value="Data Science & Databases">Data Science & Databases</option>
                  <option value="Coursework & Exam Prep">Coursework & Exam Prep</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting || Boolean(mapError)}
                className="w-full h-10 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-zinc-950 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">event_available</span>
                <span>
                  {submitting
                    ? 'Processing Request...'
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
