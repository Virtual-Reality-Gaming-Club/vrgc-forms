"use client";

import React, { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import FacultyDashboard from '@/components/FacultyDashboard';
import MembersRoster from '@/components/MembersRoster';
import PlannedEvents from '@/components/PlannedEvents';
import IDCard from '@/components/IDCard';
import Referrals from '@/components/Referrals';
import Tickets from '@/components/Tickets';
import Payments from '@/components/Payments';
import Lobby25MemberEntry from '@/components/Lobby25MemberEntry';
import Lobby24MemberEntry from '@/components/Lobby24MemberEntry';
import EventRegister from '@/components/EventRegister';
import Footer from '@/components/Footer';
import MaintenanceModal, {
  MaintenanceConfigState,
  MAINTENANCE_CATEGORIES,
} from '@/components/MaintenanceModal';
import { useAuth } from '@/lib/auth-context';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

// ── Under-maintenance screen (shown instead of the locked section) ────────────
const MaintenanceScreen = ({
  section,
  onBack,
}: {
  section: string;
  onBack?: () => void;
}) => (
  <div className="flex-1 flex items-center justify-center p-6 select-none">
    <div className="max-w-md w-full bg-[#0e0518] border border-purple-500/40 rounded-3xl p-8 sm:p-10 shadow-[0_0_60px_rgba(168,85,247,0.2)] flex flex-col items-center gap-5 text-center">
      <div className="w-16 h-16 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
        <span className="material-symbols-outlined text-3xl">construction</span>
      </div>
      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
          TEMPORARY SYSTEM UPGRADE
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight">Under Maintenance</h2>
        <p className="text-slate-300 text-xs leading-relaxed">
          The <span className="text-purple-300 font-bold">{section}</span> section is currently undergoing scheduled maintenance &amp; improvements.
        </p>
        <p className="text-slate-500 text-[11px]">
          Please check back shortly or explore other available club services.
        </p>
      </div>

      {onBack && (
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-all flex items-center gap-2 cursor-pointer mt-2"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Return to Dashboard
        </button>
      )}
    </div>
  </div>
);

function AppContent() {
  const {
    user,
    userEmail,
    isAdmin,
    isPaymentAdmin,
    isFaculty,
    isAuthorized,
    memberData,
    authLoading,
    authError,
    handleLogin,
    handleLogout,
  } = useAuth();

  const [activePage, setActivePage] = useState<string>('dashboard');
  const [toast, setToast] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState<number>(0);

  // ── Maintenance mode — read from Firestore in real time ───────────────────
  const [maintenanceConfig, setMaintenanceConfig] = useState<MaintenanceConfigState & { enabled?: boolean }>({
    all: false,
    sections: {},
  });
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState<boolean>(false);
  const [savingMaintenance, setSavingMaintenance] = useState<boolean>(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'maintenance'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setMaintenanceConfig({
          all: !!data.all || !!data.enabled,
          sections: data.sections || {},
        });
      } else {
        setMaintenanceConfig({ all: false, sections: {} });
      }
    });
    return () => unsub();
  }, []);

  const handleSaveMaintenanceConfig = async (newConfig: MaintenanceConfigState) => {
    setSavingMaintenance(true);
    try {
      await setDoc(doc(db, 'config', 'maintenance'), {
        all: newConfig.all,
        sections: newConfig.sections,
        enabled: newConfig.all,
        updatedAt: new Date().toISOString(),
        updatedBy: userEmail || 'admin',
      });
      showToast('Maintenance settings updated in real-time! 🔧');
    } catch (err: any) {
      console.error('Failed to update maintenance config:', err);
      showToast('Failed to update maintenance settings.');
    } finally {
      setSavingMaintenance(false);
    }
  };

  const isSectionLocked = (sectionKey: string): boolean => {
    // Admins bypass lock to inspect/test freely
    if (isAdmin || isPaymentAdmin) return false;
    if (maintenanceConfig.all || maintenanceConfig.enabled) return true;
    return !!maintenanceConfig.sections?.[sectionKey];
  };

  const isSectionUnderMaintenanceForAdmin = (sectionKey: string): boolean => {
    return !!(maintenanceConfig.all || maintenanceConfig.enabled || maintenanceConfig.sections?.[sectionKey]);
  };

  const lockedSectionsCount = maintenanceConfig.all
    ? MAINTENANCE_CATEGORIES.length
    : Object.values(maintenanceConfig.sections || {}).filter(Boolean).length;

  const showToast = (message: string) => {
    setToast(message);
    setToastKey((prev) => prev + 1);
    setTimeout(() => setToast(null), 3000);
  };

  // Parse initial tab from clean URL path (e.g. /register, /referrals, /idcard, /payments, /members, /planned_events)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.replace(/^\//, '');
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      const validPaths = ['register', 'referrals', 'idcard', 'payments', 'dashboard', 'batch24', 'batch25', 'members', 'planned_events'];

      if (path && validPaths.includes(path)) {
        if (!isAuthorized && path === 'dashboard') {
          setActivePage('register');
        } else {
          setActivePage(path);
        }
      } else if (tabParam && validPaths.includes(tabParam)) {
        if (!isAuthorized && tabParam === 'dashboard') {
          setActivePage('register');
        } else {
          setActivePage(tabParam);
        }
      } else {
        // Members / admins / faculty default to 'dashboard', non-members default to 'register'
        setActivePage(isAuthorized ? 'dashboard' : 'register');
      }
    }
  }, [user, isAuthorized]);

  const handlePageChange = (pageId: string) => {
    if (pageId === 'tickets') {
      showToast('This section is locked and will be available in a future update.');
      return;
    }
    setActivePage(pageId);
    if (typeof window !== 'undefined') {
      const newPath = pageId === 'dashboard' ? '/' : `/${pageId}`;
      window.history.pushState({ path: newPath }, '', newPath);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const getPageTitle = () => {
    switch (activePage) {
      case 'dashboard': return isFaculty ? 'Faculty Dashboard' : 'Dashboard';
      case 'members': return 'Members Roster';
      case 'planned_events': return 'Planned Future Events';
      case 'register': return 'Event Register';
      case 'batch25': return 'Lobby 25';
      case 'batch24': return 'Lobby 24';
      case 'referrals': return 'Referrals';
      case 'idcard': return 'ID Card Portal';
      case 'payments': return isFaculty ? 'Faculty Payments Ledger' : 'Payments & Dues Portal';
      case 'tickets': return 'Tickets';
      default: return 'Command Center';
    }
  };

  // ── Global loading screen ──────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#05010a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <span className="text-purple-300 text-sm font-semibold tracking-widest uppercase">Authenticating…</span>
        </div>
      </div>
    );
  }

  // ── 1. Require Sign In on initial load if user is not logged in ─────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-[#05010a] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#0e0518]/90 border border-purple-500/30 rounded-3xl p-8 sm:p-10 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.2)] flex flex-col items-center gap-6 text-center animate-in fade-in duration-300">
          <div className="w-16 h-16 rounded-2xl bg-purple-600 flex items-center justify-center shadow-[0_0_30px_rgba(168,85,247,0.5)]">
            <span className="material-symbols-outlined text-white text-3xl">login</span>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-white tracking-tight">VRGC Forms Portal</h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Sign in with your official <span className="text-purple-400 font-bold">@vitbhopal.ac.in</span> institutional account or authorized faculty Google account.
            </p>
            {authError && (
              <p className="text-rose-400 text-xs bg-rose-950/40 border border-rose-500/30 rounded-xl px-3 py-2 mt-2 font-medium">{authError}</p>
            )}
          </div>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-900 font-bold py-3.5 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl active:scale-95 text-sm cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  // ── 2. Access denied (only if user signed in with non-VIT account and is not Faculty/Admin) ──
  if (authError && !userEmail.endsWith('@vitbhopal.ac.in') && !isAdmin && !isFaculty) {
    return (
      <div className="min-h-screen bg-[#05010a] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-[#0e0518]/80 border border-rose-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(244,63,94,0.1)] flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-950 border border-rose-500/50 flex items-center justify-center">
            <span className="text-rose-400 text-3xl">🔒</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-rose-400 mb-1">Access Denied</h2>
            <p className="text-slate-400 text-sm">{authError}</p>
            <p className="text-slate-500 text-xs mt-1">Signed in as: {user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-6 py-2.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 font-semibold rounded-xl transition-all text-sm cursor-pointer"
          >
            Sign Out &amp; Try Another Account
          </button>
        </div>
      </div>
    );
  }

  // Helper for rendering sign-in prompt on restricted sub-pages when not signed in
  const renderRestrictedSignIn = (pageName: string) => (
    <div className="flex-1 flex items-center justify-center p-6 my-auto">
      <div className="max-w-md w-full bg-[#0e0518]/90 border border-purple-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.15)] flex flex-col items-center gap-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center shadow-[0_0_30px_rgba(168,85,247,0.5)]">
          <span className="material-symbols-outlined text-white text-3xl">lock</span>
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-extrabold text-white tracking-wide">Sign In Required</h2>
          <p className="text-sm text-slate-300">
            Please sign in with your institutional Google account to access the <span className="text-purple-400 font-bold">{pageName}</span> section.
          </p>
          {authError && (
            <p className="text-rose-400 text-xs bg-rose-950/40 border border-rose-500/30 rounded-lg px-3 py-2 mt-2">{authError}</p>
          )}
        </div>
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 font-bold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl cursor-pointer"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
        <p className="text-xs text-slate-500">Only authorized VRGC members and faculty can access this section.</p>
      </div>
    </div>
  );

  // ── Main app shell ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#05010a] text-[#e2e8f0] flex flex-col custom-scrollbar">
      <Navbar
        pageTitle={getPageTitle()}
        userEmail={userEmail}
        user={user}
        memberData={memberData}
        isAdmin={isAdmin}
        isFaculty={isFaculty}
        onLogout={handleLogout}
        onLogin={handleLogin}
      />

      {/* Admin maintenance control bar — visible to payment admin & root admins */}
      {isPaymentAdmin && (
        <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-2.5 bg-[#0b0317] border-b border-purple-500/25 gap-2.5 text-xs select-none">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                lockedSectionsCount > 0
                  ? 'bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.6)] animate-pulse'
                  : 'bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
              }`}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-slate-300 font-medium">Portal Maintenance Mode:</span>
              {maintenanceConfig.all ? (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                  ALL CATEGORIES LOCKED
                </span>
              ) : lockedSectionsCount > 0 ? (
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                  {lockedSectionsCount} Section(s) Under Maintenance
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                  All Systems Operational
                </span>
              )}
            </div>
          </div>

          <button
            onClick={() => setIsMaintenanceModalOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-all cursor-pointer"
          >
            <span className="material-symbols-outlined text-sm">tune</span>
            <span>Configure Maintenance Mode</span>
          </button>
        </div>
      )}

      {/* Admin Notice when currently viewing a category that is locked for members */}
      {isPaymentAdmin && isSectionUnderMaintenanceForAdmin(activePage) && (
        <div className="bg-amber-950/40 border-b border-amber-500/30 px-4 py-2 text-center text-xs font-bold text-amber-300 flex items-center justify-center gap-2">
          <span className="material-symbols-outlined text-sm text-amber-400">construction</span>
          <span>
            [ADMIN PREVIEW] The <strong className="text-white underline">{getPageTitle()}</strong> section is currently locked for members. You have full access because you are an Admin.
          </span>
        </div>
      )}

      <div className="flex flex-1">
        <Sidebar
          activePage={activePage}
          onPageChange={handlePageChange}
          isAdmin={isAdmin}
          isFaculty={isFaculty}
          isAuthorized={isAuthorized}
        />

        <main className="flex-grow min-w-0 pb-24 md:pb-12 min-h-[calc(100vh-76px)] flex flex-col">
          {activePage === 'dashboard' && (
            isFaculty ? (
              <FacultyDashboard
                onPageChange={handlePageChange}
                facultyName={memberData?.name}
                facultyEmail={userEmail}
              />
            ) : isAuthorized ? (
              <Dashboard onPageChange={handlePageChange} />
            ) : (
              <EventRegister
                onRedirect={() => handlePageChange('register')}
                externalUser={user}
                externalUserEmail={userEmail}
                externalIsPaymentAdmin={isPaymentAdmin}
              />
            )
          )}

          {activePage === 'members' && (
            isSectionLocked('members') ? (
              <MaintenanceScreen
                section="Members Roster"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : isAuthorized ? (
              <MembersRoster onRedirect={() => handlePageChange('dashboard')} />
            ) : (
              renderRestrictedSignIn('Members Roster')
            )
          )}

          {activePage === 'planned_events' && (
            isSectionLocked('planned_events') ? (
              <MaintenanceScreen
                section="Planned Future Events"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : isAuthorized ? (
              <PlannedEvents
                isAdmin={isAdmin}
                isFaculty={isFaculty}
                userEmail={userEmail}
                userName={memberData?.name || user?.displayName || 'User'}
                onRedirect={() => handlePageChange('dashboard')}
              />
            ) : (
              renderRestrictedSignIn('Planned Future Events')
            )
          )}

          {activePage === 'register' && (
            isSectionLocked('register') ? (
              <MaintenanceScreen
                section="Event Registration"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : (
              <EventRegister
                onRedirect={() => handlePageChange('dashboard')}
                externalUser={user}
                externalUserEmail={userEmail}
                externalIsPaymentAdmin={isPaymentAdmin}
              />
            )
          )}

          {activePage === 'batch25' && (
            isSectionLocked('batch25') ? (
              <MaintenanceScreen
                section="Lobby 25 Member Entry"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : isAuthorized ? (
              <Lobby25MemberEntry onRedirect={() => handlePageChange('dashboard')} />
            ) : (
              renderRestrictedSignIn('Lobby 25')
            )
          )}

          {activePage === 'batch24' && (
            isSectionLocked('batch24') ? (
              <MaintenanceScreen
                section="Lobby 24 Member Entry"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : isAuthorized ? (
              <Lobby24MemberEntry onRedirect={() => handlePageChange('dashboard')} />
            ) : (
              renderRestrictedSignIn('Lobby 24')
            )
          )}

          {activePage === 'referrals' && (
            isSectionLocked('referrals') ? (
              <MaintenanceScreen
                section="Referrals Portal"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : isAuthorized ? (
              <Referrals
                onRedirect={() => handlePageChange('dashboard')}
                externalUser={user}
                externalMemberData={memberData}
                externalIsAdmin={isAdmin}
                externalIsAuthorized={isAuthorized}
              />
            ) : (
              renderRestrictedSignIn('Referrals')
            )
          )}

          {activePage === 'idcard' && (
            isSectionLocked('idcard') ? (
              <MaintenanceScreen
                section="ID Card Portal & Form"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : isAuthorized ? (
              <IDCard
                onRedirect={() => handlePageChange('dashboard')}
                externalUser={user}
                externalMemberData={memberData}
                externalIsAdmin={isAdmin}
                externalIsAuthorized={isAuthorized}
                onLogout={handleLogout}
              />
            ) : (
              renderRestrictedSignIn('ID Card Portal')
            )
          )}

          {activePage === 'payments' && (
            isSectionLocked('payments') ? (
              <MaintenanceScreen
                section="Payments & Dues Portal"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : isAuthorized ? (
              <Payments
                onRedirect={() => handlePageChange('dashboard')}
                externalUser={user}
                externalUserEmail={userEmail}
                externalIsAdmin={isPaymentAdmin}
                externalIsFaculty={isFaculty}
              />
            ) : (
              renderRestrictedSignIn('Payments & Dues')
            )
          )}

          {activePage === 'tickets' && <Tickets onRedirect={() => handlePageChange('dashboard')} />}
        </main>
      </div>

      {/* Granular Maintenance Settings Modal */}
      <MaintenanceModal
        isOpen={isMaintenanceModalOpen}
        onClose={() => setIsMaintenanceModalOpen(false)}
        currentConfig={maintenanceConfig}
        onSave={handleSaveMaintenanceConfig}
        saving={savingMaintenance}
      />

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0e0518]/95 backdrop-blur-lg border-t border-purple-500/30 flex justify-around py-3 z-50 select-none">
        {isFaculty ? (
          <>
            <button onClick={() => handlePageChange('dashboard')} className={`flex flex-col items-center gap-1 ${activePage === 'dashboard' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
              <span className="material-symbols-outlined text-xl">dashboard</span>
              <span className="font-label-caps text-[9px]">HOME</span>
            </button>
            <button onClick={() => handlePageChange('members')} className={`flex flex-col items-center gap-1 ${activePage === 'members' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
              <span className="material-symbols-outlined text-xl">groups</span>
              <span className="font-label-caps text-[9px]">ROSTER</span>
            </button>
            <button onClick={() => handlePageChange('payments')} className={`flex flex-col items-center gap-1 ${activePage === 'payments' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
              <span className="material-symbols-outlined text-xl">payments</span>
              <span className="font-label-caps text-[9px]">PAYMENTS</span>
            </button>
            <button onClick={() => handlePageChange('planned_events')} className={`flex flex-col items-center gap-1 ${activePage === 'planned_events' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
              <span className="material-symbols-outlined text-xl">event_upcoming</span>
              <span className="font-label-caps text-[9px]">EVENTS</span>
            </button>
          </>
        ) : (
          <>
            {isAuthorized && (
              <button onClick={() => handlePageChange('dashboard')} className={`flex flex-col items-center gap-1 ${activePage === 'dashboard' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
                <span className="material-symbols-outlined text-xl">dashboard</span>
                <span className="font-label-caps text-[9px]">HOME</span>
              </button>
            )}
            <button onClick={() => handlePageChange('register')} className={`flex flex-col items-center gap-1 ${activePage === 'register' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
              <span className="material-symbols-outlined text-xl">how_to_reg</span>
              <span className="font-label-caps text-[9px]">REGISTER</span>
            </button>
            {isAuthorized && (
              <>
                <button onClick={() => handlePageChange('referrals')} className={`flex flex-col items-center gap-1 ${activePage === 'referrals' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
                  <span className="material-symbols-outlined text-xl">share</span>
                  <span className="font-label-caps text-[9px]">REFER</span>
                </button>
                <button onClick={() => handlePageChange('idcard')} className={`flex flex-col items-center gap-1 ${activePage === 'idcard' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
                  <span className="material-symbols-outlined text-xl">badge</span>
                  <span className="font-label-caps text-[9px]">ID CARD</span>
                </button>
                <button onClick={() => handlePageChange('payments')} className={`flex flex-col items-center gap-1 ${activePage === 'payments' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
                  <span className="material-symbols-outlined text-xl">payments</span>
                  <span className="font-label-caps text-[9px]">PAYMENTS</span>
                </button>
              </>
            )}
          </>
        )}
      </nav>

      {/* Toast */}
      {toast && (
        <div key={toastKey} className="fixed top-20 right-4 md:right-8 z-[100] bg-[#13091f]/95 border border-purple-500/40 backdrop-blur-xl px-6 py-4 rounded-xl shadow-[0_0_30px_rgba(168,85,247,0.3)] text-white flex items-center gap-3">
          <span className="material-symbols-outlined text-purple-400">info</span>
          <span className="text-xs font-bold">{toast}</span>
        </div>
      )}
      <Footer />
    </div>
  );
}

// ─── Root export ─────────────────────────────────────────────────────────────
export default function Home() {
  return <AppContent />;
}
