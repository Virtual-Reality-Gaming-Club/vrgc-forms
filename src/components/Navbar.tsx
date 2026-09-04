"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { User } from 'firebase/auth';
import SpecularButton from './SpecularButton';

interface NavbarProps {
  pageTitle?: string;
  activePage?: string;
  userEmail?: string | null;
  user?: User | null;
  memberData?: { name?: string; fullName?: string; registrationNumber?: string; regNo?: string } | null;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  isFaculty?: boolean;
  userRole?: string | null;
  onLogout?: () => Promise<void> | void;
  onLogin?: () => Promise<void> | void;
  onOpenSuperAdminModal?: () => void;
  onPageChange?: (pageId: string) => void;
  onOpenMaintenanceModal?: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
  pageTitle = 'Dashboard',
  activePage = 'dashboard',
  userEmail,
  user,
  memberData,
  isAdmin,
  isSuperAdmin,
  isFaculty,
  userRole,
  onLogout,
  onLogin,
  onOpenSuperAdminModal,
  onPageChange,
  onOpenMaintenanceModal,
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const extractRegNo = (emailAddress?: string | null) => {
    if (!emailAddress) return null;
    const match = emailAddress.match(/\b\d{2}[a-zA-Z]{3}\d{5}\b/);
    return match ? match[0].toUpperCase() : null;
  };

  const regNo = memberData?.registrationNumber || memberData?.regNo || extractRegNo(userEmail);
  const rawName = user?.displayName || memberData?.name || memberData?.fullName || (userEmail ? userEmail.split('@')[0] : 'User');
  const firstName = rawName.trim().split(' ')[0];
  const photoUrl = user?.photoURL || null;

  const handleMobileNavClick = (pageId: string) => {
    setIsMobileMenuOpen(false);
    if (onPageChange) {
      onPageChange(pageId);
    }
  };

