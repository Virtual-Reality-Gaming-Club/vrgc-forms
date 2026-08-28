"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Code2, Sparkles, ShieldCheck, Terminal, Cpu, Heart,
  ExternalLink, Crown, Award, UserCheck, Star, ArrowLeft,
  CheckCircle2, Layers, Zap, Globe
} from 'lucide-react';
import { collection, query, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const GithubIcon: React.FC<{ className?: string }> = ({ className = "w-3.5 h-3.5" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const LinkedinIcon: React.FC<{ className?: string }> = ({ className = "w-3.5 h-3.5" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.75a1.45 1.45 0 1 0 1.45 1.45A1.46 1.46 0 0 0 7.86 6.75Z" />
  </svg>
);

interface TeamMember {
  name: string;
  role: string;
  badgeRole?: string;
  rank?: number;
  regNo?: string;
  email?: string;
  position?: string;
  team?: string;
  avatarUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
}

const TECH_TEAM_LIST: TeamMember[] = [
  {
    name: "Rishav Mandal",
    role: "Technical Lead",
    rank: 1,
    regNo: "24BSA10096",
    githubUrl: "https://github.com/RiShAv-MaNdAl3122",
    linkedinUrl: "https://www.linkedin.com/in/rishav-mandal-655318339",
  },
  {
    name: "Abhinav Mishra",
    role: "Technical Co-Lead",
    rank: 2,
    regNo: "25BCY10254",
    githubUrl: "https://github.com/NotSoAbhinav",
    linkedinUrl: "https://linkedin.com/in/NotSoAbhinav",
  },
  {
    name: "Jaiyansh Dhaulakhandi",
    role: "Core Technical Member",
    rank: 3,
    githubUrl: "https://github.com/Jaiyansh-4n6",
    linkedinUrl: "https://linkedin.com/in/Jaiyansh-4n6",
  },
  {
    name: "Anmol Shrivastava",
    role: "Core Technical Member",
    rank: 4,
    githubUrl: "https://github.com/anmolshri30",
    linkedinUrl: "https://www.linkedin.com/in/anmol-shrivastava-30-abcd",
  },
  {
    name: "Mohit Borekar",
    role: "Core Technical Member",
    rank: 5,
    githubUrl: "https://github.com/Mohit-Borekar",
    linkedinUrl: "https://www.linkedin.com/in/mohit-borekar-522879396/",
  },
  {
    name: "Haardik Pahlajani",
    role: "Creative Director",
    badgeRole: "Student Coordinator",
    githubUrl: "https://github.com/Haardik2111",
    linkedinUrl: "https://www.linkedin.com/in/haardik-pahlajani-a550772b9/",
  },
  {
    name: "Parardha Dhar",
    role: "Technical Guide",
    badgeRole: "Student Coordinator",
    githubUrl: "https://github.com/parardhadhar",
    linkedinUrl: "https://www.linkedin.com/in/parardhadhar/",
  },
];

export default function AboutPage() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(TECH_TEAM_LIST);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(true);

  useEffect(() => {
    const fetchMemberDetails = async () => {
      try {
        const updatedList = await Promise.all(
          TECH_TEAM_LIST.map(async (m) => {
            let firestoreData: any = null;

            try {
              const idCardsQuery = query(collection(db, 'id_cards'));
              const idCardsSnap = await getDocs(idCardsQuery);
              idCardsSnap.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.name && data.name.toLowerCase().includes(m.name.toLowerCase().split(' ')[0])) {
                  firestoreData = data;
                }
              });

              if (!firestoreData) {
                const membersQuery = query(collection(db, 'members'));
                const membersSnap = await getDocs(membersQuery);
                membersSnap.forEach((docSnap) => {
                  const data = docSnap.data();
                  if (data.name && data.name.toLowerCase().includes(m.name.toLowerCase().split(' ')[0])) {
                    firestoreData = data;
                  }
                });
              }
            } catch (err) {
              console.warn(`Firestore lookup for ${m.name} fallback:`, err);
            }

            return {
              ...m,
              regNo: firestoreData?.registrationNumber || firestoreData?.regNo || m.regNo || '',
              email: firestoreData?.email || m.email || '',
              position: m.role,
              team: firestoreData?.team || 'Technical Team',
              avatarUrl: firestoreData?.photoUrl || firestoreData?.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(m.name)}`,
              githubUrl: firestoreData?.githubUrl || firestoreData?.github || m.githubUrl || '',
              linkedinUrl: firestoreData?.linkedinUrl || firestoreData?.linkedin || m.linkedinUrl || '',
              portfolioUrl: firestoreData?.portfolioUrl || firestoreData?.website || m.portfolioUrl || '',
            };
          })
        );
        setTeamMembers(updatedList);
      } catch (e) {
        console.error('Failed to fetch tech team details:', e);
      } finally {
        setLoadingMembers(false);
      }
    };

    fetchMemberDetails();
  }, []);

  return (
    <div className="min-h-screen bg-[#070212] text-white flex flex-col selection:bg-purple-500 selection:text-white relative overflow-x-hidden">
      {/* Background Decorative Ambient Glows */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[450px] bg-gradient-to-b from-purple-900/25 via-pink-950/15 to-transparent blur-[140px] pointer-events-none -z-10" />
      <div className="fixed -bottom-32 -left-32 w-96 h-96 bg-purple-900/20 blur-[130px] pointer-events-none -z-10" />
      <div className="fixed -bottom-32 -right-32 w-96 h-96 bg-pink-900/15 blur-[130px] pointer-events-none -z-10" />

      {/* Navigation Bar */}
      <Navbar pageTitle="About VRGC Tech Team" />

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-14 space-y-12">

        {/* Hero Banner Header - Liquid Glass */}
        <div className="relative rounded-3xl p-7 sm:p-11 bg-gradient-to-br from-purple-950/35 via-white/[0.03] to-pink-950/20 backdrop-blur-2xl border border-white/[0.15] shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden group">
          {/* Subtle Liquid Ambient Light */}
          <div className="absolute -top-24 -right-24 w-72 h-72 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-full blur-3xl pointer-events-none group-hover:scale-125 transition-transform duration-700" />

          {/* Subtle Ambient Code Icon */}
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none hidden md:block group-hover:opacity-20 transition-opacity duration-500">
            <Code2 className="w-72 h-72 text-purple-400" />
          </div>

          <div className="relative z-10 space-y-5 max-w-3xl">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-purple-300 hover:text-white text-xs font-bold border border-white/10 hover:border-purple-400/40 transition-all group/btn mb-1 shadow-sm"
            >
              <ArrowLeft className="w-4 h-4 group-hover/btn:-translate-x-1 transition-transform" />
              <span>Back to Command Center</span>
            </Link>

            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-500/15 border border-purple-400/30 text-purple-200 text-xs font-bold shadow-[0_0_20px_rgba(168,85,247,0.2)] backdrop-blur-md">
              <Sparkles className="w-3.5 h-3.5 text-pink-400 animate-pulse" />
              <span className="tracking-wide">Official Technical Operations</span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-purple-100 to-purple-400 tracking-tight leading-tight">
              VRGC Technical Division
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-sans">
              Engineering the digital infrastructure for the <strong className="text-purple-300 font-semibold">Virtual Reality & Gaming Club (VRGC)</strong> at VIT Bhopal. Built from the ground up to streamline student registrations, digital member passes, financial audits, and technical operations.
            </p>
          </div>
        </div>

        {/* Team Roster Section */}
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2 tracking-tight">
                <Crown className="w-5 h-5 text-amber-400" />
                <span>Technical Leadership & Core Roster</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-400">Ranked by role preference and technical responsibilities</p>
            </div>
            <span className="px-3.5 py-1.5 rounded-full bg-purple-950/60 border border-purple-500/30 text-purple-300 text-xs font-bold self-start sm:self-auto shadow-sm">
              {teamMembers.length} Core Members
            </span>
          </div>

          {/* Liquid Glass Roster Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {teamMembers.map((member) => {
              const isLead = member.rank === 1 || member.role === 'Technical Lead';
              const isCoLead = member.rank === 2 || member.role === 'Technical Co-Lead';
              const isCoordinator = member.badgeRole === 'Student Coordinator' || member.role?.toLowerCase().includes('guide');

              return (
                <div
                  key={member.name}
                  className={`group relative p-6 rounded-2xl transition-all duration-300 hover:-translate-y-1.5 flex flex-col justify-between gap-5 overflow-hidden ${isLead
                    ? 'bg-gradient-to-br from-amber-500/15 via-white/[0.04] to-pink-950/20 backdrop-blur-2xl border border-amber-500/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_0_35px_rgba(245,158,11,0.15)] hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_0_45px_rgba(245,158,11,0.25)]'
                    : isCoLead
                      ? 'bg-gradient-to-br from-purple-950/50 via-white/[0.04] to-pink-950/30 backdrop-blur-2xl border border-purple-500/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_0_25px_rgba(168,85,247,0.12)] hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_0_35px_rgba(168,85,247,0.22)]'
                      : isCoordinator
                        ? 'bg-gradient-to-br from-fuchsia-950/50 via-white/[0.04] to-purple-950/30 backdrop-blur-2xl border border-fuchsia-500/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_0_25px_rgba(217,70,239,0.12)] hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_0_35px_rgba(217,70,239,0.22)]'
                        : 'bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.01] backdrop-blur-2xl border border-white/[0.12] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] hover:border-purple-500/40 hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_0_25px_rgba(168,85,247,0.15)]'
                    }`}
                >
                  {/* Liquid Specular Light Sheen Reflection */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

                  <div className="space-y-4 relative z-10">
                    <div className="flex items-center justify-between">
                      {/* Rank / Role Badge */}
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shadow-md ${isLead
                        ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-amber-500/40'
                        : isCoLead
                          ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-purple-500/40'
                          : isCoordinator
                            ? 'bg-gradient-to-br from-fuchsia-500 to-pink-600 text-white shadow-fuchsia-500/40'
                            : 'bg-white/10 text-slate-300 border border-white/10'
                        }`}>
                        {isLead ? (
                          <Crown className="w-4 h-4 fill-black" />
                        ) : isCoordinator ? (
                          <ShieldCheck className="w-4 h-4 text-white" />
                        ) : member.rank ? (
                          `#${member.rank}`
                        ) : (
                          <Sparkles className="w-4 h-4 text-white" />
                        )}
                      </div>

                      {/* Status Tag */}
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase border flex items-center gap-1.5 shadow-sm backdrop-blur-md ${isLead
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : isCoLead
                          ? 'bg-purple-500/20 text-purple-200 border-purple-500/40'
                          : isCoordinator
                            ? 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40'
                            : 'bg-slate-800/80 text-slate-300 border-slate-700'
                        }`}>
                        {isLead ? (
                          <Award className="w-3 h-3 text-amber-400" />
                        ) : isCoordinator ? (
                          <Sparkles className="w-3 h-3 text-fuchsia-400" />
                        ) : (
                          <UserCheck className="w-3 h-3 text-purple-400" />
                        )}
                        <span>{member.badgeRole || member.role}</span>
                      </span>
                    </div>

                    {/* Member Avatar & Details */}
                    <div className="flex items-center gap-4 pt-1">
                      <div className="relative group-hover:scale-105 transition-transform duration-300 shrink-0">
                        <img
                          src={member.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(member.name)}`}
                          alt={member.name}
                          className="w-13 h-13 rounded-2xl bg-purple-950/60 border border-white/20 object-cover shadow-lg"
                        />
                        <div className={`absolute -inset-1 rounded-2xl -z-10 blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${isLead ? 'bg-amber-500/30' : 'bg-purple-500/30'
                          }`} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-extrabold text-base text-white truncate group-hover:text-purple-200 transition-colors">{member.name}</h3>
                          {isLead && <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />}
                        </div>
                        <p className="text-xs text-purple-300 font-semibold truncate">{member.role}</p>
                        {member.regNo && (
                          <p className="text-[11px] text-slate-400 font-mono mt-0.5 tracking-wide">
                            {member.regNo}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Team Tag & Social Links */}
                  <div className="pt-3.5 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400 gap-2 relative z-10">
                    <div className="flex items-center gap-1.5">
                      {member.githubUrl && (
                        <a
                          href={member.githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${member.name}'s GitHub`}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-purple-500/20 text-slate-300 hover:text-purple-200 transition-all border border-white/10 hover:border-purple-500/40 hover:scale-105 shadow-sm"
                        >
                          <GithubIcon className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {member.linkedinUrl && (
                        <a
                          href={member.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${member.name}'s LinkedIn`}
                          className="p-1.5 rounded-lg bg-blue-600/10 hover:bg-blue-600/25 text-blue-400 hover:text-blue-200 transition-all border border-blue-500/20 hover:scale-105 shadow-sm"
                        >
                          <LinkedinIcon className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {member.portfolioUrl && (
                        <a
                          href={member.portfolioUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${member.name}'s Portfolio`}
                          className="p-1.5 rounded-lg bg-purple-600/10 hover:bg-purple-600/25 text-purple-300 hover:text-purple-100 transition-all border border-purple-500/20 hover:scale-105 shadow-sm"
                        >
                          <Globe className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                    <strong className="text-purple-200 font-semibold tracking-wide">{member.team || 'Technical Team'}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Liquid Glass Technical Architecture & Pillars */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="group relative p-6 rounded-2xl bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.01] backdrop-blur-2xl border border-white/[0.12] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_10px_30px_rgba(0,0,0,0.4)] hover:border-purple-500/40 transition-all duration-300 space-y-3 hover:-translate-y-1 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-sm relative z-10">
              <Terminal className="w-5 h-5" />
            </div>
            <div className="relative z-10">
              <h3 className="font-extrabold text-base text-white mb-1">Full-Stack Platform</h3>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                Custom built with Next.js 15 App Router, React 19, TypeScript, and Tailwind CSS for max performance and seamless UX.
              </p>
            </div>
          </div>

          <div className="group relative p-6 rounded-2xl bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.01] backdrop-blur-2xl border border-white/[0.12] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_10px_30px_rgba(0,0,0,0.4)] hover:border-pink-500/40 transition-all duration-300 space-y-3 hover:-translate-y-1 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 shadow-sm relative z-10">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="relative z-10">
              <h3 className="font-extrabold text-base text-white mb-1">Cloud Realtime DB</h3>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                Powered by Firebase Firestore real-time subscriptions and Supabase cloud storage for secure member passes.
              </p>
            </div>
          </div>

          <div className="group relative p-6 rounded-2xl bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.01] backdrop-blur-2xl border border-white/[0.12] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_10px_30px_rgba(0,0,0,0.4)] hover:border-amber-500/40 transition-all duration-300 space-y-3 hover:-translate-y-1 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-sm relative z-10">
              <Zap className="w-5 h-5" />
            </div>
            <div className="relative z-10">
              <h3 className="font-extrabold text-base text-white mb-1">Automated Workflows</h3>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                Automated invoice expiration timers, Formspree support tickets, and HMAC-verified payment verification pipelines.
              </p>
            </div>
          </div>
        </section>

        {/* Liquid Glass Tech Stack Pills */}
        <section className="p-6 sm:p-7 rounded-2xl bg-gradient-to-b from-purple-950/30 via-white/[0.03] to-purple-950/20 backdrop-blur-2xl border border-purple-500/30 shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_10px_30px_rgba(0,0,0,0.4)] space-y-3.5">
          <div className="flex items-center gap-2 text-sm font-extrabold text-purple-300 tracking-wide">
            <Cpu className="w-4 h-4 text-purple-400" />
            <span>Technologies & Frameworks Used</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Next.js 15', 'React 19', 'TypeScript', 'Firebase Firestore', 'Supabase Storage', 'Formspree API', 'Tailwind CSS', 'Razorpay SDK'].map((tech) => (
              <span
                key={tech}
                className="px-3.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-purple-200 text-xs font-semibold hover:border-purple-400/50 hover:bg-purple-500/20 hover:text-white transition-all cursor-default shadow-sm"
              >
                {tech}
              </span>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
