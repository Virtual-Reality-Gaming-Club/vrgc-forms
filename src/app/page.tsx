"use client";

import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Dashboard from '@/components/Dashboard';
import IDCard from '@/components/IDCard';
import Referrals from '@/components/Referrals';
import Tickets from '@/components/Tickets';
import Payments from '@/components/Payments';
import Lobby25MemberEntry from '@/components/Lobby25MemberEntry';
import Lobby24MemberEntry from '@/components/Lobby24MemberEntry';
import { useAuth } from '@/lib/auth-context';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const googleProvider = new GoogleAuthProvider();

// ─── Inner app that consumes the auth context ───────────────────────────────
function AppContent() {
  const { user, userEmail, isAdmin, isAuthorized, memberData, authLoading, authError, handleLogin, handleLogout } = useAuth();
  const [activePage, setActivePage] = useState<string>('dashboard');
  const [toast, setToast] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState<number>(0);

  const showToast = (message: string) => {
    setToast(message);
    setToastKey((prev) => prev + 1);
    setTimeout(() => setToast(null), 3000);
  };

  const handlePageChange = (pageId: string) => {
    if (pageId === 'tickets') {
      showToast('This section is locked and will be available in a future update.');
      return;
    }
    setActivePage(pageId);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const getPageTitle = () => {
    switch (activePage) {
      case 'dashboard': return 'Dashboard';
      case 'batch25': return 'Lobby 25';
      case 'batch24': return 'Lobby 24';
      case 'referrals': return 'Referrals';
      case 'idcard': return 'ID Card Portal';
      case 'payments': return 'Payments & Dues Portal';
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

  // ── Access denied (signed in with account not registered as a member or admin) ─────────────────────────
  if (user && !isAuthorized) {
    return (
      <div className="min-h-screen bg-[#05010a] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-[#0e0518]/80 border border-rose-500/30 rounded-2xl p-8 backdrop-blur-xl shadow-[0_0_60px_rgba(244,63,94,0.1)] flex flex-col items-center gap-6 text-center">
          <div className="w-16 h-16 rounded-full bg-rose-950 border border-rose-500/50 flex items-center justify-center">
            <span className="text-rose-400 text-3xl">🔒</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-rose-400 mb-1">Access Denied</h2>
            <p className="text-slate-400 text-sm">{authError || 'Your account is not registered as a VRGC member.'}</p>
            <p className="text-slate-500 text-xs mt-1">Signed in as: {user.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-6 py-2.5 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 font-semibold rounded-xl transition-all text-sm"
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
          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-900 font-bold py-3 px-6 rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
        <p className="text-xs text-slate-500">Only registered VRGC members can access this section.</p>
      </div>
    </div>
  );

  // ── Main app shell (Dashboard is public, sub-pages require sign-in) ───────
  return (
    <div className="min-h-screen bg-[#05010a] text-[#e2e8f0] flex flex-col custom-scrollbar">
      <Navbar pageTitle={getPageTitle()} userEmail={userEmail} isAdmin={isAdmin} onLogout={handleLogout} onLogin={handleLogin} />

      <div className="flex flex-1">
        <Sidebar activePage={activePage} onPageChange={handlePageChange} isAdmin={isAdmin} />

        <main className="flex-grow min-w-0 pb-24 md:pb-12 min-h-[calc(100vh-76px)] flex flex-col">
          {activePage === 'dashboard' && <Dashboard onPageChange={handlePageChange} />}
          {activePage === 'batch25' && (
            user ? <Lobby25MemberEntry onRedirect={() => handlePageChange('dashboard')} /> : renderRestrictedSignIn('Lobby 25')
          )}
          {activePage === 'batch24' && (
            user ? <Lobby24MemberEntry onRedirect={() => handlePageChange('dashboard')} /> : renderRestrictedSignIn('Lobby 24')
          )}
          {activePage === 'referrals' && (
            user ? <Referrals onRedirect={() => handlePageChange('dashboard')} /> : renderRestrictedSignIn('Referrals')
          )}
          {activePage === 'idcard' && (
            user ? (
              <IDCard
                onRedirect={() => handlePageChange('dashboard')}
                externalUser={user}
                externalMemberData={memberData}
                externalIsAdmin={isAdmin}
                externalIsAuthorized={isAuthorized}
                onLogout={handleLogout}
              />
            ) : renderRestrictedSignIn('ID Card Portal')
          )}
          {activePage === 'payments' && (
            user ? (
              <Payments
                onRedirect={() => handlePageChange('dashboard')}
                externalUser={user}
                externalUserEmail={userEmail}
                externalIsAdmin={isAdmin}
              />
            ) : renderRestrictedSignIn('Payments & Dues')
          )}
          {activePage === 'tickets' && <Tickets onRedirect={() => handlePageChange('dashboard')} />}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0e0518]/95 backdrop-blur-lg border-t border-purple-500/30 flex justify-around py-3 z-50">
        <button onClick={() => handlePageChange('dashboard')} className={`flex flex-col items-center gap-1 ${activePage === 'dashboard' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
          <span className="material-symbols-outlined text-xl">dashboard</span>
          <span className="font-label-caps text-[9px]">HOME</span>
        </button>
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
        <button onClick={() => handlePageChange('tickets')} className={`flex flex-col items-center gap-1 ${activePage === 'tickets' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}>
          <span className="material-symbols-outlined text-xl">confirmation_number</span>
          <span className="font-label-caps text-[9px]">TICKETS</span>
        </button>
      </nav>

      {/* Toast */}
      {toast && (
        <div key={toastKey} className="fixed top-20 right-4 md:right-8 z-[100] bg-[#13091f]/95 border border-purple-500/40 backdrop-blur-xl px-6 py-4 rounded-xl shadow-[0_0_30px_rgba(168,85,247,0.3)] text-white flex items-center gap-3">
          <span className="material-symbols-outlined text-purple-400">info</span>
          <span className="text-xs font-bold">{toast}</span>
        </div>
      )}
    </div>
  );
}

// ─── Root export — AuthProvider lives in layout.tsx (global) ─────────────────
export default function Home() {
  return <AppContent />;
}