  return (
    <>
      <header className="bg-black/90 backdrop-blur-2xl flex justify-between items-center w-full px-3 sm:px-6 md:px-12 py-2.5 sm:py-4 sticky top-0 z-50 border-b border-[#a855f7]/20 shadow-[0_5px_30px_rgba(0,0,0,0.7)] select-none">
        {/* Background subtle scan line */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.002)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none opacity-45"></div>

        <div className="flex items-center gap-2 sm:gap-6 relative z-10 min-w-0">
          {/* Brand Group */}
          <Link href="/" className="flex items-center gap-1.5 sm:gap-3 group cursor-pointer shrink-0">
            <div className="relative">
              <span className="text-xs sm:text-base md:text-lg font-black tracking-wider sm:tracking-widest text-white group-hover:text-purple-300 transition-colors">
                VRGC <span className="text-purple-400">|</span> Forms
              </span>
            </div>
          </Link>

          {/* Current Active Console Tab Badge */}
          <div className="hidden md:flex items-center gap-2 pl-4 border-l border-white/10">
            <span className="material-symbols-outlined text-[13px] text-[#a855f7] animate-pulse">terminal</span>
            <span className="font-code-sm text-[10px] text-white/50 tracking-wider">
              [ <span className="text-white font-bold uppercase">{pageTitle}</span> ]
            </span>
          </div>
        </div>

        {/* Right side: user info + status + auth buttons */}
        <div className="flex items-center gap-1.5 sm:gap-3 relative z-10 shrink-0">
          
          {/* Super Admin Badge - Visible on both Mobile and Desktop */}
          {isSuperAdmin && (
            <SpecularButton
              size="xs"
              radius={8}
              tint="#9333ea"
              tintOpacity={0.4}
              lineColor="#c084fc"
              baseColor="#581c87"
              intensity={1.2}
              onClick={() => {
                if (onPageChange) onPageChange('superadmin');
                else onOpenSuperAdminModal?.();
              }}
              className="text-[8px] sm:text-[9px] font-black uppercase text-white shadow-[0_0_10px_rgba(147,51,234,0.35)]"
              title="Open Super Admin Command Enclave"
            >
              <span className="material-symbols-outlined text-[11px] sm:text-[12px]">admin_panel_settings</span>
              <span>SUPER ADMIN</span>
            </SpecularButton>
          )}

          {/* Admin Role Badge */}
          {!isSuperAdmin && isAdmin && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[8px] sm:text-[9px] font-bold border ${
              userRole === 'Technical'
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-600/50'
                : userRole === 'Payment Admin'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                : 'bg-purple-950/80 text-purple-300 border-purple-600/50'
            }`}>
              <span className="material-symbols-outlined text-[10px] sm:text-[11px]">
                {userRole === 'Technical' ? 'terminal' : userRole === 'Payment Admin' ? 'account_balance_wallet' : 'shield'}
              </span>
              {userRole ? userRole.toUpperCase() : 'ADMIN'}
            </span>
          )}

          {/* Faculty Badge */}
          {isFaculty && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[8px] sm:text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
              <span className="material-symbols-outlined text-[10px] sm:text-[11px]">school</span>
              FACULTY
            </span>
          )}

          {/* User First Name & Google Photo Pill (desktop) */}
          {userEmail && (
            <div className="hidden md:flex items-center gap-2 bg-[#12081c]/80 rounded-full px-3 py-1 border border-purple-500/30 max-w-[200px]">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={firstName || 'User Avatar'}
                  className="w-5 h-5 rounded-full object-cover border border-purple-400/40 shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="material-symbols-outlined text-[14px] text-purple-400 shrink-0">account_circle</span>
              )}
              <span className="text-xs text-white font-extrabold truncate">{firstName}</span>
            </div>
          )}

          {/* Active Status Heartbeat Pill */}
          <div className="bg-[#12081c]/80 rounded-full px-2 sm:px-3 py-0.5 sm:py-1 border border-[#a855f7]/30 items-center gap-1 sm:gap-1.5 flex shadow-[0_0_10px_rgba(147,51,234,0.1)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-400"></span>
            </span>
            <span className="font-mono text-[7.5px] sm:text-[9px] text-white font-black tracking-widest uppercase">ACTIVE</span>
          </div>

          {/* Sign In Button (when logged out) */}
          {onLogin && !userEmail && (
            <SpecularButton
              size="xs"
              radius={8}
              tint="#9333ea"
              tintOpacity={0.4}
              lineColor="#c084fc"
              baseColor="#581c87"
              intensity={1.2}
              onClick={onLogin}
              title="Sign In with Google"
              className="text-[10px] sm:text-[11px] font-bold text-white shadow-[0_0_12px_rgba(147,51,234,0.4)]"
            >
              <span className="material-symbols-outlined text-[12px]">login</span>
              <span>Sign In</span>
            </SpecularButton>
          )}

          {/* Mobile Menu Hamburger Button */}
          {userEmail && (
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-1.5 rounded-lg bg-[#1a1126] border border-purple-500/40 text-purple-300 hover:text-white transition-colors cursor-pointer"
              title="Toggle Navigation Menu"
              aria-label="Toggle Navigation Menu"
            >
              <span className="material-symbols-outlined text-lg block">
                {isMobileMenuOpen ? 'close' : 'menu'}
              </span>
            </button>
          )}

          {/* Sign Out Button (desktop) */}
          {onLogout && userEmail && (
            <SpecularButton
              size="xs"
              radius={8}
              tint="#e11d48"
              tintOpacity={0.15}
              lineColor="#fb7185"
              baseColor="#881337"
              intensity={1}
              onClick={onLogout}
              title="Sign Out"
              className="hidden md:flex text-[10px] font-bold text-rose-300"
            >
              <span className="material-symbols-outlined text-[13px]">logout</span>
              <span>Sign Out</span>
            </SpecularButton>
          )}
        </div>
      </header>

      {/* Mobile Slide-down Navigation Drawer */}
      {isMobileMenuOpen && userEmail && (
        <div className="md:hidden fixed top-[49px] left-0 right-0 bg-[#0c0417]/98 backdrop-blur-2xl border-b border-purple-500/30 shadow-[0_15px_40px_rgba(0,0,0,0.8)] z-40 p-4 space-y-3 animate-in slide-in-from-top-2 duration-200 select-none max-h-[calc(100vh-60px)] overflow-y-auto custom-scrollbar">
          
          {/* User info strip on mobile */}
          <div className="flex items-center justify-between pb-3 border-b border-purple-900/40">
            <div className="flex items-center gap-2.5">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={firstName}
                  className="w-8 h-8 rounded-full border border-purple-500/40 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-purple-900 flex items-center justify-center text-white">
                  <span className="material-symbols-outlined text-base">person</span>
                </div>
              )}
              <div>
                <div className="text-xs font-bold text-white leading-none">{rawName}</div>
                <div className="text-[10px] text-purple-400 font-mono mt-0.5">{userEmail}</div>
              </div>
            </div>
            {regNo && (
              <span className="text-[9px] font-mono font-bold bg-[#1e132e] text-purple-300 border border-purple-800 px-2 py-0.5 rounded">
                {regNo}
              </span>
            )}
          </div>

          {/* Navigation Links */}
          <div className="grid grid-cols-2 gap-2 text-xs font-bold">
            <button
              onClick={() => handleMobileNavClick('dashboard')}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                activePage === 'dashboard'
                  ? 'bg-purple-700 text-white border-purple-500'
                  : 'bg-[#150a24] text-slate-300 border-purple-900/40 hover:bg-[#1f0f35]'
              }`}
            >
              <span className="material-symbols-outlined text-base text-purple-300">dashboard</span>
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => handleMobileNavClick('members')}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                activePage === 'members'
                  ? 'bg-purple-700 text-white border-purple-500'
                  : 'bg-[#150a24] text-slate-300 border-purple-900/40 hover:bg-[#1f0f35]'
              }`}
            >
              <span className="material-symbols-outlined text-base text-purple-300">groups</span>
              <span>Members Roster</span>
            </button>

            <button
              onClick={() => handleMobileNavClick('planned_events')}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                activePage === 'planned_events'
                  ? 'bg-purple-700 text-white border-purple-500'
                  : 'bg-[#150a24] text-slate-300 border-purple-900/40 hover:bg-[#1f0f35]'
              }`}
            >
              <span className="material-symbols-outlined text-base text-purple-300">event_upcoming</span>
              <span>Planned Events</span>
            </button>

            <button
              onClick={() => handleMobileNavClick('payments')}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                activePage === 'payments'
                  ? 'bg-purple-700 text-white border-purple-500'
                  : 'bg-[#150a24] text-slate-300 border-purple-900/40 hover:bg-[#1f0f35]'
              }`}
            >
              <span className="material-symbols-outlined text-base text-purple-300">payments</span>
              <span>Payments</span>
            </button>

            <button
              onClick={() => handleMobileNavClick('idcard')}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                activePage === 'idcard'
                  ? 'bg-purple-700 text-white border-purple-500'
                  : 'bg-[#150a24] text-slate-300 border-purple-900/40 hover:bg-[#1f0f35]'
              }`}
            >
              <span className="material-symbols-outlined text-base text-purple-300">badge</span>
              <span>ID Card</span>
            </button>

            <button
              onClick={() => handleMobileNavClick('referrals')}
              className={`flex items-center gap-2 p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                activePage === 'referrals'
                  ? 'bg-purple-700 text-white border-purple-500'
                  : 'bg-[#150a24] text-slate-300 border-purple-900/40 hover:bg-[#1f0f35]'
              }`}
            >
              <span className="material-symbols-outlined text-base text-purple-300">share</span>
              <span>Referrals</span>
            </button>
          </div>

          {/* Admin & Super Admin Action Triggers */}
          {(isSuperAdmin || isAdmin) && (
            <div className="pt-2 border-t border-purple-900/40 space-y-2">
              {isSuperAdmin && (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    if (onPageChange) onPageChange('superadmin');
                    else onOpenSuperAdminModal?.();
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-purple-900/80 border border-purple-500 text-white text-xs font-bold shadow-[0_0_15px_rgba(147,51,234,0.3)] cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base">admin_panel_settings</span>
                    <span>Super Admin Enclave</span>
                  </span>
                  <span className="material-symbols-outlined text-sm">chevron_right</span>
                </button>
              )}

              {isAdmin && onOpenMaintenanceModal && (
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    onOpenMaintenanceModal();
                  }}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#1e162b] border border-purple-700 text-purple-200 text-xs font-bold cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base">construction</span>
                    <span>Maintenance Desk</span>
                  </span>
                  <span className="material-symbols-outlined text-sm">chevron_right</span>
                </button>
              )}
            </div>
          )}

          {/* Sign Out */}
          {onLogout && (
            <div className="pt-2 border-t border-purple-900/40">
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-400 text-xs font-bold cursor-pointer hover:bg-rose-950/60 transition-colors"
              >
                <span className="material-symbols-outlined text-sm">logout</span>
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default Navbar;
