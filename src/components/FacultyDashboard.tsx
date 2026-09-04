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
  facultyName = 'Faculty Mentor',
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
    <div className="flex-grow min-h-[calc(100vh-117px)] overflow-y-auto p-3 sm:p-6 md:p-8 bg-transparent relative text-left select-none">
      <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
        
        {/* Header Hero Section - Strictly Solid Colors */}
        <section className="bg-[#0c0514] border border-[#261238] rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 sm:space-y-3 max-w-2xl text-left w-full">
            {/* Badges strip */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-950 text-indigo-300 border border-indigo-700">
                <span className="material-symbols-outlined text-[12px]">school</span>
                FACULTY ADVISORY DESK
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#1c1c1c] text-purple-300 border border-[#333333]">
                VRGC CHAPTER • VIT BHOPAL
              </span>
            </div>

            {/* Personalized Name & Welcome */}
            <h1 className="text-2xl sm:text-3xl md:text-4xl text-white font-black tracking-tight">
              Welcome, {facultyName}
            </h1>

            {/* Subtitle & Club Role */}
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              Institutional governance desk for the Virtual Reality &amp; Gaming Club. Review student proposals, inspect transparent ledgers, and supervise chapter rosters.
            </p>

            {/* Details Strip */}
            <div className="pt-2 flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <span className="bg-[#140b22] px-2.5 py-1 rounded-md border border-[#331854] text-purple-300">
                Email: <strong className="text-white">{facultyEmail || 'faculty@vitbhopal.ac.in'}</strong>
              </span>
              <span className="bg-[#140b22] px-2.5 py-1 rounded-md border border-[#331854] text-emerald-300 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Verified Academic Mentor
              </span>
            </div>
          </div>

          {/* 3D Tilt Hero Logo Card - Solid Dark Theme */}
          <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={transformStyle}
            className="w-full md:w-72 h-32 sm:h-36 md:h-40 rounded-2xl overflow-hidden border border-[#2d1645] flex items-center justify-center bg-[#07010f] relative shadow-lg flex-shrink-0 cursor-pointer select-none"
          >
            <img src="/vrgc-logo.png" alt="VRGC Hero Logo" className="w-full h-full object-cover opacity-80 pointer-events-none" />
            <div className="absolute inset-0 bg-black/40 pointer-events-none" />
            <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[10px] font-bold text-purple-200">
              <span className="bg-[#120722] border border-purple-800 px-2 py-0.5 rounded text-white">
                OFFICIAL PORTAL
              </span>
              <span className="text-emerald-400 bg-[#051a10] border border-emerald-800 px-2 py-0.5 rounded flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Secure
              </span>
            </div>
          </div>
        </section>

        {/* Quick KPI Stat Strip - Compact & Responsive */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
          <div className="bg-[#0e071a] border border-[#261238] rounded-xl sm:rounded-2xl p-3.5 sm:p-5 text-left">
            <span className="font-label-caps text-[9px] sm:text-[10px] text-purple-300 font-bold block mb-1">
              TOTAL CLUB MEMBERS
            </span>
            <div className="text-xl sm:text-2xl md:text-3xl font-black text-white">
              {loadingStats ? '—' : totalMembers}
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 mt-1 block">Active across domains</span>
          </div>

          <div className="bg-[#0e071a] border border-[#261238] rounded-xl sm:rounded-2xl p-3.5 sm:p-5 text-left">
            <span className="font-label-caps text-[9px] sm:text-[10px] text-indigo-300 font-bold block mb-1">
              ACTIVE DOMAINS
            </span>
            <div className="text-xl sm:text-2xl md:text-3xl font-black text-white">
              {loadingStats ? '—' : totalTeams}
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 mt-1 block">Technical &amp; Creative</span>
          </div>

          <div className="bg-[#0e071a] border border-[#261238] rounded-xl sm:rounded-2xl p-3.5 sm:p-5 text-left">
            <span className="font-label-caps text-[9px] sm:text-[10px] text-amber-300 font-bold block mb-1">
              PENDING REVIEWS
            </span>
            <div className="text-xl sm:text-2xl md:text-3xl font-black text-amber-400">
              {loadingStats ? '—' : pendingEventCount}
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 mt-1 block">Actionable proposals</span>
          </div>

          <div className="bg-[#0e071a] border border-[#261238] rounded-xl sm:rounded-2xl p-3.5 sm:p-5 text-left">
            <span className="font-label-caps text-[9px] sm:text-[10px] text-emerald-300 font-bold block mb-1">
              FACULTY PAYMENTS
            </span>
            <div className="text-xl sm:text-2xl md:text-3xl font-black text-emerald-400">
              {loadingStats ? '—' : approvedPaymentsCount}
            </div>
            <span className="text-[10px] sm:text-[11px] text-slate-400 mt-1 block">Published entries</span>
          </div>
        </div>

        {/* Faculty Action Cards Grid - Solid Colors, Mobile Optimized */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
          
          {/* Card 1: Members Roster */}
          <button
            onClick={() => onPageChange('members')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#0e071a] hover:bg-[#130a24] border border-[#261238] hover:border-purple-500 rounded-2xl transition-all duration-200 text-left min-h-[200px] sm:min-h-[240px] shadow-sm hover:shadow-[0_0_20px_rgba(147,51,234,0.2)] cursor-pointer"
          >
            <div>
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center mb-4 text-purple-300">
                <span className="material-symbols-outlined text-2xl sm:text-3xl">badge</span>
              </div>
              <span className="font-label-caps text-[9px] text-purple-400 font-bold tracking-widest block mb-1">
                TEAM DIRECTORY
              </span>
              <h3 className="text-lg sm:text-xl text-white font-black mb-1.5">
                Members Roster
              </h3>
              <p className="text-slate-300 text-xs leading-relaxed">
                Full roster of VRGC Club members categorized by team, coordinators, and leads with search &amp; filter.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-[#261238] flex items-center justify-between w-full text-xs font-bold text-purple-300 group-hover:translate-x-1 transition-transform">
              <span>VIEW MEMBERS</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </div>
          </button>

          {/* Card 2: Faculty Payments View */}
          <button
            onClick={() => onPageChange('payments')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#0e071a] hover:bg-[#130a24] border border-[#261238] hover:border-indigo-500 rounded-2xl transition-all duration-200 text-left min-h-[200px] sm:min-h-[240px] shadow-sm hover:shadow-[0_0_20px_rgba(99,102,241,0.2)] cursor-pointer"
          >
            <div>
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center mb-4 text-indigo-300">
                <span className="material-symbols-outlined text-2xl sm:text-3xl">payments</span>
              </div>
              <span className="font-label-caps text-[9px] text-indigo-400 font-bold tracking-widest block mb-1">
                FINANCIAL AUDIT
              </span>
              <h3 className="text-lg sm:text-xl text-white font-black mb-1.5">
                Payments View
              </h3>
              <p className="text-slate-300 text-xs leading-relaxed">
                Transparent view of club dues, registration fees, and transactions authorized for faculty oversight.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-[#261238] flex items-center justify-between w-full text-xs font-bold text-indigo-300 group-hover:translate-x-1 transition-transform">
              <span>OPEN PAYMENTS</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </div>
          </button>

          {/* Card 3: Planned Future Events */}
          <button
            onClick={() => onPageChange('planned_events')}
            className="group relative flex flex-col justify-between p-5 sm:p-6 bg-[#0e071a] hover:bg-[#130a24] border border-[#261238] hover:border-emerald-500 rounded-2xl transition-all duration-200 text-left min-h-[200px] sm:min-h-[240px] shadow-sm hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] cursor-pointer sm:col-span-2 lg:col-span-1"
          >
            <div>
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center mb-4 text-emerald-300">
                <span className="material-symbols-outlined text-2xl sm:text-3xl">rate_review</span>
              </div>
              <span className="font-label-caps text-[9px] text-emerald-400 font-bold tracking-widest block mb-1">
                PROPOSAL REVIEW
              </span>
              <h3 className="text-lg sm:text-xl text-white font-black mb-1.5">
                Planned Future Events
              </h3>
              <p className="text-slate-300 text-xs leading-relaxed">
                Inspect tentative schedules, event proposals, Drive links, and grant official faculty authorization.
              </p>
            </div>
            <div className="pt-3 mt-3 border-t border-[#261238] flex items-center justify-between w-full text-xs font-bold text-emerald-300 group-hover:translate-x-1 transition-transform">
              <span>REVIEW PROPOSALS</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </div>
          </button>

        </div>
      </div>
    </div>
  );
};

export default FacultyDashboard;
