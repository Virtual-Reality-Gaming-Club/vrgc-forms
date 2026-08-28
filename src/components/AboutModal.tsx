"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { X, Code2, Sparkles, ShieldCheck, Terminal, Cpu, Heart, ExternalLink, Crown, Award, UserCheck, Star, Users, Globe } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TeamMember {
  name: string;
  role: string;
  badgeRole?: string;
  rank?: number;
  regNo?: string;
  email?: string;
  phone?: string;
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
    githubUrl: "https://github.com/",
    linkedinUrl: "https://linkedin.com/",
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
    githubUrl: "https://github.com/",
    linkedinUrl: "https://linkedin.com/",
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

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(TECH_TEAM_LIST);
  const [loadingMembers, setLoadingMembers] = useState<boolean>(false);

  // Dynamically enrich team details from Firestore 'members' and 'id_cards' collections
  useEffect(() => {
    if (!isOpen) return;

    const fetchMemberDetails = async () => {
      setLoadingMembers(true);
      try {
        const updatedList = await Promise.all(
          TECH_TEAM_LIST.map(async (m) => {
            let firestoreData: any = null;

            try {
              // 1. Search in 'id_cards' collection by name (case-insensitive substring)
              const idCardsQuery = query(collection(db, 'id_cards'));
              const idCardsSnap = await getDocs(idCardsQuery);
              idCardsSnap.forEach((docSnap) => {
                const data = docSnap.data();
                if (data.name && data.name.toLowerCase().includes(m.name.toLowerCase().split(' ')[0])) {
                  firestoreData = data;
                }
              });

              // 2. If not found in id_cards, query 'members' collection
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
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof window === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div
        className="relative w-full max-w-2xl bg-[#0c061a] border border-purple-500/30 rounded-3xl p-5 sm:p-7 text-white shadow-[0_0_50px_rgba(168,85,247,0.25)] overflow-hidden transition-all max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Background Decorative Glow */}
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-purple-600/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-48 h-48 bg-pink-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-all z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Icon & Title */}
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-purple-300">
            <Code2 className="w-6 h-6 animate-pulse text-pink-400" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-pink-300 to-purple-400">
                VRGC Tech Team Roster
              </h2>
              <Sparkles className="w-4 h-4 text-pink-400" />
            </div>
            <p className="text-xs text-slate-400">Virtual Reality & Gaming Club | Technical Operations</p>
          </div>
        </div>

        {/* Body Content - Scrollable Roster */}
        <div className="overflow-y-auto pr-1 space-y-4 text-xs text-slate-300 custom-scrollbar flex-1">
          <p className="leading-relaxed text-slate-300">
            Engineered and maintained by the <strong className="text-purple-300">VRGC Technical Team</strong>. Ranked by leadership and technical role preference:
          </p>

          {/* Rank-Wise Team Members List */}
          <div className="space-y-2.5">
            {teamMembers.map((member) => {
              const isTopRank = member.rank === 1 || member.role === 'Technical Lead';
              const isCoLead = member.rank === 2 || member.role === 'Technical Co-Lead';
              const isCoordinator = member.badgeRole === 'Student Coordinator' || member.role?.toLowerCase().includes('guide');

              return (
                <div
                  key={member.name}
                  className={`group relative p-4 rounded-xl transition-all duration-300 hover:-translate-y-0.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 overflow-hidden ${isTopRank
                      ? 'bg-gradient-to-br from-amber-500/15 via-white/[0.04] to-pink-950/20 backdrop-blur-xl border border-amber-500/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_0_20px_rgba(245,158,11,0.12)]'
                      : isCoLead
                        ? 'bg-gradient-to-br from-purple-950/50 via-white/[0.04] to-pink-950/30 backdrop-blur-xl border border-purple-500/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_0_15px_rgba(168,85,247,0.1)]'
                        : isCoordinator
                          ? 'bg-gradient-to-br from-fuchsia-950/50 via-white/[0.04] to-purple-950/30 backdrop-blur-xl border border-fuchsia-500/40 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_0_20px_rgba(217,70,239,0.12)]'
                          : 'bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.01] backdrop-blur-xl border border-white/[0.12] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)] hover:border-purple-500/40'
                    }`}
                >
                  {/* Liquid Specular Light Sheen Reflection */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />

                  {/* Left: Rank Badge + Avatar + Details */}
                  <div className="flex items-center gap-3 relative z-10">
                    {/* Rank Badge */}
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-[11px] shrink-0 ${isTopRank
                        ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-md'
                        : isCoLead
                          ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-md'
                          : isCoordinator
                            ? 'bg-gradient-to-br from-fuchsia-500 to-pink-600 text-white shadow-md'
                            : 'bg-white/10 text-slate-300 border border-white/10'
                      }`}>
                      {isTopRank ? (
                        <Crown className="w-3.5 h-3.5 fill-black" />
                      ) : isCoordinator ? (
                        <ShieldCheck className="w-3.5 h-3.5 text-white" />
                      ) : (
                        `#${member.rank || 6}`
                      )}
                    </div>

                    {/* Member Avatar */}
                    <img
                      src={member.avatarUrl || `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(member.name)}`}
                      alt={member.name}
                      className="w-10 h-10 rounded-xl bg-purple-900/40 border border-white/20 object-cover shrink-0"
                    />

                    {/* Name & Role */}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-extrabold text-sm text-white">{member.name}</h3>
                        {isTopRank && <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />}
                      </div>
                      <p className="text-[11px] text-purple-300 font-semibold">{member.role}</p>
                      {member.regNo && (
                        <p className="text-[10px] text-slate-400 font-mono">
                          REG: {member.regNo}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Social Links & Role Status Pill */}
                  <div className="shrink-0 flex items-center gap-2 self-end sm:self-center relative z-10">
                    <div className="flex items-center gap-1">
                      {member.githubUrl && (
                        <a
                          href={member.githubUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${member.name}'s GitHub`}
                          className="p-1 rounded-lg bg-white/5 hover:bg-purple-500/20 text-slate-300 hover:text-white transition-all border border-white/10 hover:border-purple-400/40 shadow-sm"
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
                          className="p-1 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 hover:text-blue-300 transition-all border border-blue-500/20 shadow-sm"
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
                          className="p-1 rounded-lg bg-purple-600/10 hover:bg-purple-600/20 text-purple-300 hover:text-purple-200 transition-all border border-purple-500/20 shadow-sm"
                        >
                          <Globe className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1 backdrop-blur-md ${isTopRank
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : isCoLead
                          ? 'bg-purple-500/20 text-purple-200 border-purple-500/40'
                          : isCoordinator
                            ? 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/40'
                            : 'bg-slate-800/80 text-slate-300 border-slate-700'
                      }`}>
                      {isTopRank ? (
                        <Award className="w-3 h-3 text-amber-400" />
                      ) : isCoordinator ? (
                        <Sparkles className="w-3 h-3 text-fuchsia-400" />
                      ) : (
                        <UserCheck className="w-3 h-3 text-purple-400" />
                      )}
                      <span>{member.badgeRole || member.role}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tech Stack Pills */}
          <div className="pt-3 border-t border-white/10">
            <span className="block text-[11px] font-semibold text-slate-400 mb-2 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-purple-400" /> Built with Core Architecture:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {['Next.js 15', 'React', 'TypeScript', 'Firebase Firestore', 'Supabase', 'Tailwind CSS', 'Formspree'].map((tech) => (
                <span key={tech} className="px-2.5 py-1 rounded-lg bg-purple-900/30 border border-purple-500/20 text-purple-200 text-[10px] font-medium">
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {/* Developer Credits Footer */}
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
              <span>Crafted with</span>
              <Heart className="w-3.5 h-3.5 text-pink-500 fill-pink-500 animate-bounce" />
              <span>by</span>
              <strong className="text-white font-bold">VRGC Technical Desk</strong>
            </div>

            <Link
              href="/"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-[11px] flex items-center gap-1.5 shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-all"
            >
              <span>VRGC Forms Portal</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
