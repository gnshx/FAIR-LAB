import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Sidebar, { STUDENT_NAV, ADMIN_NAV, GATE_NAV } from './components/Sidebar';
import { VIEW_TO_PATH, PATH_TO_ROUTE, resolveRoute } from './routes';

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
  const { profile, availableUsers, switchUser, clearSession } = useAuth();

  const user = profile?.user;
  const isGateUser = user?.email === 'accessdesk.l106@iitbhilai.ac.in' ||
    ((Array.isArray(user?.permissions) ? user.permissions : []).includes('ACCESS_OPERATOR') &&
     !(Array.isArray(user?.permissions) ? user.permissions : []).includes('POLICY_ADMIN'));

  const initialRoute = typeof window !== 'undefined'
    ? resolveRoute(window.location.pathname, sessionStorage.getItem('fairlab_last_workspace') || (isGateUser ? 'gate' : 'student'))
    : { workspace: isGateUser ? 'gate' : 'student', view: isGateUser ? 'admin-access' : 'student-dashboard', path: isGateUser ? '/access' : '/dashboard' };

  const [isSignedIn, setIsSignedIn] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.location.search.includes('login=1')) return false;
    if (sessionStorage.getItem('fairlab_signed_out') === '1') return false;
    if (sessionStorage.getItem('fairlab_signed_in') === '1') return true;
    if (window.location.search.includes('workspace=')) return true;
    // In demo environment, allow direct URL access to /overview, /settings, /book, etc.
    return true;
  });

  const [workspace, setWorkspace] = useState(initialRoute.workspace);
  const [currentView, setCurrentView] = useState(initialRoute.view);

  const handleNavigate = (viewId, replace = false) => {
    // Gate operators are restricted strictly to the QR Pass Verifier / Access Control
    if (isGateUser) {
      viewId = 'admin-access';
    }
    const targetPath = isGateUser ? '/access' : (VIEW_TO_PATH[viewId] || '/dashboard');
    const route = PATH_TO_ROUTE[targetPath] || { workspace: isGateUser ? 'gate' : 'student', view: viewId, path: targetPath };

    const targetWs = isGateUser ? 'gate' : route.workspace;
    setWorkspace(targetWs);
    setCurrentView(viewId);
    sessionStorage.setItem('fairlab_last_workspace', targetWs);

    if (typeof window !== 'undefined') {
      if (window.location.pathname !== targetPath) {
        if (replace) {
          window.history.replaceState(null, '', targetPath);
        } else {
          window.history.pushState(null, '', targetPath);
        }
      }
    }
  };

  const handleSwitchWorkspace = (targetWs, targetView) => {
    let nextView = targetView;
    if (!nextView) {
      if (targetWs === 'gate') nextView = 'admin-access';
      else if (targetWs === 'admin') nextView = 'admin-overview';
      else nextView = 'student-dashboard';
    }
    setWorkspace(targetWs);
    handleNavigate(nextView);
  };

  useEffect(() => {
    if (isGateUser && currentView !== 'admin-access') {
      handleNavigate('admin-access', true);
    }
  }, [isGateUser, currentView]);

  const handleSignOut = () => {
    clearSession();
    sessionStorage.setItem('fairlab_signed_out', '1');
    sessionStorage.removeItem('fairlab_signed_in');
    setIsSignedIn(false);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/?login=1');
    }
  };

  useEffect(() => {
    // Normalize root URL or alias to canonical path
    if (typeof window !== 'undefined') {
      const canonicalPath = VIEW_TO_PATH[currentView] || '/dashboard';
      if (window.location.pathname !== canonicalPath && (window.location.pathname === '/' || !PATH_TO_ROUTE[window.location.pathname])) {
        window.history.replaceState(null, '', canonicalPath);
      }
    }

    const handlePopState = () => {
      const route = resolveRoute(window.location.pathname, sessionStorage.getItem('fairlab_last_workspace') || 'student');
      setWorkspace(route.workspace);
      setCurrentView(route.view);
      sessionStorage.setItem('fairlab_last_workspace', route.workspace);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentView]);

  if (!isSignedIn) {
    return (
      <LoginView
        onSignedIn={(ws, view) => {
          sessionStorage.removeItem('fairlab_signed_out');
          sessionStorage.setItem('fairlab_signed_in', '1');
          setIsSignedIn(true);
          const target = (initialRoute && initialRoute.path !== '/dashboard') ? initialRoute.view : view;
          handleNavigate(target || (ws === 'admin' ? 'admin-overview' : 'student-dashboard'), true);
        }}
      />
    );
  }

  const isGateWorkspace = workspace === 'gate' || (isGateUser && (currentView === 'admin-access' || currentView === 'student-book'));
  const mobileNav = isGateWorkspace ? GATE_NAV : (workspace === 'admin' ? ADMIN_NAV : STUDENT_NAV);

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-[#0F172A] antialiased font-sans">
      <Sidebar
        workspace={isGateWorkspace ? 'gate' : workspace}
        currentView={currentView}
        setCurrentView={handleNavigate}
        onSwitchWorkspace={handleSwitchWorkspace}
        onSignOut={handleSignOut}
      />

      {/* Mobile / Tablet Compact Header + Nav */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#0B1120] text-white px-4 py-3 border-b border-[#1E293B]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg ${isGateWorkspace ? 'bg-[#10B981]' : 'bg-[#4F46E5]'} text-white font-bold text-xs flex items-center justify-center`}>
              {isGateWorkspace ? 'G' : 'F'}
            </div>
            <span className="font-bold text-sm">FairLab</span>
            <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] ml-1">
              {isGateWorkspace ? 'Gate Desk' : workspace}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (isGateWorkspace) {
                  handleSwitchWorkspace('student', 'student-dashboard');
                } else if (workspace === 'admin') {
                  handleSwitchWorkspace('student', 'student-dashboard');
                } else {
                  handleSwitchWorkspace('admin', 'admin-overview');
                }
              }}
              className="px-2.5 py-1 rounded-lg bg-[#172036] text-[11px] font-semibold text-[#A5B4FC]"
            >
              {isGateWorkspace ? 'Student view' : (workspace === 'admin' ? 'Student view' : 'Admin view')}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
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
                onClick={() => handleNavigate(item.id)}
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

      {/* Main Content Canvas (Exact Figma layout) */}
      <div className="lg:pl-60">
        <main className="min-h-screen w-full max-w-[1320px] mx-auto px-5 sm:px-8 py-7 pb-16">
          {/* Student Workspace (5 Screens) */}
          {currentView === 'student-dashboard' && (
            <StudentDashboardView onNavigate={(view) => handleNavigate(view)} />
          )}
          {currentView === 'student-book' && (
            <WorkstationMapView onNavigateToPass={() => handleNavigate('student-bookings')} />
          )}
          {currentView === 'student-bookings' && (
            <StudentMyBookingsView
              onNavigateToBook={() => handleNavigate('student-book')}
              onNavigate={handleNavigate}
            />
          )}
          {currentView === 'student-fairness' && <StudentFairnessView />}
          {currentView === 'student-notifications' && <StudentNotificationsView />}

          {/* Admin Workspace (9 Screens) */}
          {currentView === 'admin-overview' && (
            <AdminOverviewView onNavigate={(view) => handleNavigate(view)} />
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
