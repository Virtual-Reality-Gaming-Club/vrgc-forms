"use client";

import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { fetchFutureEvents } from '@/lib/faculty';
import { fetchPaymentsFromFirestore } from '@/lib/payments';

interface FacultyDashboardProps {
  onPageChange: (page: string) => void;
  facultyName?: string;
  facultyEmail?: string;
}

const FacultyDashboard: React.FC<FacultyDashboardProps> = ({
  onPageChange,
  facultyName = 'Faculty Member',
  facultyEmail = '',
}) => {
  const [totalMembers, setTotalMembers] = useState<number>(0);
  const [totalTeams, setTotalTeams] = useState<number>(0);
  const [pendingEventCount, setPendingEventCount] = useState<number>(0);
  const [approvedPaymentsCount, setApprovedPaymentsCount] = useState<number>(0);
  const [loadingStats, setLoadingStats] = useState<boolean>(true);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [transformStyle, setTransformStyle] = useState<React.CSSProperties>({});

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateY = ((x - centerX) / centerX) * 12;
    const rotateX = -((y - centerY) / centerY) * 12;

    setTransformStyle({
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.03, 1.03, 1.03)`,
      transition: 'transform 0.1s ease-out',
    });
  };

  const handleMouseLeave = () => {
    setTransformStyle({
      transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
      transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
    });
  };

  useEffect(() => {
    const loadOverviewData = async () => {
      setLoadingStats(true);
      try {
        // 1. Fetch total members and unique teams
        const membersSnap = await getDocs(collection(db, 'members'));
        const idCardsSnap = await getDocs(collection(db, 'id_cards'));

        const emailSet = new Set<string>();
        const teamSet = new Set<string>();

        membersSnap.forEach((d) => {
          const data = d.data();
          const em = (data.email || d.id || '').toLowerCase().trim();
          if (em && em.includes('@')) {
            emailSet.add(em);
            if (data.team) teamSet.add(data.team.trim());
          }
        });

        idCardsSnap.forEach((d) => {
          const data = d.data();
          const em = (data.email || d.id || '').toLowerCase().trim();
          if (em && em.includes('@')) {
            emailSet.add(em);
            if (data.team) teamSet.add(data.team.trim());
          }
        });

        setTotalMembers(emailSet.size || membersSnap.size || 0);
        setTotalTeams(Math.max(teamSet.size, 6));

        // 2. Fetch planned events to compute pending reviews
        const events = await fetchFutureEvents();
        const sanitizedKey = facultyEmail.toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_');
        const pending = events.filter((e) => {
          const decision = e.facultyDecisions?.[sanitizedKey]?.status;
          return !decision || decision === 'pending';
        }).length;
        setPendingEventCount(pending);

        // 3. Fetch faculty-visible payments
        const payments = await fetchPaymentsFromFirestore(undefined, true);
        const facultyVisiblePayments = payments.filter((p) => p.visible_to_faculty !== false);
        setApprovedPaymentsCount(facultyVisiblePayments.length);
      } catch (err) {
        console.warn('Faculty dashboard data load warning:', err);
      } finally {
        setLoadingStats(false);
      }
    };

    loadOverviewData();
  }, [facultyEmail]);

  return (
    <div className="flex-grow min-h-[calc(100vh-117px)] overflow-y-auto p-4 md:p-8 bg-mesh relative text-left select-none">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header Hero Section */}
        <section className="flex flex-col md:flex-row items-center justify-between gap-8 pb-8 border-b border-purple-500/15 stagger-in">
          <div className="space-y-3 max-w-2xl text-left w-full">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                <span className="material-symbols-outlined text-[13px]">school</span>
                FACULTY ADVISORY DESK
              </span>
              <span className="font-code-sm text-xs text-purple-400 font-bold uppercase tracking-wider">
                VRGC CHAPTER
              </span>
            </div>
            <h2 className="font-display-lg text-3xl md:text-4xl text-white font-extrabold tracking-tight">
              Welcome, {facultyName}
            </h2>
            <p className="font-body-lg text-slate-400 text-sm md:text-base leading-relaxed">
              Executive overview for Virtual Reality &amp; Gaming Club operations, member rosters, transparent dues, and future event authorizations.
            </p>
          </div>

          {/* 3D Tilt Hero Graphic */}
          <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={transformStyle}
            className="w-full md:w-80 h-44 rounded-2xl overflow-hidden border border-purple-500/30 flex items-center justify-center bg-gradient-to-br from-[#120824] via-[#0e0518] to-[#05010a] relative shadow-[0_0_40px_rgba(168,85,247,0.2)] flex-shrink-0 cursor-pointer select-none"
          >
            <img src="/vrgc-logo.png" alt="VRGC Hero Logo" className="w-full h-full object-cover opacity-85 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#05010a] via-transparent to-transparent pointer-events-none" />
            <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between text-[11px] font-bold text-purple-200">
              <span className="bg-black/60 px-2 py-0.5 rounded backdrop-blur-md">FACULTY PORTAL</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Verified Access
              </span>
            </div>
          </div>
        </section>

        {/* Quick KPI Stat Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#12081f]/80 border border-purple-500/20 rounded-2xl p-5 backdrop-blur-xl">
            <span className="font-label-caps text-[10px] text-purple-300 font-bold block mb-1">TOTAL CLUB MEMBERS</span>
            <div className="text-2xl sm:text-3xl font-black text-white">
              {loadingStats ? '—' : totalMembers}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">Active across all teams</span>
          </div>

          <div className="bg-[#12081f]/80 border border-purple-500/20 rounded-2xl p-5 backdrop-blur-xl">
            <span className="font-label-caps text-[10px] text-indigo-300 font-bold block mb-1">ACTIVE DOMAINS</span>
            <div className="text-2xl sm:text-3xl font-black text-white">
              {loadingStats ? '—' : totalTeams}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">Specialized VRGC wings</span>
          </div>

          <div className="bg-[#12081f]/80 border border-purple-500/20 rounded-2xl p-5 backdrop-blur-xl">
            <span className="font-label-caps text-[10px] text-amber-300 font-bold block mb-1">ACTION ITEMS</span>
            <div className="text-2xl sm:text-3xl font-black text-amber-400">
              {loadingStats ? '—' : pendingEventCount}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">Pending event reviews</span>
          </div>

          <div className="bg-[#12081f]/80 border border-purple-500/20 rounded-2xl p-5 backdrop-blur-xl">
            <span className="font-label-caps text-[10px] text-emerald-300 font-bold block mb-1">FACULTY PAYMENTS</span>
            <div className="text-2xl sm:text-3xl font-black text-emerald-400">
              {loadingStats ? '—' : approvedPaymentsCount}
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">Published financial entries</span>
          </div>
        </div>

        {/* Faculty Sub-Categories Navigation Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Members Page */}
          <button
            onClick={() => onPageChange('members')}
            className="group relative flex flex-col items-start p-8 bg-[#150a24]/90 border border-purple-500/30 hover:border-purple-400 rounded-3xl glow-hover transition-all duration-300 text-left overflow-hidden h-[330px] w-full shadow-[0_0_30px_rgba(168,85,247,0.1)]"
          >
            <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-[160px] text-purple-400">groups</span>
            </div>
            <div className="mb-auto z-10">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center mb-6 shadow-inner">
                <span className="material-symbols-outlined text-purple-300 text-3xl">badge</span>
              </div>
              <span className="font-label-caps text-[10px] text-purple-300 font-bold tracking-widest block mb-1">
                TEAM DIRECTORY
              </span>
              <h3 className="font-display-lg text-2xl text-white font-extrabold mb-2">
                Members Roster
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Full roster of VRGC Club members categorized by team, co-presidents, coordinators, and domain leads with real-time filters.
              </p>
            </div>
            <div className="mt-4 w-full flex items-center justify-between z-10 pt-4 border-t border-purple-500/20">
              <span className="font-label-caps text-xs text-purple-300 font-bold group-hover:translate-x-2 transition-transform duration-300">
                VIEW MEMBERS
              </span>
              <span className="material-symbols-outlined text-white">arrow_forward</span>
            </div>
          </button>

          {/* Card 2: Payments View */}
          <button
            onClick={() => onPageChange('payments')}
            className="group relative flex flex-col items-start p-8 bg-[#150a24]/90 border border-purple-500/30 hover:border-indigo-400 rounded-3xl glow-hover transition-all duration-300 text-left overflow-hidden h-[330px] w-full shadow-[0_0_30px_rgba(168,85,247,0.1)]"
          >
            <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-[160px] text-indigo-400">account_balance</span>
            </div>
            <div className="mb-auto z-10">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center mb-6 shadow-inner">
                <span className="material-symbols-outlined text-indigo-300 text-3xl">payments</span>
              </div>
              <span className="font-label-caps text-[10px] text-indigo-300 font-bold tracking-widest block mb-1">
                FINANCIAL LEDGER
              </span>
              <h3 className="font-display-lg text-2xl text-white font-extrabold mb-2">
                Payments View
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Transparent view of club dues, registration fees, and transactions authorized by Admin for faculty oversight.
              </p>
            </div>
            <div className="mt-4 w-full flex items-center justify-between z-10 pt-4 border-t border-purple-500/20">
              <span className="font-label-caps text-xs text-indigo-300 font-bold group-hover:translate-x-2 transition-transform duration-300">
                OPEN PAYMENTS
              </span>
              <span className="material-symbols-outlined text-white">arrow_forward</span>
            </div>
          </button>

          {/* Card 3: Planned Future Events */}
          <button
            onClick={() => onPageChange('planned_events')}
            className="group relative flex flex-col items-start p-8 bg-[#150a24]/90 border border-purple-500/30 hover:border-emerald-400 rounded-3xl glow-hover transition-all duration-300 text-left overflow-hidden h-[330px] w-full shadow-[0_0_30px_rgba(168,85,247,0.1)]"
          >
            <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-[160px] text-emerald-400">event_upcoming</span>
            </div>
            <div className="mb-auto z-10">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-6 shadow-inner">
                <span className="material-symbols-outlined text-emerald-300 text-3xl">rate_review</span>
              </div>
              <span className="font-label-caps text-[10px] text-emerald-300 font-bold tracking-widest block mb-1">
                PROPOSAL REVIEW
              </span>
              <h3 className="font-display-lg text-2xl text-white font-extrabold mb-2">
                Planned Future Events
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                Inspect tentative schedules, event proposals &amp; Drive assets. Grant official approval or record rejection notes.
              </p>
            </div>
            <div className="mt-4 w-full flex items-center justify-between z-10 pt-4 border-t border-purple-500/20">
              <span className="font-label-caps text-xs text-emerald-300 font-bold group-hover:translate-x-2 transition-transform duration-300">
                REVIEW EVENTS
              </span>
              <span className="material-symbols-outlined text-white">arrow_forward</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default FacultyDashboard;
