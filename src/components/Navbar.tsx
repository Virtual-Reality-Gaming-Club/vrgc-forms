"use client";

import React from 'react';
import Link from 'next/link';

import { User } from 'firebase/auth';

interface NavbarProps {
  pageTitle?: string;
  userEmail?: string | null;
  user?: User | null;
  memberData?: { name?: string; fullName?: string; registrationNumber?: string; regNo?: string } | null;
  isAdmin?: boolean;
  isFaculty?: boolean;
  onLogout?: () => Promise<void> | void;
  onLogin?: () => Promise<void> | void;
}

const Navbar: React.FC<NavbarProps> = ({ pageTitle = 'Dashboard', userEmail, user, memberData, isAdmin, isFaculty, onLogout, onLogin }) => {
  const extractRegNo = (emailAddress?: string | null) => {
    if (!emailAddress) return null;
    const match = emailAddress.match(/\b\d{2}[a-zA-Z]{3}\d{5}\b/);
    return match ? match[0].toUpperCase() : null;
  };

  const regNo = memberData?.registrationNumber || memberData?.regNo || extractRegNo(userEmail);
  const rawName = user?.displayName || memberData?.name || memberData?.fullName || (userEmail ? userEmail.split('@')[0] : 'User');
  const firstName = rawName.trim().split(' ')[0];
  const photoUrl = user?.photoURL || null;

  return (
    <header className="bg-black/85 backdrop-blur-2xl flex justify-between items-center w-full px-3.5 sm:px-6 md:px-12 py-3 sm:py-5 sticky top-0 z-50 border-b border-[#a855f7]/20 shadow-[0_5px_30px_rgba(168,85,247,0.05)] select-none">
      {/* Background cyber grid effect in nav */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.002)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none opacity-45"></div>

      <div className="flex items-center gap-3 sm:gap-6 relative z-10 min-w-0">
        {/* Brand Group */}
        <Link href="/" className="flex items-center gap-2 sm:gap-3 group cursor-pointer shrink-0">
          <div className="relative">
            <span className="font-display-lg text-xs sm:text-base md:text-lg font-black tracking-wider sm:tracking-widest bg-gradient-to-r from-white via-white to-[#a855f7] bg-clip-text text-transparent group-hover:opacity-90 transition-opacity">
              VRGC | Forms Portal
            </span>
            <div className="absolute -bottom-1 left-0 w-full h-[2px] bg-gradient-to-r from-[#a855f7] to-[#cf5cff] scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></div>
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
      <div className="flex items-center gap-2 sm:gap-3 relative z-10 shrink-0">
        {/* Admin Badge */}
        {isAdmin && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
            <span className="material-symbols-outlined text-[11px]">shield</span>
            ADMIN
          </span>
        )}

        {/* Faculty Badge */}
        {isFaculty && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-[0_0_10px_rgba(99,102,241,0.2)]">
            <span className="material-symbols-outlined text-[11px]">school</span>
            FACULTY
          </span>
        )}

        {/* User First Name & Google Photo Pill (email & reg number hidden) */}
        {userEmail && (
          <div className="hidden md:flex items-center gap-2 bg-[#12081c]/80 rounded-full px-3 py-1 border border-purple-500/30 max-w-[200px]">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={firstName || 'User Avatar'}
                className="w-6 h-6 rounded-full object-cover border border-purple-400/40 shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="material-symbols-outlined text-[15px] text-purple-400 shrink-0">account_circle</span>
            )}
            <span className="text-xs text-white font-extrabold truncate">{firstName}</span>
          </div>
        )}

        {/* Active Status Heartbeat Pill */}
        <div className="bg-[#12081c]/80 rounded-full px-2.5 sm:px-3.5 py-1 sm:py-1.5 border border-[#a855f7]/30 items-center gap-1.5 flex shadow-[0_0_15px_rgba(168,85,247,0.1)]">
          <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-green-400"></span>
          </span>
          <span className="font-code-sm text-[8px] sm:text-[9px] text-white font-black tracking-widest uppercase">ACTIVE</span>
        </div>

        {/* Sign In Button (when logged out) */}
        {onLogin && !userEmail && (
          <button
            onClick={onLogin}
            title="Sign In with Google"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all duration-200"
          >
            <span className="material-symbols-outlined text-[13px]">login</span>
            <span>Sign In</span>
          </button>
        )}

        {/* Sign Out Button (when logged in) */}
        {onLogout && userEmail && (
          <button
            onClick={onLogout}
            title="Sign Out"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-[10px] font-bold transition-all duration-200"
          >
            <span className="material-symbols-outlined text-[13px]">logout</span>
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        )}
      </div>
    </header>
  );
};

export default Navbar;
