"use client";

import React, { useRef, useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import MagicBento, { BentoCardItem } from './MagicBento';
import { cleanFullName } from '@/lib/userUtils';

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
  const cleanName = cleanFullName(rawFullName, memberData?.registrationNumber);
  const firstName = cleanName.trim().split(' ')[0] || 'Member';
  const designation = (userRole || (isSuperAdmin ? 'Super Administrator' : null)) || memberData?.position || (isAdmin ? 'Administrator' : isFaculty ? 'Faculty Mentor' : 'Club Member');
  const teamName = memberData?.team || (userRole === 'Technical' ? 'Technical Division' : userRole === 'Payment Admin' ? 'Finance & Treasury' : isFaculty ? 'Faculty Advisory' : (isSuperAdmin || isAdmin) ? 'Management' : 'General Crew');
  const regNumber = memberData?.registrationNumber || (userRole ? userRole.toUpperCase() : isSuperAdmin ? 'SUPER ADMIN' : isAdmin ? 'ADMIN' : isFaculty ? 'FACULTY' : '');

  const dashboardCards: BentoCardItem[] = [
    {
      id: 'live_admin',
      title: 'Live Broadcast Hub',
      description: 'Control tonight’s live match broadcast, YouTube streams, round scores, and halftime side swaps.',
      label: 'Production Desk',
      featuredPill: 'LIVE STREAM',
      icon: 'live_tv',
      actionText: 'OPEN STUDIO',
      color: '#120F17',
      glowColor: '244, 63, 94',
      iconBg: 'bg-rose-950/90 border-rose-800 text-rose-300',
      tagColor: 'bg-rose-950/80 text-rose-300 border border-rose-800',
      iconColor: 'text-rose-300',
      btnBg: 'bg-rose-600 hover:bg-rose-500',
      onClick: () => onPageChange('live_admin'),
    },
    {
      id: 'idcard',
      title: 'Digital ID Card',
      description: 'Claim your VRGC Digital ID credentials. Submit profile photo and generate high-res pass.',
      label: 'Identity Pass',
      icon: 'badge',
      actionText: 'GENERATE CARD',
      color: '#120F17',
      glowColor: '147, 51, 234',
      iconBg: 'bg-purple-950/90 border-purple-800 text-purple-300',
      tagColor: 'bg-purple-950/80 text-purple-300 border border-purple-800',
      iconColor: 'text-purple-300',
      btnBg: 'bg-purple-700 hover:bg-purple-600',
      onClick: () => onPageChange('idcard'),
    },
    {
      id: 'payments',
      title: 'Payments & Dues',
      description: 'Manage club membership fees, active dues, automated transactions, and verified receipts.',
      label: 'Finance Desk',
      icon: 'account_balance_wallet',
      actionText: 'PAY DUES',
      color: '#120F17',
      glowColor: '16, 185, 129',
      iconBg: 'bg-emerald-950/90 border-emerald-800 text-emerald-300',
      tagColor: 'bg-emerald-950/80 text-emerald-300 border border-emerald-800',
      iconColor: 'text-emerald-300',
      btnBg: 'bg-emerald-700 hover:bg-emerald-600',
      onClick: () => onPageChange('payments'),
    },
    {
      id: 'referrals',
      title: 'Referrals',
      description: 'Invite your friends to the club, earn referral points, and climb the club outreach leaderboard.',
      label: 'Outreach',
      featuredPill: 'POPULAR',
      icon: 'share',
      actionText: 'SHARE LINK',
      color: '#120F17',
      glowColor: '6, 182, 212',
      iconBg: 'bg-cyan-950/90 border-cyan-800 text-cyan-300',
      tagColor: 'bg-cyan-950/80 text-cyan-300 border border-cyan-800',
      iconColor: 'text-cyan-300',
      btnBg: 'bg-cyan-700 hover:bg-cyan-600',
      onClick: () => onPageChange('referrals'),
    },
    {
      id: 'planned_events',
      title: 'Planned Events',
      description: 'Explore proposed tournaments, gaming jams, VR demos, and track upcoming faculty authorizations.',
      label: 'Event Pipeline',
      icon: 'event_upcoming',
      actionText: 'VIEW EVENTS',
      color: '#120F17',
      glowColor: '245, 158, 11',
      iconBg: 'bg-amber-950/90 border-amber-800 text-amber-300',
      tagColor: 'bg-amber-950/80 text-amber-300 border border-amber-800',
      iconColor: 'text-amber-300',
      btnBg: 'bg-amber-700 hover:bg-amber-600',
      onClick: () => onPageChange('planned_events'),
    },
    {
      id: 'members',
      title: 'Members Roster',
      description: 'View full official roster of club members, division leads, and coordinators with domain filtering.',
      label: 'Directory',
      icon: 'groups',
      actionText: 'EXPLORE ROSTER',
      color: '#120F17',
      glowColor: '147, 51, 234',
      iconBg: 'bg-purple-950/90 border-purple-800 text-purple-300',
      tagColor: 'bg-purple-950/80 text-purple-300 border border-purple-800',
      iconColor: 'text-purple-300',
      btnBg: 'bg-purple-700 hover:bg-purple-600',
      onClick: () => onPageChange('members'),
    },
  ];

  if (isSuperAdmin) {
    dashboardCards.push({
      id: 'superadmin',
      title: 'Super Admin Console',
      description: 'Add/drop admins, manage roles (Admin, Payment Admin, Technical), and modify faculty records.',
      label: 'SUPER ADMIN',
      icon: 'admin_panel_settings',
      actionText: 'OPEN CONSOLE',
      color: '#120F17',
      glowColor: '168, 85, 247',
      iconBg: 'bg-purple-900 border-purple-500 text-white',
      tagColor: 'bg-purple-900 text-purple-200 border border-purple-500',
      iconColor: 'text-purple-300',
      btnBg: 'bg-purple-700 hover:bg-purple-600',
      onClick: () => {
        if (onOpenSuperAdminModal) {
          onOpenSuperAdminModal();
        } else {
          onPageChange('superadmin');
        }
      },
    });
  } else if (isAdmin) {
    dashboardCards.push({
      id: 'admin_desk',
      title: 'Member Roster Desk',
      description: 'Manage active registrations, import CSV rosters, and inspect member submissions.',
      label: 'ADMIN DESK',
      icon: 'admin_panel_settings',
      actionText: 'MANAGE CLUB',
      color: '#120F17',
      glowColor: '168, 85, 247',
      iconBg: 'bg-purple-900 border-purple-500 text-white',
      tagColor: 'bg-purple-900 text-purple-200 border border-purple-500',
      iconColor: 'text-purple-300',
      btnBg: 'bg-purple-700 hover:bg-purple-600',
      onClick: () => onPageChange('members'),
    });
  }

  return (
    <div className="flex-grow w-full p-3 sm:p-6 md:p-8 bg-transparent relative text-left select-none pb-12 sm:pb-16">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        
        {/* Personalized Welcome & Hero Section (Strictly SOLID colors - NO GRADIENTS) */}
        <section className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5 p-4 sm:p-6 lg:p-7 bg-[#121212] border border-[#2b193d] rounded-2xl sm:rounded-3xl shadow-[0_0_30px_rgba(0,0,0,0.6)]">
          <div className="space-y-3 max-w-2xl text-left w-full">
            {/* Top Status Badges */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-purple-700 text-white border border-purple-500 flex items-center gap-1 sm:gap-1.5 shadow-[0_0_10px_rgba(147,51,234,0.3)] shrink-0 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                COMMAND CENTER
              </span>

              {isSuperAdmin ? (
                <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-purple-950 text-purple-200 border border-purple-600 flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <span className="material-symbols-outlined text-[11px] sm:text-[12px]">verified_user</span>
                  SUPER ADMIN
                </span>
              ) : userRole === 'Payment Admin' ? (
                <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <span className="material-symbols-outlined text-[11px] sm:text-[12px]">account_balance_wallet</span>
                  PAYMENT ADMIN
                </span>
              ) : userRole === 'Technical' ? (
                <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-cyan-950 text-cyan-300 border border-cyan-700 flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <span className="material-symbols-outlined text-[11px] sm:text-[12px]">terminal</span>
                  TECHNICAL
                </span>
              ) : userRole ? (
                <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-[#1f162b] text-purple-300 border border-purple-700/60 flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <span className="material-symbols-outlined text-[11px] sm:text-[12px]">
                    {userRole === 'Admin' ? 'shield' : 'military_tech'}
                  </span>
                  {userRole.toUpperCase()}
                </span>
              ) : isAdmin ? (
                <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-[#1f162b] text-purple-300 border border-purple-700/60 flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <span className="material-symbols-outlined text-[11px] sm:text-[12px]">shield</span>
                  CLUB ADMIN
                </span>
              ) : isFaculty ? (
                <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-[#141b2d] text-indigo-300 border border-indigo-600 flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <span className="material-symbols-outlined text-[11px] sm:text-[12px]">school</span>
                  FACULTY MENTOR
                </span>
              ) : (
                <span className="px-2 sm:px-2.5 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-black tracking-widest uppercase bg-[#181818] text-slate-300 border border-[#333333] flex items-center gap-1 shrink-0 whitespace-nowrap">
                  <span className="material-symbols-outlined text-[11px] sm:text-[12px]">badge</span>
                  VERIFIED MEMBER
                </span>
              )}

              {regNumber && (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-md text-[8.5px] sm:text-[10px] font-mono font-bold bg-[#1a1a1a] text-purple-300 border border-[#2e2e2e] shrink-0 whitespace-nowrap">
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

        {/* Navigation Bento Grid powered by React Bits MagicBento */}
        <MagicBento
          cards={dashboardCards}
          textAutoHide={true}
          enableStars={true}
          enableSpotlight={true}
          enableBorderGlow={true}
          enableTilt={true}
          enableMagnetism={true}
          clickEffect={true}
          spotlightRadius={330}
          particleCount={12}
          glowColor="132, 0, 255"
        />
      </div>
    </div>
  );
};

export default Dashboard;
