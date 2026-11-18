import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Sidebar, { STUDENT_NAV, ADMIN_NAV } from './components/Sidebar';

import LoginView from './views/LoginView';
import StudentDashboardView from './views/StudentDashboardView';
import WorkstationMapView from './views/WorkstationMapView';
import StudentMyBookingsView from './views/StudentMyBookingsView';
import StudentFairnessView from './views/StudentFairnessView';
import StudentNotificationsView from './views/StudentNotificationsView';

import AdminOverviewView from './views/AdminOverviewView';
import AdminAllocationView from './views/AdminAllocationView';
import AdminScheduleView from './views/AdminScheduleView';
import AdminWorkstationsView from './views/AdminWorkstationsView';
import AdminStudentsView from './views/AdminStudentsView';
import AdminAnalyticsView from './views/AdminAnalyticsView';
import AdminAccessControlView from './views/AdminAccessControlView';
import AdminSettingsView from './views/AdminSettingsView';
import AdminAuditLogView from './views/AdminAuditLogView';

function MainLayout() {
  const { availableUsers, switchUser, clearSession } = useAuth();

  const [isSignedIn, setIsSignedIn] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.location.search.includes('login=1')) return false;
    if (window.location.search.includes('workspace=')) return true;
    return sessionStorage.getItem('fairlab_signed_in') === '1';
  });

  const [workspace, setWorkspace] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('workspace=admin')) {
      return 'admin';
    }
    return 'student';
  });

  const [currentView, setCurrentView] = useState(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('workspace=admin')) {
      return 'admin-overview';
    }
    return 'student-dashboard';
  });

  const handleSwitchWorkspace = (targetWs, targetView) => {
    setWorkspace(targetWs);
    setCurrentView(targetView || (targetWs === 'admin' ? 'admin-overview' : 'student-dashboard'));
  };

  if (!isSignedIn) {
    return (
      <LoginView
        onSignedIn={(ws, view) => {
          sessionStorage.setItem('fairlab_signed_in', '1');
          setIsSignedIn(true);
          setWorkspace(ws);
          setCurrentView(view);
        }}
      />
    );
  }

  const mobileNav = workspace === 'admin' ? ADMIN_NAV : STUDENT_NAV;

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-[#0F172A] antialiased font-sans">
      <Sidebar
        workspace={workspace}
        currentView={currentView}
        setCurrentView={setCurrentView}
        onSwitchWorkspace={handleSwitchWorkspace}
        onSignOut={() => {
          clearSession();
          setIsSignedIn(false);
        }}
      />

      {/* Mobile / Tablet Compact Header + Nav */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#0B1120] text-white px-4 py-3 border-b border-[#1E293B]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#4F46E5] text-white font-bold text-xs flex items-center justify-center">
              F
            </div>
            <span className="font-bold text-sm">FairLab</span>
            <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] ml-1">
              {workspace}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (workspace === 'admin') {
                  const st = availableUsers.find(u => u.role === 'student');
                  if (st) switchUser(st.user_id);
                  handleSwitchWorkspace('student', 'student-dashboard');
                } else {
                  const ad = availableUsers.find(u => u.role === 'admin');
                  if (ad) switchUser(ad.user_id);
                  handleSwitchWorkspace('admin', 'admin-overview');
                }
              }}
              className="px-2.5 py-1 rounded-lg bg-[#172036] text-[11px] font-semibold text-[#A5B4FC]"
            >
              {workspace === 'admin' ? 'Student view' : 'Admin view'}
            </button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem('fairlab_signed_in');
                setIsSignedIn(false);
              }}
              className="px-2.5 py-1 rounded-lg bg-white/10 text-[11px] text-[#CBD5E1]"
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="flex items-center gap-1.5 overflow-x-auto pt-3 -mx-1 px-1">
          {mobileNav.map(item => {
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrentView(item.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-[#4F46E5] text-white font-semibold' : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content Canvas (No redundant top header bar — exact Figma layout) */}
      <div className="lg:pl-60">
        <main className="min-h-screen w-full max-w-[1320px] mx-auto px-5 sm:px-8 py-7 pb-16">
          {/* Student Workspace (5 Screens) */}
          {currentView === 'student-dashboard' && (
            <StudentDashboardView onNavigate={(view) => setCurrentView(view)} />
          )}
          {currentView === 'student-book' && (
            <WorkstationMapView onNavigateToPass={() => setCurrentView('student-bookings')} />
          )}
          {currentView === 'student-bookings' && (
            <StudentMyBookingsView onNavigateToBook={() => setCurrentView('student-book')} />
          )}
          {currentView === 'student-fairness' && <StudentFairnessView />}
          {currentView === 'student-notifications' && <StudentNotificationsView />}

          {/* Admin Workspace (9 Screens) */}
          {currentView === 'admin-overview' && (
            <AdminOverviewView onNavigate={(view) => setCurrentView(view)} />
          )}
          {currentView === 'admin-allocation' && <AdminAllocationView />}
          {currentView === 'admin-schedule' && <AdminScheduleView />}
          {currentView === 'admin-workstations' && <AdminWorkstationsView />}
          {currentView === 'admin-students' && <AdminStudentsView />}
          {currentView === 'admin-analytics' && <AdminAnalyticsView />}
          {currentView === 'admin-access' && <AdminAccessControlView />}
          {currentView === 'admin-settings' && <AdminSettingsView />}
          {currentView === 'admin-audit' && <AdminAuditLogView />}
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
