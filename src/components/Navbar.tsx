"use client";

import React from 'react';

interface NavbarProps {
  pageTitle?: string;
  userEmail?: string | null;
  isAdmin?: boolean;
  onLogout?: () => Promise<void>;
  onLogin?: () => Promise<void>;
}

const Navbar: React.FC<NavbarProps> = ({ pageTitle = 'Dashboard', userEmail, isAdmin, onLogout, onLogin }) => {
  return (
    <header className="bg-black/85 backdrop-blur-2xl flex justify-between items-center w-full px-3.5 sm:px-6 md:px-12 py-3 sm:py-5 sticky top-0 z-50 border-b border-[#a855f7]/20 shadow-[0_5px_30px_rgba(168,85,247,0.05)] select-none">
      {/* Background cyber grid effect in nav */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.002)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none opacity-45"></div>

      <div className="flex items-center gap-3 sm:gap-6 relative z-10 min-w-0">
        {/* Brand Group */}
        <div className="flex items-center gap-2 sm:gap-3 group cursor-pointer shrink-0">
          <div className="relative">
            <span className="font-display-lg text-xs sm:text-base md:text-lg font-black tracking-wider sm:tracking-widest bg-gradient-to-r from-white via-white to-[#a855f7] bg-clip-text text-transparent group-hover:opacity-90 transition-opacity">
              VRGC | Forms Portal
            </span>
            <div className="absolute -bottom-1 left-0 w-full h-[2px] bg-gradient-to-r from-[#a855f7] to-[#cf5cff] scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left"></div>
          </div>
        </div>

        {/* Current Active Console Tab Badge */}
        <div className="hidden md:flex items-center gap-2 pl-4 border-l border-white/10">
          <span className="material-symbols-outlined text-[13px] text-[#a855f7] animate-pulse">terminal</span>
          <span className="font-code-sm text-[10px] text-white/50 tracking-wider">
            [ <span className="text-white font-bold uppercase">{pageTitle}</span> ]
          </span>
        </div>
      </div>

      {/* Stats/Status items */}
      <div className="flex items-center gap-2 sm:gap-4 relative z-10 shrink-0">
        <div className="hidden sm:flex md:hidden">
          <span className="font-code-sm text-[9px] text-white/50 tracking-wider">
            [ <span className="text-[#a855f7] font-bold uppercase">{pageTitle}</span> ]
          </span>
        </div>

        {/* Active Heartbeat Pill */}
        <div className="bg-[#12081c]/80 rounded-full px-2.5 sm:px-4 py-1 sm:py-1.5 border border-[#a855f7]/30 items-center gap-1.5 sm:gap-2 flex shadow-[0_0_15px_rgba(168,85,247,0.1)]">
          <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-green-400"></span>
          </span>
          <span className="font-code-sm text-[8px] sm:text-[9px] text-white font-black tracking-widest uppercase">ACTIVE</span>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
