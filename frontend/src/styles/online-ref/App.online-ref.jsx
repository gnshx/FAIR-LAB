import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import LoginView from './views/LoginView';
import DashboardView from './views/DashboardView';
import WorkstationMapView from './views/WorkstationMapView';
import StudentPassView from './views/StudentPassView';
import QueueFloorMapView from './views/QueueFloorMapView';
import WatchmanGateView from './views/WatchmanGateView';
import AdminAnalyticsView from './views/AdminAnalyticsView';

const MOBILE_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'lab-seat-map', label: 'Seat Map', icon: 'event_seat' },
  { id: 'student-booking-passes', label: 'Fairness', icon: 'donut_large' },
  { id: 'lab-allocation-realtime-queue', label: 'Queue', icon: 'format_list_numbered' },
  { id: 'watchman-guard-gate-verify', label: 'Gate', icon: 'qr_code_scanner' },
  { id: 'admin-fairness-analytics', label: 'Admin', icon: 'tune' }
];

function MainLayout() {
  const [isSignedIn, setIsSignedIn] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('login=1')) {
      return false;
    }
    return true;
  });
  const [currentView, setCurrentView] = useState('dashboard');

  if (!isSignedIn) {
    return (
      <LoginView
        onSignedIn={() => {
          setIsSignedIn(true);
          setCurrentView('dashboard');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FC] text-[#1D2939] antialiased font-sans">
      <Header
        currentView={currentView}
        setCurrentView={setCurrentView}
        onSignOut={() => setIsSignedIn(false)}
      />
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        onSignOut={() => setIsSignedIn(false)}
      />

      <div className="lg:pl-60">
        <main className="relative pt-20 min-h-screen w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-16">
          {/* Compact Mobile/Tablet View Switcher */}
          <nav
            aria-label="Mobile Navigation"
            className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-4 mb-2 -mx-1 px-1"
          >
            {MOBILE_NAV.map(item => {
              const active = currentView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCurrentView(item.id)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                    active
                      ? 'bg-[#F0EEFF] text-[#5B4CF5] border-[#E4DDFF] font-semibold'
                      : 'bg-white text-[#475467] border-[#EAECF0]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {currentView === 'dashboard' && (
            <DashboardView onNavigate={(viewId) => setCurrentView(viewId)} />
          )}

          {currentView === 'lab-seat-map' && (
            <WorkstationMapView
              onNavigateToPass={() => setCurrentView('student-booking-passes')}
              onNavigateToQueue={() => setCurrentView('lab-allocation-realtime-queue')}
            />
          )}

          {currentView === 'student-booking-passes' && (
            <StudentPassView
              onNavigateToMap={() => setCurrentView('lab-seat-map')}
              onNavigateToQueue={() => setCurrentView('lab-allocation-realtime-queue')}
            />
          )}

          {currentView === 'lab-allocation-realtime-queue' && (
            <QueueFloorMapView />
          )}

          {currentView === 'watchman-guard-gate-verify' && (
            <WatchmanGateView />
          )}

          {currentView === 'admin-fairness-analytics' && (
            <AdminAnalyticsView />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <MainLayout />
      </SocketProvider>
    </AuthProvider>
  );
}
