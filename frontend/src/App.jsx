import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth, isGateDeskUser, CANONICAL_DEMO_USERS } from './context/AuthContext';
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
  const isGateUser = isGateDeskUser(user);

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobilePersonaOpen, setMobilePersonaOpen] = useState(false);

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
  const userList = (availableUsers && availableUsers.length > 0) ? availableUsers : CANONICAL_DEMO_USERS;
  const displayName = user?.name || (isGateWorkspace ? 'Ram Singh (Gate Desk)' : (workspace === 'admin' ? 'Dr. A. K. Sharma' : 'Ganesh Kumar'));
  const userInitial = (displayName.charAt(0) || 'U').toUpperCase();

  const handleSelectPersona = async (u) => {
    setMobilePersonaOpen(false);
    setMobileMenuOpen(false);
    await switchUser(u.user_id);
    const uIsGate = isGateDeskUser(u);

    if (uIsGate) {
      handleSwitchWorkspace('gate', 'admin-access');
    } else if (u.role === 'admin') {
      handleSwitchWorkspace('admin', 'admin-overview');
    } else {
      handleSwitchWorkspace('student', 'student-dashboard');
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-[#0F172A] antialiased font-sans">
      <Sidebar
        workspace={isGateWorkspace ? 'gate' : workspace}
        currentView={currentView}
        setCurrentView={handleNavigate}
        onSwitchWorkspace={handleSwitchWorkspace}
        onSignOut={handleSignOut}
      />

      {/* Mobile Slide-Out Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-80 max-w-[85vw] bg-[#0B1120] text-white h-full z-10 flex flex-col justify-between p-5 shadow-2xl overflow-y-auto animate-in slide-in-from-left duration-200">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[#1E293B]">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg ${isGateWorkspace ? 'bg-[#10B981]' : 'bg-[#4F46E5]'} text-white font-bold text-sm flex items-center justify-center`}>
                    {isGateWorkspace ? 'G' : 'F'}
                  </div>
                  <div>
                    <span className="font-bold text-base">FairLab</span>
                    <span className="block text-[10px] text-[#94A3B8] font-mono">IIT Bhilai · Lab L-106</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-[#94A3B8] hover:text-white transition-colors"
                  aria-label="Close menu"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              {/* Current Active Persona Card */}
              <div className="my-4 p-3 rounded-xl bg-[#172036] border border-[#1E293B] flex items-center gap-3">
                <div className={`w-9 h-9 rounded-full ${isGateWorkspace ? 'bg-[#10B981]' : 'bg-[#4F46E5]'} text-white font-bold text-sm flex items-center justify-center shrink-0`}>
                  {userInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate">{displayName}</div>
                  <div className="text-[11px] text-[#94A3B8] truncate">
                    {user?.roll_no ? `${user.roll_no} · ` : ''}
                    {isGateWorkspace ? 'Gate Desk Operator' : (workspace === 'admin' ? 'Faculty Coordinator' : 'Student')}
                  </div>
                </div>
              </div>

              {/* Navigation Links with touch targets >= 44px */}
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#64748B] px-1">
                {isGateWorkspace ? 'Gate Desk' : (workspace === 'admin' ? 'Admin Workspace' : 'Student Workspace')}
              </div>
              <nav className="space-y-1">
                {mobileNav.map(item => {
                  const active = currentView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        handleNavigate(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-colors text-left ${
                        active
                          ? 'bg-[#4F46E5] text-white font-semibold shadow-brand'
                          : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-white' : 'bg-[#475569]'}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>

              {/* Persona Switcher Section */}
              <div className="mt-6 pt-4 border-t border-[#1E293B]">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#64748B] px-1">
                  Switch Persona / Role
                </div>
                <div className="space-y-1.5">
                  {userList.map(u => {
                    const selected = u.user_id === user?.user_id || u.email === user?.email;
                    const uIsGate = isGateDeskUser(u);
                    const roleTitle = uIsGate ? 'Gate Desk (Pass Verifier)' : (u.role === 'admin' ? 'Admin Coordinator' : 'Student (Ganesh)');
                    const roleIcon = uIsGate ? 'shield_person' : (u.role === 'admin' ? 'manage_accounts' : 'school');

                    return (
                      <button
                        key={u.user_id || u.email}
                        type="button"
                        onClick={() => handleSelectPersona(u)}
                        className={`w-full min-h-[44px] p-2.5 rounded-xl text-left flex items-center justify-between transition-colors border ${
                          selected
                            ? 'bg-[#1E293B] border-[#4F46E5] text-white'
                            : 'bg-white/[0.02] border-transparent hover:bg-white/[0.06] text-[#94A3B8]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="material-symbols-outlined text-[18px] text-[#A5B4FC]">
                            {roleIcon}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{u.name}</div>
                            <div className="text-[10px] text-[#94A3B8] truncate">{roleTitle}</div>
                          </div>
                        </div>
                        {selected && (
                          <span className="w-2 h-2 rounded-full bg-[#10B981] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Bottom Sign Out */}
            <div className="pt-4 border-t border-[#1E293B]">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleSignOut();
                }}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-[#CBD5E1] font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile / Tablet Compact Header + Horizontal Nav */}
      <div className="lg:hidden sticky top-0 z-40 bg-[#0B1120] text-white px-3.5 py-2.5 border-b border-[#1E293B]">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/15 active:bg-white/20 flex items-center justify-center text-white shrink-0 transition-colors"
              aria-label="Open navigation drawer"
            >
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>
            <div className="flex items-center gap-1.5 min-w-0">
              <div className={`w-7 h-7 rounded-lg ${isGateWorkspace ? 'bg-[#10B981]' : 'bg-[#4F46E5]'} text-white font-bold text-xs flex items-center justify-center shrink-0`}>
                {isGateWorkspace ? 'G' : 'F'}
              </div>
              <span className="font-bold text-sm text-white">FairLab</span>
              <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-semibold px-1.5 py-0.5 rounded bg-white/5 truncate">
                {isGateWorkspace ? 'Gate Desk' : workspace}
              </span>
            </div>
          </div>

          {/* Quick Persona Switcher Popover Trigger */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMobilePersonaOpen(prev => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#172036] border border-[#1E293B] hover:bg-[#1E293B] transition-colors"
            >
              <div className={`w-5 h-5 rounded-full ${isGateWorkspace ? 'bg-[#10B981]' : 'bg-[#4F46E5]'} text-white font-bold text-[10px] flex items-center justify-center`}>
                {userInitial}
              </div>
              <span className="text-[11px] font-semibold text-[#CBD5E1] max-w-[80px] truncate">
                {displayName.split(' ')[0]}
              </span>
              <span className="material-symbols-outlined text-[14px] text-[#94A3B8]">
                {mobilePersonaOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {mobilePersonaOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMobilePersonaOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-[#131B2E] border border-[#1E293B] shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                    Switch Account / Role
                  </div>
                  <div className="space-y-1 my-1">
                    {userList.map(u => {
                      const selected = u.user_id === user?.user_id || u.email === user?.email;
                      const uIsGate = isGateDeskUser(u);
                      const roleBadge = uIsGate ? 'Gate Desk (Verifier)' : (u.role === 'admin' ? 'Admin Coordinator' : 'Student (Ganesh)');

                      return (
                        <button
                          key={u.user_id || u.email}
                          type="button"
                          onClick={() => handleSelectPersona(u)}
                          className={`w-full min-h-[38px] p-2 rounded-xl text-left flex items-center justify-between text-xs transition-colors ${
                            selected
                              ? 'bg-[#1E293B] text-white font-semibold'
                              : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate">{u.name}</div>
                            <div className="text-[10px] text-[#64748B] truncate">{roleBadge}</div>
                          </div>
                          {selected && <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="pt-1.5 border-t border-[#1E293B]">
                    <button
                      type="button"
                      onClick={() => {
                        setMobilePersonaOpen(false);
                        handleSignOut();
                      }}
                      className="w-full py-1.5 px-2 rounded-lg text-left text-xs text-[#DC2626] hover:bg-[#DC2626]/10 flex items-center gap-1.5 font-medium"
                    >
                      <span className="material-symbols-outlined text-[14px]">logout</span>
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Horizontal Navigation Pills */}
        <nav className="flex items-center gap-1.5 overflow-x-auto pt-2.5 pb-0.5 -mx-1 px-1 scrollbar-none">
          {mobileNav.map(item => {
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`shrink-0 min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                  active ? 'bg-[#4F46E5] text-white font-semibold shadow-sm' : 'text-[#94A3B8] hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content Canvas */}
      <div className="lg:pl-60">
        <main className="min-h-screen w-full max-w-[1320px] mx-auto px-3.5 sm:px-6 lg:px-8 py-5 sm:py-7 pb-16">
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
