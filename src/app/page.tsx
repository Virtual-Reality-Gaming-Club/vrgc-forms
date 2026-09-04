"use client";

import React, { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import FacultyDashboard from '@/components/FacultyDashboard';
import MembersRoster from '@/components/MembersRoster';
import IDCard from '@/components/IDCard';
import Referrals from '@/components/Referrals';
import Tickets from '@/components/Tickets';
import Payments from '@/components/Payments';
import Footer from '@/components/Footer';
import SpecularButton from '@/components/SpecularButton';
import MaintenanceModal, {
  MaintenanceConfigState,
  MAINTENANCE_CATEGORIES,
} from '@/components/MaintenanceModal';
import PlannedEvents from '@/components/PlannedEvents';
import SuperAdminManagementModal from '@/components/SuperAdminManagementModal';
import SuperAdminControlCenter from '@/components/SuperAdminControlCenter';
import { useAuth } from '@/lib/auth-context';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  PermissionsConfig,
  DEFAULT_PERMISSIONS_CONFIG,
  resolveUserPagePermission,
  PageId,
} from '@/lib/permissions';

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

// ── Restricted module screen (shown when Super Admin has toggled off visibility for this role) ──
const RestrictedModuleScreen = ({
  pageTitle,
  onBack,
}: {
  pageTitle: string;
  onBack?: () => void;
}) => (
  <div className="flex-1 flex items-center justify-center p-6 select-none">
    <div className="max-w-md w-full bg-[#0d0517] border border-purple-900/60 rounded-3xl p-8 sm:p-10 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col items-center gap-5 text-center">
      <div className="w-16 h-16 rounded-2xl bg-purple-900/30 border border-purple-500/30 flex items-center justify-center text-purple-400">
        <span className="material-symbols-outlined text-3xl">lock</span>
      </div>
      <div className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-700/50">
          ACCESS RESTRICTED
        </div>
        <h2 className="text-2xl font-black text-white tracking-tight uppercase">Module Restricted</h2>
        <p className="text-slate-300 text-xs leading-relaxed">
          Access to the <span className="text-purple-300 font-bold">{pageTitle}</span> section is currently restricted for your role by the Club Super Administrator.
        </p>
      </div>
      {onBack && (
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer mt-2"
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
    isSuperAdmin,
    isAdmin,
    isPaymentAdmin,
    isFaculty,
    isAuthorized,
    memberData,
    userRole,
    authLoading,
    authError,
    handleLogin,
    handleLogout,
  } = useAuth();

  const [activePage, setActivePage] = useState<string>('dashboard');
  const [toast, setToast] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState<number>(0);
  const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState<boolean>(false);

  // ── Real-time Dynamic Page Permissions Matrix ───────────────────────────
  const [permissionsConfig, setPermissionsConfig] = useState<PermissionsConfig>(DEFAULT_PERMISSIONS_CONFIG);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'permissions'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as PermissionsConfig;
        setPermissionsConfig({
          roles: { ...DEFAULT_PERMISSIONS_CONFIG.roles, ...(data.roles || {}) },
          tiers: {
            members: { ...DEFAULT_PERMISSIONS_CONFIG.tiers.members, ...(data.tiers?.members || {}) },
            faculty: { ...DEFAULT_PERMISSIONS_CONFIG.tiers.faculty, ...(data.tiers?.faculty || {}) },
          },
          customRoles: data.customRoles || [],
          allowedMetadataRoles: data.allowedMetadataRoles || DEFAULT_PERMISSIONS_CONFIG.allowedMetadataRoles,
        });
      }
    });
    return () => unsub();
  }, []);

  const getPagePermission = (pageKey: string) => {
    if (pageKey === 'dashboard') return { canView: true, canEdit: true, bypassMaintenance: true };
    if (pageKey === 'superadmin') return { canView: isSuperAdmin, canEdit: isSuperAdmin, bypassMaintenance: true };
    return resolveUserPagePermission(
      pageKey as PageId,
      permissionsConfig,
      userRole,
      isSuperAdmin,
      isFaculty,
      isAuthorized
    );
  };

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
    const perm = getPagePermission(sectionKey);
    // If the role/tier has bypassMaintenance granted by Super Admin, never lock
    if (perm.bypassMaintenance) return false;

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

  // Parse initial tab from clean URL path (e.g. /referrals, /idcard, /payments, /members, /planned_events, /superadmin)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.replace(/^\//, '');
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      const validPaths = ['referrals', 'idcard', 'payments', 'dashboard', 'members', 'planned_events', 'superadmin'];

      if (path && validPaths.includes(path)) {
        setActivePage(path);
      } else if (tabParam && validPaths.includes(tabParam)) {
        setActivePage(tabParam);
      } else {
        setActivePage('dashboard');
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
      case 'planned_events': return 'Planned Events';
      case 'referrals': return 'Referrals';
      case 'idcard': return 'ID Card Portal';
      case 'payments': return isFaculty ? 'Faculty Payments Ledger' : 'Payments & Dues Portal';
      case 'superadmin': return 'Super Admin Enclave';
      case 'tickets': return 'Tickets';
      default: return 'Command Center';
    }
  };

  // ── Global loading screen (Modern Outlined VRGC with Laser Shimmer) ────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-transparent flex flex-col items-center justify-center p-6 relative overflow-hidden select-none">
        {/* Subtle background tech grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center gap-8 max-w-md w-full">
          {/* Centered Modern Outline VRGC Typography with Shimmer Effect */}
          <div className="relative flex items-center justify-center">
            {/* Ambient Solid Glow under logo */}
            <div className="absolute -inset-4 bg-purple-600/15 rounded-3xl blur-2xl pointer-events-none" />

            {/* SVG Modern Outlined VRGC with Laser Sweep */}
            <div className="relative w-72 h-24 sm:w-88 sm:h-28 flex items-center justify-center">
              <svg viewBox="0 0 320 100" className="w-full h-full overflow-visible">
                <defs>
                  {/* Laser Shimmer Gradient that sweeps across the letters */}
                  <linearGradient id="vrgcShimmer" x1="-100%" y1="0%" x2="200%" y2="0%">
                    <stop offset="0%" stopColor="#9333ea" stopOpacity="0.4" />
                    <stop offset="35%" stopColor="#a855f7" stopOpacity="0.8" />
                    <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
                    <stop offset="65%" stopColor="#a855f7" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#9333ea" stopOpacity="0.4" />
                    <animate
                      attributeName="x1"
                      from="-100%"
                      to="100%"
                      dur="2.2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="x2"
                      from="0%"
                      to="200%"
                      dur="2.2s"
                      repeatCount="indefinite"
                    />
                  </linearGradient>

                  {/* Outer Glow Filter */}
                  <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#a855f7" floodOpacity="0.7" />
                  </filter>
                </defs>

                {/* Base Dark Neon Outline */}
                <text
                  x="50%"
                  y="68%"
                  textAnchor="middle"
                  fill="none"
                  stroke="#3b0764"
                  strokeWidth="6"
                  strokeLinejoin="round"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  fontWeight="900"
                  fontSize="78"
                  letterSpacing="10"
                >
                  VRGC
                </text>

                {/* Shimmering Animated Foreground Stroke */}
                <text
                  x="50%"
                  y="68%"
                  textAnchor="middle"
                  fill="none"
                  stroke="url(#vrgcShimmer)"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter="url(#neonGlow)"
                  fontFamily="system-ui, -apple-system, sans-serif"
                  fontWeight="900"
                  fontSize="78"
                  letterSpacing="10"
                >
                  VRGC
                </text>
              </svg>
            </div>
          </div>

          {/* Loading Track & Details */}
          <div className="w-56 sm:w-64 space-y-3 text-center">
            {/* Shimmering Progress Bar */}
            <div className="w-full h-1 bg-[#1a0f2b] rounded-full overflow-hidden relative border border-purple-900/50">
              <div className="h-full bg-purple-500 rounded-full w-1/3 animate-shimmer-laser shadow-[0_0_10px_#a855f7]" />
            </div>

            <div className="space-y-1">
              <span className="font-label-caps text-[11px] font-black text-white tracking-[0.25em] block">
                VIRTUAL REALITY &amp; GAMING CLUB
              </span>
              <span className="font-mono text-[9px] text-purple-400 font-semibold tracking-widest block uppercase animate-pulse">
                INITIALIZING PROTOCOLS...
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 1. Require Sign In on initial load if user is not logged in ─────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#0e0518]/95 border border-purple-500/40 rounded-3xl p-8 sm:p-10 backdrop-blur-2xl shadow-[0_0_60px_rgba(168,85,247,0.25)] flex flex-col items-center gap-6 text-center animate-in fade-in duration-300">
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
          <SpecularButton
            size="md"
            radius={16}
            tint="#ffffff"
            tintOpacity={0.95}
            lineColor="#c084fc"
            baseColor="#581c87"
            intensity={1.2}
            textColor="#0f172a"
            onClick={handleLogin}
            className="w-full font-bold shadow-[0_0_25px_rgba(255,255,255,0.2)]"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span>Sign in with Google</span>
          </SpecularButton>
        </div>
      </div>
    );
  }

  // ── 2. Access denied screen (shown when non-member / unauthorized user signs in) ──
  if (authError && !isAuthorized) {
    return (
      <div className="min-h-screen bg-transparent flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-[#0e0518]/90 border border-rose-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(244,63,94,0.1)] flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-950 border border-rose-500/50 flex items-center justify-center">
            <span className="text-rose-400 text-3xl">🔒</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-rose-400 mb-1">Access Denied</h2>
            <p className="text-slate-400 text-sm">{authError}</p>
            <p className="text-slate-500 text-xs mt-1">Signed in as: {user.email}</p>
          </div>
          <SpecularButton
            size="sm"
            radius={12}
            tint="#e11d48"
            tintOpacity={0.2}
            lineColor="#fb7185"
            baseColor="#881337"
            intensity={1.1}
            onClick={handleLogout}
            className="font-semibold text-rose-300"
          >
            Sign Out &amp; Try Another Account
          </SpecularButton>
        </div>
      </div>
    );
  }

  // Helper for rendering sign-in prompt on restricted sub-pages when not signed in
  const renderRestrictedSignIn = (pageName: string) => (
    <div className="flex-1 flex items-center justify-center p-6 my-auto">
      <div className="max-w-md w-full bg-[#0e0518]/95 border border-purple-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.15)] flex flex-col items-center gap-6 text-center">
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
        <SpecularButton
          size="md"
          radius={14}
          tint="#ffffff"
          tintOpacity={0.95}
          lineColor="#c084fc"
          baseColor="#581c87"
          intensity={1.2}
          textColor="#0f172a"
          onClick={handleLogin}
          className="w-full font-bold shadow-[0_0_25px_rgba(255,255,255,0.2)]"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>Sign in with Google</span>
        </SpecularButton>
        <p className="text-xs text-slate-500">Only authorized VRGC members and faculty can access this section.</p>
      </div>
    </div>
  );

  // ── Main app shell ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-transparent text-[#e2e8f0] flex flex-col custom-scrollbar">
      <Navbar
        pageTitle={getPageTitle()}
        activePage={activePage}
        userEmail={userEmail}
        user={user}
        memberData={memberData}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        isFaculty={isFaculty}
        userRole={userRole}
        onLogout={handleLogout}
        onLogin={handleLogin}
        onOpenSuperAdminModal={() => setIsSuperAdminModalOpen(true)}
        onPageChange={handlePageChange}
        onOpenMaintenanceModal={() => setIsMaintenanceModalOpen(true)}
      />

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
          isSuperAdmin={isSuperAdmin}
          isFaculty={isFaculty}
          isAuthorized={isAuthorized}
          userRole={userRole}
          permissionsConfig={permissionsConfig}
        />

        <main className="flex-grow min-w-0 pb-24 md:pb-12 min-h-[calc(100vh-76px)] flex flex-col">
          {/* Permission restriction check across modules */}
          {activePage !== 'dashboard' && !getPagePermission(activePage).canView && (
            <RestrictedModuleScreen
              pageTitle={getPageTitle()}
              onBack={() => handlePageChange('dashboard')}
            />
          )}

          {activePage === 'dashboard' && (
            isFaculty ? (
              <FacultyDashboard
                onPageChange={handlePageChange}
                facultyName={memberData?.name}
                facultyEmail={userEmail}
              />
            ) : (
              <Dashboard
                onPageChange={handlePageChange}
                onOpenSuperAdminModal={() => handlePageChange('superadmin')}
              />
            )
          )}

          {activePage === 'superadmin' && (
            isSuperAdmin ? (
              <SuperAdminControlCenter
                onRedirect={() => handlePageChange('dashboard')}
                currentUserEmail={userEmail || ''}
              />
            ) : (
              <RestrictedModuleScreen
                pageTitle="Super Admin Enclave"
                onBack={() => handlePageChange('dashboard')}
              />
            )
          )}

          {activePage === 'members' && getPagePermission('members').canView && (
            isSectionLocked('members') ? (
              <MaintenanceScreen
                section="Members Roster"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : (
              <MembersRoster
                onRedirect={() => handlePageChange('dashboard')}
                isAdmin={getPagePermission('members').canEdit}
              />
            )
          )}

          {activePage === 'planned_events' && getPagePermission('planned_events').canView && (
            isSectionLocked('planned_events') ? (
              <MaintenanceScreen
                section="Planned Events"
                onBack={() => handlePageChange('dashboard')}
              />
            ) : (
              <PlannedEvents
                onRedirect={() => handlePageChange('dashboard')}
                isAdmin={getPagePermission('planned_events').canEdit}
                isFaculty={isFaculty}
                userEmail={userEmail}
                userName={memberData?.name || user?.displayName || undefined}
              />
            )
          )}

          {activePage === 'referrals' && getPagePermission('referrals').canView && (
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
                externalIsAdmin={getPagePermission('referrals').canEdit}
                externalIsAuthorized={isAuthorized}
              />
            ) : (
              renderRestrictedSignIn('Referrals')
            )
          )}

          {activePage === 'idcard' && getPagePermission('idcard').canView && (
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
                externalIsAdmin={getPagePermission('idcard').canEdit}
                externalIsAuthorized={isAuthorized}
                onLogout={handleLogout}
              />
            ) : (
              renderRestrictedSignIn('ID Card Portal')
            )
          )}

          {activePage === 'payments' && getPagePermission('payments').canView && (
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
                externalIsAdmin={getPagePermission('payments').canEdit}
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

      {/* Super Admin Command Center Modal */}
      {isSuperAdmin && (
        <SuperAdminManagementModal
          isOpen={isSuperAdminModalOpen}
          onClose={() => setIsSuperAdminModalOpen(false)}
          currentUserEmail={userEmail}
        />
      )}

      {/* Mobile Bottom Nav - Sleek, Compact, Non-Intrusive */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-[#090214]/95 backdrop-blur-xl border-t border-[#2b1442] flex items-center justify-around px-1 z-40 select-none shadow-[0_-5px_20px_rgba(0,0,0,0.8)]">
        {isFaculty ? (
          <>
            <button
              onClick={() => handlePageChange('dashboard')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'dashboard' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">dashboard</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">HOME</span>
            </button>
            <button
              onClick={() => handlePageChange('members')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'members' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">groups</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">ROSTER</span>
            </button>
            <button
              onClick={() => handlePageChange('planned_events')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'planned_events' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">event_upcoming</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">EVENTS</span>
            </button>
            <button
              onClick={() => handlePageChange('payments')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'payments' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">payments</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">PAYMENTS</span>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => handlePageChange('dashboard')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'dashboard' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">dashboard</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">HOME</span>
            </button>
            <button
              onClick={() => handlePageChange('members')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'members' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">groups</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">ROSTER</span>
            </button>
            <button
              onClick={() => handlePageChange('planned_events')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'planned_events' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">event_upcoming</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">EVENTS</span>
            </button>
            <button
              onClick={() => handlePageChange('idcard')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'idcard' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">badge</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">ID CARD</span>
            </button>
            <button
              onClick={() => handlePageChange('payments')}
              className={`flex flex-col items-center justify-center flex-1 py-1 transition-all ${
                activePage === 'payments' ? 'text-purple-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="material-symbols-outlined text-lg">payments</span>
              <span className="font-mono text-[8px] tracking-wider uppercase">PAY</span>
            </button>
          </>
        )}
      </nav>

      {/* Floating Maintenance Toolset FAB Logo — Solid Dark/Purple */}
      {isPaymentAdmin && (
        <button
          onClick={() => setIsMaintenanceModalOpen(true)}
          title="Configure Maintenance Mode"
          className="fixed bottom-16 md:bottom-10 right-4 md:right-6 z-40 p-2.5 sm:p-3.5 rounded-full bg-purple-700 hover:bg-purple-600 text-white shadow-[0_0_20px_rgba(147,51,234,0.4)] border border-purple-400 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center justify-center group cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg sm:text-xl group-hover:rotate-45 transition-transform duration-300">
            construction
          </span>
          <span className="max-w-0 overflow-hidden group-hover:max-w-xs transition-all duration-300 whitespace-nowrap text-[11px] font-bold font-mono pl-0 group-hover:pl-2">
            Maintenance Desk
          </span>
        </button>
      )}

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
