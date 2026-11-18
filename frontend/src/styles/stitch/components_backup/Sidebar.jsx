import React from 'react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ currentView, setCurrentView }) {
  const { profile } = useAuth();
  const fairness = profile?.fairness;
  const score = fairness ? fairness.current_score : 100;
  const totalHours = fairness ? (fairness.total_hours_used ?? 0) : 0;
  const highDemandHours = fairness ? (fairness.high_demand_hours ?? 0) : 0;

  const labNav = [
    { id: 'lab-seat-map', label: 'Lab Seat Map (84)', icon: 'event_seat' },
    { id: 'student-booking-passes', label: 'My Pass & Fairness', icon: 'confirmation_number' },
    { id: 'lab-allocation-realtime-queue', label: 'Fairness Queue', icon: 'format_list_numbered' }
  ];

  const securityNav = [
    { id: 'watchman-guard-gate-verify', label: 'Gate Turnstile Scanner', icon: 'sensor_door' }
  ];

  const adminNav = [
    { id: 'admin-fairness-analytics', label: 'Policy & Schedule', icon: 'tune' }
  ];

  const renderSection = (title, items) => (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 font-semibold px-2 mb-2">
        {title}
      </div>
      <nav className="space-y-1">
        {items.map(item => {
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentView(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
                active
                  ? 'bg-zinc-800 text-zinc-100 border border-zinc-700/60'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <span className={`material-symbols-outlined text-[18px] ${active ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <aside className="hidden lg:flex fixed left-0 top-16 bottom-0 w-64 bg-zinc-950 border-r border-zinc-800 z-40 flex-col justify-between p-4 select-none">
      <div className="space-y-6">
        {renderSection('Booking & Allocation', labNav)}
        {renderSection('Physical Access', securityNav)}
        {renderSection('Administration', adminNav)}
      </div>

      {/* Compact Fairness Account Card */}
      <div className="p-3.5 rounded-xl bg-zinc-900 border border-zinc-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
            Priority Balance
          </span>
          <span className="text-xs font-mono font-bold text-emerald-400 tabular-nums">
            {score} / 100
          </span>
        </div>

        <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden mb-3">
          <div
            className="bg-emerald-500 h-full transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(5, score))}%` }}
          />
        </div>

        <div className="space-y-1 text-[11px] font-mono text-zinc-400 pt-2 border-t border-zinc-800 tabular-nums">
          <div className="flex justify-between">
            <span>Total Hours:</span>
            <span className="text-zinc-200 font-semibold">{totalHours}h</span>
          </div>
          <div className="flex justify-between">
            <span>High-Demand:</span>
            <span className="text-amber-300 font-semibold">{highDemandHours}h</span>
          </div>
          <div className="flex justify-between">
            <span>Lab Schedule:</span>
            <span className="text-zinc-300">09:00 – 18:00</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
