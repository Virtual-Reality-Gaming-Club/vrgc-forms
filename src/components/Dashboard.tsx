"use client";

import React, { useRef, useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';

interface DashboardProps {
  onPageChange: (page: string) => void;
  onOpenSuperAdminModal?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onPageChange, onOpenSuperAdminModal }) => {
  const { user, userEmail, memberData, isAdmin, isSuperAdmin, isFaculty, userRole } = useAuth();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [transformStyle, setTransformStyle] = useState<React.CSSProperties>({});

  // Mouse tilt handlers for desktop (solid 3D feel)
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateY = ((x - centerX) / centerX) * 8;
    const rotateX = -((y - centerY) / centerY) * 8;

    setTransformStyle({
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`,
      transition: 'transform 0.1s ease-out',
    });
  };

  const handleMouseLeave = () => {
    setTransformStyle({
      transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
      transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
    });
  };

  // Device orientation tilt handler for mobile
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const { beta, gamma } = e;
      if (beta === null || gamma === null) return;
      const clampedBeta = Math.min(Math.max(beta, -30), 30);
      const clampedGamma = Math.min(Math.max(gamma, -30), 30);
      const rotateX = (clampedBeta / 30) * 8;
      const rotateY = (clampedGamma / 30) * 8;

      setTransformStyle({
        transform: `perspective(1000px) rotateX(${-rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`,
        transition: 'transform 0.2s ease-out',
      });
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, []);

  // Personalized user info calculation
  const rawFullName = memberData?.name || user?.displayName || (userEmail ? userEmail.split('@')[0] : 'Member');
  const firstName = rawFullName.trim().split(' ')[0] || 'Member';
  const designation = (isSuperAdmin ? 'Super Administrator' : userRole) || memberData?.position || (isAdmin ? 'Administrator' : isFaculty ? 'Faculty Mentor' : 'Club Member');
  const teamName = memberData?.team || (userRole === 'Technical' ? 'Technical Division' : userRole === 'Payment Admin' ? 'Finance & Treasury' : isFaculty ? 'Faculty Advisory' : (isSuperAdmin || isAdmin) ? 'Management' : 'General Crew');
  const regNumber = memberData?.registrationNumber || (isSuperAdmin ? 'SUPER ADMIN' : userRole ? userRole.toUpperCase() : isAdmin ? 'ADMIN' : isFaculty ? 'FACULTY' : '');

  return (
    <div className="flex-grow min-h-[calc(100vh-117px)] overflow-y-auto p-3 sm:p-6 md:p-8 bg-transparent relative text-left select-none">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        
        {/* Personalized Welcome & Hero Section (Strictly SOLID colors - NO GRADIENTS) */}
        <section className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5 p-4 sm:p-6 lg:p-7 bg-[#121212] border border-[#2b193d] rounded-2xl sm:rounded-3xl shadow-[0_0_30px_rgba(0,0,0,0.6)]">
          <div className="space-y-3 max-w-2xl text-left w-full">
            {/* Top Status Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black tracking-widest uppercase bg-purple-700 text-white border border-purple-500 flex items-center gap-1.5 shadow-[0_0_10px_rgba(147,51,234,0.3)]">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                COMMAND CENTER
              </span>

              {isSuperAdmin ? (
                <span className="px-2.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black tracking-widest uppercase bg-purple-950 text-purple-200 border border-purple-600 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">verified_user</span>
                  SUPER ADMIN
                </span>
              ) : userRole === 'Payment Admin' ? (
                <span className="px-2.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black tracking-widest uppercase bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">account_balance_wallet</span>
                  PAYMENT ADMIN
                </span>
              ) : userRole === 'Technical' ? (
                <span className="px-2.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black tracking-widest uppercase bg-cyan-950 text-cyan-300 border border-cyan-700 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">terminal</span>
                  TECHNICAL
                </span>
              ) : isAdmin ? (
                <span className="px-2.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black tracking-widest uppercase bg-[#1f162b] text-purple-300 border border-purple-700/60 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">shield</span>
                  CLUB ADMIN
                </span>
              ) : isFaculty ? (
                <span className="px-2.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black tracking-widest uppercase bg-[#141b2d] text-indigo-300 border border-indigo-600 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">school</span>
                  FACULTY MENTOR
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-md text-[9px] sm:text-[10px] font-black tracking-widest uppercase bg-[#181818] text-slate-300 border border-[#333333] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">badge</span>
                  VERIFIED MEMBER
                </span>
              )}

              {regNumber && (
                <span className="px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-mono font-bold bg-[#1a1a1a] text-purple-300 border border-[#2e2e2e]">
                  {regNumber}
                </span>
              )}
            </div>

            {/* Main Personalized Greeting */}
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tight flex items-baseline gap-2 flex-wrap">
                <span>Welcome,</span>
                <span className="text-purple-400">{firstName}</span>
              </h1>
              
              {/* Designation Strip */}
              <div className="mt-1.5 inline-flex items-center gap-2 px-2.5 py-1 bg-[#1a1126] border border-purple-600/50 rounded-lg text-left">
                <span className="material-symbols-outlined text-purple-400 text-base">workspace_premium</span>
                <span className="text-xs sm:text-sm font-extrabold text-white tracking-wide uppercase">
                  {designation}
                </span>
                <span className="text-purple-500 font-bold">•</span>
                <span className="text-xs text-purple-300 font-bold tracking-wide">
                  {teamName}
                </span>
              </div>
            </div>

            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              Direct access portal for the Virtual Reality &amp; Gaming Club ecosystem. Access digital ID passes, dues ledger, event planning proposals, and chapter roster.
            </p>
          </div>

          {/* Mouse & Device Tilt Hero Logo Card (Strictly Solid Background - NO GRADIENT) */}
          <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={transformStyle}
            className="w-full lg:w-72 h-32 sm:h-36 lg:h-40 rounded-2xl overflow-hidden border border-purple-800/60 flex items-center justify-center bg-[#07020d] relative shadow-lg shrink-0 cursor-pointer select-none"
          >
            <img src="/vrgc-logo.png" alt="VRGC Hero Logo" className="w-full h-full object-cover opacity-85 pointer-events-none" />
          </div>
        </section>

        {/* Navigation Bento Grid (Strictly Solid Colors, No Gradients, Mobile Optimized) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">

          {/* 1. Digital ID Card Card */}
          <button
            onClick={() => onPageChange('idcard')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#141414] hover:bg-[#191919] border border-[#292929] hover:border-purple-500 rounded-2xl transition-all duration-200 text-left min-h-[190px] sm:min-h-[220px] shadow-sm hover:shadow-[0_0_20px_rgba(147,51,234,0.2)] cursor-pointer"
          >
            <div className="space-y-3 w-full">
              <div className="flex items-center justify-between w-full">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-300">
                  <span className="material-symbols-outlined text-2xl">badge</span>
                </div>
                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800">
                  Identity Pass
                </span>
              </div>

              <div>
                <h3 className="text-lg sm:text-xl text-white font-black tracking-tight group-hover:text-purple-300 transition-colors">
                  Digital ID Card
                </h3>
                <p className="text-slate-400 text-xs leading-relaxed mt-1">
                  Claim your VRGC Digital ID credentials. Submit profile photo and generate high-res pass.
                </p>
              </div>
            </div>

            <div className="mt-4 w-full flex items-center justify-between pt-3 border-t border-[#262626]">
              <span className="text-[10px] sm:text-[11px] text-purple-300 font-extrabold tracking-widest uppercase">
                GENERATE CARD
              </span>
              <div className="w-7 h-7 rounded-lg bg-purple-700 group-hover:bg-purple-600 flex items-center justify-center text-white transition-all shadow-[0_0_8px_rgba(147,51,234,0.3)]">
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </div>
            </div>
          </button>

          {/* 2. Payments & Dues Portal Card */}
          <button
            onClick={() => onPageChange('payments')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#141414] hover:bg-[#191919] border border-[#292929] hover:border-emerald-500 rounded-2xl transition-all duration-200 text-left min-h-[190px] sm:min-h-[220px] shadow-sm hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] cursor-pointer"
          >
            <div className="space-y-3 w-full">
              <div className="flex items-center justify-between w-full">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-300">
                  <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
                </div>
                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                  Finance Desk
                </span>
              </div>

              <div>
                <h3 className="text-lg sm:text-xl text-white font-black tracking-tight group-hover:text-emerald-300 transition-colors">
                  Payments &amp; Dues
                </h3>
                <p className="text-slate-400 text-xs leading-relaxed mt-1">
                  Manage club membership fees, active dues, automated transactions, and verified receipts.
                </p>
              </div>
            </div>

            <div className="mt-4 w-full flex items-center justify-between pt-3 border-t border-[#262626]">
              <span className="text-[10px] sm:text-[11px] text-emerald-300 font-extrabold tracking-widest uppercase">
                PAY DUES
              </span>
              <div className="w-7 h-7 rounded-lg bg-emerald-700 group-hover:bg-emerald-600 flex items-center justify-center text-white transition-all shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </div>
            </div>
          </button>

          {/* 3. Referral Program Card */}
          <button
            onClick={() => onPageChange('referrals')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#141414] hover:bg-[#191919] border border-[#292929] hover:border-cyan-500 rounded-2xl transition-all duration-200 text-left min-h-[190px] sm:min-h-[220px] shadow-sm hover:shadow-[0_0_20px_rgba(6,182,212,0.2)] cursor-pointer"
          >
            <div className="space-y-3 w-full">
              <div className="flex items-center justify-between w-full">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-300">
                  <span className="material-symbols-outlined text-2xl">share</span>
                </div>
                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800">
                  Outreach
                </span>
              </div>

              <div>
                <h3 className="text-lg sm:text-xl text-white font-black tracking-tight group-hover:text-cyan-300 transition-colors">
                  Referrals
                </h3>
                <p className="text-slate-400 text-xs leading-relaxed mt-1">
                  Invite your friends to the club, earn referral points, and climb the club outreach leaderboard.
                </p>
              </div>
            </div>

            <div className="mt-4 w-full flex items-center justify-between pt-3 border-t border-[#262626]">
              <span className="text-[10px] sm:text-[11px] text-cyan-300 font-extrabold tracking-widest uppercase">
                SHARE LINK
              </span>
              <div className="w-7 h-7 rounded-lg bg-cyan-700 group-hover:bg-cyan-600 flex items-center justify-center text-white transition-all shadow-[0_0_8px_rgba(6,182,212,0.3)]">
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </div>
            </div>
          </button>

          {/* 4. Planned Future Events Card */}
          <button
            onClick={() => onPageChange('planned_events')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#141414] hover:bg-[#191919] border border-[#292929] hover:border-amber-500 rounded-2xl transition-all duration-200 text-left min-h-[190px] sm:min-h-[220px] shadow-sm hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] cursor-pointer"
          >
            <div className="space-y-3 w-full">
              <div className="flex items-center justify-between w-full">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-amber-950 border border-amber-800 flex items-center justify-center text-amber-300">
                  <span className="material-symbols-outlined text-2xl">event_upcoming</span>
                </div>
                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800">
                  Event Pipeline
                </span>
              </div>

              <div>
                <h3 className="text-lg sm:text-xl text-white font-black tracking-tight group-hover:text-amber-300 transition-colors">
                  Planned Events
                </h3>
                <p className="text-slate-400 text-xs leading-relaxed mt-1">
                  Explore proposed tournaments, gaming jams, VR demos, and track upcoming faculty authorizations.
                </p>
              </div>
            </div>

            <div className="mt-4 w-full flex items-center justify-between pt-3 border-t border-[#262626]">
              <span className="text-[10px] sm:text-[11px] text-amber-300 font-extrabold tracking-widest uppercase">
                VIEW EVENTS
              </span>
              <div className="w-7 h-7 rounded-lg bg-amber-700 group-hover:bg-amber-600 flex items-center justify-center text-white transition-all shadow-[0_0_8px_rgba(245,158,11,0.3)]">
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </div>
            </div>
          </button>

          {/* 5. Members Roster Card */}
          <button
            onClick={() => onPageChange('members')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#141414] hover:bg-[#191919] border border-[#292929] hover:border-purple-500 rounded-2xl transition-all duration-200 text-left min-h-[190px] sm:min-h-[220px] shadow-sm hover:shadow-[0_0_20px_rgba(147,51,234,0.2)] cursor-pointer"
          >
            <div className="space-y-3 w-full">
              <div className="flex items-center justify-between w-full">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-300">
                  <span className="material-symbols-outlined text-2xl">groups</span>
                </div>
                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800">
                  Directory
                </span>
              </div>

              <div>
                <h3 className="text-lg sm:text-xl text-white font-black tracking-tight group-hover:text-purple-300 transition-colors">
                  Members Roster
                </h3>
                <p className="text-slate-400 text-xs leading-relaxed mt-1">
                  View full official roster of club members, division leads, and coordinators with domain filtering.
                </p>
              </div>
            </div>

            <div className="mt-4 w-full flex items-center justify-between pt-3 border-t border-[#262626]">
              <span className="text-[10px] sm:text-[11px] text-purple-300 font-extrabold tracking-widest uppercase">
                EXPLORE ROSTER
              </span>
              <div className="w-7 h-7 rounded-lg bg-purple-700 group-hover:bg-purple-600 flex items-center justify-center text-white transition-all shadow-[0_0_8px_rgba(147,51,234,0.3)]">
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </div>
            </div>
          </button>

          {/* 6. Super Admin / Admin Command Center Card (Conditional) */}
          {(isSuperAdmin || isAdmin) && (
            <button
              onClick={() => {
                if (isSuperAdmin && onOpenSuperAdminModal) {
                  onOpenSuperAdminModal();
                } else {
                  onPageChange('members');
                }
              }}
              className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#141414] hover:bg-[#191919] border border-purple-600/40 hover:border-purple-400 rounded-2xl transition-all duration-200 text-left min-h-[190px] sm:min-h-[220px] shadow-sm hover:shadow-[0_0_20px_rgba(147,51,234,0.25)] cursor-pointer"
            >
              <div className="space-y-3 w-full">
                <div className="flex items-center justify-between w-full">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-purple-900 border border-purple-500 flex items-center justify-center text-white">
                    <span className="material-symbols-outlined text-2xl">admin_panel_settings</span>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-purple-900 text-purple-200 border border-purple-500">
                    {isSuperAdmin ? 'SUPER ADMIN' : 'ADMIN DESK'}
                  </span>
                </div>

                <div>
                  <h3 className="text-lg sm:text-xl text-white font-black tracking-tight group-hover:text-purple-300 transition-colors">
                    {isSuperAdmin ? 'Super Admin Console' : 'Member Roster Desk'}
                  </h3>
                  <p className="text-slate-400 text-xs leading-relaxed mt-1">
                    {isSuperAdmin
                      ? 'Add/drop admins, manage roles (Admin, Payment Admin, Technical), and modify faculty records.'
                      : 'Manage active registrations, import CSV rosters, and inspect member submissions.'}
                  </p>
                </div>
              </div>

              <div className="mt-4 w-full flex items-center justify-between pt-3 border-t border-[#262626]">
                <span className="text-[10px] sm:text-[11px] text-purple-300 font-extrabold tracking-widest uppercase">
                  {isSuperAdmin ? 'OPEN CONSOLE' : 'MANAGE CLUB'}
                </span>
                <div className="w-7 h-7 rounded-lg bg-purple-700 group-hover:bg-purple-600 flex items-center justify-center text-white transition-all shadow-[0_0_8px_rgba(147,51,234,0.3)]">
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </div>
              </div>
            </button>
          )}

        </div>
      </div>
    </div>
  );
};

export default Dashboard;
